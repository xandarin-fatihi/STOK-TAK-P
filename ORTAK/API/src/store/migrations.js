"use strict";

const { migratePricingSystem } = require("../pricing");
const { normalizeAdminDefaults } = require("../admin-defaults");
const categoryIcons = require("../../../JS/category-icons");
const menuDesignSchema = require("../../../JS/menu-design-schema");
const { sanitizeLegacyBrandAssets } = menuDesignSchema;
const { POLICY_VERSION, normalizeNotificationRules } = require("../notification-policy");
const {
  normalizeNameHistory,
  normalizeProductCode,
  normalizeProductCodeList,
  normalizeProductCodeRegistry
} = require("./product-code-registry");
const { reconcileShipmentNumbers } = require("../shipment-number");

const { extendPersonelStore, normalizeProcurement, normalizeStockState, normalizeRecipeState, normalizeRecipeItem, reconcileRecipeCatalog, chooseRecipeSize } = require("./personel-migrations");
const STORE_SCHEMA_VERSION = 29;

function migrateStore(input) {
  const source = record(input);
  const invalidateLegacyImportDrafts = nonNegativeInteger(source.schemaVersion) < 18;
  const normalizedMenuState = normalizeMenuState(source.menuState);
  const pricingMigration = migratePricingSystem(source.pricing || normalizedMenuState.pricing, normalizedMenuState);
  const next = {
    schemaVersion: STORE_SCHEMA_VERSION,
    storeRevision: nonNegativeInteger(source.storeRevision),
    menuState: normalizeMenuState(pricingMigration.menuState),
    menuUpdatedAt: storedDateOrNull(source.menuUpdatedAt),
    pricing: pricingMigration.pricing,
    pricingUpdatedAt: storedDateOrNull(source.pricingUpdatedAt),
    publishUpdatedAt: storedDateOrNull(source.publishUpdatedAt),
    panelConfig: record(source.panelConfig),
    panelConfigUpdatedAt: storedDateOrNull(source.panelConfigUpdatedAt),
    revisions: normalizeRevisions(source.revisions, source.pricingRevision),
    idempotencyRequests: normalizeIdempotencyRequests(source.idempotencyRequests),
    auditLog: array(source.auditLog).slice(-1000),
    pricingAudit: array(source.pricingAudit).slice(-200),
    pricingImportDrafts: array(source.pricingImportDrafts).slice(-20),
    dataImportMappings: normalizeDataImportMappings(source.dataImportMappings),
    dataImportDrafts: invalidateLegacyImportDrafts ? [] : array(source.dataImportDrafts).slice(-20),
    dataImportHistory: array(source.dataImportHistory).slice(-100),
    dataImportBackups: array(source.dataImportBackups).slice(-10),
    dataImportIdempotency: invalidateLegacyImportDrafts ? [] : array(source.dataImportIdempotency).slice(-500),
    catalogMigrations: array(source.catalogMigrations).slice(-20),
    feedbackItems: array(source.feedbackItems),
    feedbackUpdatedAt: storedDateOrNull(source.feedbackUpdatedAt),
    authSessions: normalizeAuthSessions(source.authSessions),
    passwordResetChallenges: normalizeChallenges(source.passwordResetChallenges, "password_reset"),
    emailVerificationChallenges: normalizeChallenges(source.emailVerificationChallenges, "email_verification"),
    securityAudit: normalizeSecurityAudit(source.securityAudit),
    notifications: normalizeNotifications(source.notifications),
    scheduledNotifications: normalizeScheduledNotifications(source.scheduledNotifications),
    notificationPreferences: normalizeNotificationPreferences(source.notificationPreferences),
    notificationOutbox: normalizeNotificationOutbox(source.notificationOutbox),
    pushSubscriptions: normalizePushSubscriptions(source.pushSubscriptions),
    notificationSchedulerState: normalizeNotificationRuntimeState(source.notificationSchedulerState || source.schedulerState),
    adminDefaults: normalizeAdminDefaults(sanitizeLegacyBrandAssets(source.adminDefaults)),
    admin: normalizeAdmin(source.admin)
  };
  extendPersonelStore(next, source);
  const shipmentNumberMigration = reconcileShipmentNumbers(next.workforceShipments, source.shipmentNumberSequences);
  next.workforceShipments = shipmentNumberMigration.shipments;
  next.shipmentNumberSequences = shipmentNumberMigration.sequences;
  next.dataImportMappings = pruneStaleDataImportMappings(next.dataImportMappings, next.menuState, next.pricing);
  next.productCodeRegistry = normalizeProductCodeRegistry(source.productCodeRegistry, next);
  return next;
}

