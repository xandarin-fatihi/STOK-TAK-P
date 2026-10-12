"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const failures = [];
const customerTokens = ["tah" + "misci", "tah" + "misçi", "bo" + "zzy", "uze" + "yir", "xan" + "dar"];
const customerPattern = new RegExp(customerTokens.join("|"), "iu");
const forbiddenTechnicalPatterns = [
  new RegExp(["--panel", "coffee\\b"].join("-"), "i"),
  /x-(?:tah|boz)[a-z-]*/i,
  /(?:^|[^a-z])(?:tah|boz)[a-z]+:(?:[a-z-]+)/i,
  /(?:Tah|Boz)[A-Za-z]+(?:PWA|Bridge|Theme|Schema|Identity|Coordinator)/
];
const textExtensions = new Set([".html", ".css", ".js", ".cjs", ".mjs", ".json", ".webmanifest", ".svg", ".ps1", ".env"]);
const scanRoots = [
  "ORTAK/API/src", "ORTAK/ASSETS", "ORTAK/CSS", "ORTAK/JS",
  "PERSONEL", "YÖNETİCİ PANELİ", "LOCAL"
];
const assetMounts = { brand: "BRAND", "app-icons": "APP-ICONS", images: "IMAGES", fonts: "FONTS", scripts: "scripts" };
let scanned = 0;

function exactFile(full) {
  if (!fs.existsSync(full)) return false;
  const relative = path.relative(root, full).split(path.sep);
  let directory = root;
  for (const segment of relative) {
    if (!fs.readdirSync(directory).includes(segment)) return false;
    directory = path.join(directory, segment);
  }
  return true;
}

function assetFile(url) {
  const parts = String(url).split("/").filter(Boolean);
  const directory = assetMounts[parts[1]];
  return directory ? path.join(root, "ORTAK", "ASSETS", directory, ...parts.slice(2)) : null;
}

function scanFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);
  scanned += 1;
  if (customerPattern.test(text)) failures.push(`${relative}: müşteri adı içeriyor`);
  for (const pattern of forbiddenTechnicalPatterns) {
    if (pattern.test(text)) failures.push(`${relative}: eski teknik namespace içeriyor`);
  }
  for (const match of text.matchAll(/\/assets\/[\w./-]+\.(?:png|svg|jpg|jpeg|webp|otf|ttf)\b/g)) {
    const full = assetFile(match[0]);
    if (full && !exactFile(full)) failures.push(`${relative}: eksik/case uyumsuz asset ${match[0]}`);
  }
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (textExtensions.has(path.extname(entry.name).toLowerCase()) || entry.name.startsWith(".env")) scanFile(full);
  }
}

for (const folder of scanRoots) walk(path.join(root, folder));
for (const file of ["ORTAK/package.json", "ORTAK/package-lock.json"]) scanFile(path.join(root, file));

const brandDirectory = path.join(root, "ORTAK", "ASSETS", "BRAND");
const packagedBrandFiles = fs.readdirSync(brandDirectory).filter((name) => name !== "neutral-mark.svg");
if (packagedBrandFiles.length) failures.push(`nötr olmayan paket marka assetleri: ${packagedBrandFiles.join(", ")}`);

const sharedPwaIconNames = ["favicon-32.png", "favicon-48.png", "apple-touch-icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "master-1024.png", "notification-badge-96.png"];
for (const app of ["yonetici", "personel"]) {
  for (const name of sharedPwaIconNames) {
    const full = path.join(root, "ORTAK", "ASSETS", "APP-ICONS", app, name);
    if (!exactFile(full)) failures.push(`eksik PWA ikonu ${app}/${name}`);
  }
}

const manifests = [
  ["YÖNETİCİ PANELİ/PWA/manifest.webmanifest", "Yönetici Paneli"],
  ["PERSONEL/manifest.webmanifest", "Personel Paneli"]
];
for (const [file, expectedName] of manifests) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  if (manifest.name !== expectedName) failures.push(`${file}: nötr manifest adı bekleniyor (${expectedName})`);
}

if (fs.existsSync(path.join(root, "ORTAK", "BRAND-CHECK.js"))) failures.push("eski marka kontrol dosyası kaldırılmamış");

if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`White-label kontrolü: ${scanned} runtime kaynağı, nötr marka asseti ve iki rol ikon seti temiz.`);
}
