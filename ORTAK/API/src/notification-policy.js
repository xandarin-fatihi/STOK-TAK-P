"use strict";

const POLICY_VERSION = 4;
const CHANNEL_KEYS = Object.freeze(["inApp", "push", "email", "sound"]);
const TIMING_VALUES = Object.freeze(["immediate", "daily", "weekly", "off"]);

const RULE_DEFINITIONS = Object.freeze([
  rule("task_assignment", "Görev atama ve güncelleme", ["task_assigned", "task_removed", "task_updated"], "task", false, true, "personnel"),
  rule("task_progress", "Görev ilerleme hareketleri", ["task_started", "task_completed"], "task", false, true, "manager"),
  rule("shift_request", "Vardiya talebi", ["shift_request_created"], "shift", false, true, "manager"),
  rule("shift_decision", "Vardiya talebi kararı", ["shift_request_approved", "shift_request_rejected"], "shift", false, true, "personnel"),
  rule("shift_publication", "Vardiya yayını", ["shift_published", "shift_updated"], "shift", false, true, "personnel"),
  rule("material_request_created", "Malzeme talebi", ["material_request_created"], "materialRequest", false, true, "manager"),
  rule("material_request_decision", "Malzeme talebi kararı", ["material_request_approved", "material_request_rejected"], "materialRequest", false, true, "personnel"),
  rule("shipment_flow", "Sevkiyat, belge ve cari hareketleri", ["shipment_*", "document_*", "accounting_*", "payment_*", "procurement_*"], "shipment", false, true, "direct"),
  rule("stock_flow", "Stok, eşik ve transfer hareketleri", ["stock_*", "inventory_*"], "stock", false, true, "direct"),
  rule("feedback_action", "İşlem gerektiren geri bildirim", ["feedback_*"], "feedback", false, true, "manager"),
  rule("system_action", "Sistem ve güvenlik olayı", ["notification_test", "security_*"], "system", false, true, "manager"),
  rule("task_reminder_24h", "Göreve 24 saat kaldı", ["task_reminder_24h"], "task", true, false, "personnel"),
  rule("task_reminder_2h", "Göreve 2 saat kaldı", ["task_reminder_2h"], "task", true, false, "personnel"),
  rule("task_overdue", "Geciken görev", ["task_overdue"], "task", true, false, "personnel"),
  rule("shift_reminder_12h", "Vardiyaya 12 saat kaldı", ["shift_reminder_12h"], "shift", true, false, "personnel"),
  rule("shift_reminder_2h", "Vardiyaya 2 saat kaldı", ["shift_reminder_2h"], "shift", true, false, "personnel"),
  rule("manager_pending", "Bekleyen yönetici işlemleri", ["pending_workforce_actions"], "system", true, false, "manager")
]);

function rule(id, label, eventTypes, category, timed, enabled, recipientScope) {
  return Object.freeze({
    id, label, eventTypes: Object.freeze(eventTypes), category, timed, recipientScope,
    defaultEnabled: enabled,
    defaultTiming: timed ? "off" : "immediate",
    allowedRecipientModes: Object.freeze(recipientScope === "manager"
      ? ["manager"] : recipientScope === "direct"
        ? ["event_recipient"] : ["event_recipient", "all_active_personnel", "selected_personnel"])
  });
}

function normalizeNotificationRules(value) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([id, item]) => ({ id, ...(item && typeof item === "object" ? item : {}) }))
      : [];
  const byId = new Map(entries.map((item) => [String(item && item.id || ""), item]));
  return RULE_DEFINITIONS.map((definition) => normalizeRule(definition, byId.get(definition.id)));
}

function normalizeRule(definition, input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const enabled = typeof source.enabled === "boolean" ? source.enabled : definition.defaultEnabled;
  const requestedTiming = String(source.timing || definition.defaultTiming).toLowerCase();
  const timing = TIMING_VALUES.includes(requestedTiming) ? requestedTiming : definition.defaultTiming;
  const recipientMode = definition.allowedRecipientModes.includes(source.recipientMode)
    ? source.recipientMode : definition.allowedRecipientModes[0];
  const channels = source.channels && typeof source.channels === "object" ? source.channels : {};
  const quietHours = source.quietHours && typeof source.quietHours === "object" ? source.quietHours : {};
  const timezone = normalizeTimezone(source.timezone);
  const scheduleTime = clock(source.scheduleTime, "09:00");
  const weeklyDay = integer(source.weeklyDay, 1, 1, 7);
  const normalized = {
    id: definition.id,
    label: definition.label,
    eventTypes: [...definition.eventTypes],
    category: definition.category,
    timed: definition.timed,
    enabled: enabled && timing !== "off",
    recipientScope: definition.recipientScope,
    recipientMode,
    allowedRecipientModes: [...definition.allowedRecipientModes],
    selectedPersonnelIds: uniqueIds(source.selectedPersonnelIds),
    channels: {
      inApp: bool(channels.inApp ?? channels.in_app, true),
      push: bool(channels.push, false),
      email: bool(channels.email, false),
      sound: bool(channels.sound, false)
    },
    timing,
    quietHours: {
      enabled: bool(quietHours.enabled, false),
      start: clock(quietHours.start, "22:00"),
      end: clock(quietHours.end, "08:00")
    },
    repeatIntervalMinutes: integer(source.repeatIntervalMinutes, 0, 0, 10080),
    repeatMax: integer(source.repeatMax, 0, 0, 50),
    dailyLimit: integer(source.dailyLimit, 50, 1, 500),
    // İşlemsel stok/sevkiyat/muhasebe olayları denetim izi niteliğindedir;
    // farklı kayıtlar varsayılan olarak tek karta eritilmez. Yönetici isterse
    // kural bazında birleştirmeyi açıkça açabilir.
    mergeSimilar: bool(source.mergeSimilar, definition.recipientScope !== "direct"),
    timezone,
    scheduleTime,
    weeklyDay,
    nextScheduledAt: nextScheduledAt(timing, timezone, scheduleTime, weeklyDay)
  };
  if (!normalized.enabled) normalized.nextScheduledAt = null;
  return normalized;
}

