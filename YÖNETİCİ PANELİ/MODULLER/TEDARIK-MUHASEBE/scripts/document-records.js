import { api, requestId } from "./api.js?v=20260920-notification-center-v1";
import { CAPABILITIES, escapeHtml as esc, has, hasSection, state, trDate } from "./state.js?v=20261005-storage-placement-v1";
import { renderDocumentPdf } from "./document-pdf-viewer.js?v=20261008-v2";

const number = (value) => Number(value || 0).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; };
const title = (record) => record.recordTitle || record.documentNumber || record.originalName || "Belge";
const depot = (receipt) => receipt.destinationLocationName || receipt.destinationWarehouseName || receipt.destinationLocation?.name || state.context?.stockLocations?.find((item) => item.id === receipt.destinationLocationId)?.name || "Depo";
const receiptNumber = (receipt) => receipt.shipmentNumber || receipt.documentNumber || receipt.id;
const eligible = (receipt) => Boolean(receipt.stockAppliedAt) && !receipt.removedAt && receipt.stockStatus !== "reversed";
const linked = (record) => (state.shipments || []).filter((receipt) => (record.shipmentIds || []).includes(receipt.id));
const receiptText = (receipt) => `${receiptNumber(receipt)} ${depot(receipt)} ${(receipt.items || []).map((item) => `${item.name || item.productName || ""} ${item.productCode || ""}`).join(" ")}`;
const receiptItems = (receipt) => `<div class="doc-linked-items"><strong>${esc(depot(receipt))}</strong><small>${esc(receiptNumber(receipt))}</small>${(receipt.items || []).map((item) => `<div><span>${esc(item.name || item.productName || "Malzeme")}</span><b>${number(item.quantityBase ?? item.quantity ?? item.quantityBulk)} adet</b></div>`).join("")}</div>`;