function normalizeMenuState(value) {
  const source = menuDesignSchema.normalizeMenuState(sanitizeLegacyBrandAssets(record(value)));
  const settings = record(source.settings);
  const categories = array(source.categories).map((category, categoryIndex) => {
    if (!category || typeof category !== "object" || Array.isArray(category)) return null;
    const name = String(category.name || "").trim();
    const iconKey = normalizeCategoryIconKey(category.iconKey || category.icon, name);
    return {
      ...category,
      id: String(category.id || `category-${categoryIndex}`),
      name,
      active: category.active !== false,
      order: finiteNumber(category.order, categoryIndex),
      iconKey,
      icon: categoryIcons.getIconClass(iconKey),
      products: array(category.products).map((product, productIndex) => normalizeMenuProduct(product, productIndex)).filter(Boolean)
    };
  }).filter(Boolean);
  return { ...source, settings, categories };
}

function normalizeScheduledNotifications(value) {
  return array(value).slice(-1000).map((item) => {
    const source = record(item);
    const status = ["pending", "executed"].includes(source.status) ? source.status : source.executedAt ? "executed" : "pending";
    return {
      id: String(source.id || "").trim().slice(0, 180),
      kind: source.kind === "stock_critical_snapshot" ? source.kind : "stock_critical_snapshot",
      title: String(source.title || "Kritik stok kontrolü").trim().slice(0, 120) || "Kritik stok kontrolü",
      note: String(source.note || "").trim().slice(0, 500),
      scheduledAt: storedDateOrNull(source.scheduledAt),
      status,
      notificationId: String(source.notificationId || "").trim().slice(0, 180),
      executedAt: status === "executed" ? storedDateOrNull(source.executedAt) : null,
      createdAt: storedDateOrNull(source.createdAt),
      updatedAt: storedDateOrNull(source.updatedAt)
    };
  }).filter((item) => item.id && item.scheduledAt && item.createdAt);
}

function normalizeIdempotencyRequests(value) {
  return array(value).slice(-500).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const response = item.response && typeof item.response === "object" && !Array.isArray(item.response)
      ? { ...item.response } : item.response;
    if (response && response.menuDesign && typeof response.menuDesign === "object") {
      response.menuDesign = menuDesignSchema.normalizeDesignSnapshot(response.menuDesign);
    }
    return response === item.response ? item : { ...item, response };
  });
}

function normalizeCategoryIconKey(value, categoryName) {
  const key = String(value || "").trim();
  return key && categoryIcons.ICONS[key] ? key : categoryIcons.inferIconKey(categoryName);
}

function normalizeMenuProduct(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const product = {
    ...value,
    id: String(value.id || `product-${index}`),
    name: String(value.name || "").trim(),
    active: value.active !== false,
    order: finiteNumber(value.order, index),
    productCode: normalizeProductCode(value.productCode),
    productCodeAliases: normalizeProductCodeList(value.productCodeAliases),
    nameHistory: normalizeNameHistory(value.nameHistory),
    contentMode: ["manual", "hidden", "not-required"].includes(value.contentMode) ? value.contentMode : "manual",
    manualContent: String(value.manualContent ?? value.ingredients ?? "")
  };
  for (const legacyKey of ["rec" + "ipeId", "rec" + "ipeSize", "rec" + "ipeLinkStatus"]) delete product[legacyKey];
  return product;
}

function normalizeRevisions(value, legacyPricingRevision) {
  const source = record(value);
  return {
    publish: nonNegativeInteger(source.publish),
    pricing: nonNegativeInteger(source.pricing ?? legacyPricingRevision),
    dataImport: nonNegativeInteger(source.dataImport),
    dataImportCatalog: nonNegativeInteger(source.dataImportCatalog),
    catalogMigration: nonNegativeInteger(source.catalogMigration)
  };
}

function normalizeDataImportMappings(value) {
  const source = record(value);
  return Object.fromEntries(["menu", "pricing"].map((workbook) => [workbook, array(source[workbook]).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const entityId = String(item.entityId || "").trim();
    const sheetNormalizedName = String(item.sheetNormalizedName || "").trim();
    const sourceNormalizedName = String(item.sourceNormalizedName || "").trim();
    if (!entityId || !sheetNormalizedName || !sourceNormalizedName) return null;
    return {
      ...item,
      kind: String(item.kind || ""), entityId, sheetNormalizedName, sourceNormalizedName,
      sourceSheet: String(item.sourceSheet || ""),
      productCode: normalizeProductCode(item.productCode),
      productCodeAliases: normalizeProductCodeList(item.productCodeAliases),
      nameHistory: normalizeNameHistory(item.nameHistory),
      importKey: String(item.importKey || ""), externalId: String(item.externalId || ""),
      aliasIds: array(item.aliasIds).map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 100),
      lastImportedAt: storedDateOrNull(item.lastImportedAt),
      lastImportOperationId: String(item.lastImportOperationId || "")
    };
  }).filter(Boolean).slice(-10000)]));
}

