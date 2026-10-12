"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const express = require("express");

const stockService = require("../src/stock-service");
const { normalizeStore } = require("../src/store/file-store");
const { normalizeStockState, STORE_SCHEMA_VERSION } = require("../src/store/migrations");
const { registerWorkforceRoutes } = require("../src/workforce-routes");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("malzeme talebi arayüzü listeyi varsayılan gösterir, tek açılır kartta taslak ve son kontrolü korur", () => {
  const html = read("PERSONEL/index.html");
  const personelScript = read("PERSONEL/workforce.js");
  const personelCss = read("PERSONEL/material-requests.css");
  const adminHtml = read("YÖNETİCİ PANELİ/HTML/index.html");
  const adminScript = read("YÖNETİCİ PANELİ/JS/workforce.js");
  const adminCss = read("YÖNETİCİ PANELİ/CSS/material-requests.css");
  const mediaRoutes = read("ORTAK/API/src/personel-routes.js");

  const labels = [...html.matchAll(/<span class="nav-label">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Genel Bakış", "Stok", "Malzeme Nerede?", "Malzeme Talebi", "İzin Talebi", "Sevkiyat", "Görevlerim"]);
  for (const text of ["Yeni Talep", "Talep numarası veya malzeme adıyla ara", "Yeni Malzeme Talebi", "Malzeme Ekle", "Malzeme adı", "Malzeme miktarı", "Malzeme görseli", "Görsel Ekle", "Fotoğraf Çek", "Talep Ekle", "Talep Edilen Malzemeler", "Talebi Gönder", "Düzenlemeye Dön", "Onayla ve Gönder"]) {
    assert.match(personelScript, new RegExp(text));
  }
  assert.match(personelScript, /materialComposerOpen:\s*false/);
  assert.match(personelScript, /state\.materialComposerOpen\s*\?\s*renderMaterialComposer\(\)\s*:\s*""/);
  assert.match(personelScript, /data-material-new/);
  assert.match(personelScript, /data-material-dialog-close/);
  assert.match(personelScript, /trapMaterialDialogFocus/);
  assert.match(personelScript, /document\.body\.classList\.remove\("is-material-request-dialog-open"\)/);
  assert.doesNotMatch(personelScript, /data-material-tab=/);
  assert.equal((personelScript.match(/class="mr-composer-layer"/g) || []).length, 1);
  assert.match(personelScript, /MATERIAL_DRAFT_STORAGE_PREFIX/);
  assert.match(personelScript, /data-material-photo-input[^>]*type="file"[^>]*capture="environment"/);
  assert.match(personelScript, /materialRequestFingerprint/);
  assert.match(personelScript, /materialDraftFingerprint\(\) === fingerprint/);
  assert.doesNotMatch(personelScript, /data-material-status-filter/);
  assert.doesNotMatch(personelScript, /data-material-results-count/);
  assert.doesNotMatch(personelScript, /class="mr-request-meta"/);
  assert.doesNotMatch(personelScript, /class="mr-more"/);
  assert.doesNotMatch(personelScript, /name="code"/);
  assert.doesNotMatch(personelScript, /name="supplier"/);
  assert.doesNotMatch(personelScript, /name="usageLocation"/);
  assert.doesNotMatch(personelScript, /name="neededDate"/);
  assert.doesNotMatch(personelScript, /name="description"[^>]*maxlength="1000"/);
  assert.doesNotMatch(personelScript, /data-material-dialog-close>Kapat/);
  assert.match(personelScript, /<input id="mrMaterialUnit" name="unit" type="hidden"/);
  assert.doesNotMatch(personelScript, /<select id="mrMaterialUnit"/);
  assert.match(personelScript, /mr-composer-actions mr-composer-actions--single/);
  assert.match(personelScript, /<small>Talep edilen:/);
  assert.match(personelCss, /@media \(max-width: 1100px\)/);
  assert.match(personelCss, /@media \(max-width: 820px\)/);
  assert.match(personelCss, /@media \(max-width: 560px\)/);
  assert.match(personelCss, /body\.is-material-request-dialog-open\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(personelCss, /\.mr-composer-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(personelCss, /\.mr-composer\s*\{[^}]*max-height:\s*min\(92dvh,\s*920px\)/s);
  assert.match(adminHtml, /id="workforceMaterialRequestsAccordion"/);
  for (const text of ["Mevcut Ürün ile Eşleştir", "Yeni Ürün Olarak Ekle", "Ürün Kartını Aç", "Stok miktarı eklenmez"]) {
    assert.match(adminScript, new RegExp(text));
  }
  assert.match(adminCss, /@media \(max-width: 1024px\)/);
  assert.match(adminCss, /@media \(max-width: 768px\)/);
  assert.match(adminCss, /@media \(max-width: 480px\)/);
  assert.match(mediaRoutes, /\/api\/workforce\/material-request-media/);
  assert.match(mediaRoutes, /material-request-\$\{Date\.now\(\)\}/);
});

test("malzeme talebi taslağı aynı kartta eklenir, güncellenir, kaldırılır ve kapanışta korunur", () => {
  const { api, localStorage, bodyClasses } = materialUiHarness();
  api.state.materialDraftOwner = "isolated-ui-test";
  api.state.materialDepartment = "Bakım Atölyesi";
  api.state.materialComposerOpen = true;
  bodyClasses.add("is-material-request-dialog-open");

  api.addMaterialDraftItem(materialDraftEvent({ name: "İzole rulman", quantity: "2.5", unit: "paket", usageLocation: "Deneme tezgâhı" }));
  api.addMaterialDraftItem(materialDraftEvent({ name: "İzole V kayışı", quantity: "1", unit: "adet" }));
  assert.equal(api.state.materialItems.length, 2);

  const firstId = api.state.materialItems[0].id;
  const secondId = api.state.materialItems[1].id;
  api.editMaterialDraftItem(firstId);
  api.addMaterialDraftItem(materialDraftEvent({ name: "İzole rulman", quantity: "3.5", unit: "paket", usageLocation: "Deneme tezgâhı" }));
  assert.equal(api.state.materialItems.length, 2);
  assert.equal(api.state.materialItems.find((item) => item.id === firstId).quantity, 3.5);

  api.removeMaterialDraftItem(secondId);
  assert.deepEqual(Array.from(api.state.materialItems, (item) => item.id), [firstId]);

  api.openMaterialReview();
  assert.equal(api.state.materialReviewOpen, true);
  api.closeMaterialReview();
  assert.equal(api.state.materialReviewOpen, false);

  api.closeMaterialComposer({ render: false, restoreFocus: false });
  assert.equal(api.state.materialComposerOpen, false);
  assert.equal(bodyClasses.has("is-material-request-dialog-open"), false);
  const saved = JSON.parse(localStorage.getItem("menu-suite.personel.material-request-draft.v1:isolated-ui-test"));
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].quantity, 3.5);
});

test("kodsuz ve stoktan fazla çok kalemli talep atomik, kullanıcıya özel ve idempotent kaydedilir", async (context) => {
  const runtime = await materialRuntime(context);
  const initial = await runtime.store.read();
  const initialQuantity = totalQuantity(initial.stockState);
  const body = {
    department: "",
    items: [
      { name: "Özel keçeli yatak", quantity: 2.5, unit: "paket", supplier: "Deneme Tedarikçi", usageLocation: "Pres hattı", neededDate: "2026-11-01", description: "Kod bilinmiyor", imageUrl: "/media/material-request-fixture.png" },
      { name: "6204 rulman", code: "RLM-6204", quantity: 8, unit: "adet" },
      { name: "V Kayışı A42", code: "V-A42", quantity: 999, unit: "adet" }
    ]
  };
  const options = mutation("material-create-0001", body, { "X-Test-User": "person-1" });

  let response = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, options);
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  assert.match(created.materialRequest.requestNumber, /^MT-\d{4}-\d{4}$/);
  assert.equal(created.materialRequest.items.length, 3);
  assert.equal(created.materialRequest.items[0].quantity, 2.5);
  assert.equal(created.materialRequest.items[0].unit, "paket");
  assert.equal(created.materialRequest.items[0].imageUrl, "/media/material-request-fixture.png");
  assert.equal(created.materialRequest.department, "Bakım Atölyesi");

  response = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, options);
  assert.equal(response.status, 200, await response.clone().text());
  const replay = await response.json();
  assert.equal(replay.idempotent, true);
  assert.equal(replay.materialRequest.id, created.materialRequest.id);

  response = await fetch(`${runtime.baseUrl}/api/workforce/me?scope=materialrequests`, { headers: { "X-Test-User": "person-1" } });
  assert.equal(response.status, 200);
  const ownerView = await response.json();
  assert.deepEqual(ownerView.materialRequests.map((item) => item.personId), ["person-1"]);
  assert.equal(ownerView.materialRequests[0].items.length, 3);

  response = await fetch(`${runtime.baseUrl}/api/workforce/me?scope=materialrequests`, { headers: { "X-Test-User": "person-2" } });
  assert.equal(response.status, 200);
  const otherView = await response.json();
  assert.deepEqual(otherView.materialRequests.map((item) => item.personId), ["person-2"]);

  response = await fetch(`${runtime.baseUrl}/api/workforce/me?scope=materialrequests`, { headers: { "X-Test-User": "person-denied" } });
  assert.equal(response.status, 403);

  const stored = await runtime.store.read();
  assert.equal(stored.workforceMaterialRequests.filter((item) => item.personId === "person-1").length, 1);
  assert.equal(stored.notifications.filter((item) => item.eventType === "material_request_created").length, 1);
  assert.equal(totalQuantity(stored.stockState), initialQuantity);
});

