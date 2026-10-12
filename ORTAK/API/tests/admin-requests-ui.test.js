"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const html = read("YÖNETİCİ PANELİ/HTML/index.html");
const app = read("YÖNETİCİ PANELİ/JS/app.js");
const source = read("YÖNETİCİ PANELİ/JS/workforce.js");
const styles = read("YÖNETİCİ PANELİ/CSS/requests.css");

function runtime() {
  const nodes = new Map();
  const node = (id) => {
    const events = {};
    return { id, events, innerHTML: "", textContent: "", dataset: {}, open: false, classList: { remove() {} },
      querySelector() { return null; }, querySelectorAll() { return []; },
      addEventListener(name, fn) { events[name] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; events.close?.(); }, focus() {}
    };
  };
  for (const id of ["workforceMaterialRequestsPanel", "workforceLeaveRequestsPanel", "materialRequestsPendingCount", "leaveRequestsPendingCount", "adminRequestDialog", "adminRequestDialogContent", "adminRequestDialogTitle", "adminRequestDialogClose"]) nodes.set(`#${id}`, node(id));
  nodes.set('#workforceToast', node('workforceToast'));
  const document = { readyState: "loading", activeElement: null, addEventListener() {}, querySelector: (selector) => nodes.get(selector) || null, querySelectorAll() { return []; } };
  const calls = [];
  const fixture = {
    users: [{ id: "p1", name: "Örnek Personel" }], tasks: [], shiftPlans: [], revision: 3,
    materialRequests: [
      { id: "old", requestNumber: "MT-1", personId: "p1", status: "reddedildi", createdAt: "2026-10-06T10:00:00Z", items: [] },
      { id: "new", requestNumber: "MT-2", personId: "p1", status: "onay_bekliyor", createdAt: "2026-10-07T10:00:00Z", items: [{ id: "item1", name: "Rulman <script>", quantity: 6, unit: "adet" }, { name: "Kayış", quantity: 2 }] }
    ],
    shiftRequests: [{ id: "shift-request-1", personId: "p1", type: "leave", date: "2026-10-12", createdAt: "2026-10-07T11:00:00Z", status: "onay_bekliyor", description: "TEST izin" }]
  };
  const window = { crypto: { randomUUID: () => "test-id" }, MenuSuiteAdminBridge: { activeSection: () => "approvals" } };
  const context = vm.createContext({ window, document, localStorage: { getItem() { return null; } }, CSS: { escape: String }, Element: class {}, console, setTimeout, clearTimeout, URLSearchParams,
    FormData: class { constructor(form) { this.values = form.values; } entries() { return Object.entries(this.values); } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => fixture }; }
  });
  const hook = "window.testRequests = {state, renderMaterialRequests, renderLeaveRequests, openRequestDetail, setupRequestDialog, handleWorkforceGatewayEvent, activeWorkforceSection, isWorkforceOwnerSection, renderMaterialProductForm, renderAdminMaterialRequest, renderMaterialMatchForm, filterMaterialMatches, updateMaterialMatchSelection, setBusy, createMaterialProduct, matchMaterialItem, decideMaterialRequest};";
  vm.runInContext(source.replace(/\r?\n\}\)\(\);\s*$/, `\n${hook}\n})();`), context);
  const api = window.testRequests;
  Object.assign(api.state.data, fixture);
  return { nodes, api, fixture, calls, document };
}

test("Talepler bağımsız workforce ekranıdır; iki akordion sıralı, tekil ve başlık mükerrer değil", () => {
  assert.match(html, /data-panel-section="approvals"[\s\S]{0,140}>Talepler<\/span>/);
  const page = html.slice(html.indexOf('id="approvalsCard"'), html.indexOf('<dialog class="admin-request-dialog"'));
  assert.ok(page.indexOf('id="workforceMaterialRequestsAccordion"') < page.indexOf('id="workforceLeaveRequestsAccordion"'));
  assert.match(page, /id="workforceMaterialRequestsAccordion" open/);
  assert.doesNotMatch(page, /<h2>|Onay kuyruğu|stock-admin-module__grid/);
  for (const id of ["workforceMaterialRequestsAccordion", "workforceLeaveRequestsAccordion", "workforceMaterialRequestsPanel", "workforceLeaveRequestsPanel"]) assert.equal(html.split(`id="${id}"`).length - 1, 1);
  const mappingStart = app.indexOf("const PROCUREMENT_SECTION_VIEWS");
  const mappings = app.slice(mappingStart, app.indexOf("const PANEL_THEME", mappingStart));
  assert.doesNotMatch(mappings, /approvals:/);
  assert.match(mappings, /receipts: "receipts"/);
  assert.match(app, /\["staffAccess", "approvals"\]\.includes\(section\)\) return loadScriptOnce/);
});

