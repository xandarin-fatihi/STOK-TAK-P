"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_SHIPMENT_SEQUENCE,
  allocateShipmentNumber,
  reconcileShipmentNumbers,
  shipmentYear
} = require("../src/shipment-number");
const { createFileStore } = require("../src/store/file-store");
const { migrateStore, STORE_SCHEMA_VERSION } = require("../src/store/migrations");

test("sevkiyat yılı Europe/Istanbul sınırında doğru döner ve sayaç yılda sıfırlanır", () => {
  assert.equal(shipmentYear("2025-12-31T20:59:59.999Z"), "2025");
  assert.equal(shipmentYear("2025-12-31T21:00:00.000Z"), "2026");

  const data = { workforceShipments: [], shipmentNumberSequences: {} };
  const oldYear = allocateShipmentNumber(data, "2025-12-31T20:59:59.999Z");
  data.workforceShipments.push({ id: "old", shipmentNumber: oldYear });
  const newYear = allocateShipmentNumber(data, "2025-12-31T21:00:00.000Z");
  assert.equal(oldYear, "SVK-2025-000001");
  assert.equal(newYear, "SVK-2026-000001");
  assert.deepEqual(data.shipmentNumberSequences, { 2025: 1, 2026: 1 });
});

test("legacy backfill geçerli numarayı korur, tekrarı deterministik düzeltir ve sayaç driftini toplar", () => {
  const legacy = [
    { id: "later-missing", createdAt: "2026-01-03T10:00:00.000Z" },
    { id: "valid-first", shipmentNumber: "SVK-2026-000007", createdAt: "2026-01-01T10:00:00.000Z" },
    { id: "duplicate", shipmentNumber: "SVK-2026-000007", createdAt: "2026-01-02T10:00:00.000Z" },
    { id: "old-year", createdAt: "2025-04-02T10:00:00.000Z" }
  ];
  const reconciled = reconcileShipmentNumbers(legacy, { 2025: 5, 2026: 2, invalid: 900 });
  const byId = new Map(reconciled.shipments.map((shipment) => [shipment.id, shipment.shipmentNumber]));
  assert.equal(byId.get("valid-first"), "SVK-2026-000007");
  assert.equal(byId.get("duplicate"), "SVK-2026-000008");
  assert.equal(byId.get("later-missing"), "SVK-2026-000009");
  assert.equal(byId.get("old-year"), "SVK-2025-000006");
  assert.deepEqual(reconciled.sequences, { 2025: 6, 2026: 9 });

  const second = reconcileShipmentNumbers(reconciled.shipments, reconciled.sequences);
  assert.deepEqual(second, reconciled);
});

test("store migrationı numaraları bir kez backfill eder, schema ve sayaçlar tekrar çalıştırmada sabit kalır", () => {
  const first = migrateStore({
    schemaVersion: STORE_SCHEMA_VERSION - 1,
    workforceShipments: [
      { id: "legacy-b", createdAt: "2026-06-02T07:00:00.000Z", items: [] },
      { id: "legacy-a", createdAt: "2026-06-01T07:00:00.000Z", items: [] },
      { id: "legacy-2025", createdAt: "2025-12-31T20:00:00.000Z", items: [] }
    ],
    shipmentNumberSequences: { 2026: 4 }
  });
  const second = migrateStore(first);
  assert.equal(first.schemaVersion, STORE_SCHEMA_VERSION);
  assert.deepEqual(first.workforceShipments.map(({ id, shipmentNumber }) => ({ id, shipmentNumber })), [
    { id: "legacy-b", shipmentNumber: "SVK-2026-000006" },
    { id: "legacy-a", shipmentNumber: "SVK-2026-000005" },
    { id: "legacy-2025", shipmentNumber: "SVK-2025-000001" }
  ]);
  assert.deepEqual(second.workforceShipments, first.workforceShipments);
  assert.deepEqual(second.shipmentNumberSequences, first.shipmentNumberSequences);
});

test("allocation düşürülmüş sayacı mevcut kayıtlardan onarır, yüksek sayacı yeniden kullanmaz", () => {
  const lowDrift = {
    shipmentNumberSequences: { 2026: 2 },
    workforceShipments: [{ id: "existing", shipmentNumber: "SVK-2026-000042" }]
  };
  assert.equal(allocateShipmentNumber(lowDrift, "2026-09-27T12:00:00.000Z"), "SVK-2026-000043");

  const highDrift = { shipmentNumberSequences: { 2026: 80 }, workforceShipments: [] };
  assert.equal(allocateShipmentNumber(highDrift, "2026-09-27T12:00:00.000Z"), "SVK-2026-000081");

  assert.throws(() => allocateShipmentNumber({
    shipmentNumberSequences: { 2026: MAX_SHIPMENT_SEQUENCE },
    workforceShipments: []
  }, "2026-09-27T12:00:00.000Z"), (error) => error.code === "SHIPMENT_NUMBER_SEQUENCE_EXHAUSTED");
});

test("gerçek store kuyruğunda eşzamanlı tahsisler atomik ve benzersizdir", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paket3-shipment-number-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createFileStore(path.join(root, "store.json"), {
    defaultPanelPassword: "ShipmentNumberTest!2026",
    bcryptRounds: 4,
    writerLock: false,
    enableEventLoopMetrics: false
  });
  context.after(() => store.close());
  await store.ensure();

  const allocated = await Promise.all(Array.from({ length: 12 }, (_, index) => store.update((data) => {
    const createdAt = "2026-09-27T12:00:00.000Z";
    const shipmentNumber = allocateShipmentNumber(data, createdAt);
    data.workforceShipments.push({ id: `concurrent-${index}`, shipmentNumber, createdAt, items: [] });
    return data;
  }).then((data) => data.workforceShipments.find((shipment) => shipment.id === `concurrent-${index}`).shipmentNumber)));

  assert.equal(new Set(allocated).size, 12);
  assert.deepEqual([...allocated].sort(), Array.from({ length: 12 }, (_, index) => `SVK-2026-${String(index + 1).padStart(6, "0")}`));
  const snapshot = await store.read();
  assert.equal(snapshot.shipmentNumberSequences[2026], 12);
});