test("yönetici eşleştirme ve ürün kartı oluşturmayı tekrar oynatmadan yapar, görseli korur ve stoğu artırmaz", async (context) => {
  const runtime = await materialRuntime(context);
  const createResponse = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, mutation("material-create-0002", {
    department: "Bakım Atölyesi",
    items: [
      { name: "6204 rulman", code: "RLM-6204", quantity: 4, unit: "adet" },
      { name: "Pnömatik bakım seti", code: "PBS-77", quantity: 1, unit: "set", supplier: "Pnömatik AŞ", description: "Hat bakımı", imageUrl: "/media/material-request-product.png" },
      { name: "Farklı adlı aynı kod", code: "RLM-6204", quantity: 1, unit: "adet" }
    ]
  }, { "X-Test-User": "person-1" }));
  assert.equal(createResponse.status, 201, await createResponse.clone().text());
  const created = (await createResponse.json()).materialRequest;
  const [matchItem, createItem, duplicateCodeItem] = created.items;
  const before = await runtime.store.read();
  const beforeQuantity = totalQuantity(before.stockState);
  const beforeProductCount = before.stockState.products.length;

  const matchUrl = `${runtime.baseUrl}/api/admin/workforce/material-requests/${created.id}/items/${matchItem.id}/match`;
  let response = await fetch(matchUrl, mutation("material-match-0001", { productId: "product-bearing" }, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 200, await response.clone().text());
  response = await fetch(matchUrl, mutation("material-match-0001", { productId: "product-bearing" }, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);

  const productUrl = `${runtime.baseUrl}/api/admin/workforce/material-requests/${created.id}/items/${createItem.id}/product`;
  const productInput = { name: "Pnömatik bakım seti", productCode: "PBS-77", categoryId: "category-maintenance", baseUnit: "adet", bulkUnit: "", unitsPerBulkUnit: 0, allowDecimal: false, note: "Hat bakımı" };
  response = await fetch(productUrl, mutation("material-product-0001", productInput, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 201, await response.clone().text());
  const productCreated = await response.json();
  assert.equal(productCreated.product.imageUrl, "/media/material-request-product.png");
  assert.equal(productCreated.product.baseUnit, "adet");
  assert.equal(productCreated.product.bulkUnit, "");
  assert.equal(productCreated.product.allowDecimal, false);
  assert.equal(productCreated.product.categoryId, "category-maintenance");
  assert.equal(productCreated.product.note, "Hat bakımı");
  assert.equal(productCreated.product.sourceRequestId, created.id);
  assert.equal(productCreated.product.sourceRequestItemId, createItem.id);

  response = await fetch(productUrl, mutation("material-product-0001", productInput, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).idempotent, true);
  response = await fetch(productUrl, mutation("material-product-0002", productInput, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).product.id, productCreated.product.id);

  const duplicateUrl = `${runtime.baseUrl}/api/admin/workforce/material-requests/${created.id}/items/${duplicateCodeItem.id}/product`;
  response = await fetch(duplicateUrl, mutation("material-product-duplicate-code", { name: "Farklı adlı aynı kod", productCode: "RLM-6204", categoryId: "category-maintenance", baseUnit: "adet" }, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 409);

  const decisionUrl = `${runtime.baseUrl}/api/admin/workforce/material-requests/${created.id}/approve`;
  response = await fetch(decisionUrl, mutation("material-decision-0001", { note: "Satın alma listesine alındı." }, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 200);
  response = await fetch(decisionUrl, mutation("material-decision-0001", { note: "Satın alma listesine alındı." }, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);

  const after = await runtime.store.read();
  const storedRequest = after.workforceMaterialRequests.find((item) => item.id === created.id);
  assert.equal(storedRequest.status, "onaylandı");
  assert.equal(storedRequest.items[0].linkedProductId, "product-bearing");
  assert.equal(storedRequest.items[1].linkedProductId, productCreated.product.id);
  assert.equal(after.stockState.products.length, beforeProductCount + 1);
  assert.deepEqual(after.stockState.locations, before.stockState.locations, "Ürün kategorisi depo oluşturmaz veya değiştirmez");
  assert.equal(totalQuantity(after.stockState), beforeQuantity);
  assert.equal(stockService.getProductBalance(after.stockState, stockService.GENERAL_LOCATION_ID, productCreated.product.id).quantity, 0);
  assert.equal(after.notifications.filter((item) => item.eventType === "material_request_approved").length, 1);
});

test("malzeme talebi ayrı kalırken mevcut izin talebi oluşturma ve bekleyen kaydı iptal etme akışı korunur", async (context) => {
  const runtime = await materialRuntime(context);
  let response = await fetch(`${runtime.baseUrl}/api/workforce/shift-requests`, mutation("shift-create-after-material", {
    date: "2099-01-02", type: "leave", description: "İzole izin denemesi"
  }, { "X-Test-User": "person-1" }));
  assert.equal(response.status, 201, await response.clone().text());
  const request = (await response.json()).request;
  response = await fetch(`${runtime.baseUrl}/api/workforce/shift-requests/${request.id}`, {
    ...mutation("shift-cancel-after-material", {}, { "X-Test-User": "person-1" }),
    method: "DELETE"
  });
  assert.equal(response.status, 200, await response.clone().text());
  const cancelled = await response.json();
  assert.equal(cancelled.request.status, "iptal_edildi");
  const stored = await runtime.store.read();
  assert.equal(stored.workforceShiftRequests.find((item) => item.id === request.id).status, "iptal_edildi");
  assert.equal(stored.workforceMaterialRequests.length, 1);
});

test("izin tarih aralığı, saat ve sebep sunucuda saklanır; bildirim ve tekrar gönderim tutarlı", async context => {
  const runtime=await materialRuntime(context);
  const body={ date:"2099-01-05", endDate:"2099-01-11", type:"leave", specificHours:true, startTime:"14:00", endTime:"10:00", description:"İzole test: aile işi" };
  let response=await fetch(`${runtime.baseUrl}/api/workforce/shift-requests`, mutation("leave-range-1",body));
  assert.equal(response.status,201,await response.clone().text());
  const request=(await response.json()).request;
  assert.equal(request.endDate,body.endDate);
  assert.equal(request.dayCount,6);
  assert.equal(request.startTime,"14:00");
  assert.equal(request.endTime,"10:00");
  assert.equal(request.description,body.description);
  response=await fetch(`${runtime.baseUrl}/api/workforce/shift-requests`,mutation("leave-range-1",body));
  assert.equal(response.status,200);
  assert.equal((await response.json()).idempotent,true);
  const data=await runtime.store.read();
  assert.equal(data.workforceShiftRequests.length,1);
  assert.equal(data.workforceShiftRequests[0].endDate,body.endDate);
  const notification=data.notifications.find(item=>item.eventType==="shift_request_created");
  assert.ok(notification.body.includes(body.endDate));
  assert.ok(notification.body.includes("14:00"));
  response=await fetch(`${runtime.baseUrl}/api/admin/workforce/shift-requests/${request.id}/approve`,mutation("leave-range-approve",{}, {"X-Test-Role":"admin"}));
  assert.equal(response.status,200,await response.clone().text());
  assert.ok((await runtime.store.read()).notifications.find(item=>item.eventType==="shift_request_approved").body.includes(body.endDate));
});

test("izin sunucusu geçersiz tarih, ters aralık ve aynı gün ters saati reddeder", async context => {
  const runtime=await materialRuntime(context);
  for (const [index,body] of [
    {date:"2099-02-30",endDate:"2099-03-02",type:"leave"},
    {date:"2099-01-06",endDate:"2099-01-05",type:"leave"},
    {date:"2099-01-05",type:"leave",specificHours:true,startTime:"12:00",endTime:"08:00"},
    {date:"2099-01-05",type:"leave",specificHours:true,startTime:"25:00",endTime:"12:00"}
  ].entries()) {
    const response=await fetch(`${runtime.baseUrl}/api/workforce/shift-requests`,mutation(`leave-invalid-${index}`,body));
    assert.equal(response.status,400,await response.clone().text());
  }
  assert.equal((await runtime.store.read()).workforceShiftRequests.length,0);
});

function materialUiHarness() {
  const storage = new Map();
  const bodyClasses = new Set();
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(String(key), String(value)); },
    removeItem(key) { storage.delete(String(key)); }
  };
  const document = {
    readyState: "loading",
    hidden: false,
    activeElement: null,
    addEventListener() {},
    getElementById() { return null; },
    body: {
      classList: {
        add(name) { bodyClasses.add(name); },
        remove(name) { bodyClasses.delete(name); },
        contains(name) { return bodyClasses.has(name); },
        toggle(name, force) {
          if (force === undefined ? !bodyClasses.has(name) : force) bodyClasses.add(name);
          else bodyClasses.delete(name);
        }
      }
    }
  };
  const window = {
    location: { search: "", origin: "http://localhost" },
    crypto: { randomUUID: crypto.randomUUID },
    EventSource: null,
    confirm() { return true; },
    requestAnimationFrame(callback) { callback(); },
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout
  };
  const sandbox = {
    window,
    document,
    localStorage,
    URL,
    URLSearchParams,
    Intl,
    Date,
    Math,
    JSON,
    Number,
    String,
    Object,
    Array,
    Set,
    Map,
    Promise,
    structuredClone,
    CSS: { escape(value) { return String(value); } },
    fetch: async () => { throw new Error("İzole arayüz testi ağ isteği yapmamalıdır."); },
    console
  };
  window.document = document;
  window.localStorage = localStorage;
  const context = vm.createContext(sandbox);
  const hook = "window.__materialUiTest = { state, addMaterialDraftItem, editMaterialDraftItem, removeMaterialDraftItem, openMaterialReview, closeMaterialReview, closeMaterialComposer };";
  const source = read("PERSONEL/workforce.js").replace(/\r?\n\}\)\(\);\s*$/, `\n  ${hook}\n})();\n`);
  assert.match(source, /__materialUiTest/);
  vm.runInContext(source, context, { filename: "PERSONEL/workforce.js" });
  return { api: window.__materialUiTest, localStorage, bodyClasses };
}

function materialDraftEvent(values) {
  const fields = {
    name: "",
    code: "",
    quantity: "",
    unit: "adet",
    supplier: "",
    usageLocation: "",
    neededDate: "",
    description: "",
    ...values
  };
  const elements = Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, { value: String(value) }]));
  return {
    preventDefault() {},
    currentTarget: { elements, reportValidity() { return true; } }
  };
}

