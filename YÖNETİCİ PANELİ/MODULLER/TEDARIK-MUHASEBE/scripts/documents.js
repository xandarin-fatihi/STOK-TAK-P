import { documentUploadPicker } from "./ui-dialogs.js?v=20260920-notification-center-v1";
import { renderDocumentRecords } from "./document-records.js?v=20261009-scan-v2&fixes=20261011-v2";
import { api } from "./api.js?v=20260920-notification-center-v1";
import { shipmentFinance } from "./accounting.js?v=20261001-integrated-tabs-v1";
import { CAPABILITIES, has, escapeHtml, financeValues, paymentStatusLabel, state, statusBadge, trDate, trMoney } from "./state.js?v=20261005-storage-placement-v1";
import {
  buildShipmentPdfBlob,
  createPrintPaletteSnapshot,
  prepareShipmentEvidenceImage,
  resolveShipmentNumber,
  shipmentPdfFileName
} from "./shipment-pdf.mjs?v=20260927-shipment-number-theme-pdf-v2";

export function renderDocuments() {
  if (state.activeView === "shipmentArchive") return renderShipmentArchive();
  if (state.activeView === "documents") return renderDocumentRecords();
  const query = String(state.filters.documents || "").trim().toLocaleLowerCase("tr-TR");
  const supplierId = String(state.filters.documentsSupplier || "");
  const selectedDate = String(state.filters.documentsDate || "");
  const view = String(state.activeView || "documents");
  const emptyTitles = {
    documents: "Belge kaydı bulunamadı",
    invoices: "Fatura kaydı bulunamadı",
    deliveryNotes: "İrsaliye kaydı bulunamadı",
    documentImages: "Belge görseli bulunamadı"
  };
  const documents = [...(state.documents || [])]
    .filter((document) => {
      if (view === "invoices" && document.documentType !== "fatura") return false;
      if (view === "deliveryNotes" && document.documentType !== "irsaliye") return false;
      if (view === "documentImages" && !String(document.mimeType || "").toLowerCase().startsWith("image/")) return false;
      if (supplierId && String(document.supplierId || "") !== supplierId) return false;
      if (selectedDate && documentDateKey(document) !== selectedDate) return false;
      const supplier = supplierName(document.supplierId);
      const haystack = `${document.documentNumber || ""} ${document.originalName || ""} ${document.documentType || ""} ${supplier}`.toLocaleLowerCase("tr-TR");
      return !query || haystack.includes(query);
    })
    .sort((left, right) => documentTimestamp(right) - documentTimestamp(left));
  const supplierOptions = activeSupplierOptions(supplierId);
  const uploadAction = view === "documents" && has(CAPABILITIES.documentsUpload)
    ? '<button class="ui-button ui-button--primary" type="button" data-action="upload-document">Belge yükle</button>'
    : "";
  return `<div class="section-toolbar"><div class="filters"><input class="toolbar-control" id="document-search" type="search" value="${escapeHtml(state.filters.documents || "")}" placeholder="Belge no, dosya veya tedarikçi ara"><select class="toolbar-control" id="archive-supplier-filter"><option value="">Tüm tedarikçiler</option>${supplierOptions}</select><input class="toolbar-control" id="archive-date-filter" type="date" value="${escapeHtml(selectedDate)}" aria-label="Belge tarihi"></div><div class="toolbar-actions">${uploadAction}</div></div><p class="result-meta">${documents.length} belge kaydı · en yeni kayıt üstte.</p>${documents.length ? `<div class="document-grid">${documents.map(documentCard).join("")}</div>` : empty(emptyTitles[view] || emptyTitles.documents, "Seçilen filtrelerle eşleşen kayıt bulunmuyor.")}`;
}