export function renderDocumentRecords() {
  const query = String(state.filters.documents || "").trim().toLocaleLowerCase("tr-TR");
  const start = state.filters.documentDateFrom || "";
  const end = state.filters.documentDateTo || "";
  const missing = state.filters.documentsMissing === true;
  const matchDate = (date) => (!start || date >= start) && (!end || date <= end);
  const records = (state.documents || []).filter((record) => !record.archivedAt && matchDate(String(record.documentDate || record.createdAt || "").slice(0,10)) && (!query || `${title(record)} ${record.documentNumber || ""} ${linked(record).map(receiptText).join(" ")} ${(record.scanItems || []).map(item=>`${item.name} ${item.code}`).join(" ")}`.toLocaleLowerCase("tr-TR").includes(query))).sort((a,b) => String(b.documentDate || b.createdAt).localeCompare(String(a.documentDate || a.createdAt)));
  const receipts = (state.shipments || []).filter((receipt) => eligible(receipt) && !(state.documents || []).some((record) => !record.archivedAt && (record.shipmentIds || []).includes(receipt.id)) && matchDate(String(receipt.stockAppliedAt).slice(0,10)) && (!query || receiptText(receipt).toLocaleLowerCase("tr-TR").includes(query)));
  const count = missing ? receipts.length : records.length;
  return `<section class="doc-records" aria-label="Belgeler"><div class="doc-toolbar"><label class="doc-search"><span aria-hidden="true">⌕</span><input id="document-search" type="search" value="${esc(state.filters.documents || "")}" placeholder="Belge adı, irsaliye no veya malzeme ara" aria-label="Belge ara"></label><div class="doc-toolbar-actions">${has(CAPABILITIES.documentsUpload) ? '<button class="ui-button ui-button--primary" type="button" data-action="upload-document">＋ İrsaliye Ekle</button>' : ""}${has(CAPABILITIES.documentsUpload) ? '<button class="ui-button ui-button--secondary" type="button" data-action="scan-document">▣ Belgeyi Tara</button>' : ""}${hasSection("trash") || (hasSection("documents") && has(CAPABILITIES.documentsRead)) ? '<button class="ui-button ui-button--secondary" type="button" data-action="document-history"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2"/></svg>Kaldırılan Kayıtlar</button>' : ""}</div></div><div class="doc-secondary-toolbar"><div class="doc-date-range"><label>Başlangıç<input id="document-date-from" type="date" value="${esc(start)}" max="${esc(end)}"></label><span>—</span><label>Bitiş<input id="document-date-to" type="date" value="${esc(end)}" min="${esc(start)}"></label></div><div class="doc-list-caption"><label><input id="documents-missing" type="checkbox" ${missing ? "checked" : ""}> Belgesiz stok girişleri</label><span>${count} ${missing ? "stok girişi" : "belge"}</span></div></div>${count ? `<div class="doc-record-list">${missing ? receipts.map((receipt) => `<article class="doc-record-row doc-record-row--missing"><span class="doc-file-icon" aria-hidden="true">▤</span><div><strong>${esc(depot(receipt))}</strong><small>${esc(receiptNumber(receipt))} · ${(receipt.items || []).length} malzeme</small></div><span>${trDate(receipt.stockAppliedAt)}</span><span class="doc-badge doc-badge--warning">Belge bekleniyor</span>${has(CAPABILITIES.documentsUpload) ? `<button class="ui-button ui-button--secondary" type="button" data-document-receipt="${esc(receipt.id)}">İrsaliye Ekle</button>` : ""}</article>`).join("") : records.map((record) => {
    const receipts = linked(record);
    const pages = record.pages || [{ mimeType: record.mimeType }];
    const scanned=(record.scanItems || []).length;
    return `<button class="doc-record-row" type="button" data-open-document="${esc(record.id)}" aria-label="${esc(title(record))} belgesini incele"><span class="doc-row-preview">${String(pages[0]?.mimeType || record.mimeType).startsWith("image/") ? `<img src="${esc(record.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="doc-file-icon" aria-hidden="true">PDF</span>'}</span><span class="doc-record-name"><strong>${esc(title(record))}</strong><small>${esc(record.documentNumber || "Numara belirtilmedi")} · ${pages.length} dosya</small></span><span class="doc-row-date">${trDate(record.documentDate || record.createdAt)}</span><span class="doc-row-depot">${receipts.length ? `${esc(receipts.map(depot).join(", "))}<small>${receipts.reduce((sum,item) => sum+(item.items || []).length,0)} malzeme</small>` : scanned ? `${scanned} malzeme kaydedildi` : "Stok girişi seçilmedi"}</span><span class="doc-badge ${receipts.length || scanned ? "" : "doc-badge--warning"}">${receipts.length ? "Stok girişi bağlı" : scanned ? "Tarama kaydı" : "Bağlanmadı"}</span><span aria-hidden="true">›</span></button>`;
  }).join("")}</div>` : `<div class="doc-empty"><span aria-hidden="true">▤</span><h3>${missing ? "Belgesiz stok girişi bulunmuyor" : "Belge bulunamadı"}</h3><p>${missing ? "Stoğa işlenmiş mal kabul kayıtlarının belge durumu burada görünür." : "İrsaliyenizi ekleyin veya arama ve tarih filtrelerini değiştirin."}</p></div>`}</section>`;
}

function modal(heading, className = "") {
  const dialog = document.createElement("dialog");
  dialog.className = `fatura-dialog doc-dialog ${className}`;
  dialog.setAttribute("aria-label", heading);
  dialog.innerHTML = `<div class="doc-shell"><header><h2>${esc(heading)}</h2><button class="dialog-close" type="button" data-doc-close aria-label="Kapat">×</button></header><div class="doc-body"></div><p class="doc-message" role="alert"></p><footer></footer></div>`;
  document.body.append(dialog);
  const urls = new Set();
  let busy = false;
  let destroyed = false;
  const abort = new AbortController();
  const message = (text) => { dialog.querySelector(".doc-message").textContent = text || ""; };
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector("[data-doc-close]").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    destroyed = true; abort.abort(); for (const url of urls) URL.revokeObjectURL(url); dialog.remove();
    document.body.classList.toggle("dialog-open", Boolean(document.querySelector("dialog[open]")));
    syncParent();
  }, { once: true });
  dialog.showModal(); document.body.classList.add("dialog-open"); syncParent();
  return { dialog, body: dialog.querySelector(".doc-body"), footer: dialog.querySelector("footer"), message, close, abort,
    get alive() { return !destroyed; },
    get saving() { return busy; },
    busy(value) { busy = value; dialog.setAttribute("aria-busy", String(value)); dialog.querySelectorAll("button,input,select").forEach((node) => { if(value) { node.dataset.docDisabled = String(node.disabled); node.disabled = true; } else { node.disabled = node.dataset.docDisabled === "true"; delete node.dataset.docDisabled; } }); },
    url(blob) { const url = URL.createObjectURL(blob); urls.add(url); return url; }
  };
}

