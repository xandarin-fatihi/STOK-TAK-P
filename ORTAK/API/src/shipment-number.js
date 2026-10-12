"use strict";

const SHIPMENT_NUMBER_PATTERN = /^SVK-(\d{4})-(\d{6})$/;
const SHIPMENT_NUMBER_TIME_ZONE = "Europe/Istanbul";
const MAX_SHIPMENT_SEQUENCE = 999999;

const yearFormatter = new Intl.DateTimeFormat("en", {
  timeZone: SHIPMENT_NUMBER_TIME_ZONE,
  year: "numeric"
});

function shipmentYear(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const part = yearFormatter.formatToParts(date).find((item) => item.type === "year");
  return part && /^\d{4}$/.test(part.value) ? part.value : null;
}

function shipmentCreationYear(shipment, fallbackYear = null) {
  const source = shipment && typeof shipment === "object" ? shipment : {};
  for (const value of [source.createdAt, source.updatedAt, source.shipmentDate, source.documentDate]) {
    const year = shipmentYear(value);
    if (year) return year;
  }
  return /^\d{4}$/.test(String(fallbackYear || "")) ? String(fallbackYear) : "1970";
}

function parseShipmentNumber(value) {
  const canonical = String(value || "").trim();
  const match = SHIPMENT_NUMBER_PATTERN.exec(canonical);
  if (!match) return null;
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_SHIPMENT_SEQUENCE) return null;
  return { value: canonical, year: match[1], sequence };
}

function formatShipmentNumber(year, sequence) {
  const canonicalYear = String(year || "");
  const canonicalSequence = Number(sequence);
  if (!/^\d{4}$/.test(canonicalYear)
    || !Number.isSafeInteger(canonicalSequence)
    || canonicalSequence < 1
    || canonicalSequence > MAX_SHIPMENT_SEQUENCE) {
    throw shipmentNumberError("Geçerli bir sevkiyat yılı ve sırası gerekli.", "SHIPMENT_NUMBER_INVALID");
  }
  return `SVK-${canonicalYear}-${String(canonicalSequence).padStart(6, "0")}`;
}

function normalizeShipmentNumberSequences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const [year, rawSequence] of Object.entries(source)) {
    const sequence = Math.trunc(Number(rawSequence));
    if (!/^\d{4}$/.test(year) || !Number.isSafeInteger(sequence) || sequence < 0) continue;
    normalized[year] = Math.min(sequence, MAX_SHIPMENT_SEQUENCE);
  }
  return normalized;
}

/**
 * Deterministically assigns display numbers to legacy shipments without
 * changing their technical ids. Existing unique canonical numbers win; a
 * duplicate is reassigned according to creation time and then technical id.
 */
function reconcileShipmentNumbers(shipments, sequenceState) {
  const normalizedShipments = (Array.isArray(shipments) ? shipments : [])
    .map((shipment) => shipment && typeof shipment === "object" && !Array.isArray(shipment) ? { ...shipment } : null)
    .filter(Boolean);
  const sequences = normalizeShipmentNumberSequences(sequenceState);
  const usedByYear = new Map();
  const ordered = normalizedShipments
    .map((shipment, index) => ({ shipment, index }))
    .sort(compareShipmentOrder);

  for (const { shipment } of ordered) {
    const parsed = parseShipmentNumber(shipment.shipmentNumber);
    if (!parsed) {
      delete shipment.shipmentNumber;
      continue;
    }
    const used = usedNumbers(usedByYear, parsed.year);
    if (used.has(parsed.sequence)) {
      delete shipment.shipmentNumber;
      continue;
    }
    shipment.shipmentNumber = parsed.value;
    used.add(parsed.sequence);
    sequences[parsed.year] = Math.max(Number(sequences[parsed.year] || 0), parsed.sequence);
  }

  for (const { shipment } of ordered) {
    if (parseShipmentNumber(shipment.shipmentNumber)) continue;
    const year = shipmentCreationYear(shipment);
    const used = usedNumbers(usedByYear, year);
    const sequence = nextSequence(sequences, year, used);
    shipment.shipmentNumber = formatShipmentNumber(year, sequence);
  }

  return { shipments: normalizedShipments, sequences };
}

/**
 * Allocates a number while the caller already owns the store mutation. The
 * scan protects against a stale/lowered counter and the store's serialized
 * update queue makes allocation atomic across all shipment creation paths.
 */
function allocateShipmentNumber(data, createdAt) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError("Sevkiyat numarası için store verisi gerekli.");
  }
  const year = shipmentYear(createdAt);
  if (!year) throw shipmentNumberError("Sevkiyat oluşturma tarihi geçersiz.", "SHIPMENT_NUMBER_DATE_INVALID");
  const sequences = normalizeShipmentNumberSequences(data.shipmentNumberSequences);
  const used = new Set();
  for (const shipment of Array.isArray(data.workforceShipments) ? data.workforceShipments : []) {
    const parsed = parseShipmentNumber(shipment && shipment.shipmentNumber);
    if (!parsed || parsed.year !== year) continue;
    used.add(parsed.sequence);
    sequences[year] = Math.max(Number(sequences[year] || 0), parsed.sequence);
  }
  const sequence = nextSequence(sequences, year, used);
  data.shipmentNumberSequences = sequences;
  return formatShipmentNumber(year, sequence);
}

function nextSequence(sequences, year, used) {
  let candidate = Math.max(0, Math.trunc(Number(sequences[year] || 0))) + 1;
  while (candidate <= MAX_SHIPMENT_SEQUENCE && used.has(candidate)) candidate += 1;
  if (candidate > MAX_SHIPMENT_SEQUENCE) {
    throw shipmentNumberError(`${year} sevkiyat numarası sırası doldu.`, "SHIPMENT_NUMBER_SEQUENCE_EXHAUSTED");
  }
  used.add(candidate);
  sequences[year] = candidate;
  return candidate;
}

function usedNumbers(index, year) {
  let used = index.get(year);
  if (!used) {
    used = new Set();
    index.set(year, used);
  }
  return used;
}

function compareShipmentOrder(left, right) {
  const leftTime = shipmentSortTime(left.shipment);
  const rightTime = shipmentSortTime(right.shipment);
  if (leftTime !== rightTime) return leftTime - rightTime;
  const idOrder = String(left.shipment.id || "").localeCompare(String(right.shipment.id || ""), "en");
  return idOrder || left.index - right.index;
}

function shipmentSortTime(shipment) {
  for (const value of [shipment.createdAt, shipment.updatedAt, shipment.shipmentDate, shipment.documentDate]) {
    if (value === null || value === undefined || value === "") continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function shipmentNumberError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

module.exports = {
  MAX_SHIPMENT_SEQUENCE,
  SHIPMENT_NUMBER_PATTERN,
  SHIPMENT_NUMBER_TIME_ZONE,
  allocateShipmentNumber,
  formatShipmentNumber,
  normalizeShipmentNumberSequences,
  parseShipmentNumber,
  reconcileShipmentNumbers,
  shipmentCreationYear,
  shipmentYear
};
