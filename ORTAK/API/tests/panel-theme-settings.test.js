"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const adminHtml = read("YÖNETİCİ PANELİ", "HTML", "index.html");
const adminScript = read("YÖNETİCİ PANELİ", "JS", "app.js");
const personelHtml = read("PERSONEL", "index.html");
const moduleHtml = read("YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE", "index.html");
const moduleScript = read("YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE", "scripts", "app.js");

test("tema seçimi yalnız iki ana panel kabuğunda sunulur", () => {
  assert.match(adminHtml, /\/shared\/scripts\/panel-theme\.js/);
  assert.match(personelHtml, /\/shared\/scripts\/panel-theme\.js/);
  assert.doesNotMatch(moduleHtml, /theme-settings\.js/);
  assert.equal(fs.existsSync(path.join(root, "YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE", "scripts", "theme-settings.js")), false);
});

test("Yönetici tema tokenlarını entegre modüle güvenli postMessage ile iletir", () => {
  assert.match(adminScript, /source:\s*"menu-suite:admin"/);
  assert.match(adminScript, /type:\s*"theme"/);
  assert.match(moduleScript, /event\.origin !== window\.location\.origin/);
  assert.match(moduleScript, /event\.source !== window\.parent/);
  assert.match(moduleScript, /\^--panel-\[a-z0-9-\]\+\$/);
  assert.match(moduleScript, /document\.documentElement\.style\.setProperty/);
});

test("modül kendi PWA veya ayrı tema tercihini üretmez", () => {
  assert.doesNotMatch(moduleHtml, /rel="manifest"|data-pwa-app|data-pwa-worker/);
  assert.equal(fs.existsSync(path.join(root, "MUHASEBE")), false);
});
