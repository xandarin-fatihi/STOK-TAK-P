"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function section(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `${startToken} bulunamadı`);
  assert.notEqual(end, -1, `${endToken} bulunamadı`);
  return source.slice(start, end);
}

function shipmentUnitHelpers(source) {
  const helpers = section(source, "  function caseInfo(", "\n  function startOfWeek(");
  return new Function("UNITS", "formatNumber", "roundNumber", `
    "use strict";
    ${helpers}
    return { caseInfo, productUnitMetadata, packageCount, supportedUnits, convertLineToBase };
  `)(
    ["koli", "paket", "adet", "kg", "gr", "litre", "ml", "şişe"],
    (value) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value)),
    (value) => Math.round(Number(value) * 1000) / 1000
  );
}

test("personel çıkışı yalnız erişilebilir profil menüsünden gerçek endpoint ile yapılır", () => {
  const html = read("PERSONEL/index.html");
  const shell = read("PERSONEL/personel.js");

  assert.equal((html.match(/data-profile-action="logout"/g) || []).length, 1);
  assert.doesNotMatch(html, /id="personelLogout"|class="[^"]*logout-button/);
  assert.match(html, /id="sidebarUser"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  assert.match(html, /id="profilePopover" role="menu" hidden/);
  assert.match(html, /data-profile-action="logout">Çıkış yap</);
  assert.doesNotMatch(shell, /els\.personelLogout/);
  assert.match(shell, /fetch\("\/api\/recipe\/logout", \{ method: "POST", credentials: "include" \}\)/);
  assert.match(shell, /handleProfileMenuKeydown/);
  assert.match(shell, /closeProfilePopover\(\{ restoreFocus: true \}\)/);
});

