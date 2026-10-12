"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), vm=require("node:vm"), fs=require("node:fs"), path=require("node:path");
const root=path.resolve(__dirname,"../../..");
const source=fs.readFileSync(path.join(root,"YÖNETİCİ PANELİ/JS/material-request-batch.js"),"utf8");
function runtime() {
  const calls=[], events=[], nodes=new Map(), window={crypto:{randomUUID:()=>"batch-ui-id"}};
  nodes.set("#materialBatchRequester",{value:"Test Talep Eden"});
  nodes.set("#materialBatchMessage",{textContent:"",hidden:true});
  const document={readyState:"loading",addEventListener(){},querySelector:s=>nodes.get(s)||null,dispatchEvent:e=>events.push(e),body:{append(){}},createElement:()=>({click(){},remove(){}})};
  const replies=[];
  const context=vm.createContext({window,document,localStorage:{getItem:()=>null},setTimeout(){},URL:{createObjectURL:()=>"blob:test",revokeObjectURL(){}},CustomEvent:class {constructor(name,options){this.type=name;this.detail=options.detail;}},fetch:async(url,options)=>{calls.push({url,options});const reply=replies.shift();if(reply instanceof Error)throw reply;return reply;}});
  const hook="window.testBatch={model,rowsFrom,selections,validate,submit,download};";
  vm.runInContext(source.replace(/\r?\n\}\)\(\);\s*$/,`\n${hook}\n})();`),context);
  return {api:window.testBatch,nodes,calls,replies,events};
}
const fixture={materialRequestCatalog:{products:[{id:"p1",productCode:"00006204",imageUrl:"/media/rulman.png"}]},materialRequests:[{id:"r1",personName:"Personel A",requestNumber:"MT-1",depotName:"Bakım Atölyesi",status:"onay_bekliyor",items:[{id:"i1",name:"Rulman",linkedProductId:"p1",quantity:10},{id:"i2",name:"Kayış",quantity:2,decisionStatus:"onaylandı",approvedQuantity:1}]}]};
test("toplu kart yalnız bekleyen kalemleri alır; ürün kodu, görsel ve depo sunucu verisinden gelir",()=>{
  const r=runtime(),rows=r.api.rowsFrom(fixture);
  assert.equal(rows.length,1);assert.equal(rows[0].requestedQuantity,10);
  assert.equal(rows[0].code,"00006204");assert.equal(rows[0].imageUrl,"/media/rulman.png");assert.equal(rows[0].department,"Bakım Atölyesi");
  Object.assign(r.api.model,{rows,selected:new Set([rows[0].key]),query:"eşleşmeyen arama"});
  rows[0].quantity="5";r.api.validate();
  assert.equal(r.api.selections()[0].quantity,5,"Arama seçilmiş gizli kalemi sessizce kaldırmamalı");
  for(const value of ["", "0", "-1", "1.5", "1000000001"]) {rows[0].quantity=value;assert.throws(()=>r.api.validate(),/pozitif tam sayı/);}
  r.api.model.selected.clear();assert.throws(()=>r.api.validate(),/En az bir/);
});
test("onaydan sonra indirme hatası kararı tekrarlamaz; yeniden indirme yalnız GET kullanır",async()=>{
  const r=runtime(),rows=r.api.rowsFrom(fixture);
  Object.assign(r.api.model,{rows,selected:new Set([rows[0].key]),revision:4,stage:"name"});rows[0].quantity="5";
  r.replies.push({ok:true,json:async()=>({approvedCount:1,exportUrl:"/api/admin/workforce/material-request-batches/test/excel",batchId:"test"})},new Error("İndirme bağlantısı kesildi"));
  await r.api.submit({preventDefault(){}});
  assert.equal(r.api.model.busy,false);assert.ok(r.api.model.result);
  assert.match(r.nodes.get("#materialBatchMessage").textContent,/Onay kaydedildi/);
  assert.equal(r.calls.filter(c=>c.options.method==="POST").length,1);
  await r.api.submit({preventDefault(){}});
  assert.equal(r.calls.length,2);
  r.replies.push({ok:true,blob:async()=>Buffer.from("xlsx"),headers:{get:()=> 'attachment; filename="Malzeme-Talep.xlsx"'}});
  await r.api.download();assert.equal(r.calls.length,3);assert.equal(r.calls[2].options.method,undefined);
  const payload=JSON.parse(r.calls[0].options.body);
  assert.equal(payload.requesterName,"Test Talep Eden");assert.equal(payload.selections[0].quantity,5);assert.equal(payload.expectedRevision,4);
  assert.equal(r.events[0].type,"sts:material-batch-approved");
});
test("başarısız onay tekrarında aynı işlem kimliği korunur; hata görünür ve form yeniden kullanılabilir",async()=>{
  const r=runtime(),rows=r.api.rowsFrom(fixture);
  Object.assign(r.api.model,{rows,selected:new Set([rows[0].key]),revision:4,stage:"name"});
  r.replies.push(new Error("Bağlantı kesildi"));await r.api.submit({preventDefault(){}});
  assert.equal(r.api.model.busy,false);assert.equal(r.api.model.result,null);assert.match(r.nodes.get("#materialBatchMessage").textContent,/Bağlantı kesildi/);
  r.replies.push(new Error("Bağlantı kesildi"));await r.api.submit({preventDefault(){}});
  assert.equal(r.calls[0].options.headers["Idempotency-Key"],r.calls[1].options.headers["Idempotency-Key"]);
});
