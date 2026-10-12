"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { registerStockLocationRoutes } = require("../src/stock-location-routes");
const { createFileStore } = require("../src/store/file-store");
const { normalizeStockState } = require("../src/store/migrations");

test("malzeme yeri ürün-depo ilişkisine kalıcı ve stoktan bağımsız kaydedilir", async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "stock-placement-"));
  const storePath = path.join(directory, "store.json");
  const store = createFileStore(storePath, {
    bcryptRounds: 4,
    defaultPanelPassword: crypto.randomUUID(),
    enableEventLoopMetrics: false
  });
  await store.ensure();
  await store.update((data) => {
    data.stockState = normalizeStockState({
      categories: [{ id: "demo-parts", name: "DEMO Parçalar", active: true }],
      products: [
        { id: "demo-bearing", name: "DEMO Rulman", productCode: "DEMO-RLM", categoryId: "demo-parts", category: "DEMO Parçalar", baseUnit: "adet", unit: "adet", active: true },
        { id: "demo-belt", name: "DEMO Kayış", productCode: "DEMO-KYS", categoryId: "demo-parts", category: "DEMO Parçalar", baseUnit: "adet", unit: "adet", active: true }
      ],
      locations: [{ id: "demo-workshop", code: "DEMO-ATOLYE", name: "DEMO Bakım Atölyesi", type: "workshop", active: true, personnelVisible: true, assignedPersonnelIds: ["person-1"], isDefault: true }],
      balances: [
        { id: "balance-bearing", locationId: "demo-workshop", productId: "demo-bearing", quantity: 8, revision: 0 },
        { id: "balance-belt", locationId: "demo-workshop", productId: "demo-belt", quantity: 5, revision: 0 }
      ],
      movements: [{ id: "movement-existing", locationId: "demo-workshop", productId: "demo-bearing", quantity: 8, type: "opening_balance" }]
    });
  });

  const pass = (_req, _res, next) => next();
  const activePersonel = (req, _res, next) => {
    req.recipeUser = { id: "person-1", name: "DEMO Personel", stockLocationId: "demo-workshop" };
    next();
  };
  const app = express();
  app.use(express.json());
  registerStockLocationRoutes({
    app,
    store,
    auth: { requireAdmin: pass, requireRecipe: pass, requireActivePersonel: activePersonel, requirePersonelSection: () => pass },
    requireAdminRequestOrigin: pass,
    requireAdminOrMainRequestOrigin: pass,
    resolveProcurementActor: async (req) => req.get("X-Test-Actor") === "personel"
      ? { type: "personel", id: "person-1", accessEnabled: true, sectionAccess: { stock: "full" }, capabilities: ["inventory.read"] }
      : { type: "admin", id: "admin", name: "Yönetici" },
    hasProcurementCapability: (actor, capability) => actor.type === "admin" || (actor.capabilities || []).includes(capability),
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

  const base = `http://127.0.0.1:${server.address().port}`;
  const overview = await (await fetch(`${base}/api/admin/stock/overview`)).json();
  assert.equal(overview.ok, true);
  assert.equal(overview.products.length, 2, "Genel Bakış eski menü yerine stok kataloğunu kullanmalı");
  assert.equal(overview.categories.length, 1);
  const overviewState = (await store.read()).stockState;
  assert.equal(overview.locationCount, overviewState.locations.filter(location => location.active !== false).length,
    "Genel Bakış aktif depoları normalleştirilmiş stok kaynağından saymalı");
  assert.equal(overview.criticalProducts, 0, "eşik tanımlanmamış depolar kritik sayılmamalı");
  const placementsUrl = `${base}/api/procurement/v1/stock/placements`;
  const getPlacements = async () => (await fetch(placementsUrl)).json();
  const patchPlacement = (productId, requestId, revision, body, actor = "admin") => fetch(`${placementsUrl}/${productId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, "X-Test-Actor": actor },
    body: JSON.stringify({ expectedRevision: revision, expectedInventoryRevision: revision, ...body })
  });

  const before = await store.read();
  const beforeQuantities = before.stockState.balances.map((item) => [item.productId, item.quantity]);
  const beforeMovementCount = before.stockState.movements.length;
  const initial = await getPlacements();

  let response = await patchPlacement("demo-bearing", "placement-bearing-0001", initial.inventoryRevision, {
    locationId: "demo-workshop",
    placementName: "Raf A-02 · 2. bölme",
    placementPhotoUrl: "/media/demo-bearing-place.jpg"
  });
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.record.placementName, "Raf A-02 · 2. bölme");

  response = await patchPlacement("demo-bearing", "placement-bearing-0001", initial.inventoryRevision, {
    locationId: "demo-workshop",
    placementName: "Raf A-02 · 2. bölme",
    placementPhotoUrl: "/media/demo-bearing-place.jpg"
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);

  response = await patchPlacement("demo-belt", "placement-belt-0001", first.inventoryRevision, {
    locationId: "demo-workshop",
    placementName: "Dolap B · Alt göz",
    placementPhotoUrl: "/media/demo-belt-place.webp"
  });
  assert.equal(response.status, 200);
  const second = await response.json();

  response = await patchPlacement("demo-bearing", "placement-bearing-0002", second.inventoryRevision, {
    locationId: "demo-workshop",
    placementName: "Raf A-03 · Üst bölme",
    placementPhotoUrl: "/media/demo-bearing-place-v2.png"
  });
  assert.equal(response.status, 200);
  const updated = await response.json();
  assert.equal(updated.record.placementName, "Raf A-03 · Üst bölme");

  const listed = await getPlacements();
  const bearingRecords = listed.records.filter((item) => item.productId === "demo-bearing" && item.locationId === "demo-workshop");
  assert.equal(bearingRecords.length, 1, "aynı ürün-depo ilişkisi mükerrerleşmemeli");
  assert.equal(bearingRecords[0].placementPhotoUrl, "/media/demo-bearing-place-v2.png");
  const belt = listed.records.find((item) => item.productId === "demo-belt" && item.locationId === "demo-workshop");
  assert.equal(belt.placementName, "Dolap B · Alt göz");
  assert.equal(belt.placementPhotoUrl, "/media/demo-belt-place.webp");

  const personnel = await (await fetch(`${base}/api/workforce/stock`)).json();
  const personnelBearing = personnel.locationBalances.find((item) => item.productId === "demo-bearing");
  assert.equal(personnelBearing.placementName, "Raf A-03 · Üst bölme");
  assert.equal(personnelBearing.placementPhotoUrl, "/media/demo-bearing-place-v2.png");

  response = await patchPlacement("demo-bearing", "placement-personel-0001", updated.inventoryRevision, {
    locationId: "demo-workshop", placementName: "Yetkisiz değişiklik"
  }, "personel");
  assert.equal(response.status, 403, "personel yönetici yer kaydını değiştirememeli");

  let revision = (await getPlacements()).inventoryRevision;
  response = await patchPlacement("demo-bearing", "shared-plan-test-0001", revision, {
    locationId: "demo-workshop", placementName: "A1", locationPlanPhotoUrl: "/media/depot-plan.png", placementX: 20, placementY: 35
  });
  assert.equal(response.status, 200, await response.clone().text());
  revision = (await response.json()).inventoryRevision;
  response = await patchPlacement("demo-belt", "shared-plan-test-0002", revision, {
    locationId: "demo-workshop", placementName: "B1", locationPlanPhotoUrl: "/media/depot-plan.png", placementX: 70, placementY: 55
  });
  assert.equal(response.status, 200);
  revision = (await response.json()).inventoryRevision;
  const plan = await (await fetch(`${base}/api/workforce/stock`)).json();
  assert.equal(plan.locations.find(location => location.id === "demo-workshop").photoUrl, "/media/depot-plan.png");
  assert.equal(plan.locationBalances.find(balance => balance.productId === "demo-bearing").placementX, 20);
  assert.equal(plan.locationBalances.find(balance => balance.productId === "demo-belt").placementX, 70);
  response = await patchPlacement("demo-bearing", "shared-plan-invalid-0001", revision, {
    locationId: "demo-workshop", placementName: "A1", placementX: 101, placementY: 40
  });
  assert.equal(response.status, 422);
  response = await patchPlacement("demo-bearing", "shared-plan-test-0003", revision, {
    locationId: "demo-workshop", placementName: "Raf A-03 · Üst bölme", locationPlanPhotoUrl: "/media/new-depot-plan.png", placementX: 25, placementY: 30
  });
  assert.equal(response.status, 200);
  const changedPlan = await getPlacements();
  assert.equal(changedPlan.records.find(record => record.productId === "demo-belt" && record.locationId === "demo-workshop").placementX, null, "eski noktalar yeni plana taşınmamalı");
  assert.equal(changedPlan.records.find(record => record.productId === "demo-bearing" && record.locationId === "demo-workshop").placementY, 30);

  const after = await store.read();
  assert.deepEqual(after.stockState.balances.map((item) => [item.productId, item.quantity]), beforeQuantities);
  assert.equal(after.stockState.movements.length, beforeMovementCount);
  const persisted = JSON.parse(await fsp.readFile(storePath, "utf8"));
  const persistedBearing = persisted.stockState.balances.find((item) => item.productId === "demo-bearing");
  assert.equal(persistedBearing.placementName, "Raf A-03 · Üst bölme");
  assert.equal(persistedBearing.placementPhotoUrl, "/media/demo-bearing-place-v2.png");
  assert.equal(persistedBearing.placementX, 25);
  assert.equal(persisted.stockState.locations.find(location => location.id === "demo-workshop").photoUrl, "/media/new-depot-plan.png");
});

test("yeni ürün birimi istemciden bağımsız olarak adet ve tam sayı düzeninde oluşturulur", async (context) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "stock-product-adet-"));
  const store = createFileStore(path.join(directory, "store.json"), { bcryptRounds: 4, defaultPanelPassword: crypto.randomUUID(), enableEventLoopMetrics: false });
  await store.ensure();
  await store.update((data) => {
    data.stockState = normalizeStockState({ categories: [{ id: "demo-category", name: "DEMO Kategori", active: true }] });
  });
  const pass = (_req, _res, next) => next();
  const app = express();
  app.use(express.json());
  registerStockLocationRoutes({
    app, store,
    auth: { requireAdmin: pass, requireRecipe: pass, requireActivePersonel: pass, requirePersonelSection: () => pass },
    requireAdminRequestOrigin: pass, requireAdminOrMainRequestOrigin: pass,
    resolveProcurementActor: async () => ({ type: "admin", id: "admin" }),
    hasProcurementCapability: () => true, broadcastStockUpdate: () => {}
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
  const catalog = await (await fetch(`${root}/catalog`)).json();
  const response = await fetch(`${root}/catalog/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "product-adet-0001" },
    body: JSON.stringify({
      expectedCatalogRevision: catalog.catalogRevision,
      categoryId: "demo-category", name: "DEMO Sabit Adet", productCode: "DEMO-ADET",
      baseUnit: "litre", unit: "litre", bulkUnit: "koli", unitsPerBulkUnit: 24,
      allowDecimal: true, defaultMovementUnit: "koli"
    })
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.product.baseUnit, "adet");
  assert.equal(payload.product.unit, "adet");
  assert.equal(payload.product.bulkUnit, "");
  assert.equal(payload.product.unitsPerBulkUnit, 0);
  assert.equal(payload.product.defaultMovementUnit, "adet");
  assert.equal(payload.product.allowDecimal, false);
});
