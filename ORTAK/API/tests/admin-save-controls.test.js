"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("YÖNETİCİ PANELİ/HTML/index.html");
const js = read("YÖNETİCİ PANELİ/JS/app.js");
const fragment = (start, end) => {
  const from = js.indexOf(start);
  const to = js.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} kaynakta bulunmalı`);
  return js.slice(from, to);
};
const node = () => ({
  hidden: true, disabled: false, textContent: "", innerHTML: "", dataset: {}, open: false,
  classList: { toggle() {} }, setAttribute() {}, toggleAttribute() {}
});
function controls(overrides = {}) {
  const state = { dirtyMenu: false, dirtyPanelConfig: false, saving: false, saveStatus: "clean", pendingPublishVerification: null, ...overrides };
  const els = Object.fromEntries(["saveChangesButton", "saveState", "adminUnsavedBar", "adminUnsavedDetails", "adminUnsavedSummary", "adminUnsavedList", "adminUnsavedSave", "adminUnsavedDiscard"].map((id) => [id, node()]));
  const context = vm.createContext({ state, els, escapeHTML: (value) => String(value) });
  vm.runInContext(fragment("function hasPendingChanges()", "async function discardPendingAdminChanges("), context);
  return { state, els, context, update: () => context.updateSaveControls() };
}

test("Kaydet tekil olarak Ayarlar'da; sabit üst çubukta kayıt kontrolleri yok", () => {
  const header = html.slice(html.indexOf('<header class="topbar'), html.indexOf('id="adminUnsavedBar"'));
  assert.doesNotMatch(header, /id="(?:saveChangesButton|saveState)"/);
  const settings = html.slice(html.indexOf('id="panelSettingsCard"'), html.indexOf('id="adminAppearanceSettings"'));
  assert.match(settings, /id="saveChangesButton"[^>]*>Kaydet<\/button>/);
  assert.match(settings, /id="saveState" role="status"/);
  for (const id of ["saveChangesButton", "saveState"]) assert.equal(html.split(`id="${id}"`).length - 1, 1);
  assert.doesNotMatch(html + js, /Kaydet ve Yayınla/);
  for (const id of ["saveChangesButton", "adminUnsavedSave"]) assert.ok(js.includes(`els.${id}.addEventListener("click", handleSaveButtonClick)`));
  assert.match(js, /beforeunload/);
  for (const asset of ["scripts/app.js", "styles/admin-chrome.css"]) {
    const url = `${asset}?v=${asset === "scripts/app.js" ? "20261007-catalog-barcode-v3" : "20261007-settings-save-v1"}`;
    assert.ok(html.includes(url));
    assert.ok(read("YÖNETİCİ PANELİ/PWA/sw.js").includes(url));
  }
});

test("temiz durumda uyarı gizli; taslak iki kayıt kontrolünü de kullanılabilir yapar", () => {
  const ui = controls();
  ui.update();
  assert.equal(ui.els.adminUnsavedBar.hidden, true);
  assert.equal(ui.els.saveChangesButton.disabled, true);
  assert.equal(ui.els.saveChangesButton.textContent, "Kaydet");
  for (const scope of ["dirtyMenu", "dirtyPanelConfig"]) {
    ui.state[scope] = true;
    ui.update();
    assert.equal(ui.els.adminUnsavedBar.hidden, false);
    assert.equal(ui.els.saveChangesButton.disabled, false);
    assert.equal(ui.els.adminUnsavedSave.disabled, false);
    assert.equal(ui.els.adminUnsavedSave.textContent, "Kaydet");
    ui.state[scope] = false;
  }
  ui.state.saveStatus = "published";
  ui.update();
  assert.equal(ui.els.adminUnsavedBar.hidden, true);
  assert.equal(ui.els.saveState.textContent, "Kaydedildi");
});

test("kayıt ve doğrulama sırasında çift işlem engeli, doğrulanamayan kayıtta tekrar doğrulama korunur", () => {
  const ui = controls({ dirtyPanelConfig: true, saving: true });
  ui.update();
  for (const id of ["saveChangesButton", "adminUnsavedSave", "adminUnsavedDiscard"]) assert.equal(ui.els[id].disabled, true);
  assert.equal(ui.els.saveChangesButton.textContent, "Kaydediliyor...");
  ui.state.pendingPublishVerification = { requestId: "test" };
  ui.update();
  assert.equal(ui.els.saveChangesButton.textContent, "Doğrulanıyor...");
  ui.state.saving = false;
  ui.update();
  for (const id of ["saveChangesButton", "adminUnsavedSave"]) {
    assert.equal(ui.els[id].disabled, false);
    assert.equal(ui.els[id].textContent, "Kaydı Doğrula");
  }
  assert.equal(ui.els.adminUnsavedBar.hidden, false);
  assert.equal(ui.els.adminUnsavedDiscard.disabled, true);
  assert.equal(ui.state.dirtyPanelConfig, true);
});

test("hata ve veri çakışması uyarısı kaybolmaz", () => {
  for (const saveStatus of ["error", "conflict", "unverified"]) {
    const ui = controls({ saveStatus });
    ui.update();
    assert.equal(ui.els.adminUnsavedBar.hidden, false);
    assert.equal(ui.els.saveState.dataset.saveStatus, saveStatus);
  }
});

test("Ayarlar Kaydet aynı revizyonlu, idempotent POST ve sunucu doğrulamasını çalıştırır", async () => {
  const ui = controls({ dirtyPanelConfig: true, publishRevision: 7 });
  const requests = [];
  let verified = false;
  Object.assign(ui.context, {
    captureCurrentEditorState() {}, saveCoordinator: null,
    backendBaseUrl: () => "http://localhost:6075",
    createPublishSnapshot: () => ({ changes: { panelConfig: { theme: "test" } } }),
    createRequestId: () => "test-save-id", cloneData: (value) => structuredClone(value),
    panelConfigFingerprint: () => "test-fingerprint",
    backendRequest: async (url, options) => { requests.push({ url, options }); return { revision: 8 }; },
    verifyPendingPublishReadback: async () => { verified = true; return { ok: true, verified: true }; },
    window: { setTimeout() {} }, alert() {}, console
  });
  vm.runInContext(fragment("function savePendingChanges()", "async function verifyPendingPublishReadback()"), ui.context);
  const result = await ui.context.savePendingChanges();
  assert.equal(result.verified, true);
  assert.equal(verified, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/admin/publish");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["Idempotency-Key"], "test-save-id");
  assert.equal(requests[0].options.body.expectedRevision, 7);
  assert.equal(ui.state.pendingPublishVerification.requestId, "test-save-id");
  assert.equal(ui.state.saving, false);
  // Yeniden doğrulama ikinci bir POST oluşturmamalı.
  ui.context.retryPendingPublishVerification = async () => ({ ok: true, verified: true });
  await ui.context.savePendingChanges();
  assert.equal(requests.length, 1);
  ui.state.pendingPublishVerification = null;
  ui.state.dirtyPanelConfig = false;
  const clean = await ui.context.savePendingChanges();
  assert.equal(clean.unchanged, true);
  assert.equal(requests.length, 1);
});

test("sunucu tekrar okuması eşleşmeden taslak temizlenmez; başarılı doğrulama da korunur", async () => {
  for (const outcome of ["success", "old-revision", "different-data", "network-error"]) {
    const pending = {
      snapshot: { changes: { panelConfig: { theme: "test" } } },
      publishResult: { revision: 8 }, expectedServerPanelConfigFingerprint: "server-fp", expectedPanelConfigFingerprint: "test", lastError: ""
    };
    const ui = controls({ dirtyPanelConfig: true, pendingPublishVerification: pending });
    let completed = false;
    Object.assign(ui.context, {
      backendRequest: async () => {
        if (outcome === "network-error") throw new Error("offline");
        return { revision: outcome === "old-revision" ? 7 : 8, panelConfigFingerprint: "server-fp", panelConfig: { theme: outcome === "different-data" ? "different" : "test" } };
      },
      syncPublishRevision() {}, panelConfigFingerprint: (config) => config.theme,
      completePublishedVerification() { completed = true; ui.state.dirtyPanelConfig = false; ui.state.pendingPublishVerification = null; }
    });
    vm.runInContext(fragment("async function verifyPendingPublishReadback()", "function retryPendingPublishVerification()") + fragment("function createPublishVerificationError(", "function completePublishedVerification("), ui.context);
    if (outcome === "success") {
      assert.equal((await ui.context.verifyPendingPublishReadback()).verified, true);
      assert.equal(completed, true);
    } else {
      await assert.rejects(ui.context.verifyPendingPublishReadback(), (error) => error.publishAccepted === true);
      assert.equal(completed, false);
      assert.equal(ui.state.dirtyPanelConfig, true);
      assert.equal(ui.state.pendingPublishVerification, pending);
      assert.equal(ui.els.adminUnsavedBar.hidden, false);
    }
  }
});
