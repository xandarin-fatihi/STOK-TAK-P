"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ExcelJS = require("exceljs");
const express = require("express");

const { createProcurementDocumentService } = require("../src/procurement-documents");
const { registerProcurementRoutes } = require("../src/procurement-routes");
const { createProcurementService } = require("../src/procurement-service");
const { registerPricingRoutes } = require("../src/pricing-routes");
const stockService = require("../src/stock-service");
const { normalizeStore } = require("../src/store/file-store");
const { normalizeStockState, STORE_SCHEMA_VERSION } = require("../src/store/migrations");
const { registerWorkforceRoutes } = require("../src/workforce-routes");

const ADMIN = Object.freeze({
  type: "admin",
  id: "regression-admin",
  name: "Test Yöneticisi",
  branchId: "main",
  capabilities: []
});

const PDF_FIXTURE = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  "ascii"
);

test("personel sevkiyat bildirimi ve yönetici onayı tekrar oynatıldığında yalnız bir kayıt ve stok etkisi üretir", async (context) => {
  const reporter = {
    id: "personel-regression",
    username: "personel-test",
    name: "Test Personeli",
    active: true,
    branchId: "main",
    stockLocationId: stockService.CAFE_LOCATION_ID,
    personelSectionAccess: { recipe: true, stock: true, tasks: true, shipment: true, shift: true }
  };
  const store = memoryStore({
    schemaVersion: STORE_SCHEMA_VERSION,
    revisions: { publish: 0, workforce: 0, procurement: 0, shipment: 0, inventory: 0, stock: 0 },
    recipeUsers: [reporter],
    workforceShipments: [],
    stockState: stockFixture(),
    procurement: {}
  });
  const createdNotifications = [];
  const publishedNotifications = [];
  const notificationService = {
    createNotificationInStore(data, input) {
      const notification = { id: `notification-${createdNotifications.length + 1}`, createdAt: new Date().toISOString(), ...input };
      data.notifications = (data.notifications || []).concat(notification);
      createdNotifications.push(notification);
      return notification;
    },
    notificationsFromResult(notification) {
      return notification ? [notification] : [];
    },
    publishNotificationEvent(notification) {
      publishedNotifications.push(notification);
    }
  };
  const app = express();
  app.use(express.json());
  const pass = (_req, _res, next) => next();
  const auth = {
    requireAdmin: pass,
    requirePersonelOrPreview: pass,
    requireActivePersonel(req, _res, next) {
      req.recipe = { role: "recipe", sessionRole: "personel", userId: reporter.id };
      req.recipeUser = reporter;
      next();
    },
    requirePersonelSection: () => pass
  };
  const runtime = registerWorkforceRoutes({
    app,
    store,
    auth,
    crypto,
    normalizeStockState,
    requireAdminRequestOrigin: pass,
    requireAdminOrMainRequestOrigin: pass,
    broadcastStockUpdate: () => {},
    notificationService
  });
  app.use(errorResponder);
  const { baseUrl, close } = await listen(app);
  context.after(close);

  const beforeState = await store.read();
  const beforeQuantity = stockService.getProductBalance(
    beforeState.stockState,
    stockService.CAFE_LOCATION_ID,
    "stock-regression"
  ).quantity;
  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "personel-shipment-regression-0001"
    },
    body: JSON.stringify({
      destinationLocationId: stockService.CAFE_LOCATION_ID,
      note: "İzole örnek sevkiyat",
      items: [{ productId: "stock-regression", productCode: "REG-001", quantity: 2, unit: "kutu" }]
    })
  };

  let response = await fetch(`${baseUrl}/api/workforce/shipments`, request);
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  response = await fetch(`${baseUrl}/api/workforce/shipments`, request);
  assert.equal(response.status, 200, await response.clone().text());
  const replay = await response.json();
  assert.equal(replay.idempotent, true);
  assert.equal(replay.shipment.id, created.shipment.id);
  assert.match(created.shipment.shipmentNumber, /^SVK-\d{4}-\d{6}$/);
  assert.equal(replay.shipment.shipmentNumber, created.shipment.shipmentNumber);
  assert.equal(created.shipment.items[0].unit, "kutu");
  assert.equal(created.shipment.items[0].baseQuantity, 20);

  const approvalInput = {
    shipmentId: created.shipment.id,
    actor: ADMIN,
    requestId: "manager-shipment-approval-0001",
    expectedRevision: created.revision,
    procurementExpectedRevision: created.procurementRevision,
    destinationLocationId: stockService.CAFE_LOCATION_ID,
    note: "Örnek sevkiyat kontrol edildi"
  };
  const approved = await runtime.approveWorkforceShipment(approvalInput);
  const approvalReplay = await runtime.approveWorkforceShipment(approvalInput);
  assert.equal(approved.idempotent, false);
  assert.equal(approvalReplay.idempotent, true);
  assert.equal(approvalReplay.shipment.id, created.shipment.id);

  const after = await store.read();
  const afterQuantity = stockService.getProductBalance(
    after.stockState,
    stockService.CAFE_LOCATION_ID,
    "stock-regression"
  ).quantity;
  const shipmentMovements = after.stockState.movements.filter((item) => item.shipmentId === created.shipment.id);
  assert.equal(after.workforceShipments.length, 1);
  assert.equal(shipmentMovements.length, 1);
  assert.equal(shipmentMovements[0].quantity, 20);
  assert.equal(afterQuantity, beforeQuantity + 20);
  assert.deepEqual(createdNotifications.map((item) => item.eventType), ["shipment_reported", "shipment_approved"]);
  assert.equal(publishedNotifications.length, 2);
});

