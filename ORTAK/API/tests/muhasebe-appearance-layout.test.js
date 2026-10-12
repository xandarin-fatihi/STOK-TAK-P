"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE");
const html = fs.readFileSync(path.join(moduleRoot, "index.html"), "utf8");
const css = fs.readFileSync(path.join(moduleRoot, "styles", "muhasebe.css"), "utf8");
const script = fs.readFileSync(path.join(moduleRoot, "scripts", "app.js"), "utf8");
const documentsScript = fs.readFileSync(path.join(moduleRoot, "scripts", "documents.js"), "utf8");
const accountingScript = fs.readFileSync(path.join(moduleRoot, "scripts", "accounting.js"), "utf8");
const adminHtml = fs.readFileSync(path.join(root, "YÖNETİCİ PANELİ", "HTML", "index.html"), "utf8");
const adminScript = fs.readFileSync(path.join(root, "YÖNETİCİ PANELİ", "JS", "app.js"), "utf8");

test("tedarik ve muhasebe yalnız Yönetici içinde gömülü bir modüldür", () => {
  assert.match(html, /<body class="fatura-page is-embedded">/);
  assert.match(html, /\/yonetici\/modules\/tedarik-muhasebe\/scripts\/app\.js/);
  assert.doesNotMatch(html, /manifest\.webmanifest|data-pwa-worker|theme-settings\.js/);
  for (const file of ["manifest.webmanifest", "offline.html", "sw.js", "sw-20260927.js"]) {
    assert.equal(fs.existsSync(path.join(moduleRoot, file)), false, `${file} bağımsız panel kalıntısı olmamalı`);
  }
});

test("gömülü modül ikinci kabuğu ve yinelenen başlığı göstermez", () => {
  assert.match(css, /body\.is-embedded :is\(\.fatura-auth,\.fatura-sidebar,\.sidebar-scrim,\.fatura-header/);
  assert.match(css, /body\.is-embedded \.stock-location-workspace__head \{ display: none; \}/);
  assert.match(css, /body\.is-embedded \.content-view\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
});

test("üst seviye içerik kartları ikinci bir kart çerçevesi oluşturmaz", () => {
  assert.match(css, /body\.is-embedded \.content-view > \.panel-card,[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/);
  assert.match(css, /body\.is-embedded \.content-view > \.empty-state/);
});

test("Yönetici iframe köprüsü görünüm, tema ve yüksekliği tek kabukta eşler", () => {
  assert.match(adminHtml, /id="procurementModuleHost"/);
  assert.match(adminScript, /source:\s*"menu-suite:admin"/);
  assert.match(adminScript, /type:\s*"view"/);
  assert.match(script, /source:\s*"menu-suite:procurement"/);
  assert.match(script, /message\.type === "theme"/);
  assert.match(script, /message\.type !== "view"/);
  assert.match(script, /postEmbeddedMessage\("height"/);
});

test("entegre stok sekmeleri eski kafe ürün formunu veya fiyat modülünü çalıştırmaz", () => {
  assert.match(adminScript, /function scopesForSection\(section\) \{\s*if \(Object\.prototype\.hasOwnProperty\.call\(PROCUREMENT_SECTION_VIEWS, section\)\) return \[\];/);
  assert.match(adminScript, /function ensureSectionModule\(section\) \{\s*if \(Object\.prototype\.hasOwnProperty\.call\(PROCUREMENT_SECTION_VIEWS, section\)\) return Promise\.resolve\(\);/);
  assert.match(adminScript, /const procurementActive = Object\.prototype\.hasOwnProperty\.call\(PROCUREMENT_SECTION_VIEWS, active\);[\s\S]*?if \(!procurementActive\) \{[\s\S]*?renderForms\(\);/);
});

test("entegre muhasebe sekmeleri kendi veri görünümlerini kullanır", () => {
  assert.doesNotMatch(adminScript, /approvals:\s*"receipts"/);
  assert.match(adminScript, /receipts:\s*"receipts"/);
  assert.match(adminScript, /receipts:\s*"receipts"/);
  assert.match(script, /id:\s*"receipts",\s*dataView:\s*"shipments"/);
  assert.match(script, /shipments:\s*renderShipments/);
  assert.match(documentsScript, /state\.activeView === "shipmentArchive"/);
  assert.match(documentsScript, /view === "invoices" && document\.documentType !== "fatura"/);
  assert.match(documentsScript, /view === "deliveryNotes" && document\.documentType !== "irsaliye"/);
  assert.match(documentsScript, /view === "documentImages"/);
  assert.match(accountingScript, /state\.activeView === "payments"/);
  assert.match(accountingScript, /state\.activeView === "reversals"/);
  assert.match(accountingScript, /Ödeme kaydı bulunamadı/);
  assert.match(accountingScript, /Ters kayıt bulunamadı/);
});
