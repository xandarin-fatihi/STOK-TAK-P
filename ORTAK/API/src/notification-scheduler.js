"use strict";

const crypto = require("crypto");
const {
  createNotificationInStore,
  getNotificationPreferences,
  notificationsFromResult,
  pendingDeliveryInvalidReason,
  publishNotificationEvent,
  publishNotificationStateEvent
} = require("./notification-service");
const { resolveNotificationRule } = require("./notification-policy");
const { normalizeStockState } = require("./store/migrations");

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_LEASE_MS = 90 * 1000;

function createNotificationScheduler(options) {
  const {
    store,
    intervalMs = DEFAULT_INTERVAL_MS,
    leaseMs = Math.max(DEFAULT_LEASE_MS, Number(intervalMs || DEFAULT_INTERVAL_MS) + 30000),
    logError = console.error,
    clock = () => new Date(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = options || {};
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new TypeError("Bildirim zamanlayıcısı için geçerli store gerekli.");
  }
  const owner = `notification-scheduler-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const safeIntervalMs = Math.max(30000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
  const safeLeaseMs = Math.max(60000, Number(leaseMs) || DEFAULT_LEASE_MS);
  let timer = null;
  let running = false;

  async function tick(nowValue) {
    if (running) return { created: 0, skipped: "running" };
    const now = validDate(nowValue === undefined ? clock() : nowValue);
    if (!now) return { created: 0, skipped: "invalid-time" };
    running = true;
    const created = [];
    let managerUpdated = null;
    let claimed = false;
    try {
      // Empty ticks never acquire a lease or enter the durable write queue.
      // The preview clones only collections that notification creation mutates.
      const snapshot = await store.read();
      if (!previewSchedulerChanges(snapshot, now)) return { created: 0, skipped: "no-work" };
      claimed = await claimLease(now);
      if (!claimed) return { created: 0, skipped: "leased" };
      const diagnostics = { invalidTaskDates: 0, invalidShiftDates: 0 };
      await store.update((data) => {
        const beforeCount = created.length;
        const notificationStateChanges = processScheduledNotifications(data, now, created)
          + processNotificationDigests(data, now, created)
          + processNotificationRepeats(data, now, created);
        createTaskReminders(data, now, created, diagnostics);
        createShiftReminders(data, now, created, diagnostics);
        const stockStateChanged = createCriticalStockNotifications(data, now, created);
        createProcurementPaymentReminders(data, now, created);
        managerUpdated = createManagerPendingReminders(data, now, created);
        if (created.length === beforeCount && !managerUpdated && !notificationStateChanges && !stockStateChanged) return noChange(store, data);
        data.notificationSchedulerState = {
          ...(data.notificationSchedulerState || {}),
          lastRunAt: now.toISOString(),
          lastTickAt: now.toISOString(),
          lastReminderScanAt: now.toISOString(),
          updatedAt: now.toISOString()
        };
        return data;
      });
      if (diagnostics.invalidTaskDates || diagnostics.invalidShiftDates) {
        logError("Bildirim zamanlayıcısı geçersiz tarihleri atladı", diagnostics);
      }
      for (const notification of created) publishNotificationEvent(notification);
      if (managerUpdated) publishNotificationStateEvent({
        recipientRole: "manager", recipientId: "manager", action: "updated",
        notificationId: managerUpdated.id, notification: managerUpdated,
        updatedAt: managerUpdated.updatedAt
      });
      return { created: created.length };
    } catch (error) {
      logError("Bildirim hatırlatma zamanlayıcısı hatası", safeSchedulerError(error));
      return { created: 0, error: true };
    } finally {
      if (claimed) await releaseLease().catch((error) => logError("Bildirim zamanlayıcısı kilidi bırakılamadı", safeSchedulerError(error)));
      running = false;
    }
  }

  async function claimLease(now) {
    let acquired = false;
    await store.update((data) => {
      const state = data.notificationSchedulerState && typeof data.notificationSchedulerState === "object"
        ? data.notificationSchedulerState
        : {};
      const leaseExpiry = Date.parse(state.leaseExpiresAt || "");
      if (state.leaseOwner && state.leaseOwner !== owner && Number.isFinite(leaseExpiry) && leaseExpiry > now.getTime()) return noChange(store, data);
      data.notificationSchedulerState = {
        ...state,
        leaseOwner: owner,
        leaseExpiresAt: new Date(now.getTime() + safeLeaseMs).toISOString(),
        updatedAt: now.toISOString()
      };
      acquired = true;
      return data;
    });
    return acquired;
  }

  async function releaseLease() {
    const now = validDate(clock()) || new Date();
    await store.update((data) => {
      const state = data.notificationSchedulerState || {};
      if (state.leaseOwner !== owner) return noChange(store, data);
      data.notificationSchedulerState = {
        ...state,
        leaseOwner: "",
        leaseExpiresAt: null,
        updatedAt: now.toISOString()
      };
      return data;
    });
  }

  function start() {
    if (timer) return;
    timer = setIntervalFn(() => void tick(), safeIntervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    queueMicrotask(() => void tick());
  }

  async function stop() {
    if (timer) clearIntervalFn(timer);
    timer = null;
    while (running) await new Promise((resolve) => setTimeout(resolve, 20));
  }

  function health() {
    return { intervalMs: safeIntervalMs, owner: shortToken(owner), running: Boolean(timer), tickInProgress: running };
  }

  return { health, intervalMs: safeIntervalMs, owner, start, stop, tick };
}

function createTaskReminders(data, now, created, diagnostics = {}) {
  const tasks = new Map((Array.isArray(data.workforceTasks) ? data.workforceTasks : [])
    .filter(Boolean).map((task) => [String(task.id || ""), task]));
  for (const assignment of Array.isArray(data.workforceAssignments) ? data.workforceAssignments : []) {
    if (!assignment || isCompletedOrCancelled(assignment.status)) continue;
    const task = tasks.get(String(assignment.taskId || ""));
    if (!task || isCompletedOrCancelled(task.status) || normalizeLookup(task.status) === "archived") continue;
    const personId = String(assignment.userId || assignment.personId || assignment.personnelId || "").trim();
    if (!personId) continue;
    const dueAt = taskDueDate(task);
    if (!dueAt) {
      if (task.dueAt || task.dueDate) diagnostics.invalidTaskDates = Number(diagnostics.invalidTaskDates || 0) + 1;
      continue;
    }
    const remainingMs = dueAt.getTime() - now.getTime();
    const preferences = getNotificationPreferences(data, "personnel", personId);
    const scheduleToken = shortToken(dueAt.toISOString());
    const base = {
      recipientRole: "personnel",
      recipientId: personId,
      category: "task",
      entityType: "task",
      entityId: String(task.id || ""),
      deepLink: `/personel/?section=tasks&taskId=${encodeURIComponent(String(task.id || ""))}`,
      metadata: { dueAt: dueAt.toISOString(), taskTitle: String(task.title || "") }
    };
    if (remainingMs > 2 * HOUR_MS && remainingMs <= 24 * HOUR_MS && preferences.taskReminder24h) {
      addNotification(data, created, {
        ...base,
        eventType: "task_reminder_24h",
        title: "Görevin teslim tarihi yaklaşıyor",
        body: `${String(task.title || "Atanmış görev")} 24 saat içinde tamamlanmalı.`,
        severity: "warning",
        dedupeKey: `task-reminder-24h:${task.id}:${personId}:${scheduleToken}`
      }, now);
    }
    if (remainingMs > 0 && remainingMs <= 2 * HOUR_MS && preferences.taskReminder2h) {
      addNotification(data, created, {
        ...base,
        eventType: "task_reminder_2h",
        title: "Görevin için son 2 saat",
        body: `${String(task.title || "Atanmış görev")} için teslim zamanı yaklaştı.`,
        severity: "warning",
        dedupeKey: `task-reminder-2h:${task.id}:${personId}:${scheduleToken}`
      }, now);
    }
    if (remainingMs <= 0 && preferences.overdueReminder) {
      addNotification(data, created, {
        ...base,
        eventType: "task_overdue",
        title: "Görevin süresi geçti",
        body: `${String(task.title || "Atanmış görev")} görevinin teslim süresi geçti.`,
        severity: "critical",
        dedupeKey: `task-overdue:${task.id}:${personId}:${scheduleToken}`
      }, now);
    }
  }
}

function processScheduledNotifications(data, now, created) {
  const schedules = Array.isArray(data.scheduledNotifications) ? data.scheduledNotifications : [];
  let executed = 0;
  for (const schedule of schedules) {
    if (!schedule || schedule.status === "executed" || schedule.executedAt || schedule.kind !== "stock_critical_snapshot") continue;
    const scheduledAt = validDate(schedule.scheduledAt);
    if (!scheduledAt || scheduledAt > now) continue;
    const snapshot = criticalStockSnapshot(data);
    const title = String(schedule.title || "Kritik stok kontrolü").trim().slice(0, 120) || "Kritik stok kontrolü";
    const note = String(schedule.note || "").trim().slice(0, 500);
    const summary = snapshot.items.length
      ? `${snapshot.items.length} stok kalemi eşik altında: ${snapshot.items.slice(0, 4).map((item) => `${item.productName} (${item.locationName}: ${item.quantity} ${item.unit})`).join(", ")}${snapshot.items.length > 4 ? ` ve ${snapshot.items.length - 4} kalem daha` : ""}.`
      : "Şu anda kritik veya sipariş eşiğinde stok kalemi bulunmuyor.";
    const baseRule = resolveNotificationRule(data, "stock_scheduled_snapshot");
    const rule = {
      ...baseRule,
      id: "scheduled_stock_snapshot",
      label: "Planlı kritik stok kontrolü",
      enabled: true,
      timed: false,
      timing: "immediate",
      mergeSimilar: false,
      repeatIntervalMinutes: 0,
      repeatMax: 0,
      nextScheduledAt: null,
      channels: { ...(baseRule.channels || {}), inApp: true }
    };
    const result = createNotificationInStore(data, {
      recipientRole: "manager",
      recipientId: "manager",
      category: "stock",
      eventType: "stock_scheduled_snapshot",
      title,
      body: note ? `${note} ${summary}` : summary,
      severity: snapshot.hasCritical ? "critical" : snapshot.items.length ? "warning" : "info",
      entityType: "scheduled_notification",
      entityId: String(schedule.id || ""),
      deepLink: "/yonetici/?section=locations",
      dedupeKey: `scheduled-stock:${String(schedule.id || "")}`,
      metadata: {
        scheduleId: String(schedule.id || ""),
        scheduledAt: scheduledAt.toISOString(),
        criticalItemCount: snapshot.items.length,
        notificationReason: "Yönetici tarafından planlanan kritik stok kontrolü"
      }
    }, { now, rule, skipRecipientRouting: true, skipMerge: true, forceInApp: true });
    const produced = notificationsFromResult(result);
    if (!produced.length) continue;
    for (const notification of produced) if (!created.includes(notification)) created.push(notification);
    schedule.status = "executed";
    schedule.executedAt = now.toISOString();
    schedule.updatedAt = now.toISOString();
    schedule.notificationId = produced[0].id;
    executed += 1;
  }
  return executed;
}

function criticalStockSnapshot(data) {
  const stockState = normalizeStockState(data.stockState);
  const products = new Map((stockState.products || []).filter((item) => item && item.id && item.active !== false)
    .map((item) => [String(item.id), item]));
  const locations = new Map((stockState.locations || []).filter((item) => item && item.id && item.active !== false)
    .map((item) => [String(item.id), item]));
  const items = [];
  let hasCritical = false;
  for (const balance of stockState.balances || []) {
    if (!balance) continue;
    const product = products.get(String(balance.productId || ""));
    const location = locations.get(String(balance.locationId || ""));
    if (!product || !location) continue;
    const quantity = finiteNumber(balance.quantity);
    const criticalThreshold = finiteNumber(balance.criticalThreshold);
    const orderThreshold = finiteNumber(balance.orderThreshold);
    const critical = criticalThreshold > 0 && quantity <= criticalThreshold;
    const order = !critical && orderThreshold > 0 && quantity <= orderThreshold;
    if (!critical && !order) continue;
    if (critical) hasCritical = true;
    items.push({
      productName: String(product.name || product.productName || "Stok ürünü"),
      locationName: String(location.name || "Stok noktası"),
      quantity,
      unit: String(product.unit || "adet"),
      critical
    });
  }
  items.sort((left, right) => Number(right.critical) - Number(left.critical)
    || left.productName.localeCompare(right.productName, "tr"));
  return { items, hasCritical };
}

function createShiftReminders(data, now, created, diagnostics = {}) {
  for (const plan of Array.isArray(data.workforceShiftPlans) ? data.workforceShiftPlans : []) {
    if (!plan || normalizeLookup(plan.status) !== "published" || isLeaveShift(plan.type)) continue;
    const personId = String(plan.personId || plan.userId || plan.personnelId || "").trim();
    if (!personId) continue;
    const startsAt = shiftStartDate(plan);
    if (!startsAt) {
      if (plan.date || plan.startTime) diagnostics.invalidShiftDates = Number(diagnostics.invalidShiftDates || 0) + 1;
      continue;
    }
    const remainingMs = startsAt.getTime() - now.getTime();
    if (remainingMs <= 0) continue;
    const preferences = getNotificationPreferences(data, "personnel", personId);
    const revision = String(plan.publicationRevision || plan.revision || plan.publishedAt || "published");
    const shiftId = String(plan.id || `${personId}-${plan.date}-${plan.startTime || ""}`);
    const scheduleToken = shortToken(`${startsAt.toISOString()}:${revision}`);
    const shiftText = [String(plan.type || "Vardiya"), formatTimeRange(plan.startTime, plan.endTime)].filter(Boolean).join(" · ");
    const base = {
      recipientRole: "personnel",
      recipientId: personId,
      category: "shift",
      entityType: "shift",
      entityId: shiftId,
      deepLink: `/personel/?section=shift&weekStart=${encodeURIComponent(String(plan.weekStart || ""))}`,
      metadata: { date: plan.date, startTime: plan.startTime || "", endTime: plan.endTime || "", shiftType: plan.type || "", publicationRevision: revision }
    };
    if (remainingMs > 2 * HOUR_MS && remainingMs <= 12 * HOUR_MS && preferences.shiftReminder12h) {
      addNotification(data, created, {
        ...base,
        eventType: "shift_reminder_12h",
        title: "Vardiyan 12 saat içinde başlıyor",
        body: `${formatTurkishDate(plan.date)} · ${shiftText}`,
        severity: "info",
        dedupeKey: `shift-reminder-12h:${shiftId}:${personId}:${scheduleToken}`
      }, now);
    }
    if (remainingMs <= 2 * HOUR_MS && preferences.shiftReminder2h) {
      addNotification(data, created, {
        ...base,
        eventType: "shift_reminder_2h",
        title: "Vardiyan 2 saat içinde başlıyor",
        body: `${formatTurkishDate(plan.date)} · ${shiftText}`,
        severity: "warning",
        dedupeKey: `shift-reminder-2h:${shiftId}:${personId}:${scheduleToken}`
      }, now);
    }
  }
}

function createCriticalStockNotifications(data, now, created) {
  const state = data.notificationSchedulerState || (data.notificationSchedulerState = {});
  const previousStates = state.criticalStockState && typeof state.criticalStockState === "object"
    ? state.criticalStockState : {};
  const nextStates = {};
  let stateChanged = false;
  const stockState = normalizeStockState(data.stockState);
  const locations = (stockState.locations || []).filter((location) => location && location.active !== false);
  const balancesByKey = new Map((stockState.balances || []).filter(Boolean).map((balance) => [
    `${String(balance.locationId)}\u0000${String(balance.productId)}`, balance
  ]));
  const general = locations.find((location) => location.code === "GENEL" || location.type === "central") || null;

  for (const location of locations) {
    for (const product of stockState.products || []) {
      if (!product || !product.id || product.active === false) continue;
      const balance = balancesByKey.get(`${location.id}\u0000${product.id}`) || {};
      const quantity = finiteNumber(balance.quantity);
      const criticalThreshold = finiteNumber(balance.criticalThreshold);
      const orderThreshold = finiteNumber(balance.orderThreshold);
      const generalBalance = general ? balancesByKey.get(`${general.id}\u0000${product.id}`) || {} : {};
      const generalQuantity = finiteNumber(generalBalance.quantity);
      let kind = "ok";
      let threshold = 0;
      if (criticalThreshold > 0 && quantity <= criticalThreshold) {
        kind = location.type === "central" ? "procurement" : "critical";
        threshold = criticalThreshold;
      } else if (orderThreshold > 0 && quantity <= orderThreshold) {
        kind = location.type === "workshop" && generalQuantity > 0 ? "transfer" : "procurement";
        threshold = orderThreshold;
      }

      const id = `${location.id}:${product.id}`;
      const previous = previousStates[id] && typeof previousStates[id] === "object" ? previousStates[id] : {};
      const revision = Math.max(0, Number(previous.revision || 0)) + (kind !== "ok" && previous.kind !== kind ? 1 : 0);
      const same = previous.kind === kind
        && Number(previous.revision || 0) === revision
        && Number(previous.quantity) === quantity
        && Number(previous.threshold) === threshold
        && Number(previous.generalQuantity) === generalQuantity;
      nextStates[id] = same ? previous : { kind, revision, quantity, threshold, generalQuantity, updatedAt: now.toISOString() };
      if (!same) stateChanged = true;
      if (kind === "ok" || previous.kind === kind) continue;

      const title = kind === "transfer"
        ? "Bakım atölyesi için transfer önerisi"
        : kind === "procurement" ? "Genel depoda tedarik ihtiyacı" : "Bakım atölyesinde kritik stok";
      const body = kind === "transfer"
        ? `${String(product.name || product.productName || "Stok ürünü")} ${String(location.name || "Bakım Atölyesi")} için eşik altına düştü; Genel Depoda ${generalQuantity} ${String(product.unit || "adet")} bulunuyor.`
        : `${String(product.name || product.productName || "Stok ürünü")} ${String(location.name || "Stok noktası")} için ${quantity} ${String(product.unit || "adet")} seviyesine düştü.`;
      addNotification(data, created, {
        recipientRole: "manager", recipientId: "manager", category: "stock",
        eventType: `stock_${kind}`, title, body,
        severity: kind === "critical" ? "critical" : "warning",
        entityType: "stock_balance", entityId: id,
        deepLink: `/yonetici/?section=locations&locationId=${encodeURIComponent(location.id)}&productId=${encodeURIComponent(product.id)}`,
        dedupeKey: `stock-${kind}:${location.id}:${product.id}:${revision}`,
        metadata: {
          productName: String(product.name || product.productName || ""), locationId: location.id,
          locationName: String(location.name || ""), quantity, threshold, generalQuantity, unit: String(product.unit || "")
        }
      }, now);
    }
  }
  if (Object.keys(previousStates).some((id) => !Object.prototype.hasOwnProperty.call(nextStates, id))) stateChanged = true;
  if (stateChanged) state.criticalStockState = nextStates;
  return stateChanged;
}

function createProcurementPaymentReminders(data, now, created) {
  const procurement = data.procurement && typeof data.procurement === "object" ? data.procurement : {};
  const entries = Array.isArray(procurement.ledgerEntries) ? procurement.ledgerEntries : [];
  const reversals = new Set(entries.filter((entry) => entry && entry.reversalOf).map((entry) => String(entry.reversalOf)));
  const balances = new Map();
  for (const entry of entries) {
    if (!entry || !entry.supplierId) continue;
    const supplierId = String(entry.supplierId);
    balances.set(supplierId, (balances.get(supplierId) || 0) + Number(entry.amountKurus || 0));
  }
  const suppliers = new Map((Array.isArray(procurement.suppliers) ? procurement.suppliers : [])
    .map((supplier) => [String(supplier.id || ""), supplier]));
  const dueSoonDays = Math.max(1, Math.min(90, Number(procurement.settings && procurement.settings.dueSoonDays || 7)));
  const today = dateKeyInIstanbul(now);
  const todayStart = validDate(`${today}T00:00:00+03:00`);
  for (const entry of entries) {
    if (!entry || entry.type !== "invoice" || !entry.id || reversals.has(String(entry.id)) || !entry.dueDate) continue;
    if ((balances.get(String(entry.supplierId)) || 0) >= 0) continue;
    const due = validDate(`${entry.dueDate}T00:00:00+03:00`);
    if (!due || !todayStart) continue;
    const remainingDays = Math.floor((due.getTime() - todayStart.getTime()) / (24 * HOUR_MS));
    if (remainingDays > dueSoonDays) continue;
    const overdue = remainingDays < 0;
    const supplier = suppliers.get(String(entry.supplierId));
    addNotification(data, created, {
      recipientRole: "manager", recipientId: "manager", category: "shipment",
      eventType: overdue ? "payment_overdue" : "payment_due_soon",
      title: overdue ? "Tedarikçi ödemesi gecikti" : "Tedarikçi ödeme vadesi yaklaşıyor",
      body: `${String(supplier && supplier.name || "Tedarikçi")} · Vade: ${String(entry.dueDate)}`,
      severity: overdue ? "critical" : "warning", entityType: "ledger_entry", entityId: String(entry.id),
      deepLink: `/yonetici/?section=procurementLedger&procurementView=ledger&entityId=${encodeURIComponent(String(entry.id))}`,
      dedupeKey: `procurement-${overdue ? "overdue" : "due-soon"}:${entry.id}:${entry.dueDate}`,
      metadata: { supplierId: String(entry.supplierId), dueDate: String(entry.dueDate), amountKurus: Number(entry.amountKurus || 0) }
    }, now);
  }
}

function createManagerPendingReminders(data, now, created) {
  const shiftRequests = (Array.isArray(data.workforceShiftRequests) ? data.workforceShiftRequests : [])
    .filter((item) => item && normalizeLookup(item.status) === "onay bekliyor").length;
  const period = dateKeyInIstanbul(now);
  const dedupeKey = `manager-pending:${period}`;
  const existing = (Array.isArray(data.notifications) ? data.notifications : [])
    .filter((item) => item && !item.deletedAt && item.recipientRole === "manager"
      && item.recipientId === "manager" && new RegExp(`^manager-pending:${period}(?::\\d+)?$`).test(String(item.dedupeKey || "")))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))[0];
  if (existing) {
    const title = shiftRequests ? "Bekleyen vardiya talepleri var" : "Vardiya talepleri işlendi";
    const body = shiftRequests ? `${shiftRequests} vardiya/izin talebi karar bekliyor.` : "Bekleyen vardiya/izin talebi kalmadı.";
    if (existing.body === body && existing.title === title && existing.dedupeKey === dedupeKey) return null;
    existing.body = body;
    existing.title = title;
    existing.dedupeKey = dedupeKey;
    existing.updatedAt = now.toISOString();
    data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
    data.revisions.notification = Math.max(0, Number(data.revisions.notification || 0)) + 1;
    existing.revision = data.revisions.notification;
    if (!shiftRequests) for (const item of data.notificationOutbox || []) {
      if (!item || item.notificationId !== existing.id || !["pending", "processing"].includes(item.status) || item.dispatchStartedAt) continue;
      item.status = "cancelled";
      item.nextAttemptAt = null;
      item.lockedAt = null;
      item.lockedBy = "";
      item.lastError = "Bekleyen vardiya talebi kalmadı.";
      item.updatedAt = now.toISOString();
    }
    return existing;
  }
  if (!shiftRequests) return null;
  addNotification(data, created, {
    recipientRole: "manager",
    recipientId: "manager",
    category: "system",
    eventType: "pending_workforce_actions",
    title: "Bekleyen vardiya talepleri var",
    body: `${shiftRequests} vardiya/izin talebi karar bekliyor.`,
    severity: "warning",
    entityType: "workforce",
    entityId: "pending",
    deepLink: "/yonetici/?section=staffAccess&workforce=shifts",
    dedupeKey
  }, now);
  return null;
}

function addNotification(data, created, input, now) {
  const notification = createNotificationInStore(data, input, { now });
  for (const item of notificationsFromResult(notification)) if (!created.includes(item)) created.push(item);
}

function processNotificationDigests(data, now, created) {
  let changed = 0;
  const nowMs = now.getTime();
  const pending = (Array.isArray(data.notifications) ? data.notifications : []).filter((item) => item
    && item.metadata && item.metadata.digestPending === true && !item.metadata.digestProcessedAt
    && Number.isFinite(Date.parse(item.deliveryNotBefore || item.metadata.digestDueAt || ""))
    && Date.parse(item.deliveryNotBefore || item.metadata.digestDueAt) <= nowMs);
  const groups = new Map();
  for (const item of pending) {
    const dueAt = String(item.deliveryNotBefore || item.metadata.digestDueAt || "");
    const key = `${item.recipientRole}\u0000${item.recipientId}\u0000${item.ruleId || item.metadata.ruleId}\u0000${dueAt}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const items of groups.values()) {
    const valid = [];
    for (const item of items) {
      const reason = pendingDeliveryInvalidReason(data, {
        notificationId: item.id, recipientRole: item.recipientRole, recipientId: item.recipientId, channel: ""
      }, now);
      if (reason) {
        item.metadata.digestProcessedAt = now.toISOString();
        item.metadata.digestSkipReason = reason;
        changed += 1;
      } else valid.push(item);
    }
    if (!valid.length) continue;
    const first = valid[0];
    const rule = resolveNotificationRule(data, first.eventType);
    const dueAt = String(first.deliveryNotBefore || first.metadata.digestDueAt || now.toISOString());
    const relatedRecords = valid.map((item) => ({
      entityType: item.entityType || "", entityId: item.entityId || "", deepLink: item.deepLink || "", title: item.title || "Bildirim"
    }));
    const categoryCounts = valid.reduce((counts, item) => {
      counts[item.category] = Number(counts[item.category] || 0) + 1;
      return counts;
    }, {});
    const summary = createNotificationInStore(data, {
      recipientRole: first.recipientRole,
      recipientId: first.recipientId,
      category: first.category,
      eventType: first.eventType,
      title: `${valid.length} olay · ${rule.label}`,
      body: digestBody(categoryCounts, valid.length),
      severity: digestSeverity(valid),
      entityType: "notification-digest",
      entityId: `${rule.id}:${dueAt}`,
      deepLink: first.deepLink || (first.recipientRole === "manager" ? "/yonetici/?section=settings" : "/personel/?section=profile"),
      dedupeKey: `digest:${rule.id}:${first.recipientRole}:${first.recipientId}:${dueAt}`,
      metadata: {
        digestSummary: true,
        digestTiming: first.metadata.digestTiming || rule.timing,
        digestDueAt: dueAt,
        digestSourceIds: valid.map((item) => item.id),
        digestCount: valid.length,
        relatedRecords,
        categoryCounts
      }
    }, { now, rule, skipRecipientRouting: true, digestSummary: true, skipMerge: true });
    const summaryItems = notificationsFromResult(summary);
    for (const item of summaryItems) if (!created.includes(item)) created.push(item);
    const existing = summary || (data.notifications || []).find((item) => item
      && item.dedupeKey === `digest:${rule.id}:${first.recipientRole}:${first.recipientId}:${dueAt}`);
    if (!existing) continue;
    for (const item of valid) {
      item.metadata.digestProcessedAt = now.toISOString();
      item.metadata.digestNotificationId = existing.id;
      changed += 1;
    }
  }
  return changed;
}

