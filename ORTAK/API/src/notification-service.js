"use strict";

const crypto = require("crypto");
const { EventEmitter } = require("events");
const { normalizeAppTarget, notificationAppTargets, safeAppDeepLink } = require("./app-targets");
const { hasSectionAccess } = require("./procurement-access");
const { hasPersonelSectionAccess } = require("./personel-section-access");
const {
  POLICY_VERSION,
  RULE_DEFINITIONS,
  nextDeliveryAt,
  normalizeNotificationRules,
  resolveNotificationRule
} = require("./notification-policy");

const NOTIFICATION_CATEGORIES = Object.freeze(["system", "feedback", "task", "shift", "materialRequest", "shipment", "stock"]);
const NOTIFICATION_SEVERITIES = Object.freeze(["info", "success", "warning", "critical"]);
const MAX_NOTIFICATIONS = 10000;
const MAX_OUTBOX_ITEMS = 20000;
const DEDUPE_RETENTION_MS = 730 * 24 * 60 * 60 * 1000;
const MERGE_WINDOW_MS = 15 * 60 * 1000;
const CREATED_NOTIFICATIONS = Symbol("createdNotifications");

const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(500);

function createNotificationInStore(data, input, options = {}) {
  if (!data || typeof data !== "object") throw new TypeError("Bildirim için geçerli store verisi gerekli.");
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rule = options.rule || resolveNotificationRule(data, normalizeEventType(source.eventType));
  const mandatory = isMandatoryNotification({
    category: normalizeNotificationCategory(source.category),
    eventType: normalizeEventType(source.eventType),
    severity: source.severity === "error" ? "critical" : source.severity
  });
  const targets = options.skipRecipientRouting || mandatory
    ? [{ recipientRole: source.recipientRole, recipientId: source.recipientId }]
    : notificationRecipientTargets(data, source, rule);
  const created = [];
  for (const target of targets) {
    const notification = createSingleNotificationInStore(data, { ...source, ...target }, { ...options, rule });
    if (notification && !created.includes(notification)) created.push(notification);
  }
  if (!created.length) return null;
  Object.defineProperty(created[0], CREATED_NOTIFICATIONS, { value: created, configurable: true });
  return created[0];
}

function notificationsFromResult(value) {
  return value && Array.isArray(value[CREATED_NOTIFICATIONS]) ? [...value[CREATED_NOTIFICATIONS]] : value ? [value] : [];
}

function createSingleNotificationInStore(data, input, options = {}) {
  const normalized = normalizeNotificationInput(input, options);
  // Kaldırılmış modüller yeni kayıt veya teslim kuyruğu üretmez; geçmiş korunur.
  if (isRetiredNotificationCategory(normalized.category, normalized.eventType)) return null;
  data.notifications = Array.isArray(data.notifications) ? data.notifications : [];
  data.notificationPreferences = Array.isArray(data.notificationPreferences) ? data.notificationPreferences : [];
  data.notificationOutbox = Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [];
  data.pushSubscriptions = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];
  data.notificationDedupe = Array.isArray(data.notificationDedupe)
    ? data.notificationDedupe : normalizeNotificationDedupe([], data.notifications, data, options.now);

  const mandatory = isMandatoryNotification(normalized);
  const rule = options.rule || resolveNotificationRule(data, normalized.eventType);
  if (!mandatory && (!rule.enabled || rule.timing === "off")) return null;
  const createdAt = normalized.createdAt || nowIso(options.now);

  if (normalized.dedupeKey && !options.force) {
    const fingerprint = notificationDedupeFingerprint(normalized.recipientRole, normalized.recipientId, normalized.dedupeKey);
    if (data.notificationDedupe.some((item) => item.fingerprint === fingerprint)) return null;
    const duplicate = data.notifications.find((item) => item
      && item.recipientRole === normalized.recipientRole
      && String(item.recipientId) === normalized.recipientId
      && canonicalNotificationDedupeKey(item.dedupeKey) === canonicalNotificationDedupeKey(normalized.dedupeKey));
    if (duplicate) return null;
  }

  if (!mandatory && !options.digestSummary && !options.skipMerge && rule.mergeSimilar !== false
    && rule.timing === "immediate" && !normalized.metadata.repeatRootId) {
    const merged = mergeSimilarNotification(data, normalized, rule, createdAt);
    if (merged) return merged;
  }

  const preference = getNotificationPreferences(data, normalized.recipientRole, normalized.recipientId);
  const categoryEnabled = preferenceCategoryEnabled(preference, normalized.category);
  const digestPending = !mandatory && !options.digestSummary && ["daily", "weekly"].includes(rule.timing);
  const deliveryNotBefore = mandatory || options.digestSummary ? createdAt : nextDeliveryAt(rule, createdAt);
  const inAppRequested = !digestPending && (options.forceInApp === true || mandatory
    || (rule.channels.inApp && preference.inAppEnabled !== false && categoryEnabled));
  const inAppLimited = !mandatory && inAppRequested
    && notificationChannelDailyLimitReached(data, normalized, rule, "inApp", createdAt);
  const soundRequested = !digestPending && !mandatory && inAppRequested && !inAppLimited && rule.channels.sound
    && Date.parse(deliveryNotBefore || createdAt) <= Date.parse(createdAt) + 500;
  const soundLimited = soundRequested
    && notificationChannelDailyLimitReached(data, normalized, rule, "sound", createdAt);
  const repeatCount = Math.max(0, Math.trunc(Number(normalized.metadata.repeatCount || 0)));
  const repeatEligible = !mandatory && !options.digestSummary && rule.timed === true && rule.timing === "immediate"
    && Number(rule.repeatIntervalMinutes || 0) > 0 && Number(rule.repeatMax || 0) > repeatCount;
  const repeatRootId = String(normalized.metadata.repeatRootId || normalized.dedupeKey
    || `${rule.id}:${normalized.entityType}:${normalized.entityId}:${normalized.recipientId}`).slice(0, 240);
  const repeatBaseAt = Math.max(Date.parse(createdAt), Date.parse(deliveryNotBefore || createdAt));
  const notification = {
    id: normalized.id || `notification-${crypto.randomUUID()}`,
    recipientRole: normalized.recipientRole,
    recipientId: normalized.recipientId,
    category: normalized.category,
    eventType: normalized.eventType,
    title: normalized.title,
    body: normalized.body,
    severity: normalized.severity,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    deepLink: normalized.deepLink,
    appTarget: normalized.appTarget,
    createdAt,
    updatedAt: createdAt,
    readAt: null,
    archivedAt: null,
    dedupeKey: normalized.dedupeKey,
    metadata: {
      ...normalized.metadata,
      notificationReason: normalized.metadata.notificationReason || rule.label,
      ruleId: rule.id,
      ruleLabel: rule.label,
      timezone: rule.timezone,
      soundEnabled: Boolean(soundRequested && !soundLimited),
      channelUsage: [],
      ...(digestPending ? { digestPending: true, digestDueAt: deliveryNotBefore, digestTiming: rule.timing } : {}),
      ...(repeatEligible ? {
        repeatRootId,
        repeatCount,
        nextRepeatAt: new Date(repeatBaseAt + Number(rule.repeatIntervalMinutes) * 60 * 1000).toISOString()
      } : {})
    },
    ruleId: rule.id,
    ruleLabel: rule.label,
    notificationReason: normalized.metadata.notificationReason || rule.label,
    deliveryNotBefore,
    inAppVisible: Boolean(inAppRequested && !inAppLimited)
  };
  data.revisions = data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions) ? data.revisions : {};
  data.revisions.notification = Math.max(0, Number(data.revisions.notification || 0)) + 1;
  notification.revision = data.revisions.notification;
  data.notifications.push(notification);
  data.notifications = retainNotifications(data.notifications, MAX_NOTIFICATIONS);
  if (notification.dedupeKey) data.notificationDedupe.push(notificationDedupeEntry(notification));

  if (notification.inAppVisible) notification.metadata.channelUsage.push("inApp");
  else if (inAppLimited) recordDeliveryHistory(data, notification, "inApp", "suppressed", dailyLimitReason(rule, "panel"), options);
  if (notification.metadata.soundEnabled) notification.metadata.channelUsage.push("sound");
  else if (soundLimited) recordDeliveryHistory(data, notification, "sound", "suppressed", dailyLimitReason(rule, "panel sesi"), options);

  if (digestPending) return notification;

  if (categoryEnabled && rule.channels.email && preference.emailEnabled && preference.emailAddress) {
    if (mandatory || !notificationChannelDailyLimitReached(data, normalized, rule, "email", createdAt)) {
      if (enqueueOutbox(data, notification, "email", preference.emailAddress, options)) notification.metadata.channelUsage.push("email");
    } else {
      recordDeliveryHistory(data, notification, "email", "suppressed", dailyLimitReason(rule, "e-posta"), options);
    }
  }
  if (categoryEnabled && rule.channels.push && preference.pushEnabled) {
    const candidates = data.pushSubscriptions.filter((item) => item
      && !item.disabledAt
      && !item.revokedAt
      && normalizeRole(item.ownerRole || item.recipientRole) === notification.recipientRole
      && String(notification.recipientRole === "manager" ? "manager" : item.ownerId || item.recipientId || "") === notification.recipientId);
    const deliveryTargets = new Set(notificationAppTargets(notification));
    const subscriptions = candidates.filter((item) => deliveryTargets.has(normalizeAppTarget(
      item.appId || item.appTarget,
      "",
      notification.recipientRole
    )));
    if (subscriptions.length && (mandatory || !notificationChannelDailyLimitReached(data, normalized, rule, "push", createdAt))) {
      for (const subscription of subscriptions) {
        enqueueOutbox(data, notification, "push", subscription.endpoint, { ...options, subscriptionId: subscription.id });
      }
      notification.metadata.channelUsage.push("push");
    } else if (subscriptions.length) {
      recordDeliveryHistory(data, notification, "push", "suppressed", dailyLimitReason(rule, "push"), options);
    }
  }
  return notification;
}