function pruneStaleDataImportMappings(value, menuState, pricing) {
  const categoryIds = new Set();
  const productIds = new Set();
  const pricingIds = new Set();
  for (const category of array(menuState && menuState.categories)) {
    collectMappingEntityIds(categoryIds, category);
    for (const product of array(category && category.products)) collectMappingEntityIds(productIds, product);
  }
  for (const type of array(pricing && pricing.types)) {
    collectMappingEntityIds(pricingIds, type);
    for (const option of array(type && type.options)) collectMappingEntityIds(pricingIds, option);
  }
  const allIds = new Set([...categoryIds, ...productIds, ...pricingIds]);
  const source = record(value);
  return {
    menu: array(source.menu).filter((mapping) => {
      const id = String(mapping && mapping.entityId || "");
      if (!id) return false;
      if (mapping.kind === "category") return categoryIds.has(id);
      if (mapping.kind === "product") return productIds.has(id);
      return allIds.has(id);
    }),
    pricing: array(source.pricing).filter((mapping) => {
      const id = String(mapping && mapping.entityId || "");
      return Boolean(id) && (productIds.has(id) || pricingIds.has(id));
    })
  };
}

function collectMappingEntityIds(target, entity) {
  const id = String(entity && entity.id || "");
  if (id) target.add(id);
  for (const aliasId of array(entity && entity.aliasIds)) {
    const alias = String(aliasId || "");
    if (alias) target.add(alias);
  }
}

function normalizeAuthSessions(value) {
  return array(value).map((item) => {
    if (!item || typeof item !== "object" || item.role !== "admin") return null;
    const id = String(item.id || "").trim().slice(0, 180);
    const tokenHash = String(item.tokenHash || "").trim().slice(0, 128);
    if (!id || !tokenHash) return null;
    return {
      ...item, id, tokenHash, role: "admin", userId: "admin", username: "", name: "",
      createdAt: storedDate(item.createdAt), lastSeenAt: storedDate(item.lastSeenAt || item.createdAt),
      expiresAt: storedDate(item.expiresAt), revokedAt: storedDateOrNull(item.revokedAt)
    };
  }).filter(Boolean).slice(-2000);
}

function normalizeChallenges(value, purpose) {
  return array(value).map((item) => {
    if (!item || typeof item !== "object" || item.scope !== "admin") return null;
    const id = String(item.id || "").trim().slice(0, 180);
    const codeHash = String(item.codeHash || "").trim().slice(0, 128);
    if (!id || !codeHash) return null;
    return {
      ...item, id, purpose, scope: "admin", targetUserId: "admin", codeHash,
      attempts: nonNegativeInteger(item.attempts), accountVersion: nonNegativeInteger(item.accountVersion),
      createdAt: storedDate(item.createdAt), expiresAt: storedDate(item.expiresAt),
      usedAt: storedDateOrNull(item.usedAt), revokedAt: storedDateOrNull(item.revokedAt)
    };
  }).filter(Boolean).slice(-500);
}

function normalizeSecurityAudit(value) {
  return array(value).map((item) => {
    if (!item || typeof item !== "object" || item.scope && item.scope !== "admin") return null;
    const id = String(item.id || "").trim().slice(0, 180);
    const action = String(item.action || "").trim().slice(0, 100);
    if (!id || !action) return null;
    return { ...item, id, action, scope: "admin", accountId: "admin", createdAt: storedDate(item.createdAt) };
  }).filter(Boolean).slice(-2000);
}

function normalizeNotifications(value) {
  return array(value).map((item) => {
    if (!item || typeof item !== "object" || normalizeNotificationRole(item.recipientRole) !== "manager") return null;
    const id = String(item.id || "").trim().slice(0, 180);
    if (!id) return null;
    return {
      ...item, id, recipientRole: "manager", recipientId: "manager",
      category: normalizeNotificationCategory(item.category), eventType: String(item.eventType || "notification").slice(0, 120),
      title: String(item.title || "Bildirim").slice(0, 180), body: String(item.body || "").slice(0, 1200),
      severity: ["info", "success", "warning", "critical"].includes(item.severity) ? item.severity : "info",
      deepLink: normalizeDeepLink(item.deepLink),
      createdAt: storedDate(item.createdAt), updatedAt: storedDate(item.updatedAt || item.createdAt),
      readAt: storedDateOrNull(item.readAt), archivedAt: storedDateOrNull(item.archivedAt), deletedAt: storedDateOrNull(item.deletedAt)
    };
  }).filter(Boolean).slice(-10000);
}

