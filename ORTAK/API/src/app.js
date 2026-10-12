"use strict";

require("dotenv").config();
const { permissionsPolicyForPath } = require("./http-permissions");

const path = require("path");
const crypto = require("crypto");
const fs = require("fs/promises");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");

const { config, validateConfig } = require("./config");
const { createAuthMiddleware } = require("./middleware/auth");
const { createFileStore } = require("./store/file-store");
const { seedStoreIfEmpty } = require("./store/seed-defaults");
const { normalizeStockState } = require("./store/migrations");
const { validateMenuProductCodes } = require("./store/product-code-registry");
const { registerStockCoreRoutes } = require("./stock-core-routes");
const { registerStockLocationRoutes } = require("./stock-location-routes");
const { registerProcurementRoutes, resolveActorFromRequest } = require("./procurement-routes");
const { hasCapability: hasProcurementCapability } = require("./procurement-service");
const { createProcurementDocumentService } = require("./procurement-documents");
const { createProcurementImageProcessor } = require("./procurement-image-processor");
const { publishedMenuFingerprint, registerPublishRoutes } = require("./publish-routes");
const { registerPricingRoutes } = require("./pricing-routes");
const { registerDataImportRoutes } = require("./data-import-routes");
const { registerAdminDefaultRoutes } = require("./admin-defaults");
const { registerAccountSecurityRoutes } = require("./account-security-routes");
const { registerAdminProfileRoutes } = require("./admin-profile-routes");
const notificationService = require("./notification-service");
const { registerNotificationRoutes } = require("./notification-routes");
const { createNotificationDeliveryWorker } = require("./notification-delivery");
const { createMailService } = require("./mail-service");
const { createPushService } = require("./push-service");
const { migratePricingSystem, serializeLegacyMenuState } = require("./pricing");
const { buildPublicBootstrap, buildPwaManifest } = require("./public-bootstrap");
const { createNotificationScheduler } = require("./notification-scheduler");
const { serializePwaReleaseMetadata } = require("./pwa-release-metadata");
const { registerPersonelRoutes } = require("./personel-routes");
const { validateMenuState, validatePassword } = require("./validators");

validateConfig();

const app = express();
let lastImportantSystemError = null;
const store = createFileStore(config.dataFile, {
  bcryptRounds: config.bcryptRounds,
  defaultPanelPassword: config.defaultPanelPassword,
  backupDir: config.backupDir,
  externalCheckIntervalMs: config.storeExternalCheckIntervalMs,
  eventLoopResolutionMs: config.eventLoopDelayResolutionMs
});
const auth = createAuthMiddleware(config, store);
const mailService = createMailService(config);
const pushService = createPushService(config);
const notificationDeliveryWorker = createNotificationDeliveryWorker({ store, config, mailService, pushService, logError: logRuntimeError });
const menuSseClients = new Set();
const feedbackSseClients = new Set();
const notificationScheduler = createNotificationScheduler({ store, intervalMs: config.notificationReminderIntervalMs, logError: logRuntimeError });
const procurementDocumentService = createProcurementDocumentService({
  documentsDir: config.procurementDocumentsDir,
  maxUploadBytes: config.procurementMaxUploadBytes,
  imageProcessor: createProcurementImageProcessor(),
  strictImageProcessing: true
});
let personelRuntime;
let notificationRuntime;
let stockRuntime;
let procurementRuntime;

const projectRoot = config.projectRoot;
const adminHtmlRoot = path.join(projectRoot, "YÖNETİCİ PANELİ", "HTML");
const adminJsRoot = path.join(projectRoot, "YÖNETİCİ PANELİ", "JS");
const adminCssRoot = path.join(projectRoot, "YÖNETİCİ PANELİ", "CSS");
const adminPwaRoot = path.join(projectRoot, "YÖNETİCİ PANELİ", "PWA");
const adminAssetsRoot = path.join(projectRoot, "YÖNETİCİ PANELİ", "ASSETS");
const sharedJsRoot = path.join(projectRoot, "ORTAK", "JS");
const zxingBrowserBundle = path.join(projectRoot, "ORTAK", "node_modules", "@zxing", "browser", "umd", "zxing-browser.min.js");
const sharedCssRoot = path.join(projectRoot, "ORTAK", "CSS");
const assetsRoot = path.join(projectRoot, "ORTAK", "ASSETS");
const personelRoot = path.join(projectRoot, "PERSONEL");
const recipeRoot = path.join(personelRoot, "recete-embed");
const procurementUiRoot = path.join(projectRoot, "YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE");
const productMediaRoot = path.join(projectRoot, "ORTAK", "VERİ", "MEDIA", "products");

const staticOptions = { dotfiles: "deny", etag: true, index: false, maxAge: 0 };
const jsonParser = express.json({ limit: config.apiJsonLimitBytes, strict: true });

app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"], "base-uri": ["'self'"], "connect-src": ["'self'"],
      "font-src": ["'self'", "data:"], "form-action": ["'self'"], "frame-ancestors": ["'self'"],
      "img-src": ["'self'", "https:", "data:", "blob:"], "media-src": ["'self'", "https:", "data:", "blob:"],
      "object-src": ["'none'"], "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"]
    }
  },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(morgan(config.isProduction ? "combined" : "dev", { stream: { write: (line) => process.stdout.write(sanitizeLogLine(line)) } }));
app.use(cors({
  origin: corsOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type", "Authorization", "Idempotency-Key", "X-Request-ID", "X-Manager-Key",
    "X-File-Name", "X-Media-Kind", "X-Menu-Suite-App-Id", "X-Menu-Suite-App-Target",
    "X-Menu-Suite-Device-Id", "X-Expected-Revision", "X-Expected-Inventory-Revision",
    "X-Expected-Catalog-Revision", "X-Document-Type", "X-Supplier-Id",
    "X-Shipment-Ids", "X-Shipment-Item-Ids", "X-Document-Number", "X-Document-Date"
  ],
  credentials: true
}));
app.use((req, res, next) => {
  res.set("Permissions-Policy", permissionsPolicyForPath(req.path));
  if (req.path.startsWith("/api/")) res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
  next();
});
app.use((req, res, next) => {
  if (/^\/api\/admin\/data-imports\/analyze\/?$/.test(req.path)) return next();
  return jsonParser(req, res, next);
});
app.use(express.urlencoded({ extended: false, limit: config.apiUrlEncodedLimitBytes, parameterLimit: 200 }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false });
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, skip: () => config.nodeEnv === "test" });
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false, skip: () => config.nodeEnv === "test" });
const resetRequestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, skip: () => config.nodeEnv === "test" });
const resetConfirmLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, skip: () => config.nodeEnv === "test" });

