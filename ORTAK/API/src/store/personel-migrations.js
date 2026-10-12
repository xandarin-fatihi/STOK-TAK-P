"use strict";

const { POLICY_VERSION, normalizeNotificationRules } = require("../notification-policy");
const crypto = require("crypto");

const { normalizeAppTarget, safeAppDeepLink } = require("../app-targets");

const {
  normalizeNameHistory,
  normalizeProductCode,
  normalizeProductCodeList,
  normalizeProductCodeRegistry,
  registryCodeForEntity
} = require("./product-code-registry");

const { normalizePersonelSectionAccess } = require("../personel-section-access");
const {
  FATURA_CAPABILITIES,
  FATURA_ROLES,
  normalizeSectionAccess
} = require("../procurement-access");
const { normalizeNotificationDedupe } = require("../notification-service");
const { normalizeProcurement } = require("./procurement-migrations");
const { normalizeAppearance } = require("../../../JS/panel-theme");

const DEFAULT_FATURA_CAPABILITIES = Object.freeze([
  "procurement.read", "supplier.read", "supplier.manage", "supplierProduct.manage",
  "receipt.create", "receipt.submit", "receipt.approve", "receipt.reject",
  "accounting.read", "accounting.post", "accounting.reverse", "payment.create", "payment.reverse",
  "documents.read", "documents.upload", "documents.archive",
  "inventory.read", "inventory.manage", "inventory.movement.create", "inventory.movement.reverse",
  "inventory.transfer.create", "inventory.transfer.approve", "inventory.count.manage"
]);

function normalizePasswordResetChallenges(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const scope = ["admin", "personel"].includes(String(item.scope || "")) ? String(item.scope) : "";
    const id = String(item.id || "").trim().slice(0, 160);
    const emailHash = String(item.emailHash || "").trim().slice(0, 128);
    const codeHash = String(item.codeHash || "").trim().slice(0, 128);
    if (!id || !scope || !emailHash || !codeHash) return null;
    return {
      id,
      purpose: String(item.purpose || "password_reset") === "password_reset" ? "password_reset" : "password_reset",
      emailHash,
      scope,
      targetUserId: String(item.targetUserId || "").trim().slice(0, 160),
      identifierHash: String(item.identifierHash || "").trim().slice(0, 128),
      codeHash,
      accountVersion: Math.max(0, Math.trunc(finiteNumber(item.accountVersion, 0))),
      attempts: Math.max(0, Math.trunc(finiteNumber(item.attempts, 0))),
      expiresAt: normalizeStoredDate(item.expiresAt, new Date(0).toISOString()),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      usedAt: item.usedAt ? normalizeStoredDate(item.usedAt, new Date(0).toISOString()) : null,
      revokedAt: item.revokedAt ? normalizeStoredDate(item.revokedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean).slice(-500);
}

function normalizeEmailVerificationChallenges(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const scope = ["admin", "personel"].includes(String(item.scope || "")) ? String(item.scope) : "";
    const id = String(item.id || "").trim().slice(0, 160);
    const targetUserId = String(item.targetUserId || "").trim().slice(0, 160);
    const destinationHash = String(item.destinationHash || "").trim().slice(0, 128);
    const codeHash = String(item.codeHash || "").trim().slice(0, 128);
    if (!id || !scope || !targetUserId || !destinationHash || !codeHash) return null;
    return {
      id,
      purpose: "email_verification",
      scope,
      targetUserId,
      destinationHash,
      codeHash,
      accountVersion: Math.max(0, Math.trunc(finiteNumber(item.accountVersion, 0))),
      attempts: Math.max(0, Math.trunc(finiteNumber(item.attempts, 0))),
      expiresAt: normalizeStoredDate(item.expiresAt, new Date(0).toISOString()),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      usedAt: item.usedAt ? normalizeStoredDate(item.usedAt, new Date(0).toISOString()) : null,
      revokedAt: item.revokedAt ? normalizeStoredDate(item.revokedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean).slice(-500);
}

function normalizeSecurityAudit(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim().slice(0, 180);
    const action = String(item.action || "").trim().slice(0, 100);
    if (!id || !action) return null;
    return {
      id,
      action,
      scope: ["admin", "personel"].includes(item.scope) ? item.scope : "",
      accountId: String(item.accountId || "").slice(0, 160),
      result: String(item.result || "recorded").slice(0, 80),
      ipHash: String(item.ipHash || "").slice(0, 64),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString())
    };
  }).filter(Boolean).slice(-2000);
}

function normalizeNotifications(value) {
  const normalized = normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const recipientRole = normalizeNotificationRole(item.recipientRole);
    const recipientId = recipientRole === "manager" ? "manager" : String(item.recipientId || "").trim().slice(0, 160);
    const id = String(item.id || "").trim().slice(0, 180);
    if (!id || !recipientRole || !recipientId) return null;
    const appTarget = normalizeAppTarget(item.appTarget, item.deepLink, recipientRole);
    return {
      ...item,
      id,
      recipientRole,
      recipientId,
      category: normalizeNotificationCategory(item.category),
      eventType: String(item.eventType || "notification").trim().slice(0, 120) || "notification",
      title: repairNotificationText(item.title || "Bildirim").trim().slice(0, 180) || "Bildirim",
      body: repairNotificationText(item.body || "").trim().slice(0, 1200),
      severity: item.severity === "error" ? "critical" : ["info", "success", "warning", "critical"].includes(item.severity) ? item.severity : "info",
      entityType: String(item.entityType || "").trim().slice(0, 100),
      entityId: String(item.entityId || "").trim().slice(0, 180),
      deepLink: safeAppDeepLink(item.deepLink, appTarget),
      appTarget,
      dedupeKey: String(item.dedupeKey || "").trim().slice(0, 240),
      metadata: normalizeNotificationMetadata(item.metadata),
      inAppVisible: item.inAppVisible !== false,
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      updatedAt: normalizeStoredDate(item.updatedAt || item.createdAt, new Date(0).toISOString()),
      readAt: item.readAt ? normalizeStoredDate(item.readAt, new Date(0).toISOString()) : null,
      archivedAt: item.archivedAt ? normalizeStoredDate(item.archivedAt, new Date(0).toISOString()) : null,
      deletedAt: item.deletedAt ? normalizeStoredDate(item.deletedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean);
  const byEvent = new Map();
  for (const item of normalized) {
    const key = item.dedupeKey ? `${item.recipientRole}\u0000${item.recipientId}\u0000${item.dedupeKey}` : `id:${item.id}`;
    const current = byEvent.get(key);
    if (!current) byEvent.set(key, item);
    else {
      current.readAt = current.readAt || item.readAt;
      current.archivedAt = current.archivedAt || item.archivedAt;
      current.deletedAt = current.deletedAt || item.deletedAt;
      if (String(item.updatedAt || "") > String(current.updatedAt || "")) current.updatedAt = item.updatedAt;
    }
  }
  const deduped = [...byEvent.values()];
  if (deduped.length <= 10000) return deduped;
  const unread = deduped.filter((item) => !item.readAt && !item.archivedAt);
  const completed = deduped.filter((item) => item.readAt || item.archivedAt)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  return unread.concat(completed.slice(0, Math.max(0, 10000 - unread.length)))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

function normalizeNotificationPreferences(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  const normalized = source.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const ownerRole = normalizeNotificationRole(item.ownerRole || item.recipientRole);
    const ownerId = ownerRole === "manager" ? "manager" : String(item.ownerId || item.recipientId || "").trim().slice(0, 160);
    if (!ownerRole || !ownerId) return null;
    return {
      ownerRole,
      ownerId,
      inAppEnabled: item.inAppEnabled !== undefined ? item.inAppEnabled !== false : item.inApp !== false,
      emailEnabled: item.emailEnabled !== undefined ? item.emailEnabled === true : item.email === true,
      pushEnabled: item.pushEnabled !== undefined ? item.pushEnabled === true : item.push === true,
      pushVibrationEnabled: item.pushVibrationEnabled !== false,
      emailAddress: String(item.emailAddress || "").trim().toLowerCase().slice(0, 254),
      taskNotifications: notificationPreferenceFlag(item, "taskNotifications", "tasks", true),
      shipmentNotifications: notificationPreferenceFlag(item, "shipmentNotifications", "shipments", true),
      stockNotifications: notificationPreferenceFlag(item, "stockNotifications", "stock", true),
      shiftNotifications: notificationPreferenceFlag(item, "shiftNotifications", "shifts", true),
      systemNotifications: notificationPreferenceFlag(item, "systemNotifications", "system", true),
      reminderNotifications: notificationPreferenceFlag(item, "reminderNotifications", "reminders", true),
      taskReminder24h: notificationReminderFlag(item, "taskReminder24h", "task24h"),
      taskReminder2h: notificationReminderFlag(item, "taskReminder2h", "task2h"),
      overdueReminder: notificationReminderFlag(item, "overdueReminder", "overdue"),
      shiftReminder12h: notificationReminderFlag(item, "shiftReminder12h", "shift12h"),
      shiftReminder2h: notificationReminderFlag(item, "shiftReminder2h", "shift2h"),
      quietHoursEnabled: item.quietHoursEnabled === true || Boolean(item.quietHours && item.quietHours.enabled),
      quietHoursStart: normalizeClock(item.quietHoursStart || item.quietHours && item.quietHours.start, "22:00"),
      quietHoursEnd: normalizeClock(item.quietHoursEnd || item.quietHours && item.quietHours.end, "08:00"),
      timezone: String(item.timezone || item.quietHours && item.quietHours.timezone || "Europe/Istanbul").slice(0, 80),
      policyVersion: ownerRole === "manager" ? POLICY_VERSION : undefined,
      ...(ownerRole === "manager" ? { rules: normalizeNotificationRules(item.rules) } : {}),
      updatedAt: item.updatedAt ? normalizeStoredDate(item.updatedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean);
  const byOwner = new Map();
  for (const item of normalized) byOwner.set(`${item.ownerRole}\u0000${item.ownerId}`, item);
  return [...byOwner.values()].slice(-2000);
}

function reconcileNotificationPreferenceEmails(preferences, data) {
  return (Array.isArray(preferences) ? preferences : []).map((preference) => {
    if (!preference) return preference;
    const account = preference.ownerRole === "manager"
      ? data && data.admin
      : (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
          .find((item) => item && String(item.id || "") === String(preference.ownerId || ""));
    const candidate = account && account.emailVerifiedAt
      ? String(account.emailNormalized || account.email || "").trim().toLowerCase().slice(0, 254)
      : "";
    const verifiedEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : "";
    return {
      ...preference,
      emailEnabled: Boolean(preference.emailEnabled && verifiedEmail),
      emailAddress: verifiedEmail,
      emailVerified: Boolean(verifiedEmail)
    };
  });
}

function normalizeNotificationOutbox(value) {
  const normalized = normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim().slice(0, 180);
    const notificationId = String(item.notificationId || "").trim().slice(0, 180);
    const channel = ["email", "push", "inApp", "sound"].includes(item.channel) ? item.channel : "";
    const recipientRole = normalizeNotificationRole(item.recipientRole);
    const recipientId = recipientRole === "manager" ? "manager" : String(item.recipientId || "").trim().slice(0, 160);
    if (!id || !notificationId || !channel) return null;
    return {
      ...item,
      id,
      notificationId,
      channel,
      recipientRole,
      recipientId,
      status: normalizeOutboxStatus(item.status),
      attemptCount: Math.max(0, Math.trunc(finiteNumber(item.attemptCount ?? item.attempts, 0))),
      nextAttemptAt: item.nextAttemptAt ? normalizeStoredDate(item.nextAttemptAt, new Date(0).toISOString()) : null,
      lockedAt: item.lockedAt ? normalizeStoredDate(item.lockedAt, new Date(0).toISOString()) : null,
      lastAttemptAt: item.lastAttemptAt ? normalizeStoredDate(item.lastAttemptAt, new Date(0).toISOString()) : null,
      sentAt: item.sentAt || item.deliveredAt ? normalizeStoredDate(item.sentAt || item.deliveredAt, new Date(0).toISOString()) : null,
      destination: String(item.destination || "").slice(0, 2048),
      subscriptionId: String(item.subscriptionId || "").slice(0, 180),
      dedupeKey: String(item.dedupeKey || "").slice(0, 240),
      ruleId: String(item.ruleId || "").slice(0, 120),
      localDay: /^\d{4}-\d{2}-\d{2}$/.test(String(item.localDay || ""))
        ? String(item.localDay) : localNotificationDate(item.createdAt),
      lastError: String(item.lastError || "").slice(0, 500),
      lockedBy: String(item.lockedBy || "").slice(0, 180),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      updatedAt: normalizeStoredDate(item.updatedAt || item.createdAt, new Date(0).toISOString())
    };
  }).filter(Boolean);
  const byDelivery = new Map();
  for (const item of normalized) {
    const role = normalizeNotificationRole(item.recipientRole);
    const recipientId = role === "manager" ? "manager" : String(item.recipientId || "");
    const logicalDelivery = `${item.notificationId}\u0000${item.channel}\u0000${item.channel === "push"
      ? item.subscriptionId || item.destination
      : String(item.destination || "").toLowerCase() || "email"}`;
    const key = `${role}\u0000${recipientId}\u0000${logicalDelivery}`;
    const current = byDelivery.get(key);
    const priority = outboxStatusPriority(item.status);
    const currentPriority = outboxStatusPriority(current && current.status);
    if (!current
      || priority > currentPriority
      || (priority === currentPriority && String(item.updatedAt || "") > String(current.updatedAt || ""))) byDelivery.set(key, item);
  }
  const deduped = [...byDelivery.values()];
  if (deduped.length <= 20000) return deduped;
  const active = deduped.filter((item) => ["pending", "processing"].includes(item.status));
  const completed = deduped.filter((item) => !["pending", "processing"].includes(item.status))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return active.concat(completed.slice(0, Math.max(0, 20000 - active.length)));
}

function reconcileNotificationOutboxRecipients(items, notifications) {
  const notificationsById = new Map();
  for (const notification of Array.isArray(notifications) ? notifications : []) {
    if (!notification || !notification.id) continue;
    if (!notificationsById.has(notification.id)) notificationsById.set(notification.id, []);
    notificationsById.get(notification.id).push(notification);
  }
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item) return item;
    const candidates = notificationsById.get(item.notificationId) || [];
    const claimedRole = normalizeNotificationRole(item.recipientRole);
    const claimedId = claimedRole === "manager" ? "manager" : String(item.recipientId || "");
    let notification = candidates.find((entry) => entry.recipientRole === claimedRole
      && String(entry.recipientRole === "manager" ? "manager" : entry.recipientId || "") === claimedId);
    if (!notification && !claimedRole && candidates.length === 1) notification = candidates[0];
    if (notification) {
      return {
        ...item,
        recipientRole: notification.recipientRole,
        recipientId: notification.recipientId
      };
    }
    if (!candidates.length || !claimedRole || !claimedId) return item;
    return {
      ...item,
      status: item.status === "sent" ? "sent" : "cancelled",
      nextAttemptAt: null,
      lockedAt: null,
      lockedBy: "",
      lastError: item.status === "sent" ? item.lastError : "Bildirim teslim alıcısı eşleşmediği için iptal edildi."
    };
  });
}