export const createDocumentDialog = modal;

function syncParent() {
  try { window.parent.document.body.classList.toggle("stock-movement-detail-open", Boolean(document.querySelector(".doc-dialog[open],.stock-movement-detail-dialog[open]"))); } catch (_) { /* independent module */ }
}

function listen(ui, action) {
  ui.dialog.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-doc-action]");
    if (!button || button.disabled) return;
    try { await action(button.dataset.docAction, button); } catch (error) { if(ui.alive && error.name !== "AbortError") ui.message(error.message || "İşlem tamamlanamadı."); }
  });
}

export async function camera(onFile) {
  const ui = modal("Fotoğraf Çek", "doc-dialog--camera");
  let stream;
  ui.body.innerHTML = '<video autoplay playsinline muted aria-label="Kamera önizlemesi"></video>';
  ui.footer.innerHTML = '<button class="ui-button ui-button--primary" type="button" data-doc-action="capture" disabled>Fotoğraf Çek</button>';
  ui.dialog.addEventListener("close", () => stream?.getTracks().forEach((track) => track.stop()), { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    if (!ui.alive) { stream.getTracks().forEach((track) => track.stop()); return; }
    const video = ui.body.querySelector("video"); video.srcObject = stream;
    await video.play();
    video.addEventListener("loadeddata", () => { if(ui.alive) ui.footer.querySelector("button").disabled = false; }, { once:true });
    if(video.readyState >= 2) ui.footer.querySelector("button").disabled = false;
    listen(ui, async () => {
      if(!video.videoWidth || !video.videoHeight) return ui.message("Kamera henüz hazır değil.");
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video,0,0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve,"image/jpeg",0.94));
      if(!blob) throw new Error("Fotoğraf oluşturulamadı.");
      onFile(new File([blob], `irsaliye-${Date.now()}.jpg`, { type: "image/jpeg" })); ui.close();
    });
  } catch (_) { ui.message("Kamera açılamadı. Tarayıcı kamera iznini kontrol edin veya Dosya Seç ile fotoğraf yükleyin."); }
}

function chooseReceipt(selectedId, onSelect) {
  const ui = modal("Stok Girişini Seç", "doc-dialog--picker");
  const receipts = (state.shipments || []).filter(eligible).sort((a,b) => String(b.stockAppliedAt).localeCompare(String(a.stockAppliedAt)));
  ui.body.innerHTML = '<input class="doc-picker-search" type="search" placeholder="Depo, malzeme veya mal kabul numarası ara" aria-label="Stok girişi ara"><div class="doc-receipt-options"></div>';
  ui.footer.innerHTML = '<button class="ui-button ui-button--secondary" type="button" data-doc-action="clear">Bağlantıyı Kaldır</button>';
  const render = () => {
    const query = ui.body.querySelector("input").value.trim().toLocaleLowerCase("tr-TR");
    const rows = receipts.filter((receipt) => receiptText(receipt).toLocaleLowerCase("tr-TR").includes(query));
    ui.body.querySelector(".doc-receipt-options").innerHTML = rows.map((receipt) => `<button type="button" class="doc-receipt-option ${receipt.id === selectedId ? "is-selected" : ""}" data-doc-action="select" data-id="${esc(receipt.id)}"><span><strong>${esc(depot(receipt))}</strong><small>${esc(receiptNumber(receipt))} · ${trDate(receipt.stockAppliedAt)}</small><small>${esc((receipt.items || []).map((item) => item.name || item.productName || "Malzeme").join(", "))}</small></span><b>${(receipt.items || []).length} malzeme ›</b></button>`).join("") || '<p class="doc-empty">Uygun mal kabul kaydı bulunamadı.</p>';
  };
  ui.body.querySelector("input").addEventListener("input", render); render();
  listen(ui, (action,button) => { onSelect(action === "clear" ? "" : button.dataset.id); ui.close(); });
}

export function bundle(files, metadata) {
  const header = new TextEncoder().encode(JSON.stringify({ metadata, files: files.map((file) => ({ name: file.name, type: file.type || "application/octet-stream", size: file.size })) }));
  const length = new ArrayBuffer(4); new DataView(length).setUint32(0,header.length);
  return new Blob([length,header,...files],{ type: "application/octet-stream" });
}

