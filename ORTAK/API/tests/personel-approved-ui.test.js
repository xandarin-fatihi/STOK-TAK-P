"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const period = require("../../JS/leave-period");
const lookup = require("../../JS/stock-lookup");
const root = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("izin gün hesabı uçları dahil, Pazar hariç; artık yıl ve bozuk tarih doğrulanır", () => {
  assert.equal(period.countDays("2026-10-12", "2026-10-18"), 6);
  assert.equal(period.countDays("2026-10-18", "2026-10-18"), 0);
  assert.equal(period.countDays("2026-10-13", "2026-10-13"), 1);
  assert.equal(period.countDays("2028-02-28", "2028-03-01"), 3);
  assert.equal(period.countDays("2026-12-31", "2027-01-02"), 3);
  assert.equal(period.countDays("2026-02-30", "2026-03-01"), null);
  assert.equal(period.countDays("2026-10-19", "2026-10-18"), null);
  assert.ok(period.normalize({ date:"2026-10-18" }).error);
  assert.equal(period.normalize({ date:"2026-10-12" }).endDate, "2026-10-12");
});

test("malzeme araması ana/alternatif/GS1 barkodu ve baştaki sıfırları korur", () => {
  const product = { id:"bearing", name:"Rulman", productCode:"RUL-1", barcode:"00012345600012", alternativeBarcodes:["ALT-07"], barcodes:[{ value:"09506000134352", verified:true },{ value:"HIDDEN-1", verified:false }] };
  for (const query of ["00012345600012", "ALT-07", "]C1010950600013435210LOT-7", "rulman", "RUL-1"]) assert.equal(lookup.productMatchesSearch(product, query), true, query);
  assert.equal(lookup.productMatchesSearch(product, "HIDDEN-1"), false);
  assert.equal(lookup.productMatchesSearch(product, "unrelated"), false);
});

test("barkod kamera bir sekme değil; galeri, kapatma, odak ve oturum temizliği korunur", () => {
  const html=read("PERSONEL/index.html"), source=read("PERSONEL/personel.js");
  assert.doesNotMatch(html, /data-section="barcode"|id="sectionBarcode"/);
  assert.match(source, /barcode:\s*"materialLocation"/);
  assert.match(html, /material-search-actions[\s\S]{0,400}Barkod Sorgula/);
  assert.match(source, /function openBarcodeScanner[\s\S]{0,600}startBarcodeCamera/);
  assert.match(source, /function receiveScannedBarcode[\s\S]{0,900}submitMaterialSearch/);
  assert.match(source, /session !== state\.barcodeCameraSession \|\| els\.barcodeScannerModal\.hidden/);
  assert.match(source, /function resetPersonelSession[\s\S]{0,150}closeBarcodeScanner/);
});

test("izin formu yılını otomatik doldurur; tür seçimi yok, isteğe bağlı saat ve not var", () => {
  const source=read("PERSONEL/workforce.js");
  const form=source.slice(source.indexOf("function renderShift()"),source.indexOf("function shiftDayCard"));
  assert.doesNotMatch(form, /Talep türü|requestTypeChoice|name="type"/);
  for (const field of ["date", "endDate", "specificHours", "startTime", "endTime", "description"]) assert.ok(form.includes(`name="${field}"`));
  assert.match(form, /draft\.date \|\| localDateKey\(new Date\(\)\)/);
  assert.match(form, /Pazar hariç/);
  assert.match(form, /Not \/ İzin sebebi/);
});

test("kritik stok toplu talebi mevcut API'yi kullanır; başka malzeme taslağını silmez", () => {
  const source=read("PERSONEL/workforce.js");
  const method=source.slice(source.indexOf("async function createMaterialRequestFromStock"),source.indexOf("function formatMaterialQuantity"));
  assert.match(method, /loadWorkforceData\("materialRequest", \{ force: true \}\)/);
  assert.match(method, /mutationRequest/);
  assert.match(method, /\/api\/workforce\/material-requests/);
  assert.doesNotMatch(method, /state\.materialItems\s*=|persistMaterialDraft|\/api\/stock/);
  const shell=read("PERSONEL/personel.js");
  assert.match(shell, /Number\.isSafeInteger\(item\.quantity\)/);
  assert.match(shell, /criticalRequestFingerprint !== fingerprint/);
  assert.match(shell, /personelSectionAllowed\("materialRequest"\)/);
});

test("yönetici başlangıcı URL, eski son sekme ve ayardan bağımsız Genel Bakıştır", () => {
  const source=read("YÖNETİCİ PANELİ/JS/app.js");
  const fn=source.slice(source.indexOf("function resolveInitialActiveSection()"),source.indexOf("function clearInitialAdminNavigation"));
  assert.equal(vm.runInNewContext(`(${fn.trim()})()`), "overview");
  assert.match(source, /async function showPanel[\s\S]{0,100}clearInitialAdminNavigation/);
  assert.match(source, /overview: "Genel Bakış"/);
  assert.doesNotMatch(read("YÖNETİCİ PANELİ/HTML/index.html"), /Gösterge paneli/);
});