function normalizePushSubscriptions(value) {
  const normalized = normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const ownerRole = normalizeNotificationRole(item.ownerRole || item.recipientRole);
    const ownerId = ownerRole === "manager" ? "manager" : String(item.ownerId || item.recipientId || "").trim().slice(0, 160);
    const endpoint = String(item.endpoint || item.subscription && item.subscription.endpoint || "").trim().slice(0, 2048);
    if (!ownerRole || !ownerId || !/^https:\/\//i.test(endpoint)) return null;
    const subscription = item.subscription && typeof item.subscription === "object" ? item.subscription : item;
    return {
      id: String(item.id || stableStockId("push-subscription", `${ownerRole}\u0000${ownerId}\u0000${endpoint}`)),
      ownerRole,
      ownerId,
      appTarget: normalizeAppTarget(item.appId || item.appTarget, item.deepLink, ownerRole),
      appId: normalizeAppTarget(item.appId || item.appTarget, item.deepLink, ownerRole),
      endpoint,
      subscription: {
        endpoint,
        expirationTime: subscription.expirationTime || null,
        keys: subscription.keys && typeof subscription.keys === "object" ? {
          p256dh: String(subscription.keys.p256dh || "").slice(0, 500),
          auth: String(subscription.keys.auth || "").slice(0, 500)
        } : {}
      },
      keys: subscription.keys && typeof subscription.keys === "object" ? {
        p256dh: String(subscription.keys.p256dh || "").slice(0, 500),
        auth: String(subscription.keys.auth || "").slice(0, 500)
      } : {},
      userAgent: String(item.userAgent || "").slice(0, 500),
      deviceId: String(item.deviceId || "").trim().slice(0, 180),
      deviceName: String(item.deviceName || "").trim().slice(0, 120),
      createdAt: normalizeStoredDate(item.createdAt, new Date(0).toISOString()),
      updatedAt: normalizeStoredDate(item.updatedAt || item.createdAt, new Date(0).toISOString()),
      lastSeenAt: normalizeStoredDate(item.lastSeenAt || item.updatedAt || item.createdAt, new Date(0).toISOString()),
      lastSuccessAt: item.lastSuccessAt ? normalizeStoredDate(item.lastSuccessAt, new Date(0).toISOString()) : null,
      lastFailureAt: item.lastFailureAt ? normalizeStoredDate(item.lastFailureAt, new Date(0).toISOString()) : null,
      failureCount: Math.max(0, Math.trunc(finiteNumber(item.failureCount, 0))),
      disabledAt: item.disabledAt ? normalizeStoredDate(item.disabledAt, new Date(0).toISOString()) : null,
      revokedAt: item.revokedAt ? normalizeStoredDate(item.revokedAt, new Date(0).toISOString()) : null
    };
  }).filter(Boolean);
  const byOwnerDevice = new Map();
  for (const item of normalized) {
    const identity = item.deviceId ? `device:${item.deviceId}` : `endpoint:${item.endpoint}`;
    const key = `${item.ownerRole}\u0000${item.ownerId}\u0000${item.appTarget}\u0000${identity}`;
    const current = byOwnerDevice.get(key);
    if (!current || String(item.updatedAt || "") >= String(current.updatedAt || "")) byOwnerDevice.set(key, item);
  }
  const deduped = [...byOwnerDevice.values()];
  const activeByEndpoint = new Map();
  const retained = [];
  for (const item of deduped.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))) {
    if (item.revokedAt) {
      retained.push(item);
      continue;
    }
    const endpointKey = `${item.appId || item.appTarget}\u0000${item.endpoint}`;
    if (activeByEndpoint.has(endpointKey)) continue;
    activeByEndpoint.set(endpointKey, item);
    retained.push(item);
  }
  return retained.slice(0, 5000);
}

function normalizeNotificationSchedulerState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    lastRunAt: source.lastRunAt ? normalizeStoredDate(source.lastRunAt, new Date(0).toISOString()) : null,
    leaseOwner: String(source.leaseOwner || "").slice(0, 160),
    leaseExpiresAt: source.leaseExpiresAt ? normalizeStoredDate(source.leaseExpiresAt, new Date(0).toISOString()) : null,
    updatedAt: source.updatedAt ? normalizeStoredDate(source.updatedAt, new Date(0).toISOString()) : null,
    lastTickAt: source.lastTickAt ? normalizeStoredDate(source.lastTickAt, new Date(0).toISOString()) : null,
    lastReminderScanAt: source.lastReminderScanAt ? normalizeStoredDate(source.lastReminderScanAt, new Date(0).toISOString()) : null,
    lastOutboxRunAt: source.lastOutboxRunAt ? normalizeStoredDate(source.lastOutboxRunAt, new Date(0).toISOString()) : null,
    lastOutboxSuccessAt: source.lastOutboxSuccessAt ? normalizeStoredDate(source.lastOutboxSuccessAt, new Date(0).toISOString()) : null,
    reminderKeys: normalizeArray(source.reminderKeys).map((key) => String(key || "").slice(0, 240)).filter(Boolean).slice(-5000),
    criticalStockState: normalizeCriticalStockState(source.criticalStockState)
  };
}

function notificationPreferenceFlag(item, directKey, categoryKey, fallback) {
  if (item[directKey] !== undefined) return item[directKey] !== false;
  if (item.categories && item.categories[categoryKey] !== undefined) return item.categories[categoryKey] !== false;
  const singular = String(categoryKey || "").replace(/s$/, "");
  if (item.categories && item.categories[singular] !== undefined) return item.categories[singular] !== false;
  return fallback;
}

function notificationReminderFlag(item, directKey, reminderKey) {
  if (typeof item[directKey] === "boolean") return item[directKey];
  if (item.reminders && typeof item.reminders[reminderKey] === "boolean") return item.reminders[reminderKey];
  return item.reminderNotifications !== false;
}

function normalizeClock(value, fallback) {
  const text = String(value || "").trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function normalizeOutboxStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (["sent", "delivered"].includes(status)) return "sent";
  if (["failed", "dead_letter"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (status === "suppressed") return "suppressed";
  if (status === "merged") return "merged";
  if (["processing", "in_progress", "locked"].includes(status)) return "processing";
  return "pending";
}

function outboxStatusPriority(status) {
  return { sent: 7, processing: 6, pending: 5, failed: 4, suppressed: 3, merged: 2, cancelled: 1 }[status] || 0;
}

function localNotificationDate(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function normalizeNotificationRole(value) {
  const role = normalizeNotificationLookup(value);
  if (["manager", "admin", "yonetici"].includes(role)) return "manager";
  if (["personnel", "personel", "recipe"].includes(role)) return "personnel";

  return "";
}

function normalizeNotificationCategory(value) {
  const key = normalizeNotificationLookup(value);
  if (["feedback", "geri bildirim", "dilek sikayet", "dilek ve sikayet"].includes(key)) return "feedback";
  if (["task", "gorev", "yapilacak"].some((term) => key.includes(term))) return "task";
  if (["shipment", "sevkiyat"].some((term) => key.includes(term))) return "shipment";
  if (["shift", "vardiya", "izin"].some((term) => key.includes(term))) return "shift";
  if (["material request", "malzeme talebi", "malzeme talep"].some((term) => key.includes(term))) return "materialRequest";
  if (["training", "egitim", "sinav", "recete"].some((term) => key.includes(term))) return "training";
  if (["stock", "stok"].some((term) => key.includes(term))) return "stock";
  return "system";
}

function normalizeCriticalStockState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawId, rawState] of Object.entries(value).slice(-5000)) {
    const id = String(rawId || "").slice(0, 180);
    if (!id || !rawState || typeof rawState !== "object" || Array.isArray(rawState)) continue;
    result[id] = {
      isCritical: rawState.isCritical === true,
      revision: Math.max(0, Math.trunc(finiteNumber(rawState.revision, 0))),
      quantity: finiteNumber(rawState.quantity, 0),
      threshold: Math.max(0, finiteNumber(rawState.threshold, 0)),
      updatedAt: rawState.updatedAt ? normalizeStoredDate(rawState.updatedAt, new Date(0).toISOString()) : null
    };
  }
  return result;
}

function normalizeNotificationMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    return Buffer.byteLength(json, "utf8") <= 8000 ? JSON.parse(json) : {};
  } catch (_error) {
    return {};
  }
}

function normalizeNotificationLookup(value) {
  return repairNotificationText(value).trim().toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim();
}

function repairNotificationText(value) {
  let result = String(value || "");
  const markerPattern = /[\u00c3\u00c4\u00c5\u00c2\u00e2][^\s]*/g;
  for (let index = 0; index < 3 && markerPattern.test(result); index += 1) {
    markerPattern.lastIndex = 0;
    const decoded = result.replace(markerPattern, decodeLegacyNotificationToken);
    if (decoded === result) break;
    result = decoded;
  }
  return result;
}

function decodeLegacyNotificationToken(token) {
  const bytes = [];
  for (const character of token) {
    const code = character.codePointAt(0);
    if (code <= 255) bytes.push(code);
    else if (Object.prototype.hasOwnProperty.call(WINDOWS_1252_BYTES, character)) bytes.push(WINDOWS_1252_BYTES[character]);
    else return token;
  }
  const decoded = Buffer.from(bytes).toString("utf8");
  return decoded.includes("�") ? token : decoded;
}

const WINDOWS_1252_BYTES = Object.freeze({
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91,
  "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98,
  "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f
});

function normalizeStoredDate(value, fallback) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : fallback;
}

function normalizeRecipeState(recipeState) {
  if (!recipeState || typeof recipeState !== "object" || Array.isArray(recipeState)) return {};
  const normalized = {};
  for (const [rawCategoryName, products] of Object.entries(recipeState)) {
    const categoryName = cleanRecipeBrandName(rawCategoryName);
    if (!categoryName || !products || typeof products !== "object" || Array.isArray(products)) continue;
    const nextProducts = {};
    for (const [rawProductName, sizes] of Object.entries(products)) {
      const productName = cleanRecipeBrandName(rawProductName);
      if (!productName || !sizes || typeof sizes !== "object" || Array.isArray(sizes)) continue;
      const nextSizes = {};
      for (const [sizeName, recipe] of Object.entries(sizes)) {
        if (!sizeName) continue;
        nextSizes[sizeName] = normalizeRecipeItem(recipe);
      }
      nextProducts[productName] = nextSizes;
    }
    normalized[categoryName] = nextProducts;
  }
  return normalized;
}

function cleanRecipeBrandName(value) {
  const name = String(value || "").trim();
  if (/^menu-suite\s+sıcak\s+specialler$/i.test(name)) return "Sıcak Özel Reçeteler";
  if (/^menu-suite\s+soğuk\s+specialler$/i.test(name)) return "Soğuk Özel Reçeteler";
  if (/^özel\s+cici$/i.test(name)) return "Özel Cici";
  return name;
}

