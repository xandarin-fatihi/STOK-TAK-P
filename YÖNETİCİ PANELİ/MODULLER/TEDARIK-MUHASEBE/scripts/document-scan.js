import { api, requestId } from "./api.js?v=20260920-notification-center-v1";
import { escapeHtml as esc, state, CAPABILITIES, has } from "./state.js?v=20261005-storage-placement-v1";
import { createDocumentDialog, camera, bundle } from "./document-records.js?v=20261009-scan-v2&fixes=20261011-v2";

let active;
export function closeDocumentScan() { if(active) { active.abort.abort(); active.busy(false); active.close(); active=null; } }

export async function openDocumentScan({record=null,onSaved}={}) {
  closeDocumentScan();
  const ui=createDocumentDialog(record ? "Malzemeleri Düzenle" : "Belgeyi Tara","doc-dialog--scan");active=ui;
  ui.dialog.addEventListener("close",()=>{if(active===ui)active=null;},{once:true});
  let file=null, preview="", items=[], stage="upload", zoom=100, attempt="", signature="", readWarnings=[];
  let values={recordTitle:record?.recordTitle || "",documentNumber:record?.documentNumber || "",documentDate:record?.documentDate || ""};
  const drawPreview=()=>{
    const target=ui.body.querySelector(".doc-scan-preview");if(!target)return;
    target.innerHTML=preview ? `<img src="${esc(preview)}" alt="Orijinal irsaliye" style="width:${zoom}%;max-width:none">` : '<p>İrsaliyenizi fotoğraflayın veya galeriden ekleyin.</p>';
    const label=ui.body.querySelector(".doc-scan-zoom");if(label)label.textContent=`${zoom}%`;
  };
  const setFile=(incoming)=>{
    if(!ui.alive || ui.saving)return;
    if(!incoming?.size || incoming.size>15*1024*1024 || !/\.(jpe?g|png|webp)$/i.test(incoming.name))return ui.message("Tarama için en fazla 15 MB JPEG, PNG veya WebP fotoğraf seçin.");
    file=incoming;preview=ui.url(file);zoom=100;ui.message("");drawPreview();ui.footer.querySelector('[data-scan="read"]').disabled=false;
  };
  const renderUpload=()=>{
    stage="upload";
    ui.dialog.querySelector("h2").textContent="Belgeyi Tara";
    ui.body.innerHTML='<div class="doc-scan-upload"><div class="doc-scan-preview"></div><div class="doc-file-actions"><label class="ui-button ui-button--secondary">↑ Galeriden Ekle<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label><button type="button" class="ui-button ui-button--secondary" data-scan="camera">▣ Fotoğraf Çek</button></div><p>Fotoğraf bu sunucuda okunur; dış servise gönderilmez.</p></div>';
    ui.footer.innerHTML='<button type="button" class="ui-button ui-button--secondary" data-scan="cancel">Vazgeç</button><button type="button" class="ui-button ui-button--primary" data-scan="read" disabled>Tara ve Oku</button>';
    ui.body.querySelector('input[type="file"]').addEventListener("change",event=>{setFile(event.target.files[0]);event.target.value="";});drawPreview();
  };
  const selectionCount=()=>{
    const count=items.filter(item=>item.selected).length;
    ui.footer.querySelector(".doc-scan-count").textContent=`${count} malzeme seçildi`;
    const all=ui.body.querySelector(".doc-scan-all");all.checked=!!items.length&&count===items.length;all.indeterminate=count>0&&count<items.length;
    ui.footer.querySelector('[data-scan="export"]').disabled=!count;
    const save=ui.footer.querySelector('[data-scan="save"]');if(save)save.disabled=!count;
  };
  const renderRows=()=>{
    ui.body.querySelector(".doc-scan-rows").innerHTML=items.map((item,index)=>`<div class="doc-scan-row ${item.selected ? "" : "is-excluded"}" data-index="${index}"><input type="checkbox" data-field="selected" aria-label="${esc(item.name || "Malzeme")} seç" ${item.selected?"checked":""}><label><span>Malzeme adı</span><input data-field="name" maxlength="240" value="${esc(item.name)}" aria-label="${index+1}. malzeme adı"></label><label><span>Malzeme kodu</span><input data-field="code" maxlength="120" value="${esc(item.code)}" aria-label="${index+1}. malzeme kodu"></label><label><span>Miktar</span><input data-field="quantity" type="number" min="1" max="1000000000" step="1" inputmode="numeric" value="${esc(item.quantity ?? "")}" aria-label="${index+1}. malzeme miktarı" ${item.quantity===null?'class="needs-review"':""}></label>${item.warning ? `<small class="doc-scan-row-warning">${esc(item.warning)}</small>`:""}</div>`).join("") || '<p>Malzeme satırı okunamadı. Daha net fotoğraf deneyin veya satır ekleyin.</p>';
    selectionCount();
  };
  const renderReview=()=>{
    stage="review";ui.dialog.querySelector("h2").textContent="Okunan Malzemeler";
    ui.body.innerHTML=`<p class="doc-scan-intro">Bilgileri kontrol edip düzenleyin. Size ait olmayan satırların işaretini kaldırın.</p><div class="doc-scan-grid"><section class="doc-scan-paper"><div class="doc-view-controls"><strong>Orijinal belge</strong><span class="doc-controls-space"></span><button type="button" data-scan="out" aria-label="Küçült">−</button><button type="button" data-scan="reset" class="doc-scan-zoom">100%</button><button type="button" data-scan="in" aria-label="Büyüt">＋</button></div><div class="doc-scan-preview"></div></section><section class="doc-scan-data"><div class="doc-scan-fields"><label>Belge adı<input data-meta="recordTitle" maxlength="180" value="${esc(values.recordTitle)}"></label><label>İrsaliye no<input data-meta="documentNumber" maxlength="120" value="${esc(values.documentNumber)}"></label><label>Belge tarihi<input data-meta="documentDate" type="date" value="${esc(values.documentDate)}"></label></div><label class="doc-scan-select-all"><input type="checkbox" class="doc-scan-all">Tümünü seç</label><div class="doc-scan-head"><span></span><span>Malzeme adı</span><span>Malzeme kodu</span><span>Miktar</span></div><div class="doc-scan-rows"></div><button type="button" class="ui-button ui-button--secondary" data-scan="add">＋ Satır Ekle</button><details class="doc-scan-text"><summary>Okunan metni göster</summary><pre></pre></details><p class="doc-scan-warning">${esc(readWarnings.join(" "))}</p></section></div>`;
    ui.footer.innerHTML=`<span class="doc-scan-count" aria-live="polite"></span><button type="button" class="ui-button ui-button--secondary" data-scan="cancel">Vazgeç</button><button type="button" class="ui-button doc-scan-export" data-scan="export">Seçilenleri Excel’e Aktar</button>${has(CAPABILITIES.documentsUpload)?'<button type="button" class="ui-button ui-button--primary" data-scan="save">Belgelere Kaydet</button>':""}<small>Orijinal belge korunur. Stok miktarı değişmez.</small>`;
    ui.body.querySelector(".doc-scan-all").addEventListener("change",event=>{items.forEach(item=>item.selected=event.target.checked);renderRows();});
    ui.body.addEventListener("input",event=>{
      const input=event.target;if(input.dataset.meta)values[input.dataset.meta]=input.value;
      if(!input.dataset.field)return;
      const row=input.closest("[data-index]");const item=items[Number(row.dataset.index)];
      item[input.dataset.field]=input.dataset.field==="selected"?input.checked:input.dataset.field==="quantity"?(input.value===""?null:Number(input.value)):input.value;
      row.classList.toggle("is-excluded",!item.selected);selectionCount();
    });drawPreview();renderRows();
  };
  const selectedInput=()=>{
    const selected=items.filter(item=>item.selected);
    if(!selected.length)throw new Error("En az bir malzeme seçin.");
    if(!values.recordTitle.trim() || !values.documentDate)throw new Error("Belge adını ve tarihini girin.");
    if(selected.some(item=>!item.name.trim() || !Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000000000))throw new Error("Seçilen satırların adını ve miktarını kontrol edin. Miktar pozitif tam sayı olmalıdır.");
    return {...values,items:selected.map(({name,code,quantity})=>({name:name.trim(),code:code.trim(),quantity}))};
  };
  ui.dialog.addEventListener("click",async event=>{
    const button=event.target.closest("[data-scan]");if(!button || button.disabled || ui.saving)return;
    const action=button.dataset.scan;
    try {
      if(action==="cancel")return ui.close();
      if(action==="camera")return camera(setFile);
      if(["in","out","reset"].includes(action)){zoom=action==="reset"?100:Math.max(50,Math.min(300,zoom+(action==="in"?25:-25)));drawPreview();return;}
      if(action==="add"){if(items.length>=200)throw new Error("En fazla 200 satır olabilir.");items.push({name:"",code:"",quantity:null,selected:true,warning:"Belgeden kontrol ederek doldurun."});renderRows();return;}
      if(action==="read"){
        if(!file)return;
        ui.busy(true);ui.message("Belge okunuyor…");
        const payload=await api("/document-scan/read",{method:"POST",body:file,raw:true,headers:{"Content-Type":file.type || "application/octet-stream"},signal:ui.abort.signal});
        if(!ui.alive)return;
        const scan=payload.scan;items=scan.items.map(item=>({...item,selected:true}));readWarnings=scan.warnings || [];
        values={recordTitle:scan.documentNumber?`İrsaliye ${scan.documentNumber}`:"İrsaliye",documentNumber:scan.documentNumber || "",documentDate:scan.documentDate || ""};
        ui.busy(false);ui.message("");renderReview();ui.body.querySelector("pre").textContent=scan.text || "";return;
      }
      if(action==="export" || action==="save"){
        const input=selectedInput();ui.busy(true);ui.message(action==="save"?"Kaydediliyor…":"Excel hazırlanıyor…");
        if(action==="export"){
          const blob=await api("/document-scan/export",{method:"POST",body:input,responseType:"blob",signal:ui.abort.signal});
          if(!ui.alive)return;
          const link=document.createElement("a");link.href=ui.url(blob);link.download="irsaliye-malzemeleri.xlsx";document.body.append(link);link.click();link.remove();
          ui.busy(false);ui.message("Excel indirildi. Belgelere kayıt için ayrıca Belgelere Kaydet’e basın.");
        }else{
          const metadata={...values,shipmentIds:record?.shipmentIds || [],scanItems:input.items};
          const nextSignature=JSON.stringify(metadata);if(signature!==nextSignature){signature=nextSignature;attempt=requestId("document-scan-save");}
          const send=(allowDuplicate=false)=>api(record?`/documents/${encodeURIComponent(record.id)}/record`:"/document-records",{method:"POST",body:bundle(record?[]:[file],{...metadata,allowDuplicate}),raw:true,headers:{"Content-Type":"application/octet-stream"},expectedRevision:state.revision,requestId:attempt,signal:ui.abort.signal});
          let payload;try{payload=await send();}catch(error){
            if(error.code!=="DOCUMENT_DUPLICATE")throw error;
            ui.busy(false);ui.message(error.message);const proceed=await confirmScanDuplicate();if(!proceed || !ui.alive)return;ui.busy(true);payload=await send(true);
          }
          if(!ui.alive)return;ui.busy(false);ui.close();await onSaved?.(payload);
        }
      }
    }catch(error){if(ui.alive){ui.busy(false);if(stage==="review")selectionCount();ui.message(error.message || "İşlem tamamlanamadı.");}}
  });
  renderUpload();
  if(record){
    ui.busy(true);ui.message("Orijinal belge yükleniyor…");
    try{
      const blob=await api(`/documents/${encodeURIComponent(record.id)}/content`,{responseType:"blob",signal:ui.abort.signal});
      if(!ui.alive)return;
      preview=ui.url(blob);items=(record.scanItems || []).map(item=>({...item,selected:true}));readWarnings=["Kaydedilmiş malzeme listesi. Düzenleme stokları değiştirmez."];
      ui.busy(false);ui.message("");renderReview();
    }catch(error){if(ui.alive){ui.busy(false);ui.message(error.message);}}
  }
  return ui;
}

function confirmScanDuplicate(){
  return new Promise(resolve=>{
    const ui=createDocumentDialog("Dosya zaten kayıtlı","doc-dialog--picker");
    ui.body.innerHTML='<p>Bu fotoğraf zaten kayıtlı. Ayrı bir belge olarak yeniden kaydedilsin mi?</p>';
    ui.footer.innerHTML='<button type="button" class="ui-button ui-button--secondary" data-answer="no">Vazgeç</button><button type="button" class="ui-button ui-button--primary" data-answer="yes">Yine de Kaydet</button>';
    let answered=false;
    ui.dialog.addEventListener("click",event=>{const button=event.target.closest("[data-answer]");if(button){answered=true;resolve(button.dataset.answer==="yes");ui.close();}});
    ui.dialog.addEventListener("close",()=>{if(!answered)resolve(false);},{once:true});
  });
}