registerAccountSecurityRoutes({
  app, store, auth, config, mailService, bcrypt, validatePassword,
  requireRequestOrigin, requestLimiter: resetRequestLimiter, confirmLimiter: resetConfirmLimiter
});

registerPublishRoutes({
  app, store, auth, requireAdminRequestOrigin: requireRequestOrigin,
  onPublished(nextStore, result) {
    if ((result.changedScopes || []).includes("menu")) broadcastMenuUpdate(nextStore, result.updatedAt);
  }
});

registerAdminDefaultRoutes({ app, store, auth, requireAdminRequestOrigin: requireRequestOrigin });
registerAdminProfileRoutes({ app, store, auth, config, requireRequestOrigin });

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "STOK-TAKIP-SISTEMI" }));

app.get("/api/public/bootstrap", async (req, res, next) => {
  try {
    const payload = { ok: true, ...buildPublicBootstrap(await store.read()) };
    const etag = entityTag("public-menu", payload);
    res.set({ "Cache-Control": "public, max-age=0, must-revalidate", ETag: etag });
    if (requestEntityTagMatches(req, etag)) return res.status(304).end();
    return res.json(payload);
  } catch (error) { return next(error); }
});

app.get("/api/public/preview-config", (req, res) => res.json({ ok: true, schemaVersion: 1, allowedOrigins: [requestOrigin(req)] }));
app.post("/api/public/preview-session", async (req, res, next) => {
  try {
    const info = auth.previewTokenInfo(String(req.body && req.body.previewToken || "").trim());
    if (!info.mode || !info.sessionId) return res.status(401).json({ ok: false, message: "Önizleme oturumu geçersiz veya süresi dolmuş." });
    const data = await store.read();
    const active = (data.authSessions || []).some((session) => session && session.id === info.sessionId && session.role === "admin" && !session.revokedAt);
    return active
      ? res.json({ ok: true, schemaVersion: 1, mode: info.mode, expiresAt: info.expiresAt })
      : res.status(401).json({ ok: false, message: "Önizleme oturumu sona ermiş." });
  } catch (error) { return next(error); }
});

app.post("/api/admin/login", requireRequestOrigin, loginLimiter, async (req, res, next) => {
  try {
    const password = String(req.body && req.body.password || "");
    const data = await store.read();
    const valid = password.length > 0 && password.length <= 72 && data.admin && data.admin.passwordHash
      ? await bcrypt.compare(password, data.admin.passwordHash) : false;
    if (!valid) return res.status(401).json({ ok: false, message: "Panel şifresi hatalı." });
    const session = await auth.createAdminSession();
    auth.attachAdminCookie(res, session.token);
    return res.json({ ok: true, token: session.token, tokenType: "Bearer", expiresIn: null, ...auth.sessionInfoFromPayload(session.payload) });
  } catch (error) { return next(error); }
});

app.post("/api/admin/logout", requireRequestOrigin, async (req, res, next) => {
  try {
    await auth.revokeRequestSession(req, ["admin"]);
    auth.clearAdminCookie(res);
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

app.post("/api/admin/session/refresh", requireRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const session = await auth.createAdminSession();
    await auth.revokeRequestSession(req, ["admin"]);
    auth.attachAdminCookie(res, session.token);
    return res.json({ ok: true, role: "admin", token: session.token, tokenType: "Bearer", expiresIn: null, ...auth.sessionInfoFromPayload(session.payload) });
  } catch (error) { return next(error); }
});

app.get("/api/admin/me", requireRequestOrigin, auth.requireAdmin, (req, res) => {
  if (req.authToken) auth.attachAdminCookie(res, req.authToken);
  res.json({ ok: true, role: "admin", ...auth.sessionInfoFromPayload(req.admin) });
});

app.post("/api/admin/preview-token", requireRequestOrigin, auth.requireAdmin, (req, res) => {
  try {
    const mode = String(req.body && req.body.mode || "menu").trim().toLowerCase();
    const token = auth.signPreviewToken(mode, req.admin && req.admin.sessionId);
    const info = auth.previewTokenInfo(token);
    return res.json({ ok: true, token, previewToken: token, mode: info.mode, expiresAt: info.expiresAt, allowedOrigins: [requestOrigin(req)], publicOrigin: requestOrigin(req) });
  } catch (_error) {
    return res.status(400).json({ ok: false, message: "Geçersiz önizleme modu." });
  }
});

app.get("/api/menu", async (req, res, next) => {
  try {
    const payload = buildMenuApiPayload(await store.read());
    const etag = entityTag("menu", payload);
    res.set({ "Cache-Control": "no-cache, must-revalidate", ETag: etag, "X-Menu-Revision": String(payload.streamRevision), "X-Publish-Revision": String(payload.publishRevision) });
    if (requestEntityTagMatches(req, etag)) return res.status(304).end();
    return res.json(payload);
  } catch (error) { return next(error); }
});

app.put("/api/menu", requireRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const menuState = req.body && req.body.menuState;
    const pricingInput = req.body && req.body.pricing || menuState && menuState.pricing;
    const incoming = pricingInput && menuState ? { ...menuState, pricing: pricingInput } : menuState;
    const validationError = validateMenuState(incoming) || validateMenuProductCodes(incoming);
    if (validationError) return res.status(400).json({ ok: false, message: validationError });
    const expectedProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "expectedRevision");
    const expectedRevision = Number(req.body && req.body.expectedRevision);
    if (expectedProvided && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) return res.status(400).json({ ok: false, message: "Geçerli expectedRevision gerekli." });
    const updatedAt = new Date().toISOString();
    const saved = await store.update((data) => {
      const current = Math.max(0, Number(data.revisions && data.revisions.publish || 0));
      if (expectedProvided && current !== expectedRevision) throw httpError(409, "Menü verisi başka bir işlem tarafından güncellendi.", "REVISION_CONFLICT", current);
      const before = menuPricingFingerprint(data.menuState, data.pricing);
      const migrated = migratePricingSystem(pricingInput || data.pricing, incoming);
      markManualMenuStatusChanges(data.menuState, migrated.menuState);
      data.menuState = migrated.menuState;
      data.pricing = migrated.pricing;
      data.revisions = data.revisions || {};
      if (before !== menuPricingFingerprint(data.menuState, data.pricing)) {
        data.revisions.pricing = Math.max(0, Number(data.revisions.pricing || 0)) + 1;
        data.pricingUpdatedAt = updatedAt;
      }
      data.revisions.publish = current + 1;
      data.menuUpdatedAt = updatedAt;
      return data;
    });
    broadcastMenuUpdate(saved, updatedAt);
    return res.json({ ok: true, menuState: serializeLegacyMenuState(saved.menuState, saved.pricing), pricing: saved.pricing, revision: saved.revisions.pricing, publishRevision: saved.revisions.publish, updatedAt });
  } catch (error) {
    if (error.status === 409) return res.status(409).json({ ok: false, code: error.code, message: error.message, currentRevision: error.currentRevision });
    return next(error);
  }
});