export function openDocumentRecordEditor({ shipmentId = "", record = null, onSaved }) {
  const ui = modal(record ? "Belgeyi Düzenle" : "İrsaliye Ekle", "doc-dialog--editor");
  let files = [];
  let selectedId = record?.shipmentIds?.[0] || shipmentId;
  let previewIndex = 0;
  let attempt = "";
  let signature = "";
  const previewUrls = new Map();
  let disposePdf;
  ui.dialog.addEventListener("close", () => disposePdf?.(), {once:true});
  const currentReceipt = () => state.shipments.find((receipt) => receipt.id === selectedId);
  const suggestedTitle = () => `${currentReceipt() ? depot(currentReceipt()) : "İrsaliye"} — ${trDate(localDate()).split(" ")[0]}`;
  ui.body.innerHTML = `<form id="docRecordForm" class="doc-editor-grid"><section class="doc-upload-area"><div class="doc-upload-preview"></div><div class="doc-page-thumbs"></div><div class="doc-file-actions"><button type="button" class="ui-button ui-button--secondary" data-doc-action="camera">▣ Fotoğraf Çek</button><label class="ui-button ui-button--secondary">↑ Dosya Seç<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden></label></div><small>PDF veya fotoğraf · en fazla 10 dosya / toplam 25 MB</small></section><section class="doc-fields"><label>Belge adı<input name="recordTitle" maxlength="180" value="${esc(record ? title(record) : suggestedTitle())}" required></label><div class="doc-fields-pair"><label>İrsaliye tarihi<input name="documentDate" type="date" value="${esc(record?.documentDate || localDate())}" required></label><label>İrsaliye no <small>(isteğe bağlı)</small><input name="documentNumber" maxlength="120" value="${esc(record?.documentNumber || "")}"></label></div><div class="doc-link-heading"><h3>Stok Girişi</h3><button type="button" class="ui-button ui-button--secondary" data-doc-action="receipt">Stok Girişini Seç</button></div><div class="doc-selected-receipt"></div><p class="doc-stock-safety">Belgeyi bağlamak stok miktarını değiştirmez.</p></section></form>`;
  ui.footer.innerHTML = '<button class="ui-button ui-button--secondary" type="button" data-doc-action="cancel">Vazgeç</button><button class="ui-button ui-button--primary" type="submit" form="docRecordForm">Kaydet</button>';
  const form = ui.body.querySelector("form");
  const renderReceipt = () => { ui.body.querySelector(".doc-selected-receipt").innerHTML = currentReceipt() ? receiptItems(currentReceipt()) : '<p class="doc-link-empty">Belgeyi mevcut bir mal kabul kaydına bağlayabilirsiniz.</p>'; };
  const renderPreview = () => {
    disposePdf?.(); disposePdf = null;
    const area = ui.body.querySelector(".doc-upload-preview");
    if(!files.length) { area.innerHTML = record ? '<p>Mevcut dosya korunacak.<br>Yeni dosya seçerseniz önceki sürüm saklanır.</p>' : '<div><span aria-hidden="true">▤</span><strong>İrsaliyenizi ekleyin</strong><small>Dosya seçin veya fotoğraf çekin.</small></div>'; ui.body.querySelector(".doc-page-thumbs").innerHTML = ""; return; }
    const file = files[previewIndex];
    if(!previewUrls.has(file)) previewUrls.set(file,ui.url(file));
    const url = previewUrls.get(file);
    if(file.type === "application/pdf") disposePdf = renderDocumentPdf(area,file,{signal:ui.abort.signal,onError:ui.message});
    else area.innerHTML = `<img src="${esc(url)}" alt="Seçilen irsaliye görseli">`;
    ui.body.querySelector(".doc-page-thumbs").innerHTML = files.map((file,index) => `<span><button type="button" class="${index === previewIndex ? "is-selected" : ""}" data-doc-action="page" data-index="${index}" title="${esc(file.name)}">${index+1}</button><button type="button" data-doc-action="remove" data-index="${index}" aria-label="${index+1}. dosyayı kaldır">×</button></span>`).join("");
  };
  const addFiles = (incoming) => {
    const next = [...files];
    for(const file of incoming) if(!next.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
    if(next.length > 10 || next.reduce((sum,file) => sum+file.size,0) > 25*1024*1024) { ui.message("En fazla 10 dosya, toplam 25 MB yüklenebilir."); return; }
    if(next.some((file) => !file.size || !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name))) { ui.message("PDF, JPEG, PNG, WebP veya HEIC seçin."); return; }
    files = next; previewIndex = Math.max(0,files.length-1); ui.message(""); renderPreview();
  };
  const fileInput = form.querySelector('input[type="file"]');
  fileInput.addEventListener("change", () => { addFiles([...fileInput.files]); fileInput.value = ""; });
  listen(ui, (action,button) => {
    if(action === "cancel") ui.close();
    if(action === "camera") return camera((file) => { if(ui.alive) addFiles([file]); });
    if(action === "receipt") return chooseReceipt(selectedId,(id) => { const before = suggestedTitle(); selectedId = id; if(form.elements.recordTitle.value === before) form.elements.recordTitle.value = suggestedTitle(); renderReceipt(); });
    if(action === "page") previewIndex = Number(button.dataset.index);
    if(action === "remove") { files.splice(Number(button.dataset.index),1); previewIndex = Math.min(previewIndex,files.length-1); }
    if(action === "page" || action === "remove") renderPreview();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); if(ui.saving || !form.reportValidity()) return;
    if(!record && !files.length) return ui.message("İrsaliye dosyasını ekleyin.");
    const metadata = { recordTitle: form.elements.recordTitle.value.trim(), documentDate: form.elements.documentDate.value, documentNumber: form.elements.documentNumber.value.trim(), shipmentIds: selectedId ? [selectedId] : [] };
    const nextSignature = JSON.stringify([metadata,files.map((file) => [file.name,file.size,file.lastModified])]);
    if(signature !== nextSignature) { signature = nextSignature; attempt = requestId(); }
    const send = (allowDuplicate = false) => api(record ? `/documents/${encodeURIComponent(record.id)}/record` : "/document-records", { method: "POST", body: bundle(files,{...metadata,allowDuplicate}), raw: true, headers:{"Content-Type":"application/octet-stream"}, requestId: attempt, expectedRevision: state.revision });
    ui.busy(true); ui.message("Kaydediliyor…");
    try {
      let payload;
      try { payload = await send(); }
      catch(error) {
        if(error.code !== "DOCUMENT_DUPLICATE") throw error;
        ui.busy(false); ui.message(error.message);
        const proceed = await confirmDuplicate();
        if(!proceed || !ui.alive) return;
        ui.busy(true); payload = await send(true);
      }
      ui.busy(false); ui.close(); await onSaved(payload);
    } catch(error) { if(ui.alive) { ui.busy(false); ui.message(error.message); } }
  });
  renderReceipt(); renderPreview();
  return ui;
}

