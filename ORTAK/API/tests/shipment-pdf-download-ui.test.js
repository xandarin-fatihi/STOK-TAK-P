"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE");
const documents = fs.readFileSync(path.join(moduleRoot, "scripts", "documents.js"), "utf8");
const app = fs.readFileSync(path.join(moduleRoot, "scripts", "app.js"), "utf8");
const html = fs.readFileSync(path.join(moduleRoot, "index.html"), "utf8");
const pwaRuntime = fs.readFileSync(path.join(root, "ORTAK", "JS", "pwa-sw-runtime.js"), "utf8");
const pdfModulePath = path.join(moduleRoot, "scripts", "shipment-pdf.mjs");

function sourceSection(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `${startToken} bulunamadı`);
  assert.notEqual(end, -1, `${endToken} bulunamadı`);
  return source.slice(start, end);
}

async function pdfModule() {
  return import(pathToFileURL(pdfModulePath).href);
}

function sampleShipment(itemCount = 2) {
  return {
    id: "shipment-technical-id-must-not-be-visible",
    shipmentNumber: "SVK-2026-000123",
    shipmentDate: "2026-09-27",
    createdAt: "2026-09-27T16:42:58.000Z",
    supplier: { name: "Örnek Parça Tedarikçisi" },
    destinationLocationName: "Bakım Atölyesi",
    items: Array.from({ length: itemCount }, (_value, index) => ({
      name: `Ürün ${index + 1} · Şeftali`,
      quantityBulk: index + 1,
      bulkUnitSnapshot: "koli",
      baseUnitSnapshot: "adet",
      quantityBase: 0,
      unitPriceKurus: 12550 + index,
      totalKurus: (12550 + index) * (index + 1)
    }))
  };
}

test("sevkiyat numarası okunabilir kalır; legacy yedek değer teknik kimliği dışarı çıkarmaz", async () => {
  const pdf = await pdfModule();
  assert.equal(pdf.resolveShipmentNumber(sampleShipment()), "SVK-2026-000123");
  const legacy = pdf.resolveShipmentNumber({ id: "shipment-7fd25ad5", createdAt: "2026-09-27T10:00:00Z" });
  assert.match(legacy, /^SVK-ESKI-20260927-[A-Z0-9]{7}$/);
  assert.doesNotMatch(legacy, /shipment|7fd25/i);
  assert.equal(pdf.resolveShipmentNumber({ id: "same", createdAt: "2026-09-27" }), pdf.resolveShipmentNumber({ id: "same", createdAt: "2026-09-27" }));
});