function renderShipmentArchive() {
  const supplierId = String(state.filters.documentsSupplier || "");
  const selectedDate = String(state.filters.documentsDate || "");
  const shipments = [...(state.shipments || [])]
    .filter((shipment) => shipment.status !== "taslak")
    .filter((shipment) => !supplierId || shipmentSupplierId(shipment) === supplierId)
    .filter((shipment) => !selectedDate || shipmentDateKey(shipment) === selectedDate)
    .sort((left, right) => shipmentTimestamp(right) - shipmentTimestamp(left));
  const supplierOptions = activeSupplierOptions(supplierId);
  return `<div class="section-toolbar shipment-archive-toolbar"><div class="filters shipment-archive-filters"><label><span>Tedarikçi</span><select class="toolbar-control" id="archive-supplier-filter"><option value="">Tedarikçi ara</option>${supplierOptions}</select></label><label><span>Tarih</span><input class="toolbar-control" id="archive-date-filter" type="date" value="${escapeHtml(selectedDate)}"></label></div></div><p class="result-meta">${shipments.length} sevkiyat kaydı · en yeni kayıt üstte.</p>${shipments.length ? `<div class="shipment-archive-list">${shipments.map(archiveRow).join("")}</div>` : empty("Sevkiyat arşivi boş", "Seçilen filtrelerle eşleşen sevkiyat bulunmuyor.")}`;
}

function activeSupplierOptions(selectedId) {
  return (state.suppliers || [])
    .filter((supplier) => supplier.active !== false)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "tr"))
    .map((supplier) => `<option value="${escapeHtml(supplier.id)}" ${String(supplier.id) === selectedId ? "selected" : ""}>${escapeHtml(supplier.name)}</option>`)
    .join("");
}

function documentCard(document) {
  const image = String(document.mimeType || "").toLowerCase().startsWith("image/");
  const previewUrl = String(document.thumbnailUrl || `/api/procurement/v1/documents/${encodeURIComponent(document.id)}/content?thumbnail=1`);
  const title = document.documentNumber || document.originalName || "Belge";
  const supplier = supplierName(document.supplierId);
  const preview = image
    ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(title)} önizlemesi" loading="lazy">`
    : `<span>${escapeHtml(documentTypeLabel(document.documentType))}<br>${escapeHtml(formatBytes(document.sizeBytes))}</span>`;
  return `<article class="document-card"><div class="document-preview">${preview}</div><div class="document-body"><h3 title="${escapeHtml(title)}">${escapeHtml(title)}</h3><p>${escapeHtml(documentTypeLabel(document.documentType))} · ${escapeHtml(supplier)}<br>${trDate(document.documentDate || document.createdAt)} · ${escapeHtml(formatBytes(document.sizeBytes))}</p><button class="row-button" type="button" data-open-document="${escapeHtml(document.id)}">Görüntüle</button></div></article>`;
}

function supplierName(supplierId) {
  return (state.suppliers || []).find((supplier) => String(supplier.id) === String(supplierId || ""))?.name || "Tedarikçi belirtilmedi";
}

function documentDateKey(document) {
  return String(document.documentDate || document.createdAt || "").slice(0, 10);
}

function documentTimestamp(document) {
  const value = document.documentDate || document.createdAt || "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function documentTypeLabel(value) {
  return ({ fatura: "Fatura", irsaliye: "İrsaliye", "fiş": "Fiş", makbuz: "Makbuz", "diğer": "Diğer" })[String(value || "")] || "Belge";
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
}

export function documentFormBody(defaultShipmentId = "") {
  return `<div class="form-grid">${documentUploadPicker("file", "Belge Dosyası")}<label>Belge türü<select name="documentType" required><option value="fatura">Fatura</option><option value="irsaliye">İrsaliye</option><option value="fiş">Fiş</option><option value="makbuz">Makbuz</option><option value="diğer">Diğer</option></select></label><label>Tedarikçi<select name="supplierId"><option value="">Seçilmedi</option>${state.suppliers.filter((item) => item.active !== false).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Belge no<input name="documentNumber" maxlength="120"></label><label>Belge tarihi<input name="documentDate" type="date"></label><label class="span-2">Sevkiyat<select name="shipmentId"><option value="">Bağımsız belge</option>${state.shipments.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === defaultShipmentId ? "selected" : ""}>${escapeHtml(resolveShipmentNumber(item))} · ${escapeHtml(item.supplier?.name || "Tedarikçi belirtilmedi")} · ${trDate(item.createdAt)}</option>`).join("")}</select></label></div>`;
}

function archiveRow(shipment) {
  const date = shipmentDate(shipment);
  return `<article class="shipment-archive-row"><div class="shipment-archive-row__main"><strong>${escapeHtml(resolveShipmentNumber(shipment))} · ${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")}</strong><span>${escapeHtml(numericDate(date))} · ${(shipment.items || []).length} ürün kalemi · ${shipment.pricesVisible !== false ? trMoney(shipmentTotal(shipment)) + " · " : ""}${escapeHtml(stockStateText(shipment))}</span><span>${statusBadge(shipment.status)} · Cari: ${escapeHtml(accountingStateText(shipment))}</span>${shipment.accountingStatus !== "not_required" && shipment.financial ? financeValues(shipment.financial) : ""}</div><div class="shipment-archive-row__actions"><button class="row-button" type="button" data-open-shipment="${escapeHtml(shipment.id)}">Görüntüle</button>${shipment.canRemove ? `<button class="row-button danger" type="button" data-remove-shipment="${escapeHtml(shipment.id)}">Çöp Kutusu</button>` : ""}</div></article>`;
}

