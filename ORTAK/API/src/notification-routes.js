"use strict";

const crypto = require("crypto");
const { APP_ROOTS, normalizeAppTarget, notificationTargetsApp } = require("./app-targets");
const {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  createNotificationInStore,
  cancelInvalidOutboxInStore,
  getNotificationPreferences,
  isRetiredNotificationCategory,
  normalizeNotificationCategory,
  normalizeRole,
  notificationsFromResult,
  publishNotificationEvent,
  publishNotificationStateEvent,
  recipientMatches,
  subscribeNotificationEvents,
  subscribeNotificationStateEvents,
  updateNotificationPreferencesInStore
} = require("./notification-service");

const BULK_NOTIFICATION_STATE_UPDATE_OPTIONS = Object.freeze({
  shallowCloneCollections: Object.freeze(["notifications"]),
  trustedNormalizedMutation: true
});
const BULK_NOTIFICATION_DELETE_UPDATE_OPTIONS = Object.freeze({
  shallowCloneCollections: Object.freeze(["notifications", "notificationOutbox"]),
  trustedNormalizedMutation: true
});

function registerNotificationRoutes(options) {
  const {
    app, store, auth, config, deliveryWorker, pushService,
    requireAdminRequestOrigin, requireAdminOrMainRequestOrigin,
    riskOperationLimiter = (_req, _res, next) => next()
  } = options;
  const personelGuards = [requireAdminOrMainRequestOrigin, auth.requireActivePersonel];
  const adminGuards = [requireAdminRequestOrigin, auth.requireAdmin];
  const activeSseResponses = new Set();

  let notificationEventRevision = 0;

  registerRecipientRoutes({ prefix: "/api/notifications", guards: personelGuards, role: "personnel" });
  registerRecipientRoutes({ prefix: "/api/admin/notifications", guards: adminGuards, role: "manager", admin: true });
  registerScheduledNotificationRoutes();

  const runtime = {
    getSseClientCount: () => activeSseResponses.size,
    close() { for (const response of [...activeSseResponses]) { try { response.end(); } catch (_error) {} } activeSseResponses.clear(); }
  };

  function registerScheduledNotificationRoutes() {
    const prefix = "/api/admin/notifications/schedules";

    app.get(prefix, ...adminGuards, async (req, res, next) => {
      try {
        const data = req.storeSnapshot || await store.read();
        const schedules = (Array.isArray(data.scheduledNotifications) ? data.scheduledNotifications : [])
          .filter(Boolean)
          .sort((left, right) => {
            if (left.status !== right.status) return left.status === "pending" ? -1 : 1;
            return String(left.scheduledAt || "").localeCompare(String(right.scheduledAt || ""));
          })
          .slice(0, 200)
          .map(publicScheduledNotification);
        noStore(res).json({ ok: true, schedules });
      } catch (error) { next(error); }
    });

    app.post(prefix, ...adminGuards, riskOperationLimiter, async (req, res, next) => {
      try {
        const input = parseScheduledNotificationInput(req.body || {});
        const timestamp = new Date().toISOString();
        const schedule = {
          id: `notification-schedule-${crypto.randomUUID()}`,
          kind: "stock_critical_snapshot",
          title: input.title,
          note: input.note,
          scheduledAt: input.scheduledAt,
          status: "pending",
          notificationId: "",
          executedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        await store.update((data) => {
          data.scheduledNotifications = Array.isArray(data.scheduledNotifications) ? data.scheduledNotifications : [];
          data.scheduledNotifications.push(schedule);
          data.scheduledNotifications = data.scheduledNotifications.slice(-1000);
          return data;
        });
        noStore(res).status(201).json({ ok: true, schedule: publicScheduledNotification(schedule) });
      } catch (error) { next(error); }
    });

    app.patch(`${prefix}/:id`, ...adminGuards, riskOperationLimiter, async (req, res, next) => {
      try {
        const scheduleId = validateId(req.params.id, "Zamanlama kimliği");
        let schedule = null;
        await store.update((data) => {
          const item = (Array.isArray(data.scheduledNotifications) ? data.scheduledNotifications : [])
            .find((entry) => entry && entry.id === scheduleId);
          if (!item) throw notFound("Zamanlı bildirim bulunamadı.");
          if (item.status === "executed" || item.executedAt) throw httpError(409, "Gönderilmiş bir zamanlama yeniden düzenlenemez.");
          const input = parseScheduledNotificationInput(req.body || {}, item);
          item.title = input.title;
          item.note = input.note;
          item.scheduledAt = input.scheduledAt;
          item.status = "pending";
          item.updatedAt = new Date().toISOString();
          schedule = publicScheduledNotification(item);
          return data;
        });
        noStore(res).json({ ok: true, schedule });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/:id`, ...adminGuards, riskOperationLimiter, async (req, res, next) => {
      try {
        const scheduleId = validateId(req.params.id, "Zamanlama kimliği");
        let deleted = false;
        await store.update((data) => {
          const items = Array.isArray(data.scheduledNotifications) ? data.scheduledNotifications : [];
          const nextItems = items.filter((entry) => !entry || entry.id !== scheduleId);
          if (nextItems.length === items.length) throw notFound("Zamanlı bildirim bulunamadı.");
          data.scheduledNotifications = nextItems;
          deleted = true;
          return data;
        });
        noStore(res).json({ ok: true, deleted, deletedId: scheduleId });
      } catch (error) { next(error); }
    });
  }


  function registerRecipientRoutes({ prefix, guards, role, admin = false }) {
    app.get(prefix, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        if (admin && String(req.query && req.query.view || "").toLowerCase() === "deliveries") {
          return noStore(res).json({ ok: true, ...listDeliveryHistory(data, req.query || {}) });
        }
        const result = await listNotifications(data, owner, req.query || {});
        noStore(res).json({ ok: true, ...result });
      } catch (error) { next(error); }
    });

    app.get(`${prefix}/unread-count`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        noStore(res).json({ ok: true, unreadCount: await unreadCountCooperatively(data, owner) });
      } catch (error) { next(error); }
    });

    for (const action of ["read", "unread", "archive", "restore"]) {
      app.patch(`${prefix}/:id/${action}`, ...guards, async (req, res, next) => {
        try {
          const owner = recipientFromRequest(req, role);
          const notificationId = validateId(req.params.id, "Bildirim kimliği");
          let notification = null;
          const saved = await store.update((data) => {
            const item = findOwnedNotification(data, notificationId, owner);
            const timestamp = new Date().toISOString();
            if (action === "read") item.readAt = timestamp;
            if (action === "unread") item.readAt = null;
            if (action === "archive") item.archivedAt = timestamp;
            if (action === "restore") item.archivedAt = null;
            item.updatedAt = timestamp;
            notification = publicNotification(item);
            return data;
          });
          const count = unreadCount(saved, owner);
          publishNotificationStateEvent({
            recipientRole: owner.role, recipientId: owner.id, action,
            notificationId, notification, unreadCount: count, updatedAt: notification.updatedAt
          });
          noStore(res).json({ ok: true, notification, unreadCount: count });
        } catch (error) { next(error); }
      });
    }

    app.delete(`${prefix}/archive`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        let deletedCount = 0;
        const saved = await store.update((data) => {
          const archived = (data.notifications || [])
            .filter((item) => item && !isRetiredNotificationCategory(item.category, item.eventType)
              && notificationMatchesOwner(item, owner) && item.archivedAt && !item.deletedAt);
          const archivedRecords = new Set(archived);
          const archivedIds = new Set(archived.map((item) => item.id));
          deletedCount = archived.length;
          if (!deletedCount) return data;
          data.notifications = (data.notifications || []).filter((item) => !archivedRecords.has(item));
          cancelNotificationOutbox(data, owner, archivedIds, "Bildirim arşivi kullanıcı tarafından temizlendi.");
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "archive-cleared",
          deletedCount, unreadCount: count, updatedAt: new Date().toISOString()
        });
        noStore(res).json({ ok: true, deletedCount, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.post(`${prefix}/read-all`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const timestamp = new Date().toISOString();
        let updatedCount = 0;
        const saved = await store.update((data) => {
          for (const item of data.notifications || []) {
            if (!notificationMatchesOwner(item, owner) || isRetiredNotificationCategory(item.category, item.eventType)
              || item.deletedAt || item.archivedAt || item.readAt || item.inAppVisible === false) continue;
            item.readAt = timestamp;
            item.updatedAt = timestamp;
            updatedCount += 1;
          }
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "read-all",
          updatedCount, unreadCount: count, updatedAt: timestamp
        });
        noStore(res).json({ ok: true, updatedCount, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.post(`${prefix}/archive-read`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const timestamp = new Date().toISOString();
        let updatedCount = 0;
        const saved = await store.update((data) => {
          for (const item of data.notifications || []) {
            if (!item || !notificationMatchesOwner(item, owner)
              || isRetiredNotificationCategory(item.category, item.eventType)
              || item.deletedAt || item.archivedAt || !item.readAt || item.inAppVisible === false) continue;
            item.archivedAt = timestamp;
            item.updatedAt = timestamp;
            updatedCount += 1;
          }
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "archive-read",
          updatedCount, unreadCount: count, updatedAt: timestamp
        });
        noStore(res).json({ ok: true, updatedCount, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/read`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const recoverable = admin && req.query.recoverable === "1";
        const timestamp = new Date().toISOString();
        let deletedIds = [];
        let deletedCount = 0;
        const saved = await store.update((data) => {
          const records = (data.notifications || []).filter((item) => item
            && notificationMatchesOwner(item, owner)
            && !isRetiredNotificationCategory(item.category, item.eventType)
            && !item.deletedAt && item.readAt && item.inAppVisible !== false
            && (!recoverable || !item.archivedAt));
          const recordSet = new Set(records);
          const ids = new Set(records.map((item) => item.id));
          deletedCount = records.length;
          deletedIds = [...ids];
          if (deletedCount) {
            if (recoverable) {
              records.forEach((item) => { item.deletedAt = timestamp; item.updatedAt = timestamp; });
            } else data.notifications = (data.notifications || []).filter((item) => !recordSet.has(item));
            cancelNotificationOutbox(data, owner, ids, "Okunmuş bildirimler kullanıcı tarafından silindi.");
          }
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "read-deleted",
          deletedCount, unreadCount: count, updatedAt: new Date().toISOString()
        });
        noStore(res).json({ ok: true, deletedCount, unreadCount: count, ...(recoverable ? { deletedIds } : {}) });
      } catch (error) { next(error); }
    });

    if (admin) app.post(`${prefix}/undo-delete`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const input = req.body && req.body.ids;
        if (!Array.isArray(input) || !input.length || input.length > 100) throw httpError(400, "1–100 bildirim kimliği gönderin.");
        const ids = [...new Set(input.map((id) => validateId(id, "Bildirim kimliği")))];
        const timestamp = new Date().toISOString();
        let notifications = [];
        const saved = await store.update((data) => {
          // Validate every owner before changing any record: mixed batches are atomic.
          const records = ids.map((id) => findOwnedNotificationIncludingDeleted(data, id, owner));
          records.forEach((item) => {
            if (item.deletedAt) { item.deletedAt = null; item.updatedAt = timestamp; }
          });
          notifications = records.map(publicNotification);
          return data;
        });
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({ recipientRole: owner.role, recipientId: owner.id,
          action: "delete-undone", notificationIds: ids, unreadCount: count, updatedAt: timestamp });
        noStore(res).json({ ok: true, notifications, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.post(`${prefix}/bulk`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const action = String(req.body && req.body.action || "").trim().toLowerCase();
        if (!["read", "unread", "archive", "restore", "delete"].includes(action)) {
          throw badRequest("Toplu bildirim işlemi geçersiz.");
        }
        const rawIds = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
        if (!rawIds.length || rawIds.length > 100) throw badRequest("Toplu işlem için 1 ile 100 bildirim kimliği gereklidir.");
        const ids = [...new Set(rawIds.map((id) => validateId(id, "Bildirim kimliği")))];
        const timestamp = new Date().toISOString();
        let updatedCount = 0;
        const saved = await store.update((data) => {
          const records = findOwnedNotifications(data, ids, owner);
          const recordSet = new Set(records);
          if (action === "delete") {
            data.notifications = (data.notifications || []).filter((item) => !recordSet.has(item));
            data.notificationOutbox = (data.notificationOutbox || [])
              .map((item) => item && typeof item === "object" ? { ...item } : item);
            cancelNotificationOutbox(data, owner, new Set(ids), "Bildirimler kullanıcı tarafından toplu silindi.", timestamp);
            updatedCount = records.length;
            return data;
          }
          const replacements = new Map();
          for (const item of records) {
            const replacement = { ...item, updatedAt: timestamp };
            if (action === "read") replacement.readAt = timestamp;
            if (action === "unread") replacement.readAt = null;
            if (action === "archive") replacement.archivedAt = timestamp;
            if (action === "restore") replacement.archivedAt = null;
            replacements.set(item, replacement);
            updatedCount += 1;
          }
          data.notifications = (data.notifications || []).map((item) => replacements.get(item) || item);
          return data;
        }, action === "delete" ? BULK_NOTIFICATION_DELETE_UPDATE_OPTIONS : BULK_NOTIFICATION_STATE_UPDATE_OPTIONS);
        const count = unreadCount(saved, owner);
        publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: `bulk-${action}`,
          notificationIds: ids, updatedCount, unreadCount: count, updatedAt: timestamp
        });
        noStore(res).json({ ok: true, action, updatedCount, unreadCount: count });
      } catch (error) { next(error); }
    });

    app.get(`${prefix}/preferences`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        const preferences = getNotificationPreferences(data, owner.role, owner.id);
        noStore(res).json({
          ok: true,
          preferences,
          capabilities: notificationCapabilities(pushService, preferences),
          ...(admin ? { personnelOptions: listNotificationPersonnelOptions(data) } : {})
        });
      } catch (error) { next(error); }
    });

    const updatePreferences = async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        let preferences = null;
        const savedData = await store.update((data) => {
          preferences = updateNotificationPreferencesInStore(data, owner.role, owner.id, req.body || {});
          cancelInvalidOutboxInStore(data);
          return data;
        });
        noStore(res).json({
          ok: true,
          preferences,
          capabilities: notificationCapabilities(pushService, preferences),
          ...(admin ? { personnelOptions: listNotificationPersonnelOptions(savedData) } : {})
        });
      } catch (error) { next(error); }
    };
    app.put(`${prefix}/preferences`, ...guards, updatePreferences);
    app.patch(`${prefix}/preferences`, ...guards, updatePreferences);

    app.get(`${prefix}/push-subscriptions`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const data = req.storeSnapshot || await store.read();
        const currentDeviceId = normalizedDeviceId(req.get("x-menu-suite-device-id"));
        const appTarget = requestPushAppTarget(req, owner);
        const devices = (data.pushSubscriptions || [])
          .filter((item) => pushSubscriptionMatches(item, owner, appTarget) && !item.revokedAt)
          .sort((a, b) => String(b.lastSeenAt || b.updatedAt || "").localeCompare(String(a.lastSeenAt || a.updatedAt || "")))
          .map((item) => publicPushDevice(item, currentDeviceId));
        noStore(res).json({ ok: true, devices, subscriptions: devices });
      } catch (error) { next(error); }
    });

    app.post(`${prefix}/push-subscriptions`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const subscription = validatePushSubscription(req.body && (req.body.subscription || req.body));
        const deviceId = normalizedDeviceId(req.body && req.body.deviceId || req.get("x-menu-suite-device-id"));
        const deviceName = normalizedDeviceName(req.body && req.body.deviceName, req.get("user-agent"));
        const appTarget = requestPushAppTarget(req, owner);
        let saved = null;
        await store.update((data) => {
          data.pushSubscriptions = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];
          const foreign = data.pushSubscriptions.find((item) => item && !item.revokedAt && item.endpoint === subscription.endpoint
            && !pushSubscriptionMatches(item, owner));
          if (foreign) {
            const error = new Error("Bu Push aboneliği başka bir hesaba bağlı.");
            error.status = 409;
            throw error;
          }
          const currentByDevice = deviceId && data.pushSubscriptions.find((item) => pushSubscriptionMatches(item, owner, appTarget)
            && item.deviceId === deviceId);
          const currentByEndpoint = data.pushSubscriptions.find((item) => pushSubscriptionMatches(item, owner, appTarget)
            && item.endpoint === subscription.endpoint);
          const current = currentByDevice || currentByEndpoint;
          const timestamp = new Date().toISOString();
          const superseded = new Set();
          for (const item of data.pushSubscriptions) {
            if (!item || item === current || !pushSubscriptionMatches(item, owner)) continue;
            if (pushSubscriptionAppTarget(item) !== appTarget) continue;
            if (item.endpoint === subscription.endpoint || deviceId && item.deviceId === deviceId) superseded.add(item);
          }
          if (superseded.size) {
            const supersededIds = [...superseded].map((item) => item.id);
            const supersededEndpoints = [...superseded].map((item) => item.endpoint);
            data.pushSubscriptions = data.pushSubscriptions.filter((item) => !superseded.has(item));
            cancelPushOutbox(data, owner, supersededIds, supersededEndpoints, "Cihaz aboneliği yenilendi.", timestamp);
          }
          if (current && current.endpoint && current.endpoint !== subscription.endpoint) {
            cancelPushOutbox(data, owner, [current.id], [current.endpoint], "Cihaz aboneliği yenilendi.", timestamp);
          }
          saved = {
            id: current && current.id || `push-subscription-${crypto.randomUUID()}`,
            ownerRole: owner.role,
            ownerId: owner.id,
            appTarget,
            appId: appTarget,
            endpoint: subscription.endpoint,
            subscription,
            keys: subscription.keys,
            deviceId: deviceId || (current && current.deviceId) || "",
            deviceName: deviceName || (current && current.deviceName) || "Bu cihaz",
            userAgent: String(req.get("user-agent") || "").slice(0, 500),
            createdAt: (current && current.createdAt) || timestamp,
            updatedAt: timestamp,
            lastSeenAt: timestamp,
            lastSuccessAt: (current && current.lastSuccessAt) || null,
            failureCount: (current && current.failureCount) || 0,
            disabledAt: null,
            revokedAt: null
          };
          if (current) Object.assign(current, saved);
          else data.pushSubscriptions.push(saved);
          return data;
        });
        noStore(res).status(201).json({ ok: true, subscription: publicPushDevice(saved, deviceId, { includeEndpoint: true }) });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/push-subscriptions`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const endpoint = String(req.body && req.body.endpoint || "").trim();
        const appTarget = requestPushAppTarget(req, owner);
        if (!endpoint) throw badRequest("Push aboneliği endpoint bilgisi gerekli.");
        let removed = 0;
        await store.update((data) => {
          const timestamp = new Date().toISOString();
          const matches = (data.pushSubscriptions || []).filter((item) => pushSubscriptionMatches(item, owner, appTarget)
            && item.endpoint === endpoint && !item.revokedAt);
          for (const item of matches) {
            item.revokedAt = timestamp;
            item.updatedAt = timestamp;
          }
          removed = matches.length;
          cancelPushOutbox(data, owner, matches.map((item) => item.id), [endpoint], "Push aboneliği kullanıcı tarafından kaldırıldı.", timestamp);
          return data;
        });
        noStore(res).json({ ok: true, removed });
      } catch (error) { next(error); }
    });

    app.delete(`${prefix}/push-subscriptions/:id`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const subscriptionId = validateId(req.params.id, "Cihaz kimliği");
        const appTarget = requestPushAppTarget(req, owner);
        let removed = 0;
        await store.update((data) => {
          const owned = (data.pushSubscriptions || []).find((item) => item && item.id === subscriptionId
            && pushSubscriptionMatches(item, owner, appTarget) && !item.revokedAt);
          if (!owned) throw notFound("Bağlı cihaz bulunamadı.");
          const timestamp = new Date().toISOString();
          owned.revokedAt = timestamp;
          owned.updatedAt = timestamp;
          cancelPushOutbox(data, owner, [owned.id], [owned.endpoint], "Cihaz bildirimi kullanıcı tarafından kapatıldı.", timestamp);
          removed = 1;
          return data;
        });
        noStore(res).json({ ok: true, removed, revokedId: subscriptionId });
      } catch (error) { next(error); }
    });

    app.post(`${prefix}/:id/undo-delete`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const notificationId = validateId(req.params.id, "Bildirim kimliği");
        const timestamp = new Date().toISOString();
        let notification = null;
        let restored = false;
        const saved = await store.update((data) => {
          const owned = findOwnedNotificationIncludingDeleted(data, notificationId, owner);
          if (owned.deletedAt) {
            owned.deletedAt = null;
            owned.updatedAt = timestamp;
            restored = true;
          }
          notification = publicNotification(owned);
          return data;
        });
        const count = unreadCount(saved, owner);
        if (restored) publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "delete-undone",
          notificationId, notification, unreadCount: count, updatedAt: timestamp
        });
        noStore(res).json({ ok: true, restored, notification, unreadCount: count });
      } catch (error) { next(error); }
    });

    // Keep this parameter route after every named collection route. Express
    // otherwise interprets "push-subscriptions" as a notification id.
    app.delete(`${prefix}/:id`, ...guards, riskOperationLimiter, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        const notificationId = validateId(req.params.id, "Bildirim kimliği");
        const timestamp = new Date().toISOString();
        let alreadyDeleted = false;
        let deletedAt = timestamp;
        const saved = await store.update((data) => {
          const owned = findOwnedNotificationIncludingDeleted(data, notificationId, owner);
          alreadyDeleted = Boolean(owned.deletedAt);
          if (!alreadyDeleted) {
            owned.deletedAt = timestamp;
            owned.updatedAt = timestamp;
            cancelNotificationOutbox(data, owner, new Set([notificationId]), "Bildirim kullanıcı tarafından silindi.", timestamp);
          }
          deletedAt = String(owned.deletedAt || timestamp);
          return data;
        });
        const count = unreadCount(saved, owner);
        if (!alreadyDeleted) publishNotificationStateEvent({
          recipientRole: owner.role, recipientId: owner.id, action: "deleted",
          notificationId, unreadCount: count, updatedAt: timestamp
        });
        noStore(res).json({ ok: true, deletedId: notificationId, deletedAt, alreadyDeleted, unreadCount: count });
      } catch (error) { next(error); }
    });

    if (!admin) {
      app.post(`${prefix}/test`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          if (!pushService || typeof pushService.isConfigured !== "function" || !pushService.isConfigured()
            || typeof pushService.sendNotificationPush !== "function") {
            throw httpError(503, "Telefon bildirimleri sunucuda henüz etkinleştirilmemiş.");
          }
          const owner = recipientFromRequest(req, role);
          const appTarget = requestPushAppTarget(req, owner);
          const requestedSubscriptionId = String(req.body && req.body.subscriptionId || "").trim();
          if (requestedSubscriptionId) validateId(requestedSubscriptionId, "Cihaz kimliği");
          const requestedDeviceId = normalizedDeviceId(req.body && req.body.deviceId || req.get("x-menu-suite-device-id"));
          const data = req.storeSnapshot || await store.read();
          const preference = getNotificationPreferences(data, owner.role, owner.id);
          const subscriptions = (data.pushSubscriptions || [])
            .filter((item) => pushSubscriptionMatches(item, owner, appTarget) && !item.disabledAt && !item.revokedAt)
            .sort((left, right) => String(right.lastSeenAt || right.updatedAt || right.createdAt || "")
              .localeCompare(String(left.lastSeenAt || left.updatedAt || left.createdAt || "")));
          const subscription = requestedSubscriptionId
            ? subscriptions.find((item) => item.id === requestedSubscriptionId)
            : requestedDeviceId
              ? subscriptions.find((item) => normalizedDeviceId(item.deviceId) === requestedDeviceId)
              : subscriptions[0];
          if (!subscription) throw httpError(409, "Bu hesap için etkin bir bildirim cihazı bulunamadı. Bildirimleri yeniden açın.");

          const notification = {
            id: `push-test-${crypto.randomUUID()}`,
            recipientRole: owner.role,
            recipientId: owner.id,
            category: "system",
            eventType: "notification_test",
            title: "Test bildirimi",
            body: "Telefon bildirimleri bu cihazda çalışıyor.",
            severity: "success",
            deepLink: appTarget === "personel" ? "/personel/#notifications" : APP_ROOTS[appTarget],
            appTarget
          };
          try {
            await pushService.sendNotificationPush(notification, subscription.subscription || subscription, {
              vibrationEnabled: preference.pushVibrationEnabled !== false
            });
          } catch (error) {
            const statusCode = Number(error && (error.statusCode || error.status) || 0);
            if ([404, 410].includes(statusCode)) {
              await disableOwnedPushSubscription(store, owner, subscription.id, statusCode);
              throw httpError(410, "Bildirim aboneliğinin süresi dolmuş. Bildirimleri yeniden açın.");
            }
            throw httpError(502, "Test bildirimi teslim edilemedi. Lütfen tekrar deneyin.");
          }
          const deliveredAt = new Date().toISOString();
          await store.update((snapshot) => {
            const current = (snapshot.pushSubscriptions || []).find((item) => item && item.id === subscription.id
              && pushSubscriptionMatches(item, owner) && !item.disabledAt && !item.revokedAt);
            if (current) {
              current.lastSuccessAt = deliveredAt;
              current.lastSeenAt = deliveredAt;
              current.updatedAt = deliveredAt;
              current.failureCount = 0;
            }
            return snapshot;
          });
          noStore(res).json({
            ok: true,
            delivered: true,
            deliveredAt,
            subscription: publicPushDevice({
              ...subscription,
              lastSuccessAt: deliveredAt,
              lastSeenAt: deliveredAt,
              updatedAt: deliveredAt
            }, requestedDeviceId)
          });
        } catch (error) { next(error); }
      });
    }

    app.get(`${prefix}/events`, ...guards, async (req, res, next) => {
      try {
        const owner = recipientFromRequest(req, role);
        res.set({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
          "Content-Encoding": "identity"
        });
        res.flushHeaders();
        if (res.socket) res.socket.setTimeout(0);
        res.write("retry: 5000\n\n");
        let closed = false;
        const initialData = req.storeSnapshot || await store.read();
        let currentUnreadCount = unreadCount(initialData, owner);
        notificationEventRevision = Math.max(notificationEventRevision, newestNotificationRevision(initialData, owner));
        const lastEventId = Number(String(req.get("Last-Event-ID") || "").split(":").pop() || 0);
        writeSse(res, "ready", {
          revision: notificationEventRevision,
          scope: "notifications",
          action: "ready",
          requiresRefetch: Number.isSafeInteger(lastEventId) && lastEventId > 0 && lastEventId < notificationEventRevision,
          unreadCount: currentUnreadCount
        }, notificationEventRevision);
        const deliveredIds = new Set();
        const listener = (notification) => {
          if (closed || !notificationMatchesOwner(notification, owner)
            || isRetiredNotificationCategory(notification.category, notification.eventType) || notification.inAppVisible === false) return;
          const notificationId = String(notification.id || "");
          const deliveryIdentity = `${notificationId}:${Number(notification.revision || 0)}`;
          if (notificationId && deliveredIds.has(deliveryIdentity)) return;
          if (notificationId) {
            deliveredIds.add(deliveryIdentity);
            if (deliveredIds.size > 200) deliveredIds.delete(deliveredIds.values().next().value);
          }
          if (!notification.archivedAt && !notification.readAt) currentUnreadCount += 1;
          notificationEventRevision = nextNotificationRevision(notificationEventRevision, notification);
          writeSse(res, "notification", {
            revision: notificationEventRevision,
            scope: "notifications",
            action: "created",
            requiresRefetch: false,
            notification: publicNotification(notification),
            unreadCount: currentUnreadCount
          }, notificationEventRevision);
        };
        const unsubscribe = subscribeNotificationEvents(listener);
        const stateListener = (event) => {
          if (closed || !notificationMatchesOwner(event, owner)) return;
          if (Number.isSafeInteger(Number(event.unreadCount))) currentUnreadCount = Math.max(0, Number(event.unreadCount));
          notificationEventRevision = nextNotificationRevision(notificationEventRevision, { updatedAt: event.updatedAt });
          writeSse(res, "notification", {
            revision: notificationEventRevision,
            scope: "notifications",
            action: String(event.action || "updated"),
            requiresRefetch: true,
            notificationId: String(event.notificationId || ""),
            deletedCount: Math.max(0, Number(event.deletedCount || 0)),
            updatedCount: Math.max(0, Number(event.updatedCount || 0)),
            unreadCount: currentUnreadCount
          }, notificationEventRevision);
        };
        const unsubscribeState = subscribeNotificationStateEvents(stateListener);
        const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 25000);
        if (typeof heartbeat.unref === "function") heartbeat.unref();
        activeSseResponses.add(res);
        req.once("close", () => { closed = true; activeSseResponses.delete(res); clearInterval(heartbeat); unsubscribe(); unsubscribeState(); });
      } catch (error) { next(error); }
    });

    if (admin) {
      app.post(`${prefix}/test`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          let notification = null;
          await store.update((data) => {
            notification = createNotificationInStore(data, {
              recipientRole: "manager",
              recipientId: "manager",
              category: "system",
              eventType: "notification_test",
              title: String(req.body && req.body.title || "Bildirim testi"),
              body: String(req.body && req.body.body || "Bildirim altyapısı çalışıyor."),
              severity: "success",
              deepLink: "/yonetici/",
              dedupeKey: `notification-test:${crypto.randomUUID()}`
            });
            return data;
          });
          for (const item of notificationsFromResult(notification)) publishNotificationEvent(item);
          noStore(res).status(201).json({ ok: true, notification: publicNotification(notification) });
        } catch (error) { next(error); }
      });

      app.get(`${prefix}/delivery-health`, ...guards, async (_req, res, next) => {
        try { noStore(res).json({ ok: true, health: await deliveryWorker.health() }); } catch (error) { next(error); }
      });

      app.post(`${prefix}/outbox/:id/retry`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          const id = validateId(req.params.id, "Teslim kaydı kimliği");
          noStore(res).json({ ok: true, outbox: await deliveryWorker.retry(id) });
        } catch (error) { next(error); }
      });

      app.post(`${prefix}/outbox/:id/cancel`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          const id = validateId(req.params.id, "Teslim kaydı kimliği");
          noStore(res).json({ ok: true, outbox: await deliveryWorker.cancelPending(id) });
        } catch (error) { next(error); }
      });

      app.post(`${prefix}/outbox/:id/stop-retry`, ...guards, riskOperationLimiter, async (req, res, next) => {
        try {
          const id = validateId(req.params.id, "Teslim kaydı kimliği");
          noStore(res).json({ ok: true, outbox: await deliveryWorker.stopRetry(id) });
        } catch (error) { next(error); }
      });
    }
  }

  return runtime;
}

function listDeliveryHistory(data, query = {}) {
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
  const requestedStatus = String(query.status || "").trim().toLowerCase();
  const allowedStatuses = new Set(["pending", "processing", "sent", "failed", "cancelled", "suppressed", "merged"]);
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "";
  const notifications = new Map((Array.isArray(data.notifications) ? data.notifications : [])
    .filter(Boolean).map((item) => [item.id, item]));
  const deliveries = (Array.isArray(data.notificationOutbox) ? data.notificationOutbox : [])
    .filter((item) => item && (!status || item.status === status))
    .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
    .slice(0, limit)
    .map((item) => {
      const notification = notifications.get(item.notificationId) || {};
      return {
        id: item.id,
        notificationId: item.notificationId,
        channel: item.channel,
        status: item.status,
        attemptCount: Math.max(0, Number(item.attemptCount || 0)),
        nextAttemptAt: item.nextAttemptAt || null,
        lastAttemptAt: item.lastAttemptAt || null,
        sentAt: item.sentAt || null,
        createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || item.createdAt || null,
        reason: String(item.lastError || notification.notificationReason || "").slice(0, 500),
        destination: maskDeliveryDestination(item.channel, item.destination),
        title: String(notification.title || "Bildirim teslimi").slice(0, 180),
        ruleId: String(notification.ruleId || notification.metadata && notification.metadata.ruleId || "").slice(0, 120),
        ruleLabel: String(notification.ruleLabel || notification.metadata && notification.metadata.ruleLabel || "").slice(0, 180)
      };
    });
  return { deliveries, total: deliveries.length };
}

function listNotificationPersonnelOptions(data) {
  return (Array.isArray(data && data.recipeUsers) ? data.recipeUsers : [])
    .filter((item) => item && item.active !== false && !item.deletedAt && !item.archivedAt && String(item.id || "").trim())
    .map((item) => ({
      id: String(item.id),
      name: String(item.name || item.username || "Personel").slice(0, 160),
      username: String(item.username || "").slice(0, 120),
      personelSectionAccess: {
        recipe: item.personelSectionAccess?.recipe !== false,
        tasks: item.personelSectionAccess?.tasks !== false,
        materialRequest: item.personelSectionAccess?.materialRequest !== false,
        shift: item.personelSectionAccess?.shift !== false
      }
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "tr"));
}

function maskDeliveryDestination(channel, value) {
  const text = String(value || "");
  if (channel === "email") {
    const [local, domain] = text.split("@");
    return domain ? `${String(local || "").slice(0, 2)}***@${domain}` : "***";
  }
  return text ? `${text.slice(0, 24)}…` : "";
}

function recipientFromRequest(req, role) {
  const requestedTarget = String(req.query && req.query.appTarget || req.get("x-menu-suite-app-target") || "").trim();
  const appTarget = requestedTarget ? normalizeAppTarget(requestedTarget, "", role) : "";
  if (role === "manager") return { role: "manager", id: "manager", appTarget };
  const id = String(req.recipeUser && req.recipeUser.id || req.recipe && req.recipe.userId || "").trim();
  if (!id) {
    const error = new Error("Aktif personel hesabı gerekli.");
    error.status = 403;
    throw error;
  }
  return { role: "personnel", id, appTarget };
}

function notificationMatchesOwner(item, owner) {
  const ownerRole = owner && owner.role;
  const itemRole = item && item.recipientRole;
  const canonicalRoleMatch = (ownerRole === "manager" || ownerRole === "personnel") && itemRole === ownerRole;
  if (canonicalRoleMatch) {
    if (ownerRole === "personnel" && String(item.recipientId || "") !== String(owner.id || "")) return false;
  } else if (!recipientMatches(item, ownerRole, owner && owner.id)) return false;
  if (!owner.appTarget || !item.appTarget && !item.deepLink) return true;
  return notificationTargetsApp(item, owner.appTarget);
}

const ACTIVE_NOTIFICATION_CATEGORIES = new Set(["feedback", "task", "shipment", "shift", "stock", "system"]);

function retiredNotification(item) {
  if (!item) return true;
  if (item.category === "training") return true;
  const eventType = String(item.eventType || "");
  if (ACTIVE_NOTIFICATION_CATEGORIES.has(item.category)
    && /^[a-z0-9_]*$/.test(eventType)
    && !/(?:recipe|training|egitim|sinav)/.test(eventType)) return false;
  return isRetiredNotificationCategory(item.category, eventType);
}

async function listNotifications(data, owner, query) {
  const limitValue = query.limit === undefined || query.limit === "" ? 30 : Number(query.limit);
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100) throw badRequest("Limit 1 ile 100 arasında bir tam sayı olmalıdır.");
  const limit = limitValue;
  const category = parseCategoryFilter(query.category);
  const severity = parseSeverityFilter(query.severity);
  const cursor = String(query.cursor || "").trim();
  if (cursor.length > 180) throw badRequest("Bildirim imleci geçersiz.");
  const archivedOnly = String(query.archived || "") === "true" || String(query.status || "").toLowerCase() === "archived";
  const includeArchived = archivedOnly || String(query.includeArchived || "") === "true";
  const unreadOnly = [query.unread, query.unreadOnly].some((value) => String(value || "") === "true");
  const requestedTarget = String(query.appTarget || owner.appTarget || "").trim();
  const appTarget = requestedTarget ? normalizeAppTarget(requestedTarget, "", owner.role) : "";
  let items = [];
  let ascending = true;
  let descending = true;
  let previousItem = null;
  const counts = { inbox: 0, unread: 0, read: 0, archived: 0 };
  let currentUnreadCount = 0;
  const source = data.notifications || [];
  for (let index = 0; index < source.length; index += 1) {
    if (index > 0 && index % 1024 === 0) await yieldToEventLoop();
    const item = source[index];
    if (!item || !notificationMatchesOwner(item, owner)
      || retiredNotification(item)
      || item.deletedAt || item.inAppVisible === false
      || (appTarget && !notificationTargetsApp(item, appTarget))) continue;
    const archived = Boolean(item.archivedAt);
    const read = Boolean(item.readAt);
    if (!archived && !read) currentUnreadCount += 1;
    const categoryMatches = !category || normalizeNotificationCategory(item.category) === category;
    if (categoryMatches) {
      if (archived) counts.archived += 1;
      else {
        counts.inbox += 1;
        if (read) counts.read += 1;
        else counts.unread += 1;
      }
    }
    if (!categoryMatches || (!includeArchived && archived) || (archivedOnly && !archived)
      || (unreadOnly && (read || archived)) || (severity && item.severity !== severity)) continue;
    if (previousItem) {
      const order = compareNotificationChronology(previousItem, item);
      if (order > 0) ascending = false;
      if (order < 0) descending = false;
    }
    previousItem = item;
    items.push(item);
  }
  if (items.length > 1) {
    if (ascending && !descending) items.reverse();
    else if (!descending) items.sort(compareNotificationNewestFirst);
  }
  if (cursor) {
    const cursorIndex = items.findIndex((item) => item.id === cursor);
    if (cursorIndex < 0) throw badRequest("Bildirim imleci artık geçerli değil; listeyi yenileyin.");
    items = items.slice(cursorIndex + 1);
  }
  const page = items.slice(0, limit);
  return {
    notifications: page.map(publicNotification),
    unreadCount: currentUnreadCount,
    counts,
    nextCursor: items.length > limit && page.length ? page[page.length - 1].id : null
  };
}

async function unreadCountCooperatively(data, owner) {
  let count = 0;
  const source = data.notifications || [];
  for (let index = 0; index < source.length; index += 1) {
    if (index > 0 && index % 1024 === 0) await yieldToEventLoop();
    const item = source[index];
    if (!item || !notificationMatchesOwner(item, owner) || retiredNotification(item)
      || item.deletedAt || item.inAppVisible === false || item.archivedAt || item.readAt
      || (owner.appTarget && !notificationTargetsApp(item, owner.appTarget))) continue;
    count += 1;
  }
  return count;
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function compareNotificationChronology(left, right) {
  const leftCreatedAt = String(left && left.createdAt || "");
  const rightCreatedAt = String(right && right.createdAt || "");
  if (leftCreatedAt < rightCreatedAt) return -1;
  if (leftCreatedAt > rightCreatedAt) return 1;
  const leftId = String(left && left.id || "");
  const rightId = String(right && right.id || "");
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function compareNotificationNewestFirst(left, right) {
  return -compareNotificationChronology(left, right);
}

function notificationCounts(data, owner, category = "") {
  const counts = { inbox: 0, unread: 0, read: 0, archived: 0 };
  for (const item of data.notifications || []) {
    if (!item || !notificationMatchesOwner(item, owner) || retiredNotification(item)
      || item.deletedAt || item.inAppVisible === false
      || (category && normalizeNotificationCategory(item.category) !== category)) continue;
    if (item.archivedAt) counts.archived += 1;
    else {
      counts.inbox += 1;
      if (item.readAt) counts.read += 1;
      else counts.unread += 1;
    }
  }
  return counts;
}

function unreadCount(data, owner) {
  let count = 0;
  for (const item of data.notifications || []) {
    if (!item || !notificationMatchesOwner(item, owner) || retiredNotification(item)
      || item.deletedAt || item.inAppVisible === false || item.archivedAt || item.readAt
      || (owner.appTarget && !notificationTargetsApp(item, owner.appTarget))) continue;
    count += 1;
  }
  return count;
}

function findOwnedNotification(data, id, owner) {
  const item = findOwnedNotificationIncludingDeleted(data, id, owner, { allowMissing: true });
  if (item?.deletedAt) throw notFound("Bildirim bulunamadı.");
  if (!item) {
    throw notFound("Bildirim bulunamadı.");
  }
  return item;
}

function findOwnedNotificationIncludingDeleted(data, id, owner, options = {}) {
  const item = (data.notifications || []).find((entry) => entry
    && entry.id === String(id || "")
    && !retiredNotification(entry)
    && notificationMatchesOwner(entry, owner)
    && (!owner.appTarget || notificationTargetsApp(entry, owner.appTarget)));
  if (!item && !options.allowMissing) throw notFound("Bildirim bulunamadı.");
  return item || null;
}

function findOwnedNotifications(data, ids, owner) {
  const requestedIds = new Set(ids.map((id) => String(id || "")));
  const found = new Map();
  for (const entry of data.notifications || []) {
    const id = entry && String(entry.id || "");
    if (!requestedIds.has(id) || found.has(id) || entry.deletedAt || retiredNotification(entry)
      || !notificationMatchesOwner(entry, owner)
      || (owner.appTarget && !notificationTargetsApp(entry, owner.appTarget))) continue;
    found.set(id, entry);
  }
  const records = ids.map((id) => found.get(String(id || "")));
  if (records.some((item) => !item)) {
    const error = new Error("Bildirim bulunamadı.");
    error.status = 404;
    throw error;
  }
  return records;
}

function publicNotification(item) {
  return {
    id: item.id,
    category: item.category,
    eventType: item.eventType,
    title: item.title,
    body: item.body,
    severity: item.severity,
    entityType: item.entityType || "",
    entityId: item.entityId || "",
    deepLink: item.deepLink || "",
    appTarget: item.appTarget || "",
    ruleId: item.ruleId || item.metadata && item.metadata.ruleId || "",
    ruleLabel: item.ruleLabel || item.metadata && item.metadata.ruleLabel || "",
    reason: item.notificationReason || item.metadata && item.metadata.notificationReason || "",
    metadata: item.metadata || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    readAt: item.readAt || null,
    archivedAt: item.archivedAt || null
  };
}

function notificationCapabilities(pushService, preferences = {}) {
  const pushSupported = Boolean(pushService && pushService.isConfigured());
  const emailVerified = preferences.emailVerified === true;
  return {
    pushSupported,
    vapidPublicKey: pushSupported ? pushService.publicKey : "",
    emailSupported: emailVerified,
    emailVerified
  };
}

function pushSubscriptionMatches(item, owner, appTarget = "") {
  if (!item || !owner) return false;
  const role = normalizeRole(item.ownerRole || item.recipientRole);
  const id = role === "manager" ? "manager" : String(item.ownerId || item.recipientId || "");
  return role === owner.role && id === owner.id
    && (!appTarget || pushSubscriptionAppTarget(item) === appTarget);
}

function requestPushAppTarget(req, owner) {
  const body = req && req.body && typeof req.body === "object" ? req.body : {};
  return normalizeAppTarget(
    body.appId || body.appTarget || req.get("x-menu-suite-app-id") || req.get("x-menu-suite-app-target"),
    "",
    owner && owner.role
  );
}

function pushSubscriptionAppTarget(item) {
  return normalizeAppTarget(
    item && (item.appId || item.appTarget),
    "",
    normalizeRole(item && (item.ownerRole || item.recipientRole))
  );
}

function normalizedDeviceId(value) {
  const id = String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180);
  return id;
}

function normalizedDeviceName(value, userAgent) {
  const explicit = String(value || "").trim().replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").slice(0, 120);
  if (explicit) return explicit;
  const agent = String(userAgent || "");
  if (/Edg\//i.test(agent)) return "Microsoft Edge";
  if (/Firefox\//i.test(agent)) return "Firefox";
  if (/(?:Chrome|CriOS)\//i.test(agent)) return "Google Chrome";
  if (/Safari\//i.test(agent) && !/Chrome|Chromium|Android/i.test(agent)) return "Safari";
  return "Bu cihaz";
}

function publicPushDevice(item, currentDeviceId, options = {}) {
  const deviceId = normalizedDeviceId(item && item.deviceId);
  const deviceName = normalizedDeviceName(item && item.deviceName, item && item.userAgent);
  const device = {
    id: String(item && item.id || ""),
    deviceId,
    deviceName,
    name: deviceName,
    appTarget: pushSubscriptionAppTarget(item),
    appId: pushSubscriptionAppTarget(item),
    createdAt: item && item.createdAt || null,
    updatedAt: item && item.updatedAt || null,
    lastSeenAt: item && (item.lastSeenAt || item.updatedAt || item.createdAt) || null,
    lastSuccessAt: item && item.lastSuccessAt || null,
    disabledAt: item && item.disabledAt || null,
    status: item && item.disabledAt ? "disabled" : "active",
    current: Boolean(currentDeviceId && deviceId && currentDeviceId === deviceId)
  };
  device.isCurrent = device.current;
  if (options.includeEndpoint) device.endpoint = String(item && item.endpoint || "");
  return device;
}

function cancelNotificationOutbox(data, owner, notificationIds, reason, timestamp = new Date().toISOString()) {
  cancelOutboxItems(data, (item) => item
    && notificationIds.has(item.notificationId)
    && normalizeRole(item.recipientRole) === owner.role
    && String(owner.role === "manager" ? "manager" : item.recipientId || "") === owner.id, reason, timestamp);
}

function cancelPushOutbox(data, owner, subscriptionIds, endpoints, reason, timestamp = new Date().toISOString()) {
  const ids = new Set((subscriptionIds || []).filter(Boolean));
  const destinations = new Set((endpoints || []).filter(Boolean));
  cancelOutboxItems(data, (item) => item
    && item.channel === "push"
    && normalizeRole(item.recipientRole) === owner.role
    && String(owner.role === "manager" ? "manager" : item.recipientId || "") === owner.id
    && (ids.has(item.subscriptionId) || destinations.has(item.destination)), reason, timestamp);
}

function cancelOutboxItems(data, matches, reason, timestamp) {
  for (const item of data.notificationOutbox || []) {
    if (!matches(item) || ["sent", "cancelled"].includes(item.status) || item.dispatchStartedAt) continue;
    item.status = "cancelled";
    item.nextAttemptAt = null;
    item.lockedAt = null;
    item.lockedBy = "";
    item.lastError = String(reason || "Bildirim teslimi kullanıcı tarafından iptal edildi.").slice(0, 500);
    item.updatedAt = timestamp;
  }
}

function validatePushSubscription(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const endpoint = String(source.endpoint || "").trim();
  const p256dh = String(source.keys && source.keys.p256dh || "").trim();
  const auth = String(source.keys && source.keys.auth || "").trim();
  if (!/^https:\/\//i.test(endpoint) || !p256dh || !auth || endpoint.length > 2048 || p256dh.length > 500 || auth.length > 500) {
    throw badRequest("Geçerli bir Web Push aboneliği gerekli.");
  }
  return { endpoint, expirationTime: source.expirationTime || null, keys: { p256dh, auth } };
}

function writeSse(res, event, payload, id) {
  if (res.writableEnded) return;
  if (id !== undefined && id !== null) res.write(`id: ${String(id).replace(/[\r\n]/g, "")}\n`);
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function newestNotificationRevision(data, owner) {
  let revision = 0;
  for (const item of data.notifications || []) {
    if (!item || item.deletedAt || isRetiredNotificationCategory(item.category, item.eventType)
      || !notificationMatchesOwner(item, owner)) continue;
    revision = Math.max(revision, Date.parse(item.updatedAt || item.createdAt || "") || 0);
  }
  return revision;
}

function nextNotificationRevision(current, notification) {
  const hinted = Date.parse(notification && (notification.updatedAt || notification.createdAt) || "") || 0;
  return hinted > current ? hinted : current + 1;
}

function noStore(res) {
  res.set("Cache-Control", "no-store");
  return res;
}

function parseScheduledNotificationInput(value, current = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (source.kind !== undefined && source.kind !== "stock_critical_snapshot") {
    throw badRequest("Desteklenmeyen zamanlı bildirim türü.");
  }
  const title = cleanScheduleText(source.title !== undefined ? source.title : current.title, 120)
    || "Kritik stok kontrolü";
  const note = cleanScheduleText(source.note !== undefined ? source.note : current.note, 500);
  const scheduledAtValue = source.scheduledAt !== undefined ? source.scheduledAt : current.scheduledAt;
  const scheduledAtDate = new Date(scheduledAtValue || "");
  if (!Number.isFinite(scheduledAtDate.getTime())) throw badRequest("Geçerli bir bildirim tarihi ve saati seçilmelidir.");
  const now = Date.now();
  if (scheduledAtDate.getTime() <= now) throw badRequest("Bildirim zamanı gelecekte olmalıdır.");
  if (scheduledAtDate.getTime() > now + 730 * 24 * 60 * 60 * 1000) {
    throw badRequest("Bildirim zamanı en fazla iki yıl sonrasına ayarlanabilir.");
  }
  return { kind: "stock_critical_snapshot", title, note, scheduledAt: scheduledAtDate.toISOString() };
}

function cleanScheduleText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function publicScheduledNotification(item) {
  return {
    id: String(item && item.id || ""),
    kind: "stock_critical_snapshot",
    title: String(item && item.title || "Kritik stok kontrolü"),
    note: String(item && item.note || ""),
    scheduledAt: item && item.scheduledAt || null,
    status: item && item.status === "executed" ? "executed" : "pending",
    notificationId: String(item && item.notificationId || ""),
    executedAt: item && item.executedAt || null,
    createdAt: item && item.createdAt || null,
    updatedAt: item && item.updatedAt || null
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function disableOwnedPushSubscription(store, owner, subscriptionId, statusCode) {
  const timestamp = new Date().toISOString();
  await store.update((data) => {
    const subscription = (data.pushSubscriptions || []).find((item) => item && item.id === subscriptionId
      && pushSubscriptionMatches(item, owner));
    if (!subscription || subscription.revokedAt) return data;
    subscription.disabledAt = subscription.disabledAt || timestamp;
    subscription.lastFailureAt = timestamp;
    subscription.failureCount = Math.max(0, Number(subscription.failureCount || 0)) + 1;
    subscription.updatedAt = timestamp;
    for (const item of data.notificationOutbox || []) {
      if (!item || item.channel !== "push" || item.subscriptionId !== subscription.id
        || !["pending", "processing"].includes(item.status)) continue;
      item.status = "cancelled";
      item.nextAttemptAt = null;
      item.lockedAt = null;
      item.lockedBy = "";
      item.lastError = `Push aboneliği ${statusCode === 404 ? "bulunamadığı" : "sona erdiği"} için devre dışı bırakıldı.`;
      item.updatedAt = timestamp;
    }
    return data;
  });
}

function validateId(value, label) {
  const id = String(value || "").trim();
  if (!id || id.length > 180 || /[\u0000-\u001f\u007f]/.test(id)) throw badRequest(`${label} geçersiz.`);
  return id;
}

function parseCategoryFilter(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const category = normalizeNotificationCategory(text);
  const normalizedInput = text.toLocaleLowerCase("tr-TR").replace(/[_-]+/g, " ");
  if (!NOTIFICATION_CATEGORIES.includes(category)) {
    throw badRequest(`Kategori ${NOTIFICATION_CATEGORIES.join(", ")} değerlerinden biri olmalıdır.`);
  }
  if (category === "system" && !["system", "sistem", "reminder", "hatırlatma", "hatirlatma"].includes(normalizedInput)) {
    throw badRequest(`Kategori ${NOTIFICATION_CATEGORIES.join(", ")} değerlerinden biri olmalıdır.`);
  }
  return category;
}

function parseSeverityFilter(value) {
  const severity = String(value || "").trim().toLowerCase();
  if (!severity) return "";
  if (!NOTIFICATION_SEVERITIES.includes(severity)) throw badRequest("Bildirim önem düzeyi geçersiz.");
  return severity;
}

module.exports = {
  listDeliveryHistory,
  listNotifications,
  publicNotification,
  registerNotificationRoutes,
  unreadCount,
  validatePushSubscription
};
