"use strict";

const APP_ROOTS = Object.freeze({
  yonetici: "/yonetici/",
  personel: "/personel/"
});

const LEGACY_ACCOUNTING_SECTIONS = Object.freeze({
  suppliers: "procurementSuppliers",
  supplierProducts: "procurementProducts",
  documents: "procurementDocuments",
  invoices: "procurementInvoices",
  deliveryNotes: "procurementDeliveryNotes",
  shipments: "receipts",
  shipmentArchive: "shipments",
  ledger: "procurementLedger",
  payments: "procurementPayments",
  reversals: "procurementReversals",
  documentImages: "procurementDocumentImages",
  authorization: "permissions",
  history: "audit",
  stock: "locations"
});

function migrateLegacyAccountingLink(value) {
  const link = String(value || "").trim().slice(0, 500);
  if (!link.startsWith("/") || link.startsWith("//")) return "";
  try {
    const url = new URL(link, "https://menu-suite.invalid/");
    if (!/^\/(?:muhasebe|fatura)(?:\/|$)/i.test(url.pathname)) return "";
    const view = String(url.searchParams.get("view") || url.searchParams.get("section") || "documents");
    const section = LEGACY_ACCOUNTING_SECTIONS[view] || "procurementDocuments";
    const target = new URL("/yonetici/", "https://menu-suite.invalid/");
    target.searchParams.set("section", section);
    target.searchParams.set("procurementView", view);
    for (const key of ["entityType", "entityId", "shipmentId", "supplierId", "productId", "stockProductId", "locationId", "transferId", "workforce"]) {
      const entry = url.searchParams.get(key);
      if (entry) target.searchParams.set(key, entry.slice(0, 180));
    }
    return `${target.pathname}${target.search}`;
  } catch (_error) {
    return "";
  }
}

function normalizeAppTarget(value, deepLink = "", recipientRole = "personnel") {
  const rawValue = String(value || "").trim();
  if (Object.prototype.hasOwnProperty.call(APP_ROOTS, rawValue)) return rawValue;
  const requested = rawValue.toLocaleLowerCase("tr-TR");
  if (requested === "fatura" || requested === "muhasebe") return "yonetici";
  if (Object.prototype.hasOwnProperty.call(APP_ROOTS, requested)) return requested;
  const path = String(deepLink || "");
  if (/^\/(?:muhasebe|fatura)(?:\/|$)/i.test(path)) return "yonetici";
  const fromPath = Object.entries(APP_ROOTS).find(([, root]) => path === root.slice(0, -1) || path.startsWith(root));
  if (fromPath) return fromPath[0];
  const role = String(recipientRole || "").toLocaleLowerCase("tr-TR");
  return role === "manager" ? "yonetici" : "personel";
}

function safeAppDeepLink(value, appTarget, fallback = "") {
  const target = normalizeAppTarget(appTarget);
  const root = APP_ROOTS[target];
  const safeFallback = fallback || root;
  let link = String(value || "").trim().slice(0, 500);
  link = migrateLegacyAccountingLink(link) || link;
  if (!link.startsWith("/") || link.startsWith("//") || /[\r\n]/.test(link)) return safeFallback;
  try {
    const url = new URL(link, "https://menu-suite.invalid/");
    const bareRoot = root.slice(0, -1);
    if (url.origin !== "https://menu-suite.invalid" || (url.pathname !== bareRoot && !url.pathname.startsWith(root))) return safeFallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return safeFallback;
  }
}

function notificationAppTargets(notification) {
  const source = notification && typeof notification === "object" ? notification : {};
  const role = String(source.recipientRole || "").toLocaleLowerCase("tr-TR");
  const primary = normalizeAppTarget(source.appTarget, source.deepLink, role);
  const targets = new Set([primary]);
  const shared = source.metadata && Array.isArray(source.metadata.sharedAppTargets)
    ? source.metadata.sharedAppTargets : [];
  for (const value of shared) {
    const target = String(value || "").trim().toLocaleLowerCase("tr-TR");
    if (Object.prototype.hasOwnProperty.call(APP_ROOTS, target)) targets.add(target);
  }
  return [...targets];
}

function notificationTargetsApp(notification, appTarget) {
  const requested = String(appTarget || "").trim().toLocaleLowerCase("tr-TR");
  if (!requested) return true;
  if (!Object.prototype.hasOwnProperty.call(APP_ROOTS, requested)) return false;
  return notificationAppTargets(notification).includes(requested);
}

module.exports = {
  APP_ROOTS,
  LEGACY_ACCOUNTING_SECTIONS,
  migrateLegacyAccountingLink,
  normalizeAppTarget,
  notificationAppTargets,
  notificationTargetsApp,
  safeAppDeepLink
};