app.get("/api/menu/events", async (req, res, next) => {
  try { return openSse(req, res, menuSseClients, "menu", buildMenuInvalidation(await store.read(), "connected")); }
  catch (error) { return next(error); }
});

app.get("/api/feedback", requireRequestOrigin, auth.requireAdmin, async (_req, res, next) => {
  try { const data = await store.read(); return res.json({ ok: true, feedbackItems: data.feedbackItems || [], updatedAt: data.feedbackUpdatedAt || null }); }
  catch (error) { return next(error); }
});

app.post("/api/feedback", async (req, res, next) => {
  try {
    const item = normalizeFeedbackItem(req.body && req.body.feedback || req.body || {});
    if (!item) return res.status(400).json({ ok: false, message: "Geri bildirim için mesaj, favori içecek veya puan gerekli." });
    const updatedAt = new Date().toISOString();
    let notification = null;
    const saved = await store.update((data) => {
      data.feedbackItems = (data.feedbackItems || []).concat(item).slice(-1000);
      data.feedbackUpdatedAt = updatedAt;
      notification = notificationService.createNotificationInStore(data, feedbackNotificationInput(item, updatedAt));
      return data;
    });
    broadcastFeedbackUpdate(saved.feedbackItems, updatedAt);
    for (const item of notificationService.notificationsFromResult(notification)) notificationService.publishNotificationEvent(item);
    return res.status(201).json({ ok: true, feedback: item, updatedAt });
  } catch (error) { return next(error); }
});

app.put("/api/feedback", requireRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body && req.body.feedbackItems) ? req.body.feedbackItems.map(normalizeFeedbackItem).filter(Boolean).slice(-1000) : [];
    const updatedAt = new Date().toISOString();
    await store.update((data) => { data.feedbackItems = items; data.feedbackUpdatedAt = updatedAt; return data; });
    broadcastFeedbackUpdate(items, updatedAt);
    return res.json({ ok: true, feedbackItems: items, updatedAt });
  } catch (error) { return next(error); }
});

app.get("/api/feedback/events", requireRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try { const data = await store.read(); return openSse(req, res, feedbackSseClients, "feedback", { feedbackItems: data.feedbackItems || [], updatedAt: data.feedbackUpdatedAt || null }); }
  catch (error) { return next(error); }
});

app.post("/api/media", requireRequestOrigin, auth.requireAdmin, uploadLimiter, parseMediaUploadBody, async (req, res, next) => {
  try {
    const file = validateMediaUpload(req);
    await fs.mkdir(config.mediaDir, { recursive: true });
    await fs.writeFile(path.join(config.mediaDir, file.fileName), req.body);
    const mediaPath = `/media/${file.fileName}`;
    return res.status(201).json({ ok: true, media: { id: file.id, url: `${requestOrigin(req)}${mediaPath}`, src: mediaPath, name: file.originalName, kind: file.kind, type: file.contentType, size: req.body.length } });
  } catch (error) { return next(error); }
});

app.get("/api/media", requireRequestOrigin, auth.requireAdmin, async (_req, res, next) => {
  try {
    await fs.mkdir(config.mediaDir, { recursive: true });
    const names = await fs.readdir(config.mediaDir);
    const media = await Promise.all(names.filter(isSafeMediaFileName).map(async (name) => { const stats = await fs.stat(path.join(config.mediaDir, name)); return { name, src: `/media/${name}`, size: stats.size, updatedAt: stats.mtime.toISOString() }; }));
    return res.json({ ok: true, media: media.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
  } catch (error) { return next(error); }
});

app.delete("/api/media/:name", requireRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.params.name || "");
    if (!isSafeMediaFileName(name)) return res.status(400).json({ ok: false, message: "Geçersiz medya adı." });
    const data = await store.read();
    if (JSON.stringify(data.menuState || {}).includes(`/media/${name}`)) return res.status(409).json({ ok: false, message: "Bu medya yayındaki menü tarafından kullanılıyor." });
    if (JSON.stringify(data.workforceMaterialRequests || {}).includes(`/media/${name}`)
      || JSON.stringify(data.stockState || {}).includes(`/media/${name}`)) {
      return res.status(409).json({ ok: false, message: "Bu medya bir malzeme talebi, stok kartı veya yer kaydı tarafından kullanılıyor." });
    }
    await fs.unlink(path.join(config.mediaDir, name));
    return res.json({ ok: true });
  } catch (error) { if (error.code === "ENOENT") return res.status(404).json({ ok: false, message: "Medya bulunamadı." }); return next(error); }
});

personelRuntime = registerPersonelRoutes({
  app, store, auth, config, bcrypt, notificationService, notificationDeliveryWorker,
  requireRequestOrigin, recipeLoginLimiter: loginLimiter, uploadLimiter, broadcastMenuUpdate,
  normalizeStockState,
  broadcastStockUpdate: (...args) => stockRuntime && stockRuntime.broadcastStockUpdate(...args),
  queueStockThresholdNotifications: (...args) => stockRuntime && stockRuntime.queueStockThresholdNotifications(...args),
  notifyProcurementChange: (event) => procurementRuntime && procurementRuntime.service && procurementRuntime.service.publishExternalEvent(event)
});

stockRuntime = registerStockCoreRoutes({
  app, store, auth, notificationService, requireRequestOrigin,
  publishGatewayEvent: (event) => personelRuntime.publishAuthenticatedEvent(event)
});