function normalizeNotificationPreferences(value) {
  const items = Array.isArray(value) ? value : Object.values(record(value));
  const latest = items.filter((item) => item && typeof item === "object" && normalizeNotificationRole(item.ownerRole || item.recipientRole) === "manager").pop();
  if (!latest) return [];
  return [{
    ownerRole: "manager", ownerId: "manager",
    inAppEnabled: latest.inAppEnabled !== false,
    emailEnabled: latest.emailEnabled === true,
    pushEnabled: latest.pushEnabled === true,
    emailAddress: String(latest.emailAddress || "").trim().toLowerCase().slice(0, 254),
    systemNotifications: latest.systemNotifications !== false,
    reminderNotifications: latest.reminderNotifications !== false,
    quietHoursEnabled: latest.quietHoursEnabled === true,
    quietHoursStart: normalizeClock(latest.quietHoursStart, "22:00"),
    quietHoursEnd: normalizeClock(latest.quietHoursEnd, "08:00"),
    timezone: String(latest.timezone || "Europe/Istanbul").slice(0, 80),
    policyVersion: POLICY_VERSION,
    rules: normalizeNotificationRules(latest.rules),
    updatedAt: storedDateOrNull(latest.updatedAt)
  }];
}

function normalizeNotificationOutbox(value) {
  return array(value).filter((item) => item && typeof item === "object" && normalizeNotificationRole(item.recipientRole) === "manager")
    .map((item) => ({ ...item, recipientRole: "manager", recipientId: "manager" })).slice(-5000);
}

function normalizePushSubscriptions(value) {
  return array(value).filter((item) => item && typeof item === "object" && normalizeNotificationRole(item.ownerRole || item.recipientRole) === "manager")
    .map((item) => ({ ...item, ownerRole: "manager", ownerId: "manager", recipientRole: "manager", recipientId: "manager" })).slice(-2000);
}

function normalizeNotificationRuntimeState(value) {
  const source = record(value);
  return {
    lastRunAt: storedDateOrNull(source.lastRunAt), leaseOwner: String(source.leaseOwner || ""),
    leaseExpiresAt: storedDateOrNull(source.leaseExpiresAt), updatedAt: storedDateOrNull(source.updatedAt),
    lastTickAt: storedDateOrNull(source.lastTickAt), lastOutboxRunAt: storedDateOrNull(source.lastOutboxRunAt),
    lastOutboxSuccessAt: storedDateOrNull(source.lastOutboxSuccessAt)
  };
}

function normalizeAdmin(value) {
  const source = record(value);
  return {
    ...source,
    passwordHash: String(source.passwordHash || ""),
    updatedAt: storedDate(source.updatedAt),
    email: String(source.email || "").trim().toLowerCase().slice(0, 254),
    emailNormalized: String(source.emailNormalized || source.email || "").trim().toLowerCase().slice(0, 254),
    emailVerifiedAt: storedDateOrNull(source.emailVerifiedAt),
    pendingEmail: String(source.pendingEmail || "").trim().toLowerCase().slice(0, 254),
    pendingEmailNormalized: String(source.pendingEmailNormalized || source.pendingEmail || "").trim().toLowerCase().slice(0, 254),
    pendingEmailRequestedAt: storedDateOrNull(source.pendingEmailRequestedAt),
    securityRevision: nonNegativeInteger(source.securityRevision)
  };
}

function normalizeNotificationRole(value) {
  const role = String(value || "").trim().toLowerCase();
  return ["manager", "admin", "yonetici", "yönetici"].includes(role) ? "manager" : "";
}
function normalizeNotificationCategory(value) {
  const category = String(value || "system").trim().toLocaleLowerCase("tr-TR");
  return ["feedback", "geri bildirim", "dilek şikayet", "dilek ve şikayet"].includes(category) ? "feedback" : "system";
}
function normalizeDeepLink(value) {
  const text = String(value || "/yonetici/").trim().slice(0, 500);
  return text.startsWith("/yonetici") && !text.startsWith("//") && !/[\r\n]/.test(text) ? text : "/yonetici/";
}
function normalizeClock(value, fallback) { const text = String(value || ""); return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback; }
function record(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function finiteNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function nonNegativeInteger(value) { return Math.max(0, Math.trunc(finiteNumber(value, 0))); }
function storedDate(value) { const date = new Date(value || 0); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString(); }
function storedDateOrNull(value) { return value ? storedDate(value) : null; }

module.exports = { STORE_SCHEMA_VERSION, migrateStore, normalizeMenuState, normalizeProcurement, normalizeStockState, normalizeRecipeState, normalizeRecipeItem, reconcileRecipeCatalog, chooseRecipeSize };