test("PDF adı sevkiyat numarası, güvenli tedarikçi adı ve gerçek gün içerir", async () => {
  const pdf = await pdfModule();
  const fileName = pdf.shipmentPdfFileName(sampleShipment());
  assert.equal(fileName, "SVK-2026-000123_Ornek-Parca-Tedarikcisi_27.09.2026.pdf");
  assert.doesNotMatch(fileName, /[<>:"/\\|?*]/);
  assert.doesNotMatch(pdf.formatShipmentPdfDate("2026-09-27"), /\d{2}:\d{2}/, "yalnız tarih alanına uydurma saat eklenmemeli");
  assert.match(pdf.formatShipmentPdfDate("2026-09-27T16:42:58+03:00"), /\d{2}:\d{2}/);
});

test("aktif panel rengi yazdırılabilir açık zemine taşınır ve metin kontrastı korunur", async () => {
  const pdf = await pdfModule();
  const light = pdf.createPrintPaletteSnapshot({
    "--panel-primary": "#2E4A7D", "--panel-accent": "#627FB7", "--panel-surface": "#FFFFFF",
    "--panel-ink": "#1E293B", "--panel-muted": "#607089", "--panel-on-primary": "#FFFFFF"
  });
  const dark = pdf.createPrintPaletteSnapshot({
    "--panel-primary": "#AFC4EF", "--panel-accent": "#9EB8E9", "--panel-surface": "#171C28",
    "--panel-ink": "#EDF0F6", "--panel-muted": "#B9C1CF", "--panel-on-primary": "#10141C"
  });
  assert.equal(light.primary, "#2e4a7d");
  assert.ok(pdf.colorContrastRatio(light.ink, light.page) >= 7);
  assert.ok(pdf.colorContrastRatio(light.muted, light.page) >= 4.5);
  assert.ok(pdf.colorContrastRatio(light.onPrimary, light.primary) >= 4.5);
  assert.ok(pdf.colorContrastRatio(dark.page, "#ffffff") < 1.2, "karanlık tema PDF kâğıdını koyulaştırmamalı");
  assert.ok(pdf.colorContrastRatio(dark.ink, dark.page) >= 7);
});

test("vektör PDF gömülü font, seçilebilir Unicode metin ve çok sayfalı satır düzeni üretir", async () => {
  const pdf = await pdfModule();
  assert.deepEqual(pdf.paginateShipmentRows([], 10), [[]]);
  assert.deepEqual(pdf.paginateShipmentRows(Array.from({ length: 11 }, (_, index) => index), 10).map((page) => page.length), [10, 1]);
  const fonts = {
    regular: fs.readFileSync(path.join(root, "ORTAK", "ASSETS", "FONTS", "poppins-regular.ttf")),
    semibold: fs.readFileSync(path.join(root, "ORTAK", "ASSETS", "FONTS", "poppins-semibold.ttf"))
  };
  const result = await pdf.buildShipmentPdfBytes(sampleShipment(11), { fonts });
  const source = Buffer.from(result.bytes).toString("latin1");
  assert.equal(result.pageCount, 2);
  assert.equal(result.shipmentNumber, "SVK-2026-000123");
  assert.ok(Buffer.from(result.bytes.subarray(0, 8)).toString("ascii").startsWith("%PDF-1.7"));
  assert.match(source, /\/ToUnicode\s+\d+\s+0\s+R/);
  assert.match(source, /\/FontFile2\s+\d+\s+0\s+R/);
  assert.match(source, /\/Lang \(tr-TR\)/);
  assert.match(source, /\/Count 2/);
  assert.doesNotMatch(source, /shipment-technical-id-must-not-be-visible/);
});

test("tarayıcı indirme yolu yeni vektör üreticisini, zaman aşımını ve tamamlanma bilgisini kullanır", () => {
  const print = sourceSection(documents, "export async function printShipmentArchive", "\nasync function fetchOptionalEvidence");
  const evidence = sourceSection(documents, "async function fetchOptionalEvidence", "\nfunction renderReceiptPages");
  const download = sourceSection(app, "async function downloadShipmentPdf", "\nasync function performLogout");
  assert.match(print, /createPrintPaletteSnapshot\(\)/);
  assert.match(print, /prepareShipmentEvidenceImage\(blob, 15000\)/);
  assert.match(print, /buildShipmentPdfBlob\(shipment/);
  assert.match(print, /shipmentPdfFileName\(shipment\)/);
  assert.doesNotMatch(print, /renderReceiptPages|canvasesToPdf/);
  assert.match(evidence, /timeoutMs = 8000/);
  assert.match(evidence, /controller\.abort\(\)/);
  assert.match(print, /catch \(_error\)[\s\S]*Fiş, ek belge erişilemese de indirilebilir kalır/);
  assert.match(print, /anchor\.download = fileName/);
  assert.match(print, /muhasebe:shipment-pdf-ready/);
  assert.match(print, /shipmentNumber: generated\.shipmentNumber/);
  assert.match(download, /setBusy\(button, true, "PDF Hazırlanıyor…"\)/);
  assert.match(download, /await printShipmentArchive\(shipmentId\)/);
  assert.match(download, /toast\(`\$\{result\.fileName\} indirildi\.`\)/);
  assert.match(download, /catch \(error\)[\s\S]*toast\([\s\S]*true\)/);
  assert.match(download, /finally[\s\S]*setBusy\(button, false\)/);
});

test("entegre PDF modülleri ve fontları Yönetici içi sürüm sözleşmesini kullanır", () => {
  const pdfVersion = "20260927-shipment-number-theme-pdf-v2";
  assert.match(app, /documents\.js\?v=20261001-integrated-tabs-v1/);
  assert.match(documents, new RegExp(`shipment-pdf\\.mjs\\?v=${pdfVersion}`));
  assert.match(html, /\/yonetici\/modules\/tedarik-muhasebe\/styles\/muhasebe\.css\?v=20261005-embedded-responsive-v1/);
  assert.match(html, /\/yonetici\/modules\/tedarik-muhasebe\/scripts\/app\.js\?v=20261007-catalog-barcode-v3/);
  assert.doesNotMatch(html, /theme-settings\.js|data-pwa-worker|manifest\.webmanifest/);
  assert.equal(fs.existsSync(path.join(moduleRoot, "sw-20260927.js")), false);
  assert.match(pwaRuntime, /function canonicalCacheKey\(url\) \{\s*return new Request\(`\$\{url\.origin\}\$\{url\.pathname\}\$\{url\.search\}`/);
});
