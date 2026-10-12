"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const folders = ["ORTAK/API/src", "ORTAK/JS", "ORTAK/ASSETS/scripts", "YÖNETİCİ PANELİ/JS", "YÖNETİCİ PANELİ/PWA", "QR MENÜ/JS", "QR MENÜ/PWA", "PERSONEL", "MUHASEBE", "LOCAL"];
let count = 0;
function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(?:mjs|cjs|js)$/i.test(entry.name)) {
      const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8", windowsHide: true });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
      count += 1;
    }
  }
}
folders.forEach(folder => check(path.join(root, folder)));
console.log(`${count} JavaScript dosyası kontrol edildi.`);