async function materialRuntime(context) {
  const users = [
    person("person-1", "Bakım Personeli", true),
    person("person-2", "Diğer Personel", true),
    person("person-denied", "Yetkisiz Personel", false)
  ];
  const store = memoryStore({
    schemaVersion: STORE_SCHEMA_VERSION,
    revisions: { workforce: 0, stock: 0, catalog: 0 },
    recipeUsers: users,
    workforceMaterialRequests: [{
      id: "material-request-other",
      requestNumber: "MT-2026-0001",
      personId: "person-2",
      personnelId: "person-2",
      personName: "Diğer Personel",
      department: "Elektrik",
      status: "onay_bekliyor",
      items: [{ id: "material-item-other", name: "Kablo bağı", quantity: 5, unit: "adet" }],
      createdAt: "2026-10-01T08:00:00.000Z",
      updatedAt: "2026-10-01T08:00:00.000Z",
      revision: 1
    }],
    workforceShiftRequests: [],
    stockState: stockFixture(),
    notifications: []
  });
  const createdNotifications = [];
  const notificationService = {
    createNotificationInStore(data, input) {
      const notification = { id: `notification-${createdNotifications.length + 1}`, createdAt: new Date().toISOString(), ...input };
      data.notifications = (data.notifications || []).concat(notification);
      createdNotifications.push(notification);
      return notification;
    },
    notificationsFromResult(value) { return value ? [value] : []; },
    publishNotificationEvent() {}
  };
  const app = express();
  app.use(express.json());
  const pass = (_req, _res, next) => next();
  const setPerson = (req, res, next) => {
    const user = users.find((item) => item.id === String(req.get("X-Test-User") || "person-1"));
    if (!user) return res.status(401).json({ ok: false, message: "Oturum gerekli." });
    req.recipe = { role: "recipe", sessionRole: "personel", userId: user.id };
    req.recipeUser = user;
    return next();
  };
  const auth = {
    requireAdmin(req, res, next) {
      if (req.get("X-Test-Role") !== "admin") return res.status(401).json({ ok: false, message: "Yönetici oturumu gerekli." });
      req.admin = { userId: "admin", name: "Test Yöneticisi" };
      return next();
    },
    requirePersonelOrPreview: setPerson,
    requireActivePersonel: setPerson,
    requirePersonelSection(section) {
      return (req, res, next) => req.recipeUser?.personelSectionAccess?.[section] === false
        ? res.status(403).json({ ok: false, message: "Bölüm yetkisi yok." }) : next();
    }
  };
  registerWorkforceRoutes({
    app, store, auth, crypto, normalizeStockState,
    requireAdminRequestOrigin: pass,
    requireAdminOrMainRequestOrigin: pass,
    broadcastStockUpdate() {},
    notificationService
  });
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error.status || 500).json({ ok: false, code: error.code, message: error.message });
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return { store, users, createdNotifications, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test("boş bölüm bağlı depodan çözülür, katalog görseli güvenli kabul edilir ve talep yeniden oynatılır", async context => {
  const runtime = await materialRuntime(context);
  runtime.users[0].department = "";
  runtime.users[0].stockLocationId = stockService.GENERAL_LOCATION_ID;
  await runtime.store.update(data => {
    data.recipeUsers[0].department = "";
    data.recipeUsers[0].stockLocationId = stockService.GENERAL_LOCATION_ID;
    data.stockState.products.find(product => product.id === "product-bearing").imageUrl = "/media/rulman.png";
  });
  const before = await runtime.store.read();
  const options = mutation("catalog-critical-test-0001", { items: [{ productId: "product-bearing", name: "6204 rulman", quantity: 10, unit: "adet", imageUrl: "/media/rulman.png" }] });
  let response = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, options);
  assert.equal(response.status, 201, await response.clone().text());
  const request = (await response.json()).materialRequest;
  assert.equal(request.department, "Genel Depo");
  assert.equal(request.items[0].linkedProductId, "product-bearing");
  assert.equal(request.items[0].imageUrl, "/media/rulman.png");
  response = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, options);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).materialRequest.id, request.id);
  assert.deepEqual((await runtime.store.read()).stockState, before.stockState);
  for (const item of [
    { productId: "product-bearing", name: "6204 rulman", quantity: 1, unit: "adet", imageUrl: "/media/untrusted.png" },
    { productId: "missing", name: "Eksik ürün", quantity: 1, unit: "adet" },
    { name: "Kesirli adet", quantity: 1.5, unit: "adet" }
  ]) {
    response = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, mutation(crypto.randomUUID(), { items: [item] }));
    assert.ok([400, 422].includes(response.status));
  }
  runtime.users[0].stockLocationId = "";
  response = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, mutation("no-department-test-0001", { items: [{ name: "Rulman", quantity: 1, unit: "adet" }] }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).message, /bağlı olduğu depoyu/);
});

