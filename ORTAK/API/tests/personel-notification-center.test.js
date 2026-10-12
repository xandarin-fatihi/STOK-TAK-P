"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(root, "PERSONEL", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "PERSONEL", "notifications.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "PERSONEL", "personel.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "PERSONEL", "notifications.css"), "utf8");
const compactStyles = fs.readFileSync(path.join(root, "PERSONEL", "personel-compact.css"), "utf8");
const stockShipmentStyles = fs.readFileSync(path.join(root, "PERSONEL", "personel-stock-shipment.css"), "utf8");
const foundationStyles = fs.readFileSync(path.join(root, "ORTAK", "CSS", "panel-foundation.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "PERSONEL", "sw.js"), "utf8");
const serviceWorkerRuntime = fs.readFileSync(path.join(root, "ORTAK", "JS", "pwa-sw-runtime.js"), "utf8");

function zIndexFor(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*(\\d+)`, "s"));
  assert.ok(match, `${selector} z-index değeri bulunamadı`);
  return Number(match[1]);
}

test("Personel bildirim merkezi sade, erişilebilir ve ortalanmış modal ile kalıcı tercih alanlarını sunar", () => {
  assert.equal((html.match(/id="personelNotificationTrigger"/g) || []).length, 1);
  assert.match(html, /aria-controls="personelNotificationDrawer"/);
  assert.match(html, /class="personel-notification-modal"[^>]*id="personelNotificationDrawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.doesNotMatch(html, /Personel merkezi|data-notification-category|data-notification-view|personelNotificationReadAll|personelNotificationArchiveRead|personelNotificationDeleteRead|personelNotificationClearArchive/);
  assert.match(html, /id="personelNotificationUndoRegion"[\s\S]*aria-live="polite"/);
  for (const field of [
    "emailAddress", "inAppEnabled", "emailEnabled", "taskNotifications", "shipmentNotifications",
    "shiftNotifications", "taskReminder24h", "taskReminder2h",
    "overdueReminder", "shiftReminder12h", "shiftReminder2h", "quietHoursEnabled"
  ]) assert.match(html, new RegExp(`name="${field}"`), `${field} tercihi eksik`);
  assert.doesNotMatch(html, /name="trainingNotifications"|Eğitim ve reçete programı/);
  assert.match(script, /title\.textContent = "Henüz bildirim yok"/);
  assert.doesNotMatch(script, /Yeni görev, sevkiyat, stok ve vardiya gelişmeleri burada görünecek\./);
  assert.doesNotMatch(script, /trainingNotifications|category === "training"|training:\s*"recipe"/);
});

test("Personel istemcisi canonical API, tek sade liste, SSE ve polling fallback kullanır", () => {
  assert.match(script, /API_ROOT\s*=\s*"\/api\/notifications"/);
  assert.doesNotMatch(script, /parameters\.set\("unread"|parameters\.set\("unreadOnly"|parameters\.set\("category"/);
  for (const endpoint of ["/unread-count", "/preferences", "/push-subscriptions", "/undo-delete"]) {
    assert.ok(script.includes(endpoint), `${endpoint} istemci bağlantısı eksik`);
  }
  assert.match(shell, /new EventSource\("\/api\/events\?appId=personel"/);
  assert.match(script, /personel:gateway-event/);
  assert.match(script, /startPolling/);
  assert.match(script, /handleGatewayStatus/);
  assert.match(shell, /gatewayEventSource/);
  assert.match(script, /text\.textContent = "Bildirimler alınamadı\."/);
  assert.match(script, /retry\.textContent = "Yeniden Dene"/);
  assert.match(script, /state\.notifications\.length[\s\S]*showLoadError\(\)/);
});

test("Personel push izni sadece düğme eyleminden istenir ve çıkışta abonelik kaldırılır", () => {
  const permissionCalls = [...script.matchAll(/Notification\.requestPermission\s*\(/g)];
  assert.equal(permissionCalls.length, 1);
  const enableStart = script.indexOf("async function enablePush");
  const enableEnd = script.indexOf("async function disablePush", enableStart);
  assert.ok(permissionCalls[0].index > enableStart && permissionCalls[0].index < enableEnd);
  assert.match(script, /async function beforeLogout/);
  assert.match(script, /method:\s*"DELETE"/);
  assert.match(shell, /MenuSuitePersonelNotifications\.beforeLogout/);
});

test("Personel push arayüzü durumları ayırır ve testi yalnız mevcut abonelikten gönderir", () => {
  assert.match(html, /id="personelPushTest"[^>]*hidden[^>]*>Test bildirimi gönder/);
  assert.match(script, /Telefon bildirimleri sunucuda henüz etkinleştirilmemiş\./);
  assert.match(script, /Bu tarayıcı PWA bildirimlerini desteklemiyor\./);
  assert.match(script, /Tarayıcı bildirim izni kapalı\. Site ayarlarından izin verin\./);
  assert.match(script, /Bildirim hizmeti başlatılamadı\./);
  assert.match(script, /Bildirim aboneliği sunucuya kaydedilemedi\./);
  assert.match(script, /iPhone\/iPad’de bildirimleri kullanmak için siteyi Safari’den Ana Ekran’a ekleyip oradan açın\./);
  assert.match(script, /`\$\{API_ROOT\}\/test`/);
  assert.match(script, /body:\s*\{ channels:\s*\["push"\], deviceId:\s*notificationDeviceId\(\) \}/);
  assert.match(script, /Bildirimler açık · \$\{name\} · Son kayıt:/);
});

test("Personel deep-link resolver mevcut sekmeleri, hash rotalarını ve entity hedeflerini güvenle açar", () => {
  assert.match(script, /url\.origin !== window\.location\.origin/);
  assert.match(script, /normalizePersonelNotificationSection\(url\.hash/);
  assert.match(script, /taskId/);
  assert.match(script, /assignmentId/);
  assert.match(script, /alignShiftWeek/);
  assert.match(script, /menu-suite:open-recipe-assignment/);
});

test("Personel service worker push bildirimi ve güvenli tıklama yönlendirmesini cache dışı API ile korur", () => {
  assert.match(serviceWorker, /importScripts\("\/shared\/scripts\/pwa-sw-runtime\.js"\)/);
  assert.match(serviceWorkerRuntime, /addEventListener\("push"/);
  assert.match(serviceWorkerRuntime, /showNotification/);
  assert.match(serviceWorkerRuntime, /addEventListener\("notificationclick"/);
  assert.match(serviceWorkerRuntime, /safeDeepLink/);
  assert.match(serviceWorker, /neverCachePrefixes:\s*\["\/api\/"/);
  for (const asset of ["personel-stock-shipment.css", "workforce.js", "notifications.js"]) {
    assert.ok(serviceWorker.includes(asset), `${asset} çevrimdışı kabukta eksik`);
  }
});

test("Personel bildirim stili merkezleme, mobil, odak, kaydırma ve azaltılmış hareket durumlarını kapsar", () => {
  assert.match(styles, /\.personel-notification-modal\s*\{[^}]*top:\s*50%;[^}]*left:\s*50%;[^}]*width:\s*min\(560px,\s*calc\(100vw - 32px\)\);[^}]*max-height:\s*calc\(100dvh - 32px\);[^}]*transform:\s*translate\(-50%,\s*-50%\)/s);
  assert.doesNotMatch(styles, /\.personel-notification-drawer\s*\{|inset:\s*0 0 0 auto/);
  assert.match(styles, /\.personel-notification-card__open\s*\{/);
  assert.match(styles, /\.personel-notification-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /@media \(max-width:\s*760px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /event\.key !== "Tab"/);
});

test("Personel bildirim merkezi sabit panel kontrollerinin tamamının üstünde kalır", () => {
  const backdropLayer = zIndexFor(styles, ".personel-notification-backdrop");
  const modalLayer = zIndexFor(styles, ".personel-notification-modal");
  const competingLayers = [
    zIndexFor(foundationStyles, ".profile-menu"),
    zIndexFor(compactStyles, ".wf-shipment-dialog-backdrop"),
    zIndexFor(compactStyles, ".wf-shipment-dialog"),
    zIndexFor(stockShipmentStyles, ".stock-personel-modal.stock-action-modal")
  ];

  assert.ok(backdropLayer > Math.max(...competingLayers), "bildirim perdesi arka plan kontrollerini tamamen örtmeli");
  assert.ok(modalLayer > backdropLayer, "bildirim modalı kendi perdesinin üstünde kalmalı");
});

test("Bildirim satırı ilgili kaydı açar; tekil silme geri alınabilir ve mükerrer eylemler korunur", () => {
  assert.match(script, /async function toggleNotification/);
  assert.match(script, /await navigateToNotification\(notification\)/);
  assert.match(script, /state\.expandedIds/);
  assert.match(script, /remove\.dataset\.notificationAction\s*=\s*"delete"/);
  assert.match(script, /setTimeout\(\(\) => removeUndoItem\(notification\.id\), 5000\)/);
  assert.match(script, /undo\.dataset\.notificationUndo\s*=\s*notificationId/);
  assert.match(script, /state\.pending\.has\(key\)/);
  assert.match(script, /state\.suppressedIds/);
  assert.doesNotMatch(script, /confirmDelete|Bildirimi silmek için Sil düğmesine tekrar basın/);
});
