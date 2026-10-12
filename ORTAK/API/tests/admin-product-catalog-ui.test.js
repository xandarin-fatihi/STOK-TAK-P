"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { registerStockLocationRoutes } = require("../src/stock-location-routes");
const { createFileStore } = require("../src/store/file-store");
const { normalizeStockState } = require("../src/store/migrations");

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("yönetici ürün ve kategori yönetimi tek, sade ve responsive çalışma alanıdır", () => {
  const adminHtml = read("YÖNETİCİ PANELİ/HTML/index.html");
  const moduleHtml = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/index.html");
  const adminApp = read("YÖNETİCİ PANELİ/JS/app.js");
  const moduleApp = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/scripts/app.js");
  const stockJs = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/scripts/stock.js");
  const stockCss = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/styles/stock.css");
  const moduleCss = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/styles/muhasebe.css");
  const themeBootstrap = read("YÖNETİCİ PANELİ/JS/theme-bootstrap.js");
  const serviceWorker = read("YÖNETİCİ PANELİ/PWA/sw.js");

  assert.match(adminHtml, /data-panel-section="product"/);
  assert.doesNotMatch(adminHtml, /data-panel-section="category"/);
  assert.match(adminHtml, />Depo</);
  assert.match(adminHtml, />Malzemenin Yeri</);
  assert.doesNotMatch(adminHtml, /Barkod yönetimi|Konum yönetimi/i);
  assert.match(adminApp, /section === "category" \? "product"/);
  assert.match(adminApp, /panelSection=\$\{encodeURIComponent\(section\)\}/);
  assert.match(adminApp, /frame\.dataset\.section = section/);
  assert.match(moduleApp, /url\.searchParams\.get\("panelSection"\)/);
  assert.match(moduleApp, /section:stockIntent\?panelSection:""/);
  for (const id of [
    "stockCatalogSearch", "stockCatalogCategoryFilter", "stockCatalogAddProduct",
    "stockCatalogList", "stockCatalogProductDialog", "stockCatalogCategoryDialog", "stockCatalogImageFile",
    "stockPlacementWorkspace", "stockPlacementSearch", "stockPlacementLocationFilter", "stockPlacementDialog",
    "stockPlacementName", "stockPlacementPhotoFile", "stockPlacementCameraFile", "stockPlacementSave"
  ]) assert.match(moduleHtml, new RegExp(`id="${id}"`));
  assert.doesNotMatch(moduleHtml, /id="stockCatalogManageCategories"/);
  assert.doesNotMatch(moduleHtml, /id="stockCatalogBaseUnit"|id="stockCatalogBulkUnit"|id="stockCatalogUnitFactor"/);
  assert.doesNotMatch(moduleHtml, /id="stockUnitSettingsButton"/);
  assert.match(moduleHtml, /Ürün adı, kodu veya barkodu/);
  assert.match(moduleHtml, /Görsel sunucuda kalıcı saklanır/);
  assert.doesNotMatch(moduleHtml, /id="stockCatalogCategorySelect"/);
  assert.doesNotMatch(stockJs, /requestText/);
  assert.match(stockJs, /data-catalog-product-id/);
  assert.match(stockJs, /faturaApi\("\/api\/media"/);
  assert.match(stockJs, /if \(state\.catalogBusy \|\| state\.catalogUploading\) return/);
  assert.match(stockJs, /existingBarcodeRecords/);
  assert.match(stockJs, /existing \|\| \{ value, verified: true, kind: "single", unit: baseUnit, quantity: 1 \}/);
  assert.match(stockJs, /async function loadPlacements/);
  assert.match(stockJs, /admin-stock-placement/);
  assert.match(stockJs, /placementPhotoUrl/);
  assert.match(stockJs, /host\.replaceChildren\(\)/);
  assert.match(stockJs, /closeCatalogProductDialog\(\{ preserveDraft = true \}/);
  assert.match(stockCss, /stock-catalog-row__image img[^}]+object-fit:\s*contain/s);
  assert.match(stockCss, /stock-location-product__media img[^}]+object-fit:\s*contain/s);
  assert.match(stockCss, /stock-placement-dialog[^}]+width:\s*min\(680px/s);
  assert.ok(stockCss.includes('.stock-location-workspace[data-catalog-mode="true"] > :not(#stockOverviewWorkspace):not(dialog)'));
  assert.match(stockCss, /@media \(max-width:\s*680px\)[\s\S]+stock-catalog-category-layout/);
  assert.match(moduleCss, /body\.is-embedded\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
  assert.match(adminHtml, /scripts\/theme-bootstrap\.js\?v=20261005-csp-v1/);
  assert.doesNotMatch(adminHtml, /<script>\s*try\{document\.body\.dataset\.panelTheme/);
  assert.match(themeBootstrap, /document\.body\.dataset\.panelTheme/);
  assert.match(serviceWorker, /storage-placement-v5/);
  assert.match(serviceWorker, /embedded-responsive-v1-csp-v1/);
  assert.match(moduleApp, /window\.parent\.innerHeight - rect\.top/);
  assert.match(moduleApp, /removeEventListener\("scroll", syncEmbeddedViewport, true\)/);
  assert.match(moduleApp, /placementObserver\.disconnect\(\)/);
  assert.match(stockCss, /body\.is-embedded \.stock-placement-dialog[\s\S]+--embedded-visible-height/);
  assert.match(read("YÖNETİCİ PANELİ/CSS/admin-components.css"), /body\.stock-placement-open \.global-preview-trigger\s*\{\s*visibility: hidden/);
});

test("katalog servisi barkodu tek ürün kimliğiyle sınırlar ve baştaki sıfırları korur", async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "stok-catalog-barcode-"));
  const store = createFileStore(path.join(directory, "store.json"), {
    bcryptRounds: 4,
    defaultPanelPassword: crypto.randomUUID(),
    enableEventLoopMetrics: false
  });
  await store.ensure();
  await store.update((data) => {
    data.stockState = normalizeStockState({
      categories: [{ id: "demo-category", name: "DEMO Kategori", active: true }],
      products: [{
        id: "demo-product-a", name: "DEMO Ürün A", productCode: "DEMO-A", categoryId: "demo-category",
        category: "DEMO Kategori", baseUnit: "adet", barcode: "000123", alternativeBarcodes: ["ALT-A"], active: true
      }]
    });
  });

  const pass = (_req, _res, next) => next();
  const app = express();
  app.use(express.json());
  registerStockLocationRoutes({
    app,
    store,
    auth: { requireAdmin: pass, requireRecipe: pass, requireActivePersonel: pass, requirePersonelSection: () => pass },
    requireAdminRequestOrigin: pass,
    requireAdminOrMainRequestOrigin: pass,
    resolveProcurementActor: async () => ({ type: "admin", id: "admin", name: "Yönetici" }),
    hasProcurementCapability: () => true,
    broadcastStockUpdate: () => {}
  });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok: false, message: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    await store.close();
    await fsp.rm(directory, { recursive: true, force: true });
  });
  const root = `http://127.0.0.1:${server.address().port}/api/procurement/v1/stock`;
  let operation = 0;
  const catalog = async () => (await fetch(`${root}/catalog`)).json();
  const mutate = async (url, method, body) => fetch(`${root}${url}`, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": `catalog-test-${String(++operation).padStart(4, "0")}` },
    body: JSON.stringify(body)
  });
  const revision = async () => Number((await catalog()).catalogRevision || 0);
  const productBody = (barcode, alternatives = []) => ({
    expectedCatalogRevision: 0, categoryId: "demo-category", name: "DEMO Ürün B", productCode: "DEMO-B",
    baseUnit: "adet", unit: "adet", barcode, alternativeBarcodes: alternatives, active: true
  });

  const duplicate = productBody("000123");
  duplicate.expectedCatalogRevision = await revision();
  let response = await mutate("/catalog/products", "POST", duplicate);
  assert.equal(response.status, 409);
  assert.match((await response.json()).message, /başka bir stok ürününde/);

  const created = productBody("000999", ["ALT-NEW"]);
  created.expectedCatalogRevision = await revision();
  response = await mutate("/catalog/products", "POST", created);
  assert.equal(response.status, 201);
  const createdPayload = await response.json();
  assert.equal(createdPayload.product.barcode, "000999");
  assert.ok(createdPayload.product.alternativeBarcodes.includes("ALT-NEW"));

  response = await mutate(`/catalog/products/${createdPayload.product.id}`, "PATCH", {
    expectedCatalogRevision: await revision(), name: "DEMO Ürün B Güncel"
  });
  assert.equal(response.status, 200, "ürün kendi barkodunu koruyarak düzenlenebilir");

  response = await mutate("/catalog/products/demo-product-a", "PATCH", {
    expectedCatalogRevision: await revision(), barcode: "ALT-NEW"
  });
  assert.equal(response.status, 409, "alternatif barkod başka ürüne bağlanamaz");

  response = await mutate(`/catalog/products/${createdPayload.product.id}`, "PATCH", {
    expectedCatalogRevision: await revision(), barcode: "BAD\nBARCODE"
  });
  assert.equal(response.status, 422);
});