function resolveNotificationRule(data, eventType) {
  const preferences = Array.isArray(data && data.notificationPreferences) ? data.notificationPreferences : [];
  const manager = preferences.find((item) => item && String(item.ownerRole || item.recipientRole || "").toLowerCase() === "manager");
  const rules = normalizeNotificationRules(manager && manager.rules);
  const event = String(eventType || "notification").trim().toLowerCase();
  return rules.find((item) => item.eventTypes.some((pattern) => pattern.endsWith("*")
    ? event.startsWith(pattern.slice(0, -1)) : event === pattern)) || fallbackRule(event);
}

function fallbackRule(eventType) {
  return {
    id: "system_action", label: "Sistem olayı", eventTypes: [eventType], category: "system", timed: false,
    enabled: true, recipientScope: "manager", recipientMode: "manager", allowedRecipientModes: ["manager"],
    channels: { inApp: true, push: false, email: false, sound: false }, timing: "immediate",
    quietHours: { enabled: false, start: "22:00", end: "08:00" }, repeatIntervalMinutes: 0,
    repeatMax: 0, dailyLimit: 50, mergeSimilar: true, timezone: "Europe/Istanbul",
    scheduleTime: "09:00", weeklyDay: 1, selectedPersonnelIds: [], nextScheduledAt: null
  };
}

function nextDeliveryAt(ruleValue, createdAt) {
  const ruleItem = ruleValue || fallbackRule("notification");
  const start = new Date(createdAt || Date.now());
  if (!Number.isFinite(start.getTime())) return new Date().toISOString();
  const timezone = normalizeTimezone(ruleItem.timezone);
  if (ruleItem.timing === "immediate") return applyRuleQuietHours(start, ruleItem.quietHours, timezone).toISOString();
  if (ruleItem.timing === "off") return null;
  const local = zonedParts(start, timezone);
  const [scheduleHour, scheduleMinute] = clock(ruleItem.scheduleTime, "09:00").split(":").map(Number);
  let dayOffset = 0;
  let next = zonedTimeToUtc({ ...local, hour: scheduleHour, minute: scheduleMinute, second: 0 }, timezone);
  if (ruleItem.timing === "weekly") {
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay() || 7;
    dayOffset = (integer(ruleItem.weeklyDay, 1, 1, 7) - weekday + 7) % 7;
    if (dayOffset === 0 && next <= start) dayOffset = 7;
  } else if (next <= start) {
    dayOffset = 1;
  }
  if (dayOffset) {
    const targetDay = addCalendarDays(local, dayOffset);
    next = zonedTimeToUtc({ ...targetDay, hour: scheduleHour, minute: scheduleMinute, second: 0 }, timezone);
  }
  return applyRuleQuietHours(next, ruleItem.quietHours, timezone).toISOString();
}

function applyRuleQuietHours(date, quietHours, requestedTimezone) {
  if (!quietHours || quietHours.enabled !== true) return date;
  const timezone = normalizeTimezone(requestedTimezone || quietHours.timezone);
  const [startHour, startMinute] = clock(quietHours.start, "22:00").split(":").map(Number);
  const [endHour, endMinute] = clock(quietHours.end, "08:00").split(":").map(Number);
  const local = zonedParts(date, timezone);
  const minute = local.hour * 60 + local.minute;
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside) return date;
  const addDay = start >= end && minute >= start ? 1 : 0;
  const targetDay = addCalendarDays(local, addDay);
  return zonedTimeToUtc({ ...targetDay, hour: endHour, minute: endMinute, second: 0 }, timezone);
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = Number(part.value);
    return result;
  }, {});
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function zonedTimeToUtc(parts, timezone) {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  let candidate = new Date(wanted);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(candidate, timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const difference = wanted - represented;
    if (!difference) break;
    candidate = new Date(candidate.getTime() + difference);
  }
  return candidate;
}

function addCalendarDays(parts, count) {
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function nextScheduledAt(timing, timezone, scheduleTime, weeklyDay) {
  if (!["daily", "weekly"].includes(timing)) return null;
  return nextDeliveryAt({ timing, timezone, scheduleTime, weeklyDay }, new Date());
}

function normalizeTimezone(value) {
  const timezone = String(value || "Europe/Istanbul").trim().slice(0, 80);
  try { new Intl.DateTimeFormat("tr-TR", { timeZone: timezone }).format(new Date()); return timezone; }
  catch (_error) { return "Europe/Istanbul"; }
}

function clock(value, fallback) {
  const text = String(value || "");
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

function uniqueIds(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim().slice(0, 160)).filter(Boolean))].slice(0, 500);
}

function bool(value, fallback) { return typeof value === "boolean" ? value : fallback; }
function integer(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

module.exports = {
  CHANNEL_KEYS,
  POLICY_VERSION,
  RULE_DEFINITIONS,
  TIMING_VALUES,
  nextDeliveryAt,
  normalizeNotificationRules,
  resolveNotificationRule
};