function normalizeRecipeItem(recipe) {
  if (recipe && typeof recipe === "object" && !Array.isArray(recipe)) {
    return {
      ...recipe,
      content: String(recipe.content ?? recipe.recipe ?? recipe.ingredients ?? "").trim(),
      preparation: String(recipe.preparation ?? recipe.method ?? recipe.steps ?? recipe.description ?? "").trim(),
      note: String(recipe.note ?? recipe.productNote ?? "").trim(),
      active: recipe.active !== false,
      order: finiteNumber(recipe.order, 0),
      ...normalizeSourceMetadata(recipe)
    };
  }
  return String(recipe || "");
}

function reconcileRecipeCatalog(recipeState, existing) {
  const records = Array.isArray(existing) ? existing.filter(isCatalogRecord).map((item) => ({ ...item })) : [];
  const claimed = new Set();
  const result = [];

  for (const [category, products] of Object.entries(recipeState || {})) {
    for (const product of Object.keys(products || {})) {
      const exact = records.find((item) => !claimed.has(item.id) && item.category === category && item.product === product);
      const record = exact || {
        id: stableRecipeId(category, product),
        category,
        product,
        createdAt: new Date(0).toISOString()
      };
      claimed.add(record.id);
      result.push({
        ...record,
        id: String(record.id),
        category,
        product,
        updatedAt: record.updatedAt || null
      });
    }
  }
  return result;
}

function chooseRecipeSize(recipeState, record, preferredSize = "") {
  const sizes = recipeState?.[record.category]?.[record.product] || {};
  const activeEntries = Object.entries(sizes).filter(([, value]) => normalizeRecipeItem(value).active !== false);
  if (!activeEntries.length) return "";
  const preferred = [preferredSize, "Standart", "16 oz"].filter(Boolean);
  for (const name of preferred) {
    const match = activeEntries.find(([size]) => normalizeName(size) === normalizeName(name));
    if (match) return match[0];
  }
  activeEntries.sort(([, first], [, second]) => finiteNumber(normalizeRecipeItem(first).order, 0) - finiteNumber(normalizeRecipeItem(second).order, 0));
  return activeEntries[0][0];
}

function stableRecipeId(category, product) {
  return `recipe-${crypto.createHash("sha256").update(`${category}\u0000${product}`, "utf8").digest("hex").slice(0, 20)}`;
}

function normalizeRecipeUsers(value) {
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const requestedCapabilities = Array.isArray(item.faturaCapabilities)
      ? item.faturaCapabilities : [];
    const capabilities = [...new Set(requestedCapabilities
      .map((capability) => String(capability || "").trim())
      .filter((capability) => FATURA_CAPABILITIES.has(capability)))];
    const accessEnabled = typeof item.faturaAccessEnabled === "boolean"
      ? item.faturaAccessEnabled : capabilities.length > 0;
    const role = FATURA_ROLES.has(String(item.faturaRole || "")) ? String(item.faturaRole) : "operasyon";
    const template = procurementText(item.faturaTemplate, 40) || "ozel";
    const sectionAccess = normalizeSectionAccess(item.faturaSectionAccess, {
      capabilities,
      allowManagement: template === "yonetici" || role === "yönetici"
    });
    return {
      ...item,
      ...normalizeAccountSecurity(item),
      appearance: normalizeAppearance(item.appearance),
      faturaAccessEnabled: accessEnabled,
      faturaRole: role,
      faturaTemplate: template,
      faturaCapabilities: accessEnabled ? capabilities : [],
      faturaSectionAccess: sectionAccess,
      personelSectionAccess: normalizePersonelSectionAccess(item.personelSectionAccess),
      // Stok lokasyonu yalnızca sunucu tarafındaki oturumdan çözülür. Eski
      // Personel kayıtları güvenli başlangıç olarak Bakım Atölyesine bağlanır.
      stockLocationId: String(item.stockLocationId || item.locationId || "stock-location-cafe").trim() || "stock-location-cafe"
    };
  }).filter(Boolean);
}

function clearLegacyUnverifiedPersonelAdminEmails(data) {
  const adminEmail = normalizeSecurityEmail(data && data.admin && (data.admin.emailNormalized || data.admin.email));
  if (!adminEmail) return;
  const clearedAt = new Date().toISOString();
  for (const account of Array.isArray(data.recipeUsers) ? data.recipeUsers : []) {
    const email = normalizeSecurityEmail(account && (account.emailNormalized || account.email));
    const isUnverifiedLegacyDefault = account
      && email === adminEmail
      && !account.emailVerifiedAt
      && !account.pendingEmail
      && Math.max(0, Math.trunc(finiteNumber(account.emailVerificationVersion, 0))) === 0;
    if (!isUnverifiedLegacyDefault) continue;
    account.email = "";
    account.emailNormalized = "";
    account.emailVerificationRequired = true;
    data.securityAudit = normalizeSecurityAudit((Array.isArray(data.securityAudit) ? data.securityAudit : []).concat({
      id: `security-migration-${crypto.randomUUID()}`,
      action: "legacy_personel_admin_email_cleared",
      scope: "personel",
      accountId: String(account.id || ""),
      result: "unverified_default_removed",
      ipHash: "",
      createdAt: clearedAt
    }));
  }
}

function normalizeAccountSecurity(source) {
  const email = normalizeSecurityEmail(source.emailNormalized || source.email);
  const pendingCandidate = normalizeSecurityEmail(source.pendingEmail);
  const pendingEmail = pendingCandidate && pendingCandidate !== email ? pendingCandidate : "";
  const emailVerifiedAt = email && source.emailVerifiedAt
    ? normalizeStoredDate(source.emailVerifiedAt, null)
    : null;
  return {
    email,
    emailNormalized: email,
    pendingEmail,
    emailVerifiedAt,
    emailVerificationRequired: Boolean(source.emailVerificationRequired) || !emailVerifiedAt || Boolean(pendingEmail),
    emailVerificationVersion: Math.max(0, Math.trunc(finiteNumber(source.emailVerificationVersion, 0))),
    lastPasswordResetAt: source.lastPasswordResetAt
      ? normalizeStoredDate(source.lastPasswordResetAt, null)
      : null
  };
}

function normalizeSecurityEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeAuthSessions(items) {
  return normalizeArray(items).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const role = ["admin", "personel"].includes(item.role) ? item.role : "";
    const tokenHash = String(item.tokenHash || "").toLowerCase();
    if (!role || !/^[a-f0-9]{64}$/.test(tokenHash)) return null;
    return {
      id: String(item.id || `session-${crypto.randomUUID()}`),
      tokenHash,
      role,
      userId: ["personel"].includes(role) && item.userId ? String(item.userId) : null,
      username: ["personel"].includes(role) ? String(item.username || "") : "",
      name: ["personel"].includes(role) ? String(item.name || "") : "",
      createdAt: item.createdAt || new Date().toISOString(),
      revokedAt: item.revokedAt || null
    };
  }).filter(Boolean);
}

function normalizeWorkforceShiftSettings(settings) {
  const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  const morning = source.morning && typeof source.morning === "object" ? source.morning : {};
  const evening = source.evening && typeof source.evening === "object" ? source.evening : {};
  return {
    ...source,
    morning: {
      startTime: String(morning.startTime || "08:00"),
      endTime: String(morning.endTime || "16:00")
    },
    evening: {
      startTime: String(evening.startTime || "16:00"),
      endTime: String(evening.endTime || "00:00")
    },
    updatedAt: source.updatedAt || null,
    updatedBy: source.updatedBy || null
  };
}

function normalizeStockState(stockState) {
  const source = stockState && typeof stockState === "object" && !Array.isArray(stockState) ? stockState : defaultStockState();
  const categories = Array.isArray(source.categories)
    ? source.categories.map(normalizeStockCategory).filter(Boolean)
    : defaultStockState().categories;
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const products = Array.isArray(source.products)
    ? source.products.map((product, index) => normalizeStockProduct(product, index, categoryNames)).filter(Boolean)
    : defaultStockState().products;
  const unitDefinitions = normalizeStockUnitDefinitions(source.unitDefinitions, products);
  const purgedLocationIds = [...new Set(normalizeArray(source.purgedLocationIds).map((id) => String(id || "").trim()).filter(Boolean))];
  const locations = normalizeStockLocations(source.locations, purgedLocationIds);
  const generalLocation = locations.find((location) => location.code === "GENEL" || location.type === "central") || locations[0];
  const workshopLocation = locations.find((location) => location.code === "ATOLYE" || location.type === "workshop") || locations[0];
  const legacyMigrationRequired = !Array.isArray(source.balances) || Number(source.locationMigrationVersion || 0) < 1;
  // Yalnız henüz lokasyon migration'ı yapılmamış eski tekil stoklar operasyon
  // kaynağı olan Bakım Atölyesine bağlanır. Mevcut çok-depolu dağılım asla taşınmaz.
  const balances = normalizeStockBalances(source.balances, products, locations, legacyMigrationRequired, workshopLocation && workshopLocation.id, purgedLocationIds);
  const productsById = new Map(products.map((product) => [String(product.id), product]));
  const movements = normalizeArray(source.movements)
    .map((movement) => normalizeStockMovement(movement, productsById, legacyMigrationRequired ? workshopLocation && workshopLocation.id : generalLocation && generalLocation.id))
    .filter(Boolean).slice(0, 5000);
  const next = {
    ...source,
    schemaVersion: 3,
    locationMigrationVersion: 1,
    unitMetadataMigrationVersion: 2,
    unitCatalogMigrationVersion: 1,
    barcodeSchemaVersion: 1,
    locationDetailSchemaVersion: 2,
    categories,
    products,
    unitDefinitions,
    locations,
    ...(purgedLocationIds.length ? { purgedLocationIds } : {}),
    balances,
    movements,
    transfers: normalizeStockTransfers(source.transfers, productsById, locations, purgedLocationIds),
    counts: normalizeStockCounts(source.counts || source.stockCounts, productsById, locations, purgedLocationIds),
    operationKeys: normalizeStockOperationKeys(source.operationKeys),
    notificationSettings: source.notificationSettings && typeof source.notificationSettings === "object" && !Array.isArray(source.notificationSettings)
      ? source.notificationSettings
      : {},
    migrationAudit: normalizeStockMigrationAudit(source.migrationAudit, legacyMigrationRequired, balances, workshopLocation)
  };
  // `stockQuantity` remains a calculated legacy projection so current public
  // API consumers keep working, but every persistent balance is location-bound.
  const totals = new Map();
  balances.forEach((balance) => totals.set(String(balance.productId), (totals.get(String(balance.productId)) || 0) + Number(balance.quantity || 0)));
  next.products = next.products.map((product) => {
    const stockQuantity = Math.max(0, finiteNumber(totals.get(String(product.id)), 0));
    const reconciliationRequired = balances.some((balance) => String(balance.productId) === String(product.id)
      && balance.reconciliationRequired === true);
    return {
      ...product,
      stockQuantity,
      stockQuantityText: reconciliationRequired
        ? "Mutabakat gerekiyor"
        : `${stockQuantity} ${product.unit || "birim tanımsız"}`,
      stockQuantityReconciliationRequired: reconciliationRequired,
      needsAttention: product.needsAttention === true || reconciliationRequired
    };
  });
  return next;
}

const DEFAULT_STOCK_BASE_UNITS = Object.freeze(["adet", "şişe", "litre", "ml", "kg", "gr", "metre"]);

const DEFAULT_STOCK_BULK_UNITS = Object.freeze(["koli", "kasa", "paket", "kutu", "çuval"]);

function normalizeStockUnitDefinitions(value, products = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const base = source ? normalizeStockUnitList(source.base || source.baseUnits) : DEFAULT_STOCK_BASE_UNITS.slice();
  const bulk = source ? normalizeStockUnitList(source.bulk || source.bulkUnits) : DEFAULT_STOCK_BULK_UNITS.slice();
  for (const product of normalizeArray(products)) {
    const baseUnit = normalizeStockUnit(product && (product.baseUnit || product.unit));
    const bulkUnit = normalizeStockUnit(product && (product.bulkUnit || product.caseUnit));
    if (baseUnit && !base.includes(baseUnit)) base.push(baseUnit);
    if (bulkUnit && !bulk.includes(bulkUnit)) bulk.push(bulkUnit);
  }
  return {
    base: base.slice(0, 200),
    bulk: bulk.slice(0, 200),
    updatedAt: source && source.updatedAt || null,
    updatedBy: source && String(source.updatedBy || "") || ""
  };
}