test("görev erişimi kapalı alıcıya sessiz görev veya yetki değişikliği yapılmaz", async context => {
  const runtime = await materialRuntime(context);
  await runtime.store.update(data => { data.recipeUsers[0].personelSectionAccess.tasks = false; });
  const before = await runtime.store.read();
  const response = await fetch(`${runtime.baseUrl}/api/admin/workforce/tasks`, mutation("inaccessible-task-test-0001", { title: "Rafı kontrol et", items: ["A1 rafına bak"], assignedUserIds: ["person-1"] }, { "X-Test-Role": "admin" }));
  assert.equal(response.status, 422, await response.clone().text());
  assert.match((await response.json()).message, /Görevlerim erişimi kapalı/);
  const after = await runtime.store.read();
  assert.deepEqual(after.workforceTasks, before.workforceTasks);
  assert.deepEqual(after.notifications, before.notifications);
  assert.equal(after.recipeUsers[0].personelSectionAccess.tasks, false);
});

function person(id, name, materialRequest) {
  return {
    id, username: id, name, active: true, department: id === "person-1" ? "Bakım Atölyesi" : "Elektrik",
    personelSectionAccess: { recipe: true, tasks: true, stock: true, materialRequest, shipment: true, shift: true }
  };
}

test('eşleştirme kataloğu güncel depo bakiyelerini toplar; görüntüleme stoğu değiştirmez', async (context) => {
  const runtime = await materialRuntime(context);
  await runtime.store.update((data) => {
    data.stockState.products.find(product => product.id === 'product-bearing').imageUrl = '/media/rulman.png';
    data.stockState.locations.push({ id: 'workshop-test', code: 'TEST', name: 'Test Atölyesi', type: 'workshop', active: true });
    data.stockState.balances.find(balance => balance.productId === 'product-bearing').quantity = 5;
    data.stockState.balances.push({ productId: 'product-bearing', locationId: 'workshop-test', quantity: 7, revision: 0 });
    data.stockState.balances.find(balance => balance.productId === 'product-belt').quantity = 0;
  });
  const before = await runtime.store.read();
  const response = await fetch(`${runtime.baseUrl}/api/admin/workforce?scope=materialrequests`, { headers: { 'X-Test-Role': 'admin' } });
  assert.equal(response.status, 200, await response.clone().text());
  const catalog = (await response.json()).materialRequestCatalog;
  const bearing = catalog.products.find(product => product.id === 'product-bearing');
  assert.equal(bearing.quantity, 12);
  assert.equal(bearing.imageUrl, '/media/rulman.png');
  assert.equal(bearing.productCode, 'RLM-6204');
  assert.equal(catalog.products.find(product => product.id === 'product-belt').quantity, 0);
  assert.deepEqual((await runtime.store.read()).stockState, before.stockState);
});

