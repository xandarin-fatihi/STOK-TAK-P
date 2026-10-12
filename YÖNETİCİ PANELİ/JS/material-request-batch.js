(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const model = { rows: [], selected: new Set(), query: "", name: "", revision: 0, busy: false, stage: "list", operationId: "", fingerprint: "", result: null, returnFocus: null };
  const normalize = value => String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  const base = () => String(window.MENU_SUITE_BACKEND_URL || localStorage.getItem("menu-suite.backend.url") || "").replace(/\/+$/, "");
  async function request(url, options = {}) {
    const response = await fetch(`${base()}${url}`, { credentials: "include", ...options });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw Object.assign(new Error(body.message || "İşlem tamamlanamadı."), {status:response.status}); }
    return response;
  }
  function rowsFrom(data) {
    const products = data.materialRequestCatalog?.products || [];
    return [...(data.materialRequests || [])].sort((a,b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).flatMap(request => (request.items || [])
      .filter(item => (item.decisionStatus || request.status) === "onay_bekliyor")
      .map(item => {
        const product = products.find(p => p.id === (item.linkedProductId || item.stockProductId));
        return { key: JSON.stringify([request.id,item.id]), requestId:request.id, itemId:item.id, name:item.name, code:product?.productCode || item.code || "", imageUrl:item.imageUrl || product?.imageUrl || "", personName:request.personName || "Personel", requestNumber:request.requestNumber, department:request.depotName || request.department || "Depo belirtilmedi", requestedQuantity:item.quantity, quantity:String(item.quantity) };
      }));
  }
  function selections() { return model.rows.filter(row => model.selected.has(row.key)).map(row => ({requestId:row.requestId,itemId:row.itemId,quantity:Number(row.quantity)})); }
  function validate() {
    if (!model.selected.size) throw new Error("En az bir malzeme seçin.");
    for (const row of model.rows.filter(row => model.selected.has(row.key))) {
      const quantity = Number(row.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000000) throw new Error(`${row.name} için pozitif tam sayı girin.`);
    }
  }
  function message(text) { const node = $("#materialBatchMessage"); if (node) { node.textContent = text; node.hidden = !text; } }
  function render() {
    const host = $("#materialBatchContent");
    if (!host) return;
    if (model.result) {
      host.innerHTML = `<div class="material-batch-result"><h3>Seçilen ${model.result.approvedCount} kalem onaylandı.</h3><p>Personel bildirimleri onaylanan miktarlarla gönderildi. Seçilmeyen kalemler beklemede kaldı.</p><button type="button" class="ui-button ui-button--primary" data-batch-download>Excel'i Tekrar İndir</button><button type="button" class="ui-button ui-button--secondary" data-batch-close>Kapat</button></div><p id="materialBatchMessage" role="alert" hidden></p>`;
      $("[data-batch-download]").addEventListener("click", () => download().catch(error => message(error.message)));
      $("[data-batch-close]").addEventListener("click", close);
      return;
    }
    if (model.stage === "name") {
      host.innerHTML = `<form id="materialBatchNameForm" class="material-batch-name"><h3>Talep Eden Kişi</h3><label for="materialBatchRequester">Formda hangi ad yazsın?</label><input id="materialBatchRequester" name="requesterName" maxlength="120" required autocomplete="name" placeholder="Ad soyad girin" value="${esc(model.name)}"><p>Tarih, Excel çıktısının alındığı gün olarak otomatik yazılır.</p><p id="materialBatchMessage" role="alert" hidden></p><footer><button class="ui-button ui-button--secondary" type="button" data-batch-back ${model.busy ? "disabled" : ""}>Geri</button><button class="ui-button ui-button--primary" type="submit" ${model.busy ? "disabled" : ""}>${model.busy ? "İşlem yapılıyor…" : "Onayla ve İndir"}</button></footer></form>`;
      $("[data-batch-back]").addEventListener("click", () => { model.name = $("#materialBatchRequester").value; model.stage="list"; render(); });
      $("#materialBatchNameForm").addEventListener("submit", submit);
      $("#materialBatchRequester").focus();
      return;
    }
    host.innerHTML = `<p class="material-batch-description">Bekleyen personel taleplerini seçin, onay miktarlarını düzenleyin.</p><label class="material-batch-search"><span class="sr-only">Malzeme taleplerinde ara</span><input id="materialBatchSearch" type="search" placeholder="Malzeme, personel veya talep koduyla ara" value="${esc(model.query)}"></label><div class="material-batch-table" role="table" aria-label="Bekleyen malzeme kalemleri"><div class="material-batch-row material-batch-head" role="row"><span role="columnheader"></span><span role="columnheader">Malzeme</span><span role="columnheader">Personel / Talep</span><span role="columnheader">Depo</span><span role="columnheader">İstenen</span><span role="columnheader">Onay miktarı</span></div>${model.rows.map((row,i) => {
      const selected = model.selected.has(row.key);
      return `<div class="material-batch-row" role="row" data-batch-row="${i}"><span role="cell"><input type="checkbox" data-batch-select="${i}" aria-label="${esc(row.name)} kalemini seç" ${selected ? "checked" : ""}></span><span role="cell" class="material-batch-product">${row.imageUrl ? `<img src="${esc(row.imageUrl)}" alt="${esc(row.name)}">` : `<span class="material-batch-no-image" aria-hidden="true">—</span>`}<span><strong>${esc(row.name)}</strong><small>${esc(row.code || "Kod belirtilmedi")}</small></span></span><span role="cell" class="material-batch-person"><strong>${esc(row.personName)}</strong><small>${esc(row.requestNumber)}</small></span><span role="cell" data-label="Depo">${esc(row.department)}</span><span role="cell" data-label="İstenen">${esc(row.requestedQuantity)}</span><span role="cell"><span class="material-batch-quantity"><button type="button" data-batch-step="${i}" data-delta="-1" aria-label="${esc(row.name)} miktarını azalt" ${selected ? "" : "disabled"}>−</button><input type="number" min="1" max="1000000000" step="1" inputmode="numeric" value="${esc(row.quantity)}" data-batch-quantity="${i}" aria-label="${esc(row.name)} onay miktarı" ${selected ? "" : "disabled"}><button type="button" data-batch-step="${i}" data-delta="1" aria-label="${esc(row.name)} miktarını artır" ${selected ? "" : "disabled"}>+</button></span><small data-batch-hint="${i}">${selected ? `${esc(row.requestedQuantity)} → ${esc(row.quantity)}` : "Beklemede kalacak"}</small></span></div>`;
    }).join("")}</div><p data-batch-empty ${model.rows.length ? "hidden" : ""}>Bekleyen malzeme kalemi yok.</p><p id="materialBatchMessage" role="alert" hidden></p><footer class="material-batch-footer"><span data-batch-summary aria-live="polite"></span><div><button class="ui-button ui-button--secondary" type="button" data-batch-close>Vazgeç</button><button class="ui-button ui-button--primary" type="button" data-batch-next>Seçilenleri Onayla ve Excel İndir</button></div><small>Excel ve personel bildirimi, onaylanan miktarı kullanır.</small></footer>`;
    $("#materialBatchSearch").addEventListener("input", event => { model.query = event.target.value; filterRows(); });
    host.querySelectorAll("[data-batch-select]").forEach(input => input.addEventListener("change", () => { const row=model.rows[Number(input.dataset.batchSelect)]; input.checked ? model.selected.add(row.key) : model.selected.delete(row.key); updateRow(Number(input.dataset.batchSelect)); updateSummary(); }));
    host.querySelectorAll("[data-batch-quantity]").forEach(input => input.addEventListener("input", () => { model.rows[Number(input.dataset.batchQuantity)].quantity=input.value; updateRow(Number(input.dataset.batchQuantity)); }));
    host.querySelectorAll("[data-batch-step]").forEach(button => button.addEventListener("click", () => { const index=Number(button.dataset.batchStep), row=model.rows[index]; row.quantity=String(Math.min(1000000000,Math.max(1,(Number(row.quantity)||1)+Number(button.dataset.delta)))); updateRow(index); }));
    $("[data-batch-close]").addEventListener("click", close);
    $("[data-batch-next]").addEventListener("click", () => { try { validate(); model.stage="name"; render(); } catch(error) { message(error.message); } });
    filterRows(); updateSummary();
  }
  function updateRow(index) {
    const row=model.rows[index], selected=model.selected.has(row.key), element=$(`[data-batch-row="${index}"]`);
    element.querySelectorAll("[data-batch-step], [data-batch-quantity]").forEach(control => { control.disabled=!selected; });
    const input=element.querySelector("[data-batch-quantity]"); if(input.value !== row.quantity) input.value=row.quantity;
    element.querySelector("[data-batch-hint]").textContent=selected ? `${row.requestedQuantity} → ${row.quantity}` : "Beklemede kalacak";
  }
  function updateSummary() { $("[data-batch-summary]").textContent=`${model.selected.size} kalem seçildi · ${model.rows.length-model.selected.size} kalem beklemede`; $("[data-batch-next]").disabled=!model.selected.size; }
  function filterRows() {
    const query=normalize(model.query); let visible=0;
    model.rows.forEach((row,i) => { const show=normalize([row.name,row.code,row.personName,row.requestNumber,row.department].join(" ")).includes(query); $(`[data-batch-row="${i}"]`).hidden=!show; if(show)visible++; });
    const empty=$("[data-batch-empty]"); empty.hidden=visible>0; empty.textContent=model.rows.length ? "Aramanızla eşleşen malzeme yok." : "Bekleyen malzeme kalemi yok.";
    // Arama seçimleri değiştirmez; tüm seçim sayısı footer'da görünür.
  }
  async function open() {
    if(model.busy || $("#materialBatchDialog").open) return;
    model.busy=true;
    model.returnFocus=document.activeElement;
    try {
      const data=await (await request("/api/admin/workforce?scope=materialrequests")).json();
      Object.assign(model,{rows:rowsFrom(data),selected:new Set(),query:"",name:"",revision:Number(data.revision || 0),stage:"list",result:null,operationId:"",fingerprint:""});
      model.busy=false;
      render(); $("#materialBatchDialog").showModal(); $("#materialBatchSearch")?.focus();
    } catch(error) { window.alert(error.message); }
    finally { model.busy=false; }
  }
  function close() { if(model.busy)return; $("#materialBatchDialog").close(); }
  async function submit(event) {
    event.preventDefault(); if(model.busy || model.result)return;
    model.name=$("#materialBatchRequester").value.trim();
    try {
      validate(); if(!model.name)throw new Error("Talep eden kişinin adını yazın.");
      const payload={requesterName:model.name,selections:selections(),expectedRevision:model.revision};
      const fingerprint=JSON.stringify(payload);
      if(fingerprint!==model.fingerprint) { model.operationId=`material-batch-${window.crypto.randomUUID()}`; model.fingerprint=fingerprint; }
      model.busy=true; render();
      model.result=await (await request("/api/admin/workforce/material-request-batches",{method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":model.operationId},body:JSON.stringify({...payload,requestId:model.operationId})})).json();
      render();
      document.dispatchEvent(new CustomEvent("sts:material-batch-approved",{detail:model.result}));
      await download();
      message("Excel indirildi. Yazdırma düzeni hazır; her formda 20 malzeme satırı var.");
    } catch(error) {
      if(model.result) message(`Onay kaydedildi. İndirme tamamlanamadı: ${error.message} Excel'i Tekrar İndir düğmesini kullanın.`);
      else { render(); message(error.status===409 ? `${error.message} Kartı kapatıp yeniden açarak güncel talepleri yükleyin.` : error.message); }
    } finally {
      const errorText=$("#materialBatchMessage")?.textContent || "";
      model.busy=false;
      if(!model.result){ render(); message(errorText); }
    }
  }
  async function download() {
    if(!model.result)return;
    if(!/^\/api\/admin\/workforce\/material-request-batches\/[^/]+\/excel$/.test(model.result.exportUrl))throw new Error("Excel bağlantısı geçersiz.");
    const response=await request(model.result.exportUrl);
    const blob=await response.blob(), url=URL.createObjectURL(blob), link=document.createElement("a");
    link.href=url; link.download=response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "Malzeme-Talep.xlsx";
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),30000);
  }
  function setup() {
    const dialog=$("#materialBatchDialog"); if(!dialog)return;
    $("#materialBatchClose").addEventListener("click",close);
    dialog.addEventListener("cancel",event => {if(model.busy)event.preventDefault();});
    dialog.addEventListener("close",() => model.returnFocus?.focus());
    dialog.addEventListener("click",event => {if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();}});
  }
  window.STSMaterialBatch = { open };
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup,{once:true}); else setup();
})();
