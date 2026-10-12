"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { permissionsPolicyForPath } = require("../src/http-permissions");
const root = path.resolve(__dirname, "../../..");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE");
const source = fs.readFileSync(path.join(moduleRoot, "scripts/catalog-barcode.js"), "utf8");
const settle = () => new Promise(setImmediate);

function runtime({ cameraError, delayedCamera = false, delayedImage = false } = {}) {
  const elements = new Map(), used = [], revoked = [], calls = [];
  const makeNode = () => ({
    open: false, hidden: true, disabled: false, textContent: "", value: "", src: "", dataset: {}, files: [], events: {}, isConnected: true,
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); },
    removeEventListener(type, fn) { this.events[type] = (this.events[type] || []).filter(item => item !== fn); },
    fire(type, extra = {}) { this.events[type]?.forEach(fn => fn({ preventDefault() {}, ...extra })); },
    setAttribute() {}, removeAttribute(name) { this[name] = ""; }, focus() {}, click() { this.fire("click"); },
    showModal() { this.open = true; }, close() { this.open = false; this.fire("close"); }
  });
  const doc = makeNode(), win = makeNode(), dialog = makeNode();
  const ids = [...fs.readFileSync(path.join(moduleRoot, "index.html"), "utf8").matchAll(/id="(catalogBarcode[^"]+)"/g)].map(m => m[1]);
  ids.forEach(id => elements.set(id, makeNode()));
  dialog.querySelector = selector => elements.get(selector.slice(1));
  doc.activeElement = makeNode();
  doc.hidden = false;
  doc.createElement = () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => "data:image/jpeg;base64,test" });
  const video = elements.get("catalogBarcodeVideo");
  video.pause = () => {};
  video.videoWidth = 1280;
  video.videoHeight = 720;
  let callback, resolveCamera, resolveImage, stopCount = 0, imageResult = "000123", imageError = null;
  const controls = { stop() { stopCount += 1; } };
  win.ZXingBrowser = { BrowserMultiFormatReader: class {
    async decodeFromConstraints(constraints, preview, cb) {
      calls.push({ kind: "camera", constraints }); callback = cb;
      if (cameraError) throw Object.assign(new Error("camera-error"), { name: cameraError });
      if (delayedCamera) return new Promise(resolve => { resolveCamera = resolve; });
      preview.srcObject = { getTracks: () => [{ stop() { stopCount += 1; } }] };
      return controls;
    }
    async decodeFromImageUrl(url) {
      calls.push({ kind: "image", url });
      if (delayedImage) return new Promise(resolve => { resolveImage = resolve; });
      if (imageError) throw imageError;
      return { getText: () => imageResult };
    }
  } };
  const context = { productId: "", name: "Yeni ürün", currentBarcode: "", products: [] };
  const sandbox = vm.createContext({ window: win, document: doc, navigator: { mediaDevices: { getUserMedia() {} } }, URL: { createObjectURL: () => "blob:test-photo", revokeObjectURL: url => revoked.push(url) }, console });
  vm.runInContext(source.replace(/export function/g, "function") + "\nthis.exports = {createCatalogBarcodeScanner, findBarcodeConflict};", sandbox);
  const scanner = sandbox.exports.createCatalogBarcodeScanner({ dialog, getContext: () => context, onUse: code => used.push(code) });
  return { scanner, dialog, context, elements, used, calls, revoked, doc, win, exports: sandbox.exports,
    code(value) { imageResult = value; }, failImage() { imageError = new Error("unreadable"); },
    cameraResult(code) { callback({ getText: () => code }, null, controls); },
    resolveCamera() { resolveCamera(controls); }, resolveImage(code) { resolveImage({ getText: () => code }); },
    stops: () => stopCount,
    photo() { const input=elements.get("catalogBarcodeFile"); input.files=[{ size: 1024, type: "image/png" }]; input.fire("change"); }
  };
}