function processNotificationRepeats(data, now, created) {
  let changed = 0;
  for (const source of [...(Array.isArray(data.notifications) ? data.notifications : [])]) {
    const metadata = source && source.metadata;
    if (!source || !metadata || !metadata.nextRepeatAt || metadata.repeatAdvancedAt || metadata.repeatStoppedAt
      || Date.parse(metadata.nextRepeatAt) > now.getTime()) continue;
    const rule = resolveNotificationRule(data, source.eventType);
    const repeatCount = Math.max(0, Math.trunc(Number(metadata.repeatCount || 0)));
    if (!rule.enabled || !rule.timed || rule.timing !== "immediate" || Number(rule.repeatIntervalMinutes || 0) < 1
      || Number(rule.repeatMax || 0) <= repeatCount) {
      metadata.nextRepeatAt = null;
      metadata.repeatStoppedAt = now.toISOString();
      metadata.repeatStopReason = "Tekrar kuralı kapalı veya azami tekrar sayısına ulaştı.";
      changed += 1;
      continue;
    }
    const invalid = pendingDeliveryInvalidReason(data, {
      notificationId: source.id, recipientRole: source.recipientRole, recipientId: source.recipientId, channel: ""
    }, now);
    if (invalid) {
      metadata.nextRepeatAt = null;
      metadata.repeatStoppedAt = now.toISOString();
      metadata.repeatStopReason = invalid;
      changed += 1;
      continue;
    }
    const nextCount = repeatCount + 1;
    const root = String(metadata.repeatRootId || source.id).slice(0, 240);
    const notification = createNotificationInStore(data, {
      recipientRole: source.recipientRole,
      recipientId: source.recipientId,
      category: source.category,
      eventType: source.eventType,
      title: source.title,
      body: source.body,
      severity: source.severity,
      entityType: source.entityType,
      entityId: source.entityId,
      deepLink: source.deepLink,
      appTarget: source.appTarget,
      dedupeKey: `repeat:${root}:${nextCount}`,
      metadata: {
        ...metadata,
        repeatRootId: root,
        repeatCount: nextCount,
        repeatedFromNotificationId: source.id,
        nextRepeatAt: undefined,
        repeatAdvancedAt: undefined,
        repeatStoppedAt: undefined,
        repeatStopReason: undefined
      }
    }, { now, rule, skipRecipientRouting: true, skipMerge: true });
    const produced = notificationsFromResult(notification);
    for (const item of produced) if (!created.includes(item)) created.push(item);
    const existing = notification || (data.notifications || []).find((item) => item
      && item.dedupeKey === `repeat:${root}:${nextCount}`
      && item.recipientRole === source.recipientRole && String(item.recipientId) === String(source.recipientId));
    if (existing) {
      metadata.nextRepeatAt = null;
      metadata.repeatAdvancedAt = now.toISOString();
      metadata.repeatNotificationId = existing.id;
      changed += 1;
    }
  }
  return changed;
}