test("malzeme listesi düz satır, en yeni önce, tüm durumlar korunur ve metin kaçırılır", () => {
  const r = runtime();
  r.api.renderMaterialRequests();
  const content = r.nodes.get("#workforceMaterialRequestsPanel").innerHTML;
  assert.ok(content.indexOf("MT-2") < content.indexOf("MT-1"));
  assert.match(content, /requests-row/);
  assert.match(content, /Rulman &lt;script&gt; · 6 adet · \+1 kalem/);
  assert.match(content, /Reddedildi/);
  assert.match(content, /data-request-inspect="new"/);
  assert.doesNotMatch(content, /<details|textarea|Talebi Onayla|Ürün Kartı Oluştur/);
  assert.equal(r.nodes.get("#materialRequestsPendingCount").textContent, "1 bekleyen");
  assert.equal(r.calls.length, 0);
});

test("izin listesi aynı formatta, detayda karar eylemleri korunur", () => {
  const r = runtime();
  r.api.renderLeaveRequests();
  assert.match(r.nodes.get("#workforceLeaveRequestsPanel").innerHTML, /data-request-kind="leave"/);
  assert.equal(r.nodes.get("#leaveRequestsPendingCount").textContent, "1 bekleyen");
  r.api.openRequestDetail("leave", "shift-request-1");
  assert.equal(r.nodes.get("#adminRequestDialog").open, true);
  const detail = r.nodes.get("#adminRequestDialogContent").innerHTML;
  assert.match(detail, /TEST izin/);
  assert.match(detail, /data-request-decision="approve"/);
  assert.match(detail, /data-request-decision="reject"/);
  assert.match(detail, /data-request-note="shift-request-1"/);
  assert.equal(r.calls.length, 0, "İncele herhangi bir talebi değiştirmez");
});

test("malzeme detayı stok eşleştirme, ürün kartı ve onay akışını korur", () => {
  const r = runtime();
  r.api.openRequestDetail("material", "new");
  const detail = r.nodes.get("#adminRequestDialogContent").innerHTML;
  for (const action of ["data-material-match-toggle", "data-material-create-toggle", "data-material-decision=\"approve\"", "data-material-reject-toggle"]) assert.ok(detail.includes(action));
  assert.equal(r.nodes.get("#adminRequestDialogTitle").innerHTML, 'MT-2 <span class="requests-requester">(Örnek Personel)</span>');
  assert.equal(r.api.state.data.materialRequests[1].status, "onay_bekliyor");
});