test("yeni ve mevcut ürün aynı barkod okuyucuyu kullanır; etiketsiz menü ve taslak kayıt korunur", () => {
  const html = fs.readFileSync(path.join(moduleRoot, "index.html"), "utf8");
  const stock = fs.readFileSync(path.join(moduleRoot, "scripts/stock.js"), "utf8");
  const admin = fs.readFileSync(path.join(root, "YÖNETİCİ PANELİ/HTML/index.html"), "utf8");
  assert.equal((html.match(/id="stockCatalogBarcodeScan"/g) || []).length, 1);
  assert.match(html, /id="catalogBarcodeCameraFile"[^>]+capture="environment"/);
  assert.match(html, /zxing-browser.min.js\?v=0.2.1/);
  assert.doesNotMatch(admin, /data-panel-section="labels"|Etiket oluşturma/);
  assert.match(stock, /draft.id \? "Ürünü Düzenle" : "Yeni Ürün"/);
  const onUse = stock.slice(stock.indexOf("onUse: (code) =>"), stock.indexOf('$("#stockCatalogBarcodeScan")?.addEventListener'));
  assert.match(onUse, /captureCatalogProductDraft\(\)/);
  assert.doesNotMatch(onUse, /saveCatalogProduct|faturaApi|fetch\(/);
  assert.match(source, /if \(!dialog.open && !controls && !pending && !busy && !objectUrls.size\) return;/);
  const css = fs.readFileSync(path.join(moduleRoot, "styles/stock.css"), "utf8");
  assert.match(css, /\.stock-barcode-body\s*\{[^}]*grid-auto-rows: max-content/);
  assert.match(css, /\.stock-barcode-preview\s*\{[^}]*height: min\(200px, 26dvh\)/);
  assert.match(css, /\.stock-barcode-preview :is\(video, img\)\s*\{[^}]*object-fit: contain/);
  assert.doesNotMatch(source, /fetch\(|localStorage|\/api\/media/);
  assert.match(stock, /catalogBarcodeScanner\?\.destroy\(\)/);
});

test("kapalı okuyucuya tekrar durdurma DOM'u oynatmaz; canlı fotoğraf kodu onay bekler", async () => {
  const r = runtime();
  let writes = 0;
  r.elements.get("catalogBarcodeVideo").pause = () => { writes += 1; };
  r.scanner.close(); r.scanner.close();
  assert.equal(writes, 0);
  r.scanner.open(); await settle();
  r.elements.get("catalogBarcodeCapture").click(); await settle();
  assert.ok(r.calls.some(call => call.kind === "image" && call.url.startsWith("data:image/jpeg")));
  assert.equal(r.elements.get("catalogBarcodeValue").textContent, "000123");
  assert.deepEqual(r.used, []);
  r.scanner.close();
  const afterClose = writes;
  r.scanner.close(); r.scanner.destroy();
  assert.equal(writes, afterClose);
});

test("kamera politikası yalnız yönetici belgelerinde self; diğer erişimler kapalıdır", () => {
  for (const route of ["/yonetici", "/yonetici/", "/yonetici/index.html", "/yonetici/modules/tedarik-muhasebe/", "/yonetici/modules/tedarik-muhasebe/index.html"]) assert.equal(permissionsPolicyForPath(route), "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  for (const route of ["/api/health", "/api/admin/me", "/personel/", "/yonetici/other.html", "/shared/scripts/zxing-browser.min.js", "/external/"]) assert.equal(permissionsPolicyForPath(route), "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
});

test("kamera kodu onaydan önce aktarmaz; ses istenmez ve kamera durur", async () => {
  const r = runtime(); r.scanner.open(); await settle();
  assert.equal(r.calls[0].constraints.audio, false);
  assert.equal(r.calls[0].constraints.video.facingMode.ideal, "environment");
  assert.deepEqual(r.used, []);
  r.cameraResult("000123");
  assert.deepEqual(r.used, []);
  assert.equal(r.elements.get("catalogBarcodeValue").textContent, "000123");
  assert.ok(r.stops() > 0);
  r.elements.get("catalogBarcodeUse").click();
  assert.deepEqual(r.used, ["000123"]);
  assert.equal(r.dialog.open, false);
});

test("fotoğraftan okuma baştaki sıfırları korur ve görsel URL'sini temizler", async () => {
  const r=runtime({cameraError: "NotFoundError"}); r.scanner.open(); await settle();
  assert.match(r.elements.get("catalogBarcodeStatus").textContent, /Kamera bulunamadı/);
  r.photo(); await settle();
  assert.deepEqual(r.revoked, ["blob:test-photo"]);
  assert.equal(r.elements.get("catalogBarcodeUse").disabled, false);
  assert.equal(r.elements.get("catalogBarcodeValue").textContent, "000123");
  r.elements.get("catalogBarcodeUse").click();
  assert.deepEqual(r.used, ["000123"]);
});

test("kamera izin reddi fotoğraf yolunu kapatmaz; bozuk görsel ve kontrol karakteri kaydedilmez", async () => {
  const r=runtime({cameraError: "NotAllowedError"}); r.scanner.open(); await settle();
  assert.match(r.elements.get("catalogBarcodeStatus").textContent, /Kamera izni verilmedi/);
  assert.equal(r.elements.get("catalogBarcodePhoto").disabled, false);
  r.failImage(); r.photo(); await settle();
  assert.match(r.elements.get("catalogBarcodeStatus").textContent, /barkod okunamadı/);
  assert.deepEqual(r.used, []);
  assert.equal(r.elements.get("catalogBarcodeUse").disabled, true);
  const bad=runtime(); bad.scanner.open(); await settle(); bad.cameraResult("BAD\nCODE");
  assert.equal(bad.elements.get("catalogBarcodeUse").disabled, true);
  assert.deepEqual(bad.used, []);
});

test("başka ürünün ana/alternatif barkodu engellenir; kendi kodu düzenlemede kullanılabilir", async () => {
  const r=runtime(); r.context.products=[{id:"p1", name:"Rulman", barcode:"000123", alternativeBarcodes:["ALT-1"], barcodes:[{value:"ALT-2"}]}];
  r.scanner.open(); await settle(); r.cameraResult("000123");
  assert.match(r.elements.get("catalogBarcodeStatus").textContent, /başka bir üründe/);
  assert.equal(r.elements.get("catalogBarcodeUse").disabled, true);
  assert.equal(r.exports.findBarcodeConflict(r.context.products,"ALT-1","" ).id,"p1");
  assert.equal(r.exports.findBarcodeConflict(r.context.products,"ALT-2","" ).id,"p1");
  r.scanner.close(); r.context.productId="p1"; r.context.currentBarcode="OLD-1";
  r.scanner.open(); await settle(); r.cameraResult("000123");
  assert.equal(r.elements.get("catalogBarcodeUse").disabled, false);
  assert.match(r.elements.get("catalogBarcodeReplace").textContent, /OLD-1/);
  assert.equal(r.elements.get("catalogBarcodeReplace").hidden, false);
});

test("pencere kapanırken gelen kamera/fotoğraf sonucu yok sayılır, yeni ürüne sızmaz", async () => {
  const r=runtime({delayedCamera:true}); r.scanner.open();
  assert.equal(r.elements.get("catalogBarcodePhoto").disabled, false, "İzin beklenirken fotoğraf yolu açık kalmalı");
  r.scanner.close(); r.resolveCamera(); await settle();
  assert.ok(r.stops()>0); assert.deepEqual(r.used,[]);
  const p=runtime({delayedImage:true,cameraError:"NotFoundError"}); p.scanner.open(); await settle(); p.photo();
  p.scanner.close(); p.context.productId="other-product"; p.resolveImage("000123"); await settle();
  assert.deepEqual(p.used,[]); assert.equal(p.elements.get("catalogBarcodeResult").hidden,true);
});

test("ESC ve sayfa gizlenmesi kamera akışını durdurur ve iptal kodu aktarmaz", async () => {
  const r=runtime(); r.scanner.open(); await settle(); r.dialog.fire("cancel");
  assert.equal(r.dialog.open,false); assert.ok(r.stops()>0); assert.deepEqual(r.used,[]);
  r.scanner.open(); await settle(); r.doc.hidden=true; r.doc.fire("visibilitychange");
  assert.equal(r.dialog.open,false); r.scanner.destroy();
  assert.equal(r.win.events.pagehide.length,0);
});

test("15 MB üzeri veya uygunsuz fotoğraf okuyucuya gönderilmez", async () => {
  const r=runtime({cameraError:"NotFoundError"}); r.scanner.open(); await settle();
  const input=r.elements.get("catalogBarcodeFile");
  for (const file of [{size:16*1024*1024,type:"image/png"},{size:1024,type:"image/svg+xml"}]) {
    input.files=[file]; input.fire("change"); await settle();
    assert.equal(r.calls.filter(call=>call.kind==="image").length,0);
    assert.equal(r.elements.get("catalogBarcodeUse").disabled,true);
  }
});

test("gerçek EAN-13 görseli barkod okuyucuda doğru çözülür", async () => {
  const zxing=require("@zxing/library"), sharp=require("sharp");
  const left=["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  const odd=["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
  const right=["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
  const value="8691234567890", parity="LGLGGL";
  const bits="0".repeat(12)+"101"+[...value.slice(1,7)].map((digit,i)=>(parity[i]==="L"?left:odd)[Number(digit)]).join("")+"01010"+[...value.slice(7)].map(digit=>right[Number(digit)]).join("")+"101"+"0".repeat(12);
  const width=bits.length*4,height=220,pixels=new Uint8ClampedArray(width*height).fill(255);
  for(let y=20;y<190;y++) for(let x=0;x<width;x++) if(bits[Math.floor(x/4)]==="1") pixels[y*width+x]=0;
  const bitmap=new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(pixels,width,height)));
  assert.equal(new zxing.MultiFormatReader().decode(bitmap,new Map()).getText(),value);
  const target=path.join(root,"LOCAL/test-artifacts/barcode-scan-fixture.png");
  await sharp(Buffer.from(pixels),{raw:{width,height,channels:1}}).png().toFile(target);
});