function canonicalNotificationDedupeKey(value) {
  const key = String(value || "").trim().slice(0, 240);
  return /^manager-pending:\d{4}-\d{2}-\d{2}:\d+$/.test(key) ? key.replace(/:\d+$/, "") : key;
}

function notificationDedupeFingerprint(role, id, key) {
  return crypto.createHash("sha256")
    .update(`${normalizeRole(role)}\u0000${normalizeRole(role) === "manager" ? "manager" : String(id || "")}\u0000${canonicalNotificationDedupeKey(key)}`)
    .digest("hex");
}

function notificationDedupeEntry(notification) {
  const createdAt = nowIso(notification.createdAt);
  const eventType = normalizeEventType(notification.eventType);
  const metadata = notification.metadata && typeof notification.metadata === "object" ? notification.metadata : {};
  const scheduledAt = Date.parse(eventType.startsWith("shift_reminder_")
    ? `${metadata.date || ""}T${metadata.startTime || ""}:00+03:00`
    : metadata.dueAt || "");
  const period = /^manager-pending:(\d{4}-\d{2}-\d{2})$/.exec(canonicalNotificationDedupeKey(notification.dedupeKey));
  const expiresAt = period
    ? new Date(Date.parse(`${period[1]}T00:00:00+03:00`) + 8 * 24 * 60 * 60 * 1000).toISOString()
    : eventType === "task_overdue" ? null
      : Number.isFinite(scheduledAt) ? new Date(scheduledAt + 90 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.parse(createdAt) + DEDUPE_RETENTION_MS).toISOString();
  return {
    fingerprint: notificationDedupeFingerprint(notification.recipientRole, notification.recipientId, notification.dedupeKey),
    recipientRole: normalizeRole(notification.recipientRole),
    recipientId: normalizeRole(notification.recipientRole) === "manager" ? "manager" : String(notification.recipientId || "").slice(0, 160),
    eventType,
    entityType: String(notification.entityType || "").slice(0, 100),
    entityId: String(notification.entityId || "").slice(0, 180),
    createdAt,
    expiresAt
  };
}

function normalizeNotificationDedupe(value, notifications = [], data = {}, nowValue) {
  const now = new Date(nowValue === undefined ? Date.now() : nowValue).getTime();
  const records = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    if (!item || !/^[a-f0-9]{64}$/.test(String(item.fingerprint || ""))) continue;
    const role = normalizeRole(item.recipientRole);
    const id = role === "manager" ? "manager" : String(item.recipientId || "").trim().slice(0, 160);
    if (!role || !id) continue;
    const entry = {
      fingerprint: String(item.fingerprint), recipientRole: role, recipientId: id,
      eventType: normalizeEventType(item.eventType), entityType: String(item.entityType || "").slice(0, 100),
      entityId: String(item.entityId || "").slice(0, 180), createdAt: nowIso(item.createdAt),
      expiresAt: item.expiresAt ? nowIso(item.expiresAt) : null
    };
    if (!isExpiredDedupe(entry, data, now)) records.set(entry.fingerprint, entry);
  }
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || !notification.dedupeKey) continue;
    const entry = notificationDedupeEntry(notification);
    if (!isExpiredDedupe(entry, data, now) && !records.has(entry.fingerprint)) records.set(entry.fingerprint, entry);
  }
  return [...records.values()];
}