test("kritik stok talebi hesap değişince gönderilmez; açık taslak ve mevcut stok korunur", async () => {
  const source = read("PERSONEL/workforce.js");
  const method = source.slice(source.indexOf("async function createMaterialRequestFromStock"), source.indexOf("function formatMaterialQuantity"));
  for (const changeAt of ["none", "load", "response"]) {
    let owner = "staff-a", sent = 0;
    const originalDraft = [{ name: "Kaydedilmiş taslak", quantity: 7 }];
    const state = { revision: 4, materialItems: originalDraft, data: { user: { department: "Atölye" }, materialRequests: [] } };
    const context = {
      state,
      window: { MenuSuitePersonelShell: { getContext: () => ({ active: true, userId: owner }) } },
      loadWorkforceData: async () => { if (changeAt === "load") owner = "staff-b"; },
      mutationRequest: (body, id) => ({ headers: { "Idempotency-Key": id }, body }),
      api: async (url, options) => {
        sent++;
        assert.equal(url, "/api/workforce/material-requests");
        const body = JSON.parse(options.body);
        assert.equal(body.items[0].quantity, 5);
        assert.equal(body.department, "Bakım Deposu");
        if (changeAt === "response") owner = "staff-b";
        return { revision: 5, materialRequest: { id: "request-1", items: body.items } };
      },
      responseRevision: result => result.revision
    };
    const submit = vm.runInNewContext(`(${method.trim()})`, context);
    const run = submit([{ productId: "bearing", quantity: 5 }], "retry-1", "Bakım Deposu");
    if (changeAt === "none") {
      await run;
      assert.equal(state.revision, 5);
      assert.equal(state.data.materialRequests.length, 1);
    } else {
      await assert.rejects(run, /Oturum değişti/);
      assert.equal(state.revision, 4);
      assert.equal(state.data.materialRequests.length, 0);
    }
    assert.equal(sent, changeAt === "load" ? 0 : 1);
    assert.equal(state.materialItems, originalDraft);
  }
});

test("Talep Aç yalnız Genel Bakış Kritik Stoklar detay kartının altındadır", () => {
  const html = read("PERSONEL/index.html"), source = read("PERSONEL/personel.js"), css = read("PERSONEL/personel-overview.css");
  const dashboard = html.slice(html.indexOf('id="overviewCriticalTitle"'), html.indexOf('id="personelOverviewDialogShell"'));
  assert.doesNotMatch(dashboard, /overviewCriticalRequest|overviewCriticalActions|data-critical-select/);
  assert.equal((html.match(/id="overviewCriticalRequest"/g) || []).length, 1);
  assert.match(html, /id="personelOverviewDialog"[\s\S]*id="personelOverviewDialogBody"[\s\S]*<footer[^>]+id="overviewCriticalActions"[\s\S]*id="overviewCriticalRequest"/);
  const summary = source.slice(source.indexOf("function renderOverviewCriticalProducts"), source.indexOf("function renderCriticalRequestRow"));
  assert.doesNotMatch(summary, /criticalRequestMode|data-critical-select|data-critical-quantity/);
  assert.match(source, /els\.personelOverviewDialogBody\?\.addEventListener\("change", handleCriticalRequestInput\)/);
  assert.match(source, /kind === "critical" && state\.criticalRequestMode && personelSectionAllowed\("materialRequest"\)/);
  assert.match(css, /\.personel-overview-dialog__footer[^}]+padding:14px 22px 18px/);
  assert.match(css, /grid-template-rows: auto auto minmax\(0, 1fr\) auto auto/);
});

test("Kritik talep düğmesi başka kartlarda veya yetkisiz/boş veri durumunda görünmez", () => {
  const source = read("PERSONEL/personel.js");
  const method = source.slice(source.indexOf("function syncCriticalRequestActions()"), source.indexOf("async function submitCriticalMaterialRequest"));
  for (const [kind, open, loaded, permission, count, hidden] of [
    ["critical", true, true, true, 1, false],
    ["products", true, true, true, 1, true],
    ["requests", true, true, true, 1, true],
    ["critical", false, true, true, 1, true],
    ["critical", true, false, true, 1, true],
    ["critical", true, true, false, 1, true],
    ["critical", true, true, true, 0, true]
  ]) {
    const els = { overviewCriticalActions: {} };
    vm.runInNewContext(`(${method.trim()})()`, {
      els, state: { overviewDialog: { kind }, criticalRequestItems: {}, criticalRequestMode: false },
      stockProducts: () => Array.from({ length: count }, (_, i) => ({ id: i })), isCriticalProduct: () => true,
      isOverviewDialogOpen: () => open, overviewSourceLoaded: () => loaded, personelSectionAllowed: () => permission
    });
    assert.equal(els.overviewCriticalActions.hidden, hidden, `${kind}/${open}/${loaded}/${permission}/${count}`);
  }
});
