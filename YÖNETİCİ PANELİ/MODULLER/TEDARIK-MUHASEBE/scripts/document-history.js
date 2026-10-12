import { api, requestId } from "./api.js?v=20260920-notification-center-v1";
import { CAPABILITIES, escapeHtml as esc, has, hasSection, state, trDate, updateRevision } from "./state.js?v=20261005-storage-placement-v1";
import { createDocumentDialog } from "./document-records.js?v=20261009-history-v1&fixes=20261011-v2";

const types = { document: "Belge", "stock-product": "Stok ürünü", "stock-location": "Depo", shipment: "Sevkiyat", ledger: "Cari kayıt", payment: "Ödeme" };
const dayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
let activeHistory = null;

export function historyDay(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : dayFormatter.format(date);
}

export function buildHistoryRecords(trash = [], documents = []) {
  const records = new Map();
  for (const record of trash) {
    const item = { ...record, key: `${record.type}:${record.id}`, action: record.status === "reversed" ? "Kayıt ters çevrildi" : "Kayıt kaldırıldı", reference: record.productCode || record.shipmentNumber || "" };
    records.set(item.key, item);
  }
  for (const document of documents) {
    if (!document.archivedAt) continue;
    const item = { id: document.id, type: "document", key: `document:${document.id}`, title: document.recordTitle || document.documentNumber || document.originalName || "Belge", reference: document.documentNumber || "", action: "Belge kaldırıldı", reason: document.archiveReason || "", actorName: document.archivedByName || document.archivedBy || "—", removedAt: document.archivedAt, canRestore: true };
    records.set(item.key, item);
  }
  return [...records.values()].sort((a, b) => (Date.parse(b.removedAt) || 0) - (Date.parse(a.removedAt) || 0) || a.key.localeCompare(b.key));
}

export function filterHistoryRecords(records, { query = "", start = "", end = "", type = "" } = {}) {
  const text = query.trim().toLocaleLowerCase("tr-TR");
  return records.filter((record) => {
    const day = historyDay(record.removedAt);
    return (!type || type === record.type) && (!start || (day && day >= start)) && (!end || (day && day <= end))
      && (!text || `${record.title || ""} ${record.reference || ""} ${record.actorName || ""} ${record.reason || ""} ${record.action || ""} ${types[record.type] || ""}`.toLocaleLowerCase("tr-TR").includes(text));
  });
}

export function canRestoreHistoryRecord(record) {
  if (record.type === "document") return has(CAPABILITIES.documentsArchive) && hasSection("documents", "full");
  if (record.type === "stock-product") return has(CAPABILITIES.inventoryCatalogManage) && hasSection("stock", "full");
  if (record.type === "stock-location") return record.canRestore === true && has(CAPABILITIES.inventoryLocationManage) && hasSection("stock", "full");
  return record.canRestore === true && hasSection("ledger", "full") && (record.type === "ledger"
    ? has(CAPABILITIES.accountingPost) && has(CAPABILITIES.accountingReverse)
    : record.type === "payment" && has(CAPABILITIES.paymentCreate) && has(CAPABILITIES.paymentReverse));
}

export function renderHistoryRows(records) {
  return records.map((record) => {
    const date = new Date(record.removedAt || "");
    const time = Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" });
    return `<details class="doc-history-entry" data-history-key="${esc(record.key)}"><summary><span class="doc-history-symbol" aria-hidden="true">↶</span><span class="doc-history-name"><strong>${esc(record.title || types[record.type] || "Kayıt")}</strong><small>${esc([record.reference, record.action].filter(Boolean).join(" · "))}</small></span><span class="doc-history-actor">${esc(record.actorName || "—")}</span><time datetime="${esc(record.removedAt || "")}">${esc(historyDay(record.removedAt) ? trDate(record.removedAt) : "Tarih belirtilmedi")}<small>${esc(time)}</small></time><span class="doc-history-chevron" aria-hidden="true">›</span></summary><div class="doc-history-detail"><h3>İşlem ayrıntısı</h3><dl><div><dt>İşlem</dt><dd>${esc(record.action)}</dd></div><div><dt>Kayıt türü</dt><dd>${esc(types[record.type] || record.type)}</dd></div><div><dt>İşlemi yapan</dt><dd>${esc(record.actorName || "—")}</dd></div><div><dt>Tarih</dt><dd>${esc(historyDay(record.removedAt) ? `${trDate(record.removedAt)} · ${time}` : "Belirtilmedi")}</dd></div></dl><p><span>Açıklama: </span>${esc(record.reason || "Açıklama belirtilmedi.")}</p>${canRestoreHistoryRecord(record) ? `<div class="doc-history-actions"><button class="ui-button ui-button--secondary" type="button" data-history-restore="${esc(record.key)}">Geri Al</button></div>` : ""}</div></details>`;
  }).join("");
}

export function closeDocumentHistory() { activeHistory?.close(); }