registerStockLocationRoutes({
  app, store, auth,
  requireAdminRequestOrigin: requireRequestOrigin,
  requireAdminOrMainRequestOrigin: requireRequestOrigin,
  broadcastStockUpdate: stockRuntime.broadcastStockUpdate,
  resolveProcurementActor: (req) => resolveActorFromRequest(req, store),
  hasProcurementCapability,
  notificationService,
  queueStockThresholdNotifications: stockRuntime.queueStockThresholdNotifications
});

procurementRuntime = registerProcurementRoutes({
  app, store, auth, config, notificationService,
  notifyWorkforceChange: personelRuntime.workforceRuntime.invalidateWorkforce,
  broadcastStockUpdate: stockRuntime.broadcastStockUpdate,
  documentService: procurementDocumentService,
  approveWorkforceShipment: personelRuntime.workforceRuntime.approveWorkforceShipment,
  requireRequestOrigin,
  requireAdminOrMainRequestOrigin: requireRequestOrigin,
  riskOperationLimiter: sensitiveLimiter
});

if (procurementRuntime && procurementRuntime.service && typeof procurementRuntime.service.subscribe === "function") {
  procurementRuntime.service.subscribe((event) => personelRuntime.publishAuthenticatedEvent({
    topic: event && event.entityType === "shipment" ? "shipment" : "procurement",
    type: event && event.type || "procurement.updated",
    entityType: event && event.entityType || "procurement",
    entityId: event && event.entityId || "",
    revision: event && (event.shipmentRevision || event.revision) || 0,
    timestamp: event && event.createdAt,
    targets: ["yonetici"]
  }));
}

notificationRuntime = registerNotificationRoutes({
  app, store, auth, config, deliveryWorker: notificationDeliveryWorker, pushService,
  requireAdminRequestOrigin: requireRequestOrigin, requireAdminOrMainRequestOrigin: requireRequestOrigin, riskOperationLimiter: sensitiveLimiter
});

app.get("/api/admin/system-health", requireRequestOrigin, auth.requireAdmin, async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store").json({ ok: true, health: await buildAdminSystemHealth() });
  } catch (error) { next(error); }
});

registerPricingRoutes({
  app, store, auth, requireAdminRequestOrigin: requireRequestOrigin,
  riskOperationLimiter: sensitiveLimiter,
  broadcastMenuUpdate: (_menu, updatedAt) => void store.read().then((data) => broadcastMenuUpdate(data, updatedAt)),
  broadcastPublicUpdate: () => {}
});

const dataImportRuntime = registerDataImportRoutes({
  app, store, auth, requireAdminRequestOrigin: requireRequestOrigin,
  dataImportColdDir: config.dataImportColdDir,
  riskOperationLimiter: sensitiveLimiter,
  broadcastMenuUpdate: (_menu, updatedAt) => void store.read().then((data) => broadcastMenuUpdate(data, updatedAt)),
  broadcastPublicUpdate: () => {}
});

app.get("/media/:name", serveMediaFile);
app.use("/media/products", express.static(productMediaRoot, staticOptions));
app.head("/media/:name", serveMediaFile);

app.get(/^\/personel$/, (_req,res) => res.redirect(301,"/personel/"));
app.get("/personel/manifest.webmanifest", async (_req, res, next) => {
  try {
    res.set({ "Cache-Control": "no-cache, must-revalidate", "Content-Type": "application/manifest+json; charset=utf-8" });
    res.json(buildPwaManifest(await store.read(), "personel"));
  } catch (error) { next(error); }
});
app.get("/personel/sw.js", serviceWorkerFile(personelRoot,"sw.js","/personel/"));
app.get(["/personel/recete-embed/", "/personel/recete-embed/index.html"], auth.requirePersonelOrPreview, serveAppearanceHtml(recipeRoot, "index.html", true));
app.use("/personel/recete-embed", auth.requirePersonelOrPreview, express.static(recipeRoot,{...staticOptions,index:"index.html"}));
// Never allow the unguarded parent static mount to serve recipe files.
app.use("/personel/recete-embed", (_req,res) => res.status(404).end());
app.get(["/personel/", "/personel/index.html"], serveAppearanceHtml(personelRoot, "index.html"));
app.use("/personel", express.static(personelRoot,{...staticOptions,index:"index.html"}));

function serveAppearanceHtml(root, file, embedded = false) {
  return async (req, res, next) => {
    try {
      const theme = require("../../JS/panel-theme");
      const user = embedded ? req.recipeUser : await auth.verifyPersonelRequest(req);
      const appearance = theme.normalizeAppearance(user && user.appearance);
      const declarations = Object.entries(theme.tokensForPreset(appearance.presetId, appearance.mode)).map(([key, value]) => `${key}:${value}`).join(";");
      let html = await fs.readFile(path.join(root, file), "utf8");
      html = html.replace(/<html([^>]*)>/, `<html$1 data-admin-theme-preset="${appearance.presetId}" data-appearance-mode="${appearance.mode}">`)
        .replace("</head>", `<style id="accountAppearanceBootstrap">:root{${declarations};color-scheme:${appearance.mode}}</style></head>`);
      res.set({ "Cache-Control": "private, no-store", Vary: "Cookie" }).type("html").send(html);
    } catch (error) { next(error); }
  };
}

// Only public appearance/brand fields are projected; no account or panel data.
app.get("/api/public/panel-theme", async (_req, res, next) => {
  try {
    const data = await store.read();
    const panelTheme = require("../../JS/panel-theme");
    const preset = panelTheme.presetById(data.panelConfig && data.panelConfig.appearance && data.panelConfig.appearance.adminThemePresetId);
    const publicBrand = buildPublicBootstrap(data).menu.settings.brandInfo;
    res.set("Cache-Control", "no-store").json({ presetId: preset.id, brandInfo: publicBrand });
  } catch (error) { next(error); }
});

