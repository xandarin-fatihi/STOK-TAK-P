"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { buildMovementHistory, isSupply } = require("../src/stock-movement-history");
const { registerStockLocationRoutes } = require("../src/stock-location-routes");
const root = path.resolve(__dirname, "../../..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const supply = (date, overrides = {}) => ({ id: date, createdAt: `${date}T06:30:00Z`, productId: "p", productName: "Rulman İğneli", productCode: "RLM-01", locationId: "d", quantity: 20, baseQuantityDelta: 20, type: "inbound_shipment", status: "approved", shipmentId: `shipment-${date}`, baseUnit: "adet", ...overrides });
const fixture = () => ({ products: [{ id: "p", name: "Rulman İğneli", productCode: "RLM-01", baseUnit: "adet", active: true }], locations: [{ id: "d", name: "Bakım Atölyesi", active: true }], movements: [supply("2026-04-05"), supply("2026-07-05"), supply("2026-10-05")] });

test("sipariş sıklığı tüm geçmişten hesaplanır; tarih/arama/sayfalama tahmini değiştirmez", () => {
  const state = fixture();
  const original = JSON.stringify(state);
  const result = buildMovementHistory(state, { date: "2026-10-05", search: "rulman igneli", frequency: "quarterly", limit: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.movements[0].frequency.kind, "quarterly");
  assert.equal(result.movements[0].frequency.averageDays, 91.5);
  assert.equal(result.movements[0].frequency.count, 3);
  assert.equal(JSON.stringify(state), original, "Geçmiş ve stok salt okunur kalmalı");
  assert.equal(buildMovementHistory(state, { search: "atolyesi" }).total, 3);
});
test("eksiltme, manuel giriş, terslenmiş giriş ve mükerrer sipariş satırı sıklığı artırmaz", () => {
  const state = fixture();
  state.movements[2].status = "reversed";
  state.movements.push(supply("2026-07-05", { id: "another-line", quantity: 4 }));
  state.movements.push(supply("2026-09-05", { type: "manual_in", shipmentId: "" }));
  state.movements.push(supply("2026-08-05", { type: "manual_out", baseQuantityDelta: -1 }));
  const result = buildMovementHistory(state);
  assert.ok(result.movements.every((item) => item.frequency.kind === "insufficient"));
  assert.equal(result.movements.find((item) => item.id === "another-line").frequency.count, 2);
  assert.equal(isSupply(supply("2026-01-01", { status: "pending" })), false);
});
test("aynı ürünün farklı depoları ayrı analiz edilir ve düzensiz periyot gizlenmez", () => {
  const state = fixture();
  state.movements.push(supply("2026-09-05", { locationId: "other" }));
  assert.equal(buildMovementHistory(state).movements.find((item) => item.locationId === "other").frequency.kind, "insufficient");
  state.movements[1] = supply("2026-04-07");
  assert.equal(buildMovementHistory(state, { frequency: "irregular" }).total, 3);
});
test("aylık, altı aylık, yıllık ve diğer düzenli periyotlar doğru etiketlenir", () => {
  for (const [days, kind] of [[30, "monthly"], [180, "semiannual"], [365, "annual"], [7, "other"]]) {
    const state = fixture();
    state.movements = [0, 1, 2].map((i) => supply(new Date(Date.UTC(2024, 0, 1) + i * days * 86400000).toISOString().slice(0, 10)));
    assert.equal(buildMovementHistory(state).movements[0].frequency.kind, kind);
  }
});
test("Türkiye günü UTC gece sınırını kapsar; geçersiz tarihler ve sıklık reddedilir", () => {
  const state = fixture();
  state.movements = [supply("2026-10-04", { createdAt: "2026-10-04T21:15:00Z" }), supply("2026-10-05", { createdAt: "2026-10-05T21:15:00Z" })];
  assert.equal(buildMovementHistory(state, { date: "2026-10-05" }).total, 1);
  assert.throws(() => buildMovementHistory(state, { date: "2026-02-30" }), { status: 400 });
  assert.throws(() => buildMovementHistory(state, { frequency: "bad" }), { status: 400 });
});
test("eski tarih son 40 kaydın dışında olsa da bulunur; sayfalar tekil ve sıralıdır", () => {
  const state = fixture();
  state.movements = Array.from({ length: 125 }, (_, i) => supply(new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10), { type: "manual_out", baseQuantityDelta: -1, quantity: 1 }));
  assert.equal(buildMovementHistory(state, { date: "2026-01-01" }).total, 1);
  const a = buildMovementHistory(state, { limit: 40 });
  const b = buildMovementHistory(state, { limit: 40, offset: 40 });
  assert.equal(a.total, 125); assert.equal(a.hasMore, true);
  assert.equal(new Set([...a.movements, ...b.movements].map((item) => item.id)).size, 80);
});
test("işlem ailesi filtreleri transfer, sevkiyat ve eski stok türlerini korur", () => {
  const state = fixture();
  state.movements.push(supply("2026-10-06", { type: "transfer_out", locationId: "other", fromLocationId: "other", toLocationId: "d" }));
  assert.equal(buildMovementHistory(state, { type: "manual_in" }).total, 3);
  assert.equal(buildMovementHistory(state, { type: "transfer" }).total, 1);
  assert.equal(buildMovementHistory(state, { type: "transfer", locationId: "d" }).total, 0);
});
test("Depo akordionu, erişilebilir detay ve filtreler mevcut listeyi ters kayıt düğmesiz korur", () => {
  const html = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/index.html");
  const admin = read("YÖNETİCİ PANELİ/HTML/index.html");
  const js = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/scripts/stock.js");
  const css = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/styles/stock.css");
  assert.doesNotMatch(admin, /data-panel-section="stockMovements"|id="stockMovementsCard"/);
  assert.doesNotMatch(html, /id="stockHistoryDialog"/);
  assert.ok(html.indexOf('id="stockWarehouseCards"') < html.indexOf('id="stockHistoryAccordion"'));
  for (const id of ["stockMovementSearch", "stockMovementDateFilter", "stockMovementFrequencyFilter", "stockMovementDetailDialog"]) assert.ok(html.includes(`id="${id}"`));
  assert.doesNotMatch(js, /data-reverse-movement/);
  assert.match(js, /historyController\?\.abort\(\)/);
  assert.match(js, /clearTimeout\(historySearchTimer\)/);
  assert.match(js, /historyView\.returnFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.match(css, /stock-movement-detail-dialog::backdrop[^}]+blur\(5px\)/);
});
test("aynı geçmiş API'si admin yetkisini ve salt okunur veri akışını korur", async (context) => {
  const state = fixture(); const before = JSON.stringify(state);
  const app = express(); app.use(express.json());
  const pass = (_req, _res, next) => next();
  const auth = (req, res, next) => req.headers["x-test-admin"] ? next() : res.status(401).json({ ok: false });
  registerStockLocationRoutes({ app, store: { read: async () => ({ stockState: state }), update: async () => { throw new Error("History must not write"); } }, auth: { requireAdmin: auth, requireRecipe: auth, requireActivePersonel: auth, requirePersonelSection: () => auth }, requireAdminRequestOrigin: pass, requireAdminOrMainRequestOrigin: pass, resolveProcurementActor: async () => ({ type: "admin", id: "admin", capabilities: [] }), hasProcurementCapability: () => true, broadcastStockUpdate: () => {} });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ ok: false, message: error.message }));
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/procurement/v1/stock/movements?history=1&date=2026-10-05`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { "x-test-admin": "1" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 1);
  assert.equal(JSON.stringify(state), before);
});