function stockFixture() {
  return normalizeStockState({
    version: 1,
    categories: [{ id: "category-maintenance", name: "Bakım Atölyesi", active: true, sourcePresent: true }],
    products: [
      { id: "product-bearing", name: "6204 rulman", productName: "6204 rulman", productCode: "RLM-6204", categoryId: "category-maintenance", category: "Bakım Atölyesi", baseUnit: "adet", unit: "adet", active: true, sourcePresent: true },
      { id: "product-belt", name: "V Kayışı A42", productName: "V Kayışı A42", productCode: "V-A42", categoryId: "category-maintenance", category: "Bakım Atölyesi", baseUnit: "adet", unit: "adet", active: true, sourcePresent: true }
    ],
    locations: [{ id: stockService.GENERAL_LOCATION_ID, code: "GENEL", name: "Genel Depo", type: "central", active: true, personnelVisible: true }],
    balances: [
      { locationId: stockService.GENERAL_LOCATION_ID, productId: "product-bearing", quantity: 0, revision: 0 },
      { locationId: stockService.GENERAL_LOCATION_ID, productId: "product-belt", quantity: 2, revision: 0 }
    ],
    movements: [],
    unitDefinitions: { base: ["adet", "set"], bulk: ["koli", "set"] }
  });
}

function totalQuantity(stockState) {
  return (stockState.balances || []).reduce((sum, balance) => sum + Number(balance.quantity || 0), 0);
}