// Public URLs are lowercase; package directories keep their canonical names.
// Explicit mounts also work on case-sensitive Linux filesystems.
app.use("/assets/app-icons", express.static(path.join(assetsRoot, "APP-ICONS"), staticOptions));
app.use("/assets/brand", express.static(path.join(assetsRoot, "BRAND"), staticOptions));
app.use("/assets/fonts", express.static(path.join(assetsRoot, "FONTS"), staticOptions));
app.use("/assets/images", express.static(path.join(assetsRoot, "IMAGES"), staticOptions));
app.use("/assets", express.static(assetsRoot, staticOptions));
app.get("/shared/scripts/pwa-release.js", (_req, res) => {
  res.set({ "Cache-Control": "no-cache, must-revalidate", "Content-Type": "application/javascript; charset=utf-8" });
  const metadata = serializePwaReleaseMetadata({ id: config.pwaReleaseId, notes: config.pwaReleaseNotes });
  res.send(`self.MENU_SUITE_PWA_RELEASE=Object.freeze(${metadata});\n`);
});
app.get("/shared/scripts/zxing-browser.min.js", (_req, res, next) => {
  res.set({ "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": "application/javascript; charset=utf-8" });
  res.sendFile(zxingBrowserBundle, (error) => error ? next(error) : undefined);
});
app.use("/shared/scripts", express.static(sharedJsRoot, staticOptions));
app.use("/shared/styles", express.static(sharedCssRoot, staticOptions));

app.use("/yonetici/styles", express.static(adminCssRoot, staticOptions));
app.use("/yonetici/scripts", express.static(adminJsRoot, staticOptions));
app.use("/yonetici/assets", express.static(adminAssetsRoot, staticOptions));
app.get(
  ["/yonetici/modules/tedarik-muhasebe/", "/yonetici/modules/tedarik-muhasebe/index.html"],
  auth.requireAdminPage,
  sendFile(procurementUiRoot, "index.html")
);
app.use(
  "/yonetici/modules/tedarik-muhasebe",
  auth.requireAdminPage,
  express.static(procurementUiRoot, { ...staticOptions, index: false })
);
app.get("/yonetici/manifest.webmanifest", sendPwaManifest("admin"));
app.get("/yonetici/sw.js", serviceWorkerFile(adminPwaRoot, "sw.js", "/yonetici/"));
app.get("/yonetici/offline.html", sendFile(adminHtmlRoot, "offline.html"));
app.get(/^\/yonetici$/, (_req, res) => res.redirect(301, "/yonetici/"));
app.get("/yonetici/", sendFile(adminHtmlRoot, "index.html"));
app.get(["/password-reset", "/password-reset/"], sendFile(adminHtmlRoot, "password-reset.html"));

app.get(/^\/yonetim$/, (_req, res) => res.redirect(301, "/yonetici/"));
app.get(/^\/yonetim\/$/, (_req, res) => res.redirect(301, "/yonetici/"));
app.get("/", (_req, res) => res.redirect(302, "/yonetici/"));

app.use((req, res) => req.path.startsWith("/api/")
  ? res.status(404).json({ ok: false, message: "API yolu bulunamadı." })
  : res.status(404).type("text/plain").send("Sayfa bulunamadı."));

app.use((error, req, res, _next) => {
  const status = error && (error.type === "entity.too.large" || Number(error.status) === 413) ? 413 : Number(error && error.status || 500);
  if (status >= 500) logRuntimeError(error);
  const message = status === 413 ? "İstek gövdesi izin verilen boyut sınırını aşıyor." : error && error.status ? error.message : "Backend hatası oluştu.";
  res.status(status).json({ ok: false, message, ...(error && error.code ? { code: error.code } : {}) });
});

async function prepareRuntime() {
  try {
    await store.ensure(); // Take the DATA_FILE writer lock before any other startup side effect.
    await Promise.all([
      fs.mkdir(config.mediaDir, { recursive: true }),
      fs.mkdir(productMediaRoot, { recursive: true }),
      procurementDocumentService.init(),
      dataImportRuntime.ready()
    ]);
    await seedStoreIfEmpty(store, projectRoot);
    if (config.notificationWorkersEnabled) { notificationDeliveryWorker.start(); notificationScheduler.start(); }
  } catch (error) {
    await notificationScheduler.stop();
    await notificationDeliveryWorker.stop();
    await store.close();
    throw error;
  }
}

async function startServer() {
  await prepareRuntime();
  try {
    return await new Promise((resolve, reject) => {
      const server = app.listen(config.port, () => {
        server.removeListener("error", reject);
        console.log(`STOK-TAKIP-SISTEMI backend listening on port ${config.port}`);
        resolve(server);
      });
      server.once("error", reject);
    });
  } catch (error) {
    await shutdownRuntime(null);
    throw error;
  }
}

async function shutdownRuntime(server, options = {}) {
  await notificationScheduler.stop();
  if(personelRuntime) personelRuntime.close();
  if(notificationRuntime) notificationRuntime.close();
  if(stockRuntime) stockRuntime.close();
  await notificationDeliveryWorker.stop();
  await mailService.close();
  for (const clients of [menuSseClients, feedbackSseClients]) for (const client of clients) closeSseClient(client, clients);
  await new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    const timeout = setTimeout(() => { if (typeof server.closeAllConnections === "function") server.closeAllConnections(); resolve(); }, Math.max(1000, Number(options.timeoutMs || 10000)));
    server.close(() => { clearTimeout(timeout); resolve(); });
    if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
  });
  await store.drain();
  if (typeof store.close === "function") await store.close();
}

let gracefulShutdownInstalled = false;
function installGracefulShutdown(server) {
  if (gracefulShutdownInstalled) return;
  gracefulShutdownInstalled = true;
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; try { await shutdownRuntime(server); } catch (error) { process.exitCode = 1; logRuntimeError(error); } };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
}

function requireRequestOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = String(req.get("Origin") || "").trim();
  if (!origin || isAllowedOrigin(origin, req)) return next();
  return res.status(403).json({ ok: false, message: "İstek kaynağına izin verilmiyor." });
}

function corsOrigin(origin, callback) {
  if (!origin || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin) || (config.allowLocalhostOrigins && isLocalOrigin(origin))) return callback(null, true);
  return callback(new Error("Origin not allowed"));
}

function isAllowedOrigin(origin, req) {
  return origin === requestOrigin(req) || config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin) || (config.allowLocalhostOrigins && isLocalOrigin(origin));
}
function isLocalOrigin(origin) { try { const url = new URL(origin); return ["localhost", "127.0.0.1", "::1"].includes(url.hostname); } catch (_error) { return false; } }
function requestOrigin(req) { return `${req.protocol}://${req.get("host")}`; }

