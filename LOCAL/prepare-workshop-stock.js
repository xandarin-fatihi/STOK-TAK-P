"use strict";
// One-off, backed-up data preparation. Preview is the default; --apply requires
// the live server to be stopped and acquires the application's single-writer lock.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'ORTAK', 'VERİ', 'STORE', 'store.json');
const { createFileStore } = require('../ORTAK/API/src/store/file-store');
const { normalizeStockState, migrateStore } = require('../ORTAK/API/src/store/migrations');
const service = require('../ORTAK/API/src/stock-service');
const { isValidProductCode } = require('../ORTAK/API/src/store/product-code-registry');
const locationId = service.WORKSHOP_LOCATION_ID;
const groups = [
  ['Rulmanlar', 'RLM', [
    ['Rulman 6204-2RS', 24, '/media/products/rulman-6204-2rs.png'],
    ['Rulman 6205-2RS', 20], ['Rulman 6206-2RS', 16], ['Rulman 6305-2RS', 12],
    ['Yataklı Rulman UCP205', 8], ['İğneli Rulman HK2020', 10]]],
  ['Kayışlar', 'KYS', [
    ['V Kayışı A42', 15, '/media/products/v-kayisi-a42.png'], ['V Kayışı A48', 12],
    ['V Kayışı B52', 10], ['V Kayışı B60', 8], ['Dişli Kayış HTD 5M-450', 6], ['Poly-V Kayış 6PK1200', 6]]],
  ['Bağlantı Elemanları', 'BGL', [
    ['M8 Civata Seti', 30, '/media/products/m8-civata-seti.png'], ['M6 Altıgen Cıvata 6×25 mm', 200],
    ['M8 Altıgen Cıvata 8×30 mm', 150], ['M10 Altıgen Cıvata 10×40 mm', 100],
    ['M12 Altıgen Cıvata 12×50 mm', 80], ['M6 Altıgen Somun', 250], ['M8 Altıgen Somun', 200],
    ['M10 Altıgen Somun', 150], ['M12 Altıgen Somun', 100], ['M8 Düz Pul', 300],
    ['M10 Yaylı Pul', 200], ['M8 İmbus Cıvata 8×25 mm', 100]]],
  ['Elektrik Malzemeleri', 'ELK', [
    ['Endüstriyel Röle 24V', 12, '/media/products/endustriyel-role-24v.png'], ['Kontaktör 18A 230V', 6],
    ['Termik Röle 9–13A', 4], ['Otomatik Sigorta C16 Tek Kutuplu', 15], ['Kaçak Akım Rölesi 40A 30mA', 4],
    ['Acil Stop Butonu', 6], ['M12 Endüktif Sensör', 8], ['Klemens 2,5 mm²', 100],
    ['Kablo Bağı 200 mm', 500], ['Elektrik İzolasyon Bandı', 30],
    ['Elektrik Kablosu 3×2,5 mm² — 25 m Rulo', 4], ['Kablo Pabucu 2,5 mm²', 200]]],
  ['Kaynak Malzemeleri', 'KYN', [
    ['Kaynak Meme Ucu M6 0,8 mm', 40], ['Kaynak Meme Ucu M6 1,0 mm', 30],
    ['MIG Gaz Nozulu', 12], ['Kaynak Camı DIN 11', 20], ['Kaynak Maskesi Koruyucu Dış Cam', 30],
    ['Kaynak Elektrodu E6013 2,5 mm — 100lü Kutu', 10],
    ['MIG Kaynak Teli 0,8 mm — 5 kg Makara', 6], ['Şase Pensesi 300A', 4]]],
  ['Kesme ve Aşındırma', 'KSM', [
    ['İnoks Kesici Disk 115×1 mm', 100], ['Metal Taşlama Diski 115 mm', 40],
    ['Flap Disk 115 mm — 40 Kum', 30], ['Flap Disk 115 mm — 80 Kum', 30],
    ['Metal Şerit Testere Bıçağı 2360 mm', 5], ['HSS Matkap Ucu 8 mm', 20], ['HSS Matkap Ucu 10 mm', 15]]],
  ['Metal Profiller', 'PRF', [
    ['Kutu Profil 40×40×2 mm — 6 m Boy', 12], ['Kutu Profil 30×30×2 mm — 6 m Boy', 12],
    ['Köşebent 40×40×4 mm — 6 m Boy', 8], ['Lama 30×5 mm — 6 m Boy', 10], ['Sac Levha 1000×2000×2 mm', 6]]],
  ['Tesisat Malzemeleri', 'TST', [
    ['Küresel Vana 1/2 İnç', 12], ['Küresel Vana 3/4 İnç', 10], ['Galvaniz Dirsek 1/2 İnç', 30],
    ['Galvaniz Tee 1/2 İnç', 20], ['PPRC Dirsek 20 mm', 40], ['PPRC Manşon 20 mm', 40],
    ['PPRC Boru 20 mm — 4 m Boy', 15], ['Teflon Bant', 40], ['Hortum Kelepçesi 20–32 mm', 50]]],
  ['Yağlar ve Kimyasallar', 'YAG', [
    ['Çok Amaçlı Gres Kartuşu', 18, '/media/products/cok-amacli-gres.png'],
    ['Hidrolik Yağ ISO VG 46 — 5 L Bidon', 8], ['Dişli Yağı ISO VG 220 — 5 L Bidon', 6],
    ['Pas Sökücü Sprey 400 ml', 12], ['Endüstriyel Boya — 2,5 L Teneke', 6], ['Tiner — 1 L Şişe', 10]]],
  ['El Aletleri', 'ALT', [
    ['Kombine Anahtar 13 mm', 6], ['Kombine Anahtar 17 mm', 6], ['Ayarlı Anahtar 250 mm', 4],
    ['Kombine Pense 180 mm', 6], ['Yıldız Tornavida PH2', 8], ['İmbus Anahtar Takımı', 4],
    ['Çekiç 500 g', 4], ['Şerit Metre 5 m', 6]]],
  ['Koruyucu Ekipmanlar', 'KKD', [
    ['Kaynak Maskesi', 4], ['Koruyucu Gözlük', 15], ['Kaynak Eldiveni — Çift Ambalaj', 12],
    ['Nitril İş Eldiveni — Çift Ambalaj', 30], ['Kulak Koruyucu', 10], ['FFP2 Toz Maskesi', 50]]]
];
const disposable = value => /(^|[^a-z0-9])(demo|test)(?=$|[^a-z0-9])/i.test(JSON.stringify(value));
const related = (value, ids) => {
  if (typeof value === 'string') return [...ids].some(id => value.includes(id));
  if (Array.isArray(value)) return value.some(item => related(item, ids));
  if (value && typeof value === 'object') return Object.values(value).some(item => related(item, ids));
  return false;
};
function cleanupPlanNotifications(data) {
  const weeks = new Set((data.workforceShiftPlans || []).map(plan=>plan.weekStart));
  const removed = new Set((data.notifications || []).filter(n=>n.entityType==='shift_plan' && !weeks.has(n.entityId)).map(n=>n.id));
  data.notifications = data.notifications.filter(n=>!removed.has(n.id));
  data.notificationDedupe = data.notificationDedupe.filter(n=>!related(n,removed));
  return removed.size;
}
function validate(data, expected, before) {
  const stock = data.stockState;
  assert.equal(stock.locations.length, 1);
  assert.equal(stock.locations[0].id, locationId);
  assert.equal(stock.locations[0].name, 'Bakım Atölyesi');
  assert.equal(stock.products.length, expected.length);
  assert.equal(stock.categories.length, groups.length);
  assert.equal(stock.balances.length, expected.length);
  assert.equal(stock.movements.length, expected.length);
  assert.equal(new Set(stock.products.map(p => p.id)).size, expected.length);
  assert.equal(new Set(stock.products.map(p => p.productCode)).size, expected.length);
  const expectedByName = new Map(expected.map(item => [item.name, item.quantity]));
  for (const product of stock.products) {
    assert.equal(product.unit, 'adet'); assert.equal(product.baseUnit, 'adet');
    assert.equal(product.allowDecimal, false); assert.equal(product.bulkUnit, '');
    assert.ok(isValidProductCode(product.productCode, {stock:true}));
    assert.ok(!disposable({name:product.name,code:product.productCode}));
    const balance = stock.balances.find(b => b.productId === product.id);
    assert.equal(balance.locationId, locationId);
    assert.equal(balance.quantity, expectedByName.get(product.name));
    assert.equal(product.stockQuantity, balance.quantity);
    assert.equal(balance.quantity, stock.movements.filter(m => m.productId === product.id).reduce((s,m)=>s+m.baseQuantityDelta,0));
    for (const field of ['cabinet','shelf','bin','compartment','placementName','placementPhotoUrl']) assert.equal(balance[field] || '', '');
    assert.equal(balance.placementX, null); assert.equal(balance.placementY, null);
  }
  for (const key of ['admin','panelConfig','adminDefaults','notificationPreferences','authSessions']) assert.deepEqual(data[key], before[key]);
  assert.equal(data.recipeUsers.length, before.recipeUsers.length);
  for (const user of data.recipeUsers) {
    const original = before.recipeUsers.find(u => u.id === user.id);
    assert.equal(user.passwordHash, original.passwordHash);
    assert.equal(user.username, original.username);
    assert.deepEqual(user.personelSectionAccess, original.personelSectionAccess);
    assert.equal(user.stockLocationId, locationId);
  }
  for (const key of ['workforceMaterialRequests','workforceShiftRequests','workforceTasks','workforceShipments']) assert.ok(!data[key].some(disposable));
  assert.equal(data.productCodeRegistry.conflicts.filter(c => c.scope === 'stock').length, 0);
}
function prepare(before) {
  const data = structuredClone(before);
  const now = new Date().toISOString();
  const oldStock = normalizeStockState(data.stockState);
  const oldProductByName = new Map(oldStock.products.filter(p=>!disposable({name:p.name,productCode:p.productCode})).map(p=>[p.name,p]));
  const removedIds = new Set(oldStock.locations.filter(l=>l.id!==locationId).map(l=>l.id));
  oldStock.products.filter(p=>disposable({name:p.name,productCode:p.productCode})).forEach(p=>removedIds.add(p.id));
  for (const key of ['movements','transfers','counts']) oldStock[key].forEach(r=>removedIds.add(r.id));
  // All previous shipments were part of the sample stock start; do not leave pending
  // sample arrivals capable of adding the discarded stock again.
  data.workforceShipments.forEach(r=>removedIds.add(r.id));
  data.workforceShipments = [];
  const removable = ['workforceTasks','workforceAssignments','workforceMaterialRequests','workforceMaterialExports',
    'workforceShiftRequests','workforceShiftPlans','workforceShiftPlanRevisions','workforceMigrationArchive',
    'notifications','scheduledNotifications','notificationOutbox','notificationDedupe','recipeActivity',
    'recipeAssignments','idempotencyRequests'];
  const procurementArrays = ['suppliers','supplierProductLinks','supplierIndependentProducts','documents','ledgerEntries','payments','auditEvents','idempotencyRecords'];
  let changed;
  do {
    changed = false;
    for (const owner of [data,data.procurement]) {
      for (const key of owner === data ? removable : procurementArrays) {
        const current = owner[key] || [];
        owner[key] = current.filter(record => {
          const remove = disposable(record) || related(record,removedIds)
            || (key==='recipeActivity' && /^(stock\.|stock-)/.test(String(record.type||record.action||'')));
          if(remove){changed=true;if(record.id)removedIds.add(record.id);}return !remove;
        });
      }
    }
  } while(changed);
  cleanupPlanNotifications(data);
  data.procurement.revision = Number(data.procurement.revision||0)+1;
  data.productCodeRegistry.entries = data.productCodeRegistry.entries.filter(e=>e.scope!=='stock');
  data.productCodeRegistry.conflicts = data.productCodeRegistry.conflicts.filter(e=>e.scope!=='stock');
  for (const user of data.recipeUsers) user.stockLocationId = locationId;
  const oldLocation = oldStock.locations.find(l=>l.id===locationId);
  let stock = normalizeStockState({
    ...oldStock,categories:[],products:[],balances:[],movements:[],transfers:[],counts:[],operationKeys:[],migrationAudit:[],
    purgedLocationIds:[...new Set([...(oldStock.purgedLocationIds||[]),...oldStock.locations.filter(l=>l.id!==locationId).map(l=>l.id),service.GENERAL_LOCATION_ID])].filter(id=>id!==locationId),
    unitDefinitions:{base:['adet'],bulk:[],updatedAt:now,updatedBy:'admin'},
    locations:[{...oldLocation,id:locationId,code:'ATOLYE',name:'Bakım Atölyesi',type:'workshop',active:true,
      isDefault:true,personnelVisible:true,assignedPersonnelIds:data.recipeUsers.filter(u=>u.active!==false).map(u=>u.id),
      photoUrl:'',description:'',updatedAt:now}],updatedAt:now
  });
  const expected=[];
  for (const [group,prefix,items] of groups) {
    const category={id:`stock-category-${crypto.randomUUID()}`,name:group,active:true,order:stock.categories.length,
      sourceType:'manual',statusSource:'manual',sourcePresent:true,createdAt:now,updatedAt:now};
    stock.categories.push(category);
    for (const [index,[name,quantity,imageUrl='']] of items.entries()) {
      const result = service.createCanonicalStockProduct(stock,{name,categoryId:category.id,baseUnit:'adet',
        productCode:`STK-${prefix}-${String(index+1).padStart(3,'0')}`,sourceType:'manual',allowDecimal:false,
        imageUrl,note:'Örnek başlangıç stoğu; miktar gerçek sayımla güncellenebilir.'},{actorId:'admin',now});
      stock=result.stockState;
      const product=result.product;
      const old=oldProductByName.get(name);
      if(old) product.id=old.id; // Preserve the five existing genuine catalog identities and images.
      const movement=service.applyStockMovement(stock,{type:'opening_balance',productId:product.id,locationId,
        quantity,unit:'adet',requestId:`workshop-start-${product.id}`,referenceType:'opening_balance',
        note:'Bakım Atölyesi örnek başlangıç stoğu',reason:'Kullanıcı isteğiyle temiz başlangıç'},
        {type:'admin',id:'admin',name:'Yönetici'},{now});
      stock=movement.stockState;
      expected.push({name,category:group,code:product.productCode,quantity});
    }
  }
  data.stockState=stock; data.stockUpdatedAt=now;
  for(const key of ['inventory','stock','stockCatalog','catalog']) data.revisions[key]=Number(data.revisions[key]||0)+1;
  const migrated=migrateStore(data);
  validate(migrated,expected,before);
  // Restart migrations must not resurrect the removed system depot or old products.
  validate(migrateStore(migrated),expected,before);
  const removals={};
  for(const key of removable.concat('workforceShipments')) {
    const count=(before[key]||[]).length-(migrated[key]||[]).length;
    if(count)removals[key]=count;
  }
  for(const key of procurementArrays){const count=(before.procurement[key]||[]).length-(migrated.procurement[key]||[]).length;if(count)removals[`procurement.${key}`]=count;}
  return {data:migrated,expected,summary:{location:'Bakım Atölyesi',categories:groups.length,products:expected.length,
    totalQuantity:expected.reduce((s,p)=>s+p.quantity,0),removedLocations:oldStock.locations.length-1,
    removedSampleProducts:oldStock.products.filter(p=>disposable({name:p.name,productCode:p.productCode})).length,
    removals,placementAssigned:false,accountsPreserved:true}};
}
async function main() {
  const raw=JSON.parse(await fs.readFile(file,'utf8'));
  if(process.argv.includes('--cleanup-plan-notifications')) {
    const store=createFileStore(file,{enableEventLoopMetrics:false});
    try {
      await store.ensure();let removed=0;
      await store.update(data=>{removed=cleanupPlanNotifications(data);return removed?data:store.NO_CHANGE;},
        {backupLabel:'baslangic-vardiya-bildirim-temizligi'});
      console.log(JSON.stringify({removedOrphanPlanNotifications:removed}));
    } finally {await store.close();}
    return;
  }
  if(!process.argv.includes('--apply')) {const p=prepare(raw);console.log(JSON.stringify(p.summary,null,2));return;}
  if(raw.stockState.movements.some(m=>m.reason==='Kullanıcı isteğiyle temiz başlangıç')) throw new Error('Hazırlama daha önce uygulanmış; tekrar çalıştırılmadı.');
  const store=createFileStore(file,{enableEventLoopMetrics:false});
  try {
    await store.ensure();
    const before=await store.read();
    const prepared=prepare(before);
    const backupDirectory=path.join(root,'LOCAL','backups','bakim-atolyesi-baslangic-20261011');
    await fs.mkdir(backupDirectory,{recursive:true});
    const backupFile=path.join(backupDirectory,`store-before-${Date.now()}.json`);
    await fs.copyFile(file,backupFile,1);
    const saved=await store.update(()=>prepared.data,{expectedRevision:before.storeRevision,backupLabel:'bakim-atolyesi-temiz-baslangic'});
    validate(saved,prepared.expected,before);
    const disk=JSON.parse(await fs.readFile(file,'utf8'));
    validate(disk,prepared.expected,before);
    const report={...prepared.summary,backupFile,storeRevision:saved.storeRevision,materials:prepared.expected,verifiedAt:new Date().toISOString()};
    await fs.writeFile(path.join(backupDirectory,'result.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({...prepared.summary,backupFile,storeRevision:saved.storeRevision,checks:'PASS'},null,2));
  } finally {await store.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
