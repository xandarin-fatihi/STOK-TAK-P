"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { monitorEventLoopDelay, performance } = require("node:perf_hooks");
const express = require("express");

const { registerNotificationRoutes } = require("../src/notification-routes");
const { migrateStore } = require("../src/store/migrations");
const { createFileStore } = require("../src/store/file-store");

const LOAD_COUNT = 10_000;
const OUTBOX_COUNT = 1_000;

test("10.000 bildirim yükünde liste, sayaç, sınırlı toplu işlem, SSE ve kalıcı store ölçülür", async (t) => {
  const runtimeRoot = await fs.mkdtemp(path.join(__dirname, ".runtime-notification-load-"));
  const dataFile = path.join(runtimeRoot, "store.json");
  const backupDir = path.join(runtimeRoot, "backups");
  const metricsFile = path.resolve(__dirname, "..", "..", "..", "DENETIM", "notification-load-metrics.json");
  let loop = null;
  let startedAt = "";
  let overallStarted = 0;
  let heapBefore = 0;

  const fixture = loadFixture();
  const yoneticiNotifications = fixture.notifications.filter((item) => item.appTarget === "yonetici");
  const yoneticiHeaders = { "x-menu-suite-app-target": "yonetici" };
  await fs.writeFile(dataFile, JSON.stringify(fixture), "utf8");
  const store = createFileStore(dataFile, {
    backupDir,
    defaultPanelPassword: "load-test-only",
    enableEventLoopMetrics: true,
    eventLoopResolutionMs: 10
  });
  await store.ensure();

  let server;
  let runtime;
  let http5xxCount = 0;
  let maxSseConnections = 0;
  const operationDurationsMs = {};
  const controllers = [];
  const sseReaders = [];

  t.after(async () => {
    for (const controller of controllers) controller.abort();
    for (const reader of sseReaders) await reader.cancel().catch(() => {});
    if (runtime) runtime.close();
    if (server && server.listening) await new Promise((resolve) => server.close(resolve));
    await store.close();
    if (loop) loop.disable();
    const expectedPrefix = path.resolve(__dirname) + path.sep;
    assert.equal(path.resolve(runtimeRoot).startsWith(expectedPrefix), true, "test runtime yolu PAKET 3 test alanında olmalı");
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  });

  const app = express();
  app.use(express.json({ limit: "256kb" }));
  const pass = (_req, _res, next) => next();
  runtime = registerNotificationRoutes({
    app,
    store,
    auth: {
      requireActivePersonel(req, _res, next) { req.recipeUser = { id: "load-personnel" }; next(); },
      requireAdmin(req, _res, next) { req.admin = { role: "admin" }; next(); }
    },
    config: {},
    deliveryWorker: { async health() { return { pending: OUTBOX_COUNT }; } },
    pushService: { isConfigured: () => false, publicKey: "" },
    requireAdminRequestOrigin: pass,
    requireAdminOrMainRequestOrigin: pass,
    riskOperationLimiter: pass
  });
  app.use((error, _req, res, _next) => {
    const status = Number(error.status || 500);
    if (status >= 500) http5xxCount += 1;
    res.status(status).json({ ok: false, message: error.message });
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Fixture üretimi ve ilk migration uygulama çalışma zamanı SLO'sunu kirletmez.
  // Ölçüm penceresi yalnız sıcak snapshot üzerindeki HTTP etkileşimlerini kapsar.
  loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  await new Promise((resolve) => setTimeout(resolve, 20));
  loop.reset();
  store.resetMetrics();
  startedAt = new Date().toISOString();
  overallStarted = performance.now();
  heapBefore = process.memoryUsage().heapUsed;

  operationDurationsMs.list = await measured(async () => {
    const response = await fetch(`${base}/api/admin/notifications?limit=100`, { headers: yoneticiHeaders });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.notifications.length, 100);
    assert.equal(body.counts.inbox + body.counts.archived, yoneticiNotifications.length);
    assert.equal(body.notifications.every((item) => item.appTarget === "yonetici"), true);
    assert.equal(typeof body.nextCursor, "string");
  });

  operationDurationsMs.unreadCount = await measured(async () => {
    const response = await fetch(`${base}/api/admin/notifications/unread-count`, { headers: yoneticiHeaders });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.unreadCount, yoneticiNotifications.filter((item) => !item.readAt && !item.archivedAt).length);
  });

  for (let index = 0; index < 2; index += 1) {
    const controller = new AbortController();
    controllers.push(controller);
    const response = await fetch(`${base}/api/admin/notifications/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    sseReaders.push(response.body.getReader());
  }
  await waitFor(() => runtime.getSseClientCount() === 2, 1_500);
  maxSseConnections = runtime.getSseClientCount();
  assert.equal(maxSseConnections, 2);

  const outboxBeforeBulkRead = (await store.read()).notificationOutbox;
  const readIds = yoneticiNotifications.slice(101, 201).map((item) => item.id);
  operationDurationsMs.bulkRead100 = await measured(async () => {
    const response = await fetch(`${base}/api/admin/notifications/bulk`, {
      method: "POST", headers: { ...yoneticiHeaders, "content-type": "application/json" },
      body: JSON.stringify({ action: "read", ids: readIds })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updatedCount, 100);
  });
  assert.equal((await store.read()).notificationOutbox, outboxBeforeBulkRead,
    "toplu okuma değişmeyen outbox snapshot'ını kopyalamamalı");

  const deleteIds = yoneticiNotifications.slice(301, 351).map((item) => item.id);
  operationDurationsMs.bulkDelete50 = await measured(async () => {
    const response = await fetch(`${base}/api/admin/notifications/bulk`, {
      method: "POST", headers: { ...yoneticiHeaders, "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", ids: deleteIds })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updatedCount, 50);
  });

  const bounded = await fetch(`${base}/api/admin/notifications/bulk`, {
    method: "POST", headers: { ...yoneticiHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "read", ids: yoneticiNotifications.slice(0, 101).map((item) => item.id) })
  });
  assert.equal(bounded.status, 400, "100 kayıttan büyük toplu işlem reddedilmeli");

  const foreignNotification = fixture.notifications.find((item) => item.appTarget === "personel" && !item.readAt);
  const isolated = await fetch(`${base}/api/admin/notifications/bulk`, {
    method: "POST", headers: { ...yoneticiHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "read", ids: [foreignNotification.id] })
  });
  assert.equal(isolated.status, 404, "Yönetici kapsamı Personel bildirimini toplu güncelleyememeli");

  const saved = await store.read();
  assert.equal(saved.notifications.length, LOAD_COUNT - deleteIds.length);
  assert.equal(saved.notifications.find((item) => item.id === foreignNotification.id).readAt, null,
    "reddedilen çapraz appTarget toplu isteği yabancı kaydı değiştirmemeli");
  assert.equal(deleteIds.every((id) => saved.notificationDedupe.some((entry) => entry.fingerprint === loadFingerprint(id))), true,
    "silinen bildirimlerin dedupe geçmişi yeniden üretimi önlemek için kalmalı");
  const affectedOutbox = saved.notificationOutbox.filter((item) => deleteIds.includes(item.notificationId));
  assert.equal(affectedOutbox.every((item) => item.status === "cancelled"), true, "silinen bildirimlerin bekleyen teslimi iptal edilmeli");

  for (const controller of controllers) controller.abort();
  for (const reader of sseReaders) await reader.cancel().catch(() => {});
  await waitFor(() => runtime.getSseClientCount() === 0, 1_500);

  const stat = await fs.stat(dataFile);
  const storeMetrics = store.getMetrics();
  const totalDurationMs = round(performance.now() - overallStarted);
  const heapDeltaBytes = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  const eventLoopDelayP95Ms = round(loop.percentile(95) / 1e6);
  const evidence = {
    generatedAt: new Date().toISOString(),
    startedAt,
    syntheticNotificationCount: LOAD_COUNT,
    controlledOutboxCount: OUTBOX_COUNT,
    remainingNotificationCount: saved.notifications.length,
    operationDurationsMs,
    totalDurationMs,
    storeSizeBytes: stat.size,
    storeDiskWriteCount: storeMetrics.diskWriteCount,
    storeSelectiveCloneUpdateCount: storeMetrics.selectiveCloneUpdateCount,
    storeShallowCloneUpdateCount: storeMetrics.shallowCloneUpdateCount,
    storeTrustedSnapshotCommitCount: storeMetrics.trustedSnapshotCommitCount,
    storeCompactWriteCount: storeMetrics.compactWriteCount,
    storeStringifyMs: storeMetrics.stringifyMs,
    storeEventLoopDelayP95Ms: storeMetrics.eventLoopDelayP95Ms,
    measuredEventLoopDelayP95Ms: eventLoopDelayP95Ms,
    heapDeltaBytes,
    maxSseConnections,
    finalSseConnections: runtime.getSseClientCount(),
    unexpectedHttp5xxCount: http5xxCount,
    measurementScope: "post-initialization warm-snapshot HTTP operations",
    safeguards: {
      pageLimit: 100, bulkLimit: 100, dedupeHistoryPreserved: true,
      pendingOutboxCancelledOnDelete: true, durableJsonReopenVerified: true
    }
  };
  await fs.mkdir(path.dirname(metricsFile), { recursive: true });
  await fs.writeFile(metricsFile, JSON.stringify(evidence, null, 2) + "\n", "utf8");

  const persisted = JSON.parse(await fs.readFile(dataFile, "utf8"));
  assert.equal(persisted.notifications.length, LOAD_COUNT - deleteIds.length);
  assert.equal(readIds.every((id) => persisted.notifications.some((item) => item.id === id && item.readAt)), true,
    "toplu okuma atomik JSON yeniden açılışında korunmalı");
  assert.equal(deleteIds.every((id) => !persisted.notifications.some((item) => item.id === id)), true,
    "toplu silme atomik JSON yeniden açılışında korunmalı");
  assert.equal(persisted.notificationOutbox.filter((item) => deleteIds.includes(item.notificationId))
    .every((item) => item.status === "cancelled"), true, "iptal edilen outbox kayıtları diskte korunmalı");

  const reopenedStore = createFileStore(dataFile, {
    backupDir, writerLock: false, defaultPanelPassword: "load-test-only", enableEventLoopMetrics: false
  });
  try {
    const reopened = await reopenedStore.ensure();
    assert.equal(reopened.notifications.length, LOAD_COUNT - deleteIds.length,
      "trusted commit yeni store örneğiyle yeniden açılabilmeli");
    assert.equal(readIds.every((id) => reopened.notifications.some((item) => item.id === id && item.readAt)), true);
    assert.equal(deleteIds.every((id) => !reopened.notifications.some((item) => item.id === id)), true);
  } finally {
    await reopenedStore.close();
  }

  assert.equal(http5xxCount, 0);
  assert.equal(runtime.getSseClientCount(), 0);
  assert.ok(stat.size < 50 * 1024 * 1024, `store beklenenden büyük: ${stat.size}`);
  assert.ok(storeMetrics.diskWriteCount <= 3, `sınırlı işlemler fazla store yazdı: ${storeMetrics.diskWriteCount}`);
  assert.equal(storeMetrics.trustedSnapshotCommitCount, 2, "başarılı iki bulk işlem trusted snapshot kullanmalı");
  assert.equal(storeMetrics.compactWriteCount, 2, "başarılı iki bulk işlem compact atomik yazılmalı");
  assert.equal(storeMetrics.shallowCloneUpdateCount, 3,
    "iki başarılı ve bir izole edilmiş bulk istek sığ copy-on-write yolunu kullanmalı");
  assert.ok(operationDurationsMs.list < 500, `listeleme çok uzun sürdü: ${operationDurationsMs.list} ms`);
  assert.ok(operationDurationsMs.unreadCount < 200, `okunmamış sayacı çok uzun sürdü: ${operationDurationsMs.unreadCount} ms`);
  assert.ok(operationDurationsMs.bulkRead100 < 750, `100 kayıtlık toplu okuma çok uzun sürdü: ${operationDurationsMs.bulkRead100} ms`);
  assert.ok(operationDurationsMs.bulkDelete50 < 750, `50 kayıtlık toplu silme çok uzun sürdü: ${operationDurationsMs.bulkDelete50} ms`);
  assert.ok(eventLoopDelayP95Ms < 250, `event-loop p95 çok yüksek: ${eventLoopDelayP95Ms} ms`);
  assert.ok(heapDeltaBytes < 256 * 1024 * 1024, `bellek artışı çok yüksek: ${heapDeltaBytes}`);
  assert.ok(totalDurationMs < 30_000, `yük testi çok uzun sürdü: ${totalDurationMs} ms`);
});

function loadFixture() {
  const data = migrateStore({});
  const baseTime = Date.parse("2026-09-01T00:00:00.000Z");
  data.notifications = Array.from({ length: LOAD_COUNT }, (_, index) => {
    const id = `load-n-${String(index).padStart(5, "0")}`;
    const createdAt = new Date(baseTime + index * 1000).toISOString();
    return {
      id, recipientRole: "manager", recipientId: "manager", appTarget: index % 2 ? "yonetici" : "personel",
      category: index % 2 ? "stock" : "shipment", eventType: index % 2 ? "stock_threshold_crossed" : "shipment_reported",
      title: `Sentetik bildirim ${index}`, body: "İzole PAKET 3 yük testi kaydı.", severity: index % 11 ? "info" : "warning",
      deepLink: index % 2 ? "/yonetici/?section=stock" : "/personel/?section=notifications",
      dedupeKey: `load:${id}`, inAppVisible: true, createdAt, updatedAt: createdAt,
      readAt: index % 3 === 0 ? createdAt : null, archivedAt: index % 10 === 0 ? createdAt : null,
      metadata: { synthetic: true, index }
    };
  });
  data.notificationDedupe = data.notifications.map((item) => ({
    fingerprint: `manager|manager|${item.dedupeKey}`,
    recipientRole: "manager", recipientId: "manager", dedupeKey: item.dedupeKey,
    notificationId: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt
  }));
  data.notificationOutbox = data.notifications.slice(0, OUTBOX_COUNT).map((item, index) => ({
    id: `load-o-${String(index).padStart(5, "0")}`, notificationId: item.id,
    recipientRole: "manager", recipientId: "manager", channel: "push", status: "pending",
    attemptCount: 0, nextAttemptAt: item.createdAt, dedupeKey: `push:${item.id}`,
    destination: `https://push.invalid/${index}`, createdAt: item.createdAt, updatedAt: item.updatedAt
  }));
  return data;
}

async function measured(operation) {
  const started = performance.now();
  await operation();
  return round(performance.now() - started);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(predicate(), true, "beklenen runtime durumu zamanında oluşmadı");
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function loadFingerprint(id) {
  return crypto.createHash("sha256").update(`manager\u0000manager\u0000load:${id}`).digest("hex");
}