function buildMenuApiPayload(data) {
  const revisions = data && data.revisions || {};
  return {
    ok: true, menuState: serializeLegacyMenuState(data.menuState, data.pricing), pricing: data.pricing,
    menuFingerprint: publishedMenuFingerprint(data),
    revision: Math.max(0, Number(revisions.pricing || 0)), publishRevision: Math.max(0, Number(revisions.publish || 0)),
    catalogRevision: Math.max(0, Number(revisions.dataImportCatalog || 0)), dataImportRevision: Math.max(0, Number(revisions.dataImport || 0)),
    streamRevision: menuRevision(data), updatedAt: latestTimestamp(data.menuUpdatedAt, data.pricingUpdatedAt)
  };
}
function menuRevision(data) { const timestamp = Date.parse(latestTimestamp(data.menuUpdatedAt, data.pricingUpdatedAt) || ""); return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Math.max(0, Number(data && data.revisions && data.revisions.publish || 0), Number(data && data.revisions && data.revisions.pricing || 0)); }
function buildMenuInvalidation(data, action) { return { revision: menuRevision(data), scope: "menu", action: action || "invalidate", changedIds: [], requiresRefetch: true, updatedAt: latestTimestamp(data.menuUpdatedAt, data.pricingUpdatedAt) || new Date().toISOString() }; }
function broadcastMenuUpdate(data, updatedAt) {
  const payload = buildMenuInvalidation(data, "invalidate");
  if (updatedAt) payload.updatedAt = updatedAt;
  broadcastSse(menuSseClients, "menu", payload);
  if (personelRuntime) personelRuntime.publishAuthenticatedEvent({
    topic: "catalog", type: "catalog.updated", entityType: "catalog",
    revision: Math.max(0, Number(data.revisions && data.revisions.dataImportCatalog || 0)),
    timestamp: payload.updatedAt, targets: ["personel", "yonetici"]
  });
}
function broadcastFeedbackUpdate(items, updatedAt) { broadcastSse(feedbackSseClients, "feedback", { feedbackItems: items || [], updatedAt }); }

function openSse(req, res, clients, initialEvent, initialPayload) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write("retry: 5000\n\n");
  sendSse(res, initialEvent === "menu" ? "ready" : initialEvent, initialPayload);
  const client = { res, heartbeat: setInterval(() => { if (!res.writableEnded) res.write(": keepalive\n\n"); }, 25000) };
  if (typeof client.heartbeat.unref === "function") client.heartbeat.unref();
  clients.add(client);
  req.once("close", () => closeSseClient(client, clients));
}
function sendSse(res, event, payload) { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); }
function broadcastSse(clients, event, payload) { for (const client of clients) { if (!client.res || client.res.writableEnded) closeSseClient(client, clients); else sendSse(client.res, event, payload); } }
function closeSseClient(client, clients) { if (!client) return; if (client.heartbeat) clearInterval(client.heartbeat); clients.delete(client); try { if (client.res && !client.res.writableEnded) client.res.end(); } catch (_error) {} }

function menuPricingFingerprint(menuState, pricing) { return JSON.stringify({ pricing, rows: (menuState && menuState.categories || []).flatMap((category) => (category.products || []).map((product) => [String(product.id || ""), product.pricing || null, product.priceMode || "", product.prices || null, product.variants || null])) }); }
function markManualMenuStatusChanges(previousState, nextState) {
  const oldCategories = new Map((previousState && previousState.categories || []).map((item) => [String(item.id), item]));
  const oldProducts = new Map((previousState && previousState.categories || []).flatMap((category) => (category.products || []).map((item) => [String(item.id), item])));
  for (const category of nextState && nextState.categories || []) {
    const oldCategory = oldCategories.get(String(category.id));
    if (!oldCategory || oldCategory.active !== category.active) Object.assign(category, { sourceType: category.sourceType || "manual", sourcePresent: true, statusSource: "manual", manualActive: category.active !== false });
    for (const product of category.products || []) {
      const oldProduct = oldProducts.get(String(product.id));
      if (!oldProduct || oldProduct.active !== product.active) Object.assign(product, { sourceType: product.sourceType || "manual", sourcePresent: true, statusSource: "manual", manualActive: product.active !== false });
    }
  }
}

function normalizeFeedbackItem(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const type = normalizeFeedbackType(source.type);
  const text = String(source.text || "").trim().slice(0, 1200);
  const favorite = String(source.favorite || source.favoriteDrink || "").trim().slice(0, 120);
  const rating = Math.max(0, Math.min(5, Number(source.rating || 0) || 0));
  if (!text && !favorite && !rating) return null;
  return { ...source, id: String(source.id || `feedback-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`).trim(), createdAt: String(source.createdAt || new Date().toISOString()), type, text: text || (type === "favori" ? "Favori içecek bildirimi" : "Puanlama kaydı"), favorite, rating };
}
function normalizeFeedbackType(value) { const type = String(value || "").toLowerCase().trim(); if (["sikayet", "şikayet"].includes(type)) return "sikayet"; if (["oneri", "öneri"].includes(type)) return "oneri"; if (["favori", "favorite"].includes(type)) return "favori"; if (["puanlama", "rating"].includes(type)) return "puanlama"; return "istek"; }

function feedbackNotificationInput(item, createdAt) {
  const type = normalizeFeedbackType(item && item.type);
  const labels = { istek: "İstek", sikayet: "Şikayet", oneri: "Öneri", puanlama: "Puanlama", favori: "Favori" };
  const label = labels[type] || "Geri Bildirim";
  const text = String(item && item.text || "").trim();
  const favorite = String(item && item.favorite || "").trim();
  const rating = Math.max(0, Math.min(5, Number(item && item.rating || 0) || 0));
  const summary = type === "favori" && favorite
    ? `${favorite} favori içecek olarak bildirildi.`
    : type === "puanlama" && rating
      ? `Yeni ${rating}/5 puanlama alındı.`
      : text || (favorite ? `${favorite} hakkında yeni geri bildirim alındı.` : `Yeni bir müşteri ${label.toLocaleLowerCase("tr-TR")} kaydı alındı.`);
  const feedbackId = String(item && item.id || "").slice(0, 180);
  return {
    recipientRole: "manager",
    recipientId: "manager",
    category: "feedback",
    eventType: `feedback_${type}`,
    title: `Yeni ${label}`,
    body: summary.replace(/\s+/g, " ").slice(0, 180),
    severity: type === "sikayet" ? "warning" : "info",
    entityType: "feedback",
    entityId: feedbackId,
    deepLink: `/yonetici/?section=feedback&feedbackId=${encodeURIComponent(feedbackId)}`,
    dedupeKey: `feedback:${feedbackId}`,
    createdAt,
    metadata: { feedbackId, feedbackType: type, section: "feedback" }
  };
}