function mutation(requestId, body, headers = {}) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, "X-Request-ID": requestId, ...headers },
    body: JSON.stringify({ ...body, requestId })
  };
}

function memoryStore(seed) {
  let state = normalizeStore(seed);
  const noChange = Symbol("no-change");
  return {
    async read() { return structuredClone(state); },
    async update(mutator) {
      const draft = structuredClone(state);
      const result = await mutator(draft, { noChange });
      if (result !== noChange) state = normalizeStore(result === undefined ? draft : result);
      return structuredClone(state);
    }
  };
}

test("toplu kalem onayı 10 yerine 5 saklar; diğer kalem bekler, bildirimi yalnız sahibine gider ve tekrar oynatma değişmez", async context => {
  const runtime = await materialRuntime(context);
  await runtime.store.update(data => {
    data.stockState.locations.push({id:"electrical-test-depot",name:"Elektrik Deposu",code:"ELK",type:"workshop",active:true});
    data.recipeUsers.find(u => u.id === "person-2").stockLocationId="electrical-test-depot";
    data.workforceMaterialRequests.find(r => r.personId === "person-2").depotId="electrical-test-depot";
  });
  const response = await fetch(`${runtime.baseUrl}/api/workforce/material-requests`, mutation("batch-create-test-0001", {
    items: [{ name: "Rulman", code: "00006204", quantity: 10, unit: "adet" }, { name: "Kayış", quantity: 2, unit: "adet" }]
  }, {"X-Test-User":"person-1"}));
  const created = (await response.json()).materialRequest;
  assert.ok(created);
  const before = await runtime.store.read();
  const other = before.workforceMaterialRequests.find(r => r.personId === "person-2");
  const input = { requesterName: "Test Talep Eden", expectedRevision: before.revisions.workforce, selections: [
    { requestId: created.id, itemId: created.items[0].id, quantity: 5 },
    { requestId: other.id, itemId: other.items[0].id, quantity: 4 }
  ] };
  const url = `${runtime.baseUrl}/api/admin/workforce/material-request-batches`;
  let result = await fetch(url, mutation("batch-approve-test-0001", input, {"X-Test-Role":"admin"}));
  assert.equal(result.status, 200, await result.clone().text());
  const batch = await result.json();
  const after = await runtime.store.read();
  const saved = after.workforceMaterialRequests.find(r => r.id === created.id);
  assert.equal(saved.items[0].quantity, 10);
  assert.equal(saved.items[0].approvedQuantity, 5);
  assert.equal(saved.items[0].decisionStatus, "onaylandı");
  assert.equal(saved.items[1].approvedQuantity, undefined);
  assert.equal(saved.status, "onay_bekliyor");
  assert.equal(after.workforceMaterialRequests.find(r => r.id === other.id).status, "onaylandı");
  assert.deepEqual(after.stockState, before.stockState);
  assert.equal(after.workforceMaterialExports[0].requesterName, input.requesterName);
  assert.deepEqual(normalizeStore(JSON.parse(JSON.stringify(after))).workforceMaterialExports, after.workforceMaterialExports, "Sunucu yeniden okuduğunda indirme kaydı korunmalı");
  const notifications = after.notifications.filter(n => n.eventType === "material_request_approved");
  assert.equal(notifications.length, 2);
  assert.match(notifications.find(n => n.recipientId === "person-1").body, /istenen 10, onaylanan 5 adet/);
  assert.doesNotMatch(notifications.find(n => n.recipientId === "person-2").body, /Rulman/);
  result = await fetch(url, mutation("batch-approve-test-0001", input, {"X-Test-Role":"admin"}));
  assert.equal((await result.json()).idempotent, true);
  assert.deepEqual(await runtime.store.read(), after);
  result = await fetch(url, mutation("batch-approve-test-0001", {...input,requesterName:"Başka Kişi"}, {"X-Test-Role":"admin"}));
  assert.equal(result.status, 409);
  result = await fetch(`${runtime.baseUrl}${batch.exportUrl}`, {headers:{"X-Test-Role":"admin"}});
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type"), /spreadsheetml/);
  const ExcelJS = require("exceljs"), workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await result.arrayBuffer()));
  assert.equal(workbook.worksheets.length, 2, "Farklı depolar aynı başlık altında karışmamalı");
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("H3").value, input.requesterName);
  assert.equal(sheet.getCell("H2").value, "Bakım Atölyesi");
  assert.equal(sheet.getCell("D5").value, "00006204");
  assert.equal(sheet.getCell("F5").value, 5);
  assert.equal(sheet.getCell("A24").value, 20);
  assert.equal(sheet.getCell("A25").value, "Siparişi Veren");
  assert.equal(sheet.getCell("E6").value, null, "Bekleyen kayış çıktıya girmemeli");
  const { turkeyDate } = require("../src/material-request-excel");
  assert.equal(sheet.getCell("C2").value.toISOString().slice(0,10), turkeyDate());
  assert.equal(sheet.getCell("C2").numFmt, "dd.mm.yyyy");
  assert.equal(sheet.pageSetup.printArea, "A1:K27");
  result = await fetch(`${runtime.baseUrl}${batch.exportUrl}`, {headers:{"X-Test-User":"person-1"}});
  assert.equal(result.status, 401);
  // Eski 'talebi onayla' sadece kalan kalemi onaylar; önceki miktarı ezmez.
  result = await fetch(`${runtime.baseUrl}/api/admin/workforce/material-requests/${created.id}/approve`, mutation("batch-remaining-test-0001", {}, {"X-Test-Role":"admin"}));
  assert.equal(result.status, 200);
  const completed = (await runtime.store.read()).workforceMaterialRequests.find(r => r.id === created.id);
  assert.equal(completed.status, "onaylandı");
  assert.equal(completed.items[0].approvedQuantity, 5);
  assert.equal(completed.items[1].approvedQuantity, 2);
});

