"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("PERSONEL/index.html");
const shell = read("PERSONEL/personel.js");
const css = read("PERSONEL/personel-stock-revision.css");
const compact = read("PERSONEL/personel-compact.css");
const service = read("ORTAK/API/src/stock-service.js");
const worker = read("PERSONEL/sw.js");

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `${start} başlangıcı bulunamadı`);
  assert.notEqual(to, -1, `${end} sonu bulunamadı`);
  return source.slice(from, to);
}

test("stok kartları dengeli, bütün yüzeyden açılır ve metinleri kesmez", () => {
  const render = section(shell, "  function renderProducts()", "\n  function openStockDetail(");

  assert.match(render, /role="button" tabindex="0"/);
  assert.match(render, /neutral-placeholder\.svg/);
  assert.match(render, /stock-card-meta-row/);
  assert.match(render, /stock-card-quantity__combined/);
  assert.doesNotMatch(render, /stock-card-open/);
  assert.match(css, /repeat\(auto-fit,\s*minmax\(min\(100%,\s*238px\),\s*1fr\)\)/);
  assert.match(css, /\.stock-card-media img\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(css, /\.stock-card-head h2\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s);
  assert.match(css, /\.stock-card-meta-row \.badge\s*\{[^}]*flex:\s*0\s+0\s+auto;[^}]*white-space:\s*nowrap;/s);
});

