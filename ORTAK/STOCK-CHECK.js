"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(projectRoot, ...parts), "utf8");
const clean = (value) => value.replace(/&amp;/g, "&").trim();

const expectedPersonel = [
  "Genel Bakış", "Stok", "Malzeme Nerede?", "Malzeme Talebi", "İzin Talebi", "Sevkiyat", "Görevlerim"
];
const expectedYonetim = [
  "Genel Bakış", "Ürün yönetimi", "Depo", "Malzemenin Yeri",
  "Talepler", "Personel",
  "Belgeler"
];
const expectedMuhasebe = [
  "Tedarikçiler", "Tedarikçi ürünleri", "Mal kabul", "Belgeler", "Faturalar", "İrsaliyeler",
  "Sevkiyat arşivi", "Cari hareketler", "Ödemeler", "Ters kayıtlar",
  "Belge görselleri", "Yetkilendirme", "İşlem geçmişi"
];

const personelHtml = read("PERSONEL", "index.html");
const yonetimHtml = read("YÖNETİCİ PANELİ", "HTML", "index.html");
const muhasebeHtml = read("YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE", "index.html");
const muhasebeApp = read("YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE", "scripts", "app.js");
const serverApp = read("ORTAK", "API", "src", "app.js");

const personelNav = personelHtml.slice(personelHtml.indexOf("<nav"), personelHtml.indexOf("</nav>"));
const yonetimNavStart = yonetimHtml.indexOf('<nav class="panel-nav"');
const yonetimNav = yonetimHtml.slice(yonetimNavStart, yonetimHtml.indexOf("</nav>", yonetimNavStart));
const accountingDefinitions = muhasebeApp.slice(muhasebeApp.indexOf("const viewDefinitions"), muhasebeApp.indexOf("let visibleViews"));

const personelLabels = [...personelNav.matchAll(/data-section="[^"]+"[^>]*>[\s\S]*?<span class="nav-label">([^<]+)<\/span>/g)].map((match) => clean(match[1]));
const yonetimLabels = [...yonetimNav.matchAll(/data-panel-section="[^"]+"[^>]*>[\s\S]*?<span class="panel-nav-label">([^<]+)<\/span>/g)].map((match) => clean(match[1]));
const muhasebeLabels = [...accountingDefinitions.matchAll(/label:\s*"([^"]+)"/g)].map((match) => clean(match[1]));

assert.deepEqual(personelLabels, expectedPersonel, "Personel sekmeleri tam ve doğru sırada olmalı.");
assert.deepEqual(yonetimLabels, expectedYonetim, "Yönetim sekmeleri tam ve doğru sırada olmalı.");
assert.deepEqual(muhasebeLabels.filter((label) => label !== "Stok"), expectedMuhasebe, "Entegre tedarik ve muhasebe görünümleri tam ve doğru sırada olmalı.");

assert.equal(fs.existsSync(path.join(projectRoot, "QR MENÜ")), false, "QR MENÜ hedef kopyada bulunmamalı.");
assert.equal(fs.existsSync(path.join(projectRoot, "MUHASEBE")), false, "Bağımsız MUHASEBE paneli hedef kopyada bulunmamalı.");
assert.equal(serverApp.includes("/qr-menu"), false, "Sunucuda QR menü rotası bulunmamalı.");
assert.equal(serverApp.includes('app.get("/muhasebe'), false, "Sunucuda bağımsız muhasebe rotası bulunmamalı.");
assert.match(personelHtml, /panel-foundation\.css/);
assert.match(personelHtml, /panel-theme\.js/);
assert.match(personelHtml, /id="personelSidebarToggle"/);
assert.match(personelHtml, /stock-tabs\.css/);
assert.match(yonetimHtml, /panel-foundation\.css/);
assert.match(yonetimHtml, /panel-theme\.js/);
assert.match(yonetimHtml, /id="sidebarToggle"/);
assert.match(yonetimHtml, /stock-management\.css/);
assert.match(muhasebeHtml, /panel-foundation\.css/);
assert.match(muhasebeHtml, /panel-theme\.js/);
assert.match(muhasebeHtml, /class="fatura-page is-embedded"/);
assert.match(muhasebeApp, /source:\s*"menu-suite:procurement"/);

console.log(`STOK doğrulaması tamam: Personel ${personelLabels.length}, Yönetim ${yonetimLabels.length}; ${expectedMuhasebe.length} tedarik/muhasebe görünümü Yöneticiye entegre.`);
