"use strict";

const { normalizeProductCode } = require("./product-code-registry");

const PROCUREMENT_SCHEMA_VERSION = 1;

function normalizeProcurement(value, options = {}) {
  const source = record(value);
  const supplierProductLinks = entities(source.supplierProductLinks, normalizeSupplierProductLink);
  const supplierIndependentProducts = entities(source.supplierIndependentProducts, normalizeSupplierIndependentProduct);
  const independentKeys = new Set(supplierIndependentProducts.flatMap((item) => [
    `${item.supplierId}:name:${normalizeName(item.name)}`,
    item.stockProductId ? `${item.supplierId}:stock:${item.stockProductId}` : ""
  ].filter(Boolean)));

  for (const link of supplierProductLinks) {
    const name = text(link.supplierProductName || link.stockProductName || link.stockProductCode || link.supplierProductCode, 180);
    const keys = [`${link.supplierId}:name:${normalizeName(name)}`, link.stockProductId ? `${link.supplierId}:stock:${link.stockProductId}` : ""].filter(Boolean);
    if (!name || keys.some((key) => independentKeys.has(key))) continue;
    const migrated = normalizeSupplierIndependentProduct({
      id: `supplier-product-legacy-${link.id}`,
      supplierId: link.supplierId,
      name,
      code: link.supplierProductCode || link.stockProductCode,
      documentType: link.documentType || "irsaliye",
      bulkUnit: link.purchaseUnit || link.bulkUnit || "koli",
      baseUnit: link.baseUnit || link.stockProductUnit || "adet",
      conversionFactor: link.conversionFactor || 1,
      stockProductId: link.stockProductId,
      stockMatchStatus: link.stockProductId ? "matched" : "unmatched",
      defaultPurchasePriceKurus: link.defaultPurchasePriceKurus,
      lastPurchasePriceKurus: link.lastPurchasePriceKurus,
      active: link.active !== false,
      createdAt: link.createdAt,
      updatedAt: link.updatedAt,
      legacyProductLinkId: link.id
    });
    if (!migrated) continue;
    supplierIndependentProducts.push(migrated);
    keys.forEach((key) => independentKeys.add(key));
  }

  const normalized = {
    ...source,
    version: Math.max(PROCUREMENT_SCHEMA_VERSION, integer(source.version)),
    revision: integer(source.revision),
    suppliers: entities(source.suppliers, normalizeSupplier),
    supplierProductLinks,
    supplierIndependentProducts,
    documents: entities(source.documents, normalizeDocument),
    ledgerEntries: entities(source.ledgerEntries, normalizeLedgerEntry),
    payments: entities(source.payments, normalizePayment),
    auditEvents: entities(source.auditEvents, normalizeAuditEvent).slice(-5000),
    idempotencyRecords: entities(source.idempotencyRecords, normalizeIdempotency).slice(-1000),
    settings: normalizeSettings(source.settings)
  };
  return reconcileBranchMetadata(normalized, source, options.shipments);
}

function reconcileBranchMetadata(procurement, rawProcurement, shipments) {
  const raw = record(rawProcurement);
  const shipmentIndex = new Map(array(shipments).map((shipment) => [String(shipment && shipment.id || ""), shipment]));
  const rawDocuments = new Map(array(raw.documents).map((item) => [String(item && item.id || ""), item]));
  const rawLedger = new Map(array(raw.ledgerEntries).map((item) => [String(item && item.id || ""), item]));
  const rawPayments = new Map(array(raw.payments).map((item) => [String(item && item.id || ""), item]));
  const documentIndex = new Map(procurement.documents.map((document) => [document.id, document]));
  const branchFromShipment = (id) => text(shipmentIndex.get(String(id || ""))?.branchId, 80);
  for (const document of procurement.documents) {
    if (rawDocuments.get(document.id)?.branchId) continue;
    const linkedBranch = document.shipmentIds.map(branchFromShipment).find(Boolean);
    if (linkedBranch) document.branchId = linkedBranch;
  }
  for (const entry of procurement.ledgerEntries) {
    if (rawLedger.get(entry.id)?.branchId) continue;
    const document = documentIndex.get(entry.documentId);
    entry.branchId = branchFromShipment(entry.shipmentId) || document?.branchId || entry.branchId || "main";
  }
  const ledgerIndex = new Map(procurement.ledgerEntries.map((entry) => [entry.id, entry]));
  for (const payment of procurement.payments) {
    if (rawPayments.get(payment.id)?.branchId) continue;
    payment.branchId = ledgerIndex.get(payment.ledgerEntryId)?.branchId
      || documentIndex.get(payment.documentId)?.branchId || payment.branchId || "main";
  }
  return procurement;
}