export function renderSupplierShipmentHistory(shipments) {
  return shipments.length ? `<div class="shipment-archive-list">${shipments.map(archiveRow).join("")}</div>`
    : empty("Sevkiyat bulunmuyor", "Bu tedarikçinin görünür aktif sevkiyatı yok.");
}

function shipmentApprovalPanel(shipment) {
  const canApprove = shipment.canApprove === true;
  const canReject = shipment.canReject === true;
  if (!canApprove && !canReject) return "";
  const locations = Array.isArray(state.context?.stockLocations) ? state.context.stockLocations : [];
  const requestedLocationId = String(shipment.destinationLocationId || "");
  const selectedLocationId = locations.some((location) => String(location.id) === requestedLocationId) ? requestedLocationId : "";
  const destinationField = canApprove ? `<label class="shipment-approval-panel__location" for="shipmentDestinationLocation"><span>Hedef depo</span><select id="shipmentDestinationLocation" required aria-required="true" aria-describedby="shipmentApprovalHelp"><option value="" ${selectedLocationId ? "" : "selected"} disabled>Hedef depo seçin</option>${locations.map((location) => `<option value="${escapeHtml(location.id)}" ${String(location.id) === selectedLocationId ? "selected" : ""}>${escapeHtml(location.name)}</option>`).join("")}</select></label>` : "";
  const helpText = canApprove
    ? locations.length
      ? "Personelin bildirdiği ürün ve miktarları kontrol edin; onaylamadan önce stoğun işleneceği depoyu seçin."
      : "Onay verebilmek için önce kullanılabilir bir stok deposu tanımlanmalıdır."
    : "Personelin bildirdiği ürün ve miktarları kontrol ederek sevkiyatı reddedebilirsiniz.";
  return `<section class="shipment-approval-panel" aria-labelledby="shipmentApprovalTitle"><div class="shipment-approval-panel__heading"><span class="shipment-approval-panel__icon" aria-hidden="true">!</span><div><small>PERSONEL SEVKİYATI</small><h3 id="shipmentApprovalTitle">Yönetici kararı bekleniyor</h3><p id="shipmentApprovalHelp">${escapeHtml(helpText)}</p></div></div><div class="shipment-approval-panel__controls">${destinationField}<div class="shipment-approval-panel__actions">${canApprove ? `<button class="ui-button ui-button--primary" type="button" data-detail-action="approve-stock" aria-describedby="shipmentApprovalHelp" ${locations.length ? "" : 'disabled aria-disabled="true"'}>Onayla ve Stoğa Ekle</button>` : ""}${canReject ? '<button class="ui-button ui-button--danger" type="button" data-detail-action="reject-shipment" aria-describedby="shipmentApprovalHelp">Sevkiyatı Reddet</button>' : ""}</div></div></section>`;
}