function digestBody(counts, total) {
  const labels = { task: "görev", shift: "vardiya", feedback: "geri bildirim", system: "sistem" };
  const parts = Object.entries(counts).map(([category, count]) => `${count} ${labels[category] || "olay"}`);
  return `${parts.join(" · ") || `${total} olay`} tek özette toplandı.`;
}

function digestSeverity(items) {
  const ranks = { info: 0, success: 1, warning: 2, critical: 3 };
  return items.reduce((current, item) => ranks[item.severity] > ranks[current] ? item.severity : current, "info");
}

function taskDueDate(task) {
  const value = task && (task.dueAt || (task.dueDate ? `${task.dueDate}T${task.dueTime || "23:59"}:00+03:00` : ""));
  return validDate(value);
}

function shiftStartDate(plan) {
  if (!plan || !/^\d{4}-\d{2}-\d{2}$/.test(String(plan.date || ""))) return null;
  const time = /^\d{2}:\d{2}$/.test(String(plan.startTime || "")) ? plan.startTime : defaultShiftStart(plan.type);
  return validDate(`${plan.date}T${time}:00+03:00`);
}

function defaultShiftStart(type) {
  const key = normalizeLookup(type);
  if (key.includes("aksam")) return "16:00";
  if (key.includes("sabah")) return "08:00";
  return "";
}

