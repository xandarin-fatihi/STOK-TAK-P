"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("YÖNETİCİ PANELİ/HTML/index.html");

test("canlı önizleme yüklenmez; referans tasarım yalnız inert template içinde kalır", () => {
  assert.match(html, /<html[^>]*data-live-preview-enabled="false"/);
  assert.doesNotMatch(html, /<script[^>]*src=["'][^"']*live-preview\.js/);
  const template = html.match(/<template id="disabledLivePreviewTemplate">[\s\S]*?<\/template>/);
  assert.ok(template, "Referans tasarım geri alınabilir şekilde korunmalı");
  assert.match(template[0], /data-global-preview-trigger/);
  assert.match(template[0], /data-global-preview-drawer/);
  const activeHtml = html.replace(template[0], "");
  assert.doesNotMatch(activeHtml, /data-global-preview-(?:trigger|drawer|host)/);
  // Gerçek panel kontrolleri önizleme şablonuna alınmamalı.
  for (const id of ["adminNotificationOverlay", "saveChangesButton"]) {
    assert.ok(activeHtml.includes(`id="${id}"`));
  }
});

test("PWA önizlemeyi önbellek için indirmez ve yeni sürüme geçer", () => {
  const sw = read("YÖNETİCİ PANELİ/PWA/sw.js");
  assert.doesNotMatch(sw, /live-preview\.js/);
  assert.match(sw, /live-preview-off-v1/);
  assert.match(sw, /catalog-barcode\.js/);
  assert.match(sw, /self\.addEventListener\("push"/);
});

test("yanlışlıkla yüklenen önizleme modülü de iş yapmadan çıkar", () => {
  const unexpected = () => { assert.fail("Devre dışı modül arka plan işi başlatmamalı"); };
  const document = {
    documentElement: { dataset: { livePreviewEnabled: "false" } },
    addEventListener: unexpected,
    querySelector: unexpected
  };
  const window = { addEventListener: unexpected, setTimeout: unexpected, setInterval: unexpected };
  vm.runInNewContext(read("YÖNETİCİ PANELİ/JS/live-preview.js"), {
    document, window, fetch: unexpected, ResizeObserver: unexpected,
    setTimeout: unexpected, setInterval: unexpected, BroadcastChannel: unexpected
  });
  assert.equal(window.MenuSuiteLivePreview, undefined);
});

test("önizleme modülü olmadan taslak bildirimi güvenle çalışır", () => {
  const js = read("YÖNETİCİ PANELİ/JS/app.js");
  const from = js.indexOf("function notifyLivePreviewDraft()");
  assert.ok(from >= 0);
  const to = js.indexOf("\n  }", from) + 4;
  const context = vm.createContext({ window: {} });
  vm.runInContext(js.slice(from, to), context);
  assert.doesNotThrow(() => context.notifyLivePreviewDraft());
});