function confirmDuplicate() {
  return new Promise((resolve) => {
    const ui = modal("Dosya zaten kayıtlı", "doc-dialog--picker");
    ui.body.innerHTML = '<p>Bu dosya daha önce kaydedilmiş. Aynı dosyayı ayrı bir belge olarak kaydetmek istiyor musunuz?</p>';
    ui.footer.innerHTML = '<button class="ui-button ui-button--secondary" type="button" data-doc-action="cancel">Vazgeç</button><button class="ui-button ui-button--primary" type="button" data-doc-action="continue">Yine de Kaydet</button>';
    let answered = false;
    listen(ui, (action) => { answered = true; resolve(action === "continue"); ui.close(); });
    ui.dialog.addEventListener("close", () => { if(!answered) resolve(false); });
  });
}

export async function openDocumentRecord(id, { onSaved, onShipment }) {
  const ui = modal("Belge", "doc-dialog--viewer");
  ui.body.innerHTML = '<p class="doc-empty">Belge yükleniyor…</p>';
  try {
    const payload = await api(`/documents/${encodeURIComponent(id)}`,{ dedupe:false, signal:ui.abort.signal });
    if(!ui.alive) return;
    const record = payload.document;
    let page = 0; let zoom = 100; let version = ""; let sequence = 0;
    ui.dialog.querySelector("h2").textContent = title(record);
    ui.body.innerHTML = `<div class="doc-viewer-grid"><section class="doc-paper-view"><div class="doc-view-controls"><button type="button" data-doc-action="previous" aria-label="Önceki dosya">‹</button><span class="doc-page-counter"></span><button type="button" data-doc-action="next" aria-label="Sonraki dosya">›</button><span class="doc-controls-space"></span><button type="button" data-doc-action="out" aria-label="Küçült">−</button><button type="button" data-doc-action="reset" class="doc-zoom-label">100%</button><button type="button" data-doc-action="in" aria-label="Büyüt">＋</button></div><div class="doc-paper-stage"></div></section><aside class="doc-metadata"><h3>Belge Bilgileri</h3><dl><div><dt>İrsaliye tarihi</dt><dd>${trDate(record.documentDate || record.createdAt)}</dd></div><div><dt>İrsaliye no</dt><dd>${esc(record.documentNumber || "—")}</dd></div><div><dt>Kayıt tarihi</dt><dd>${trDate(record.createdAt)}</dd></div></dl><h3>Bağlı Stok Girişi</h3>${linked(record).map(receiptItems).join("") || '<p>Stok girişi bağlanmadı.</p>'}${linked(record).map((receipt) => `<button class="ui-button ui-button--secondary" type="button" data-doc-action="receipt-view" data-id="${esc(receipt.id)}">Stok Girişini Gör</button>`).join("")}${record.scanItems?.length ? `<h3>Kaydedilen Malzemeler</h3><div class="doc-saved-scan-items">${record.scanItems.map(item => `<div><span>${esc(item.name)}<small>${esc(item.code)}</small></span><b>${number(item.quantity)}</b></div>`).join("")}</div>` : ""}${record.versions.length ? `<details class="doc-history"><summary>Değişiklik Geçmişi</summary><button type="button" data-doc-action="version" data-version="">Güncel belge</button>${record.versions.map((item) => `<button type="button" data-doc-action="version" data-version="${item.index}">${trDate(item.changedAt)} · ${esc(item.changedByName)}<small>${esc(item.recordTitle)}</small></button>`).reverse().join("")}</details>` : ""}</aside></div>`;
    ui.footer.innerHTML = `${has(CAPABILITIES.documentsUpload) ? '<button type="button" class="ui-button ui-button--secondary" data-doc-action="edit">Düzenle</button>' : ""}${record.scanItems?.length ? '<button type="button" class="ui-button ui-button--secondary" data-doc-action="scan-items">Malzemeler / Excel</button>' : ""}${has(CAPABILITIES.documentsArchive) ? '<details class="doc-more"><summary aria-label="Diğer işlemler">⋯</summary><button type="button" data-doc-action="delete">Belgeyi Sil</button></details>' : ""}<span class="doc-controls-space"></span><button type="button" class="ui-button ui-button--secondary" data-doc-action="print">Yazdır</button><a class="ui-button ui-button--primary doc-download" download>İndir</a>`;
    const stage = ui.body.querySelector(".doc-paper-stage");
    const cache = new Map();
    let disposePdf;
    ui.dialog.addEventListener("close", () => disposePdf?.(), {once:true});
    const pages = () => version === "" ? record.pages : record.versions[Number(version)].pages;
    let current;
    const applyZoom = () => { const image = stage.querySelector("img"); if(image) image.style.width = `${zoom}%`; ui.body.querySelector(".doc-zoom-label").textContent = `${zoom}%`; };
    const showPage = async () => {
      const run = ++sequence;
      disposePdf?.(); disposePdf = null;
      ui.message(""); ui.body.querySelector(".doc-page-counter").textContent = `${page+1} / ${pages().length} dosya${version !== "" ? " · önceki sürüm" : ""}`;
      ui.body.querySelector('[data-doc-action="previous"]').disabled = page === 0;
      ui.body.querySelector('[data-doc-action="next"]').disabled = page === pages().length-1;
      ui.footer.querySelectorAll("[data-doc-action='print'],.doc-download").forEach((node) => { node.setAttribute("aria-disabled","true"); if(node.tagName === "BUTTON") node.disabled = true; else node.removeAttribute("href"); });
      stage.innerHTML = '<p class="doc-empty">Dosya yükleniyor…</p>';
      const key = `${version}:${page}`;
      if(!cache.has(key)) {
        const blob = await api(`/documents/${encodeURIComponent(id)}/content?page=${page}${version !== "" ? `&version=${version}` : ""}`,{ responseType:"blob",dedupe:false,signal:ui.abort.signal });
        if(!ui.alive) return;
        cache.set(key,{ url: ui.url(blob), type: blob.type, blob });
      }
      if(!ui.alive || run !== sequence) return;
      current = {...cache.get(key), fileName: pages()[page].originalName || "belge", page};
      const pdf = current.type === "application/pdf";
      if(pdf) disposePdf = renderDocumentPdf(stage,current.blob,{signal:ui.abort.signal,onError:ui.message});
      else stage.innerHTML = `<img src="${esc(current.url)}" alt="${esc(title(record))} — ${page+1}. dosya">`;
      ui.body.querySelectorAll('[data-doc-action="in"],[data-doc-action="out"],[data-doc-action="reset"]').forEach((button) => { button.disabled = pdf; button.hidden = pdf; });
      ui.body.querySelector(".doc-view-controls").hidden = pdf && pages().length === 1;
      applyZoom();
      const download = ui.footer.querySelector(".doc-download"); download.href = current.url; download.download = current.fileName; download.removeAttribute("aria-disabled");
      const print = ui.footer.querySelector('[data-doc-action="print"]'); print.disabled = false; print.removeAttribute("aria-disabled");
    };
    listen(ui, async (action,button) => {
      if(action === "previous" || action === "next") { page += action === "next" ? 1 : -1; zoom = 100; await showPage(); }
      if(action === "in" || action === "out" || action === "reset") { zoom = action === "reset" ? 100 : Math.min(300,Math.max(50,zoom+(action === "in" ? 25 : -25))); applyZoom(); }
      if(action === "version") { version = button.dataset.version; page = 0; zoom = 100; await showPage(); }
      if(action === "receipt-view") { ui.close(); await onShipment(button.dataset.id); }
      if(action === "scan-items") { ui.close(); const { openDocumentScan } = await import("./document-scan.js?v=20261009-scan-v2"); await openDocumentScan({record,onSaved}); }
      if(action === "edit") { ui.close(); openDocumentRecordEditor({record,onSaved}); }
      if(action === "print") {
        const preview = window.open(current.url,"_blank");
        if(!preview) return ui.message("Yazdırma için açılır pencereye izin verin veya dosyayı indirin.");
        if(current.type !== "application/pdf") preview.addEventListener("load", () => { preview.focus(); preview.print(); },{ once:true });
        else ui.message("PDF açıldı; PDF araç çubuğundaki yazdır simgesini kullanın.");
      }
      if(action === "delete") {
        const confirm = await confirmDelete();
        if(!confirm || !ui.alive) return;
        ui.busy(true);
        try {
          const result = await api(`/documents/${encodeURIComponent(id)}/archive`,{ method:"POST",body:{reason:"Belgeler ekranında kullanıcı tarafından silindi"},expectedRevision:state.revision });
          ui.busy(false); ui.close(); await onSaved(result); offerUndo(id,onSaved);
        } catch(error) { ui.busy(false); throw error; }
      }
    });
    await showPage();
  } catch(error) { if(ui.alive) ui.message(error.message); }
}