export function shipmentArchiveDetail(shipment, documents = []) {
  const rows = Array.isArray(shipment.items) ? shipment.items : [];
  const total = shipmentTotal(shipment);
  const evidence = documents.find((item) => item && !item.archivedAt);
  const stockState = stockStateText(shipment);
  const destination = shipment.destinationLocationName || shipment.destinationWarehouseName || shipment.destinationLocation?.name || "Stoğa işlenmedi";
  const accountingState = accountingStateText(shipment, total);
  const approvalPanel = shipmentApprovalPanel(shipment);
  return `<section class="shipment-receipt-detail"><div class="shipment-receipt-toolbar"><div><small>SEVKİYAT FİŞİ · ${escapeHtml(resolveShipmentNumber(shipment))}</small><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")} - ${escapeHtml(numericDate(shipmentDate(shipment)))}</strong></div><button class="ui-button ui-button--primary" type="button" data-print-shipment="${escapeHtml(shipment.id)}" aria-label="${escapeHtml(resolveShipmentNumber(shipment))} sevkiyat fişini PDF olarak indir">İndir</button></div>${approvalPanel}<div class="shipment-impact-summary"><div><small>STOK</small><strong>${escapeHtml(destination)} · ${escapeHtml(stockState)}</strong></div><div><small>CARİ</small><strong>${escapeHtml(accountingState)}</strong></div><div><small>BELGE</small><strong>${evidence ? "Mevcut" : "Bulunmuyor"}</strong></div></div>${shipmentFinance(shipment)}<div class="shipment-receipt-meta"><div><small>SEVKİYAT NO</small><strong>${escapeHtml(resolveShipmentNumber(shipment))}</strong></div><div><small>TEDARİKÇİ</small><strong>${escapeHtml(shipment.supplier?.name || "Tedarikçi belirtilmedi")}</strong></div><div><small>SEVKİYAT TARİHİ</small><strong>${trDate(shipmentDate(shipment))}</strong></div><div><small>HEDEF DEPO</small><strong>${escapeHtml(destination)}</strong></div></div><div class="shipment-receipt-lines">${rows.map((item) => shipmentLine(item, stockState, shipment.pricesVisible !== false)).join("") || '<p>Ürün satırı bulunmuyor.</p>'}</div>${shipment.pricesVisible !== false ? `<footer><span>GENEL TOPLAM</span><strong>${trMoney(total)}</strong></footer>` : ""}<div class="detail-actions detail-actions--spaced">${has(CAPABILITIES.documentsUpload) ? '<button class="ui-button ui-button--secondary" type="button" data-detail-action="upload-shipment-document">İrsaliye Ekle</button>' : ""}${evidence ? `<button class="ui-button ui-button--secondary" type="button" data-open-document="${escapeHtml(evidence.id)}">Belgeyi Görüntüle</button>` : ""}${shipment.canAccountWithoutStock ? '<button class="ui-button ui-button--secondary" type="button" data-detail-action="account-without-stock">Cari Hesaba İşle</button>' : ""}${shipment.canRemove ? '<button class="ui-button ui-button--danger" type="button" data-detail-action="remove-shipment">Çöp Kutusu</button>' : ""}</div></section>`;
}

function shipmentQuantityText(item) {
  const bulkUnit = item.bulkUnitSnapshot || item.bulkUnit || item.purchaseUnit || item.unit || "";
  if (item.quantityBase === undefined || item.quantityBase === null) return `${formatNumber(Number(item.quantityBulk ?? item.quantity ?? 0))} ${bulkUnit}`.trim();
  const bulk = Number(item.quantityBulk || 0);
  const base = Number(item.quantityBase || 0);
  const baseUnit = item.baseUnitSnapshot || item.baseUnit || item.unit || "";
  return [bulk > 0 ? `${formatNumber(bulk)} ${bulkUnit}`.trim() : "", base > 0 ? `${formatNumber(base)} ${baseUnit}`.trim() : ""].filter(Boolean).join(" + ") || `0 ${baseUnit}`.trim();
}

function shipmentLine(item, stockState, pricesVisible = true) {
  const quantity = Number(item.quantityBulk ?? item.quantity ?? 0);
  const total = Number(item.totalKurus || item.lineTotalKurus || 0);
  const unitPrice = Number(item.unitPriceKurus || (quantity > 0 ? Math.round(total / quantity) : 0));
  const status = item.stockMatchStatus === "unit_mismatch" ? "Birim eşleşmedi" : item.stockMatchStatus === "unmatched" ? "Stokla eşleşmedi" : stockState;
  return `<article><div class="shipment-receipt-line__product"><strong>${escapeHtml(item.name || item.productName || "Ürün")}</strong><small>${escapeHtml(status)}</small></div><div class="shipment-receipt-line__value"><small>MİKTAR</small><span>${escapeHtml(shipmentQuantityText(item))}</span></div><div class="shipment-receipt-line__value"><small>FİYAT</small><span>${pricesVisible ? trMoney(unitPrice) : "—"}</span></div><div class="shipment-receipt-line__value shipment-receipt-line__total"><small>TOPLAM</small><b>${pricesVisible ? trMoney(total) : "—"}</b></div></article>`;
}

