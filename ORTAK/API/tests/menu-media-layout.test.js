"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const schema = require("../../JS/menu-design-schema");
const { buildPublicBootstrap } = require("../src/public-bootstrap");
const { validateProductDesign } = require("../src/validators");

function menuFixture(productPatch = {}) {
  return {
    settings: {},
    categories: [{
      id: "category-1",
      name: "Kahveler",
      active: true,
      products: [{
        id: "product-1",
        name: "Latte",
        active: true,
        imageUrl: "/media/latte.png",
        ...productPatch
      }]
    }]
  };
}

test("product image layout normalizes legacy and invalid values to the current rendering", () => {
  assert.equal(schema.DESIGN_SCHEMA_VERSION, 5);

  const legacy = schema.normalizeProductDesign({ id: "legacy", name: "Legacy" }, 0);
  assert.equal(legacy.imageAspect, "landscape");
  assert.equal(legacy.imageFit, "contain");

  const invalid = schema.normalizeProductDesign({ imageAspect: "portrait", imageFit: "stretch" }, 0);
  assert.equal(invalid.imageAspect, "landscape");
  assert.equal(invalid.imageFit, "contain");

  const configured = schema.normalizeProductDesign({ imageAspect: "source", imageFit: "cover" }, 0);
  assert.equal(configured.imageAspect, "source");
  assert.equal(configured.imageFit, "cover");
});

test("menu design snapshots round-trip product image layout and factory reset it", () => {
  const menu = menuFixture({ imageAspect: "square", imageFit: "cover" });
  const snapshot = schema.createDesignSnapshot(menu);
  assert.equal(snapshot.schemaVersion, 5);
  assert.equal(snapshot.productDesign[0].imageAspect, "square");
  assert.equal(snapshot.productDesign[0].imageFit, "cover");

  const changed = menuFixture({ imageAspect: "landscape", imageFit: "contain" });
  const restored = schema.applyDesignSnapshot(changed, snapshot);
  assert.equal(restored.categories[0].products[0].imageAspect, "square");
  assert.equal(restored.categories[0].products[0].imageFit, "cover");

  const factory = schema.createFactoryDesignSnapshot(menu);
  const reset = schema.applyDesignSnapshot(menu, factory);
  assert.equal(reset.categories[0].products[0].imageAspect, "landscape");
  assert.equal(reset.categories[0].products[0].imageFit, "contain");
});

test("public bootstrap projects safe product image layout values", () => {
  const payload = buildPublicBootstrap({
    menuState: menuFixture({ imageAspect: "square", imageFit: "cover" }),
    pricing: { schemaVersion: 1, types: [] }
  });
  assert.equal(payload.menu.products[0].imageAspect, "square");
  assert.equal(payload.menu.products[0].imageFit, "cover");

  const legacyPayload = buildPublicBootstrap({
    menuState: menuFixture(),
    pricing: { schemaVersion: 1, types: [] }
  });
  assert.equal(legacyPayload.menu.products[0].imageAspect, "landscape");
  assert.equal(legacyPayload.menu.products[0].imageFit, "contain");
});

test("product image layout validator rejects unsupported enum values", () => {
  assert.equal(validateProductDesign({ imageAspect: "source", imageFit: "cover" }), "");
  assert.match(validateProductDesign({ imageAspect: "portrait" }), /imageAspect/);
  assert.match(validateProductDesign({ imageFit: "stretch" }), /imageFit/);
});

test("stok paketi kapsam dışı QR menü yüzeyini içermez", () => {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  assert.equal(fs.existsSync(path.join(projectRoot, "QR MENÜ")), false);
});

test("yönetim ürün görseli kontrolleri stok paketinde korunur", () => {
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  const managerHtml = fs.readFileSync(path.join(projectRoot, "YÖNETİCİ PANELİ", "HTML", "index.html"), "utf8");
  const managerJs = fs.readFileSync(path.join(projectRoot, "YÖNETİCİ PANELİ", "JS", "app.js"), "utf8");

  assert.match(managerHtml, /<select id="productImageAspect"[^>]*>[\s\S]*?value="landscape"[\s\S]*?value="square"[\s\S]*?value="source"[\s\S]*?<\/select>/);
  assert.match(managerHtml, /<select id="productImageFit"[^>]*>[\s\S]*?value="contain"[\s\S]*?value="cover"[\s\S]*?<\/select>/);
  assert.match(managerJs, /target\.dataset\.imageAspect\s*=\s*aspect/);
  assert.match(managerJs, /target\.dataset\.imageFit\s*=\s*fit/);
});