function entities(value, normalizer) {
  const byId = new Map();
  array(value).forEach((item, index) => {
    const normalized = normalizer(item, index);
    if (normalized?.id) byId.set(normalized.id, normalized);
  });
  return [...byId.values()];
}

function normalizeSupplier(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 180);
  if (!id) return null;
  return { ...item, id, code: text(item.code, 80), name: text(item.name, 180), contactName: text(item.contactName, 180),
    taxNumber: text(item.taxNumber, 32), phone: text(item.phone, 40), email: text(item.email, 254).toLowerCase(),
    address: text(item.address, 1000), paymentTermDays: Math.min(3650, integer(item.paymentTermDays)),
    leadTimeDays: Math.min(365, integer(item.leadTimeDays)), active: item.active !== false,
    createdAt: item.createdAt || null, updatedAt: item.updatedAt || item.createdAt || null,
    createdBy: text(item.createdBy, 180), updatedBy: text(item.updatedBy || item.createdBy, 180) };
}

function normalizeSupplierProductLink(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 180), supplierId = text(item.supplierId, 180);
  const stockProductId = text(item.stockProductId || item.productId, 180);
  const stockProductCode = normalizeProductCode(item.stockProductCode || item.productCode);
  if (!id || !supplierId || (!stockProductId && !stockProductCode)) return null;
  const conversionFactor = positive(item.conversionFactor, 1);
  return { ...item, id, supplierId, stockProductId, stockProductCode, supplierProductName: text(item.supplierProductName, 180),
    supplierProductCode: text(item.supplierProductCode, 100), purchaseUnit: text(item.purchaseUnit, 40), conversionFactor,
    defaultPurchasePriceKurus: Math.max(0, kurus(item.defaultPurchasePriceKurus)), lastPurchasePriceKurus: Math.max(0, kurus(item.lastPurchasePriceKurus)),
    active: item.active !== false, createdAt: item.createdAt || null, updatedAt: item.updatedAt || item.createdAt || null };
}

function normalizeSupplierIndependentProduct(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 180), supplierId = text(item.supplierId, 180), name = text(item.name, 180);
  if (!id || !supplierId || !name) return null;
  return { ...item, id, supplierId, name, code: text(item.code, 100), documentType: documentType(item.documentType, "irsaliye"),
    bulkUnit: text(item.bulkUnit || item.purchaseUnit, 40), baseUnit: text(item.baseUnit, 40) || "adet",
    purchaseUnit: text(item.bulkUnit || item.purchaseUnit, 40), conversionFactor: Math.max(0.001, positive(item.conversionFactor, 1)),
    stockProductId: text(item.stockProductId, 180), stockMatchStatus: text(item.stockMatchStatus, 40) || (item.stockProductId ? "matched" : "unmatched"),
    defaultPurchasePriceKurus: Math.max(0, kurus(item.defaultPurchasePriceKurus)), lastPurchasePriceKurus: Math.max(0, kurus(item.lastPurchasePriceKurus)),
    note: text(item.note, 1000), active: item.active !== false, createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || item.createdAt || null, createdBy: text(item.createdBy, 180), updatedBy: text(item.updatedBy || item.createdBy, 180) };
}

function normalizeDocument(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 180);
  if (!id) return null;
  return { ...item, id, branchId: text(item.branchId, 80) || "main", supplierId: text(item.supplierId, 180),
    shipmentIds: stringArray(item.shipmentIds || (item.shipmentId ? [item.shipmentId] : []), 180),
    shipmentItemIds: stringArray(item.shipmentItemIds || item.lineIds, 180), documentType: documentType(item.documentType, "diğer"),
    documentNumber: text(item.documentNumber, 120), documentDate: text(item.documentDate, 10), originalName: text(item.originalName, 255),
    mimeType: text(item.mimeType, 100), sizeBytes: integer(item.sizeBytes), sha256: text(item.sha256, 128), physicalName: text(item.physicalName, 255),
    thumbnailPhysicalName: text(item.thumbnailPhysicalName, 255), archivedAt: item.archivedAt || null, archivedBy: text(item.archivedBy, 180),
    createdAt: item.createdAt || null, createdBy: text(item.createdBy, 180) };
}