function isExpiredDedupe(entry, data, now) {
  if (entry.eventType === "task_overdue") {
    const task = (Array.isArray(data.workforceTasks) ? data.workforceTasks : []).find((item) => item && String(item.id) === entry.entityId);
    const active = task && !/^(completed|cancelled|canceled|archived|tamamland[ıi]|iptal)/i.test(String(task.status || ""));
    if (active) return false;
    return now > Date.parse(entry.createdAt) + 90 * 24 * 60 * 60 * 1000;
  }
  return Boolean(entry.expiresAt && now > Date.parse(entry.expiresAt));
}

function createNotificationsInStore(data, inputs, options = {}) {
  const created = [];
  for (const input of Array.isArray(inputs) ? inputs : []) {
    const notification = createNotificationInStore(data, input, options);
    for (const item of notificationsFromResult(notification)) if (!created.includes(item)) created.push(item);
  }
  return created;
}

function notificationRecipientTargets(data, source, rule) {
  if (!rule || rule.recipientScope === "manager") return [{ recipientRole: "manager", recipientId: "manager" }];
  if (rule.recipientScope === "direct") {
    const role = normalizeRole(source && source.recipientRole);
    const id = role === "manager" ? "manager" : String(source && source.recipientId || "").trim();
    return role && id ? [{ recipientRole: role, recipientId: id }] : [];
  }
  const users = (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
    .filter((user) => activePersonnelForRule(user, rule));
  if (rule.recipientMode === "all_active_personnel") {
    return users.map((user) => ({ recipientRole: "personnel", recipientId: String(user.id) }));
  }
  if (rule.recipientMode === "selected_personnel") {
    const selected = new Set(Array.isArray(rule.selectedPersonnelIds) ? rule.selectedPersonnelIds.map(String) : []);
    return users.filter((user) => selected.has(String(user.id)))
      .map((user) => ({ recipientRole: "personnel", recipientId: String(user.id) }));
  }
  const requestedId = String(source && source.recipientId || "").trim();
  const user = users.find((item) => String(item.id) === requestedId);
  return user ? [{ recipientRole: "personnel", recipientId: requestedId }] : [];
}

function activePersonnelForRule(user, rule) {
  if (!user || !String(user.id || "").trim() || user.active === false || user.deletedAt || user.archivedAt) return false;
  const access = user.personelSectionAccess && typeof user.personelSectionAccess === "object" ? user.personelSectionAccess : {};
  const section = rule && rule.category === "task" ? "tasks"
    : rule && rule.category === "shift" ? "shift"
      : rule && rule.category === "materialRequest" ? "materialRequest"
        : rule && rule.category === "shipment" ? "shipment"
          : rule && rule.category === "stock" ? "stock" : "recipe";
  return access[section] !== false;
}

function validateManagerNotificationRules(data, value) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : {}) }))
      : [];
  const definitions = new Map(RULE_DEFINITIONS.map((definition) => [definition.id, definition]));
  const users = new Map((Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
    .filter(Boolean).map((user) => [String(user.id || ""), user]));
  for (const entry of entries) {
    const definition = definitions.get(String(entry && entry.id || ""));
    if (!definition) throw notificationPreferenceError("Bilinmeyen bildirim kuralı kaydedilemez.");
    if (entry.recipientMode !== undefined && !definition.allowedRecipientModes.includes(String(entry.recipientMode))) {
      throw notificationPreferenceError("Bildirim kuralı için geçersiz alıcı modu seçildi.");
    }
    const recipientMode = entry.recipientMode === undefined ? definition.allowedRecipientModes[0] : String(entry.recipientMode);
    if (recipientMode !== "selected_personnel") continue;
    const ids = [...new Set((Array.isArray(entry.selectedPersonnelIds) ? entry.selectedPersonnelIds : [])
      .map((id) => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) throw notificationPreferenceError("Seçili personel modunda en az bir aktif personel seçilmelidir.");
    for (const id of ids) {
      const user = users.get(id);
      if (!activePersonnelForRule(user, definition)) {
        throw notificationPreferenceError("Seçilen personel aktif değil veya bu bildirim bölümüne yetkili değil.");
      }
    }
  }
}

function notificationPreferenceError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_NOTIFICATION_RULE";
  return error;
}

function getNotificationPreferences(data, ownerRole, ownerId) {
  const role = normalizeRole(ownerRole);
  const id = role === "manager" ? "manager" : String(ownerId || "").trim();
  const existing = (Array.isArray(data && data.notificationPreferences) ? data.notificationPreferences : [])
    .find((item) => item && normalizeRole(item.ownerRole || item.recipientRole) === role
      && String(role === "manager" ? "manager" : item.ownerId || item.recipientId || "") === id);
  const categories = existing && existing.categories && typeof existing.categories === "object" ? existing.categories : {};
  const reminders = existing && existing.reminders && typeof existing.reminders === "object" ? existing.reminders : {};
  const masterReminder = existing ? legacyFlag(existing.reminderNotifications, categories.reminder, true) : true;
  const verifiedEmail = getVerifiedAccountEmail(data, role, id);
  const managerPreference = (Array.isArray(data && data.notificationPreferences) ? data.notificationPreferences : [])
    .find((item) => item && normalizeRole(item.ownerRole || item.recipientRole) === "manager");
  const allRules = normalizeNotificationRules(managerPreference && managerPreference.rules);
  const visibleRules = role === "manager" ? allRules : allRules.filter((item) => item.recipientScope === "personnel");
  const ruleEnabled = (ruleId) => Boolean(allRules.find((item) => item.id === ruleId && item.enabled && item.timing !== "off"));
  const effectiveMasterReminder = masterReminder && (role === "manager"
    ? ruleEnabled("manager_pending")
    : ["task_reminder_24h", "task_reminder_2h", "task_overdue", "shift_reminder_12h", "shift_reminder_2h"].some(ruleEnabled));
  return {
    ownerRole: role,
    ownerId: id,
    inAppEnabled: existing ? legacyFlag(existing.inAppEnabled, existing.inApp, true) : true,
    pushEnabled: existing ? legacyFlag(existing.pushEnabled, existing.push, false) : false,
    pushVibrationEnabled: existing ? legacyFlag(existing.pushVibrationEnabled, undefined, true) : true,
    emailEnabled: Boolean(verifiedEmail && (existing ? legacyFlag(existing.emailEnabled, existing.email, false) : false)),
    emailAddress: verifiedEmail,
    emailVerified: Boolean(verifiedEmail),
    taskNotifications: preferenceFlag(existing, "taskNotifications", categories.task ?? categories.tasks, true),
    shipmentNotifications: preferenceFlag(existing, "shipmentNotifications", categories.shipment ?? categories.shipments, true),
    stockNotifications: preferenceFlag(existing, "stockNotifications", categories.stock, true),
    shiftNotifications: preferenceFlag(existing, "shiftNotifications", categories.shift ?? categories.shifts, true),
    systemNotifications: preferenceFlag(existing, "systemNotifications", categories.system, true),
    reminderNotifications: effectiveMasterReminder,
    taskReminder24h: ruleEnabled("task_reminder_24h") && preferenceFlag(existing, "taskReminder24h", reminders.task24h, masterReminder),
    taskReminder2h: ruleEnabled("task_reminder_2h") && preferenceFlag(existing, "taskReminder2h", reminders.task2h, masterReminder),
    overdueReminder: ruleEnabled("task_overdue") && preferenceFlag(existing, "overdueReminder", reminders.overdue, masterReminder),
    shiftReminder12h: ruleEnabled("shift_reminder_12h") && preferenceFlag(existing, "shiftReminder12h", reminders.shift12h, masterReminder),
    shiftReminder2h: ruleEnabled("shift_reminder_2h") && preferenceFlag(existing, "shiftReminder2h", reminders.shift2h, masterReminder),
    quietHoursEnabled: existing ? existing.quietHoursEnabled === true || Boolean(existing.quietHours && existing.quietHours.enabled) : false,
    quietHoursStart: normalizeClock(existing && (existing.quietHoursStart || existing.quietHours && existing.quietHours.start), "22:00"),
    quietHoursEnd: normalizeClock(existing && (existing.quietHoursEnd || existing.quietHours && existing.quietHours.end), "08:00"),
    timezone: normalizeTimezone(existing && (existing.timezone || existing.quietHours && existing.quietHours.timezone)),
    policyVersion: POLICY_VERSION,
    rules: visibleRules,
    policyLocks: role === "personnel" ? visibleRules.map((item) => ({
      ruleId: item.id,
      enabled: item.enabled,
      channels: item.channels,
      timing: item.timing
    })) : [],
    updatedAt: existing && existing.updatedAt || null
  };
}

function updateNotificationPreferencesInStore(data, ownerRole, ownerId, input, options = {}) {
  data.notificationPreferences = Array.isArray(data.notificationPreferences) ? data.notificationPreferences : [];
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const current = getNotificationPreferences(data, ownerRole, ownerId);
  const channels = source.channels && typeof source.channels === "object" ? source.channels : {};
  const categories = source.categories && typeof source.categories === "object" ? source.categories : {};
  const reminders = source.reminders && typeof source.reminders === "object" ? source.reminders : {};
  const verifiedEmail = getVerifiedAccountEmail(data, current.ownerRole, current.ownerId);
  const requestedEmailEnabled = booleanValue(source.emailEnabled, booleanValue(channels.email, current.emailEnabled));
  if (requestedEmailEnabled && !verifiedEmail) {
    const error = new Error("E-posta bildirimleri için doğrulanmış hesap e-postası gerekli.");
    error.status = 409;
    error.code = "EMAIL_VERIFICATION_REQUIRED";
    throw error;
  }
  if (current.ownerRole === "manager" && source.rules !== undefined) validateManagerNotificationRules(data, source.rules);
  const masterReminder = booleanValue(source.reminderNotifications, booleanValue(categories.reminder, current.reminderNotifications));
  const masterWasExplicit = typeof source.reminderNotifications === "boolean" || typeof categories.reminder === "boolean";
  const next = {
    ...current,
    inAppEnabled: booleanValue(source.inAppEnabled, booleanValue(channels.inApp, current.inAppEnabled)),
    pushEnabled: booleanValue(source.pushEnabled, booleanValue(channels.push, current.pushEnabled)),
    pushVibrationEnabled: booleanValue(source.pushVibrationEnabled, current.pushVibrationEnabled),
    emailEnabled: Boolean(requestedEmailEnabled && verifiedEmail),
    emailAddress: verifiedEmail,
    emailVerified: Boolean(verifiedEmail),
    taskNotifications: booleanValue(source.taskNotifications, booleanValue(categories.task ?? categories.tasks, current.taskNotifications)),
    shipmentNotifications: booleanValue(source.shipmentNotifications, booleanValue(categories.shipment ?? categories.shipments, current.shipmentNotifications)),
    stockNotifications: booleanValue(source.stockNotifications, booleanValue(categories.stock, current.stockNotifications)),
    shiftNotifications: booleanValue(source.shiftNotifications, booleanValue(categories.shift ?? categories.shifts, current.shiftNotifications)),
    systemNotifications: booleanValue(source.systemNotifications, booleanValue(categories.system, current.systemNotifications)),
    reminderNotifications: masterReminder,
    taskReminder24h: booleanValue(source.taskReminder24h, booleanValue(reminders.task24h, masterWasExplicit ? masterReminder : current.taskReminder24h)),
    taskReminder2h: booleanValue(source.taskReminder2h, booleanValue(reminders.task2h, masterWasExplicit ? masterReminder : current.taskReminder2h)),
    overdueReminder: booleanValue(source.overdueReminder, booleanValue(reminders.overdue, masterWasExplicit ? masterReminder : current.overdueReminder)),
    shiftReminder12h: booleanValue(source.shiftReminder12h, booleanValue(reminders.shift12h, masterWasExplicit ? masterReminder : current.shiftReminder12h)),
    shiftReminder2h: booleanValue(source.shiftReminder2h, booleanValue(reminders.shift2h, masterWasExplicit ? masterReminder : current.shiftReminder2h)),
    quietHoursEnabled: booleanValue(source.quietHoursEnabled, current.quietHoursEnabled),
    quietHoursStart: normalizeClock(source.quietHoursStart, current.quietHoursStart),
    quietHoursEnd: normalizeClock(source.quietHoursEnd, current.quietHoursEnd),
    timezone: normalizeTimezone(source.timezone || current.timezone),
    policyVersion: POLICY_VERSION,
    ...(current.ownerRole === "manager" ? {
      rules: normalizeNotificationRules(source.rules === undefined ? current.rules : source.rules)
    } : {}),
    updatedAt: nowIso(options.now)
  };
  const index = data.notificationPreferences.findIndex((item) => item
    && normalizeRole(item.ownerRole || item.recipientRole) === current.ownerRole
    && String(current.ownerRole === "manager" ? "manager" : item.ownerId || item.recipientId || "") === current.ownerId);
  if (index >= 0) data.notificationPreferences[index] = next;
  else data.notificationPreferences.push(next);
  return next;
}

function publishNotificationEvent(notification) {
  if (!notification || !notification.id
    || isRetiredNotificationCategory(notification.category, notification.eventType)) return;
  notificationEvents.emit("notification", notification);
}

function subscribeNotificationEvents(listener) {
  notificationEvents.on("notification", listener);
  return () => notificationEvents.off("notification", listener);
}

function publishNotificationStateEvent(event) {
  if (!event || !normalizeRole(event.recipientRole) || !event.recipientId) return;
  notificationEvents.emit("state", event);
}

function subscribeNotificationStateEvents(listener) {
  notificationEvents.on("state", listener);
  return () => notificationEvents.off("state", listener);
}

function recipientMatches(notification, role, id) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  const normalizedId = normalizedRole === "manager" ? "manager" : String(id || "").trim();
  if (!normalizedId) return false;
  return Boolean(notification
    && normalizeRole(notification.recipientRole) === normalizedRole
    && String(normalizedRole === "manager" ? "manager" : notification.recipientId) === normalizedId);
}

