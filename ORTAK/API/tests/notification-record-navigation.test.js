"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../../PERSONEL/notifications.js"), "utf8");
const start = source.indexOf("  async function navigateToNotification(");
const end = source.indexOf("  function alignShiftWeek(", start);

function harness(openRecord) {
  const calls = [];
  const context = {
    URL,
    CATEGORY_SECTIONS: { task: "tasks", materialRequest: "materialRequest", shift: "shift", shipment: "shipment", stock: "stock", system: "profile" },
    window: { location: { origin: "http://localhost:6075" }, MenuSuitePersonelShell: { openNotificationRecord: openRecord || (async (...args) => calls.push(args)) } },
    closeDialog: () => calls.push("closed"),
    openDialog: async () => calls.push("opened"),
    showMessage: (message, error) => calls.push({ message, error }),
    alignShiftWeek: week => calls.push({ week }),
    validDateKey: value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : ""
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  return { context, calls };
}

test("Bildirim navigasyonu liste yerine gerçek talep, görev, sevkiyat ve stok kaydına gider", async () => {
  for (const [category, section, parameter] of [
    ["materialRequest", "materialRequest", "requestId"],
    ["task", "tasks", "taskId"],
    ["shipment", "shipment", "entityId"],
    ["stock", "stock", "productId"]
  ]) {
    const { context, calls } = harness();
    await context.navigateToNotification({ category, entityId: "wrong-fallback", deepLink: `/personel/?section=${section}&${parameter}=record-1` });
    assert.deepEqual(calls, [[section, "record-1"], "closed"]);
  }
});

test("Vardiya yayın bildirimi izin kaydı aramaz; yayınlanan haftaya gider", async () => {
  const { context, calls } = harness();
  await context.navigateToNotification({ category: "shift", entityType: "shift_plan", entityId: "2026-10-12", deepLink: "/personel/?section=shift&weekStart=2026-10-12" });
  assert.deepEqual(calls, [["shift", ""], { week: "2026-10-12" }, "closed"]);
});

test("Kaldırılmış kayıt veya kapalı erişim bildirimi sessiz kalmaz", async () => {
  const { context, calls } = harness(async () => { throw new Error("Bu kayıt kaldırılmış veya erişiminiz kapalı."); });
  await context.navigateToNotification({ category: "task", entityId: "missing" });
  assert.deepEqual(calls, ["opened", { message: "Bu kayıt kaldırılmış veya erişiminiz kapalı.", error: true }]);
});

test("Harici bildirim bağlantısı hedef olarak kullanılmaz", async () => {
  const { context, calls } = harness();
  await context.navigateToNotification({ category: "materialRequest", entityId: "safe-local", deepLink: "https://example.com/personel/?section=tasks&taskId=unsafe" });
  assert.deepEqual(calls, [["materialRequest", "safe-local"], "closed"]);
});
