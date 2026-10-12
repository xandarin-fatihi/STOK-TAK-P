"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { normalizeStockState } = require("../src/store/migrations");
const lookup = require("../../JS/stock-lookup");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("PERSONEL/index.html");
const shell = read("PERSONEL/personel.js");
const css = read("PERSONEL/personel-locator.css");
const worker = read("PERSONEL/sw.js");
const app = read("ORTAK/API/src/app.js");
const routes = read("ORTAK/API/src/stock-location-routes.js");

function isolatedState() {
  return {
    schemaVersion: 3,
    locationMigrationVersion: 1,
    categories: [{ id: "parts", name: "Parçalar", active: true }],
    products: [{
      id: "bearing", name: "Rulman 6204", productCode: "RLM-6204", categoryId: "parts",
      baseUnit: "adet", unit: "adet", barcode: "00012345600012",
      barcodes: [
        { value: "09506000134352", verified: true, kind: "case", unit: "koli", quantity: 12 },
        { value: "UNVERIFIED-1", verified: false, kind: "single", unit: "adet", quantity: 1 }
      ],
      alternativeBarcodes: ["ALT-0007"], active: true
    }],
    locations: [
      { id: "workshop-a", code: "ATOLYE", name: "Atölye A", type: "workshop", personnelVisible: true, photoUrl: "/media/location-a.webp", assignedPersonnelIds: ["person-1"], active: true, isDefault: true },
      { id: "workshop-b", code: "GENEL", name: "Atölye B", type: "central", personnelVisible: true, imageUrl: "/media/location-b.webp", assignedPersonnelIds: ["person-1"], active: true }
    ],
    balances: [
      { locationId: "workshop-a", productId: "bearing", quantity: 4, cabinet: "Dolap A", shelf: "Raf 2", bin: "Bölme 1", placementName: "Raf A-02 · 2. bölme", placementPhotoUrl: "/media/bearing-a.webp" },
      { locationId: "workshop-b", productId: "bearing", quantity: 3, cabinet: "", shelf: "Raf 5", compartment: "Bölme 4" }
    ],
    movements: []
  };
}

