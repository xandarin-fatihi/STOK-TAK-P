"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Personel profil formu kişisel bilgiler ile görünüm alanını bağımsız sütunlara ayırır", () => {
  const html = read("PERSONEL/index.html");

  assert.match(html, /<div class="profile-details-column">[\s\S]*class="profile-hero"[\s\S]*class="form-grid two"/);
  assert.match(html, /<label class="wide"><span>Profil fotoğrafı<\/span><input id="profilePhotoInput"/);
  assert.match(html, /<section class="profile-appearance-section">[\s\S]*id="profileAppearance"/);
  assert.match(html, /\/personel\/personel-profile\.css\?v=20260927-profile-layout-v1/);
});

test("Personel profil düzeni masaüstünde tam genişlikte iki sütun, mobilde taşmasız tek sütun kullanır", () => {
  const styles = read("PERSONEL/personel-profile.css");

  assert.match(styles, /data-active-section="profile"\]\s+\.profile-section\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*none;[\s\S]*?min-width:\s*0;/);
  assert.match(styles, /data-active-section="profile"\]\s+\.profile-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?width:\s*100%;/);
  assert.match(styles, /@media \(min-width:\s*1180px\)[\s\S]*?grid-template-columns:\s*minmax\(320px,\s*\.78fr\)\s+minmax\(500px,\s*1\.22fr\);/);
  assert.match(styles, /#profileBio\s*\{[\s\S]*?min-height:\s*clamp\(170px,\s*16vw,\s*220px\);/);
  assert.match(styles, /\.appearance-preset-grid\s*\{[\s\S]*?minmax\(min\(100%,\s*160px\),\s*1fr\)/);
  assert.match(styles, /\.profile-card\s+:is\(input,\s*textarea\)\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*?minmax\(min\(100%,\s*135px\),\s*1fr\)/);
  assert.match(styles, /@media \(max-width:\s*540px\)[\s\S]*?\.profile-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/);
});

test("Personel profil stili çevrimdışı kabuğa aynı sürümle eklenir", () => {
  const html = read("PERSONEL/index.html");
  const worker = read("PERSONEL/sw.js");
  const asset = "/personel/personel-profile.css?v=20260927-profile-layout-v1";

  assert.ok(html.includes(asset));
  assert.ok(worker.includes(asset));
});
