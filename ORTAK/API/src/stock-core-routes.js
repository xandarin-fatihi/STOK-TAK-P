"use strict";

const crypto = require("crypto");
const { normalizeStockState } = require("./store/migrations");
const { normalizeProductCode } = require("./store/product-code-registry");
const stockService = require("./stock-service");

function registerStockCoreRoutes(options = {}) {
  const { app, store, auth, notificationService } = options;
  const clients = new Set();
  const publishGatewayEvent = typeof options.publishGatewayEvent === "function" ? options.publishGatewayEvent : () => {};

  function requireStockRead(req, res, next) {
    return auth.requireRecipe(req, res, () => {
      const payload = req.recipe || req.admin || {};
      if (payload.role === "admin" || payload.sessionRole === "admin") return next();
      if (payload.role === "preview" || payload.previewRole) {
        return res.status(403).json({ ok: false, message: "Önizleme oturumu stok verisine erişemez." });
      }
      return auth.requireActivePersonel(req, res, () => auth.requirePersonelSection("stock")(req, res, next));
    });
  }

  app.get("/api/stock", options.requireRequestOrigin, requireStockRead, asyncRoute(async (req, res) => {
    const data = req.storeSnapshot || await store.read();
    const fullState = normalizeStockState(data.stockState);
    const actor = stockActorFromRequest(req);
    res.json({
      ok: true,
      stockState: actor.type === "admin" ? fullState : stockStateForPersonnel(fullState, actor),
      ...revisionPayload(data),
      publishRevision: Number(data.revisions && data.revisions.publish || 0),
      updatedAt: data.stockUpdatedAt || null
    });
  }));

  app.get("/api/stock/events", options.requireRequestOrigin, requireStockRead, asyncRoute(async (req, res) => {
    const data = req.storeSnapshot || await store.read();
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 5000\n\n");
    writeSse(res, "ready", { scope: "stock", ...revisionPayload(data), updatedAt: data.stockUpdatedAt || null });
    const client = { res, heartbeat: setInterval(() => { if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`); }, 25000) };
    if (typeof client.heartbeat.unref === "function") client.heartbeat.unref();
    clients.add(client);
    req.once("close", () => closeClient(client));
  }));

  app.put("/api/admin/stock", options.requireRequestOrigin, auth.requireAdmin, (_req, res) => {
    res.status(410).json({ ok: false, code: "STOCK_BULK_REPLACE_RETIRED", message: "Toplu stok üzerine yazma kaldırıldı; granular stok işlemlerini kullanın." });
  });

  app.post("/api/stock/movements", options.requireRequestOrigin, auth.requireActivePersonel,
    auth.requirePersonelSection("stock"), asyncRoute(async (req, res) => {
      const actor = stockActorFromRequest(req);
      const submitted = req.body && req.body.movement || req.body || {};
      const operationId = String(req.get("Idempotency-Key") || req.get("X-Request-ID") || submitted.requestId || "").trim().slice(0, 160);
      if (!/^[a-zA-Z0-9._:-]{8,160}$/.test(operationId)) {
        return res.status(400).json({ ok: false, message: "Stok işlemi için en az 8 karakterlik requestId zorunludur." });
      }
      const movementInput = { ...submitted, requestId: operationId, idempotencyKey: operationId };
      const updatedAt = new Date().toISOString();
      const pendingNotifications = [];
      let result;
      const saved = await store.update((data, context) => {
        const currentRevision = inventoryRevision(data);
        const expectedRevision = Number(movementInput.expectedInventoryRevision ?? req.body?.expectedInventoryRevision
          ?? movementInput.expectedRevision ?? req.body?.expectedRevision);
        const previous = normalizeStockState(data.stockState);
        const candidate = stockService.applyStockMovement(previous, movementInput, actor, { requestId: operationId });
        if (candidate.idempotent === true) {
          result = candidate;
          return context.noChange;
        }
        if (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision) {
          throw fail("Stok verisi değişti. Güncel bakiyeyi alıp işlemi yeniden deneyin.", 409, "STOCK_REVISION_CONFLICT");
        }
        result = candidate;
        data.stockState = candidate.stockState;
        queueStockThresholdNotifications(data, pendingNotifications, previous, candidate.stockState, { operationId, updatedAt });
        data.revisions = data.revisions && typeof data.revisions === "object" ? data.revisions : {};
        data.revisions.inventory = currentRevision + 1;
        data.revisions.stock = Math.max(Number(data.revisions.stock || 0) + 1, data.revisions.inventory);
        data.recipeActivity = (Array.isArray(data.recipeActivity) ? data.recipeActivity : []).concat({
          id: `stock-audit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
          type: "stock.movement.create", action: "stock.movement.create", actorId: String(actor.id || ""),
          actorRole: actor.type, entityType: "stock_movement", entityId: String(candidate.movement && candidate.movement.id || ""),
          requestId: operationId, createdAt: updatedAt
        }).slice(-5000);
        data.stockUpdatedAt = updatedAt;
        return data;
      });
      if (!result.idempotent) broadcastStockUpdate(result.stockState, updatedAt, inventoryRevision(saved), "inventory");
      publishNotifications(pendingNotifications);
      res.status(result.idempotent ? 200 : 201).json({
        ok: true,
        stockState: stockStateForPersonnel(result.stockState || normalizeStockState(saved.stockState), actor),
        movement: result.movement,
        idempotent: result.idempotent === true,
        ...revisionPayload(saved),
        publishRevision: Number(saved.revisions && saved.revisions.publish || 0),
        updatedAt: saved.stockUpdatedAt || updatedAt
      });
    }));

  function broadcastStockUpdate(_stockState, updatedAt, revision = 0, domain = "inventory") {
    const payload = { scope: "stock", action: "invalidate", requiresRefetch: true, revision: Number(revision || 0), updatedAt };
    for (const client of [...clients]) {
      if (!client.res || client.res.writableEnded) closeClient(client);
      else writeSse(client.res, "stock", payload);
    }
    const topic = domain === "catalog" ? "catalog" : "inventory";
    publishGatewayEvent({
      eventId: `${topic}:${Math.max(0, Number(revision || 0))}`,
      topic, type: `${topic}.updated`, entityType: topic,
      revision: Math.max(0, Number(revision || 0)), timestamp: updatedAt,
      targets: ["personel", "yonetici"]
    });
    return payload;
  }

  function queueStockThresholdNotifications(data, pending, previousState, nextState, context = {}) {
    const operationId = String(context.operationId || context.updatedAt || Date.now()).slice(0, 160);
    const before = normalizeStockState(previousState || {});
    const after = normalizeStockState(nextState || {});
    const beforeBalances = balanceMap(before);
    const afterBalances = balanceMap(after);
    const general = (after.locations || []).find((location) => location.code === "GENEL" || location.type === "central") || null;
    for (const location of after.locations || []) {
      if (location.active === false) continue;
      for (const product of after.products || []) {
        if (!product || product.active === false) continue;
        const key = `${location.id}\u0000${product.id}`;
        const previousKind = stockBalanceAlertKind(beforeBalances.get(key), location, beforeBalances.get(`${general && general.id}\u0000${product.id}`));
        const balance = afterBalances.get(key) || {};
        const kind = stockBalanceAlertKind(balance, location, afterBalances.get(`${general && general.id}\u0000${product.id}`));
        if (kind === previousKind) continue;
        const quantity = rounded(balance.quantity);
        const generalQuantity = general ? rounded((afterBalances.get(`${general.id}\u0000${product.id}`) || {}).quantity) : 0;
        const transition = kind === "ok" ? "recovered" : kind;
        const title = kind === "transfer" ? "Bakım atölyesi için transfer önerisi"
          : kind === "procurement" ? "Genel depoda tedarik ihtiyacı"
            : kind === "critical" ? "Bakım atölyesinde kritik stok" : "Stok tekrar yeterli seviyede";
        const unit = String(product.unit || "adet");
        const body = kind === "transfer"
          ? `${product.name} ${location.name} için eşik altına düştü; Genel Depoda ${generalQuantity} ${unit} bulunuyor.`
          : kind === "ok" ? `${product.name} ${location.name} için güvenli stok seviyesine çıktı: ${quantity} ${unit}.`
            : `${product.name} ${location.name} için ${quantity} ${unit} seviyesine düştü.`;
        queueNotification(data, pending, {
          recipientRole: "manager", recipientId: "manager", appTarget: "yonetici",
          category: "stock", eventType: `stock_${transition}`, title, body,
          severity: kind === "critical" ? "critical" : kind === "ok" ? "success" : "warning",
          entityType: "stock_balance", entityId: `${location.id}:${product.id}`,
          deepLink: `/yonetici/?section=locations&locationId=${encodeURIComponent(location.id)}&stockProductId=${encodeURIComponent(product.id)}`,
          dedupeKey: `stock-${transition}:${location.id}:${product.id}:${operationId}`,
          metadata: { productName: product.name, productCode: normalizeProductCode(product.productCode), locationId: location.id,
            locationName: location.name, quantity, generalQuantity, unit, transition },
          createdAt: context.updatedAt
        });
      }
    }
  }

  function queueNotification(data, pending, input) {
    if (!notificationService || typeof notificationService.createNotificationInStore !== "function") return;
    const result = notificationService.createNotificationInStore(data, input);
    const created = typeof notificationService.notificationsFromResult === "function"
      ? notificationService.notificationsFromResult(result) : result ? [result] : [];
    pending.push(...created);
  }

  function publishNotifications(pending) {
    if (!notificationService || typeof notificationService.publishNotificationEvent !== "function") return;
    for (const notification of pending) notificationService.publishNotificationEvent(notification);
  }

  function closeClient(client) {
    if (!client) return;
    clearInterval(client.heartbeat);
    clients.delete(client);
    try { if (client.res && !client.res.writableEnded) client.res.end(); } catch (_error) {}
  }

  return {
    broadcastStockUpdate,
    queueStockThresholdNotifications,
    getClientCount: () => clients.size,
    close: () => { for (const client of [...clients]) closeClient(client); }
  };
}