function normalizeNotificationInput(input, options = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const recipientRole = normalizeRole(source.recipientRole);
  const recipientId = recipientRole === "manager" ? "manager" : String(source.recipientId || "").trim().slice(0, 160);
  const title = String(source.title || "").trim().slice(0, 180);
  if (!recipientRole || !recipientId || !title) {
    const error = new Error("Bildirim alıcısı ve başlığı zorunludur.");
    error.status = 400;
    throw error;
  }
  const appTarget = normalizeAppTarget(source.appTarget, source.deepLink, recipientRole);
  const deepLink = safeAppDeepLink(source.deepLink, appTarget);
  return {
    id: String(source.id || "").trim().slice(0, 180),
    recipientRole,
    recipientId,
    category: normalizeNotificationCategory(source.category),
    eventType: normalizeEventType(source.eventType),
    title,
    body: String(source.body || "").trim().slice(0, 1200),
    severity: source.severity === "error" ? "critical" : NOTIFICATION_SEVERITIES.includes(source.severity) ? source.severity : "info",
    entityType: String(source.entityType || "").trim().slice(0, 100),
    entityId: String(source.entityId || "").trim().slice(0, 180),
    deepLink,
    appTarget,
    createdAt: source.createdAt ? nowIso(source.createdAt) : nowIso(options.now),
    dedupeKey: String(source.dedupeKey || "").trim().slice(0, 240),
    metadata: sanitizeMetadata(source.metadata)
  };
}

