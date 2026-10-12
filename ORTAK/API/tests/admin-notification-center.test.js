"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const html = fs.readFileSync(path.join(root, "YÖNETİCİ PANELİ", "HTML", "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "YÖNETİCİ PANELİ", "JS", "app.js"), "utf8");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE");
const faturaHtml = fs.readFileSync(path.join(moduleRoot, "index.html"), "utf8");
const faturaScript = fs.readFileSync(path.join(moduleRoot, "scripts", "app.js"), "utf8");
const faturaStockScript = fs.readFileSync(path.join(moduleRoot, "scripts", "stock.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "YÖNETİCİ PANELİ", "CSS", "notifications.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "YÖNETİCİ PANELİ", "PWA", "sw.js"), "utf8");

test("Mal kabul ve sevkiyat arşivi menüden kalkar; kayıt ve bildirim hedefleri korunur", () => {
  const sidebar = html.slice(html.indexOf('<nav class="panel-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="panel-nav"')));
  const sections = [...sidebar.matchAll(/data-panel-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sections, ["overview", "product", "barcode", "locations", "approvals", "staffAccess", "procurementDocuments"]);
  assert.doesNotMatch(sidebar, /Mal kabul|Sevkiyat arşivi/);
  // Menü temizliği, eski kayıt/bildirim bağlantılarının açılmasını engellemez.
  const viewsStart = script.indexOf("const PROCUREMENT_SECTION_VIEWS");
  const views = script.slice(viewsStart, script.indexOf("const PANEL_THEME", viewsStart));
  assert.match(views, /receipts:\s*"receipts"/);
  assert.match(views, /shipments:\s*"shipmentArchive"/);
});

test("Yönetici bildirim merkezi tek zil, erişilebilir çekmece ve gerçek ayar kontrolleri sunar", () => {
  assert.equal((html.match(/id="adminNotificationTrigger"/g) || []).length, 1);
  assert.match(html, /aria-controls="adminNotificationDrawer"/);
  assert.match(html, /id="adminNotificationDrawer"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.doesNotMatch(html, /data-notification-filter=|data-notification-category=|data-panel-section="notifications"|id="adminNotificationArchiveRead"|id="adminNotificationClearArchive"/);
  assert.match(html, /id="adminNotificationUndoRegion"/);
  assert.match(html, /id="adminNotificationPreferences"/);
  assert.match(html, /id="adminNotificationPush"/);
  assert.match(html, /id="adminNotificationTest"/);
  for (const field of [
    "emailAddress", "inAppEnabled", "emailEnabled", "pushEnabled",
    "quietHoursEnabled", "quietHoursStart", "quietHoursEnd"
  ]) assert.match(html, new RegExp(`name="${field}"`), `${field} tercihi eksik`);
  assert.match(html, /id="adminNotificationRules"/);
  assert.match(html, /id="adminNotificationScheduleForm"/);
  assert.match(html, /name="scheduledAt"[^>]*type="datetime-local"|type="datetime-local"[^>]*name="scheduledAt"/);
  assert.match(html, /id="adminNotificationScheduleList"/);
  assert.match(script, /ADMIN_NOTIFICATION_API}\/schedules/);
  assert.match(script, /saveAdminNotificationSchedule/);
  assert.match(script, /deleteAdminNotificationSchedule/);
  for (const ruleField of ["enabled", "timing", "recipientMode"]) {
    assert.ok(script.includes(`data-rule-field="${ruleField}"`), `${ruleField} kural alanı eksik`);
  }
  for (const channel of ["inApp", "email", "push", "sound"]) {
    assert.ok(script.includes(`data-rule-channel="${channel}"`) || script.includes('["inApp", "push", "email", "sound"]'), `${channel} kural kanalı eksik`);
  }
  assert.match(script, /task_reminder_24h|Zamanlı hatırlatma/);
  assert.doesNotMatch(html, /id="adminNotificationCategory"[\s\S]*?<\/select>[\s\S]{0,40}value="training"|name="trainingNotifications"/);
  assert.doesNotMatch(script, /trainingNotifications|training:\s*"Eğitim"|case\s+"training"/);
  assert.match(html, /styles\/notifications\.css/);
  assert.doesNotMatch(html, /adminNotificationTrigger[\s\S]{0,400}(?:fa-bell|flaticon|emoji)/i);
});