test('malzeme detayı yalnız iki seçim düğmesi sunar; not ve ürün seçimi varsayılan görünmez', () => {
  const r = runtime();
  r.api.openRequestDetail('material', 'new');
  const detail = r.nodes.get('#adminRequestDialogContent').innerHTML;
  assert.equal((detail.match(/data-material-create-toggle=/g) || []).length, 2);
  assert.equal((detail.match(/data-material-match-toggle=/g) || []).length, 2);
  assert.doesNotMatch(detail, /<select|<textarea|Yönetici açıklaması|data-material-note|3\. buton/);
  assert.match(detail, /Yeni Ürün Olarak Ekle/);
  assert.match(detail, /Mevcut Ürün ile Eşleştir/);
  assert.match(styles, /requests-requester[^}]+color: var\(--panel-success/);
  assert.match(styles, /admin-request-dialog #adminRequestDialogContent[^}]+padding: 24px/);
  r.api.state.materialRejectRequestId = 'new';
  const rejection = r.api.renderAdminMaterialRequest(r.fixture.materialRequests[1], true);
  assert.match(rejection, /Reddetme nedeni \*/);
  assert.match(rejection, /data-material-note="new"[^>]+required/);
  assert.match(rejection, /Reddetmeyi Onayla/);
});

test('yeni stok kartı yalnız ad, kod, ürün kategorisi ve not sunar; depo ve birim seçimi yok', () => {
  const r = runtime();
  r.api.state.data.materialRequestCatalog = { categories: [{ id: 'cat-mechanic', name: 'Mekanik <Parçalar>' }], locations: [{ id: 'depot-1', name: 'Ana Depo' }] };
  const form = r.api.renderMaterialProductForm({ id: 'new' }, { id: 'item1', name: 'Özel Rulman', code: 'RLM-1', description: 'Stok kartı notu' });
  assert.deepEqual([...form.matchAll(/name="([^"]+)"/g)].map(m => m[1]), ['name', 'productCode', 'categoryId', 'note']);
  assert.match(form, /value="cat-mechanic">Mekanik &lt;Parçalar&gt;/);
  assert.doesNotMatch(form, /depot-1|Ana Depo|Temel birim|Toplu birim|Birim dönüşümü|Tedarikçi/);
  assert.match(form, /Stok kartı notu/);
  assert.match(form, /Stok miktarı eklenmez/);
});

test('sade stok kartı POST sabit adet, boş toplu birim, kategori ve notu doğru gönderir', async () => {
  const r = runtime();
  const form = { dataset: { materialProductForm: 'new:item1' }, values: { name: 'Özel Rulman', productCode: 'RLM-1', categoryId: 'cat-mechanic', note: 'Test notu', baseUnit: 'kg', bulkUnit: 'koli', unitsPerBulkUnit: 99, allowDecimal: true }, reportValidity: () => true, querySelector: () => null };
  await r.api.createMaterialProduct({ preventDefault() {}, currentTarget: form });
  const call = r.calls.find(item => item.url.endsWith('/new/items/item1/product'));
  assert.ok(call, 'İşlem backend ürün kartı endpointine ulaşır');
  const payload = JSON.parse(call.options.body);
  assert.equal(payload.baseUnit, 'adet');
  assert.equal(payload.bulkUnit, '');
  assert.equal(payload.unitsPerBulkUnit, 0);
  assert.equal(payload.allowDecimal, false);
  assert.equal(payload.categoryId, 'cat-mechanic');
  assert.equal(payload.note, 'Test notu');
  assert.equal(payload.expectedRevision, 0);
  assert.ok(call.options.headers['Idempotency-Key']);
});

test('eşleştirme yalnız aramayla açılır; satırlar görsel, ürün adı ve güncel stok sırasındadır', () => {
  const r = runtime();
  const markup = r.api.renderMaterialMatchForm('new:item1', [
    { id: 'p1', name: 'Rulman <6204>', productCode: 'RLM-6204', imageUrl: '/media/rulman.png', quantity: 12 },
    { id: 'p2', name: 'Stoksuz rulman', productCode: 'RLM-6205', quantity: 0 },
    { id: 'p3', name: 'Bakiyesi gelmeyen ürün' }
  ]);
  assert.match(markup, /data-material-match-results hidden/);
  assert.match(markup, /data-material-match-footer hidden/);
  assert.equal((markup.match(/data-material-match-option[^>]+hidden/g) || []).length, 3);
  assert.equal((markup.match(/required disabled/g) || []).length, 3);
  assert.match(markup, /amr-match-image[\s\S]+rulman.png[\s\S]+amr-match-name">Rulman &lt;6204&gt;[\s\S]+amr-match-stock">12 adet/);
  assert.match(markup, /amr-match-stock">0 adet/);
  assert.match(markup, /amr-match-stock">—/);
  assert.doesNotMatch(markup, /Kesin eşleşme|Kod belirtilmedi|<select/);
  assert.match(styles, /amr-match-image img[^}]+object-fit: contain/);
  assert.doesNotMatch(styles, /amr-match-results[^}]+max-height|amr-match-results[^}]+overflow-y/);
});

test('eşleştirme araması seçimi güvenle süzer; gizli seçili ürün gönderilemez', async () => {
  const r = runtime();
  const options = [{ name: 'Rulman RLM-1', radio: { checked: false } }, { name: 'Kayış KYS-2', radio: { checked: true } }].map(entry => ({ dataset: { search: entry.name }, hidden: false, radio: entry.radio, querySelector: () => entry.radio }));
  const empty = {}, submit = {}, hint = {}, results = {}, footer = {};
  const controls = { '[type=submit]': submit, '[data-material-match-empty]': empty, '[data-material-match-hint]': hint, '[data-material-match-results]': results, '[data-material-match-footer]': footer };
  const form = { querySelectorAll: () => options, querySelector: selector => controls[selector] || null };
  r.api.filterMaterialMatches(form, 'rulman');
  assert.equal(options[0].hidden, false);
  assert.equal(options[1].hidden, true);
  assert.equal(options[1].radio.disabled, true);
  assert.equal(options[1].radio.checked, false);
  assert.equal(submit.disabled, true, 'Arama sonucu seçilmeden işlem açılamaz');
  assert.equal(results.hidden, false);
  assert.equal(hint.hidden, true);
  options[0].radio.checked = true;
  r.api.updateMaterialMatchSelection(form);
  assert.equal(submit.disabled, false);
  r.api.state.busy = true;
  r.api.updateMaterialMatchSelection(form);
  assert.equal(submit.disabled, true);
  r.api.state.busy = false;
  r.api.filterMaterialMatches(form, 'bulunmayan');
  assert.equal(empty.hidden, false);
  assert.equal(submit.disabled, true);
  assert.equal(results.hidden, true);
  r.api.filterMaterialMatches(form, 'KYS-2');
  assert.equal(options[1].hidden, false, 'Kod ile arama korunur');
  options[1].radio.checked = true;
  r.api.filterMaterialMatches(form, '  ');
  assert.equal(hint.hidden, false);
  assert.equal(empty.hidden, true);
  assert.equal(results.hidden, true);
  assert.equal(footer.hidden, true);
  assert.equal(submit.disabled, true);
  assert.ok(options.every(option => option.hidden && option.radio.disabled && !option.radio.checked));
  await r.api.matchMaterialItem('new:item1', null);
  assert.equal(r.calls.length, 0);
  r.nodes.set('[data-material-match-form="new:item1"]', { querySelector: () => ({ value: 'product-rulman' }) });
  await r.api.matchMaterialItem('new:item1', null);
  const call = r.calls.find(item => item.url.endsWith('/new/items/item1/match'));
  assert.equal(JSON.parse(call.options.body).productId, 'product-rulman');
});

test('reddetme için gerekçe zorunluluğu korunur; sade onay not olmadan gönderilebilir', async () => {
  const r = runtime();
  await r.api.decideMaterialRequest('new', 'reject', null);
  assert.equal(r.calls.length, 0);
  r.nodes.set('[data-material-note="new"]', { value: 'Test gerekçesi' });
  await r.api.decideMaterialRequest('new', 'reject', null);
  const rejection = r.calls.find(item => item.url.endsWith('/new/reject'));
  assert.equal(JSON.parse(rejection.options.body).note, 'Test gerekçesi');
  r.nodes.delete('[data-material-note="new"]');
  await r.api.decideMaterialRequest('new', 'approve', null);
  const approval = r.calls.find(item => item.url.endsWith('/new/approve'));
  assert.equal(JSON.parse(approval.options.body).note, '');
});

test("eski bildirim bağlantıları Talepler'e; görev ve vardiya planlaması Kullanıcılar'a gider", () => {
  const start = app.indexOf("function resolveWorkforceNavigation(");
  const end = app.indexOf("function handleOpenStockProduct(", start);
  const resolve = vm.runInNewContext(app.slice(start, end) + "\nresolveWorkforceNavigation");
  for (const target of ["materialRequests".toLowerCase(), "materialrequest", "material-request", "leaverequests"]) assert.equal(resolve("staffAccess", target, "r1").section, "approvals");
  assert.equal(resolve("staffAccess", "shifts", "shift-request-1").target, "leaverequests");
  assert.equal(resolve("staffAccess", "tasks", "task-1").section, "staffAccess");
  assert.equal(resolve("staffAccess", "shifts", "").section, "staffAccess");
  assert.equal(resolve("receipts", "", "").section, "receipts");
  assert.match(app, /\[data-request-inspect=/);
});

test("workforce SSE Talepler açıkken liste ve sayacı yeniler; detay düzenlenirken notları ezmez", async () => {
  const r = runtime();
  assert.equal(r.api.isWorkforceOwnerSection("approvals"), true);
  assert.equal(r.api.activeWorkforceSection("approvals"), "approvals");
  r.api.handleWorkforceGatewayEvent({ detail: { topic: "workforce", revision: 3 } });
  await new Promise(setImmediate);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].url, "/api/admin/workforce");
  assert.equal(r.nodes.get("#materialRequestsPendingCount").textContent, "1 bekleyen");
  r.nodes.get("#adminRequestDialog").open = true;
  r.api.handleWorkforceGatewayEvent({ detail: { topic: "workforce", revision: 4 } });
  await new Promise(setImmediate);
  assert.equal(r.calls.length, 1, "Açık detay aniden yeniden çizilmemeli");
  assert.equal(r.api.state.stale, true);
  assert.match(app, /\["overview", "staffAccess", "approvals"\]\.includes\(event.detail\?\.section\)/);
});

test("native modal erişilebilir kapatma/blur ve mobil liste kurallarını korur", () => {
  assert.match(html, /<dialog[^>]+id="adminRequestDialog"[^>]+aria-labelledby="adminRequestDialogTitle"/);
  assert.match(styles, /::backdrop[\s\S]*?backdrop-filter: blur\(5px\)/);
  assert.match(styles, /@media \(max-width: 600px\)/);
  assert.match(styles, /requests-row > button[\s\S]*min-width: 70px/);
  assert.match(source, /dialog.addEventListener\("cancel"/);
  assert.match(source, /if \(state.busy\) event.preventDefault\(\)/);
  const shifts = source.slice(source.indexOf("function renderShifts()"), source.indexOf("function bindShifts()"));
  assert.match(shifts, /Vardiyaları Yayınla/);
  assert.doesNotMatch(shifts, /Tercih ve İzin|data-request-decision/);
});