function enqueueOutbox(data, notification, channel, destination, options = {}) {
  if (!data || !notification || !["email", "push"].includes(channel)) return null;
  data.notificationOutbox = Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [];
  const recipientRole = normalizeRole(notification.recipientRole);
  const recipientId = recipientRole === "manager" ? "manager" : String(notification.recipientId || "").trim();
  if (!recipientRole || !recipientId) return null;
  const normalizedDestination = channel === "email" ? normalizeEmail(destination) : String(destination || "").trim().slice(0, 2048);
  if (!normalizedDestination) return null;
  const suffix = channel === "push" ? options.subscriptionId || normalizedDestination : "email";
  const dedupeKey = `${notification.id}:${channel}:${suffix}`.slice(0, 240);
  const existing = data.notificationOutbox.find((item) => item
    && item.dedupeKey === dedupeKey
    && item.channel === channel
    && normalizeRole(item.recipientRole) === recipientRole
    && String(recipientRole === "manager" ? "manager" : item.recipientId || "") === recipientId);
  if (existing) return existing;
  const createdAt = notification.createdAt || nowIso(options.now);
  const item = {
    id: `notification-outbox-${crypto.randomUUID()}`,
    notificationId: notification.id,
    channel,
    recipientRole,
    recipientId,
    destination: normalizedDestination,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: options.nextAttemptAt || notification.deliveryNotBefore || createdAt,
    lastAttemptAt: null,
    sentAt: null,
    lastError: "",
    dedupeKey,
    subscriptionId: String(options.subscriptionId || ""),
    ruleId: String(notification.ruleId || notification.metadata && notification.metadata.ruleId || ""),
    localDay: localDateKey(createdAt, notification.metadata && notification.metadata.timezone || "Europe/Istanbul"),
    lockedAt: null,
    lockedBy: "",
    createdAt,
    updatedAt: createdAt
  };
  data.notificationOutbox.push(item);
  data.notificationOutbox = retainOutbox(data.notificationOutbox, MAX_OUTBOX_ITEMS);
  return item;
}

function preferenceCategoryEnabled(preference, category) {
  switch (normalizeNotificationCategory(category)) {
    case "task": return preference.taskNotifications;
    case "shift": return preference.shiftNotifications;
    case "materialRequest": return preference.systemNotifications;
    case "training": return false;
    case "shipment": return preference.shipmentNotifications;
    case "stock": return preference.stockNotifications;
    case "feedback": return preference.systemNotifications;
    default: return preference.systemNotifications;
  }
}