test("toplu onay boş ad, geçersiz sayı, yinelenen kalem, eski revision ve bilinmeyen kalemi atomik reddeder", async context => {
  const runtime=await materialRuntime(context), before=await runtime.store.read();
  const request=before.workforceMaterialRequests[0], item=request.items[0];
  const valid={requesterName:"Test Eden",expectedRevision:before.revisions.workforce,selections:[{requestId:request.id,itemId:item.id,quantity:3}]};
  const invalid=[
    [{...valid,requesterName:" "},400], [{...valid,selections:[]},400],
    [{...valid,selections:[null]},400],
    ...[0,-1,1.5,"x",1000000001].map(quantity=>[{...valid,selections:[{...valid.selections[0],quantity}]},400]),
    [{...valid,selections:[valid.selections[0],valid.selections[0]]},400],
    [{...valid,expectedRevision:before.revisions.workforce+1},409],
    [{...valid,selections:[valid.selections[0],{requestId:request.id,itemId:"missing",quantity:2}]},404]
  ];
  for(let i=0;i<invalid.length;i++) {
    const [body,status]=invalid[i];
    const response=await fetch(`${runtime.baseUrl}/api/admin/workforce/material-request-batches`,mutation(`batch-invalid-${String(i).padStart(4,"0")}`,body,{"X-Test-Role":"admin"}));
    assert.equal(response.status,status,await response.clone().text());
    assert.deepEqual(await runtime.store.read(),before);
  }
});