test("ürün detayı tek erişilebilir yüzeyde yalnız görsel, ad, stok ve adet eksiltme alanını taşır", () => {
  assert.equal((html.match(/id="stockDetailModal"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="stockActionModal"|data-stock-detail-action/);
  const modal = section(html, '<div class="stock-modal stock-personel-modal" id="stockDetailModal"', "\n  </div>\n\n</body>");
  assert.match(modal, /id="stockDetailClose"/);
  assert.match(modal, /<button class="stock-detail-media" id="stockDetailMedia"[^>]*type="button"/);
  assert.match(modal, /id="stockDetailImage"[^>]*loading="eager"[^>]*draggable="false"/);
  assert.doesNotMatch(modal, /id="stockDetailImage"[^>]*(?:width|height)="/);
  assert.match(modal, /id="stockDetailTitle"/);
  assert.match(modal, /Mevcut stok/);
  assert.match(modal, /id="stockDetailQuantity"/);
  assert.match(modal, /id="stockActionForm"/);
  assert.match(modal, /id="stockActionPanel"/);
  assert.match(modal, /id="stockActionQuantity"[^>]*type="number"[^>]*min="1"[^>]*step="1"[^>]*inputmode="numeric"/);
  assert.match(modal, /id="stockActionSubmit"[^>]*type="submit">Eksilt</);
  assert.doesNotMatch(modal, /stockDetailCategory|stockDetailStatus|stockActionFooter|stockActionCancel/);
  assert.doesNotMatch(modal, /stockActionUnitChoices|stockQuickAmounts|stockActionSummary|stockActionNote/);
  assert.match(css, /\.stock-detail-dialog\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/s);
  assert.match(css, /stok v4:[^\n]*doğal görsel oranı ve yakınlaştırılabilir inceleme/);
  assert.match(css, /\.stock-personel-modal \.stock-detail-dialog\s*\{[^}]*width:\s*min\(620px,\s*100%\);/s);
  assert.match(css, /\.stock-personel-modal \.stock-detail-form\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);/s);
  assert.match(css, /\.stock-detail-scroll\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.stock-personel-modal \.stock-detail-hero\s*\{[^}]*grid-template-columns:\s*minmax\(180px,\s*0\.85fr\)\s+minmax\(0,\s*1\.15fr\);/s);
  assert.match(css, /\.stock-detail-media img\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(css, /\.stock-personel-modal \.stock-detail-media img\s*\{[^}]*object-position:\s*center;[^}]*transition:\s*none;/s);
  assert.match(css, /\.stock-detail-quantity\s*\{[^}]*border-bottom:\s*1px solid var\(--panel-line\);/s);
  assert.match(css, /\.stock-personel-modal \.stock-action-submit\s*\{[^}]*width:\s*100%;/s);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/i);
});

test("ürün görseli doğal yatay, dikey veya kare oranını korur ve yakınlaştırılarak sürüklenebilir", () => {
  const openViewer = section(shell, "  function openStockImageViewer()", "\n  function closeStockImageViewer(");
  const zoom = section(shell, "  function setStockImageZoom(", "\n  function handleStockImageWheel(");

  assert.match(html, /id="stockImageViewer"[^>]*hidden/);
  assert.match(html, /id="stockImageZoomOut"/);
  assert.match(html, /id="stockImageZoomReset"/);
  assert.match(html, /id="stockImageZoomIn"/);
  assert.match(html, /id="stockImageViewerStage"[^>]*tabindex="0"/);
  assert.match(openViewer, /stockImageViewerImage\.src = els\.stockDetailImage\?\.currentSrc \|\| imageUrl/);
  assert.match(zoom, /Math\.min\(4,\s*Math\.max\(1,/);
  assert.match(zoom, /translate3d\(/);
  assert.match(shell, /addEventListener\("wheel",\s*handleStockImageWheel,\s*\{ passive: false \}\)/);
  assert.match(shell, /addEventListener\("pointermove",\s*moveStockImageDrag\)/);
  assert.match(css, /\.stock-personel-modal \.stock-detail-media\s*\{[^}]*aspect-ratio:\s*auto;/s);
  assert.match(css, /\.stock-personel-modal \.stock-detail-media img\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*object-fit:\s*contain;/s);
  assert.match(css, /\.stock-image-viewer__stage img\s*\{[^}]*position:\s*absolute;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain;/s);
});

test("personel ürün detayından yalnız tam sayı adet eksiltir ve temel birimi sunucuya gönderir", () => {
  const prepare = section(shell, "  function prepareStockAction(", "\n  function resetStockActionState(");
  const submit = section(shell, "  async function submitStockAction(", "\n  function setStockActionPending(");
  const sync = section(shell, "  function syncStockActionState(", "\n  async function submitStockAction(");

  assert.doesNotMatch(`${html}\n${shell}`, /Sarf İşle/);
  assert.doesNotMatch(html, /data-stock-unit-choice|Toplu birim tanımlı değil\.|Birim seçimi/);
  assert.match(prepare, /type:\s*"manual_out"/);
  assert.match(prepare, /stockActionQuantity\.step\s*=\s*"1"/);
  assert.match(prepare, /stockActionQuantity\.min\s*=\s*"1"/);
  assert.match(sync, /Number\.isInteger\(quantity\)/);
  assert.match(submit, /type:\s*"manual_out"/);
  assert.match(submit, /const unit = productBaseUnit\(product\)/);
  assert.match(submit, /\bquantity,\s*\n\s*unit,/);
  assert.match(submit, /headers:\s*stockMutationHeaders\(action\.requestId\)/);
  assert.match(submit, /expectedBalanceRevision/);
  assert.doesNotMatch(submit, /baseQuantity\s*:/);
  assert.match(submit, /note:\s*""/);
  assert.match(service, /const PERSONNEL_OUT_MOVEMENT_TYPES = new Set\(\["manual_out"\]\)/);
  assert.match(service, /code:\s*"PERSONNEL_WASTE_DISABLED"/);
  assert.match(service, /Personel yalnızca Eksilt hareketi oluşturabilir/);
});

test("dar sidebar ikonları kesmez ve yeni varlıklar PWA sürümünde birlikte cache'lenir", () => {
  const asset = "/personel/personel-stock-revision.css?v=20261004-stock-detail-v4";
  assert.match(compact, /--personel-sidebar-closed:\s*76px/);
  assert.match(compact, /\.is-sidebar-collapsed \.personel-nav button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.ok(html.includes(asset));
  assert.ok(worker.includes(asset));
  assert.match(html, /personel-compact\.css\?v=20261004-shipment-receipt-v3/);
  assert.match(html, /personel\.js\?v=20261005-storage-placement-v1/);
  assert.match(worker, /personel-stock-detail-v4/);
});