test("muhasebe Excel/CSV çıktıları ile PDF fiş indirmesi doğru başlık ve dolu içerik döndürür", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paket3-export-regression-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const documentService = createProcurementDocumentService({ documentsDir: path.join(root, "documents") });
  const storedPdf = await documentService.storeUpload({
    buffer: PDF_FIXTURE,
    originalName: "ornek-fis.pdf",
    declaredMimeType: "application/pdf"
  });
  documentService.commitUpload(storedPdf);

  const store = memoryStore({
    schemaVersion: STORE_SCHEMA_VERSION,
    revisions: { publish: 0, workforce: 1, procurement: 1 },
    stockState: stockFixture(),
    workforceShipments: [
      {
        id: "shipment-export-example",
        shipmentNumber: "SVK-2026-000001",
        supplierId: "supplier-export-example",
        branchId: "main",
        userId: "personel-export",
        userName: "Örnek Personel",
        status: "onaylandı",
        stockAppliedAt: "2026-09-27T09:00:00.000Z",
        accountingStatus: "posted",
        evidenceStatus: "complete",
        createdAt: "2026-09-27T08:30:00.000Z",
        items: [{ productId: "stock-regression", quantity: 2, unit: "koli", totalKurus: 125000 }],
        revision: 2
      },
      {
        id: "shipment-export-legacy-personnel",
        shipmentNumber: "SVK-2026-000099",
        shipmentSource: "personnel_stock",
        branchId: "main",
        userId: "personel-legacy-export",
        userName: "Eski Personel",
        status: "onaylandı",
        stockAppliedAt: "2026-09-26T09:00:00.000Z",
        accountingStatus: "failed",
        accountingFailureCode: "SUPPLIER_NOT_FOUND",
        evidenceStatus: "missing",
        createdAt: "2026-09-26T08:30:00.000Z",
        items: [{ productId: "stock-regression", quantity: 1, unit: "koli" }],
        revision: 2
      }
    ],
    procurement: {
      suppliers: [{
        id: "supplier-export-example",
        code: "TED-001",
        name: "Örnek Kahve Tedarikçisi",
        taxNumber: "1234567890",
        phone: "02120000000",
        email: "ornek@example.test",
        paymentTermDays: 14,
        active: true,
        branchId: "main"
      }],
      ledgerEntries: [{
        id: "ledger-export-example",
        supplierId: "supplier-export-example",
        shipmentId: "shipment-export-example",
        branchId: "main",
        type: "invoice",
        sourceType: "shipment",
        sourceId: "shipment-export-example",
        note: "Örnek sevkiyat faturası",
        amountKurus: -125000,
        transactionDate: "2026-09-27",
        dueDate: "2026-10-11",
        createdAt: "2026-09-27T09:05:00.000Z"
      }],
      payments: [],
      documents: [{
        id: "document-export-pdf",
        supplierId: "supplier-export-example",
        shipmentIds: ["shipment-export-example"],
        branchId: "main",
        documentType: "fiş",
        originalName: "ornek-fis.pdf",
        createdBy: ADMIN.id,
        createdAt: "2026-09-27T09:02:00.000Z",
        ...storedPdf
      }]
    }
  });
  const service = createProcurementService({ store, now: () => new Date("2026-09-27T12:00:00.000Z") });
  const app = express();
  app.use(express.json());
  const auth = {
    requireRecipe(req, _res, next) {
      req.authSession = { role: "admin" };
      req.recipe = { role: "admin", sessionRole: "admin" };
      next();
    }
  };
  registerProcurementRoutes({ app, store, auth, service, documentService, resolveActor: () => ADMIN });
  app.use(errorResponder);
  const { baseUrl, close } = await listen(app);
  context.after(close);

  let response = await fetch(`${baseUrl}/api/procurement/v1/export?kind=ledger`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.match(response.headers.get("content-disposition") || "", /^attachment; filename=".+\.xlsx"$/);
  const ledgerBuffer = Buffer.from(await response.arrayBuffer());
  assert.ok(ledgerBuffer.length > 5000);
  assert.equal(ledgerBuffer.subarray(0, 2).toString("ascii"), "PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(ledgerBuffer);
  const ledgerSheet = workbook.getWorksheet("Cari Hesap");
  assert.ok(ledgerSheet);
  assert.equal(ledgerSheet.getCell("A9").value, 1250);
  assert.equal(ledgerSheet.getCell("G9").value, 1250);
  assert.equal(ledgerSheet.getCell("B13").value, "Örnek Kahve Tedarikçisi");

  response = await fetch(`${baseUrl}/api/procurement/v1/export?kind=shipments`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/csv; charset=utf-8/);
  assert.match(response.headers.get("content-disposition") || "", /paket-3-shipments-.+\.csv/);
  const shipmentCsvBuffer = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...shipmentCsvBuffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const shipmentCsv = shipmentCsvBuffer.toString("utf8");
  assert.match(shipmentCsv, /SVK-2026-000001/);
  assert.match(shipmentCsv, /Örnek Personel/);
  const legacyPersonnelLine = shipmentCsv.split(/\r?\n/).find((line) => line.includes("Eski Personel"));
  assert.ok(legacyPersonnelLine, "eski personel stok sevkiyatı CSV'de bulunmalı");
  assert.match(legacyPersonnelLine, /;"not_required";/, "CSV, arayüzle aynı etkin muhasebe durumunu kullanmalı");
  assert.doesNotMatch(legacyPersonnelLine, /;"failed";/, "ham eski hata durumu CSV'ye sızmamalı");

  response = await fetch(`${baseUrl}/api/procurement/v1/export?kind=suppliers`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/csv; charset=utf-8/);
  const supplierCsv = await response.text();
  assert.match(supplierCsv, /Örnek Kahve Tedarikçisi/);
  assert.match(supplierCsv, /TED-001/);

  response = await fetch(`${baseUrl}/api/procurement/v1/documents/document-export-pdf/content`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-length"), String(PDF_FIXTURE.length));
  assert.match(response.headers.get("content-disposition") || "", /^attachment; filename="ornek-fis\.pdf"$/);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF_FIXTURE);
});

test("örnek menü fiyatı toplu güncelleme, idempotent tekrar ve denetlenebilir geri alma zincirini korur", async (context) => {
  const store = memoryStore({
    schemaVersion: STORE_SCHEMA_VERSION,
    revisions: { publish: 0, pricing: 0 },
    pricing: {
      schemaVersion: 1,
      types: [{
        id: "standard",
        name: "Standart",
        active: true,
        order: 0,
        options: [{ id: "standard", label: "Standart", unit: "", order: 0, active: true }]
      }]
    },
    menuState: {
      categories: [{
        id: "coffee",
        name: "Kahveler",
        active: true,
        order: 0,
        products: [{
          id: "latte-example",
          name: "Örnek Latte",
          active: true,
          order: 0,
          pricing: { typeId: "standard", values: { standard: { price: 120, active: true } } }
        }]
      }]
    }
  });
  const app = express();
  app.use(express.json());
  let menuBroadcastCount = 0;
  let publicBroadcastCount = 0;
  const pass = (req, _res, next) => {
    req.admin = { sub: "pricing-regression-admin" };
    next();
  };
  registerPricingRoutes({
    app,
    store,
    auth: { requireAdmin: pass },
    requireAdminRequestOrigin: pass,
    broadcastMenuUpdate: () => { menuBroadcastCount += 1; },
    broadcastPublicUpdate: () => { publicBroadcastCount += 1; }
  });
  app.use(errorResponder);
  const { baseUrl, close } = await listen(app);
  context.after(close);

  let response = await fetch(`${baseUrl}/api/admin/pricing`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 0);

  const request = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "pricing-bulk-regression-0001"
    },
    body: JSON.stringify({
      expectedRevision: 0,
      typeId: "standard",
      optionIds: ["standard"],
      productIds: ["latte-example"],
      operation: "add",
      value: 15.5
    })
  };
  response = await fetch(`${baseUrl}/api/admin/pricing/bulk-update`, request);
  assert.equal(response.status, 200, await response.clone().text());
  const updated = await response.json();
  assert.equal(updated.changedRowCount, 1);
  assert.equal(updated.changedRows[0].oldPrice, 120);
  assert.equal(updated.changedRows[0].newPrice, 135.5);

  response = await fetch(`${baseUrl}/api/admin/pricing/bulk-update`, request);
  assert.equal(response.status, 200, await response.clone().text());
  const replay = await response.json();
  assert.equal(replay.operationId, updated.operationId);
  assert.equal(replay.revision, 1);
  assert.equal(currentPrice(await store.read()), 135.5);
  assert.equal(menuBroadcastCount, 1);
  assert.equal(publicBroadcastCount, 1);

  response = await fetch(`${baseUrl}/api/admin/pricing/history`);
  assert.equal(response.status, 200);
  let history = await response.json();
  assert.equal(history.history.length, 1);
  assert.equal(history.history[0].kind, "pricing_bulk_update");

  const undoRequest = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "pricing-undo-regression-0001"
    },
    body: JSON.stringify({ expectedRevision: 1 })
  };
  response = await fetch(`${baseUrl}/api/admin/pricing/history/${encodeURIComponent(updated.operationId)}/undo`, undoRequest);
  assert.equal(response.status, 200, await response.clone().text());
  const undone = await response.json();
  assert.equal(undone.undoOf, updated.operationId);
  assert.equal(undone.changedRowCount, 1);
  assert.equal(currentPrice(await store.read()), 120);

  response = await fetch(`${baseUrl}/api/admin/pricing/history/${encodeURIComponent(updated.operationId)}/undo`, undoRequest);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).operationId, undone.operationId);
  assert.equal(currentPrice(await store.read()), 120);
  assert.equal(menuBroadcastCount, 2);
  assert.equal(publicBroadcastCount, 2);

  history = await (await fetch(`${baseUrl}/api/admin/pricing/history`)).json();
  assert.deepEqual(history.history.map((item) => item.kind), ["pricing_operation_undone", "pricing_bulk_update"]);
});

