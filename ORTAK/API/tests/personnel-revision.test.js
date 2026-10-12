"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs/promises"), path=require("node:path"), os=require("node:os"), express=require("express"), http=require("node:http"), bcrypt=require("bcryptjs");
const {createFileStore}=require("../src/store/file-store");
const {normalizeStockState}=require("../src/store/migrations");
const {registerPersonelRoutes}=require("../src/personel-routes");
const tasks=require("../../JS/task-state");
const vm=require("node:vm");
const root=path.resolve(__dirname,"../../..");
const read=file=>fs.readFile(path.join(root,file),"utf8");

test("Personel ekranı tek liste ve modal sunar; özet ve kayıt defteri etkin değildir",async()=>{
 const html=await read("YÖNETİCİ PANELİ/HTML/index.html");
 const staff=html.slice(html.indexOf('id="staffAccessCard"'),html.indexOf('</main>',html.indexOf('id="staffAccessCard"')));
 assert.match(staff,/staffPersonnelModal/); assert.doesNotMatch(staff,/id="staffOverviewGrid"/);
 assert.match(html,/<template id="inactiveStaffRecordsModule">/);
 assert.match(html,/panel-nav-label">Personel</);
 const script=await read("YÖNETİCİ PANELİ/JS/app.js");
 for(const label of ["Ad Soyad","Görev Tanımı","Kullanıcı Adı","Şifre"])assert.ok(script.includes(label));
 assert.match(script,/jobTitle:/);assert.match(script,/openStaffPersonnelDialog/);assert.match(script,/closeStaffPersonnelDialog/);
 assert.doesNotMatch(html,/data-personel-section-access=/);
});

test("toplu görev tüm aktif alıcılara bir kez atanır, seçim listesi görev tanımını parola olmadan alır",async t=>{
 const rt=await runtime(t);
 const create=await rt.request("/api/admin/recipe-users",{requestId:"bulk-personnel",name:"İkinci Test",jobTitle:"Mekanik bakım",username:"bulk_personnel",password:"test-pass-123"});
 assert.equal(create.status,201,JSON.stringify(create.data));
 const list=await rt.request("/api/admin/workforce");
 const publicUser=list.data.users.find(u=>u.id===create.data.user.id);
 assert.equal(publicUser.jobTitle,"Mekanik bakım");assert.equal(publicUser.passwordHash,undefined);
 const payload={requestId:"bulk-task",title:"Toplu test",items:[{id:"one",text:"Kontrol"}],targetType:"all",assignedUserIds:[]};
 const result=await rt.request("/api/admin/workforce/tasks",payload);
 assert.equal(result.status,201,JSON.stringify(result.data));
 assert.equal(result.data.task.assignments.length,2);
 const replay=await rt.request("/api/admin/workforce/tasks",payload);assert.equal(replay.data.idempotent,true);
 const data=await rt.store.read();assert.equal(data.notifications.filter(n=>n.eventType==="task_assigned").length,2);
 for(const user of list.data.users){const me=await rt.request("/api/workforce/me?scope=tasks",null,user.id);assert.equal(tasks.count(me.data.tasks,user.id),1);}
});


test("aktif görev sayacı tamamlanan, iptal ve başka personele ait görevleri saymaz",()=>{
 const t=(status,taskStatus="active",userId="p1")=>({status:taskStatus,assignments:[{status,userId}]});
 assert.equal(tasks.count([t("pending"),t("in_progress"),t("completed"),t("pending","cancelled"),t("pending","archived")],"p1"),2);
 assert.equal(tasks.count([t("completed")],"p1"),0);
 assert.equal(tasks.count([t("completed"),t("pending","active","p2")],"p1"),0);
});

test("Personel seçim kartı tekli/toplu seçimi geçici tutar, onaylar ve güvenli düz liste sunar",async()=>{
 const source=await read("YÖNETİCİ PANELİ/JS/workforce.js");
 const functions=source.slice(source.indexOf("  function activeTaskUsers()"),source.indexOf("  function bindTaskDialogs()"));
 const host={innerHTML:""}, all={}, count={textContent:""}, dialog={showModal(){this.open=true;},close(){this.open=false;}}, next={}, composer={open:false,showModal(){this.open=true;}}, title={focus(){this.focused=true;}};
 const nodes=[{dataset:{selectUser:"p1"}},{dataset:{selectUser:"p2"}}];
 const state={data:{users:[{id:"p1",name:"Birinci",jobTitle:"Bakım <teknisyeni>"},{id:"p2",name:"İkinci",jobTitle:"Elektrikçi"},{id:"p3",name:"Pasif",active:false}]},targetType:"selected",selectedUsers:new Set()};
 const $=selector=>selector==="#workforceTargetPicker"?host:selector==="[data-select-all]"?all:selector==="#workforcePickerCount"?count:selector==="[data-finish-task-picker]"?next:selector==="#workforceComposerDialog"?composer:selector==="#workforceTaskForm input[name='title']"?title:dialog;
 const ctx=vm.createContext({state,$,$$:()=>nodes,esc:x=>String(x).replaceAll("<","&lt;").replaceAll(">","&gt;"),updateTaskAssignmentSummary(){}});
 vm.runInContext(functions+"openTaskPicker();",ctx);
 assert.equal(next.disabled,true);assert.equal(composer.open,false);
 assert.match(host.innerHTML,/Tümünü Seç/);assert.doesNotMatch(host.innerHTML,/workforce-person-head|Ad Soyad|Görev Tanımı/);assert.match(host.innerHTML,/Bakım &lt;teknisyeni&gt;/);assert.doesNotMatch(host.innerHTML,/Pasif/);
 const fire=(selector,value)=>ctx.changeTaskRecipients({target:{closest:s=>s===selector?value:null}});
 fire("[data-select-all]",{checked:true});
 assert.equal(state.selectedUsers.size,0);assert.equal(count.textContent,"2 personel seçildi");assert.equal(all.checked,true);
 fire("[data-select-user]",{checked:false,dataset:{selectUser:"p2"}});
 assert.equal(all.indeterminate,true);assert.equal(all.checked,false);
 ctx.finishTaskRecipients();assert.equal(state.targetType,"selected");assert.deepEqual([...state.selectedUsers],["p1"]);
 assert.equal(composer.open,true);assert.equal(title.focused,true);assert.equal(dialog.open,false);
 ctx.openTaskPicker();fire("[data-select-all]",{checked:true});
 ctx.openTaskPicker();assert.deepEqual([...state.pickerUsers],["p1"]); // cancelled staging does not replace committed selection
 fire("[data-select-all]",{checked:true});ctx.finishTaskRecipients();
 assert.equal(state.targetType,"all");assert.deepEqual([...state.selectedUsers],["p1","p2"]);
 ctx.openTaskPicker();fire("[data-select-all]",{checked:false});ctx.finishTaskRecipients();assert.equal(next.disabled,true);assert.equal(dialog.open,true);assert.equal(state.targetType,"all");assert.equal(state.selectedUsers.size,2);
 state.data.users=[];ctx.openTaskPicker();assert.match(host.innerHTML,/Aktif personel bulunmuyor/);assert.match(host.innerHTML,/disabled/);
});

test("Görev listesi geniştir; Yeni Görev yoktur, Personel Seç üzerinden görev bilgilerine geçilir",async()=>{
 const source=await read("YÖNETİCİ PANELİ/JS/workforce.js"),css=await read("YÖNETİCİ PANELİ/CSS/personnel-revision.css");
 const render=source.slice(source.indexOf("  function renderTasks()"),source.indexOf("  function renderTaskDetail("));
 assert.ok(render.indexOf('class="workforce-active-tasks"')<render.indexOf('id="workforceTaskForm"'));
 assert.ok(render.indexOf('class="workforce-task-footer"')<render.indexOf('id="workforceComposerDialog"'));
 assert.match(render,/<dialog id="workforcePersonDialog".*aria-labelledby="workforcePersonTitle"/);
 assert.doesNotMatch(source,/data-new-task|Yeni Görev/);assert.match(render,/workforceComposerTitle">Görev Bilgileri/);assert.match(render,/data-finish-task-picker>Devam Et/);
 for(const field of ["title","description","dueDate","dueTime","managerNote","priority"])assert.ok(render.includes('name="'+field+'"'));
 assert.match(source,/composer\?\.addEventListener\("cancel"/);
 assert.match(source,/picker\?\.addEventListener\("close"/);
 assert.match(css,/workforce-task-layout\{display:block\}/);assert.match(css,/::backdrop.*backdrop-filter:blur/);
});

test("personel görev ekranı sade, bildirim bağlantısı ve olay tabanlı kırmızı sekme korunur",async()=>{
 const html=await read("PERSONEL/index.html"),shell=await read("PERSONEL/personel.js"),source=await read("PERSONEL/workforce.js");
 assert.match(html,/data-section="tasks"/);assert.match(html,/id="sectionTasks"/);
 assert.match(shell,/scheduleTaskBadgeRefresh/);assert.match(shell,/sequence !== taskBadgeSequence/);
 const renderer=source.slice(source.indexOf("function renderTasks()"),source.indexOf("async function updateTaskItem"));
 assert.doesNotMatch(renderer,/workforce-stats|wf-task-aside|Bugünün Planı/);assert.match(renderer,/Tamamla/);
 assert.match(renderer,/data-task-toggle/);assert.match(renderer,/data-task-item/);
});

async function runtime(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"sts-personnel-revision-"));
 const file=path.join(dir,"store.json");
 const store=createFileStore(file,{defaultPanelPassword:"test-panel-pass",bcryptRounds:4,writerLock:false,enableEventLoopMetrics:false});
 await store.ensure();
 const other={id:"other",name:"Diğer Personel",username:"other",active:true,passwordHash:await bcrypt.hash("other-test",4),personelSectionAccess:{tasks:true,stock:true,shipment:true,materialRequest:true,shift:true}};
 await store.update(data=>{data.recipeUsers=[other];return data;});
 const app=express();app.use(express.json());
 const pass=(_req,_res,next)=>next();
 app.use(async(req,res,next)=>{try{req.storeSnapshot=await store.read();next();}catch(e){next(e);}});
 const person=async(req,res,next)=>{const data=await store.read();req.recipeUser=data.recipeUsers.find(u=>u.id===req.get("X-Test-User"));if(!req.recipeUser)return res.status(401).json({ok:false});req.recipe={role:"recipe",sessionRole:"personel",userId:req.recipeUser.id};next();};
 const auth=new Proxy({requireAdmin(req,res,next){if(req.get("X-Test-Role")!=="admin")return res.status(401).json({ok:false});req.admin={userId:"admin",name:"Test Yöneticisi"};next();},requirePersonelOrPreview:person,requireActivePersonel:person,requirePersonelSection:()=>pass},{get(target,key){return target[key]||pass;}});
 const delivered=[];
 const notificationService={createNotificationInStore(data,input){const n={...input,id:"n-"+(data.notifications||[]).length,createdAt:new Date().toISOString()};data.notifications=(data.notifications||[]).concat(n);return n;},notificationsFromResult:n=>[n],publishNotificationEvent:n=>delivered.push(n),subscribeNotificationEvents:()=>()=>{},onPersonnelUpdated(){}};
 const routes=registerPersonelRoutes({app,store,auth,config:{jwtSecret:"personnel-test-fixture-secret-32-bytes",bcryptRounds:4,isProduction:false,mediaDir:path.join(dir,"media"),projectRoot:root},bcrypt,recipeLoginLimiter:pass,uploadLimiter:pass,notificationService,notificationDeliveryWorker:{},requireRequestOrigin:pass,broadcastMenuUpdate(){},normalizeStockState,broadcastStockUpdate(){},queueStockThresholdNotifications(){},notifyProcurementChange(){}});
 app.use((e,_req,res,_next)=>res.status(e.status||500).json({ok:false,message:e.message,code:e.code}));
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(async()=>{routes.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await store.close();await fs.rm(dir,{recursive:true,force:true});});
 const base="http://127.0.0.1:"+server.address().port;
 async function request(url,body,who="admin",method=body?"POST":"GET"){
   const headers={"Content-Type":"application/json",...(who==="admin"?{"X-Test-Role":"admin"}:{"X-Test-User":who})};
   const res=await fetch(base+url,{method,headers,body:body?JSON.stringify(body):undefined});const data=await res.json();return {status:res.status,data};
 }
 return {store,request,file,delivered};
}
test("personel görev tanımı sunucuda kalır; maskeli parola, görev bildirimi, sahiplik ve tamamlama çalışır",async t=>{
 const rt=await runtime(t);
 const create={requestId:"personnel-test-create",name:"Test Personeli",jobTitle:"Bakım teknisyeni",username:"test_personnel",password:"test-pass-123",email:"test@example.invalid"};
 const userRes=await rt.request("/api/admin/recipe-users",create);
 assert.equal(userRes.status,201,JSON.stringify(userRes.data));
 const user=userRes.data.user;
 assert.equal(user.jobTitle,create.jobTitle);assert.equal(user.passwordHash,undefined);assert.equal(user.password,undefined);
 const stored=(await rt.store.read()).recipeUsers.find(u=>u.id===user.id);
 assert.ok(await bcrypt.compare(create.password,stored.passwordHash));
 const taskPayload={requestId:"task-test-create",title:"Rulmanları kontrol et",description:"Test görevi",items:[{id:"i1",text:"Kontrol et"},{id:"i2",text:"Sonucu bildir"}],targetType:"selected",assignedUserIds:[user.id]};
 const taskRes=await rt.request("/api/admin/workforce/tasks",taskPayload);
 assert.equal(taskRes.status,201,JSON.stringify(taskRes.data));
 const task=taskRes.data.task;
 const replay=await rt.request("/api/admin/workforce/tasks",taskPayload);
 assert.equal(replay.status,200);assert.equal(replay.data.task.id,task.id);assert.equal(replay.data.idempotent,true);
 assert.equal((await rt.store.read()).notifications.filter(n=>n.eventType==="task_assigned").length,1);
 const me=await rt.request("/api/workforce/me?scope=tasks",null,user.id);
 assert.equal(tasks.count(me.data.tasks,user.id),1);
 const notification=(await rt.store.read()).notifications.find(n=>n.eventType==="task_assigned");
 assert.ok(notification);assert.equal(notification.recipientId,user.id);assert.ok(notification.deepLink.includes("section=tasks"));
 assert.ok(rt.delivered.some(n=>n.eventType==="task_assigned"));
 const other=await rt.request("/api/workforce/me?scope=tasks",null,"other");assert.equal(other.data.tasks.length,0);
 const forbidden=await rt.request("/api/workforce/tasks/"+task.id+"/items/i1",{requestId:"wrong-owner",completed:true},"other","PATCH");assert.equal(forbidden.status,404);
 let revision=me.data.revision;
 for(const item of task.items){const result=await rt.request("/api/workforce/tasks/"+task.id+"/items/"+item.id,{requestId:"complete-"+item.id,expectedRevision:revision,completed:true},user.id,"PATCH");assert.equal(result.status,200,JSON.stringify(result.data));revision=result.data.revision;}
 const completed=await rt.request("/api/workforce/me?scope=tasks",null,user.id);assert.equal(tasks.count(completed.data.tasks,user.id),0);
 assert.ok((await rt.store.read()).notifications.some(n=>n.eventType==="task_completed"));
 const update=await rt.request("/api/admin/recipe-users/"+user.id,{requestId:"job-update",name:user.name,username:user.username,jobTitle:"Atölye sorumlusu",active:true}, "admin","PUT");
 assert.equal(update.status,200,JSON.stringify(update.data));assert.equal(update.data.user.jobTitle,"Atölye sorumlusu");
 const disk=JSON.parse(await fs.readFile(rt.file,"utf8"));
 assert.equal(disk.recipeUsers.find(u=>u.id===user.id).jobTitle,"Atölye sorumlusu");
 assert.equal(disk.workforceAssignments.find(a=>a.taskId===task.id).status,"completed");
});

test("vardiya taslağı personele görünmez; yayınlama kalıcı ve tek bildirimlidir",async t=>{
 const rt=await runtime(t);
 const url="/api/admin/workforce/shifts/2026-10-05";
 const plans=[{personId:"other",date:"2026-10-08",type:"custom",startTime:"09:00",endTime:"13:00"}];
 const draft=await rt.request(url,{requestId:"shift-draft",plans,publish:false},"admin","PUT");
 assert.equal(draft.status,200,JSON.stringify(draft.data));
 const unpublished=await rt.request("/api/workforce/me?scope=shift",null,"other");
 assert.equal(unpublished.data.shiftPlans.length,0);
 const body={requestId:"shift-publish",plans,publish:true,expectedRevision:draft.data.revision};
 const published=await rt.request(url,body,"admin","PUT");
 assert.equal(published.status,200,JSON.stringify(published.data));
 const repeat=await rt.request(url,body,"admin","PUT");
 assert.equal(repeat.status,200);assert.equal(repeat.data.idempotent,true);
 const me=await rt.request("/api/workforce/me?scope=shift",null,"other");
 assert.equal(me.data.shiftPlans.length,1);assert.equal(me.data.shiftPlans[0].startTime,"09:00");assert.equal(me.data.shiftPlans[0].endTime,"13:00");
 const disk=JSON.parse(await fs.readFile(rt.file,"utf8"));
 assert.equal(disk.workforceShiftPlans.find(p=>p.personId==="other").status,"published");
 assert.equal(disk.notifications.filter(n=>n.eventType==="shift_published").length,1);
});

test("sade personel formu filtre, sayaç, yenileme ve hesap ayarı içermez; yetkileri korur",async()=>{
 const html=await read("YÖNETİCİ PANELİ/HTML/index.html");
 const personnel=html.slice(html.indexOf('<section class="section-panel staff-access-panel"'),html.indexOf('<template id="inactiveStaffTrainingModule">'));
 for(const removed of ["staffUserFilter","staffRefreshButton","staffUserCount","staffAccountSettings","staffUserEmail","staffUserActive","staffPersonnelLifecycle"])assert.ok(!personnel.includes(removed),removed);
 for(const kept of ["staffUserResetButton","staffUserName","staffJobTitle","staffUsername","staffPassword"])assert.ok(personnel.includes(kept),kept);
 for(const removed of ["staffSectionAccessAccordion","staffSectionAccessGrid","staffSectionAccessSave"])assert.ok(!personnel.includes(removed),removed);
 const source=await read("YÖNETİCİ PANELİ/JS/app.js");
 const render=source.slice(source.indexOf("function renderStaffUsers(users)"),source.indexOf("  let staffPersonnelTrigger"));
 const els={staffUserList:{innerHTML:""}};
 const ctx=vm.createContext({els,escapeHTML:x=>String(x).replaceAll("<","&lt;"),escapeAttribute:String});
 vm.runInContext(render,ctx);
 ctx.renderStaffUsers([{id:"p1",name:"Aktif kişi",active:true,username:"p1"},{id:"p2",name:"Pasif kişi",active:false,username:"p2"}]);
 assert.match(els.staffUserList.innerHTML,/Aktif kişi/);assert.match(els.staffUserList.innerHTML,/Pasif kişi/);
 assert.doesNotMatch(els.staffUserList.innerHTML,/data-toggle-staff-user|data-permanent-delete-user/);
});

test("üç bölüm referans çerçeveli akordiondur; iç liste düz ve tek-açık davranışı korunur",async()=>{
 const html=await read("YÖNETİCİ PANELİ/HTML/index.html"),css=await read("YÖNETİCİ PANELİ/CSS/personnel-revision.css"),source=await read("YÖNETİCİ PANELİ/JS/workforce.js");
 assert.match(html,/<details class="staff-accordion" id="staffPersonnelAccordion" open>/);
 const start=html.indexOf('id="staffPersonnelAccordion"'),end=html.indexOf('</details>',start),list=html.indexOf('id="staffUserList"',start);
 assert.ok(start<list&&list<end);assert.ok(end<html.indexOf('id="workforceTasksAccordion"'));
 assert.match(css,/\.staff-personnel-table\{border:0;border-radius:0/);
 assert.match(css,/\.staff-personnel-head\{font-weight:700;background:none/);
 assert.match(css,/#staffAccessCard>\.staff-layout>\.staff-accordion\{[^}]*border:1px solid var\(--line\);border-radius:14px;background:var\(--surface\)/);
 assert.match(css,/#staffAccessCard>\.staff-layout>\.staff-accordion>\.staff-accordion-body\{padding:24px/);
 assert.match(css,/staff-accordion-head>div\{grid-column:1;grid-row:1/);
 assert.match(css,/staff-accordion-chevron\{grid-column:2;grid-row:1/);
 assert.match(css,/#workforceTasksPanel \.workforce-active-tasks\{[^}]*background:transparent/);
 const toggles=[];
 const details=["staffPersonnelAccordion","workforceTasksAccordion","workforceShiftsAccordion"].map((id,i)=>({id,open:i===0,dataset:{},addEventListener(name,fn){if(name==="toggle")toggles.push({id,fn});}}));
 const block=source.slice(source.indexOf("  function setupAccordions()"),source.indexOf("  async function mount("));
 const ctx=vm.createContext({$$:s=>s.startsWith(".staff-layout")?details:[],syncLivePreview(){},refresh:()=>Promise.resolve(),showMessage(){}});
 vm.runInContext(block,ctx);ctx.setupAccordions();assert.equal(toggles.length,3);
 details[1].open=true;toggles.find(t=>t.id===details[1].id).fn();assert.equal(details[0].open,false);
 details[2].open=true;toggles.find(t=>t.id===details[2].id).fn();assert.equal(details[1].open,false);
 details[0].open=true;toggles.find(t=>t.id===details[0].id).fn();assert.equal(details[2].open,false);
});

test("personel kaydı e-posta gerektirmez; pasiflik, boş parola ve hesap verilerini koruyan payload gönderir",async()=>{
 const source=await read("YÖNETİCİ PANELİ/JS/app.js");
 const fn=source.slice(source.indexOf("async function saveStaffUser()"),source.indexOf("function renderStaffAssignmentOptions()"));
 const user={id:"p1",active:false,email:"verified@example.invalid",personelSectionAccess:{stock:false}};
 const state={selectedStaffUserId:user.id,recipeAccess:{users:[user]}};
 const els={staffUserName:{value:"Test"},staffUsername:{value:"test"},staffPassword:{value:""},staffUserSaveButton:{}};
 let payload;
 const ctx=vm.createContext({state,els,document:{getElementById:()=>({value:"Bakım"})},staffMutationOptions:(_key,p)=>{payload=p;return {};},runStaffImmediateOperation:async()=>({user}),applyStaffAccessResponse(){},renderStaffAccess(){}});
 vm.runInContext(fn,ctx);await ctx.saveStaffUser();
 assert.equal(payload.active,false);assert.equal(payload.password,"");assert.equal(payload.jobTitle,"Bakım");
 assert.equal(Object.hasOwn(payload,"email"),false);assert.equal(Object.hasOwn(payload,"personelSectionAccess"),false);
 state.selectedStaffUserId="";await ctx.saveStaffUser();assert.equal(payload.active,true);assert.equal(Object.hasOwn(payload,"email"),false);
});

test("sade personel güncellemesi sunucuda doğrulanmış e-posta, erişim ve parola özetini değiştirmez",async t=>{
 const rt=await runtime(t);
 await rt.store.update(data=>{const u=data.recipeUsers.find(u=>u.id==="other");Object.assign(u,{active:false,email:"verified@example.invalid",emailNormalized:"verified@example.invalid",pendingEmail:"pending@example.invalid",emailVerifiedAt:"2026-10-01T00:00:00.000Z",emailVerificationRequired:true});return data;});
 const before=(await rt.store.read()).recipeUsers.find(u=>u.id==="other");
 const result=await rt.request("/api/admin/recipe-users/other",{requestId:"simple-edit",name:"Diğer Personel",username:"other",jobTitle:"Atölye sorumlusu",password:"",active:false},"admin","PUT");
 assert.equal(result.status,200,JSON.stringify(result.data));
 const after=(await rt.store.read()).recipeUsers.find(u=>u.id==="other");
 for(const key of ["email","emailNormalized","pendingEmail","emailVerifiedAt","emailVerificationRequired","passwordHash","active"])assert.equal(after[key],before[key],key);
 assert.deepEqual(after.personelSectionAccess,before.personelSectionAccess);
 assert.equal(after.jobTitle,"Atölye sorumlusu");
});

async function shiftEditorRuntime(){
 const source=await read("YÖNETİCİ PANELİ/JS/workforce.js");
 const logic=source.slice(source.indexOf("  function weekDates()"),source.indexOf("  function renderShifts()"));
 const collect=source.slice(source.indexOf("  function collectPlans()"),source.indexOf("  function saveShifts("));
 const state={weekStart:"2026-10-05",busy:false,shiftEdits:new Map(),shiftEditor:null,draftPlans:null,data:{users:[{id:"p1",name:"Ali <Yılmaz>",jobTitle:"Bakım"},{id:"p2",name:"Mehmet",jobTitle:"Elektrikçi"},{id:"p3",name:"Pasif",active:false}],shiftPlans:[]},templates:{morning:{startTime:"08:00",endTime:"16:00"},evening:{startTime:"16:00",endTime:"00:00"},custom:{startTime:"12:00",endTime:"20:00"}}};
 const nodes=new Map();for(const id of ["workforceShiftGrid","workforceShiftEditor","workforceShiftEditorPerson","workforceShiftType","workforceShiftStart","workforceShiftEnd","workforceShiftEditorHours","workforceShiftEditorError"])nodes.set('#'+id,{innerHTML:"",value:"",textContent:"",focus(){},showModal(){this.open=true;},close(){this.open=false;}});
 const addDays=(date,days)=>{const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);};
 const ctx=vm.createContext({state,$:s=>nodes.get(s),$$:()=>[],esc:x=>String(x).replaceAll("<","&lt;").replaceAll(">","&gt;"),addDays,dateValue:x=>x,isoDate:()=>"2026-10-08",Date});
 vm.runInContext(logic+collect,ctx);return {ctx,state,nodes};
}

test("haftalık roster düğmelerle açılır, ad ve görev tanımı kesilmez; seçici yalnız detay kartındadır",async()=>{
 const {ctx,nodes}=await shiftEditorRuntime();ctx.renderShiftGrid();
 const html=nodes.get("#workforceShiftGrid").innerHTML;
 assert.equal((html.match(/data-shift-person=/g)||[]).length,14);
 assert.doesNotMatch(html,/<select|workforce-avatar|Pasif/);assert.match(html,/Ali &lt;Yılmaz&gt;/);assert.match(html,/Bakım/);assert.match(html,/is-today/);assert.match(html,/aria-haspopup="dialog"/);
 const source=await read("YÖNETİCİ PANELİ/JS/workforce.js");
 assert.match(source,/<dialog id="workforceShiftEditor"/);assert.match(source,/Düzenlemek için bir güne tıklayın/);
 assert.match(source,/data-save-draft/);assert.match(source,/data-publish-shifts/);assert.match(source,/Şablonlar ve mevcut planlama seçenekleri/);
});

test("hücre düzenlemesi yalnız geçici planı değiştirir; iptal ve hatalı saat mevcut planı korur",async()=>{
 const {ctx,state,nodes}=await shiftEditorRuntime();
 const type=nodes.get("#workforceShiftType"),start=nodes.get("#workforceShiftStart"),end=nodes.get("#workforceShiftEnd"),dialog=nodes.get("#workforceShiftEditor");
 ctx.openShiftEditor("p1","2026-10-08");assert.equal(dialog.open,true);assert.equal(type.value,"unassigned");
 type.value="custom";ctx.syncShiftEditorHours();assert.equal(start.disabled,false);start.value="13:00";end.value="09:00";
 ctx.applyShiftEditor({preventDefault(){}});assert.equal(state.shiftEdits.size,0);assert.equal(dialog.open,true);assert.match(nodes.get("#workforceShiftEditorError").textContent,/önce/);
 start.value="09:00";end.value="13:00";ctx.applyShiftEditor({preventDefault(){}});
 assert.equal(dialog.open,false);assert.equal(state.data.shiftPlans.length,0);assert.equal(ctx.planFor("p1","2026-10-08").startTime,"09:00");
 ctx.openShiftEditor("p1","2026-10-08");type.value="leave";dialog.close(); // Cancel does not apply staged fields.
 assert.equal(ctx.planFor("p1","2026-10-08").type,"custom");
 type.value="evening";ctx.syncShiftEditorHours();assert.equal(start.disabled,true);
 ctx.applyShiftEditor({preventDefault(){}});assert.equal(ctx.planFor("p1","2026-10-08").endTime,"00:00");
 state.data.shiftPlans=[{personId:"p2",date:"2026-10-07",type:"morning",status:"published",startTime:"07:00",endTime:"15:00"}];
 const plans=ctx.collectPlans();assert.equal(plans.length,14);assert.equal(plans.find(p=>p.personId==="p2"&&p.date==="2026-10-07").startTime,"07:00");assert.equal(plans.find(p=>p.personId==="p1"&&p.date==="2026-10-08").endTime,"00:00");
 ctx.openShiftEditor("p1","2026-10-09");type.value="leave";ctx.applyShiftEditor({preventDefault(){}});assert.equal(ctx.planFor("p1","2026-10-09").startTime,null);
 state.weekStart="2026-10-12";assert.equal(ctx.planFor("p1","2026-10-15").type,"unassigned");ctx.clearShiftEdits();assert.equal(state.shiftEdits.size,2);
 state.weekStart="2026-10-05";ctx.clearShiftEdits();assert.equal(state.shiftEdits.size,0);
});
