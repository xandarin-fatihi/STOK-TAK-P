"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const adminHtml = read("YÖNETİCİ PANELİ/HTML/index.html");
const adminJs = read("YÖNETİCİ PANELİ/JS/app.js");

test("kaldırılan yönetici sekmeleri menü, tanıtım kartları ve kısayollarda bulunmaz", () => {
  for (const section of ["transfers", "counts", "critical", "labels", "procurementInvoices", "procurementDeliveryNotes", "procurementPayments", "permissions", "dataCenter", "procurementDocumentImages", "procurementLedger", "procurementReversals", "procurementSuppliers", "procurementProducts"]) {
    assert.ok(!adminHtml.includes(`data-panel-section="${section}"`));
    assert.ok(!adminHtml.includes(`data-section-panel="${section}"`));
    assert.ok(!adminJs.includes(`data-overview-section="${section}"`));
  }
  assert.equal((adminHtml.match(/data-panel-section=/g) || []).length, 7);
  for (const section of ["receipts", "shipments", "audit"]) {
    assert.ok(!adminHtml.includes(`data-panel-section="${section}"`));
    assert.ok(!adminJs.includes(`data-overview-section="${section}"`));
  }
  const nav = adminHtml.slice(adminHtml.indexOf('<nav class="panel-nav"'), adminHtml.indexOf('</nav>', adminHtml.indexOf('<nav class="panel-nav"')));
  assert.doesNotMatch(nav, /panel-nav-group|<details|Tedarik ve muhasebe/);
  const sections = [...nav.matchAll(/data-panel-section="([^"]+)"/g)].map(match => match[1]);
  assert.equal(sections.indexOf("staffAccess"), sections.indexOf("approvals") + 1);
  assert.match(adminHtml, /id="dataImportCenter" hidden inert aria-hidden="true"/);
  const definitions = adminJs.slice(adminJs.indexOf("const SECTION_TITLES"), adminJs.indexOf("const PANEL_THEME"));
  assert.doesNotMatch(definitions, /^\s*(transfers|counts|critical|labels|procurementInvoices|procurementDeliveryNotes|procurementPayments|permissions|dataCenter|procurementDocumentImages|procurementLedger|procurementReversals|procurementSuppliers|procurementProducts):/m);
  assert.match(adminHtml, /scripts\/app\.js\?v=20261007-catalog-barcode-v3/);
  assert.match(read("YÖNETİCİ PANELİ/PWA/sw.js"), /scripts\/app\.js\?v=20261007-catalog-barcode-v3/);
});

test("Ayarlar yalnız profil menüsünden açılır; ayar ekranı ve işlevleri korunur", () => {
  const navStart = adminHtml.indexOf('<nav class="panel-nav"');
  const nav = adminHtml.slice(navStart, adminHtml.indexOf('</nav>', navStart));
  assert.doesNotMatch(nav, /data-panel-section="settings"|>Ayarlar</);
  assert.equal((adminHtml.match(/data-admin-profile-action="settings"/g) || []).length, 1);
  assert.match(adminHtml, /id="panelSettingsCard" data-section-panel="settings"/);
  const handler = adminJs.slice(adminJs.indexOf("function handleAdminProfileAction("), adminJs.indexOf("function toggleSidebar("));
  const calls = [];
  const context = { closeAdminProfileMenu() {}, setActiveSection: (...args) => calls.push(args), logoutAdminSession() {} };
  vm.createContext(context); vm.runInContext(handler, context);
  context.handleAdminProfileAction({ target: { closest: () => ({ dataset: { adminProfileAction: "settings" } }) } });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "settings");
});

test("eski son sekmeler ve kart yer imleri boş ekrana değil Depoya yönlenir", () => {
  const titles = adminJs.slice(adminJs.indexOf("const SECTION_TITLES"), adminJs.indexOf("const SECTION_DESCRIPTIONS"));
  const normalize = adminJs.slice(adminJs.indexOf("function normalizePanelSection("), adminJs.indexOf("function setActiveSection("));
  const resolve = vm.runInNewContext(`${titles}\n${normalize}\nnormalizePanelSection`);
  for (const alias of ["stockMovements", "transfers", "counts", "critical", "transfersCard", "countsCard", "criticalStockCard"]) assert.equal(resolve(alias), "barcode");
  assert.equal(resolve("category"), "product");
  for (const alias of ["labels", "labelCreationCard"]) assert.equal(resolve(alias), "product");
  for (const alias of ["notifications", "notificationCenterCard"]) assert.equal(resolve(alias), "overview");
  for (const alias of ["procurementInvoices", "procurementDeliveryNotes", "procurementDocumentImages"]) assert.equal(resolve(alias), "procurementDocuments");
  for (const alias of ["audit", "procurementPayments", "procurementLedger", "procurementReversals"]) assert.equal(resolve(alias), "procurementDocuments");
  for (const alias of ["procurementSuppliers", "procurementProducts"]) assert.equal(resolve(alias), "overview");
  for (const alias of ["permissions", "dataCenter", "dataImportCenter"]) assert.equal(resolve(alias), "overview");
  for (const section of ["barcode", "locations", "product", "approvals", "overview"]) assert.equal(resolve(section), section);
  assert.equal(resolve("unknown"), "");
});

test("depo ve personel içindeki stok işlevleri korunur", () => {
  const moduleHtml = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/index.html");
  for (const id of ["stockHistoryAccordion", "stockTransferDialog", "stockCountDialog", "stockPlanningAccordion"]) assert.ok(moduleHtml.includes(`id="${id}"`));
  const personelHtml = read("PERSONEL/index.html");
  assert.match(personelHtml, /data-section="stock"/);
  assert.match(personelHtml, /Genel Bakış/);
});
