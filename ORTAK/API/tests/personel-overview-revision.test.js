"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("PERSONEL/index.html");
const shell = read("PERSONEL/personel.js");
const workforce = read("PERSONEL/workforce.js");
const css = read("PERSONEL/personel-overview.css");
const worker = read("PERSONEL/sw.js");

test("Personel sidebar yalnız istenen yedi sekmeyi doğru sırada gösterir", () => {
  const labels = [...html.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Genel Bakış", "Stok", "Malzeme Nerede?", "Malzeme Talebi", "İzin Talebi", "Sevkiyat", "Görevlerim"]);
  for (const removed of ["stockAction", "count", "notifications", "profile"]) {
    assert.doesNotMatch(html, new RegExp(`class="personel-nav"[\\s\\S]*data-section="${removed}"`));
  }
  assert.match(html, /id="sectionProfile"/);
  assert.match(html, /id="sidebarUser"[^>]+aria-label="Personel profil menüsü"/);
  assert.match(html, /id="personelNotificationTrigger"[^>]+aria-controls="personelNotificationDrawer"/);
});

test("Genel Bakış gerçek veri özetlerini ve iki listeyi örnek veri yazmadan sunar", () => {
  for (const label of ["Kritik Stoklar", "Bekleyen Sevkiyatlar", "Açık Malzeme Talepleri", "Toplam Ürün"]) {
    assert.ok(html.includes(label), `${label} kartı eksik`);
  }
  assert.equal((html.match(/class="personel-summary-card/g) || []).length, 4);
  assert.match(html, /id="overviewCriticalList"/);
  assert.match(html, /id="overviewMovementList"/);
  assert.match(shell, /readPersonelData\("\/api\/workforce\/stock\/movements\?limit=200"\)/);
  assert.match(workforce, /scope:\s*scopes\.join\(","\)/);
  assert.doesNotMatch(html.slice(html.indexOf('id="sectionHome"'), html.indexOf('id="sectionBarcode"')), /Rulman|Civata|örnek işlem/i);
});

test("eski personel sekmeleri güvenli hedeflere yönlenir ve başlık tekrarı gizlenir", () => {
  assert.match(shell, /stockAction:\s*"stock"/);
  assert.match(shell, /count:\s*"stock"/);
  assert.match(shell, /notifications:\s*"home"/);
  assert.match(shell, /newProduct:\s*"materialLocation"/);
  assert.match(shell, /const resolved = LEGACY_SECTION_REDIRECTS\[saved\] \|\| saved/);
  assert.match(shell, /els\.sectionKicker\.hidden = overview/);
  assert.match(shell, /els\.sectionDescription\.hidden = overview/);
  assert.doesNotMatch(html, /id="sectionStockAction"|id="sectionCount"|id="sectionNotifications"/);
});

test("Genel Bakış ortak okuyucu ve tek canlı bağlantıyla eşzamanlı istekleri birleştirir", () => {
  assert.match(shell, /readPromises:\s*new Map\(\)/);
  assert.match(shell, /if \(state\.readPromises\.has\(key\)\) return state\.readPromises\.get\(key\)/);
  assert.match(workforce, /MenuSuitePersonelShell\?\.read/);
  assert.equal((shell.match(/new EventSource\(/g) || []).length, 1);
  assert.doesNotMatch(shell, /setInterval\([^)]*loadOverview/);
  assert.match(shell, /scheduleOverviewRefresh\(\["stock", "movements"\]\)/);
  assert.match(shell, /scheduleOverviewRefresh\(\["workforce"\]\)/);
  assert.match(shell, /Promise\.allSettled\(\[stockTask, movementTask, workforceTask\]\)/);
  assert.match(shell, /overviewSources:\s*\{[\s\S]*stock:[\s\S]*movements:[\s\S]*workforce:/);
});

test("Genel Bakış kartları sekme değiştirmeden tek ortak ayrıntı penceresini kullanır", () => {
  assert.equal((html.match(/id="personelOverviewDialog"/g) || []).length, 1);
  assert.match(html, /id="personelOverviewDialogShell"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(html, /data-overview-action="movements">Tümünü Gör/);
  const actionBody = shell.slice(shell.indexOf("function handleOverviewAction"), shell.indexOf("function openOverviewProduct"));
  const productBody = shell.slice(shell.indexOf("function openOverviewProduct"), shell.indexOf("function scheduleOverviewRefresh"));
  assert.doesNotMatch(actionBody, /setSection\(|openPendingShipments|openOpenRequests/);
  assert.doesNotMatch(productBody, /setSection\(|openStockDetail/);
  assert.match(actionBody, /openOverviewDialog\(action/);
  assert.match(productBody, /openOverviewDialog\("critical"/);
  assert.match(shell, /if \(isOverviewDialogOpen\(\)\)[\s\S]*closeOverviewDialog\(\)/);
  assert.match(shell, /trapOverviewDialogFocus\(event\)/);
});

test("Genel Bakış penceresi arama, satır genişletme, sayfalama ve kaynak bazlı yeniden deneme sağlar", () => {
  assert.match(html, /id="personelOverviewSearchInput"[^>]+type="search"/);
  assert.match(shell, /state\.overviewDialog\.query = els\.personelOverviewSearchInput\.value/);
  assert.match(shell, /data-overview-record-id/);
  assert.match(shell, /aria-expanded="\$\{expanded\}"/);
  assert.match(shell, /OVERVIEW_PAGE_SIZE = 7/);
  assert.match(shell, /data-overview-page/);
  assert.match(shell, /data-overview-retry-source/);
  assert.match(shell, /overviewSourceStateMarkup\("stock"\)/);
  assert.match(shell, /overviewSourceStateMarkup\("movements"\)/);
});

test("Genel Bakış mobil kırılımları, sabit görsel oranı ve PWA sürümü korunur", () => {
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*340px\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.personel-overview-product__media\s*\{[^}]*aspect-ratio:\s*1;/s);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /\.personel-overview-dialog-shell\s*\{[^}]*position:\s*fixed/s);
  assert.match(css, /\.personel-overview-dialog__body\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /@media \(max-width:\s*540px\)[\s\S]*width:\s*calc\(100vw - 12px\)/);
  const asset = "/personel/personel-overview.css?v=20261004-overview-dialog-v1";
  assert.ok(html.includes(asset));
  assert.ok(worker.includes(asset));
  assert.ok(html.includes("/personel/personel.js?v=20261005-storage-placement-v1"));
  assert.ok(worker.includes("/personel/personel.js?v=20261005-storage-placement-v1"));
});