export function openDocumentHistory({ trigger = null, onRestore } = {}) {
  if (activeHistory?.alive) return activeHistory;
  if (!hasSection("trash") && !(hasSection("documents") && has(CAPABILITIES.documentsRead))) return null;
  const ui = createDocumentDialog("Kaldırılan Kayıtlar", "doc-dialog--history");
  activeHistory = ui;
  let records = [], loading = false, failures = [], pageSize = 40, sequence = 0;
  const attempts = new Map();
  ui.body.innerHTML = `<p class="doc-history-intro">Kayıtlar en yeniden eskiye sıralanır.</p><label class="doc-search"><span aria-hidden="true">⌕</span><input type="search" data-history-query aria-label="İşlem geçmişinde ara" placeholder="Belge, kayıt adı veya işlem yapan kişiyle ara"></label><div class="doc-history-filters"><label>Başlangıç<input type="date" data-history-from aria-label="Geçmiş başlangıç tarihi"></label><label>Bitiş<input type="date" data-history-to aria-label="Geçmiş bitiş tarihi"></label><label>İşlem türü<select data-history-type aria-label="Geçmiş işlem türü"><option value="">Tüm işlemler</option>${Object.entries(types).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label></div><p class="doc-history-status" role="status" aria-live="polite"></p><div class="doc-history-list"></div><button class="ui-button ui-button--secondary doc-history-more" type="button" data-history-more hidden>Daha Fazla Göster</button>`;
  ui.footer.innerHTML = '<span class="doc-history-count"></span><button class="ui-button ui-button--primary" type="button" data-history-close>Kapat</button>';
  const input = (name) => ui.body.querySelector(`[data-history-${name}]`);
  const render = () => {
    if (!ui.alive) return;
    const start = input("from").value, end = input("to").value;
    input("from").max = end; input("to").min = start;
    const invalid = start && end && start > end;
    const visible = invalid ? [] : filterHistoryRecords(records, { query: input("query").value, start, end, type: input("type").value });
    const status = ui.body.querySelector(".doc-history-status");
    status.textContent = invalid ? "Başlangıç tarihi bitiş tarihinden sonra olamaz." : loading ? "Geçmiş yükleniyor…" : failures.length ? "Bazı kayıtlar yüklenemedi. Yeniden deneyebilirsiniz." : "";
    const list = ui.body.querySelector(".doc-history-list");
    const openKeys = new Set([...list.querySelectorAll("details[open]")].map((node) => node.dataset.historyKey));
    list.innerHTML = renderHistoryRows(visible.slice(0, pageSize)) || `<div class="doc-empty"><h3>${loading ? "Geçmiş yükleniyor…" : records.length ? "Eşleşen işlem bulunamadı" : failures.length ? "Geçmiş yüklenemedi" : "İşlem kaydı bulunmuyor"}</h3><p>${loading ? "" : "Kaldırılan kayıtlar burada listelenir."}</p></div>`;
    list.querySelectorAll("details").forEach((node) => { node.open = openKeys.has(node.dataset.historyKey); });
    input("more").hidden = loading || visible.length <= pageSize;
    ui.footer.querySelector(".doc-history-count").textContent = `${visible.length} kayıt${visible.length > pageSize ? ` · ${pageSize} gösteriliyor` : ""}`;
    const retry = ui.body.querySelector("[data-history-retry]"); retry?.remove();
    if (failures.length && !loading) { const button = document.createElement("button"); button.className = "ui-button ui-button--secondary"; button.type = "button"; button.dataset.historyRetry = ""; button.textContent = "Yeniden Dene"; status.after(button); }
  };
  const load = async () => {
    const run = ++sequence; loading = true; failures = []; render();
    const sources = [];
    if (hasSection("trash")) sources.push(["trash", "/trash"]);
    if (hasSection("documents") && has(CAPABILITIES.documentsRead)) sources.push(["documents", "/documents?archived=true"]);
    const results = await Promise.all(sources.map(async ([key, path]) => {
      try { return { key, payload: await api(path, { dedupe: false, signal: ui.abort.signal }) }; }
      catch (error) { return { key, error }; }
    }));
    if (!ui.alive || run !== sequence) return;
    let trash = [], documents = [];
    for (const result of results) {
      if (result.error) { failures.push(result.error); continue; }
      updateRevision(result.payload);
      if (result.key === "trash") { trash = result.payload.records || []; state.trash = trash; }
      else documents = result.payload.documents || [];
    }
    records = buildHistoryRecords(trash, documents); loading = false; render();
  };
  ui.body.addEventListener("input", (event) => { if (event.target.matches("[data-history-query],[data-history-from],[data-history-to],[data-history-type]")) { pageSize = 40; render(); } });
  ui.body.addEventListener("change", (event) => { if (event.target.matches("[data-history-from],[data-history-to],[data-history-type]")) { pageSize = 40; render(); } });
  ui.dialog.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-history-close],[data-history-more],[data-history-retry],[data-history-restore]");
    if (!button) return;
    event.stopPropagation();
    if (button.disabled || ui.saving) return;
    if (button.hasAttribute("data-history-close")) return ui.close();
    if (button.hasAttribute("data-history-more")) { pageSize += 40; return render(); }
    if (button.hasAttribute("data-history-retry")) return load();
    const record = records.find((item) => item.key === button.dataset.historyRestore);
    if (!record || !canRestoreHistoryRecord(record) || !onRestore) return;
    if (!attempts.has(record.key)) attempts.set(record.key, requestId("history-restore"));
    ui.busy(true); ui.message("");
    try { const restored = await onRestore(record, attempts.get(record.key)); if (restored !== false && ui.alive) { ui.busy(false); await load(); } }
    catch (error) { if (ui.alive) ui.message(error.message || "Kayıt geri alınamadı."); }
    finally { if (ui.alive) ui.busy(false); }
  });
  ui.dialog.addEventListener("close", () => { if (activeHistory === ui) activeHistory = null; if (trigger?.isConnected) trigger.focus({ preventScroll: true }); }, { once: true });
  input("query").focus();
  ui.loaded = load();
  return ui;
}