test("sevkiyat başarı cevabı yerel listeye anında eklenir, sepet temizlenir ve ağır yenileme beklenmez", () => {
  const workforce = read("PERSONEL/workforce.js");
  const submit = section(workforce, "  async function executeShipmentSubmit()", "\n  function upsertShipment(");

  assert.match(submit, /upsertShipment\(result && result\.shipment\)/);
  assert.match(submit, /state\.cart = \[\]/);
  assert.match(submit, /state\.shipmentRequestId = ""/);
  assert.match(submit, /showMessage\("shipment", "Sevkiyat bildiriminiz yönetici onayına gönderildi\."/);
  assert.match(submit, /refreshShipmentInBackground\(\)/);
  assert.doesNotMatch(submit, /await refreshWorkforceData\(/);
  assert.match(workforce, /Idempotency-Key/);
  assert.match(workforce, /runImmediateOperation\("shipment-notify"/);
  assert.match(workforce, /loadWorkforceData\("shipment", \{ force: true \}\)/);
});

test("sevkiyat hatasında sepet ve idempotency anahtarı korunur", () => {
  const workforce = read("PERSONEL/workforce.js");
  const submit = section(workforce, "  async function executeShipmentSubmit()", "\n  function upsertShipment(");
  const catchBlock = submit.slice(submit.indexOf("    } catch (error)"));

  assert.doesNotMatch(catchBlock, /state\.cart\s*=\s*\[\]/);
  assert.doesNotMatch(catchBlock, /state\.shipmentRequestId\s*=\s*""/);
  assert.match(catchBlock, /showMutationError\("shipment", error\)/);
  assert.match(catchBlock, /throw error/);
});

test("sevkiyat gönderilirken modal etkileşimleri kilitlenir ve yalnız gönderilen taslak temizlenir", () => {
  const workforce = read("PERSONEL/workforce.js");
  const submit = section(workforce, "  async function executeShipmentSubmit()", "\n  function upsertShipment(");
  const lock = section(workforce, "  function setShipmentSubmissionBusy(", "\n  function submitShipment(");

  assert.match(submit, /const submittedDraft = createShipmentDraftSnapshot\(\)/);
  assert.match(submit, /items: submittedDraft\.items/);
  assert.match(submit, /shipmentDraftFingerprint\(\) === submittedDraft\.fingerprint/);
  assert.match(submit, /if \(state\.shipmentRequestId === submittedDraft\.requestId\) state\.shipmentRequestId = ""/);
  assert.match(submit, /finally \{[\s\S]*setBusy\(activeButton, false, ""\)[\s\S]*setShipmentSubmissionBusy\(activeRoot, false/);
  assert.match(lock, /const composer = currentRoot\.querySelector\("#wfShipmentComposer"\)/);
  assert.match(lock, /\(composer \|\| currentRoot\)\.querySelectorAll\("button, input, select, textarea"\)/);
  assert.match(lock, /control\.disabled = true/);
  assert.match(lock, /control\.setAttribute\("aria-disabled", "true"\)/);
  assert.match(lock, /currentRoot\.setAttribute\("aria-busy", "true"\)/);
});

test("sevkiyat ana sayfası geçmişi gösterir ve tek merkezî mal kabul diyaloğu kullanır", () => {
  const workforce = read("PERSONEL/workforce.js");
  const compactStyles = read("PERSONEL/personel-compact.css");
  const render = section(workforce, "  function renderShipment()", "\n  function drawShipmentHistory(");

  assert.match(render, /placeholder="Sevkiyat veya malzeme ara"/);
  assert.match(render, /id="wfShipmentComposerTrigger"[^>]+aria-haspopup="dialog"[^>]+aria-controls="wfShipmentComposer"/);
  assert.match(render, /Mal Kabul Bildir<\/button>/);
  assert.match(render, /id="wfShipmentHistoryList"/);
  assert.match(render, /id="wfShipmentComposer" role="dialog" aria-modal="true"[^>]+aria-labelledby="wfShipmentComposerTitle"[^>]+tabindex="-1" hidden/);
  assert.match(render, /<h2 id="wfShipmentComposerTitle">Mal Kabul Bildirimi<\/h2>/);
  assert.match(render, /Stok, yönetici onayından sonra güncellenir\./);
  assert.doesNotMatch(render, /Son Kontrol|wfShipmentDrawer|data-open-notifications/);
  assert.match(workforce, /event\.key === "Escape"/);
  assert.match(workforce, /trapShipmentDialogFocus/);
  assert.match(workforce, /is-shipment-dialog-open/);
  assert.match(compactStyles, /\.wf-shipment-dialog\s*\{[^}]*position:\s*fixed;[^}]*top:\s*50%;[^}]*left:\s*50%;/s);
});

test("ürün seçimi yalnız ekleme sunar; gelen miktar tam sayı adet olarak sabittir", () => {
  const workforce = read("PERSONEL/workforce.js");
  const card = section(workforce, "  function productCard(", "\n  function addToCart(");
  const cart = section(workforce, "  function drawCart()", "\n  function shipmentLineValidation(");

  assert.match(card, /wf-product-card\$\{selected \? " is-selected"/);
  assert.match(card, /wf-product-actions/);
  assert.match(card, /data-add-product/);
  assert.match(card, /Eklendi/);
  assert.doesNotMatch(card, /data-product-inline-quantity|data-product-inline-unit/);
  assert.match(cart, /data-line-quantity/);
  assert.match(cart, /type="number" min="1" step="1" inputmode="numeric"/);
  assert.match(cart, /<span>Miktar<\/span>/);
  assert.doesNotMatch(cart, /data-line-unit|<select|>Birim</);
  assert.match(cart, /data-remove-line/);
  assert.match(cart, /shipmentImage\(line\.imageUrl/);
  assert.match(workforce, /unit: "adet"/);
  assert.match(workforce, /Number\.isInteger\(quantity\) && quantity > 0/);
  assert.match(workforce, /findCartLineForProduct/);
  assert.match(workforce, /updateProductSelection/);
});

test("sevkiyat koli bilgisi toplu birimden temel birime canonical eşitlik olarak gösterilir", () => {
  const workforce = read("PERSONEL/workforce.js");
  const helpers = shipmentUnitHelpers(workforce);
  const canonical = {
    baseUnit: "adet",
    unit: "adet",
    bulkUnit: "koli",
    caseUnit: "koli",
    unitsPerBulkUnit: 12,
    unitsPerCase: 12,
    caseText: "Koli içi 12 koli"
  };

  assert.equal(helpers.caseInfo(canonical), "1 koli = 12 adet");
  assert.equal(helpers.packageCount(canonical), 12);
  assert.deepEqual(helpers.supportedUnits(canonical), ["adet", "koli"]);
  assert.deepEqual(helpers.convertLineToBase({ quantity: 2, unit: "koli" }, canonical), { quantity: 24, unit: "adet" });
  assert.doesNotMatch(helpers.caseInfo(canonical), /12 koli$/);
});

test("eski koli metadata yardımcıları korunur; sevkiyat taslağı ise adet olarak sabitlenir", () => {
  const workforce = read("PERSONEL/workforce.js");
  const helpers = shipmentUnitHelpers(workforce);

  assert.equal(helpers.caseInfo({ unit: "şişe", caseUnit: "koli", unitsPerCase: "6" }), "1 koli = 6 şişe");
  assert.equal(helpers.caseInfo({ packageInfo: "1 koli = 8 paket" }), "1 koli = 8 paket");
  assert.equal(helpers.caseInfo({ packageInfo: { bulkUnit: "koli", baseUnit: "adet", quantity: "12,5" } }), "1 koli = 12,5 adet");
  assert.equal(helpers.caseInfo({ baseUnit: "adet", bulkUnit: "koli" }), "");
  assert.equal(helpers.caseInfo({ baseUnit: "koli", bulkUnit: "koli", unitsPerBulkUnit: 12 }), "");
  assert.deepEqual(helpers.supportedUnits({ baseUnit: "adet", bulkUnit: "koli" }), ["adet"]);

  assert.match(workforce, /unit: "adet",\s*baseUnit: "adet",\s*bulkUnit: "",\s*caseText: ""/);
  assert.doesNotMatch(workforce, /data-line-unit|shipmentConversionText/);
});

test("miktar değişikliği yeniden çizimden önce taslağa alınır ve hata ilgili satırda gösterilir", () => {
  const workforce = read("PERSONEL/workforce.js");
  const drawCart = section(workforce, "  function drawCart()", "\n  function shipmentLineValidation(");
  const stageQuantity = section(workforce, "  function stageCartLineQuantity(", "\n  function removeCartLine(");

  assert.match(drawCart, /input\.addEventListener\("input"[\s\S]*stageCartLineQuantity\(input\.dataset\.lineQuantity, input\.value\)/);
  assert.match(drawCart, /wf-line-error/);
  assert.match(stageQuantity, /line\.quantity = next;[\s\S]*shipmentDraftChanged\(\)/);
  assert.doesNotMatch(stageQuantity, /drawCart\(\)|updateProductSelection\(/);
  assert.match(workforce, /function validateShipmentCart\(/);
});

test("sevkiyat taslağı kullanıcı oturumunda korunur, görseli saklar ve ürün değişince idempotency anahtarı yenilenir", () => {
  const workforce = read("PERSONEL/workforce.js");

  assert.match(workforce, /SHIPMENT_DRAFT_STORAGE_PREFIX/);
  assert.match(workforce, /window\.sessionStorage\.setItem/);
  assert.match(workforce, /window\.sessionStorage\.getItem/);
  assert.match(workforce, /function shipmentDraftChanged\(\)[\s\S]*state\.shipmentRequestId = "";[\s\S]*persistShipmentDraft\(\)/);
  assert.match(workforce, /function pruneUnavailableCartLines\(\)[\s\S]*refreshCartLineFromProduct/);
  assert.match(workforce, /clearShipmentDraft\(\);[\s\S]*closeShipmentComposer\(\{ restoreFocus: false, immediate: true \}\)/);
  assert.match(workforce, /imageUrl: String\(line\.imageUrl \|\| ""\)/);
});

test("tüm sevkiyat geçmişi ana sayfada aranır, sayfalanır ve salt okunur detay açar", () => {
  const workforce = read("PERSONEL/workforce.js");
  const history = section(workforce, "  function drawShipmentHistory(", "\n  function productCard(");

  assert.match(history, /shipmentSearchText/);
  assert.match(history, /SHIPMENT_HISTORY_PAGE_SIZE/);
  assert.match(history, /data-shipment-detail/);
  assert.match(workforce, /function shipmentDetailMarkup/);
  assert.match(workforce, /item\.imageUrl/);
  assert.doesNotMatch(workforce, /data-open-notifications/);
});

test("Personel kabuk, sevkiyat betiği ve yeni stiller aynı cache-bust sürümüyle yüklenir", () => {
  const html = read("PERSONEL/index.html");
  const shell = read("PERSONEL/personel.js");
  const worker = read("PERSONEL/sw.js");
  const version = "20261004-shipment-receipt-v3";
  const shellVersion = "20261005-storage-placement-v1";

  assert.match(html, new RegExp("/personel/personel\\.js\\?v=" + shellVersion));
  assert.match(html, new RegExp("/personel/personel-compact\\.css\\?v=" + version));
  assert.match(shell, new RegExp("/personel/workforce\\.js\\?v=" + version));
  assert.match(worker, new RegExp("/personel/personel\\.js\\?v=" + shellVersion));
  assert.match(worker, new RegExp("/personel/workforce\\.js\\?v=" + version));
  assert.match(worker, new RegExp("/personel/personel-compact\\.css\\?v=" + version));
  assert.doesNotMatch(html + "\n" + shell + "\n" + worker, /shipment-layout-v[34]/);
});