test("Personel menüsü Yeni Ürün yerine aynı sırada Malzeme Nerede bölümünü kullanır", () => {
  const labels = [...html.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Genel Bakış", "Stok", "Malzeme Nerede?", "Malzeme Talebi", "İzin Talebi", "Sevkiyat", "Görevlerim"]);
  assert.match(html, /id="sectionMaterialLocation"[^>]*data-section-panel="materialLocation"/);
  assert.doesNotMatch(html, /id="sectionNewProduct"|Ürün Yönetimini Aç|href="\/yonetici\/\?section=product"/);
  assert.match(shell, /newProduct:\s*"materialLocation"/);
  assert.match(shell, /"new-product":\s*"materialLocation"/);
});

test("barkod ekranı kamera, fotoğraf, elle sorgu ve aynı sekmedeki sonuç alanını gerçek okuyucuya bağlar", () => {
  for (const id of ["barcodeCameraOpen", "barcodePhotoOpen", "barcodePhotoInput", "materialSearchInput", "materialSearchSubmit", "materialSearchResults", "barcodeScannerModal"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="barcodePhotoInput"[^>]*accept="image\/\*"/);
  assert.doesNotMatch(html, /id="barcodePhotoInput"[^>]*capture=|data-section="barcode"/);
  assert.match(shell, /facingMode:\s*\{ ideal:\s*"environment" \}/);
  assert.match(shell, /decodeFromConstraints/);
  assert.match(shell, /decodeFromImageUrl/);
  assert.match(shell, /no multi\\s\*format readers/);
  assert.match(shell, /Fotoğrafta okunabilir barkod bulunamadı/);
  assert.match(shell, /barcodeLookupInput\?\.addEventListener\("input", clearBarcodeDraftResult\)/);
  assert.match(shell, /receiveScannedBarcode[\s\S]*clearBarcodeDraftResult\(\)/);
  assert.match(shell, /stopBarcodeCamera\(\{ preserveMessage: true \}\)/);
  assert.match(shell, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(shell, /next !== "materialLocation"\) closeBarcodeScanner/);
  assert.doesNotMatch(shell, /setInterval\([^)]*(?:barcode|camera)/i);
  assert.match(app, /zxing-browser\.min\.js/);
  assert.match(html, /\/shared\/scripts\/zxing-browser\.min\.js\?v=0\.2\.1/);
});

test("kesin barkod eşleştirmesi baştaki sıfırları, alternatif ambalajı ve GS1 kimliğini korur", () => {
  const products = isolatedState().products.concat({
    id: "similar", name: "Rulman 6204 X", productCode: "RLM-6204-X", baseUnit: "adet", active: true,
    barcodes: [{ value: "OTHER-1", verified: true }]
  });
  assert.equal(lookup.lookupProduct(products, "00012345600012").product.id, "bearing");
  assert.equal(lookup.lookupProduct(products, "RLM-6204").product.id, "bearing");
  assert.equal(lookup.lookupProduct(products, "Rulman 6204").kind, "notFound");
  assert.equal(lookup.lookupProduct(products, "ALT-0007").product.id, "bearing");
  assert.equal(lookup.lookupProduct(products, "UNVERIFIED-1").kind, "notFound");
  const gs1 = "]C1010950600013435210LOT-7\u001d21SER-9";
  const parsed = lookup.parseGs1(gs1);
  assert.equal(parsed.productIdentifiers[0].value, "09506000134352");
  assert.equal(parsed.lot, "LOT-7");
  assert.equal(parsed.serial, "SER-9");
  const matched = lookup.lookupProduct(products, gs1);
  assert.equal(matched.product.id, "bearing");
  assert.deepEqual({ kind: matched.barcode.kind, unit: matched.barcode.unit, quantity: matched.barcode.quantity }, { kind: "case", unit: "koli", quantity: 12 });
});

test("barkod çakışması veya konum barkodu sessizce ürüne dönüştürülmez", () => {
  const shared = { value: "COLLISION-1", verified: true };
  const products = [
    { id: "a", productCode: "PRD-A", barcodes: [shared], active: true },
    { id: "b", productCode: "PRD-B", barcodes: [shared], active: true }
  ];
  assert.equal(lookup.lookupProduct(products, "COLLISION-1").kind, "ambiguous");
  assert.equal(lookup.lookupProduct(products, "SHELF-01", [{ id: "l1", barcodeValue: "SHELF-01" }]).kind, "location");
  assert.equal(lookup.lookupProduct(products, "UNKNOWN-1").kind, "notFound");
});

test("barkod, konum fotoğrafı ve ürün-konum raf alanları geriye uyumlu ve idempotent normalize edilir", () => {
  const once = normalizeStockState(isolatedState());
  const twice = normalizeStockState(once);
  const product = once.products.find((item) => item.id === "bearing");
  assert.equal(product.barcode, "00012345600012");
  assert.equal(product.barcodes.find((item) => item.value === "09506000134352").quantity, 12);
  assert.equal(product.barcodes.find((item) => item.value === "UNVERIFIED-1").verified, false);
  assert.ok(product.alternativeBarcodes.includes("ALT-0007"));
  assert.equal(once.locations.find((item) => item.id === "workshop-b").photoUrl, "/media/location-b.webp");
  assert.equal(once.balances.find((item) => item.locationId === "workshop-a").placementName, "Raf A-02 · 2. bölme");
  assert.equal(once.balances.find((item) => item.locationId === "workshop-a").placementPhotoUrl, "/media/bearing-a.webp");
  assert.deepEqual(
    once.balances.filter((item) => item.productId === "bearing").map((item) => [item.locationId, item.quantity, item.cabinet, item.shelf, item.bin]),
    [["workshop-a", 4, "Dolap A", "Raf 2", "Bölme 1"], ["workshop-b", 3, "", "Raf 5", "Bölme 4"]]
  );
  assert.deepEqual(twice.products, once.products);
  assert.deepEqual(twice.locations, once.locations);
  assert.deepEqual(twice.balances, once.balances);
});

test("Malzeme Nerede ve ortak konum kartı salt okunur, erişilebilir ve aynı stok kaynağına bağlıdır", () => {
  for (const id of ["materialSearchInput", "materialCategoryFilter", "materialInStockFilter", "materialSearchResults", "materialLocationModal", "materialLocationContent", "materialLocationClose"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(shell, /productMatchesSearch\(product, state\.materialQuery\)/);
  assert.match(shell, /state\.stock\.locationBalances/);
  assert.match(shell, /Yeri belirlenmedi/);
  assert.match(shell, /balance && balance\.placementPhotoUrl|balance\.placementPhotoUrl/);
  assert.match(shell, /Konum fotoğrafı kayıtlı değil/);
  assert.doesNotMatch(shell, /location && \(location\.photoUrl \|\| location\.locationPhotoUrl\)/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /trapStockModalFocus/);
  assert.doesNotMatch(html.slice(html.indexOf('id="sectionMaterialLocation"'), html.indexOf('id="sectionStock"')), /Eksilt|Yeni Ürün|yonetici/i);
  assert.match(routes, /accessibleLocationIds/);
  assert.match(routes, /locationBalances/);
  assert.match(routes, /personnelVisible !== false/);
  assert.match(routes, /assignedPersonnelIds/);
});

test("locator yüzeyleri dar ve geniş ekranlarda taşmadan PWA ile birlikte sürümlenir", () => {
  assert.match(css, /@media \(max-width:\s*1080px\)/);
  assert.match(css, /@media \(max-width:\s*720px\)/);
  assert.match(css, /@media \(max-width:\s*390px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /max-height:\s*calc\(100dvh - 16px\)/);
  for (const asset of [
    "/personel/personel-locator.css?v=20261004-locator-v2",
    "/personel/personel.js?v=20261005-storage-placement-v1",
    "/shared/scripts/zxing-browser.min.js?v=0.2.1",
    "/shared/scripts/stock-lookup.js?v=20261004-locator-v2"
  ]) {
    assert.ok(html.includes(asset), `${asset} HTML'de eksik`);
    assert.ok(worker.includes(asset), `${asset} service worker'da eksik`);
  }
});