export async function printShipmentArchive(shipmentId) {
  const payload = await api(`/shipments/${encodeURIComponent(shipmentId)}`, { dedupe: false });
  const shipment = payload.shipment || {};
  const palette = createPrintPaletteSnapshot();
  const evidence = (payload.documents || []).find((item) => item && !item.archivedAt);
  let evidenceImage = null;
  if (evidence) {
    try {
      const blob = await fetchOptionalEvidence(evidence.id);
      evidenceImage = await prepareShipmentEvidenceImage(blob, 15000);
    } catch (_error) {
      // Fiş, ek belge erişilemese de indirilebilir kalır.
    }
  }
  const generated = await buildShipmentPdfBlob(shipment, {
    palette,
    evidence: evidenceImage,
    evidenceMeta: evidence || {}
  });
  const fileName = shipmentPdfFileName(shipment);
  const url = URL.createObjectURL(generated.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  const result = {
    fileName,
    byteLength: generated.blob.size,
    pageCount: generated.pageCount,
    shipmentNumber: generated.shipmentNumber
  };
  document.dispatchEvent(new CustomEvent("muhasebe:shipment-pdf-ready", { detail: result }));
  return result;
}

async function fetchOptionalEvidence(documentId, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await api(`/documents/${encodeURIComponent(documentId)}/content`, {
      responseType: "blob", dedupe: false, signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function renderReceiptPages(shipment) {
  const items = Array.isArray(shipment.items) ? shipment.items : [];
  const chunks = [];
  for (let index = 0; index < Math.max(items.length, 1); index += 12) chunks.push(items.slice(index, index + 12));
  const total = shipmentTotal(shipment);
  return chunks.map((rows, pageIndex) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1240;
    canvas.height = 1754;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fffdf9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#d9c6b4";
    context.lineWidth = 3;
    roundRect(context, 54, 54, 1132, 1646, 24); context.stroke();
    context.fillStyle = "#6b351f"; context.font = "700 24px Poppins, Arial"; context.fillText("MUHASEBE", 96, 120);
    context.fillStyle = "#32190e"; context.font = "700 52px Poppins, Arial"; context.fillText(pageIndex ? `Sevkiyat Fişi · ${pageIndex + 1}` : "Sevkiyat Fişi", 96, 184);
    context.textAlign = "right"; context.font = "700 24px Poppins, Arial"; context.fillText(fitText(context, shipment.supplier?.name || "Tedarikçi belirtilmedi", 430), 1142, 148); context.textAlign = "left";
    context.strokeStyle = "#6b351f"; context.lineWidth = 4; context.beginPath(); context.moveTo(96, 222); context.lineTo(1144, 222); context.stroke();
    drawMetaBox(context, 96, 260, 324, "TARİH", trDate(shipmentDate(shipment), true));
    drawMetaBox(context, 446, 260, 324, "SEVKİYAT NO", shipment.id || "—");
    drawMetaBox(context, 796, 260, 348, "HEDEF DEPO", shipment.destinationLocationName || shipment.destinationWarehouseName || "Stoğa işlenmedi");
    drawTableHeader(context, 96, 406);
    let y = 468;
    rows.forEach((item) => { drawReceiptRow(context, item, y); y += 78; });
    if (!rows.length) { context.fillStyle = "#7e695b"; context.font = "400 22px Poppins, Arial"; context.fillText("Ürün satırı bulunmuyor.", 116, y + 38); }
    if (pageIndex === chunks.length - 1) {
      const totalY = Math.max(y + 30, 1460);
      context.fillStyle = "#6b351f"; roundRect(context, 760, totalY, 384, 92, 14); context.fill();
      context.fillStyle = "#fff"; context.font = "600 18px Poppins, Arial"; context.fillText("GENEL TOPLAM", 790, totalY + 40);
      context.textAlign = "right"; context.font = "700 28px Poppins, Arial"; context.fillText(trMoney(total), 1114, totalY + 43); context.textAlign = "left";
    }
    context.fillStyle = "#9a8474"; context.font = "400 16px Poppins, Arial"; context.fillText(`Muhasebe · ${pageIndex + 1}/${chunks.length}`, 96, 1650);
    return canvas;
  });
}

function drawMetaBox(context, x, y, width, label, value) {
  context.fillStyle = "#f7f0e7"; roundRect(context, x, y, width, 104, 12); context.fill();
  context.fillStyle = "#7e695b"; context.font = "600 15px Poppins, Arial"; context.fillText(label, x + 20, y + 33);
  context.fillStyle = "#32190e"; context.font = "700 19px Poppins, Arial"; context.fillText(fitText(context, value, width - 40), x + 20, y + 72);
}

function drawTableHeader(context, x, y) {
  context.fillStyle = "#6b351f"; roundRect(context, x, y, 1048, 54, 10); context.fill();
  context.fillStyle = "#fff"; context.font = "600 17px Poppins, Arial";
  context.fillText("ÜRÜN", x + 18, y + 34); context.fillText("MİKTAR", x + 520, y + 34); context.fillText("BİRİM FİYAT", x + 716, y + 34); context.fillText("TOPLAM", x + 912, y + 34);
}

function drawReceiptRow(context, item, y) {
  const quantity = Number(item.quantityBulk ?? item.quantity ?? 0);
  const total = Number(item.totalKurus || item.lineTotalKurus || 0);
  const unitPrice = Number(item.unitPriceKurus || (quantity > 0 ? Math.round(total / quantity) : 0));
  context.fillStyle = "#fff"; context.strokeStyle = "#e4d6c8"; context.lineWidth = 2; roundRect(context, 96, y, 1048, 66, 9); context.fill(); context.stroke();
  context.fillStyle = "#32190e"; context.font = "600 19px Poppins, Arial"; context.fillText(fitText(context, item.name || item.productName || "Ürün", 460), 114, y + 41);
  context.font = "400 18px Poppins, Arial"; context.fillText(shipmentQuantityText(item), 616, y + 41, 184); context.fillText(trMoney(unitPrice), 812, y + 41);
  context.font = "700 18px Poppins, Arial"; context.fillText(trMoney(total), 1008, y + 41);
}

async function renderEvidencePage(blob, evidence) {
  if (!String(blob && blob.type || "").toLocaleLowerCase("tr-TR").startsWith("image/")) return null;
  const canvas = document.createElement("canvas"); canvas.width = 1240; canvas.height = 1754;
  const context = canvas.getContext("2d");
  let bitmap;
  try { bitmap = await createImageBitmap(blob); } catch (_error) { return null; }
  context.fillStyle = "#fffdf9"; context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#d9c6b4"; context.lineWidth = 3; roundRect(context, 54, 54, 1132, 1646, 24); context.stroke();
  context.fillStyle = "#32190e"; context.font = "700 34px Poppins, Arial"; context.fillText(String(evidence.documentType || "Sevkiyat Belgesi"), 92, 126);
  const maxWidth = 1056, maxHeight = 1460, scale = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height), width = bitmap.width * scale, height = bitmap.height * scale;
  context.drawImage(bitmap, (canvas.width - width) / 2, 170 + (maxHeight - height) / 2, width, height); bitmap.close?.();
  return canvas;
}

async function canvasesToPdf(canvases) {
  if (!Array.isArray(canvases) || !canvases.length) throw new Error("PDF için sayfa oluşturulamadı.");
  const images = await Promise.all(canvases.map((canvas) => canvasToJpeg(canvas)));
  const encoder = new TextEncoder(), chunks = [], offsets = [0]; let length = 0;
  const push = (value) => { const bytes = typeof value === "string" ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length; };
  push("%PDF-1.4\n"); push(new Uint8Array([37, 226, 227, 207, 211, 10]));
  const kids = images.map((_image, index) => `${3 + index * 3} 0 R`).join(" ");
  const objects = new Map([[1, "<< /Type /Catalog /Pages 2 0 R >>"], [2, `<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`]]);
  images.forEach((image, index) => {
    const pageId = 3 + index * 3, contentId = pageId + 1, imageId = pageId + 2, content = "q 595.28 0 0 841.89 0 0 cm /Im0 Do Q";
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.set(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`); objects.set(imageId, image);
  });
  const objectCount = 2 + images.length * 3;
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = length; push(`${id} 0 obj\n`); const body = objects.get(id);
    if (body && body.bytes) { push(`<< /Type /XObject /Subtype /Image /Width ${body.width} /Height ${body.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${body.bytes.length} >>\nstream\n`); push(body.bytes); push("\nendstream"); }
    else push(body || "<<>>");
    push("\nendobj\n");
  }
  const xrefOffset = length; push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= objectCount; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}

function canvasToJpeg(canvas, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("PDF sayfası zamanında hazırlanamadı.")), timeoutMs);
    canvas.toBlob(async (blob) => {
      clearTimeout(timeout);
      if (!blob) return reject(new Error("PDF çıktısı hazırlanamadı."));
      try {
        resolve({ bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
      } catch (_error) {
        reject(new Error("PDF sayfası okunamadı."));
      }
    }, "image/jpeg", 0.92);
  });
}

function roundRect(context, x, y, width, height, radius) { context.beginPath(); context.roundRect(x, y, width, height, radius); }
function fitText(context, value, maxWidth) { const text = String(value || "—"); if (context.measureText(text).width <= maxWidth) return text; let fitted = text; while (fitted.length > 1 && context.measureText(`${fitted}…`).width > maxWidth) fitted = fitted.slice(0, -1); return `${fitted}…`; }
function shipmentTotal(shipment) { return (shipment.items || []).reduce((sum, item) => sum + Number(item.totalKurus || item.lineTotalKurus || 0), 0); }
function shipmentDate(shipment) { return shipment.shipmentDate || shipment.documentDate || shipment.createdAt || ""; }
function shipmentDateKey(shipment) { const value = String(shipmentDate(shipment)); return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : toDateKey(value); }
function shipmentTimestamp(shipment) { const time = new Date(shipmentDate(shipment)).getTime(); return Number.isFinite(time) ? time : 0; }
function shipmentSupplierId(shipment) { return String(shipment.supplierId || shipment.supplier?.id || ""); }
function stockStateText(shipment) {
  const items = shipment.items || [], unmatched = Number(shipment.stockUnmatchedItemCount || items.filter((item) => item.stockMatchStatus === "unmatched").length || 0), mismatched = Number(shipment.stockUnitMismatchItemCount || items.filter((item) => item.stockMatchStatus === "unit_mismatch").length || 0);
  if (shipment.stockStatus === "reversed") return "Stok geri alındı";
  if (shipment.stockStatus === "failed") return "Stok aktarımı başarısız";
  if (shipment.stockDecision === "declined" || shipment.stockStatus === "not_applied") return "Stoğa aktarılmadı";
  if (shipment.stockAppliedAt) return unmatched || mismatched ? "Eşleşenler stoğa işlendi" : "Stoğa işlendi";
  if (mismatched) return "Birim eşleşmedi";
  if (unmatched) return "Stokla eşleşmedi";
  if (shipment.status === "reddedildi") return "Stok etkisi yok";
  return "Stoğa aktarılmadı";
}
function accountingStateText(shipment){if(shipment.accountingStatus==="not_required")return "Cari işlem gerekmiyor";if(shipment.financial)return paymentStatusLabel(shipment.financial.paymentStatus);if(shipment.accountingStatus==="posted")return "Muhasebeleştirildi";if(shipment.accountingStatus==="reversed")return "Cari etkisi geri alındı";if(shipment.accountingStatus==="failed")return "Cari kayıt başarısız";return "İşlenmedi";}
function numericDate(value) { const date = /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : new Date(value); if (Number.isNaN(date.getTime())) return "tarihsiz"; return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`; }
function toDateKey(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function slugify(value) { return String(value || "tedarikci").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tedarikci"; }
function formatNumber(value) { return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value || 0)); }
function empty(title, copy) { return `<div class="empty-state"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy)}</p></div></div>`; }