function normalizeLedgerEntry(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 180), supplierId = text(item.supplierId, 180);
  if (!id || !supplierId) return null;
  const type = ["invoice", "payment", "credit_note", "reversal", "opening_balance", "adjustment"].includes(String(item.type)) ? String(item.type) : "adjustment";
  return { ...item, id, supplierId, branchId: text(item.branchId, 80) || "main", shipmentId: text(item.shipmentId, 180),
    documentId: text(item.documentId, 180), type, amountKurus: kurus(item.amountKurus),
    balanceAfterKurus: item.balanceAfterKurus === undefined ? undefined : kurus(item.balanceAfterKurus),
    transactionDate: text(item.transactionDate || String(item.createdAt || "").slice(0, 10), 10), dueDate: text(item.dueDate, 10),
    note: text(item.note, 1000), sourceType: text(item.sourceType, 100), sourceId: text(item.sourceId, 180), reversalOf: text(item.reversalOf, 180),
    createdBy: text(item.createdBy, 180), createdAt: item.createdAt || null, idempotencyKey: text(item.idempotencyKey, 160) };
}

function normalizePayment(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 180), supplierId = text(item.supplierId, 180);
  if (!id || !supplierId) return null;
  return { ...item, id, supplierId, branchId: text(item.branchId, 80) || "main", documentId: text(item.documentId, 180),
    ledgerEntryId: text(item.ledgerEntryId, 180), amountKurus: Math.abs(kurus(item.amountKurus)), paymentDate: text(item.paymentDate, 10),
    method: text(item.method, 80), reference: text(item.reference, 180), note: text(item.note, 1000), status: item.status === "reversed" ? "reversed" : "recorded",
    reversalLedgerEntryId: text(item.reversalLedgerEntryId, 180), reversedAt: item.reversedAt || null, reversedBy: text(item.reversedBy, 180),
    reversedByName: text(item.reversedByName, 180), reversalReason: text(item.reversalReason, 1000), createdAt: item.createdAt || null, createdBy: text(item.createdBy, 180) };
}

function normalizeAuditEvent(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 180);
  if (!id) return null;
  return { ...item, id, action: text(item.action, 120), entityType: text(item.entityType, 100), entityId: text(item.entityId, 180),
    actorType: item.actorType === "admin" ? "admin" : "personel", actorId: text(item.actorId, 180), actorName: text(item.actorName, 180),
    revision: integer(item.revision), requestId: text(item.requestId, 160), metadata: record(item.metadata), createdAt: item.createdAt || null };
}

function normalizeIdempotency(item) {
  if (!isRecord(item)) return null;
  const id = text(item.id, 320), key = text(item.key || item.requestId, 160);
  if (!id || !key) return null;
  return { ...item, id, key, operation: text(item.operation, 120), actorId: text(item.actorId, 180), resourceId: text(item.resourceId, 180),
    revision: integer(item.revision), response: record(item.response), createdAt: item.createdAt || null };
}

function normalizeSettings(value) {
  const source = record(value);
  const units = stringArray(source.units, 40);
  const types = stringArray(source.accountingDocumentTypes, 40).filter((type) => ["fatura", "fiş", "makbuz"].includes(type));
  return { ...source, defaultBranchId: text(source.defaultBranchId, 80) || "main", currency: "TRY",
    dueSoonDays: Math.max(1, Math.min(90, integer(source.dueSoonDays, 7))),
    units: units.length ? units : ["koli", "paket", "adet", "kg", "gr", "litre", "ml", "şişe"],
    accountingDocumentTypes: types.length ? types : ["fatura", "fiş", "makbuz"],
    updatedAt: source.updatedAt || null, updatedBy: text(source.updatedBy, 180) };
}

function documentType(value, fallback) { return ["fatura", "irsaliye", "fiş", "makbuz", "diğer"].includes(String(value)) ? String(value) : fallback; }
function stringArray(value, max) { return [...new Set(array(value).map((item) => text(item, max)).filter(Boolean))]; }
function text(value, max) { return String(value || "").trim().slice(0, max); }
function kurus(value) { const number = Number(value); return Number.isSafeInteger(number) ? number : 0; }
function integer(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback; }
function positive(value, fallback) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : fallback; }
function array(value) { return Array.isArray(value) ? value : []; }
function isRecord(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function record(value) { return isRecord(value) ? value : {}; }
function normalizeName(value) { return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim(); }

module.exports = { PROCUREMENT_SCHEMA_VERSION, normalizeProcurement, reconcileBranchMetadata };
