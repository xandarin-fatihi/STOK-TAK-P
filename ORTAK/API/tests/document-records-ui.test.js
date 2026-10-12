"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../..");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE");
const source = fs.readFileSync(path.join(moduleRoot, "scripts/app.js"), "utf8");
const handler = source.slice(source.indexOf("async function handleEmbeddedMessage(event)"), source.indexOf("function setupEmbeddedBridge()"));
function bridge({ allowed = true, loaded = true } = {}) {
  const calls = [];
  const parent = {};
  const context = vm.createContext({
    IS_EMBEDDED: true, window: { parent, location: { origin: "http://localhost:6075" } },
    visibleViews: [{ id: "documents" }], state: { activeView: "documents", stock: { intentSection: "procurementDocuments" } },
    pendingEmbeddedView: "", CAPABILITIES: { documentsRead: "documents.read" }, has: () => allowed,
    setView: async (view) => { calls.push(["view", view]); return loaded; },
    openDocument: async (id) => calls.push(["document", id]), stopCatalogBarcodeScanner: () => {}, closeDocumentHistory: () => calls.push(["history-close"]), closeDocumentScan: () => {},
  });
  vm.runInContext(handler, context);
  return { calls, send: (extra = {}) => context.handleEmbeddedMessage({ origin: "http://localhost:6075", source: parent, data: { source: "menu-suite:admin", type: "view", view: "documents", documentId: "test-doc", ...extra } }), context, parent };
}
test("yönetici bildirimi mevcut belgeyi açar; eski kimliği yeni sekmeye taşımaz", async () => {
  const b = bridge(); await b.send();
  assert.deepEqual(b.calls, [["view", "documents"], ["document", "test-doc"]]);
  await b.send({ documentId: "" });
  assert.equal(b.calls.filter((item) => item[0] === "document").length, 1);
});
test("başka sekmeye geçiş ve gizleme geçmiş kartını kapatır", async () => {
  const b = bridge();
  await b.send({ type: "suspend" });
  assert.deepEqual(b.calls, [["history-close"]]);
});
test("belge bildirim köprüsü origin, parent, görünüm yükleme ve okuma yetkisini korur", async () => {
  for (const options of [{ allowed: false }, { loaded: false }]) {
    const b = bridge(options); await b.send();
    assert.equal(b.calls.some((item) => item[0] === "document"), false);
  }
  const b = bridge();
  await b.context.handleEmbeddedMessage({ origin: "https://foreign.invalid", source: b.parent, data: { source: "menu-suite:admin", type: "view", view: "documents", documentId: "test-doc" } });
  await b.context.handleEmbeddedMessage({ origin: "http://localhost:6075", source: {}, data: { source: "menu-suite:admin", type: "view", view: "documents", documentId: "test-doc" } });
  assert.equal(b.calls.length, 0);
});
test("PDF önizlemesi lazy ve güvenlidir; sade kontrol çubuğu ve form grid'i korunur", () => {
  const pdf = fs.readFileSync(path.join(moduleRoot, "scripts/document-pdf-viewer.js"), "utf8");
  const records = fs.readFileSync(path.join(moduleRoot, "scripts/document-records.js"), "utf8");
  const css = fs.readFileSync(path.join(moduleRoot, "styles/document-records.css"), "utf8");
  assert.match(pdf, /library = import\(/);
  assert.match(pdf, /isEvalSupported:false/);
  assert.match(pdf, /rendering\?\.cancel\(\)/);
  assert.match(records, /print\.removeAttribute\("aria-disabled"\)/);
  assert.match(records, /\.hidden = pdf && pages\(\)\.length === 1/);
  assert.match(css, /\.doc-dialog form\.doc-editor-grid\{display:grid/);
  assert.match(css, /\.doc-dialog \[hidden\]\{display:none!important\}/);
});
