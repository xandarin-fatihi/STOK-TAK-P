"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { normalizeStore } = require("../src/store/file-store");
const { registerProcurementRoutes } = require("../src/procurement-routes");
const { createProcurementDocumentService } = require("../src/procurement-documents");
const { decodeDocumentRecordBundle } = require("../src/document-record-bundle");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
function bundle(metadata, files = []) {
  const json = Buffer.from(JSON.stringify({metadata,files:files.map((file) => ({name:file.name,type:file.type,size:file.bytes.length}))}));
  const size = Buffer.alloc(4); size.writeUInt32BE(json.length);
  return Buffer.concat([size,json,...files.map((file) => file.bytes)]);
}
const details = { recordTitle:"TEST Bakım irsaliyesi", documentDate:"2026-10-08", documentNumber:"TEST-001", shipmentIds:["receipt-1"] };
async function fixture(t) {
  let data = normalizeStore({ revisions:{procurement:0,workforce:0}, procurement:{}, stockState:{products:[{id:"p1",name:"Rulman",unit:"adet",stockQuantity:12,active:true}],movements:[]}, workforceShipments:[{id:"receipt-1",userId:"admin",branchId:"main",status:"onaylandı",stockAppliedAt:"2026-10-08T09:00:00Z",destinationLocationId:"workshop",items:[{productId:"p1",name:"Rulman",quantity:3,unit:"adet"}],revision:1},{id:"pending",userId:"admin",branchId:"main",status:"onay_bekliyor",items:[],revision:1}] });
  data = normalizeStore(data);
  const noChange = Symbol("no-change");
  const store = {read:async()=>structuredClone(data), update:async(worker)=>{const draft=structuredClone(data);const result=await worker(draft,{noChange});if(result!==noChange)data=normalizeStore(result===undefined?draft:result);return structuredClone(data);}};
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"sts-document-records-"));
  const documentService = createProcurementDocumentService({documentsDir:dir});
  const app = express(); app.use(express.json());
  const runtime = registerProcurementRoutes({app,store,documentService,auth:{requireRecipe(req,res,next){if(!req.get("X-Test-Actor"))return res.status(401).end();next();}}, resolveActor(req){return req.get("X-Test-Actor")==="admin"?{type:"admin",id:"admin",name:"TEST Yönetici",branchId:"main",capabilities:[]}:{type:"personel",id:"viewer",name:"TEST",branchId:"other",faturaAccessEnabled:true,capabilities:["documents.read"],sectionAccess:{documents:"view"}};}});
  app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message,code:error.code}));
  const server = app.listen(0,"127.0.0.1"); await new Promise((resolve)=>server.once("listening",resolve));
  t.after(async()=>{await new Promise((resolve)=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/procurement/v1`;
  let serial=0;
  async function send(route, bytes, options={}) {
    const snapshot = await store.read();
    return fetch(base+route,{method:options.method||"POST",headers:{"X-Test-Actor":options.actor||"admin","Content-Type":Buffer.isBuffer(bytes)?"application/octet-stream":"application/json","Idempotency-Key":options.id||`record-test-${++serial}`,"X-Expected-Revision":String(options.revision??snapshot.procurement.revision)},body:Buffer.isBuffer(bytes)?bytes:JSON.stringify(bytes)});
  }
  const get=(route,actor="admin")=>fetch(base+route,{headers:{"X-Test-Actor":actor}});
  return {store,documentService,runtime,dir,send,get};
}

test("belge paketi bozuk sınırları, boş dosyayı ve fazla dosyayı reddeder",()=>{
  assert.throws(()=>decodeDocumentRecordBundle(Buffer.from("abc")),/okunamadı/);
  assert.throws(()=>decodeDocumentRecordBundle(bundle(details,[])),/En az bir/);
  assert.equal(decodeDocumentRecordBundle(bundle(details,[]),{editing:true}).files.length,0);
  assert.throws(()=>decodeDocumentRecordBundle(Buffer.concat([bundle(details,[{name:"a.png",type:"image/png",bytes:PNG}]),Buffer.from("extra")])),/fazladan/);
  assert.throws(()=>decodeDocumentRecordBundle(bundle(details,Array.from({length:11},()=>({name:"a.png",type:"image/png",bytes:PNG})))),/en fazla 10/);
});

test("çok dosyalı irsaliye stok/cari miktarını değiştirmeden atomik kaydedilir, tekrar oynatma tekildir",async(t)=>{
  const f=await fixture(t); const before=await f.store.read();
  const bytes=bundle(details,[{name:"sayfa-1.png",type:"image/png",bytes:PNG},{name:"sayfa-2.pdf",type:"application/pdf",bytes:PDF}]);
  const response=await f.send("/document-records",bytes,{id:"multi-create",revision:0}); assert.equal(response.status,201);
  const result=await response.json(); assert.equal(result.document.pages.length,2); assert.equal(result.document.recordTitle,details.recordTitle);
  assert.doesNotMatch(JSON.stringify(result.document),/physicalName|sha256|thumbnailPhysicalName/);
  const after=await f.store.read(); assert.deepEqual(after.stockState,before.stockState); assert.deepEqual(after.procurement.ledgerEntries,before.procurement.ledgerEntries);
  assert.deepEqual(after.workforceShipments[0].evidenceDocumentIds,[result.document.id]);
  const replay=await f.send("/document-records",bytes,{id:"multi-create",revision:0}); assert.equal(replay.status,200); assert.equal((await replay.json()).idempotent,true);
  assert.equal((await f.store.read()).procurement.documents.length,1);
  const content=await f.get(`/documents/${result.document.id}/content?page=1`); assert.equal(content.status,200); assert.equal(content.headers.get("content-type"),"application/pdf"); assert.deepEqual(Buffer.from(await content.arrayBuffer()),PDF);
  assert.equal((await f.get(`/documents/${result.document.id}/content?page=-1`)).status,400);
  assert.equal((await f.get(`/documents/${result.document.id}/content?page=7`)).status,404);
  assert.notEqual((await f.get(`/documents/${result.document.id}/content`,"viewer")).status,200);
});

test("hatalı ikinci sayfa ve onaysız stok girişi kayıt/özel dosya bırakmaz",async(t)=>{
  const f=await fixture(t); const before=await f.store.read();
  let response=await f.send("/document-records",bundle(details,[{name:"a.png",type:"image/png",bytes:PNG},{name:"bozuk.pdf",type:"application/pdf",bytes:Buffer.from("not a pdf")} ])); assert.notEqual(response.status,201);
  assert.deepEqual(await f.store.read(),before);
  assert.equal((await fs.readdir(f.dir)).filter((name)=>!name.startsWith(".")).length,0);
  response=await f.send("/document-records",bundle({...details,shipmentIds:["pending"]},[{name:"a.png",type:"image/png",bytes:PNG}])); assert.equal(response.status,409);
  assert.equal((await response.json()).code,"DOCUMENT_RECEIPT_NOT_APPLIED"); assert.deepEqual(await f.store.read(),before);
});

test("aynı dosya uyarılır; ayrı kayıt açık onayla mümkün; sürüm dosyaları ve geri alma korunur",async(t)=>{
  const f=await fixture(t);
  const file={name:"a.png",type:"image/png",bytes:PNG};
  const created=await (await f.send("/document-records",bundle(details,[file]))).json(); const id=created.document.id;
  let response=await f.send("/document-records",bundle(details,[file])); assert.equal(response.status,409);assert.equal((await response.json()).code,"DOCUMENT_DUPLICATE");
  const original=await f.store.read();
  response=await f.send(`/documents/${id}/record`,bundle({...details,recordTitle:"TEST Güncel irsaliye"},[{name:"yeni.pdf",type:"application/pdf",bytes:PDF}]));assert.equal(response.status,200);
  const edited=await response.json();assert.equal(edited.document.versions.length,1);assert.equal(edited.document.versions[0].changedByName,"TEST Yönetici");
  assert.equal((await f.get(`/documents/${id}/content?version=0&page=0`)).status,200);
  const snapshot=await f.store.read();await f.documentService.cleanupOrphans({documents:snapshot.procurement.documents,graceMs:0});
  assert.equal((await f.get(`/documents/${id}/content?version=0&page=0`)).status,200);
  assert.equal((await f.get(`/documents/${id}/content?version=99`)).status,404);
  assert.deepEqual(snapshot.stockState,original.stockState);
  response=await f.send(`/documents/${id}/archive`,{reason:"TEST"});assert.equal(response.status,200);
  assert.equal((await f.get(`/documents/${id}/content`)).status,410);
  assert.equal((await (await f.get("/documents")).json()).documents.length,0);
  response=await f.send(`/documents/${id}/restore`,{});assert.equal(response.status,200);
  assert.equal((await f.get(`/documents/${id}/content`)).status,200);
  assert.equal((await (await f.get("/documents")).json()).documents.length,1);
  const duplicated=await f.send("/document-records",bundle({...details,allowDuplicate:true},[file]));assert.equal(duplicated.status,201);
  assert.equal((await f.store.read()).procurement.documents.length,2);
});

test("eski tek dosyalı yükleme belgeleri yeni okuyucu ile geriye uyumlu kalır",async(t)=>{
  const f=await fixture(t);
  const stored=await f.documentService.storeUpload({buffer:PNG,originalName:"eski.png",declaredMimeType:"image/png"});
  const result=await f.runtime.service.recordDocument({type:"admin",id:"admin",branchId:"main",capabilities:[]},{documentType:"irsaliye",documentDate:"2026-10-07"},stored,{requestId:"legacy-document",expectedRevision:0});
  await f.documentService.commitUpload(stored);
  assert.equal(result.document.pages.length,1);assert.equal(result.document.versions.length,0);
  assert.equal((await f.get(`/documents/${result.document.id}/content?page=0`)).status,200);
});

test("taranan seçilmiş satırlar sunucuda kalıcıdır; düzenleme, tekrar çıktı ve eski fotoğraf stoktan bağımsızdır",async(t)=>{
  const f=await fixture(t);const before=await f.store.read();
  const scanItems=[{name:"Rulman",code:"0006204",quantity:5}];
  const metadata={...details,shipmentIds:[],scanItems};
  const response=await f.send("/document-records",bundle(metadata,[{name:"scan.png",type:"image/png",bytes:PNG}]));assert.equal(response.status,201);
  const created=await response.json();const id=created.document.id;
  assert.deepEqual(created.document.scanItems,scanItems);
  assert.deepEqual((await (await f.get(`/documents/${id}`)).json()).document.scanItems,scanItems);
  const updated=[{...scanItems[0],quantity:3}];
  assert.equal((await f.send(`/documents/${id}/record`,bundle({...metadata,scanItems:updated},[]))).status,200);
  assert.deepEqual((await (await f.get(`/documents/${id}`)).json()).document.scanItems,updated);
  assert.deepEqual(Buffer.from(await (await f.get(`/documents/${id}/content`)).arrayBuffer()),PNG);
  assert.equal((await f.get(`/documents/${id}/content?version=0`)).status,200);
  const exported=await f.send("/document-scan/export",{...metadata,items:updated});assert.equal(exported.status,200);
  assert.match(exported.headers.get("content-type"),/spreadsheetml/);
  const after=await f.store.read();assert.deepEqual(after.stockState,before.stockState);assert.deepEqual(after.procurement.ledgerEntries,before.procurement.ledgerEntries);
  assert.deepEqual(after.workforceShipments,before.workforceShipments);
});

test("tarama ve kaydetme yetkisizdir; geçersiz seçilmiş satır kayıt ve özel dosya bırakmaz",async(t)=>{
  const f=await fixture(t);const before=await f.store.read();
  assert.equal((await f.send("/document-scan/read",PNG,{actor:"viewer"})).status,403);
  assert.equal((await f.send("/document-records",bundle({...details,scanItems:[{name:"A",code:"X",quantity:-1}]},[{name:"bad.png",type:"image/png",bytes:PNG}]))).status,400);
  assert.deepEqual(await f.store.read(),before);
  assert.equal((await fs.readdir(f.dir)).filter(name=>!name.startsWith(".")).length,0);
  assert.equal((await f.get("/document-scan/read")).status,404);
});

test("geçmiş kaldırılan belgeyi listeler, yetkisiz geri almayı reddeder; geri alma tekil ve stoktan bağımsızdır",async(t)=>{
  const f=await fixture(t); const before=await f.store.read();
  const created=await (await f.send("/document-records",bundle(details,[{name:"history.png",type:"image/png",bytes:PNG}]))).json();
  const id=created.document.id;
  assert.equal((await f.send(`/documents/${id}/archive`,{reason:"TEST Geçmiş kaydı"})).status,200);
  const archived=await (await f.get("/documents?archived=true")).json();
  assert.equal(archived.documents.length,1); assert.equal(archived.documents[0].archiveReason,"TEST Geçmiş kaydı");
  assert.doesNotMatch(JSON.stringify(archived.documents),/physicalName|sha256/);
  assert.equal((await f.send(`/documents/${id}/restore`,{}, {actor:"viewer"})).status,403);
  const revision=(await f.store.read()).procurement.revision;
  assert.equal((await f.send(`/documents/${id}/restore`,{}, {revision,id:"history-undo"})).status,200);
  const replay=await f.send(`/documents/${id}/restore`,{}, {revision,id:"history-undo"});
  assert.equal(replay.status,200); assert.equal((await replay.json()).idempotent,true);
  assert.equal((await (await f.get("/documents?archived=true")).json()).documents.length,0);
  assert.equal((await (await f.get("/documents")).json()).documents.length,1);
  assert.equal((await f.get(`/documents/${id}/content`)).status,200);
  const after=await f.store.read();
  assert.deepEqual(after.stockState,before.stockState); assert.deepEqual(after.procurement.ledgerEntries,before.procurement.ledgerEntries);
});
