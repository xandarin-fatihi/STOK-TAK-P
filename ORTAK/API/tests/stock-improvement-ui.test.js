"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const stock = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/scripts/stock.js");

test("Konum görünümü katalog ve stok değişince yenilenir; bölüme yeniden girişte eski cache kullanılmaz", () => {
  const gateway = stock.slice(stock.indexOf("export function handleStockGatewayEvent"));
  assert.match(gateway, /state\.placementsLoaded = false/);
  assert.ok(gateway.indexOf("state.placementsLoaded = false") < gateway.indexOf('topic === "catalog"'));
  assert.match(stock, /section === "locations"[\s\S]*?await loadPlacements\(true\)/);
  const save = stock.slice(stock.indexOf("  async function savePlacement("), stock.indexOf("  async function savePlacement(") + 2300);
  assert.match(save, /await loadPlacements\(true\)/, "ortak plan kaydı aynı depodaki diğer kartları da güncellemeli");
});

test("Ortak plan görseli contain boşluklarından dolayı işareti kaydırmaz; doğal oran korunur", () => {
  const staff = read("PERSONEL/personel-stock-revision.css");
  const admin = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/styles/stock.css");
  assert.match(staff, /\.material-location-photo\.is-plan \.material-location-plan img\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;/);
  assert.match(staff, /\.material-location-photo \.stock-plan-marker\s*\{[^}]*padding:\s*0;[^}]*font-size:\s*30px;/);
  assert.match(admin, /body\.is-embedded \.stock-placement-photo__preview img\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*none;/);
});

test("Eksiltme başarısından sonra ikinci yanlış tıklama için miktar boş ve buton pasif olur", () => {
  const shell = read("PERSONEL/personel.js");
  assert.match(shell, /stockActionQuantity\.value = ""/);
  assert.match(shell, /stockActionSubmit\.disabled = true/);
  assert.match(shell, /Miktar 1 veya daha büyük bir tam sayı olmalı/);
});
