const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("sevkiyat geçmişi tam çalışma alanını kullanır ve mal kabul iki sütunlu merkezî modalda kalır", () => {
  const css = read("PERSONEL/personel-compact.css");

  assert.match(css, /\.personel-dashboard\[data-active-section="shipment"\] \.workforce-section\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s);
  assert.match(
    css,
    /\.personel-dashboard\[data-active-section="shipment"\] \.wf-shipment-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s
  );
  assert.match(
    css,
    /\.wf-receipt-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\);/s
  );
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.wf-receipt-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
});

test("gömülü reçete üst araçları ayrı satırlarda kalır ve iframe yatay taşma üretmez", () => {
  const css = read("PERSONEL/recete-embed/styles/recipe.css");
  const shellCss = read("PERSONEL/personel-compact.css");
  const embed = read("PERSONEL/recete-embed/index.html");
  const panel = read("PERSONEL/index.html");
  const worker = read("PERSONEL/sw.js");

  assert.match(css, /body\.is-personel-embed\s*\{[^}]*overflow-x:\s*hidden;/s);
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-header\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*grid-template:\s*"tools"\s+auto\s+"tabs"\s+auto\s*\/\s*minmax\(0,\s*1fr\);[^}]*row-gap:\s*10px;/s
  );
  assert.match(css, /body\.is-personel-embed \.recipe-topbar\s*\{[^}]*display:\s*none\s*!important;/s);
  assert.match(css, /body\.is-personel-embed \.recipe-tabs\s*\{[^}]*min-height:\s*44px;[^}]*padding:\s*0\s+0\s+4px;/s);
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-search\s*\{[^}]*height:\s*44px;[^}]*min-height:\s*44px;/s
  );
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-search input\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s
  );
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-search\s*\{[^}]*border:\s*0\s*!important;[^}]*background:\s*transparent\s*!important;[^}]*box-shadow:\s*none\s*!important;/s
  );
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-search input\s*\{[^}]*border:\s*1px\s+solid\s+var\(--panel-line\);[^}]*border-radius:\s*14px;[^}]*background:\s*var\(--panel-surface\);/s
  );
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-shell\s*\{[^}]*background:\s*transparent\s*!important;/s
  );
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-header\s*\{[^}]*border:\s*0\s*!important;[^}]*background:\s*transparent\s*!important;[^}]*box-shadow:\s*none\s*!important;[^}]*backdrop-filter:\s*none;/s
  );
  assert.match(
    css,
    /body\.is-personel-embed \.recipe-tabs::\-webkit-scrollbar\s*\{[^}]*display:\s*none;[^}]*height:\s*0;/s
  );
  assert.match(css, /body\.is-personel-embed \.recipe-grid\s*\{[^}]*repeat\(auto-fit,\s*minmax\(min\(100%,\s*260px\),\s*1fr\)\)/s);
  assert.match(
    shellCss,
    /\.personel-dashboard\[data-active-section="recipe"\] \.personel-workspace\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/s
  );
  assert.match(
    shellCss,
    /\.personel-dashboard\[data-active-section="recipe"\] \.recipe-section\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;/s
  );
  assert.match(embed, /recipe\.css\?v=20260929-recipe-surface-v3/);
  assert.match(panel, /personel-compact\.css\?v=20261004-shipment-receipt-v3/);
  assert.match(worker, /personel-compact\.css\?v=20261004-shipment-receipt-v3/);
  assert.match(worker, /recete-embed\/styles\/recipe\.css\?v=20260929-recipe-surface-v3/);
});

test("personel sidebar 881-980px aralığında legacy yatay akışa dönmez", () => {
  const css = read("PERSONEL/personel-compact.css");

  assert.match(
    css,
    /\.personel-dashboard\s*\{[^}]*transition:\s*grid-template-columns\s+180ms\s+ease;/s
  );
  assert.match(
    css,
    /\.personel-dashboard \.personel-sidebar\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto;[^}]*grid-auto-flow:\s*row;[^}]*align-items:\s*stretch;/s
  );
  assert.match(
    css,
    /\.personel-dashboard \.personel-nav\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-auto-flow:\s*row;/s
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*880px\)\s*\{[\s\S]*?\.personel-dashboard \.personel-nav\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-auto-flow:\s*row;/s
  );
});

test("yönetici profil yüzeyi masaüstü alanını iki sütunda kullanıp dar ekranda tek sütuna iner", () => {
  const css = read("YÖNETİCİ PANELİ/CSS/admin-compact.css");
  const html = read("YÖNETİCİ PANELİ/HTML/index.html");
  const worker = read("YÖNETİCİ PANELİ/PWA/sw.js");

  assert.match(
    css,
    /\.admin-profile-workspace:not\(\[hidden\]\)\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1\.35fr\)\s+minmax\(320px,\s*\.65fr\);/s
  );
  assert.match(css, /\.admin-profile-workspace\s*>\s*\.admin-profile-actions\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)\s*\{[^}]*\.admin-profile-workspace:not\(\[hidden\]\)\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(html, /admin-compact\.css\?v=20260927-layout-polish-v1/);
  assert.match(worker, /admin-compact\.css\?v=20260927-layout-polish-v1/);
});