function normalizeStockUnitList(value) {
  const seen = new Set();
  const result = [];
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  for (const item of source) {
    const unit = normalizeStockUnit(item);
    const key = stockUnitIdentity(unit);
    if (!unit || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(unit);
  }
  return result;
}

function stockUnitIdentity(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ");
}

function normalizeStockLocations(value, purgedLocationIds = []) {
  const required = [
    { id: "stock-location-cafe", code: "ATOLYE", name: "Bakım Atölyesi", type: "workshop", personnelVisible: true, active: true, sortOrder: 10, isDefault: true },
    { id: "stock-location-general", code: "GENEL", name: "Genel Depo", type: "central", personnelVisible: false, active: true, sortOrder: 20, isDefault: false }
  ];
  const source = normalizeArray(value);
  const seenIds = new Set();
  const seenCodes = new Set();
  const result = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = String(item.id || "").trim().slice(0, 180);
    const rawCode = String(item.code || "").trim().toLocaleUpperCase("tr-TR").replace(/[^A-Z0-9_-]/g, "").slice(0, 48);
    const isLegacyWorkshop = id === "stock-location-cafe" || rawCode === "CAFE" || item.type === "cafe";
    const code = isLegacyWorkshop ? "ATOLYE" : rawCode;
    if (!id || !code || seenIds.has(id) || seenCodes.has(code)) continue;
    seenIds.add(id);
    seenCodes.add(code);
    result.push({
      ...item,
      id,
      code,
      name: isLegacyWorkshop && (!item.name || String(item.name).trim().toLocaleLowerCase("tr-TR") === "kafe deposu")
        ? "Bakım Atölyesi"
        : String(item.name || code).trim().slice(0, 120) || code,
      description: String(item.description || "").trim().slice(0, 500),
      photoUrl: String(item.photoUrl || item.locationPhotoUrl || item.imageUrl || "").trim().slice(0, 2048),
      type: isLegacyWorkshop ? "workshop" : ["workshop", "central", "other"].includes(item.type) ? item.type : "other",
      barcodeValue: String(item.barcodeValue || item.locationBarcode || "").trim().replace(/\s+/g, "").slice(0, 120),
      personnelVisible: typeof item.personnelVisible === "boolean" ? item.personnelVisible : isLegacyWorkshop || item.type === "workshop",
      active: item.active !== false && item.trashed !== true && !item.removedAt && !item.purgedAt && !item.archivedAt,
      sortOrder: Math.max(0, Math.trunc(finiteNumber(item.sortOrder, result.length * 10))),
      isDefault: item.isDefault === true,
      assignedPersonnelIds: normalizeArray(item.assignedPersonnelIds).map((idValue) => String(idValue || "").trim()).filter(Boolean).slice(0, 1000),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
      deactivatedAt: item.active === false ? item.deactivatedAt || item.updatedAt || null : null
    });
  }
  for (const location of required) {
    if (purgedLocationIds.includes(location.id)) continue;
    const existing = result.find((item) => item.code === location.code || item.id === location.id);
    if (existing) {
      if (!existing.id) existing.id = location.id;
      if (location.code === "ATOLYE" && existing.active !== false && !result.some((item) => item.active !== false && item.isDefault)) existing.isDefault = true;
      continue;
    }
    result.push({ ...location, description: "", photoUrl: "", assignedPersonnelIds: [], createdAt: null, updatedAt: null, deactivatedAt: null });
  }
  if (!result.some((item) => item.active !== false && item.isDefault)) {
    const workshop = result.find((item) => item.active !== false && item.code === "ATOLYE");
    if (workshop) workshop.isDefault = true;
  }
  const defaultLocation = result.find((item) => item.active !== false && item.isDefault)
    || result.find((item) => item.active !== false && item.code === "ATOLYE")
    || result.find((item) => item.active !== false)
    || result.find((item) => item.isDefault)
    || result.find((item) => item.code === "ATOLYE")
    || result[0];
  for (const location of result) location.isDefault = Boolean(defaultLocation && location.id === defaultLocation.id);
  return result.sort((first, second) => Number(first.sortOrder || 0) - Number(second.sortOrder || 0) || String(first.name).localeCompare(String(second.name), "tr"));
}