function stockActorFromRequest(req) {
  const payload = req.recipe || req.admin || {};
  if (payload.role === "admin" || payload.sessionRole === "admin") return { type: "admin", id: payload.sub || "admin", name: "Yönetici" };
  const user = req.recipeUser || {};
  return {
    type: "personel", id: String(user.id || payload.userId || ""),
    name: String(user.name || user.username || payload.name || "Personel"),
    branchId: String(user.branchId || "main"), stockLocationId: String(user.stockLocationId || "")
  };
}

function stockStateForPersonnel(stockState, actor) {
  const state = normalizeStockState(stockState || {});
  const locationId = stockService.actorLocationId(state, actor);
  const inventory = stockService.getLocationInventory(state, locationId);
  const quantities = new Map((inventory.balances || []).map((balance) => [String(balance.productId), Number(balance.quantity || 0)]));
  return {
    ...state,
    locations: inventory.location ? [inventory.location] : [],
    balances: (state.balances || []).filter((balance) => String(balance.locationId) === String(locationId)),
    products: (state.products || []).map((product) => {
      const { generalQuantity: _g, otherLocationQuantity: _o, totalQuantity: _t, suggestedTransfer: _s, ...publicProduct } = product;
      const stockQuantity = quantities.get(String(product.id)) || 0;
      return { ...publicProduct, stockQuantity, stockQuantityText: `${stockQuantity} ${product.unit || "adet"}` };
    }),
    movements: (state.movements || []).filter((movement) => [movement.locationId, movement.fromLocationId, movement.toLocationId].some((id) => String(id || "") === String(locationId))),
    transfers: (state.transfers || []).filter((transfer) => String(transfer.requestedBy || "") === String(actor.id || "")
      && [transfer.fromLocationId, transfer.toLocationId].some((id) => String(id || "") === String(locationId)))
  };
}