test("Excel 20 satırlık formlarla 21 kalemi kayıpsız böler; görselin doğal oranı ve İstanbul çıktı günü korunur", async context => {
  const os=require("node:os"), sharp=require("sharp"), ExcelJS=require("exceljs");
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"material-excel-test-"));
  context.after(()=>{ if(dir.startsWith(path.join(os.tmpdir(),"material-excel-test-")))fs.rmSync(dir,{recursive:true,force:true}); });
  fs.writeFileSync(path.join(dir,"material-request-wide.png"),await sharp({create:{width:200,height:50,channels:3,background:"#258050"}}).png().toBuffer());
  const {buildMaterialRequestExcel,localImage,turkeyDate}=require("../src/material-request-excel");
  assert.equal(turkeyDate(new Date("2026-10-08T22:30:00Z")),"2026-10-09");
  const options={mediaDir:dir,projectRoot:ROOT,now:new Date("2026-10-08T22:30:00Z")};
  assert.equal(await localImage("https://example.com/private.png",options),null);
  assert.equal(await localImage("/media/../../secret.png",options),null);
  const lines=Array.from({length:21},(_,i)=>({requestId:"r",requestNumber:"MT-2026-1",itemId:`i${i}`,department:"Bakım Atölyesi",name:`Test Malzeme ${i+1}`,code:`000${i}`,quantity:i+1,requestedQuantity:i+2,imageUrl:i===0?"/media/material-request-wide.png":"",usageLocation:"Bakım Atölyesi"}));
  const output=await buildMaterialRequestExcel({requesterName:"Test Talep Eden",lines},options);
  const w=new ExcelJS.Workbook();await w.xlsx.load(output);
  assert.equal(w.worksheets.length,2);
  assert.equal(w.worksheets[0].getCell("F24").value,20);
  assert.equal(w.worksheets[1].getCell("F5").value,21);
  assert.equal(w.worksheets[1].getCell("A24").value,20);
  assert.equal(w.worksheets[0].getCell("C2").value.toISOString().slice(0,10),"2026-10-09");
  const image=w.worksheets[0].getImages()[0];assert.ok(image);
  assert.ok(Math.abs(image.range.ext.width/image.range.ext.height-4)<0.0001, "OpenXML EMU rounding must preserve the natural ratio");
  assert.equal(w.worksheets[0].getCell("D5").value,"0000");
  for (const sheet of w.worksheets) for (let row = 1; row <= 27; row++) for (let col = 1; col <= 11; col++) {
    const cell = sheet.getCell(row, col);
    assert.equal(cell.alignment.horizontal, "center", `${sheet.name}!${cell.address} yatay ortalanmalı`);
    assert.equal(cell.alignment.vertical, "middle", `${sheet.name}!${cell.address} dikey ortalanmalı`);
  }
  assert.equal(w.worksheets[0].getCell("E5").alignment.wrapText, true, "uzun malzeme adlarının satır sarması korunmalı");
});

test("sunucu yeniden açıldığında kısmi karar ve Excel indirme snapshot'ı diskte korunur", async context => {
  const os=require("node:os"), fsp=require("node:fs/promises");
  const {createFileStore,defaultStore}=require("../src/store/file-store");
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),"sts-material-persistence-"));
  let first,second;
  context.after(async()=>{await first?.close();await second?.close();if(dir.startsWith(path.join(os.tmpdir(),"sts-material-persistence-")))await fsp.rm(dir,{recursive:true,force:true});});
  const file=path.join(dir,"store.json"),seed=defaultStore("$2b$12$testMaterialPersistenceFixtureOnly00000000000000000");
  seed.workforceMaterialRequests=[{id:"request",requestNumber:"MT-TEST",personId:"person",status:"onay_bekliyor",items:[{id:"item",name:"Rulman",quantity:10,unit:"adet"},{id:"pending",name:"Kayış",quantity:2,unit:"adet"}]}];
  await fsp.writeFile(file,JSON.stringify(seed));
  const options={writerLock:false,enableEventLoopMetrics:false};
  first=createFileStore(file,options);await first.ensure();
  await first.update(data=>{
    data.workforceMaterialRequests[0].items[0].decisionStatus="onaylandı";
    data.workforceMaterialRequests[0].items[0].approvedQuantity=5;
    data.workforceMaterialExports=[{id:"export",requesterName:"Test Eden",createdAt:new Date().toISOString(),lines:[{requestId:"request",itemId:"item",requestNumber:"MT-TEST",name:"Rulman",code:"0001",department:"Bakım Atölyesi",quantity:5,requestedQuantity:10}]}];
  });
  await first.close();first=null;
  second=createFileStore(file,options);await second.ensure();
  const restored=await second.read();
  assert.equal(restored.workforceMaterialRequests[0].status,"onay_bekliyor");
  assert.equal(restored.workforceMaterialRequests[0].items[0].approvedQuantity,5);
  assert.equal(restored.workforceMaterialRequests[0].items[1].approvedQuantity,undefined);
  const ExcelJS=require("exceljs"),w=new ExcelJS.Workbook();
  const {buildMaterialRequestExcel}=require("../src/material-request-excel");
  await w.xlsx.load(await buildMaterialRequestExcel(restored.workforceMaterialExports[0]));
  assert.equal(w.worksheets[0].getCell("F5").value,5);
  assert.equal(w.worksheets[0].getCell("H3").value,"Test Eden");
});
