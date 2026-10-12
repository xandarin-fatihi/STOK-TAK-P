"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../../..");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE");
const source = fs.readFileSync(path.join(moduleRoot, "scripts/document-history.js"), "utf8");
const caps = { documentsArchive:"doc-archive", inventoryCatalogManage:"catalog", inventoryLocationManage:"location", accountingPost:"post", accountingReverse:"reverse", paymentCreate:"pay", paymentReverse:"pay-reverse" };
function history(capabilities = Object.values(caps), sections = ["documents", "stock", "ledger"]) {
  const context = vm.createContext({ Intl, Date, CAPABILITIES:caps, has:(cap)=>capabilities.includes(cap), hasSection:(section)=>sections.includes(section), state:{}, esc:(text)=>String(text ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"), trDate:(value)=>new Date(value).toLocaleDateString("tr-TR", {timeZone:"Europe/Istanbul"}) });
  vm.runInContext(source.replace(/^import .*;\r?$/gm, "").replaceAll("export function", "function"), context);
  return context;
}
const trash = [{id:"p1",type:"stock-product",title:"İnoks Kesici",productCode:"KES-1",actorName:"Mehmet",removedAt:"2026-10-08T12:00:00Z",reason:"Hatalı kayıt"}, {id:"l1",type:"ledger",title:"Eski cari kayıt",status:"reversed",removedAt:"2026-10-07T12:00:00Z",canRestore:true}];
const documents = [{id:"d1",recordTitle:"Bakım irsaliyesi",documentNumber:"IRS-9",archivedAt:"2026-10-08T22:30:00Z",archivedBy:"admin",archiveReason:"Tekrar yüklenmiş"}, {id:"active",recordTitle:"Aktif belge"}];
test("geçmiş kaynakları birleştirir, aktif belgeleri dışlar ve en yeni kaydı öne alır", ()=>{
  const h=history(); const records=h.buildHistoryRecords([...trash,trash[0]], documents);
  assert.deepEqual(Array.from(records, item=>item.key), ["document:d1", "stock-product:p1", "ledger:l1"]);
  assert.equal(records[0].action,"Belge kaldırıldı"); assert.equal(records[2].action,"Kayıt ters çevrildi");
  assert.equal(trash[0].key,undefined); assert.equal(documents[0].key,undefined);
});
test("tarih Türkiye gün sınırını ve kapsayıcı aralığı kullanır", ()=>{
  const h=history(); const records=h.buildHistoryRecords(trash,documents);
  assert.equal(h.historyDay("2026-10-08T22:30:00Z"),"2026-10-09");
  assert.equal(h.historyDay("bozuk"),"");
  assert.deepEqual(Array.from(h.filterHistoryRecords(records,{start:"2026-10-09",end:"2026-10-09"}), item=>item.key),["document:d1"]);
  assert.equal(h.filterHistoryRecords(records,{start:"2026-10-10",end:"2026-10-08"}).length,0);
});
test("arama Türkçe harf, referans, kişi ve açıklamada çalışır; türle birleşir", ()=>{
  const h=history(); const records=h.buildHistoryRecords(trash,documents);
  for (const query of ["İNOKS", "kes-1", "MEHMET", "hatalı"]) assert.equal(h.filterHistoryRecords(records,{query}).length,1);
  assert.equal(h.filterHistoryRecords(records,{query:"IRS-9",type:"document"}).length,1);
  assert.equal(h.filterHistoryRecords(records,{query:"IRS-9",type:"stock-product"}).length,0);
  assert.equal(h.filterHistoryRecords(records,{query:"olmayan"}).length,0);
});
test("geri alma yetkisi kayıt türüne göre korunur; sevkiyatlarda sahte buton çıkmaz", ()=>{
  const h=history();
  for (const type of ["document", "stock-product", "stock-location", "ledger", "payment"]) assert.equal(h.canRestoreHistoryRecord({type,canRestore:true}),true,type);
  assert.equal(h.canRestoreHistoryRecord({type:"shipment",canRestore:true}),false);
  assert.equal(h.canRestoreHistoryRecord({type:"stock-location",canRestore:false}),false);
  assert.equal(history([]).canRestoreHistoryRecord({type:"document",canRestore:true}),false);
  assert.equal(history(Object.values(caps),[]).canRestoreHistoryRecord({type:"document",canRestore:true}),false);
  assert.equal(history(Object.values(caps),[]).canRestoreHistoryRecord({type:"stock-product",canRestore:true}),false);
});

function restoreHarness({ refreshFailure=false, mutationFailure=null, allowed=true, answer="TEST" }={}) {
  const app=fs.readFileSync(path.join(moduleRoot,"scripts/app.js"),"utf8");
  const handler=app.slice(app.indexOf("async function restoreHistoryRecord("),app.indexOf("function openPaymentForm()"));
  const calls=[];
  const context=vm.createContext({
    state:{revision:9,revisions:{catalog:3,inventory:7},activeView:"documents"},
    canRestoreHistoryRecord:()=>allowed, requestText:async()=>answer,
    api:async(path,options)=>{calls.push({path,options});if(mutationFailure)throw mutationFailure;return{ok:true,revision:10};},
    mutationComplete:()=>calls.push("mutation"), updateRevision:()=>calls.push("revision"), invalidateStockState:()=>calls.push("invalidate"),
    loadStockReferences:async()=>calls.push("stock-refresh"), loadDocuments:async()=>{if(refreshFailure)throw Error("offline");}, loadShipments:async()=>{}, renderActiveView:()=>calls.push("render"), toast:(message)=>calls.push(message),
  });
  vm.runInContext(handler,context);
  return{calls,restore:context.restoreHistoryRecord};
}
test("stok geri alma eski API gövde revision sözleşmesini ve tekil kimliği korur",async()=>{
  for (const type of ["stock-product","stock-location"]) {
    const h=restoreHarness(); assert.equal(await h.restore({id:"test/id",type},"undo-test"),true);
    const request=h.calls[0];
    assert.match(request.path,/test%2Fid\/restore$/); assert.equal(request.options.body.expectedInventoryRevision,7);
    assert.equal(request.options.expectedInventoryRevision,7); assert.equal(request.options.requestId,"undo-test");
    if(type==="stock-product")assert.equal(request.options.body.expectedCatalogRevision,3);
  }
});
test("belge geri alma liste hatasında başarılı işlemi yeniden denetmez; yetki ve iptal korunur",async()=>{
  const h=restoreHarness({refreshFailure:true}); assert.equal(await h.restore({id:"d1",type:"document"},"undo-doc"),true);
  assert.equal(h.calls[0].options.expectedRevision,9); assert.match(h.calls.at(-1),/Liste yenilenemedi/);
  const denied=restoreHarness({allowed:false}); await assert.rejects(()=>denied.restore({type:"document"},"x"),/yetkiniz/); assert.equal(denied.calls.length,0);
  const cancelled=restoreHarness({answer:null}); assert.equal(await cancelled.restore({type:"ledger"},"x"),false); assert.equal(cancelled.calls.length,0);
});
test("revision çakışmasında stok referansları yenilenir; sessiz otomatik mutasyon yapılmaz",async()=>{
  const h=restoreHarness({mutationFailure:{status:409,message:"Conflict"}});
  await assert.rejects(()=>h.restore({id:"l1",type:"stock-location"},"same-key"));
  assert.equal(h.calls.filter(item=>item?.path).length,1); assert.ok(h.calls.includes("stock-refresh")); assert.ok(!h.calls.includes("mutation"));
});
test("satır ayrıntıları kaçar, notu korur, yalnız izinli geri alma görünür", ()=>{
  const h=history(); const row={key:'document:x"',type:"document",title:"<script>TEST</script>",actorName:"<admin>",reason:"<not>",action:"Belge kaldırıldı",removedAt:"2026-10-09T09:00:00Z"};
  const markup=h.renderHistoryRows([row]);
  assert.match(markup, /<details class="doc-history-entry"/); assert.match(markup,/&lt;script&gt;/); assert.match(markup,/&lt;not&gt;/); assert.doesNotMatch(markup,/<script>/);
  assert.match(markup,/data-history-restore="document:x&quot;"/);
  assert.doesNotMatch(history([]).renderHistoryRows([row]),/data-history-restore/);
});
test("kart bağımsız filtre, iptal, tekil işlem kimliği ve sınırlı çizim kullanır", ()=>{
  assert.match(source,/pageSize = 40/); assert.match(source,/visible\.slice\(0, pageSize\)/);
  assert.match(source,/signal: ui\.abort\.signal/); assert.match(source,/run !== sequence/);
  assert.match(source,/attempts\.get\(record\.key\)/); assert.match(source,/button\.disabled \|\| ui\.saving/);
  assert.doesNotMatch(source,/permanent|purge|documentFilters/);
  assert.match(source,/trigger\.focus/);
});
test("belgeler düğmesi ve sürümlü kaynaklar aynı geçmiş modülüne bağlanır", ()=>{
  const records=fs.readFileSync(path.join(moduleRoot,"scripts/document-records.js"),"utf8");
  const app=fs.readFileSync(path.join(moduleRoot,"scripts/app.js"),"utf8");
  const html=fs.readFileSync(path.join(root,"YÖNETİCİ PANELİ/HTML/index.html"),"utf8");
  assert.match(records,/data-action="document-history"/); assert.match(records,/createDocumentDialog = modal/);
  assert.match(app,/action === "document-history"/); assert.match(app,/document-history\.js\?v=20261009-history-v1/);
  assert.doesNotMatch(html,/<a[^>]*data-panel-section="audit"/);
  assert.match(app,/Kayıt geri alındı\. Liste yenilenemedi/);
});
