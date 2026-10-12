"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..", "..");
const clientSource = fs.readFileSync(path.join(root, "ORTAK", "JS", "pwa-client.js"), "utf8");
const workerSource = fs.readFileSync(path.join(root, "ORTAK", "JS", "pwa-sw-runtime.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "ORTAK", "CSS", "pwa-ui.css"), "utf8");
const configSource = fs.readFileSync(path.join(root, "ORTAK", "API", "src", "config.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "ORTAK", "API", "src", "app.js"), "utf8");
const envExample = fs.readFileSync(path.join(root, "LOCAL", ".env.example"), "utf8");
const appWorkerSources = [
  path.join(root, "PERSONEL", "sw.js"),
  path.join(root, "YÖNETİCİ PANELİ", "PWA", "sw.js")
].map((file) => fs.readFileSync(file, "utf8"));
const {
  normalizePwaReleaseMetadata,
  normalizePwaReleaseNotes,
  serializePwaReleaseMetadata
} = require("../src/pwa-release-metadata");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

test("PWA sürüm metadata'sı tek cümlelik maddelere indirgenir ve betik bağlamında güvenle serileştirilir", () => {
  assert.deepEqual(normalizePwaReleaseNotes([
    "  İlk iyileştirme tamamlandı. İkinci cümle gösterilmemeli.",
    "İkinci madde eklendi",
    "İkinci madde eklendi"
  ]), ["İlk iyileştirme tamamlandı.", "İkinci madde eklendi."]);

  const metadata = normalizePwaReleaseMetadata({
    id: "Sürüm </script> 42",
    notes: ["<img src=x onerror=alert(1)> güvenli metin"]
  });
  assert.match(metadata.id, /^[a-z0-9._-]+$/i);
  assert.equal(metadata.notes.length, 1);

  const serialized = serializePwaReleaseMetadata(metadata);
  assert.doesNotMatch(serialized, /[<>]/);
  const sandbox = { self: {} };
  vm.runInNewContext(`self.release = ${serialized};`, sandbox);
  assert.equal(JSON.stringify(sandbox.self.release), JSON.stringify(metadata));
});

test("PWA sürüm config'i env ve güvenli varsayılanla dinamik route'a bağlanır", () => {
  assert.match(envExample, /^PWA_RELEASE_ID=/m);
  assert.match(envExample, /^PWA_RELEASE_NOTES=/m);
  assert.match(configSource, /pwaReleaseNotes:\s*normalizePwaReleaseNotes\(process\.env\.PWA_RELEASE_NOTES\)/);
  assert.match(appSource, /serializePwaReleaseMetadata\(\{ id: config\.pwaReleaseId, notes: config\.pwaReleaseNotes \}\)/);
  assert.match(appSource, /Cache-Control": "no-cache, must-revalidate"/);
});

test("iki panel service worker branch'i GET_VERSION ile güvenli release metadata'sı döndürür", () => {
  for (const appId of ["yonetici", "personel"]) {
    const listeners = new Map();
    const self = {
      MENU_SUITE_PWA_CONFIG: {
        appId,
        version: "cache-v42",
        offlineUrl: "/offline.html",
        precache: [],
        offlineAssets: []
      },
      MENU_SUITE_PWA_RELEASE: {
        id: "release-42",
        notes: ["İlk madde. İkinci cümle yok.", "Kontrol karakteri\u0000 temizlenir"]
      },
      location: { hostname: "example.test", origin: "https://example.test" },
      addEventListener(type, listener) {
        const values = listeners.get(type) || [];
        values.push(listener);
        listeners.set(type, values);
      }
    };
    vm.runInNewContext(workerSource, { self, console });
    const payloads = [];
    for (const listener of listeners.get("message") || []) {
      listener({
        data: { type: "GET_VERSION" },
        ports: [{ postMessage(payload) { payloads.push(payload); } }]
      });
    }
    assert.equal(payloads.length, 1, `${appId} branch'i tek cevap vermeli`);
    assert.equal(payloads[0].appId, appId);
    assert.equal(payloads[0].version, "cache-v42");
    assert.equal(JSON.stringify(payloads[0].release), JSON.stringify({
      id: "release-42",
      notes: ["İlk madde.", "Kontrol karakteri temizlenir."]
    }));
  }
});

test("Kurulum kartı iki panelde yalnız açık kullanıcı reddinden sonra 30 gün ertelenir", async (t) => {
  for (const appId of ["yonetici", "personel"]) {
    await t.test(appId, async () => {
      const storage = new FakeStorage();
      const first = createClientRuntime(appId, storage);
      const firstPrompt = installPromptEvent("accepted");
      first.window.emit("beforeinstallprompt", firstPrompt);
      const firstCard = findNotice(first.document.body, "install");
      assert.ok(firstCard, "kart gösterilmeli");
      assert.equal(storage.size, 0, "kartın yalnız görünmesi erteleme yazmamalı");

      findByClass(firstCard, "pwa-notice__close").emit("click", {});
      const key = `menu-suite:pwa-install-dismissed:${appId}:v1`;
      const closedRecord = JSON.parse(storage.getItem(key));
      assert.equal(closedRecord.reason, "notice-dismissed");
      assert.equal(closedRecord.nextEligibleAt - closedRecord.dismissedAt, THIRTY_DAYS_MS);

      const snoozed = createClientRuntime(appId, storage);
      const manualPrompt = installPromptEvent("accepted");
      snoozed.window.emit("beforeinstallprompt", manualPrompt);
      assert.equal(findNotice(snoozed.document.body, "install"), null, "erteleme süresinde otomatik kart bastırılmalı");
      assert.equal(await snoozed.window.MenuSuitePWA.promptInstall(), true, "profil eylemi manuel prompt'u açabilmeli");
      assert.equal(manualPrompt.promptCalls, 1);

      const dismissalStorage = new FakeStorage();
      const dismissed = createClientRuntime(appId, dismissalStorage);
      const dismissedPrompt = installPromptEvent("dismissed");
      dismissed.window.emit("beforeinstallprompt", dismissedPrompt);
      assert.equal(await dismissed.window.MenuSuitePWA.promptInstall(), false);
      const dismissedRecord = JSON.parse(dismissalStorage.getItem(key));
      assert.equal(dismissedRecord.reason, "prompt-dismissed");
      assert.equal(dismissedRecord.nextEligibleAt - dismissedRecord.dismissedAt, THIRTY_DAYS_MS);

      const standalone = createClientRuntime(appId, new FakeStorage(), { standalone: true });
      standalone.window.emit("beforeinstallprompt", installPromptEvent("accepted"));
      assert.equal(findNotice(standalone.document.body, "install"), null, "standalone modunda kart daima bastırılmalı");
      assert.equal(standalone.window.MenuSuitePWA.canInstall(), false);
    });
  }
});

test("İki PWA client branch'i release notlarını güvenli ul listesinde gösterir ve dirty-state yolu erişilebilirdir", () => {
  assert.equal((clientSource.match(/worker\.postMessage\(\{ type: "GET_VERSION" \}/g) || []).length, 2);
  assert.equal((clientSource.match(/document\.createElement\("ul"\)/g) || []).length, 2);
  assert.equal((clientSource.match(/item\.textContent = note/g) || []).length, 2);
  assert.equal((clientSource.match(/installSnoozeMs = 30 \* 24 \* 60 \* 60 \* 1000/g) || []).length, 2);
  assert.doesNotMatch(clientSource, /rememberInstallDismissal|hasDismissedInstallNotice|"shown"/);
  assert.doesNotMatch(clientSource, /controllerChangeHandled \|\| !updateRequested/);
  assert.match(clientSource, /\(!hadControllerAtLoad && !updateRequested\)/);
  assert.match(cssSource, /\.pwa-notice__notes\s*\{/);
});

test("PWA kartı iki panelde uygulama modal ve bildirim çekmecelerinin alt katmanında kalır", () => {
  assert.match(cssSource, /\.pwa-notice\s*\{[^}]*z-index:\s*var\(--pwa-notice-layer,\s*200\)/s);
  assert.match(cssSource, /html\[data-pwa-app="yonetici"\],\s*html\[data-pwa-app="personel"\]\s*\{[^}]*--pwa-notice-layer:\s*1100/s);
  assert.doesNotMatch(cssSource, /data-pwa-app="(?:menu|muhasebe)"/);
  assert.doesNotMatch(cssSource, /\.pwa-notice\s*\{[^}]*z-index:\s*100000/s);
  assert.equal(appWorkerSources.every((source) => /-pwa-layer-v1(?:-fixes-20261011-v\d+)?`/.test(source)), true,
    "katman düzeltmesi tüm uygulama worker cache anahtarlarını yenilemeli");
});

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const values = this.listeners.get(type) || [];
    values.push(listener);
    this.listeners.set(type, values);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener.call(this, event);
  }
}

class FakeNode extends FakeTarget {
  constructor(tagName = "div") {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = "";
    this.parentNode = null;
    this.isConnected = false;
    this.textContent = "";
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      node.setConnected(this.isConnected);
      this.children.push(node);
    }
  }

  setConnected(value) {
    this.isConnected = value;
    for (const child of this.children) child.setConnected(value);
  }

  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
    this.setConnected(false);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  focus() {}
}

class FakeStorage {
  constructor() {
    this.values = new Map();
  }

  get size() {
    return this.values.size;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function createClientRuntime(appId, localStorage, options = {}) {
  const window = new FakeTarget();
  const document = new FakeTarget();
  document.documentElement = new FakeNode("html");
  document.documentElement.dataset = {
    pwaApp: appId,
    pwaWorker: "",
    pwaScope: "",
    brandName: "Test uygulaması"
  };
  document.body = new FakeNode("body");
  document.body.setConnected(true);
  document.forms = [];
  document.activeElement = null;
  document.visibilityState = "visible";
  document.createElement = (tagName) => new FakeNode(tagName);
  document.querySelector = (selector) => findBySelector(document.body, selector);
  document.contains = (node) => Boolean(node && node.isConnected);

  window.localStorage = localStorage;
  window.matchMedia = () => ({ matches: Boolean(options.standalone) });
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  window.requestAnimationFrame = (callback) => callback();
  window.location = { hostname: "example.test", reload() {} };
  window.confirm = () => true;

  const navigator = { onLine: true, standalone: Boolean(options.standalone) };
  window.navigator = navigator;
  const context = vm.createContext({
    window,
    document,
    navigator,
    location: window.location,
    HTMLElement: FakeNode,
    HTMLFormElement: class FakeForm extends FakeNode {},
    console,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(clientSource, context);
  return { window, document };
}

function installPromptEvent(outcome) {
  return {
    promptCalls: 0,
    preventDefault() {},
    prompt() {
      this.promptCalls += 1;
      return Promise.resolve();
    },
    userChoice: Promise.resolve({ outcome })
  };
}

function findNotice(rootNode, kind) {
  return findNode(rootNode, (node) => node.dataset && node.dataset.pwaNotice === kind);
}

function findByClass(rootNode, className) {
  return findNode(rootNode, (node) => String(node.className || "").split(/\s+/).includes(className));
}

function findBySelector(rootNode, selector) {
  if (selector.startsWith(".")) return findByClass(rootNode, selector.slice(1));
  return null;
}

function findNode(rootNode, predicate) {
  if (predicate(rootNode)) return rootNode;
  for (const child of rootNode.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}