function parseMediaUploadBody(req, res, next) { return express.raw({ type: () => true, limit: String(req.header("X-Media-Kind") || "").toLowerCase() === "video" ? "120mb" : "15mb" })(req, res, next); }
function validateMediaUpload(req) {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw httpError(400, "Medya dosyası gerekli.");
  const kind = String(req.header("X-Media-Kind") || "").toLowerCase();
  if (!["image", "video"].includes(kind)) throw httpError(400, "Medya türü image veya video olmalı.");
  const contentType = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const originalName = decodeHeaderValue(req.header("X-File-Name")) || kind;
  const extension = mediaExtension(kind, contentType, originalName);
  if (!extension || !matchesMediaSignature(req.body, extension)) throw httpError(400, "Dosya içeriği veya formatı desteklenmiyor.");
  const id = `${kind}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  return { id, kind, originalName, contentType, fileName: `${id}${extension}` };
}
function mediaExtension(kind, contentType, originalName) { const byType = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm" }; const ext = byType[contentType] || ""; const named = path.extname(String(originalName || "")).toLowerCase().replace(".jpeg", ".jpg"); return ext && ext === named && ((kind === "image" && contentType.startsWith("image/")) || (kind === "video" && contentType.startsWith("video/"))) ? ext : ""; }
function matchesMediaSignature(buffer, ext) { if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false; if (ext === ".jpg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff; if (ext === ".png") return buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])); if (ext === ".gif") return ["GIF87a","GIF89a"].includes(buffer.subarray(0,6).toString("ascii")); if (ext === ".webp") return buffer.subarray(0,4).toString("ascii") === "RIFF" && buffer.subarray(8,12).toString("ascii") === "WEBP"; if (ext === ".mp4") return buffer.subarray(4,8).toString("ascii") === "ftyp"; if (ext === ".webm") return buffer.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])); return false; }
function isSafeMediaFileName(value) { const name = String(value || ""); return /^[a-z0-9][a-z0-9._-]{2,180}$/i.test(name) && path.basename(name) === name && [".jpg",".jpeg",".png",".webp",".gif",".mp4",".webm"].includes(path.extname(name).toLowerCase()); }
function serveMediaFile(req, res, next) { const name = String(req.params.name || ""); if (!isSafeMediaFileName(name)) return res.status(404).end(); return res.sendFile(path.join(config.mediaDir, name), (error) => { if (!error) return; if (error.code === "ENOENT") return res.status(404).end(); return next(error); }); }
function decodeHeaderValue(value) { try { return decodeURIComponent(String(value || "").trim()); } catch (_error) { return String(value || "").trim(); } }

function sendFile(root, name) { return (_req, res, next) => res.sendFile(path.join(root, name), (error) => error ? next(error) : undefined); }
function sendPwaManifest(kind) { return async (_req, res, next) => { try { res.set({ "Cache-Control": "no-cache, must-revalidate", "Content-Type": "application/manifest+json; charset=utf-8" }); return res.json(buildPwaManifest(await store.read(), kind)); } catch (error) { return next(error); } }; }
function serviceWorkerFile(root, name, scope) { return (_req, res, next) => { res.set({ "Cache-Control": "no-cache", "Service-Worker-Allowed": scope, "Content-Type": "application/javascript; charset=utf-8" }); res.sendFile(path.join(root, name), (error) => error ? next(error) : undefined); }; }
function entityTag(scope, payload) { return `"${scope}-${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("base64url").slice(0, 27)}"`; }
function requestEntityTagMatches(req, etag) { return String(req.headers["if-none-match"] || "").split(",").some((item) => item.trim().replace(/^W\//, "") === etag); }
function latestTimestamp(...values) { return values.filter(Boolean).sort((a,b) => Date.parse(a) - Date.parse(b)).at(-1) || null; }
function httpError(status, message, code, currentRevision) { const error = new Error(message); error.status = status; if (code) error.code = code; if (currentRevision !== undefined) error.currentRevision = currentRevision; return error; }
function sanitizeLogLine(value) {
  return String(value || "")
    .replace(/([?&](?:previewToken|token|access_token|session|password|code|secret)=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s",;]+/gi, "$1[REDACTED]")
    .replace(/((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/[\r\n]+/g, " ").trimEnd() + "\n";
}
async function buildAdminSystemHealth() {
  const [data, delivery, storeProbe, mediaProbe, procurementProbe, coldStoreProbe, backupProbe, logProbe] = await Promise.all([
    store.read(), notificationDeliveryWorker.health(), probeWritableDirectory(path.dirname(config.dataFile)),
    probeWritableDirectory(config.mediaDir), probeWritableDirectory(config.procurementDocumentsDir),
    probeWritableDirectory(config.dataImportColdDir), probeWritableDirectory(config.backupDir), probeWritableDirectory(config.logDir)
  ]);
  const [storeStat, mediaSummary, backupSummary, disk] = await Promise.all([
    safeFileStat(config.dataFile), summarizeDirectory(config.mediaDir), summarizeBackups(config.backupDir), diskSummary(path.dirname(config.dataFile))
  ]);
  const personelSse = personelRuntime && typeof personelRuntime.getSseClientCounts === "function"
    ? personelRuntime.getSseClientCounts() : { recipe: 0, authenticatedEvents: 0 };
  const sse = {
    menu: menuSseClients.size,
    feedback: feedbackSseClients.size,
    notifications: notificationRuntime && typeof notificationRuntime.getSseClientCount === "function" ? notificationRuntime.getSseClientCount() : 0,
    stock: stockRuntime && typeof stockRuntime.getClientCount === "function" ? stockRuntime.getClientCount() : 0,
    recipe: Number(personelSse.recipe || 0),
    authenticatedEvents: Number(personelSse.authenticatedEvents || 0)
  };
  sse.total = Object.values(sse).reduce((sum, value) => sum + Number(value || 0), 0);
  const stock = normalizeStockState(data.stockState);
  const procurement = data.procurement && typeof data.procurement === "object" ? data.procurement : {};
  const stockProducts = new Map((stock.products || []).map((product) => [String(product.id), product]));
  const criticalBalanceCount = (stock.balances || []).filter((balance) => {
    const product = stockProducts.get(String(balance.productId)) || {};
    const threshold = Number(balance.criticalThreshold ?? product.criticalThreshold ?? product.minimumStock ?? 0);
    return threshold > 0 && Number(balance.quantity || 0) <= threshold;
  }).length;
  return {
    checkedAt: new Date().toISOString(),
    service: "STOK-TAKIP-SISTEMI",
    store: { writable: storeProbe.ok, sizeBytes: storeStat.size, revision: Number(data.storeRevision || 0), schemaVersion: Number(data.schemaVersion || 0), metrics: store.getMetrics() },
    media: { writable: mediaProbe.ok, fileCount: mediaSummary.fileCount, sizeBytes: mediaSummary.sizeBytes },
    procurementDocuments: {
      writable: procurementProbe.ok,
      documentCount: Array.isArray(procurement.documents) ? procurement.documents.length : 0,
      archivedDocumentCount: Array.isArray(procurement.documents) ? procurement.documents.filter((document) => document.archivedAt || document.status === "archived").length : 0
    },
    procurement: {
      revision: Math.max(0, Number(procurement.revision || 0)),
      supplierCount: Array.isArray(procurement.suppliers) ? procurement.suppliers.length : 0,
      productLinkCount: Array.isArray(procurement.supplierProductLinks) ? procurement.supplierProductLinks.length : 0,
      shipmentCount: Array.isArray(data.workforceShipments) ? data.workforceShipments.length : 0,
      ledgerEntryCount: Array.isArray(procurement.ledgerEntries) ? procurement.ledgerEntries.length : 0,
      paymentCount: Array.isArray(procurement.payments) ? procurement.payments.length : 0
    },
    stock: {
      inventoryRevision: Math.max(0, Number(data.revisions && data.revisions.inventory || 0)),
      catalogRevision: Math.max(0, Number(data.revisions && data.revisions.catalog || 0)),
      locationCount: Array.isArray(stock.locations) ? stock.locations.length : 0,
      productCount: Array.isArray(stock.products) ? stock.products.length : 0,
      balanceCount: Array.isArray(stock.balances) ? stock.balances.length : 0,
      movementCount: Array.isArray(stock.movements) ? stock.movements.length : 0,
      criticalBalanceCount
    },
    writableStorage: {
      store: storeProbe,
      publicMedia: mediaProbe,
      privateDocuments: procurementProbe,
      coldStore: coldStoreProbe,
      backups: backupProbe,
      logs: logProbe
    },
    backup: backupSummary,
    sse,
    scheduler: { ...notificationScheduler.health(), lastRunAt: data.notificationSchedulerState && data.notificationSchedulerState.lastRunAt || null },
    outbox: delivery,
    disk,
    pwaReleaseId: config.pwaReleaseId,
    deployment: {
      persistentDataConfigured: Boolean(process.env.DATA_FILE && process.env.MEDIA_DIR && process.env.PROCUREMENT_DOCUMENTS_DIR),
      cookieSecure: config.cookieSecure,
      trustProxyConfigured: config.trustProxy !== false,
      allowedOriginCount: config.allowedOrigins.length,
      uploadJsonLimitBytes: config.apiJsonLimitBytes,
      notificationWorkersEnabled: config.notificationWorkersEnabled,
      smtpConfigured: Boolean(config.smtpUser && config.smtpPass),
      vapidConfigured: Boolean(config.vapidPublicKey && config.vapidPrivateKey),
      timezone: "Europe/Istanbul"
    },
    lastImportantError: lastImportantSystemError
  };
}

async function probeWritableDirectory(directory) {
  const name = `.paket3-health-${process.pid}-${crypto.randomUUID()}.tmp`;
  const target = path.join(directory, name);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(target, "health", { encoding: "utf8", flag: "wx" });
    await fs.unlink(target);
    return { ok: true };
  } catch (error) {
    await fs.unlink(target).catch(() => {});
    return { ok: false, code: String(error && error.code || "WRITE_FAILED").slice(0, 40) };
  }
}

async function safeFileStat(file) {
  try { const stat = await fs.stat(file); return { size: Number(stat.size || 0), updatedAt: stat.mtime.toISOString() }; }
  catch (_error) { return { size: 0, updatedAt: null }; }
}

async function summarizeDirectory(directory) {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile());
    const stats = await Promise.all(files.map((entry) => fs.stat(path.join(directory, entry.name)).catch(() => null)));
    return { fileCount: files.length, sizeBytes: stats.reduce((sum, stat) => sum + Number(stat && stat.size || 0), 0) };
  } catch (_error) { return { fileCount: 0, sizeBytes: 0 }; }
}

async function summarizeBackups(directory) {
  try {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    const stats = (await Promise.all(entries.map(async (entry) => ({ name: entry.name, stat: await fs.stat(path.join(directory, entry.name)) }))));
    stats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    return { count: stats.length, lastBackupAt: stats[0] ? stats[0].stat.mtime.toISOString() : null };
  } catch (_error) { return { count: 0, lastBackupAt: null }; }
}

async function diskSummary(directory) {
  if (typeof fs.statfs !== "function") return { available: false, freeBytes: null, totalBytes: null };
  try {
    const value = await fs.statfs(directory);
    return { available: true, freeBytes: Number(value.bavail) * Number(value.bsize), totalBytes: Number(value.blocks) * Number(value.bsize) };
  } catch (_error) { return { available: false, freeBytes: null, totalBytes: null }; }
}

function logRuntimeError(error, context = "STOK-TAKIP-SISTEMI runtime error") {
  const actualError = typeof error === "string" && context && typeof context === "object" ? context : error;
  const actualContext = typeof error === "string" ? error : context;
  const safe = {
    name: String(actualError && actualError.name || "Error").slice(0, 80),
    code: String(actualError && actualError.code || "").slice(0, 80),
    status: Number(actualError && actualError.status || 500),
    message: String(actualError && actualError.message || "Beklenmeyen hata").slice(0, 500),
    context: String(actualContext || "STOK-TAKIP-SISTEMI runtime error").slice(0, 160),
    occurredAt: new Date().toISOString()
  };
  lastImportantSystemError = safe;
  console.error(actualContext, config.isProduction ? safe : actualError);
}

module.exports = { app, installGracefulShutdown, notificationService, prepareRuntime, sanitizeLogLine, shutdownRuntime, startServer, store };