function pendingDeliveryInvalidReason(data, item, nowValue = new Date()) {
  const notification = (Array.isArray(data.notifications) ? data.notifications : []).find((entry) => entry
    && entry.id === item.notificationId
    && normalizeRole(entry.recipientRole) === normalizeRole(item.recipientRole)
    && String(normalizeRole(entry.recipientRole) === "manager" ? "manager" : entry.recipientId || "")
      === String(normalizeRole(item.recipientRole) === "manager" ? "manager" : item.recipientId || ""));
  if (!notification || notification.deletedAt) return "Bildirim kaydı veya alıcısı artık geçerli değil.";
  if (isRetiredNotificationCategory(notification.category, notification.eventType)) return "Kaldırılmış bildirim kategorisi teslim edilmez.";
  const policyRule = resolveNotificationRule(data, notification.eventType);
  if (!isMandatoryNotification(notification) && (!policyRule.enabled || policyRule.timing === "off")) return "Bildirim kuralı yönetici tarafından kapatıldı.";
  if (!isMandatoryNotification(notification) && item.channel && policyRule.channels[item.channel] === false) return `${item.channel} kanalı bildirim kuralında kapatıldı.`;
  if (normalizeRole(item.recipientRole) === "personnel") {
    const user = (data.recipeUsers || []).find((entry) => entry && String(entry.id) === String(item.recipientId));
    if (!user || user.active === false) return "Alıcı personel hesabı aktif değil.";
    if (notification.appTarget === "muhasebe") {
      const actor = {
        type: "personel",
        accessEnabled: user.faturaAccessEnabled !== false,
        role: user.faturaRole,
        template: user.faturaTemplate,
        capabilities: user.faturaCapabilities,
        sectionAccess: user.faturaSectionAccess
      };
      const section = notification.category === "stock" ? "stock"
        : /accounting|payment/.test(notification.eventType) ? "ledger"
          : /document/.test(notification.eventType) ? "documents" : "shipments";
      if (!Array.isArray(user.faturaCapabilities) || !user.faturaCapabilities.length || !hasSectionAccess(actor, section, "view")) {
        return "Alıcının güncel Muhasebe erişimi bulunmuyor.";
      }
      const eventBranch = String(notification.metadata && notification.metadata.branchId || "");
      if (eventBranch && eventBranch !== String(user.branchId || "main")) return "Bildirim alıcının şube kapsamı dışında.";
    }
    if (notification.appTarget === "personel" && ["stock", "shipment"].includes(notification.category)
      && !hasPersonelSectionAccess(user, notification.category)) {
      return "Alıcının ilgili Personel bölümü erişimi bulunmuyor.";
    }
  }
  const preference = getNotificationPreferences(data, item.recipientRole, item.recipientId);
  if (!preferenceCategoryEnabled(preference, notification.category)) return "Bildirim kategorisi alıcı tarafından kapatıldı.";
  const reminderSetting = {
    task_reminder_24h: "taskReminder24h", task_reminder_2h: "taskReminder2h", task_overdue: "overdueReminder",
    shift_reminder_12h: "shiftReminder12h", shift_reminder_2h: "shiftReminder2h"
  }[notification.eventType];
  if (reminderSetting && preference[reminderSetting] === false) return "Zamanlı hatırlatma alıcı tarafından kapatıldı.";
  if (item.channel === "email" && (!preference.emailEnabled || !preference.emailAddress
    || preference.emailAddress !== String(item.destination || "").toLowerCase())) return "E-posta kanalı veya doğrulanmış adres artık geçerli değil.";
  if (item.channel === "push") {
    if (!preference.pushEnabled) return "Push kanalı alıcı tarafından kapatıldı.";
    const subscription = (data.pushSubscriptions || []).find((entry) => entry && !entry.disabledAt && !entry.revokedAt
      && normalizeRole(entry.ownerRole || entry.recipientRole) === normalizeRole(item.recipientRole)
      && String(normalizeRole(item.recipientRole) === "manager" ? "manager" : entry.ownerId || entry.recipientId || "") === String(item.recipientId)
      && (entry.id === item.subscriptionId || entry.endpoint === item.destination));
    if (!subscription) return "Push aboneliği artık geçerli değil.";
  }
  const now = new Date(nowValue).getTime();
  if (notification.eventType === "pending_workforce_actions") {
    const pending = (data.workforceShiftRequests || []).some((entry) => entry && normalizeLookup(entry.status) === "onay bekliyor");
    if (!pending) return "Bekleyen vardiya talebi kalmadı.";
  }
  if (notification.eventType.startsWith("task_reminder_") || notification.eventType === "task_overdue") {
    const task = (data.workforceTasks || []).find((entry) => entry && String(entry.id) === String(notification.entityId));
    const assignment = (data.workforceAssignments || []).find((entry) => entry
      && String(entry.taskId) === String(notification.entityId)
      && String(entry.userId || entry.personId || entry.personnelId || "") === String(item.recipientId));
    if (!task || !assignment || terminalWorkforceStatus(task.status) || terminalWorkforceStatus(assignment.status)) return "Görev veya atama artık aktif değil.";
    const dueAt = Date.parse(task.dueAt || (task.dueDate ? `${task.dueDate}T${task.dueTime || "23:59"}:00+03:00` : ""));
    const originalDueAt = Date.parse(notification.metadata && notification.metadata.dueAt || "");
    if (!Number.isFinite(dueAt) || !Number.isFinite(originalDueAt) || dueAt !== originalDueAt) return "Görevin teslim zamanı değişti.";
    if (notification.eventType !== "task_overdue" && now >= dueAt) return "Görevin hatırlatma penceresi sona erdi.";
    if (notification.eventType === "task_overdue" && now < dueAt) return "Görev artık gecikmiş değil.";
  }
  if (notification.eventType.startsWith("shift_reminder_")) {
    const metadata = notification.metadata || {};
    const plan = (data.workforceShiftPlans || []).find((entry) => entry && entry.status === "published"
      && String(entry.personId || entry.userId || entry.personnelId || "") === String(item.recipientId)
      && String(entry.date || "") === String(metadata.date || "")
      && String(entry.startTime || "") === String(metadata.startTime || "")
      && String(entry.endTime || "") === String(metadata.endTime || "")
      && (!metadata.shiftType || String(entry.type || "") === String(metadata.shiftType)));
    if (!plan) return "Yayınlanmış vardiyanın zamanı veya türü değişti.";
    const startsAt = Date.parse(`${plan.date}T${plan.startTime || (normalizeLookup(plan.type).includes("aksam") ? "16:00" : "08:00")}:00+03:00`);
    if (!Number.isFinite(startsAt) || now >= startsAt) return "Vardiya hatırlatma penceresi sona erdi.";
  }
  return "";
}

function terminalWorkforceStatus(value) {
  return ["completed", "tamamlandi", "cancelled", "canceled", "iptal edildi", "iptal", "archived"].includes(normalizeLookup(value));
}