test("Bildirim merkezi canonical API, SSE ve polling fallback ile backend sonucunu kullanır", () => {
  assert.match(script, /ADMIN_NOTIFICATION_API\s*=\s*"\/api\/admin\/notifications"/);
  for (const endpoint of [
    "/unread-count", "/read-all", "/preferences", "/push-subscriptions", "/delivery-health", "/events", "/test"
  ]) assert.ok(script.includes(endpoint), `${endpoint} istemci bağlantısı eksik`);
  assert.match(script, /new EventSource\([^)]*ADMIN_NOTIFICATION_API[^)]*\/events/);
  assert.match(script, /startAdminNotificationPolling/);
  assert.match(script, /method:\s*"PATCH"/);
  assert.match(script, /read\?recoverable=1/);
  assert.match(script, /undoAdminNotificationDelete/);
  const renderer = script.slice(script.indexOf("function renderAdminNotificationCard("), script.indexOf("function adminNotificationIcon("));
  assert.match(renderer, /data-notification-action="delete"/);
  assert.doesNotMatch(renderer, /Arşivle|Kuralı düzenle|Neden:|data-notification-action="read"/);
  assert.match(script, /loadAdminNotifications\(\)/);
});

test("Push izni yalnızca açık kullanıcı eylemi içinde istenir", () => {
  const permissionCalls = [...script.matchAll(/Notification\.requestPermission\s*\(/g)];
  assert.equal(permissionCalls.length, 1);
  const toggleStart = script.indexOf("async function toggleAdminPushSubscription");
  const toggleEnd = script.indexOf("function urlBase64ToUint8Array", toggleStart);
  assert.ok(permissionCalls[0].index > toggleStart && permissionCalls[0].index < toggleEnd);
  assert.match(script.slice(toggleStart, toggleEnd), /pushManager\.subscribe/);
  assert.match(script.slice(toggleStart, toggleEnd), /push-subscriptions/);
  assert.match(script, /detachAdminPushSubscription/);
  assert.match(script, /await detachAdminPushSubscription\(\)/);
});

test("Yönetici service worker push ve güvenli panel deep-link tıklamasını destekler", () => {
  assert.match(serviceWorker, /addEventListener\("push"/);
  assert.match(serviceWorker, /showNotification/);
  assert.match(serviceWorker, /addEventListener\("notificationclick"/);
  assert.match(serviceWorker, /clients\.matchAll/);
  assert.match(serviceWorker, /safeAdminDeepLink/);
  assert.match(serviceWorker, /neverCachePrefixes:\s*\["\/api\/"/);
});

test("Bildirim deep-link'i yalnız panel içinde güvenle resolve edilir", () => {
  assert.match(script, /target\.origin === window\.location\.origin/);
  assert.match(script, /target\.pathname\.startsWith\("\/yonetici\/"\)/);
  assert.match(script, /searchParams\.get\("workforce"\)/);
  assert.match(script, /workforceTasksAccordion/);
  assert.match(script, /workforceShiftsAccordion/);
  assert.match(script, /normalizeAdminNotificationSection/);
  assert.match(script, /"personel"[\s\S]*return "staffAccess"/);
  assert.match(script, /\^\\\/\(\?:muhasebe\|fatura\)/);
  assert.match(script, /const legacySections = \{/);
  assert.match(script, /shipments:\s*"shipmentArchive"/);
  assert.doesNotMatch(script, /window\.location\.assign\(target\.href\)/);
});

test("personel yetki altyapısı korunur ve rol kabukları yalnız stok sekmelerini gösterir", () => {
  const staffStart = html.indexOf('id="staffAccessCard"');
  const staffEnd = html.indexOf('</main>', staffStart);
  const staffMarkup = html.slice(staffStart, staffEnd);
  assert.ok(staffStart >= 0 && staffEnd > staffStart);
  assert.match(staffMarkup, /id="staffPersonnelModal"/);
  assert.match(staffMarkup, /Görev Tanımı/);
  assert.doesNotMatch(staffMarkup, /Arayüz Yetkileri|data-personel-section-access|id="staffSectionAccessAccordion"/);
  // Arayüz sadeleştirmesi personel kaydederken izinleri değiştirmemeli.
  const saveUser = script.slice(script.indexOf("async function saveStaffUser()"), script.indexOf("function renderStaffAssignmentOptions()"));
  assert.ok(saveUser.length > 0);
  assert.doesNotMatch(saveUser, /personelSectionAccess:\s*|sectionAccess:\s*/);
  assert.doesNotMatch(staffMarkup, /id="workforceShipmentsAccordion"/);
  assert.doesNotMatch(html, /href="\/muhasebe\/"/);
  const personelHtml = fs.readFileSync(path.join(root, "PERSONEL", "index.html"), "utf8");
  const personelLabels = [...personelHtml.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(personelLabels, [
    "Genel Bakış", "Stok", "Malzeme Nerede?", "Malzeme Talebi", "İzin Talebi", "Sevkiyat", "Görevlerim"
  ]);
  const definitions = faturaScript.slice(faturaScript.indexOf("const viewDefinitions"), faturaScript.indexOf("let visibleViews"));
  const muhasebeLabels = [...definitions.matchAll(/label:\s*"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(muhasebeLabels, [
    "Stok", "Tedarikçiler", "Tedarikçi ürünleri", "Mal kabul", "Belgeler", "Faturalar", "İrsaliyeler",
    "Sevkiyat arşivi", "Cari hareketler", "Ödemeler", "Ters kayıtlar",
    "Belge görselleri", "Yetkilendirme", "İşlem geçmişi"
  ]);
});

test("Yönetici gerçek zamanlı bağlantısı polling yedeğine geçer ve kontrollü yeniden bağlanır", () => {
  assert.match(script, /scheduleAdminNotificationReconnect/);
  assert.match(script, /notificationReconnectAttempt/);
  assert.match(script, /Math\.min\(30000/);
  assert.match(script, /startAdminNotificationPolling\(\)/);
  assert.match(script, /closeBackendEvents[\s\S]*notificationReconnectTimer/);
});

test("profil sağ üstte tek menüyle kalır, sidebar STS adını korur", () => {
  assert.equal((html.match(/id="adminProfileButton"/g) || []).length, 1);
  const sidebar = html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf('</aside>'));
  assert.doesNotMatch(sidebar, /adminProfileButton|brand-eyebrow/);
  assert.match(sidebar, />STS Yönetici Paneli</);
  assert.match(html, /admin-topbar-profile-wrap[\s\S]*data-admin-profile-action="profile"[\s\S]*data-admin-profile-action="settings"[\s\S]*data-admin-profile-action="logout"/);
  assert.match(script, /adminSidebarBrandName\.textContent = "STS Yönetici Paneli"/);
});

test("Bildirim çekmecesi mobil, odak ve azaltılmış hareket kurallarını korur", () => {
  assert.match(styles, /\.admin-notification-drawer\s*\{/);
  assert.match(styles, /width:\s*min\(660px/);
  assert.match(styles, /inset:\s*0;\s*margin:\s*auto;\s*height:\s*fit-content/);
  assert.match(styles, /background:\s*#c81e3a/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(styles, /@media \(max-width:\s*720px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(script, /els\.panelShell\.inert = true/);
  assert.match(script, /handleAdminNotificationKeydown/);
  assert.match(script, /event\.key === "Escape"/);
  assert.match(script, /event\.key !== "Tab"/);
});
