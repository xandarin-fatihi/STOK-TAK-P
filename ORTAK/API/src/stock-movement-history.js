"use strict";

const DAY = 86400000;
const normalizeSearch = (value) => String(value || "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
function localDay(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function isSupply(movement) {
  if (movement.status === "reversed" || movement.reversedAt || movement.reversedMovementId || movement.type === "reversal") return false;
  if (Number(movement.baseQuantityDelta ?? movement.quantity) <= 0) return false;
  const linked = movement.shipmentId || movement.receiptId || movement.purchaseOrderId
    || ["shipment", "receipt", "purchase_order", "order"].includes(movement.referenceType) && movement.referenceId;
  return !!linked && ["inbound_shipment", "shipment_in", "stock_in", "manual_in"].includes(movement.type)
    && ["approved", "completed", "posted", "onaylandı"].includes(movement.status);
}
const groupKey = (movement) => `${movement.productId || movement.stockProductId}|${movement.locationId || movement.toLocationId || ""}`;
function recurrence(events) {
  const times = Array.from(new Set(events.map((event) => event.time))).sort((a, b) => a - b);
  const result = { kind: "insufficient", label: "Yeterli veri yok", count: times.length, averageDays: null, dates: times.slice(-6).map((time) => new Date(time).toISOString()) };
  if (times.length < 3) return result;
  const intervals = times.slice(1).map((time, index) => (time - times[index]) / DAY);
  const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  result.averageDays = Math.round(average * 10) / 10;
  if (intervals.some((value) => Math.abs(value - average) > Math.max(1, average * .35))) return { ...result, kind: "irregular", label: "Düzensiz" };
  if (average >= 20 && average <= 45) return { ...result, kind: "monthly", label: "Yaklaşık ayda bir" };
  if (average >= 75 && average <= 105) return { ...result, kind: "quarterly", label: "Yaklaşık 3 ayda bir" };
  if (average >= 150 && average <= 210) return { ...result, kind: "semiannual", label: "Yaklaşık 6 ayda bir" };
  if (average >= 330 && average <= 400) return { ...result, kind: "annual", label: "Yaklaşık yılda bir" };
  return { ...result, kind: "other", label: `Yaklaşık ${Math.max(1, Math.round(average))} günde bir` };
}

function buildMovementHistory(state, options = {}) {
  const day = String(options.date || "");
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || localDay(`${day}T12:00:00+03:00`) !== day)) {
    throw Object.assign(new Error("Geçerli bir tarih seçin."), { status: 400 });
  }
  const products = new Map((state.products || []).map((item) => [String(item.id), item]));
  const locations = new Map((state.locations || []).map((item) => [String(item.id), item.name]));
  const groups = new Map();
  const supplyEvents = new Map();
  for (const movement of state.movements || []) {
    if (!isSupply(movement)) continue;
    const time = Date.parse(movement.createdAt);
    if (!Number.isFinite(time)) continue;
    const key = groupKey(movement);
    if (!groups.has(key)) groups.set(key, new Map());
    const reference = String(movement.shipmentId || movement.receiptId || movement.purchaseOrderId || movement.referenceId);
    // Multiple lines/receipts from one referenced order do not create repeat orders.
    const events = groups.get(key);
    const old = events.get(reference);
    if (!old || time < old.time) events.set(reference, { time });
  }
  for (const [key, events] of groups) supplyEvents.set(key, recurrence([...events.values()]));
  const search = normalizeSearch(String(options.search || "").slice(0, 240));
  const type = String(options.type || "all");
  const frequency = String(options.frequency || "all");
  const validFrequencies = new Set(["all", "monthly", "quarterly", "semiannual", "annual", "other", "irregular", "insufficient"]);
  if (!validFrequencies.has(frequency)) throw Object.assign(new Error("Geçerli bir sıklık seçin."), { status: 400 });
  const typeLabels = { manual_in: "Stok ekleme giriş", stock_in: "Stok ekleme giriş", manual_out: "Eksilt çıkış", stock_out: "Eksilt çıkış", inbound_shipment: "Sevkiyat girişi", shipment_in: "Sevkiyat girişi", reversal: "Ters kayıt", waste: "Fire sarf", consumption: "Sarf", transfer: "Transfer", transfer_in: "Transfer girişi", transfer_out: "Transfer çıkışı" };
  const items = (state.movements || []).filter((movement) => {
    const locationId = String(options.locationId || "");
    if (locationId && String(movement.locationId || movement.toLocationId || movement.fromLocationId) !== locationId
      && !(movement.type === "transfer" && [movement.fromLocationId, movement.toLocationId].includes(locationId))) return false;
    if (options.productId && String(movement.productId) !== String(options.productId)) return false;
    const family = type === "transfer" ? ["transfer", "transfer_in", "transfer_out"] : type === "manual_in" ? ["manual_in", "stock_in", "inbound_shipment", "shipment_in", "opening_balance"] : type === "manual_out" ? ["manual_out", "stock_out", "adjustment_out"] : type === "waste" ? ["waste", "consumption"] : [type];
    if (type !== "all" && !family.includes(movement.type)) return false;
    if (day && localDay(movement.createdAt) !== day) return false;
    if (frequency !== "all" && (!isSupply(movement) || (supplyEvents.get(groupKey(movement))?.kind || "insufficient") !== frequency)) return false;
    const product = products.get(String(movement.productId)) || {};
    const haystack = [movement.productName, movement.productCode, product.name, product.productCode, movement.actor, movement.note, movement.reason, movement.type, typeLabels[movement.type], locations.get(String(movement.locationId)), locations.get(String(movement.fromLocationId)), locations.get(String(movement.toLocationId))].join(" ");
    return !search || normalizeSearch(haystack).includes(search);
  }).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || String(b.id).localeCompare(String(a.id)));
  const limit = Math.max(1, Math.min(100, Number.parseInt(options.limit, 10) || 40));
  const offset = Math.max(0, Number.parseInt(options.offset, 10) || 0);
  return {
    movements: items.slice(offset, offset + limit).map((movement) => ({ ...movement,
      supplyEvent: isSupply(movement), frequency: supplyEvents.get(groupKey(movement)) || recurrence([]) })),
    total: items.length, offset, limit, hasMore: offset + limit < items.length, timeZone: "Europe/Istanbul"
  };
}
module.exports = { buildMovementHistory, isSupply, localDay };