function normalizeStockBalances(value, products, locations, legacyMigrationRequired, legacyLocationId, purgedLocationIds = []) {
  const validProducts = new Set(products.map((product) => String(product.id)));
  const validLocations = new Set([...locations.map((location) => String(location.id)), ...purgedLocationIds]);
  const seen = new Set();
  const balances = [];
  if (!legacyMigrationRequired) {
    for (const item of normalizeArray(value)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const locationId = String(item.locationId || "").trim();
      const productId = String(item.productId || item.stockProductId || "").trim();
      const key = `${locationId}\u0000${productId}`;
      if (!validLocations.has(locationId) || !validProducts.has(productId) || seen.has(key)) continue;
      seen.add(key);
      balances.push({
        ...item,
        id: String(item.id || stableStockId("stock-balance", key)),
        locationId,
        productId,
        quantity: Math.max(0, finiteNumber(item.quantity ?? item.stockQuantity, 0)),
        revision: Math.max(0, Math.trunc(finiteNumber(item.revision, 0))),
        criticalThreshold: Math.max(0, finiteNumber(item.criticalThreshold, 0)),
        orderThreshold: Math.max(0, finiteNumber(item.orderThreshold ?? item.warningThreshold, 0)),
        targetLevel: Math.max(0, finiteNumber(item.targetLevel, 0)),
        reconciliationRequired: item.reconciliationRequired === true,
        reconciliationReasonCode: String(item.reconciliationReasonCode || "").trim().slice(0, 80),
        reconciliationReason: String(item.reconciliationReason || item.reason || "").trim().slice(0, 500),
        previousQuantity: item.previousQuantity === null || item.previousQuantity === undefined
          ? null
          : Math.max(0, finiteNumber(item.previousQuantity, 0)),
        previousBaseUnit: normalizeStockUnit(item.previousBaseUnit || ""),
        targetBaseUnit: normalizeStockUnit(item.targetBaseUnit || ""),
        baseUnitSnapshot: normalizeStockUnit(item.baseUnitSnapshot || item.balanceBaseUnit || ""),
        bulkUnitSnapshot: normalizeStockUnit(item.bulkUnitSnapshot || ""),
        unitsPerBulkUnitSnapshot: Math.max(0, finiteNumber(item.unitsPerBulkUnitSnapshot, 0)),
        unitSchemaVersionAtBalance: Math.max(1, Math.trunc(finiteNumber(item.unitSchemaVersionAtBalance, 1))),
        reconciliationCreatedAt: item.reconciliationCreatedAt || null,
        reconciliationResolvedAt: item.reconciliationResolvedAt || null,
        cabinet: String(item.cabinet || item.cabinetName || "").trim().slice(0, 120),
        shelf: String(item.shelf || item.shelfName || "").trim().slice(0, 120),
        bin: String(item.bin || item.binName || item.compartment || "").trim().slice(0, 120),
        compartment: String(item.compartment || item.bin || item.binName || "").trim().slice(0, 120),
        placementName: stockPlacementName(item),
        placementX: item.placementX != null && Number.isFinite(Number(item.placementX)) && Number(item.placementX) >= 0 && Number(item.placementX) <= 100 ? Number(item.placementX) : null,
        placementY: item.placementY != null && Number.isFinite(Number(item.placementY)) && Number(item.placementY) >= 0 && Number(item.placementY) <= 100 ? Number(item.placementY) : null,
        placementPhotoUrl: String(item.placementPhotoUrl || item.shelfPhotoUrl || item.rackPhotoUrl || "").trim().slice(0, 2048),
        updatedAt: item.updatedAt || null
      });
    }
  }
  for (const product of products) {
    for (const location of locations) {
      const key = `${location.id}\u0000${product.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const quantity = legacyMigrationRequired && location.id === legacyLocationId
        ? Math.max(0, finiteNumber(product.stockQuantity ?? product.quantity ?? product.stock, 0))
        : 0;
      // İlk lokasyon migration'ında eski tekil stok Bakım Atölyesine bağlanır.
      // Daha önce tamamlanmış store'lar bu kola girmez; mevcut dağılım korunur.
      const inheritLegacyThresholds = location.id === legacyLocationId;
      balances.push({
        id: stableStockId("stock-balance", key),
        locationId: location.id,
        productId: product.id,
        quantity,
        revision: 0,
        criticalThreshold: inheritLegacyThresholds ? Math.max(0, finiteNumber(product.criticalThreshold, 0)) : 0,
        orderThreshold: inheritLegacyThresholds ? Math.max(0, finiteNumber(product.orderThreshold ?? product.warningThreshold, 0)) : 0,
        targetLevel: inheritLegacyThresholds ? Math.max(0, finiteNumber(product.targetLevel, 0)) : 0,
        reconciliationRequired: false,
        reconciliationReasonCode: "",
        reconciliationReason: "",
        previousQuantity: null,
        previousBaseUnit: "",
        targetBaseUnit: "",
        baseUnitSnapshot: normalizeStockUnit(product.baseUnit || product.unit
          || (product.baseUnitMissing === true || product.excelBaseUnitMissing === true ? "" : "adet")),
        bulkUnitSnapshot: normalizeStockUnit(product.bulkUnit || product.caseUnit || ""),
        unitsPerBulkUnitSnapshot: Math.max(0, finiteNumber(product.unitsPerBulkUnit ?? product.unitsPerCase, 0)),
        unitSchemaVersionAtBalance: Math.max(1, Math.trunc(finiteNumber(product.unitSchemaVersion, 1))),
        reconciliationCreatedAt: null,
        reconciliationResolvedAt: null,
        cabinet: "",
        shelf: "",
        bin: "",
        compartment: "",
        placementName: "",
        placementPhotoUrl: "",
        placementX: null,
        placementY: null,
        updatedAt: product.updatedAt || null
      });
    }
  }
  return balances;
}

function stockPlacementName(item) {
  const explicit = String(item && (item.placementName || item.storagePlacement || item.placeName) || "").trim();
  if (explicit) return explicit.slice(0, 180);
  return [
    item && (item.cabinet || item.cabinetName) ? `Dolap ${item.cabinet || item.cabinetName}` : "",
    item && (item.shelf || item.shelfName) ? `Raf ${item.shelf || item.shelfName}` : "",
    item && (item.bin || item.binName || item.compartment) ? `Bölme ${item.bin || item.binName || item.compartment}` : ""
  ].filter(Boolean).join(" · ").slice(0, 180);
}

function normalizeStockMigrationAudit(value, legacyMigrationRequired, balances, destinationLocation) {
  const source = normalizeArray(value).filter((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!legacyMigrationRequired || source.some((item) => item.id === "stock-location-migration-v1")) return source.slice(-100);
  const destinationLocationId = String(destinationLocation && destinationLocation.id || "stock-location-cafe");
  const migratedQuantity = balances
    .filter((balance) => String(balance.locationId) === destinationLocationId)
    .reduce((total, balance) => total + Number(balance.quantity || 0), 0);
  return source.concat({
    id: "stock-location-migration-v1",
    type: "legacy_single_balance_to_cafe",
    destinationLocationId,
    migratedProductCount: balances.filter((balance) => String(balance.locationId) === destinationLocationId && Number(balance.quantity || 0) > 0).length,
    migratedQuantity: Math.max(0, finiteNumber(migratedQuantity, 0)),
    appliedAt: null
  }).slice(-100);
}

function normalizeStockTransfers(value, productsById, locations, purgedLocationIds = []) {
  const locationIds = new Set([...locations.map((location) => String(location.id)), ...purgedLocationIds]);
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim();
    const productId = String(item.productId || item.stockProductId || item.items && item.items[0] && (item.items[0].productId || item.items[0].stockProductId) || "").trim();
    const fromLocationId = String(item.fromLocationId || "").trim();
    const toLocationId = String(item.toLocationId || "").trim();
    if (!id || seen.has(id) || !productsById.has(productId) || !locationIds.has(fromLocationId) || !locationIds.has(toLocationId) || fromLocationId === toLocationId) return null;
    seen.add(id);
    const rawItems = normalizeArray(item.items).length ? normalizeArray(item.items) : [item];
    const itemIds = new Set();
    const items = rawItems.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const entryProductId = String(entry.productId || entry.stockProductId || "").trim();
      const product = productsById.get(entryProductId);
      if (!product || itemIds.has(entryProductId)) return null;
      itemIds.add(entryProductId);
      const baseUnit = normalizeStockUnit(entry.baseUnit || product.baseUnit || product.unit || "adet");
      const snapshot = entry.conversionSnapshot && typeof entry.conversionSnapshot === "object" && !Array.isArray(entry.conversionSnapshot)
        ? { ...entry.conversionSnapshot }
        : null;
      const schemaVersionValue = entry.unitSchemaVersion ?? (snapshot && snapshot.unitSchemaVersion);
      const unitSchemaVersion = Number.isInteger(Number(schemaVersionValue)) && Number(schemaVersionValue) > 0
        ? Math.trunc(Number(schemaVersionValue))
        : null;
      return {
        productId: entryProductId,
        quantity: Math.max(0, finiteNumber(entry.quantity, 0)),
        baseUnit,
        sourceQuantity: Math.max(0, finiteNumber(entry.sourceQuantity ?? entry.quantity, 0)),
        sourceUnit: normalizeStockUnit(entry.sourceUnit || entry.inputUnit || entry.baseUnit || baseUnit),
        unitSchemaVersion,
        conversionFactor: Math.max(0, finiteNumber(entry.conversionFactor, 1)),
        conversionSnapshot: snapshot ? { ...snapshot, unitSchemaVersion } : null,
        sourceExpectedRevision: entry.sourceExpectedRevision === null || entry.sourceExpectedRevision === undefined
          ? null
          : Math.max(0, Math.trunc(finiteNumber(entry.sourceExpectedRevision, 0))),
        destinationExpectedRevision: entry.destinationExpectedRevision === null || entry.destinationExpectedRevision === undefined
          ? null
          : Math.max(0, Math.trunc(finiteNumber(entry.destinationExpectedRevision, 0)))
      };
    }).filter((entry) => entry && entry.quantity > 0);
    if (!items.length) return null;
    const firstItem = items[0];
    return {
      ...item,
      id,
      status: ["draft", "pending", "approved", "rejected", "cancelled"].includes(item.status) ? item.status : "pending",
      productId: firstItem.productId,
      items,
      fromLocationId,
      toLocationId,
      quantity: firstItem.quantity,
      baseUnit: firstItem.baseUnit,
      sourceQuantity: firstItem.sourceQuantity,
      sourceUnit: firstItem.sourceUnit,
      unitSchemaVersion: firstItem.unitSchemaVersion,
      conversionFactor: firstItem.conversionFactor,
      conversionSnapshot: firstItem.conversionSnapshot,
      requestedBy: String(item.requestedBy || ""),
      requestedByName: String(item.requestedByName || ""),
      requestId: String(item.requestId || ""),
      transactionRef: String(item.transactionRef || "") || null,
      movementIds: normalizeArray(item.movementIds).map((movementId) => String(movementId || "").trim()).filter(Boolean),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || item.createdAt || null
    };
  }).filter(Boolean).slice(0, 2000);
}

function normalizeStockCounts(value, productsById, locations, purgedLocationIds = []) {
  const locationIds = new Set([...locations.map((location) => String(location.id)), ...purgedLocationIds]);
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || "").trim();
    const locationId = String(item.locationId || "").trim();
    if (!id || seen.has(id) || !locationIds.has(locationId)) return null;
    seen.add(id);
    const items = normalizeArray(item.items).map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const productId = String(entry.productId || entry.stockProductId || "").trim();
      const product = productsById.get(productId);
      if (!product) return null;
      const systemQuantity = Math.max(0, finiteNumber(entry.systemQuantity ?? entry.expectedQuantity, 0));
      const countedValue = entry.countedQuantity ?? entry.physicalQuantity;
      const countedQuantity = countedValue === null || countedValue === undefined || countedValue === ""
        ? null
        : Math.max(0, finiteNumber(countedValue, 0));
      return {
        ...entry,
        id: String(entry.id || stableStockId("stock-count-item", `${id}\u0000${productId}\u0000${index}`)),
        productId,
        systemQuantity,
        countedQuantity,
        inputQuantity: countedQuantity === null ? null : Math.max(0, finiteNumber(entry.inputQuantity ?? countedQuantity, countedQuantity)),
        inputUnit: normalizeStockUnit(entry.inputUnit || entry.unit || product.baseUnit || product.unit),
        conversionFactor: Math.max(0, finiteNumber(entry.conversionFactor, 1)),
        difference: countedQuantity === null ? null : finiteNumber(entry.difference, countedQuantity - systemQuantity),
        note: String(entry.note || "").trim().slice(0, 500),
        movementId: entry.movementId ? String(entry.movementId) : null,
        updatedAt: entry.updatedAt || null
      };
    }).filter(Boolean);
    return {
      ...item,
      id,
      locationId,
      status: ["active", "completed", "cancelled"].includes(item.status) ? item.status : "active",
      items,
      startedBy: String(item.startedBy || item.createdBy || ""),
      startedByName: String(item.startedByName || item.createdByName || ""),
      completedBy: item.completedBy ? String(item.completedBy) : null,
      cancelledBy: item.cancelledBy ? String(item.cancelledBy) : null,
      requestId: String(item.requestId || ""),
      movementIds: normalizeArray(item.movementIds).map((movementId) => String(movementId || "").trim()).filter(Boolean),
      note: String(item.note || "").trim().slice(0, 500),
      createdAt: item.createdAt || item.startedAt || null,
      startedAt: item.startedAt || item.createdAt || null,
      updatedAt: item.updatedAt || item.startedAt || item.createdAt || null,
      completedAt: item.completedAt || null,
      cancelledAt: item.cancelledAt || null,
      appliedAt: item.appliedAt || null
    };
  }).filter(Boolean).slice(0, 1000);
}

function normalizeStockOperationKeys(value) {
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const key = String(item.key || "").trim().slice(0, 260);
    if (!key || seen.has(key)) return null;
    seen.add(key);
    return { ...item, key, type: String(item.type || ""), requestId: String(item.requestId || ""), value: item.value && typeof item.value === "object" ? item.value : {}, createdAt: item.createdAt || null };
  }).filter(Boolean).slice(-1000);
}

function normalizeStockCategory(category, index) {
  if (!category || typeof category !== "object" || Array.isArray(category)) return null;
  const name = String(category.name || `Kategori ${index + 1}`).trim();
  return {
    ...category,
    id: String(category.id || stableStockId("stock-category", name || index)),
    name,
    active: category.active !== false,
    order: finiteNumber(category.order, index),
    ...normalizeSourceMetadata(category)
  };
}

function normalizeStockProduct(product, index, categoryNames) {
  if (!product || typeof product !== "object" || Array.isArray(product)) return null;
  const categoryId = String(product.categoryId || stableStockId("stock-category", product.category || "Genel")).trim();
  const preserveMissingExcelBaseUnit = product.excelBaseUnitMissing === true || product.baseUnitMissing === true || product.excelSourceBaseUnitMissing === true;
  const baseUnit = preserveMissingExcelBaseUnit
    ? normalizeStockUnit(product.baseUnit || product.unit || "")
    : normalizeStockUnit(product.baseUnit || product.unit || "adet") || "adet";
  const bulkUnit = normalizeStockUnit(product.bulkUnit || product.caseUnit || product.purchaseUnit || "");
  const packageMetadata = product.packageInfo && typeof product.packageInfo === "object" ? product.packageInfo : {};
  const unitsPerBulkUnit = Math.max(0, finiteNumber(
    product.unitsPerBulkUnit ?? product.unitsPerCase ?? product.packageSize ?? product.packSize
      ?? product.piecesPerBox ?? product.koliIci ?? packageMetadata.unitsPerCase ?? packageMetadata.quantity,
    0
  ));
  const allowDecimal = typeof product.allowDecimal === "boolean"
    ? product.allowDecimal
    : ["kg", "gr", "litre", "ml"].includes(baseUnit);
  const requestedDefaultUnit = normalizeStockUnit(product.defaultMovementUnit || baseUnit);
  const defaultMovementUnit = requestedDefaultUnit === bulkUnit && bulkUnit && unitsPerBulkUnit > 0
    ? bulkUnit
    : baseUnit;
  const normalizedSchema = normalizeStockUnitSchemaHistory(product, {
    baseUnit,
    bulkUnit,
    unitsPerBulkUnit,
    allowDecimal,
    defaultMovementUnit
  });
  const primaryBarcode = normalizeStockBarcodeValue(product.barcode || product.gtin || "");
  const barcodes = normalizeStockBarcodeRecords(product, baseUnit, primaryBarcode);
  const missingSourceAttention = product.excelSourceBaseUnitMissing === true ? {
    needsAttention: true,
    attentionReasons: [...new Set([...normalizeArray(product.attentionReasons), "MISSING_BASE_UNIT"])],
    attentionMessages: [...new Set([
      ...normalizeArray(product.attentionMessages).filter((message) => !/temel birim.*eksik/i.test(String(message))),
      "Excel dosyasında temel birim eksik." + (baseUnit ? " Mevcut temel birim korunuyor." : "")
    ])]
  } : {};
  return {
    ...product,
    ...missingSourceAttention,
    id: String(product.id || stableStockId("stock-product", `${categoryId}\u0000${product.productName || product.name || index}`)),
    categoryId,
    category: String(product.category || categoryNames.get(categoryId) || "Genel"),
    productName: String(product.productName || product.name || `Stok Ürünü ${index + 1}`),
    name: String(product.name || product.productName || `Stok Ürünü ${index + 1}`),
    unit: baseUnit,
    baseUnit,
    bulkUnit,
    caseUnit: bulkUnit,
    unitsPerBulkUnit,
    unitsPerCase: unitsPerBulkUnit,
    allowDecimal,
    defaultMovementUnit,
    baseUnitMissing: preserveMissingExcelBaseUnit && !baseUnit,
    unitSchemaVersion: normalizedSchema.version,
    unitSchemaHistory: normalizedSchema.history,
    unitSchemaSource: ["manual", "excel", "legacy"].includes(String(product.unitSchemaSource || ""))
      ? String(product.unitSchemaSource)
      : (product.sourceType === "excel" ? "excel" : product.sourceType === "manual" ? "manual" : "legacy"),
    unitSchemaLocked: product.unitSchemaLocked === true,
    unitSchemaUpdatedAt: product.unitSchemaUpdatedAt || null,
    stockQuantity: Math.max(0, finiteNumber(product.stockQuantity ?? product.quantity ?? product.stock, 0)),
    stockQuantityText: String(product.stockQuantityText ?? product.quantityText ?? product.stockQuantity ?? product.quantity ?? product.stock ?? ""),
    orderThreshold: Math.max(0, finiteNumber(product.orderThreshold ?? product.warningThreshold, 0)),
    orderThresholdText: String(product.orderThresholdText ?? product.warningThresholdText ?? product.orderThreshold ?? product.warningThreshold ?? ""),
    criticalThreshold: Math.max(0, finiteNumber(product.criticalThreshold, 0)),
    targetLevel: Math.max(0, finiteNumber(product.targetLevel, 0)),
    brand: String(product.brand || product.supplier || ""),
    supplier: String(product.supplier || product.brand || ""),
    manufacturerCode: String(product.manufacturerCode || product.partNumber || "").trim().slice(0, 120),
    compatibleMachines: [...new Set((Array.isArray(product.compatibleMachines) ? product.compatibleMachines : String(product.compatibleMachines || product.machineCompatibility || "").split(","))
      .map((item) => String(item || "").trim().slice(0, 120)).filter(Boolean))].slice(0, 50),
    technicalDocumentUrl: String(product.technicalDocumentUrl || product.technicalDocument || "").trim().slice(0, 2048),
    note: String(product.note || ""),
    imageUrl: String(product.imageUrl || product.image || ""),
    barcode: primaryBarcode,
    barcodes,
    alternativeBarcodes: barcodes.filter((record) => record.value !== primaryBarcode).map((record) => record.value),
    active: product.active !== false,
    updatedAt: product.updatedAt || null,
    ...normalizeSourceMetadata(product)
  };
}

function normalizeStockBarcodeValue(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.value ?? value.barcode ?? value.code ?? value.gtin ?? ""
    : value;
  const barcode = String(source ?? "").normalize("NFC").trim().replace(/[\r\n]+$/g, "");
  return barcode && barcode.length <= 240 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001c\u007f]/u.test(barcode)
    ? barcode
    : "";
}

function normalizeStockBarcodeRecords(product, baseUnit, primaryBarcode) {
  const source = [];
  if (primaryBarcode) source.push({
    value: primaryBarcode,
    verified: product.barcodeVerified !== false,
    kind: "single",
    unit: baseUnit,
    quantity: 1
  });
  if (Array.isArray(product.barcodes)) source.push(...product.barcodes);
  if (Array.isArray(product.alternativeBarcodes)) source.push(...product.alternativeBarcodes);
  const seen = new Set();
  const records = [];
  for (const item of source) {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item : { value: item };
    const value = normalizeStockBarcodeValue(record);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const quantity = finiteNumber(record.quantity ?? record.unitsPerPack ?? record.baseQuantity, 1);
    records.push({
      value,
      verified: record.verified !== false,
      kind: ["single", "pack", "case", "gs1"].includes(String(record.kind || record.type || ""))
        ? String(record.kind || record.type)
        : "single",
      unit: normalizeStockUnit(record.unit || record.packageUnit || baseUnit) || baseUnit,
      quantity: quantity > 0 ? quantity : 1
    });
    if (records.length >= 100) break;
  }
  return records;
}

function normalizeStockUnit(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value.value ?? value.code ?? value.unit ?? value.baseUnit ?? value.name ?? value.label ?? ""
    : value;
  const unit = String(source || "").trim().toLocaleLowerCase("tr-TR");
  const ascii = unit.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalized = {
    l: "litre", lt: "litre", liter: "litre", litre: "litre",
    kilogram: "kg", kilo: "kg", gram: "gr",
    tane: "adet", adet: "adet", sise: "şişe", "şişe": "şişe",
    kutu: "kutu", paket: "paket", koli: "koli", kasa: "kasa", cuval: "çuval", "çuval": "çuval"
  }[ascii] || unit;
  return normalized && normalized.length <= 30 && /^[\p{L}\p{N} _-]+$/u.test(normalized) ? normalized : "";
}

function normalizeStockUnitSchemaHistory(product, activeSchema) {
  const requestedVersion = Math.max(1, Math.trunc(finiteNumber(product.unitSchemaVersion, 1)));
  const history = normalizeArray(product.unitSchemaHistory).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const version = Math.max(1, Math.trunc(finiteNumber(entry.version, 0)));
    const baseUnit = normalizeStockUnit(entry.baseUnit || entry.unit || "");
    if (!baseUnit) return null;
    const bulkUnit = normalizeStockUnit(entry.bulkUnit || entry.caseUnit || "");
    const unitsPerBulkUnit = bulkUnit
      ? Math.max(0, finiteNumber(entry.unitsPerBulkUnit ?? entry.unitsPerCase, 0))
      : 0;
    return {
      version,
      baseUnit,
      bulkUnit,
      unitsPerBulkUnit,
      allowDecimal: typeof entry.allowDecimal === "boolean" ? entry.allowDecimal : ["kg", "gr", "litre", "ml"].includes(baseUnit),
      defaultMovementUnit: normalizeStockUnit(entry.defaultMovementUnit || baseUnit) || baseUnit,
      validFrom: entry.validFrom || null,
      validUntil: entry.validUntil || null
    };
  }).filter(Boolean).sort((left, right) => left.version - right.version);
  const sameSchema = (entry) => entry
    && entry.baseUnit === activeSchema.baseUnit
    && entry.bulkUnit === activeSchema.bulkUnit
    && Number(entry.unitsPerBulkUnit || 0) === Number(activeSchema.unitsPerBulkUnit || 0)
    && entry.allowDecimal === activeSchema.allowDecimal
    && entry.defaultMovementUnit === activeSchema.defaultMovementUnit;
  const maxVersion = history.reduce((maximum, entry) => Math.max(maximum, entry.version), 0);
  let version = Math.max(requestedVersion, maxVersion || 1);
  let activeEntry = history.find((entry) => entry.version === version && sameSchema(entry));
  if (!activeEntry) {
    if (history.length) version = Math.max(version, maxVersion + 1);
    activeEntry = {
      version,
      ...activeSchema,
      validFrom: product.unitSchemaUpdatedAt || product.createdAt || null,
      validUntil: null
    };
    history.push(activeEntry);
  }
  history.sort((left, right) => left.version - right.version);
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index];
    const next = history[index + 1];
    if (entry.version === version) entry.validUntil = null;
    else if (!entry.validUntil && next && next.validFrom) entry.validUntil = next.validFrom;
  }
  return { version, history };
}

function normalizeStockMovement(movement, productsById = new Map(), legacyGeneralLocationId = "stock-location-general") {
  if (!movement || typeof movement !== "object" || Array.isArray(movement)) return null;
  const productId = String(movement.stockProductId || movement.productId || "");
  const product = productsById.get(productId);
  const baseUnit = normalizeStockUnit(movement.baseUnit || movement.unit || product && (product.baseUnit || product.unit) || "adet") || "adet";
  const sourceQuantity = Math.max(0, finiteNumber(movement.inputQuantity ?? movement.sourceQuantity ?? movement.quantity, 0));
  const sourceUnit = normalizeStockUnit(movement.inputUnit || movement.sourceUnit || movement.unit || baseUnit) || baseUnit;
  const previousBalance = Math.max(0, finiteNumber(movement.previousBalance ?? movement.previousStock, 0));
  const resultingBalance = Math.max(0, finiteNumber(movement.resultingBalance ?? movement.resultingStock, 0));
  const inferredDelta = resultingBalance - previousBalance;
  const baseQuantityDelta = finiteNumber(movement.baseQuantityDelta, inferredDelta);
  const explicitSnapshot = movement.conversionSnapshot && typeof movement.conversionSnapshot === "object" && !Array.isArray(movement.conversionSnapshot)
    ? movement.conversionSnapshot
    : null;
  const schemaVersionValue = movement.unitSchemaVersion ?? (explicitSnapshot && explicitSnapshot.unitSchemaVersion);
  const unitSchemaVersion = Number.isInteger(Number(schemaVersionValue)) && Number(schemaVersionValue) > 0
    ? Math.trunc(Number(schemaVersionValue))
    : null;
  const hasMovementFactor = movement.conversionFactor !== null
    && movement.conversionFactor !== undefined
    && movement.conversionFactor !== "";
  const hasSnapshotFactor = explicitSnapshot
    && explicitSnapshot.factor !== null
    && explicitSnapshot.factor !== undefined
    && explicitSnapshot.factor !== "";
  const explicitConversionFactor = hasMovementFactor && Number.isFinite(Number(movement.conversionFactor))
    ? Number(movement.conversionFactor)
    : hasSnapshotFactor && Number.isFinite(Number(explicitSnapshot.factor)) ? Number(explicitSnapshot.factor) : null;
  const conversionSnapshot = explicitSnapshot
    ? {
        ...explicitSnapshot,
        baseUnit: normalizeStockUnit(explicitSnapshot.baseUnit || baseUnit) || baseUnit,
        bulkUnit: normalizeStockUnit(explicitSnapshot.bulkUnit || ""),
        unitsPerBulkUnit: Math.max(0, finiteNumber(explicitSnapshot.unitsPerBulkUnit ?? explicitSnapshot.unitsPerCase, 0)),
        inputUnit: normalizeStockUnit(explicitSnapshot.inputUnit || sourceUnit) || sourceUnit,
        factor: hasSnapshotFactor && Number.isFinite(Number(explicitSnapshot.factor)) ? Number(explicitSnapshot.factor) : explicitConversionFactor,
        unitSchemaVersion
      }
    : {
        baseUnit,
        bulkUnit: "",
        unitsPerBulkUnit: 0,
        inputUnit: sourceUnit,
        factor: explicitConversionFactor,
        unitSchemaVersion: null,
        legacyInferred: true
      };
  return {
    ...movement,
    id: String(movement.id || stableStockId("stock-movement", `${movement.productId || ""}\u0000${movement.createdAt || Date.now()}`)),
    productId: String(movement.productId || movement.stockProductId || ""),
    stockProductCode: normalizeProductCode(movement.stockProductCode || product && product.productCode),
    productName: String(movement.productName || ""),
    type: ["opening_balance", "manual_in", "manual_out", "waste", "inbound_shipment", "shipment_in", "transfer", "transfer_out", "transfer_in", "adjustment", "correction", "reversal", "stock_in", "stock_out", "order_suggestion", "import"].includes(movement.type) ? movement.type : "stock_out",
    quantity: Math.max(0, finiteNumber(movement.quantity, 0)),
    baseQuantity: Math.max(0, finiteNumber(movement.baseQuantity ?? movement.quantity, Math.abs(baseQuantityDelta))),
    unit: baseUnit,
    baseUnit,
    sourceQuantity,
    sourceUnit,
    inputQuantity: sourceQuantity,
    inputUnit: sourceUnit,
    baseQuantityDelta,
    unitSchemaVersion,
    conversionSnapshot,
    conversionFactor: explicitConversionFactor,
    locationId: String(movement.locationId || movement.toLocationId || movement.fromLocationId || legacyGeneralLocationId || ""),
    fromLocationId: movement.fromLocationId ? String(movement.fromLocationId) : null,
    toLocationId: movement.toLocationId ? String(movement.toLocationId) : null,
    transactionRef: String(movement.transactionRef || ""),
    transferId: String(movement.transferId || movement.referenceType === "transfer" && movement.referenceId || ""),
    referenceType: String(movement.referenceType || ""),
    referenceId: String(movement.referenceId || ""),
    previousBalance,
    resultingBalance,
    previousStock: previousBalance,
    resultingStock: resultingBalance,
    shipmentId: String(movement.shipmentId || ""),
    personnelId: String(movement.personnelId || movement.userId || ""),
    approvedBy: String(movement.approvedBy || ""),
    actorId: String(movement.actorId || movement.personnelId || movement.userId || ""),
    requestId: String(movement.requestId || ""),
    idempotencyKey: String(movement.idempotencyKey || movement.requestId || ""),
    expectedRevision: movement.expectedRevision === null || movement.expectedRevision === undefined
      ? null
      : Math.max(0, Math.trunc(finiteNumber(movement.expectedRevision, 0))),
    reason: String(movement.reason || ""),
    note: String(movement.note || ""),
    actor: String(movement.actor || "system"),
    createdAt: movement.createdAt || new Date(0).toISOString(),
    approvedAt: movement.approvedAt || movement.createdAt || new Date(0).toISOString(),
    reversedMovementId: movement.reversedMovementId || null
  };
}

function defaultStockState() {
  return {
    schemaVersion: 3,
    locationMigrationVersion: 1,
    unitMetadataMigrationVersion: 2,
    unitCatalogMigrationVersion: 1,
    barcodeSchemaVersion: 1,
    locationDetailSchemaVersion: 2,
    unitDefinitions: {
      base: DEFAULT_STOCK_BASE_UNITS.slice(),
      bulk: DEFAULT_STOCK_BULK_UNITS.slice(),
      updatedAt: null,
      updatedBy: ""
    },
    categories: [],
    products: [],
    locations: [
      { id: "stock-location-cafe", code: "ATOLYE", name: "Bakım Atölyesi", type: "workshop", personnelVisible: true, barcodeValue: "ATOLYE-01", photoUrl: "", active: true, sortOrder: 10, isDefault: true, assignedPersonnelIds: [] },
      { id: "stock-location-general", code: "GENEL", name: "Genel Depo", type: "central", photoUrl: "", active: true, sortOrder: 20, isDefault: false, assignedPersonnelIds: [] }
    ],
    balances: [],
    movements: [],
    transfers: [],
    counts: [],
    operationKeys: [],
    notificationSettings: {}
  };
}

function normalizeSourceMetadata(value) {
  const source = value && typeof value === "object" ? value : {};
  const sourceType = ["excel", "manual", "legacy"].includes(source.sourceType) ? source.sourceType : "legacy";
  return {
    sourceType,
    sourceWorkbook: ["menu", "pricing", "recipe", "stock"].includes(source.sourceWorkbook) ? source.sourceWorkbook : "",
    sourceSheet: String(source.sourceSheet || ""),
    sourceNormalizedName: String(source.sourceNormalizedName || ""),
    productCode: normalizeProductCode(source.productCode),
    productCodeAliases: normalizeProductCodeList(source.productCodeAliases),
    nameHistory: normalizeNameHistory(source.nameHistory),
    importKey: String(source.importKey || ""),
    externalId: String(source.externalId || ""),
    aliasIds: normalizeArray(source.aliasIds).map((alias) => String(alias || "").trim()).filter(Boolean).slice(0, 100),
    sourcePresent: source.sourcePresent !== false,
    statusSource: String(source.statusSource || (sourceType === "legacy" ? "legacy" : "")),
    lastImportedAt: source.lastImportedAt || null,
    lastImportOperationId: String(source.lastImportOperationId || "")
  };
}

function collectWorkforceMigrationArchive(source) {
  const archived = new Map(normalizeArray(source.workforceMigrationArchive)
    .filter((item) => item && typeof item === "object" && item.id)
    .map((item) => [String(item.id), item]));
  const add = (scope, index, reason, record) => {
    const id = stableStockId("workforce-migration-archive", `${scope}\u0000${index}\u0000${reason}\u0000${JSON.stringify(record)}`);
    if (!archived.has(id)) archived.set(id, { id, scope, reason, sourceIndex: index, record });
  };

  for (const [scope, records] of [
    ["task", source.workforceTasks],
    ["shipment", source.workforceShipments],
    ["material_request", source.workforceMaterialRequests],
    ["shift_request", source.workforceShiftRequests],
    ["shift_revision", source.workforceShiftPlanRevisions]
  ]) {
    normalizeArray(records).forEach((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) add(scope, index, "invalid_record", record);
    });
  }

  const assignmentIdentities = new Set();
  normalizeArray(source.workforceAssignments).forEach((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      add("assignment", index, "invalid_record", record);
      return;
    }
    const taskId = String(record.taskId || "");
    const userId = String(record.userId || record.personnelId || record.personId || "");
    if (!taskId || !userId) {
      add("assignment", index, "missing_task_or_person", record);
      return;
    }
    const identity = `${taskId}\u0000${userId}`;
    if (assignmentIdentities.has(identity)) add("assignment", index, "duplicate_assignment", record);
    assignmentIdentities.add(identity);
  });

  const planIdentities = new Set();
  normalizeArray(source.workforceShiftPlans).forEach((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      add("shift_plan", index, "invalid_record", record);
      return;
    }
    const personId = String(record.personId || record.personnelId || record.userId || "");
    if (!personId) {
      add("shift_plan", index, "missing_person", record);
      return;
    }
    const status = ["published", "yayınlandı", "yayinlandi"].includes(record.status) ? "published" : "draft";
    const identity = `${record.weekStart || ""}\u0000${personId}\u0000${record.date || ""}\u0000${status}`;
    if (planIdentities.has(identity)) add("shift_plan", index, "duplicate_plan", record);
    planIdentities.add(identity);
  });

  return [...archived.values()].slice(-1000);
}

function normalizeProcurementStringArray(value, maxLength) {
  return [...new Set(normalizeArray(value)
    .map((item) => procurementText(item, maxLength))
    .filter(Boolean))];
}

function procurementText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function markWorkforcePersonnelState(data) {
  const users = new Map(normalizeArray(data.recipeUsers).map((user) => [String(user && user.id || ""), user]));
  const deleted = new Map(normalizeArray(data.deletedRecipeUsers).map((user) => [String(user && (user.id || user.userId) || ""), user]));
  const mark = (record, personId, nameFields = []) => {
    const id = String(personId || "");
    if (!record || !id || id === "admin") return;
    const user = users.get(id);
    if (user) {
      record.personInactive = user.active === false;
      return;
    }
    const tombstone = deleted.get(id);
    const currentName = nameFields.map((field) => String(record[field] || "").trim()).find(Boolean);
    record.personDeleted = true;
    record.personNameSnapshot = record.personNameSnapshot || currentName || tombstone && tombstone.name || "Silinmiş personel";
    record.personUsernameSnapshot = record.personUsernameSnapshot || tombstone && tombstone.username || "";
    record.personDeletedAt = record.personDeletedAt || tombstone && tombstone.deletedAt || null;
  };

  normalizeArray(data.workforceAssignments).forEach((record) => mark(record, record.userId || record.personnelId, ["userName", "name"]));
  normalizeArray(data.workforceShipments).forEach((record) => mark(record, record.userId || record.personnelId, ["userName", "personName"]));
  normalizeArray(data.workforceMaterialRequests).forEach((record) => mark(record, record.personId || record.personnelId, ["personName", "userName"]));
  normalizeArray(data.workforceShiftRequests).forEach((record) => mark(record, record.personId || record.personnelId, ["personName", "userName"]));
  normalizeArray(data.workforceShiftPlans).forEach((record) => mark(record, record.personId || record.personnelId, ["personName", "userName"]));
  normalizeArray(data.workforceShiftPlanRevisions).forEach((revision) => {
    normalizeArray(revision.plans).forEach((record) => mark(record, record.personId || record.personnelId, ["personName", "userName"]));
  });
  normalizeArray(data.stockState && data.stockState.movements).forEach((record) => mark(record, record.personnelId || record.userId, ["personName", "userName"]));
}

function normalizeWorkforceShipments(value, stockState, productCodeRegistry) {
  const purgedLocationIds = new Set(stockState && stockState.purgedLocationIds || []);
  const products = new Map((stockState && stockState.products || []).map((product) => [String(product.id), product]));
  const locations = new Map((stockState && stockState.locations || []).map((location) => [String(location.id), location]));
  const movementsByShipment = new Map();
  for (const movement of stockState && stockState.movements || []) {
    const shipmentId = String(movement && movement.shipmentId || "");
    if (!shipmentId) continue;
    const refs = movementsByShipment.get(shipmentId) || [];
    refs.push(String(movement.id || movement.transactionRef || "").trim());
    movementsByShipment.set(shipmentId, refs.filter(Boolean));
  }
  return normalizeArray(value).map((shipment) => {
    if (!shipment || typeof shipment !== "object" || Array.isArray(shipment)) return null;
    const status = normalizeShipmentStatus(shipment.status);
    const evidenceDocumentIds = normalizeProcurementStringArray(shipment.evidenceDocumentIds, 180);
    const accountingEntryIds = normalizeProcurementStringArray(shipment.accountingEntryIds, 180);
    const stockMovementRefs = [...new Set([
      ...normalizeArray(shipment.stockMovementRefs || (shipment.stockMovementRef ? [shipment.stockMovementRef] : [])),
      ...(movementsByShipment.get(String(shipment.id || "")) || [])
    ])].map((item) => String(item || "").trim()).filter(Boolean);
    const shipmentMovement = (stockState && stockState.movements || []).find((movement) =>
      String(movement && movement.shipmentId || "") === String(shipment.id || "") && movement.locationId
    );
    const requestedDestinationId = String(shipment.destinationLocationId || shipmentMovement && shipmentMovement.locationId || "").trim();
    const destination = locations.get(requestedDestinationId) || null;
    return {
      ...shipment,
      status,
      revision: Math.max(0, Math.trunc(finiteNumber(shipment.revision, 0))),
      expectedRevision: Math.max(0, Math.trunc(finiteNumber(shipment.expectedRevision, shipment.revision || 0))),
      requestId: String(shipment.requestId || ""),
      supplierId: procurementText(shipment.supplierId, 180),
      branchId: procurementText(shipment.branchId, 80) || "main",
      evidenceDocumentIds,
      documentType: procurementText(shipment.documentType, 40),
      documentNumber: procurementText(shipment.documentNumber, 120),
      documentDate: procurementText(shipment.documentDate, 10),
      accountingStatus: ["not_posted", "not_required", "posted", "reversed", "failed"].includes(String(shipment.accountingStatus || ""))
        ? String(shipment.accountingStatus)
        : accountingEntryIds.length || shipment.accountingPostedAt ? "posted" : "not_posted",
      accountingEntryIds,
      accountingPostedAt: shipment.accountingPostedAt || null,
      accountingPostedBy: procurementText(shipment.accountingPostedBy, 180),
      evidenceStatus: shipment.evidenceStatus === "archived"
        ? "archived"
        : evidenceDocumentIds.length
          ? "available"
          : "missing",
      operationalStatus: procurementText(shipment.operationalStatus, 80) || status,
      updatedAt: shipment.updatedAt || shipment.createdAt || null,
      stockAppliedAt: shipment.stockAppliedAt || (status === "onaylandı" && stockMovementRefs.length ? shipment.approvedAt || shipment.updatedAt || shipment.createdAt || null : null),
      stockMovementRef: String(shipment.stockMovementRef || stockMovementRefs[0] || "") || null,
      stockMovementRefs,
      destinationLocationId: destination ? destination.id : purgedLocationIds.has(requestedDestinationId) ? requestedDestinationId : null,
      destinationLocationName: destination ? destination.name : String(shipment.destinationLocationName || "") || null,
      items: normalizeArray(shipment.items).map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const productId = String(item.stockProductId || item.productId || "");
        const product = products.get(productId);
        const stockProductCode = normalizeProductCode(
          item.stockProductCode
          || product && product.productCode
          || registryCodeForEntity(productCodeRegistry, "stock", productId)
        );
        return { ...item, stockProductCode };
      }).filter(Boolean)
    };
  }).filter(Boolean);
}

function normalizeWorkforceTasks(value) {
  return normalizeArray(value).map((task, index) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) return null;
    const id = String(task.id || stableStockId("workforce-task", `${task.createdAt || ""}\u0000${task.title || task.text || index}`));
    const rawItems = normalizeArray(task.items).length
      ? task.items
      : [task.item || task.text || task.title || "Görev"];
    const seen = new Set();
    const items = rawItems.map((item, itemIndex) => {
      const source = item && typeof item === "object" ? item : { text: item };
      const text = String(source.text || source.title || "").trim().slice(0, 300);
      if (!text) return null;
      let itemId = String(source.id || stableStockId("task-item", `${id}\u0000${itemIndex}\u0000${text}`));
      while (seen.has(itemId)) itemId = `${itemId}-${itemIndex + 1}`;
      seen.add(itemId);
      return { ...source, id: itemId, text, order: finiteNumber(source.order, itemIndex) };
    }).filter(Boolean);
    const dueDate = String(task.dueDate || (task.dueAt ? String(task.dueAt).slice(0, 10) : ""));
    const dueTime = String(task.dueTime || (task.dueAt && String(task.dueAt).includes("T") ? String(task.dueAt).slice(11, 16) : ""));
    return {
      ...task,
      id,
      title: String(task.title || task.text || "Görev").trim().slice(0, 160),
      description: String(task.description || "").trim().slice(0, 1000),
      managerNote: String(task.managerNote || task.adminNote || "").trim().slice(0, 1000),
      items,
      priority: ["low", "normal", "high", "urgent"].includes(task.priority) ? task.priority : "normal",
      dueDate,
      dueTime,
      dueAt: String(task.dueAt || (dueDate ? `${dueDate}T${dueTime || "23:59"}:00.000+03:00` : "")),
      status: normalizeTaskStatus(task.status),
      revision: Math.max(0, Math.trunc(finiteNumber(task.revision, 0))),
      assignedUserIds: [...new Set(normalizeArray(task.assignedUserIds).map(String).filter(Boolean))]
    };
  }).filter(Boolean);
}

function normalizeWorkforceAssignments(value, tasksValue) {
  const tasks = new Map(normalizeWorkforceTasks(tasksValue).map((task) => [task.id, task]));
  const seen = new Set();
  return normalizeArray(value).map((assignment, index) => {
    if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return null;
    const taskId = String(assignment.taskId || "");
    const userId = String(assignment.userId || assignment.personnelId || assignment.personId || "");
    if (!taskId || !userId) return null;
    const identity = `${taskId}\u0000${userId}`;
    if (seen.has(identity)) return null;
    seen.add(identity);
    const task = tasks.get(taskId);
    const validItemIds = new Set(task ? task.items.map((item) => item.id) : []);
    const completedItemIds = [...new Set(normalizeArray(assignment.completedItemIds)
      .map(String).filter((itemId) => !validItemIds.size || validItemIds.has(itemId)))];
    const status = normalizeAssignmentStatus(assignment.status, completedItemIds.length, validItemIds.size);
    const progress = validItemIds.size ? Math.round(completedItemIds.length / validItemIds.size * 100) : status === "completed" ? 100 : 0;
    return {
      ...assignment,
      id: String(assignment.id || stableStockId("task-assignment", identity || index)),
      taskId,
      userId,
      personnelId: userId,
      status,
      completedItemIds,
      progress,
      assignedAt: assignment.assignedAt || assignment.createdAt || null,
      startedAt: assignment.startedAt || (progress > 0 ? assignment.updatedAt || assignment.createdAt || null : null),
      completedAt: status === "completed" ? assignment.completedAt || assignment.updatedAt || null : null,
      revision: Math.max(0, Math.trunc(finiteNumber(assignment.revision, 0)))
    };
  }).filter(Boolean);
}

function reconcileWorkforceAssignments(tasksValue, assignmentsValue, usersValue) {
  const tasks = normalizeWorkforceTasks(tasksValue);
  const users = new Map(normalizeArray(usersValue).map((user) => [String(user && user.id || ""), user]));
  const assignments = normalizeWorkforceAssignments(assignmentsValue, tasks);
  const byIdentity = new Map(assignments.map((assignment) => [`${assignment.taskId}\u0000${assignment.userId}`, assignment]));

  for (const task of tasks) {
    const legacyIds = [
      ...normalizeArray(task.assignedUserIds),
      task.userId,
      task.personId,
      task.personnelId
    ].map((value) => String(value || "")).filter(Boolean);
    const existingIds = assignments.filter((assignment) => assignment.taskId === task.id).map((assignment) => assignment.userId);
    const assignedUserIds = [...new Set([...legacyIds, ...existingIds])];
    task.assignedUserIds = assignedUserIds;
    for (const userId of assignedUserIds) {
      const identity = `${task.id}\u0000${userId}`;
      if (byIdentity.has(identity)) continue;
      const user = users.get(userId);
      const createdAt = task.createdAt || new Date(0).toISOString();
      const assignment = {
        id: stableStockId("task-assignment", identity),
        taskId: task.id,
        userId,
        personnelId: userId,
        userName: String(user && (user.name || user.username) || task.userName || "Personel"),
        username: String(user && user.username || task.username || ""),
        status: task.status === "cancelled" ? "cancelled" : task.status === "completed" ? "completed" : "pending",
        completedItemIds: task.status === "completed" ? task.items.map((item) => item.id) : [],
        progress: task.status === "completed" ? 100 : 0,
        assignedAt: createdAt,
        startedAt: null,
        completedAt: task.status === "completed" ? task.completedAt || task.updatedAt || createdAt : null,
        createdAt,
        updatedAt: task.updatedAt || createdAt,
        revision: 0,
        migratedFromLegacyTask: true
      };
      assignments.push(assignment);
      byIdentity.set(identity, assignment);
    }
  }
  return assignments;
}

function syncWorkforceTaskAssignees(tasksValue, assignmentsValue) {
  const assignments = normalizeArray(assignmentsValue);
  return normalizeWorkforceTasks(tasksValue).map((task) => ({
    ...task,
    assignedUserIds: [...new Set([
      ...normalizeArray(task.assignedUserIds).map(String),
      ...assignments.filter((assignment) => assignment.taskId === task.id).map((assignment) => String(assignment.userId || ""))
    ].filter(Boolean))]
  }));
}

function normalizeWorkforceMaterialRequests(value) {
  return normalizeArray(value).map((request, requestIndex) => {
    if (!request || typeof request !== "object" || Array.isArray(request)) return null;
    const personId = String(request.personId || request.personnelId || request.userId || "");
    const requestId = String(request.id || stableStockId("material-request", `${personId}\u0000${request.requestNumber || request.createdAt || requestIndex}`));
    const items = normalizeArray(request.items).map((item, itemIndex) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const quantity = finiteNumber(item.quantity, 0);
      const name = String(item.name || item.materialName || item.productName || "").trim().replace(/\s+/g, " ").slice(0, 180);
      const unit = String(item.unit || "").trim().toLocaleLowerCase("tr-TR").slice(0, 40);
      if (!name || !(quantity > 0) || !unit) return null;
      const linkedProductId = String(item.linkedProductId || item.stockProductId || item.productId || "");
      return {
        ...item,
        id: String(item.id || stableStockId("material-request-item", `${requestId}\u0000${itemIndex}\u0000${name}`)),
        name,
        materialName: name,
        code: String(item.code || item.materialCode || item.productCode || "").trim().slice(0, 120),
        quantity: Math.round(quantity * 1000) / 1000,
        unit,
        imageUrl: String(item.imageUrl || item.image || "").trim().slice(0, 2048),
        supplier: String(item.supplier || item.supplierName || "").trim().slice(0, 180),
        usageLocation: String(item.usageLocation || item.usePlace || "").trim().slice(0, 180),
        neededDate: String(item.neededDate || item.dueDate || "").trim().slice(0, 10),
        description: String(item.description || item.note || "").trim().slice(0, 1000),
        linkedProductId,
        stockProductId: linkedProductId,
        linkedAt: item.linkedAt || null,
        linkedBy: String(item.linkedBy || ""),
        productCreatedFromRequest: item.productCreatedFromRequest === true
      };
    }).filter(Boolean);
    return {
      ...request,
      id: requestId,
      requestNumber: String(request.requestNumber || "").trim().slice(0, 40),
      personId,
      personnelId: personId,
      personName: String(request.personName || request.userName || request.personNameSnapshot || "Personel").trim().slice(0, 120),
      department: String(request.department || "").trim().slice(0, 120),
      items,
      status: normalizeShiftRequestStatus(request.status),
      requestId: String(request.requestId || ""),
      revision: Math.max(0, Math.trunc(finiteNumber(request.revision, 0))),
      adminNote: String(request.adminNote || request.rejectionReason || "").slice(0, 500),
      approvedBy: request.approvedBy ? String(request.approvedBy) : null,
      approvedAt: request.approvedAt || null,
      receivedBy: request.receivedBy ? String(request.receivedBy) : null,
      receivedAt: request.receivedAt || null
    };
  }).filter((request) => request && request.items.length);
}

function normalizeMaterialRequestNumberSequences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(source).map(([year, counter]) => [
    String(year).slice(0, 4),
    Math.max(0, Math.trunc(finiteNumber(counter, 0)))
  ]).filter(([year]) => /^\d{4}$/.test(year)));
}

function normalizeWorkforceShiftRequests(value) {
  return normalizeArray(value).map((request, index) => {
    if (!request || typeof request !== "object" || Array.isArray(request)) return null;
    const personId = String(request.personId || request.personnelId || request.userId || "");
    return {
      ...request,
      id: String(request.id || stableStockId("shift-request", `${personId}\u0000${request.date || ""}\u0000${request.type || index}`)),
      personId,
      personnelId: personId,
      status: normalizeShiftRequestStatus(request.status),
      requestId: String(request.requestId || ""),
      revision: Math.max(0, Math.trunc(finiteNumber(request.revision, 0))),
      adminNote: String(request.adminNote || request.rejectionReason || "").slice(0, 250)
    };
  }).filter(Boolean);
}

function normalizeWorkforceShiftPlans(value) {
  const seen = new Set();
  return normalizeArray(value).map((plan, index) => {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
    const personId = String(plan.personId || plan.personnelId || plan.userId || "");
    const status = ["published", "yayınlandı", "yayinlandi"].includes(plan.status) ? "published" : "draft";
    const identity = `${plan.weekStart || ""}\u0000${personId}\u0000${plan.date || ""}\u0000${status}`;
    if (!personId || seen.has(identity)) return null;
    seen.add(identity);
    return {
      ...plan,
      id: String(plan.id || stableStockId("shift-plan", identity || index)),
      personId,
      personnelId: personId,
      status,
      revision: Math.max(0, Math.trunc(finiteNumber(plan.revision ?? plan.publicationRevision, 0)))
    };
  }).filter(Boolean);
}

function normalizeWorkforceShiftPlanRevisions(value) {
  return normalizeArray(value).map((revision, index) => {
    if (!revision || typeof revision !== "object" || Array.isArray(revision)) return null;
    return {
      ...revision,
      id: String(revision.id || stableStockId("shift-revision", `${revision.weekStart || ""}\u0000${revision.revision || index}`)),
      revision: Math.max(1, Math.trunc(finiteNumber(revision.revision, index + 1))),
      plans: normalizeWorkforceShiftPlans(revision.plans).map((plan) => ({ ...plan, status: "published" }))
    };
  }).filter(Boolean);
}

function normalizeDeletedRecipeUsers(value) {
  const seen = new Set();
  return normalizeArray(value).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const id = String(item.id || item.userId || "");
    if (!id || seen.has(id)) return null;
    seen.add(id);
    return {
      ...item,
      id,
      userId: id,
      username: String(item.username || ""),
      name: String(item.name || "Silinmiş personel"),
      deletedAt: item.deletedAt || new Date(0).toISOString()
    };
  }).filter(Boolean);
}

function normalizeTaskStatus(status) {
  const value = String(status || "");
  if (["completed", "tamamlandi", "tamamlandı"].includes(value)) return "completed";
  if (["archived"].includes(value)) return "archived";
  if (["cancelled", "iptal_edildi"].includes(value)) return "cancelled";
  if (["draft", "taslak"].includes(value)) return "draft";
  return "active";
}

function normalizeAssignmentStatus(status, completedCount, itemCount) {
  const value = String(status || "");
  if (["completed", "tamamlandi", "tamamlandı"].includes(value) || (itemCount > 0 && completedCount >= itemCount)) return "completed";
  if (["in_progress", "devam_ediyor"].includes(value) || completedCount > 0) return "in_progress";
  if (["cancelled", "iptal_edildi"].includes(value)) return "cancelled";
  return "pending";
}

function normalizeShipmentStatus(status) {
  const value = String(status || "");
  if (["taslak", "draft"].includes(value)) return "taslak";
  if (["onaylandı", "onaylandi", "approved"].includes(value)) return "onaylandı";
  if (["reddedildi", "rejected"].includes(value)) return "reddedildi";
  return "onay_bekliyor";
}

function normalizeShiftRequestStatus(status) {
  const value = String(status || "");
  if (["onaylandı", "onaylandi", "approved"].includes(value)) return "onaylandı";
  if (["reddedildi", "rejected"].includes(value)) return "reddedildi";
  if (["iptal_edildi", "cancelled", "canceled"].includes(value)) return "iptal_edildi";
  return "onay_bekliyor";
}

function stableStockId(prefix, value) {
  return `${prefix}-${crypto.createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16)}`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function isCatalogRecord(item) {
  return Boolean(item && typeof item === "object" && item.id && item.category && item.product);
}

function normalizeName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function extendPersonelStore(next, source) {
  next.recipeState = normalizeRecipeState(source.recipeState);
  next.recipeUpdatedAt = source.recipeUpdatedAt || null;
  next.recipeCatalog = reconcileRecipeCatalog(next.recipeState, source.recipeCatalog);
  next.recipeUsers = normalizeRecipeUsers(source.recipeUsers);
  next.deletedRecipeUsers = normalizeDeletedRecipeUsers(source.deletedRecipeUsers);
  next.recipeActivity = normalizeArray(source.recipeActivity);
  next.recipeAssignments = normalizeArray(source.recipeAssignments);
  next.recipeLinkReview = normalizeArray(source.recipeLinkReview);
  next.stockState = normalizeStockState(source.stockState);
  next.stockUpdatedAt = source.stockUpdatedAt || null;
  next.authSessions = normalizeAuthSessions(source.authSessions);
  next.passwordResetChallenges = normalizePasswordResetChallenges(source.passwordResetChallenges);
  next.emailVerificationChallenges = normalizeEmailVerificationChallenges(source.emailVerificationChallenges);
  next.securityAudit = normalizeSecurityAudit(source.securityAudit);
  next.notifications = normalizeNotifications(source.notifications);
  next.notificationPreferences = normalizeNotificationPreferences(source.notificationPreferences);
  next.notificationOutbox = normalizeNotificationOutbox(source.notificationOutbox);
  next.pushSubscriptions = normalizePushSubscriptions(source.pushSubscriptions);
  // Paket 2'nin erken sürümleri aynı kalıcı durumu `schedulerState` adıyla
  // yazıyordu. Yeni anahtar yoksa eski anahtarı okuyarak zamanlayıcı kilidi,
  // hatırlatma tekilleştirmesi ve kritik stok eşiği durumunu kaybetme.
  next.notificationSchedulerState = normalizeNotificationSchedulerState(source.notificationSchedulerState || source.schedulerState);
  next.workforceTasks = normalizeWorkforceTasks(source.workforceTasks);
  next.workforceAssignments = normalizeWorkforceAssignments(source.workforceAssignments, source.workforceTasks);
  next.workforceMaterialRequests = normalizeWorkforceMaterialRequests(source.workforceMaterialRequests);
  // Export snapshots remain on the server so a failed download can be retried
  // after a restart without repeating approvals or notifications.
  next.workforceMaterialExports = normalizeArray(source.workforceMaterialExports)
    .filter(batch => batch && typeof batch === "object" && batch.id && Array.isArray(batch.lines))
    .map(batch => ({ ...batch, lines: batch.lines.map(line => ({ ...line })) }));
  next.materialRequestNumberSequences = normalizeMaterialRequestNumberSequences(source.materialRequestNumberSequences);
  next.workforceShiftRequests = normalizeWorkforceShiftRequests(source.workforceShiftRequests);
  next.workforceShiftPlans = normalizeWorkforceShiftPlans(source.workforceShiftPlans);
  next.workforceShiftPlanRevisions = normalizeWorkforceShiftPlanRevisions(source.workforceShiftPlanRevisions);
  next.workforceShiftSettings = normalizeWorkforceShiftSettings(source.workforceShiftSettings);
  next.workforceMigrationArchive = collectWorkforceMigrationArchive(source);
  next.notificationPreferences = reconcileNotificationPreferenceEmails(next.notificationPreferences, next);
  clearLegacyUnverifiedPersonelAdminEmails(next);
  next.notificationOutbox = reconcileNotificationOutboxRecipients(next.notificationOutbox, next.notifications);
  next.workforceAssignments = reconcileWorkforceAssignments(next.workforceTasks, next.workforceAssignments, next.recipeUsers);
  next.workforceTasks = syncWorkforceTaskAssignees(next.workforceTasks, next.workforceAssignments);
  next.productCodeRegistry = normalizeProductCodeRegistry(source.productCodeRegistry, next);
  next.workforceShipments = normalizeWorkforceShipments(source.workforceShipments, next.stockState, next.productCodeRegistry);
  next.procurement = normalizeProcurement(source.procurement, { shipments: next.workforceShipments });
  next.notificationDedupe = normalizeNotificationDedupe(source.notificationDedupe, next.notifications, next);
  markWorkforcePersonnelState(next);
  next.workforceMigrationState = { version: 1, schemaVersion: 26, completed: true, archivedRecordCount: next.workforceMigrationArchive.length };
  const revisions = source.revisions || {};
  for (const scope of ["workforce", "inventory", "shipment", "procurement", "catalog", "notification", "stock", "dataImportRecipes", "dataImportStock"]) next.revisions[scope] = Math.max(0, Math.trunc(Number(revisions[scope] || 0)) || 0);
  next.revisions.procurement = Math.max(next.revisions.procurement, next.procurement.revision);
  next.revisions.inventory = Math.max(next.revisions.inventory, next.revisions.stock);
  next.revisions.catalog = Math.max(next.revisions.catalog, next.revisions.dataImportCatalog);
  next.revisions.stock = Math.max(next.revisions.stock, next.revisions.inventory, next.revisions.catalog);
  return next;
}
module.exports = { DEFAULT_FATURA_CAPABILITIES, extendPersonelStore, normalizeProcurement, normalizeStockState, normalizeRecipeState, normalizeRecipeItem, reconcileRecipeCatalog, chooseRecipeSize };
