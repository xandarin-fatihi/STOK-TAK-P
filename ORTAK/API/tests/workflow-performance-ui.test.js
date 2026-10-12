"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function section(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `${startToken} bulunamadı`);
  assert.notEqual(end, -1, `${endToken} bulunamadı`);
  return source.slice(start, end);
}

test("sevkiyat bildirimleri Yönetici içindeki arşiv detayına ve doğru alıcı rollerine gider", () => {
  const workforce = read("ORTAK/API/src/workforce-routes.js");
  const procurement = read("ORTAK/API/src/procurement-service.js");
  const sources = `${workforce}\n${procurement}`;
  const expectedLink = 'deepLink: `/yonetici/?section=shipments&procurementView=shipmentArchive&shipmentId=${encodeURIComponent(shipment.id)}`';

  assert.equal(workforce.split(expectedLink).length - 1, 2);
  assert.equal(procurement.split(expectedLink).length - 1, 2);
  assert.doesNotMatch(sources, /view=stock&workforce=shipments/);
  assert.doesNotMatch(sources, /view=documents&shipmentId=/);
  assert.match(workforce, /return \{ recipientRole: "manager", recipientId: "manager", \.\.\.input \}/);
  assert.match(workforce, /return \{ recipientRole: "personnel", recipientId: String\(personId \|\| ""\), \.\.\.input \}/);
  assert.match(procurement, /helpers\.notifyManager\(data, \{[\s\S]*?eventType: "shipment_submitted"[\s\S]*?procurementView=shipmentArchive&shipmentId=/);
  assert.doesNotMatch(procurement, /notifyFaturaReceiptUsers|helpers\.notifyPerson\(data, recipient\.id/);
});

test("entegre modül ilk görünümü tam bildirim listesini beklemez", () => {
  const script = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/scripts/app.js");
  const bootstrap = section(script, "async function bootstrap()", "\nasync function resolveContext()");
  const login = section(script, "async function submitLogin", "\nasync function performLogout");
  const countLoader = section(script, "async function loadNotificationUnreadCount()", "\nfunction registerFaturaPwaNotificationIntro");
  const drawer = section(script, "async function openNotifications()", "\nfunction closeNotifications()");

  assert.match(bootstrap, /void loadNotificationUnreadCount\(\)\.catch/);
  assert.match(bootstrap, /await activateInitialView\(\)/);
  assert.doesNotMatch(bootstrap, /loadNotifications\(/);
  assert.match(login, /void loadNotificationUnreadCount\(\)\.catch/);
  assert.doesNotMatch(login, /loadNotifications\(/);
  assert.match(countLoader, /\/unread-count/);
  assert.doesNotMatch(countLoader, /limit:\s*"30"/);
  assert.match(drawer, /await loadNotifications\(true\)/);
  assert.match(script, /function refreshNotificationCenter\(\)\{return notificationDrawer\.hidden\?loadNotificationUnreadCount\(\):loadNotifications\(true\);\}/);
});

test("Personel tema ve kritik oturum başlangıcını paralel başlatır", () => {
  const shell = read("PERSONEL/personel.js");
  const init = section(shell, "  async function init()", "\n  function refreshPanelTheme()");

  assert.match(init, /Promise\.all\(\[boot\(\), refreshPanelTheme\(\)\]\)/);
  assert.doesNotMatch(init, /await refreshPanelTheme\(\);\s*await boot\(\)/);
});

test("Personel stok kartları kalıcı ürün görsellerini gösterir", () => {
  const shell = read("PERSONEL/personel.js");
  const styles = read("PERSONEL/personel-stock-revision.css");
  const render = section(shell, "  function renderProducts()", "\n  function openStockDetail");

  assert.match(render, /product\.imageUrl \|\| product\.image/);
  assert.match(render, /class="stock-card-media\$\{productImage \? "" : " is-placeholder"\}"/);
  assert.match(render, /neutral-placeholder\.svg/);
  assert.match(render, /loading="lazy" decoding="async"/);
  assert.match(styles, /\.stock-card-media img\s*\{[\s\S]*?object-fit:\s*contain/);
});

test("ürün detayları görseli doğal oranında ve yakınlaştırılabilir gösterir; eski kahverengi katmanı kullanmaz", () => {
  const personelHtml = read("PERSONEL/index.html");
  const personelShell = read("PERSONEL/personel.js");
  const personelStyles = read("PERSONEL/personel-stock-revision.css");
  const adminStyles = read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/styles/stock.css");
  const detail = section(personelShell, "  function openStockDetail(productId)", "\n  function closeStockDetail");

  assert.match(personelHtml, /id="stockDetailMedia"[\s\S]*?id="stockDetailImage"/);
  assert.match(detail, /product\.imageUrl \|\| product\.image/);
  assert.match(detail, /imageUrl = productImage \|\| "\/assets\/images\/neutral-placeholder\.svg"/);
  assert.match(detail, /stockDetailMedia\.classList\.toggle\("is-placeholder", !productImage\)/);
  assert.match(detail, /stockDetailImage\.src = imageUrl/);
  assert.match(personelStyles, /\.stock-personel-modal \.stock-detail-media\s*\{[\s\S]*?aspect-ratio:\s*auto/);
  assert.match(personelStyles, /\.stock-personel-modal \.stock-detail-media img\s*\{[\s\S]*?width:\s*auto;[\s\S]*?height:\s*auto;[\s\S]*?object-fit:\s*contain/);
  assert.match(personelHtml, /id="stockImageViewer"[\s\S]*?id="stockImageZoomIn"/);
  assert.match(personelShell, /function openStockImageViewer\(\)[\s\S]*?function setStockImageZoom\(/);
  assert.doesNotMatch(personelStyles, /rgba\(44,\s*22,\s*9/);
  assert.match(adminStyles, /\.stock-drawer-product-image\s*\{[\s\S]*?width:\s*auto;[\s\S]*?height:\s*auto;[\s\S]*?object-fit:\s*contain/);
  assert.match(adminStyles, /\.stock-product-drawer-backdrop\s*\{[\s\S]*?background:\s*color-mix\(in srgb, var\(--panel-ink\) 52%, transparent\)/);
  assert.doesNotMatch(adminStyles, /\.stock-product-drawer-backdrop\s*\{[^}]*rgba\(44,\s*22,\s*9/);
});
