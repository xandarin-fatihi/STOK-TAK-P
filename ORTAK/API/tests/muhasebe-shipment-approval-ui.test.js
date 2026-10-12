"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE");
const documents = fs.readFileSync(path.join(moduleRoot, "scripts", "documents.js"), "utf8");
const app = fs.readFileSync(path.join(moduleRoot, "scripts", "app.js"), "utf8");
const accounting = fs.readFileSync(path.join(moduleRoot, "scripts", "accounting.js"), "utf8");
const receipts = fs.readFileSync(path.join(moduleRoot, "scripts", "receipts.js"), "utf8");
const stateSource = fs.readFileSync(path.join(moduleRoot, "scripts", "state.js"), "utf8");
const dashboard = fs.readFileSync(path.join(moduleRoot, "scripts", "dashboard.js"), "utf8");
const suppliers = fs.readFileSync(path.join(moduleRoot, "scripts", "suppliers.js"), "utf8");
const stock = fs.readFileSync(path.join(moduleRoot, "scripts", "stock.js"), "utf8");
const productAnalysis = fs.readFileSync(path.join(moduleRoot, "scripts", "product-analysis.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(moduleRoot, "index.html"), "utf8");
const styles = fs.readFileSync(path.join(moduleRoot, "styles", "muhasebe.css"), "utf8");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function approvalRenderer(stockLocations = []) {
  const start = documents.indexOf("function shipmentApprovalPanel");
  const end = documents.indexOf("export function shipmentArchiveDetail", start);
  assert.ok(start >= 0 && end > start, "onay paneli yardımcısı bulunmalı");
  const source = documents.slice(start, end);
  return new Function("state", "escapeHtml", `"use strict"; ${source}; return shipmentApprovalPanel;`)(
    { context: { stockLocations } }, escapeHtml
  );
}

function stockReferenceAssigner(initialContext) {
  const start = app.indexOf("function assignStockReferences");
  const end = app.indexOf("const loadStockReferences", start);
  assert.ok(start >= 0 && end > start, "stok referansı atama yardımcısı bulunmalı");
  const source = app.slice(start, end);
  const state = { context: initialContext };
  const assign = new Function("state", `"use strict"; ${source}; return assignStockReferences;`)(state);
  return { state, assign };
}

function shipmentDetailLoader({ state, loadStockReferences, api, updateRevision }) {
  const start = app.indexOf("function approvalStockLocations");
  const end = app.indexOf("async function openShipment", start);
  assert.ok(start >= 0 && end > start, "sevkiyat detayı depo önkoşulu bulunmalı");
  const source = app.slice(start, end);
  return new Function("state", "loadStockReferences", "api", "updateRevision", `"use strict"; ${source}; return loadShipmentForDetail;`)(
    state, loadStockReferences, api, updateRevision
  );
}

function initialIntentRunner(dependencies) {
  const start = app.indexOf("async function activateInitialView");
  const end = app.indexOf("async function setView", start);
  assert.ok(start >= 0 && end > start, "ilk görünüm koordinatörü bulunmalı");
  const source = app.slice(start, end);
  return new Function(
    "safeSessionStorageGet", "consumeOpenIntent", "visibleViews", "state", "setView", "applyStockIntent",
    "openShipment", "openSupplier", "has", "CAPABILITIES", "openDocument", "cleanFaturaUrl",
    `"use strict"; ${source}; return activateInitialView;`
  )(
    () => "", dependencies.consumeOpenIntent, [{ id: "documents" }], dependencies.state, dependencies.setView,
    async () => {}, dependencies.openShipment, async () => {}, () => true, { documentsRead: "documents.read" }, async () => {}, dependencies.cleanFaturaUrl
  );
}

test("bekleyen personel sevkiyatı hedef depo ile onay ve red eylemlerini gösterir", () => {
  const render = approvalRenderer([
    { id: "loc-main", name: "Ana & Merkez" },
    { id: "loc-branch", name: "Şube Deposu" }
  ]);
  const html = render({ canApprove: true, canReject: true, destinationLocationId: "loc-branch" });

  assert.match(html, /aria-labelledby="shipmentApprovalTitle"/);
  assert.match(html, /id="shipmentDestinationLocation"[^>]*required[^>]*aria-describedby="shipmentApprovalHelp"/);
  assert.match(html, /value="loc-branch" selected/);
  assert.match(html, /Ana &amp; Merkez/);
  assert.match(html, /data-detail-action="approve-stock"/);
  assert.match(html, /data-detail-action="reject-shipment"/);
  assert.doesNotMatch(html, /aria-disabled="true"/);
});

test("karar yetkisi olmayan tamamlanmış arşiv kaydı mevcut salt okunur görünümü korur", () => {
  const render = approvalRenderer([{ id: "loc-main", name: "Ana Depo" }]);
  assert.equal(render({ canApprove: false, canReject: false, status: "onaylandı" }), "");
  assert.match(documents, /const approvalPanel = shipmentApprovalPanel\(shipment\)/);
  assert.match(documents, /<\/div>\$\{approvalPanel\}<div class="shipment-impact-summary">/);
});

test("depo yoksa stok onayı güvenli biçimde devre dışı kalır, red eylemi kullanılabilir", () => {
  const html = approvalRenderer([])({ canApprove: true, canReject: true });
  assert.match(html, /data-detail-action="approve-stock"[^>]*disabled aria-disabled="true"/);
  assert.match(html, /data-detail-action="reject-shipment"/);
  assert.match(html, /kullanılabilir bir stok deposu tanımlanmalıdır/);
});

test("bildirim deep-link'i boş bağlamda depo referanslarını gerçekten bekleyip sonra sevkiyatı açar", async () => {
  const { state, assign } = stockReferenceAssigner(null);
  const steps = [];
  let releaseReferences;
  const referencesReady = new Promise((resolve) => { releaseReferences = resolve; });
  const shipment = { id: "shipment-deep-link", canApprove: true, canReject: true, items: [] };
  const loadDetail = shipmentDetailLoader({
    state,
    api: async () => { steps.push("shipment-loaded"); return { shipment, documents: [] }; },
    updateRevision: () => { steps.push("revision-updated"); },
    loadStockReferences: async (force) => {
      steps.push(`references-started:${force}`);
      await referencesReady;
      assign({
        stockProducts: [{ id: "product-1", name: "Su" }],
        stockLocations: [{ id: "workshop", name: "Bakım Atölyesi" }, { id: "general", name: "Genel Depo" }],
        unitDefinitions: { base: ["adet"], bulk: ["koli"] }
      });
      steps.push("references-assigned");
    }
  });

  let settled = false;
  const pendingDetail = loadDetail(shipment.id).then((payload) => { settled = true; steps.push("detail-ready"); return payload; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "detay depo referansı tamamlanmadan hazır olmamalı");
  assert.deepEqual(steps, ["shipment-loaded", "revision-updated", "references-started:true"]);
  releaseReferences();
  const payload = await pendingDetail;
  assert.equal(payload.shipment.id, shipment.id);
  assert.deepEqual(state.context.stockLocations.map((location) => location.id), ["workshop", "general"]);
  assert.deepEqual(steps, ["shipment-loaded", "revision-updated", "references-started:true", "references-assigned", "detail-ready"]);
  assert.match(approvalRenderer(state.context.stockLocations)(shipment), /Bakım Atölyesi[\s\S]*Genel Depo/);

  const loaderStart = app.indexOf('documents: () => Promise.all([');
  const loaderEnd = app.indexOf(']),', loaderStart);
  const documentsLoader = app.slice(loaderStart, loaderEnd);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart);
  assert.match(documentsLoader, /loadStockReferences\(force\)/);
});

test("ilk görünüm hatası intent'i temizlemez ve sevkiyat detayına devam etmez", async () => {
  const calls = [];
  const intent = { view: "documents", entityType: "shipment", entityId: "shipment-deep-link" };
  const state = { activeView: "dashboard", productAnalysis: {} };
  const run = initialIntentRunner({
    state,
    consumeOpenIntent: () => intent,
    setView: async (_view, options) => { calls.push(["view", options]); return false; },
    openShipment: async () => { calls.push(["shipment"]); return true; },
    cleanFaturaUrl: () => calls.push(["clean"])
  });
  assert.equal(await run(), false);
  assert.deepEqual(calls, [["view", { preserveUrl: true }]]);

  calls.length = 0;
  const runDetailFailure = initialIntentRunner({
    state: { activeView: "dashboard", productAnalysis: {} },
    consumeOpenIntent: () => intent,
    setView: async () => { calls.push(["view"]); return true; },
    openShipment: async () => { calls.push(["shipment"]); return false; },
    cleanFaturaUrl: () => calls.push(["clean"])
  });
  assert.equal(await runDetailFailure(), false);
  assert.deepEqual(calls, [["view"], ["shipment"]]);
});

test("arşiv onay paneli mevcut Muhasebe mutasyonlarına bağlıdır", () => {
  assert.match(app, /action === "approve-stock"[\s\S]*approveStock\(button, detail\.id\)/);
  assert.match(app, /action === "reject-shipment"[\s\S]*rejectShipment\(button, detail\.id\)/);
  assert.match(app, /getElementById\("shipmentDestinationLocation"\)\?\.value/);
  assert.match(app, /\/shipments\/\$\{encodeURIComponent\(id\)\}\/approve-stock/);
  assert.match(app, /\/shipments\/\$\{encodeURIComponent\(id\)\}\/reject/);
});

test("personel stok bildirimi cari gerektirmediğinde başarı mesajı ve nötr arşiv durumu gösterilir", () => {
  assert.match(app, /payload\.accountingStatus === "not_required"[\s\S]*Stok onaylandı; bu personel bildirimi için cari işlem gerekmiyor/);
  assert.match(documents, /shipment\.accountingStatus==="not_required"\)return "Cari işlem gerekmiyor"/);
  assert.match(documents, /shipment\.accountingStatus !== "not_required" && shipment\.financial/);
  assert.match(accounting, /shipment\.accountingStatus === "not_required"[\s\S]*Cari işlem gerekmiyor/);
  assert.match(stateSource, /not_required: \["Cari gerekmiyor", "is-muted"\]/);
  assert.match(receipts, /\["posted", "not_required"\]\.includes\(shipment\.accountingStatus\)/);
});

test("entegre modül grafiği tek Yönetici kabuğunda aynı sürüm sözleşmesini kullanır", () => {
  const graphVersion = "20261005-storage-placement-v1";
  assert.match(indexHtml, /\/yonetici\/modules\/tedarik-muhasebe\/scripts\/app\.js\?v=20261007-catalog-barcode-v3/);
  assert.match(indexHtml, /class="fatura-page is-embedded"/);
  assert.doesNotMatch(indexHtml, /manifest\.webmanifest|data-pwa-worker/);
  assert.equal(fs.existsSync(path.join(moduleRoot, "sw.js")), false);
  for (const source of [app, documents, accounting, receipts, dashboard, suppliers, stock, productAnalysis]) {
    if (!/state\.js\?v=/.test(source)) continue;
    assert.match(source, new RegExp(`state\\.js\\?v=${graphVersion}`));
    assert.doesNotMatch(source, /state\.js\?v=20260920-notification-center-v1/);
  }
});

test("onay paneli tema tokenlarını ve mobil tek sütun düzenini kullanır", () => {
  const start = styles.indexOf(".shipment-approval-panel{");
  const end = styles.indexOf(".shipment-receipt-meta{", start);
  const panelStyles = styles.slice(start, end);
  assert.ok(start >= 0 && end > start);
  for (const token of ["--panel-primary", "--panel-line", "--panel-surface", "--panel-ink", "--panel-muted"]) {
    assert.ok(panelStyles.includes(`var(${token})`), `${token} kullanılmalı`);
  }
  assert.doesNotMatch(panelStyles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(styles, /@media\(max-width:620px\)\{\.shipment-approval-panel__controls\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.shipment-approval-panel__actions \.ui-button\{width:100%\}/);
});