function isLeaveShift(type) {
  const key = normalizeLookup(type);
  return ["izin", "izinli", "leave", "off", "unassigned"].some((value) => key === value || key.includes(value));
}

function isCompletedOrCancelled(status) {
  const key = normalizeLookup(status);
  return ["completed", "tamamlandi", "cancelled", "canceled", "iptal edildi", "iptal"].includes(key);
}

function dateKeyInIstanbul(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(value);
}

function formatTurkishDate(value) {
  const date = validDate(`${value}T12:00:00+03:00`);
  return date ? new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "numeric", month: "long"
  }).format(date) : String(value || "");
}

function formatTimeRange(start, end) {
  return start && end ? `${start}–${end}` : String(start || "");
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function shortToken(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 12);
}

function normalizeLookup(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
}

function previewSchedulerChanges(data, now) {
  const state = data.notificationSchedulerState && typeof data.notificationSchedulerState === "object"
    ? data.notificationSchedulerState
    : {};
  const preview = {
    ...data,
    notifications: (Array.isArray(data.notifications) ? data.notifications : []).map((item) => item && {
      ...item,
      metadata: item.metadata && typeof item.metadata === "object" ? structuredClone(item.metadata) : {}
    }),
    notificationOutbox: (Array.isArray(data.notificationOutbox) ? data.notificationOutbox : []).map((item) => item && { ...item }),
    notificationDedupe: [...(Array.isArray(data.notificationDedupe) ? data.notificationDedupe : [])],
    scheduledNotifications: (Array.isArray(data.scheduledNotifications) ? data.scheduledNotifications : []).map((item) => item && { ...item }),
    revisions: { ...(data.revisions || {}) },
    notificationSchedulerState: {
      ...state,
      criticalStockState: structuredClone(state.criticalStockState || {})
    }
  };
  const created = [];
  const notificationStateChanges = processScheduledNotifications(preview, now, created)
    + processNotificationDigests(preview, now, created)
    + processNotificationRepeats(preview, now, created);
  createTaskReminders(preview, now, created, {});
  createShiftReminders(preview, now, created, {});
  const stockStateChanged = createCriticalStockNotifications(preview, now, created);
  createProcurementPaymentReminders(preview, now, created);
  const managerUpdated = createManagerPendingReminders(preview, now, created);
  return created.length > 0 || Boolean(managerUpdated) || notificationStateChanges > 0 || stockStateChanged;
}

function noChange(store, data) {
  return store && typeof store.noChange === "function" ? store.noChange() : data;
}

function safeSchedulerError(error) {
  return { name: String(error && error.name || "Error"), message: String(error && error.message || "").slice(0, 300) };
}

module.exports = {
  createCriticalStockNotifications,
  createNotificationScheduler,
  createProcurementPaymentReminders,
  createShiftReminders,
  createTaskReminders,
  dateKeyInIstanbul,
  processNotificationDigests,
  processNotificationRepeats,
  processScheduledNotifications
};