test("sevkiyat geçmişi ve merkezî mal kabul kartı dar ekranlarda mobil sözleşmeyi korur", async () => {
  const cssPath = path.resolve(__dirname, "../../../PERSONEL/personel-compact.css");
  const css = await fs.readFile(cssPath, "utf8");

  assert.match(
    css,
    /\.personel-dashboard\[data-active-section="shipment"\] \.workforce-section\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s,
    "Sevkiyat geçmişi çalışma alanının kullanılabilir genişliğini kullanmalı"
  );
  assert.match(css, /\.wf-shipment-image img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/s);
  assert.match(
    css,
    /\.wf-shipment-dialog\s*\{[^}]*width:\s*min\(1040px,\s*calc\(100vw\s*-\s*32px\)\);[^}]*max-height:\s*min\(90dvh,\s*900px\);/s,
    "Masaüstü modalı görünür alanda merkezlenmeli"
  );
  assert.match(
    css,
    /\.wf-cart-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    "Tek adet miktarı alanı kullanılabilir genişliği doldurmalı"
  );
  assert.match(
    css,
    /\.wf-receipt-cart \.wf-cart-line\s*\{[^}]*grid-template-columns:\s*96px\s+minmax\(0,\s*1fr\)\s+44px;[^}]*align-items:\s*stretch;/s,
    "Gelen malzeme satırı büyük görsel, ürün bilgisi ve sabit silme alanına ayrılmalı"
  );
  assert.match(css, /\.wf-receipt-cart \.wf-cart-line__image\s*\{[^}]*width:\s*96px;[^}]*min-height:\s*96px;[^}]*align-self:\s*stretch;/s);
  assert.match(
    css,
    /body\.is-shipment-dialog-open,[^{]*\{[^}]*overflow:\s*hidden;[^}]*overscroll-behavior:\s*none;/s,
    "Açık modal arka sayfayı kaydırmamalı"
  );
  const mobileStart = css.lastIndexOf("@media (max-width: 760px)");
  const narrowStart = css.indexOf("@media (max-width: 420px)", mobileStart);
  const reducedMotionStart = css.indexOf("@media (prefers-reduced-motion: reduce)", narrowStart);
  assert.ok(mobileStart >= 0 && narrowStart > mobileStart && reducedMotionStart > narrowStart);

  const mobile = css.slice(mobileStart, narrowStart);
  assert.match(mobile, /\.wf-receipt-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(mobile, /\.wf-shipment-dialog\s*\{[^}]*width:\s*calc\(100vw\s*-\s*20px\);[^}]*max-height:\s*min\(94dvh,\s*94svh\);/s);
  assert.match(mobile, /\.wf-receipt-column \+ \.wf-receipt-column\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--panel-line\);[^}]*border-left:\s*0;/s);

  const narrow = css.slice(narrowStart, reducedMotionStart);
  assert.match(narrow, /\.wf-shipment-dialog\s*\{[^}]*width:\s*calc\(100vw\s*-\s*10px\);/s);
  assert.match(narrow, /\.wf-cart-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(narrow, /\.wf-receipt-cart \.wf-cart-line\s*\{[^}]*grid-template-columns:\s*78px\s+minmax\(0,\s*1fr\)\s+40px;/s);

  const reducedMotion = css.slice(reducedMotionStart);
  assert.match(reducedMotion, /\.wf-shipment-dialog,[\s\S]*?\.wf-shipment-dialog-backdrop\s*\{[^}]*transition:\s*none;/s);
});