function revisionPayload(data) {
  const revisions = data && data.revisions || {};
  const inventory = Math.max(0, Number(revisions.inventory || 0));
  const catalog = Math.max(0, Number(revisions.catalog || 0));
  const stock = Math.max(0, Number(revisions.stock || 0));
  return { revision: inventory, inventoryRevision: inventory, catalogRevision: catalog, stockRevision: stock, revisions: { inventory, catalog, stock } };
}

function inventoryRevision(data) { return Math.max(0, Number(data && data.revisions && data.revisions.inventory || 0)); }
function balanceMap(state) { return new Map((state.balances || []).map((balance) => [`${balance.locationId}\u0000${balance.productId}`, balance])); }
function rounded(value) { return Math.round(Number(value || 0) * 1000) / 1000; }
function stockBalanceAlertKind(balance = {}, location, generalBalance = {}) {
  const quantity = Number(balance.quantity || 0), critical = Number(balance.criticalThreshold || 0), order = Number(balance.orderThreshold || 0);
  if (critical > 0 && quantity <= critical) return location && location.type === "central" ? "procurement" : "critical";
  if (order > 0 && quantity <= order) return location && location.type === "workshop" && Number(generalBalance.quantity || 0) > 0 ? "transfer" : "procurement";
  return "ok";
}
function writeSse(res, event, payload) { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); }
function fail(message, status, code) { return Object.assign(new Error(message), { status, code }); }
function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

module.exports = { registerStockCoreRoutes, stockStateForPersonnel };