function mergeSimilarNotification(data, input, rule, createdAt) {
  const timestamp = Date.parse(createdAt);
  const existing = (Array.isArray(data.notifications) ? data.notifications : [])
    .filter((item) => item && !item.deletedAt && !item.archivedAt && item.inAppVisible !== false
      && item.ruleId === rule.id && item.category === input.category
      && normalizeRole(item.recipientRole) === input.recipientRole
      && String(item.recipientId || "") === input.recipientId
      && !item.metadata?.digestPending && !item.metadata?.repeatRootId
      && timestamp - Date.parse(item.updatedAt || item.createdAt || 0) >= 0
      && timestamp - Date.parse(item.updatedAt || item.createdAt || 0) <= MERGE_WINDOW_MS)
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0];
  if (!existing) return null;
  const currentMetadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const relatedRecords = Array.isArray(currentMetadata.relatedRecords) ? [...currentMetadata.relatedRecords] : [];
  if (!relatedRecords.length) relatedRecords.push(notificationRelatedRecord(existing));
  relatedRecords.push(notificationRelatedRecord(input));
  const deduped = [];
  const seen = new Set();
  for (const record of relatedRecords) {
    const key = `${record.entityType}\u0000${record.entityId}\u0000${record.deepLink}\u0000${record.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }
  const count = deduped.length;
  existing.title = `${count} olay · ${rule.label}`.slice(0, 180);
  existing.body = `${count} ilgili kayıt tek bildirimde birleştirildi.`;
  existing.updatedAt = createdAt;
  existing.metadata = {
    ...currentMetadata,
    mergedCount: count,
    relatedRecords: deduped.slice(-50)
  };
  data.revisions = data.revisions && typeof data.revisions === "object" && !Array.isArray(data.revisions) ? data.revisions : {};
  data.revisions.notification = Math.max(0, Number(data.revisions.notification || 0)) + 1;
  existing.revision = data.revisions.notification;
  if (input.dedupeKey) data.notificationDedupe.push(notificationDedupeEntry({ ...existing, dedupeKey: input.dedupeKey, createdAt }));
  recordDeliveryHistory(data, existing, "inApp", "merged", `${count} benzer olay tek kartta birleştirildi.`, { now: createdAt });
  return existing;
}

function notificationRelatedRecord(value) {
  return {
    entityType: String(value && value.entityType || "").slice(0, 100),
    entityId: String(value && value.entityId || "").slice(0, 180),
    deepLink: String(value && value.deepLink || "").slice(0, 500),
    title: String(value && value.title || "Bildirim").slice(0, 180)
  };
}

function notificationChannelDailyLimitReached(data, input, rule, channel, createdAt) {
  if (!rule || !Number.isInteger(rule.dailyLimit) || rule.dailyLimit < 1) return false;
  const timezone = normalizeTimezone(rule.timezone);
  const day = localDateKey(createdAt, timezone);
  const role = normalizeRole(input.recipientRole);
  const recipientId = role === "manager" ? "manager" : String(input.recipientId || "");
  if (["inApp", "sound"].includes(channel)) {
    let count = 0;
    for (const item of Array.isArray(data.notifications) ? data.notifications : []) {
      if (!item || item.deletedAt || item.ruleId !== rule.id || localDateKey(item.createdAt, timezone) !== day) continue;
      if (normalizeRole(item.recipientRole) !== role || String(item.recipientId || "") !== recipientId) continue;
      const usage = Array.isArray(item.metadata && item.metadata.channelUsage) ? item.metadata.channelUsage : [];
      if (usage.includes(channel)) count += 1;
    }
    return count >= rule.dailyLimit;
  }
  const notificationIds = new Set();
  for (const item of Array.isArray(data.notificationOutbox) ? data.notificationOutbox : []) {
    if (!item || item.channel !== channel || item.status === "suppressed" || item.status === "cancelled") continue;
    if (item.ruleId !== rule.id || item.localDay !== day) continue;
    if (normalizeRole(item.recipientRole) !== role || String(item.recipientId || "") !== recipientId) continue;
    notificationIds.add(String(item.notificationId || item.id));
  }
  return notificationIds.size >= rule.dailyLimit;
}

function localDateKey(value, timezone) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit"
  }).format(Number.isFinite(date.getTime()) ? date : new Date());
}

function dailyLimitReason(rule, channelLabel) {
  return `${channelLabel} kanalı için günlük ${Number(rule && rule.dailyLimit || 0)} bildirim sınırı doldu.`;
}

function recordDeliveryHistory(data, notification, channel, status, reason, options = {}) {
  data.notificationOutbox = Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [];
  const timestamp = nowIso(options.now || notification.updatedAt || notification.createdAt);
  const item = {
    id: `notification-outbox-${crypto.randomUUID()}`,
    notificationId: notification.id,
    channel,
    recipientRole: normalizeRole(notification.recipientRole),
    recipientId: normalizeRole(notification.recipientRole) === "manager" ? "manager" : String(notification.recipientId || ""),
    destination: "",
    status,
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    sentAt: null,
    lastError: String(reason || "").slice(0, 500),
    dedupeKey: `${notification.id}:${channel}:${status}:${timestamp}`.slice(0, 240),
    subscriptionId: "",
    lockedAt: null,
    lockedBy: "",
    ruleId: String(notification.ruleId || notification.metadata?.ruleId || ""),
    localDay: localDateKey(timestamp, notification.metadata?.timezone || "Europe/Istanbul"),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  data.notificationOutbox.push(item);
  data.notificationOutbox = retainOutbox(data.notificationOutbox, MAX_OUTBOX_ITEMS);
  return item;
}

function cancelInvalidOutboxInStore(data, nowValue = new Date()) {
  const timestamp = nowIso(nowValue);
  let cancelled = 0;
  for (const item of Array.isArray(data.notificationOutbox) ? data.notificationOutbox : []) {
    if (!item || !["pending", "processing"].includes(item.status) || item.dispatchStartedAt) continue;
    const reason = pendingDeliveryInvalidReason(data, item, nowValue);
    if (!reason) continue;
    item.status = "cancelled";
    item.nextAttemptAt = null;
    item.lockedAt = null;
    item.lockedBy = "";
    item.lastError = reason.slice(0, 500);
    item.updatedAt = timestamp;
    cancelled += 1;
  }
  return cancelled;
}

function normalizeNotificationCategory(value) {
  if (NOTIFICATION_CATEGORIES.includes(value)) return value;
  const key = normalizeLookup(value);
  if (["feedback", "geri bildirim", "dilek sikayet", "dilek ve sikayet"].includes(key)) return "feedback";
  if (["task", "tasks", "gorev", "yapilacak", "task reminder", "gorev hatirlatma"].some((term) => key.includes(term))) return "task";
  if (["shipment", "shipments", "sevkiyat"].some((term) => key.includes(term))) return "shipment";
  if (["shift", "shifts", "vardiya", "izin"].some((term) => key.includes(term))) return "shift";
  if (["material request", "malzeme talebi", "malzeme talep"].some((term) => key.includes(term))) return "materialRequest";
  if (["training", "trainings", "egitim", "sinav", "recete"].some((term) => key.includes(term))) return "training";
  if (["stock", "stok"].some((term) => key.includes(term))) return "stock";
  return "system";
}

function isRetiredNotificationCategory(value, eventType = "") {
  if (normalizeNotificationCategory(value) === "training") return true;
  const event = normalizeLookup(eventType);
  return ["recipe assignment", "training assigned", "training completed", "training started", "retry training"]
    .some((term) => event.includes(term));
}

function normalizeRole(value) {
  const role = normalizeLookup(value);
  if (["manager", "admin", "yonetici"].includes(role)) return "manager";
  if (["personnel", "personel", "recipe"].includes(role)) return "personnel";

  return "";
}

function sanitizeMetadata(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return {};
  const result = Object.create(null);
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 40)) {
    const key = String(rawKey || "").slice(0, 80);
    if (!key || /(?:pass(?:word)?|secret|token|cookie|authorization|smtp|vapid|private.?key)/i.test(key)) continue;
    if (rawValue === null || typeof rawValue === "boolean" || typeof rawValue === "number") result[key] = rawValue;
    else if (typeof rawValue === "string") result[key] = rawValue.slice(0, 500);
    else if (Array.isArray(rawValue)) result[key] = rawValue.slice(0, 50)
      .map((item) => sanitizeMetadataValue(item, depth + 1)).filter((item) => item !== undefined);
    else if (rawValue && typeof rawValue === "object") result[key] = sanitizeMetadata(rawValue, depth + 1);
  }
  try {
    return Buffer.byteLength(JSON.stringify(result), "utf8") <= 8000 ? result : {};
  } catch (_error) {
    return {};
  }
}

function sanitizeMetadataValue(value, depth) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 500);
  if (value && typeof value === "object" && !Array.isArray(value) && depth <= 3) return sanitizeMetadata(value, depth);
  return undefined;
}

function retainNotifications(items, maxItems = MAX_NOTIFICATIONS) {
  if (!Array.isArray(items) || items.length <= maxItems) return items;
  const protectedItems = items.filter((item) => item && !item.deletedAt && !item.readAt && !item.archivedAt);
  const removable = items.filter((item) => !item || item.deletedAt || item.readAt || item.archivedAt)
    .sort((left, right) => String(right && right.createdAt || "").localeCompare(String(left && left.createdAt || "")));
  const slots = Math.max(0, maxItems - protectedItems.length);
  return protectedItems.concat(removable.slice(0, slots))
    .sort((left, right) => String(left && left.createdAt || "").localeCompare(String(right && right.createdAt || "")));
}

function retainOutbox(items, maxItems = MAX_OUTBOX_ITEMS) {
  if (!Array.isArray(items) || items.length <= maxItems) return items;
  const protectedItems = items.filter((item) => item && ["pending", "processing"].includes(item.status));
  const completed = items.filter((item) => !item || !["pending", "processing"].includes(item.status))
    .sort((left, right) => String(right && right.updatedAt || "").localeCompare(String(left && left.updatedAt || "")));
  const slots = Math.max(0, maxItems - protectedItems.length);
  return protectedItems.concat(completed.slice(0, slots));
}

function isMandatoryNotification(notification) {
  if (!notification || notification.severity !== "critical") return false;
  const event = normalizeLookup(notification.eventType);
  return notification.category === "system" || event.includes("security") || event.includes("guvenlik")
    || event.includes("data integrity") || event.includes("veri butunlugu");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function getVerifiedAccountEmail(data, ownerRole, ownerId) {
  const role = normalizeRole(ownerRole);
  const account = role === "manager"
    ? data && data.admin
    : role === "personnel"
      ? (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
        .find((item) => item && String(item.id || "") === String(ownerId || ""))
      : null;
  if (!account || !account.emailVerifiedAt) return "";
  const email = normalizeEmail(account.emailNormalized || account.email);
  return isValidEmail(email) ? email : "";
}

function normalizeClock(value, fallback) {
  const text = String(value || "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function normalizeTimezone(value) {
  const timezone = String(value || "Europe/Istanbul").trim().slice(0, 80);
  try {
    new Intl.DateTimeFormat("tr-TR", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_error) {
    return "Europe/Istanbul";
  }
}

function normalizeEventType(value) {
  const eventType = String(value || "notification").trim().slice(0, 120);
  return eventType || "notification";
}

function normalizeLookup(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
}

function preferenceFlag(existing, directKey, legacyValue, fallback) {
  if (existing && typeof existing[directKey] === "boolean") return existing[directKey];
  return typeof legacyValue === "boolean" ? legacyValue : fallback;
}

function legacyFlag(primary, legacy, fallback) {
  if (typeof primary === "boolean") return primary;
  return typeof legacy === "boolean" ? legacy : fallback;
}

function booleanValue(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function isSafeScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function nowIso(value) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

module.exports = {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  createNotificationInStore,
  createNotificationsInStore,
  notificationsFromResult,
  cancelInvalidOutboxInStore,
  normalizeNotificationDedupe,
  normalizeNotificationRules,
  enqueueOutbox,
  getNotificationPreferences,
  getVerifiedAccountEmail,
  isMandatoryNotification,
  isRetiredNotificationCategory,
  normalizeNotificationCategory,
  normalizeRole,
  pendingDeliveryInvalidReason,
  preferenceCategoryEnabled,
  publishNotificationEvent,
  publishNotificationStateEvent,
  recipientMatches,
  recordDeliveryHistory,
  retainNotifications,
  retainOutbox,
  sanitizeMetadata,
  subscribeNotificationEvents,
  subscribeNotificationStateEvents,
  updateNotificationPreferencesInStore
};