function stockFixture() {
  return {
    categories: [{ id: "stock-category-regression", name: "Test Ürünleri", active: true, order: 0 }],
    products: [{
      id: "stock-regression",
      productCode: "REG-001",
      name: "Örnek Bardak",
      categoryId: "stock-category-regression",
      category: "Test Ürünleri",
      unit: "adet",
      baseUnit: "adet",
      bulkUnit: "kutu",
      caseUnit: "kutu",
      unitsPerBulkUnit: 10,
      unitsPerCase: 10,
      active: true,
      sourcePresent: true
    }],
    locations: [
      { id: stockService.GENERAL_LOCATION_ID, code: "GENEL", name: "Genel Depo", type: "central", active: true, personnelVisible: false },
      { id: stockService.CAFE_LOCATION_ID, code: "CAFE", name: "Kafe Deposu", type: "cafe", active: true, personnelVisible: true }
    ],
    balances: [
      { locationId: stockService.GENERAL_LOCATION_ID, productId: "stock-regression", quantity: 100, revision: 0 },
      { locationId: stockService.CAFE_LOCATION_ID, productId: "stock-regression", quantity: 10, revision: 0 }
    ],
    movements: [],
    locationMigrationVersion: 1
  };
}

function memoryStore(seed) {
  let state = normalizeStore(seed);
  const noChange = Symbol("no-change");
  return {
    async read() {
      return structuredClone(state);
    },
    async update(mutator) {
      const draft = structuredClone(state);
      const result = await mutator(draft, { noChange });
      if (result !== noChange) state = normalizeStore(result === undefined ? draft : result);
      return structuredClone(state);
    }
  };
}

function currentPrice(data) {
  return data.menuState.categories[0].products[0].pricing.values.standard.price;
}

function errorResponder(error, _req, res, next) {
  if (res.headersSent) return next(error);
  return res.status(error.status || 500).json({ ok: false, code: error.code, message: error.message });
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    })
  };
}