function confirmDelete() {
  return new Promise((resolve) => {
    const ui = modal("Belgeyi Sil", "doc-dialog--picker");
    ui.body.innerHTML = '<p>Belge listeden kaldırılacak. Stok ve mal kabul kaydı değişmez; dosya ve eski sürümleri güvenli depoda korunur.</p>';
    ui.footer.innerHTML = '<button type="button" class="ui-button ui-button--secondary" data-doc-action="cancel">Vazgeç</button><button type="button" class="ui-button ui-button--danger" data-doc-action="confirm">Sil</button>';
    let answered = false;
    listen(ui,(action) => { answered = true; resolve(action === "confirm"); ui.close(); });
    ui.dialog.addEventListener("close", () => { if(!answered) resolve(false); });
  });
}

function offerUndo(id,onSaved) {
  const ui = modal("Belge silindi", "doc-dialog--picker");
  ui.body.innerHTML = '<p>Belge listeden kaldırıldı. Yanlışlıkla sildiyseniz geri alabilirsiniz.</p>';
  ui.footer.innerHTML = '<button type="button" class="ui-button ui-button--secondary" data-doc-action="close">Kapat</button><button type="button" class="ui-button ui-button--primary" data-doc-action="restore">Silme İşlemini Geri Al</button>';
  listen(ui, async (action) => {
    if(action === "close") return ui.close();
    ui.busy(true);
    try { const result = await api(`/documents/${encodeURIComponent(id)}/restore`,{method:"POST",body:{},expectedRevision:state.revision}); ui.busy(false); ui.close(); await onSaved(result); }
    catch(error) { ui.busy(false); throw error; }
  });
}
