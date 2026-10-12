(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MenuSuiteStockLookup = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const GROUP_SEPARATOR = "\u001d";
  const SYMBOLOGY_PREFIX = /^\][A-Za-z][0-9]/;

  function text(value) {
    return String(value === undefined || value === null ? "" : value).normalize("NFC").trim();
  }

  function productCodeKey(value) {
    return text(value).toUpperCase();
  }

  function scannerValue(value) {
    return text(value).replace(/[\r\n]+$/g, "");
  }

  function stripSymbology(value) {
    const raw = scannerValue(value);
    return SYMBOLOGY_PREFIX.test(raw) ? raw.slice(3) : raw;
  }

  function gtinCheckDigitIsValid(value) {
    const gtin = text(value);
    if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) return false;
    const body = gtin.slice(0, -1);
    let sum = 0;
    for (let index = body.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
      sum += Number(body[index]) * (position % 2 === 0 ? 3 : 1);
    }
    return (10 - (sum % 10)) % 10 === Number(gtin.at(-1));
  }

  function parseParenthesizedGs1(raw) {
    const tokens = [];
    const marker = /\((\d{2,4})\)/g;
    let match;
    while ((match = marker.exec(raw))) {
      tokens.push({ ai: match[1], start: marker.lastIndex, markerIndex: match.index });
    }
    if (!tokens.length || tokens[0].markerIndex !== 0) return null;
    for (let index = 0; index < tokens.length; index += 1) {
      tokens[index].value = raw.slice(tokens[index].start, tokens[index + 1] ? tokens[index + 1].markerIndex : raw.length).replaceAll(GROUP_SEPARATOR, "");
    }
    const identity = tokens.find((token) => token.ai === "01" || token.ai === "02" || token.ai === "8006");
    if (!identity) return null;
    const gtin = identity.ai === "8006" ? identity.value.slice(0, 14) : identity.value;
    if (!/^\d{14}$/.test(gtin) || !gtinCheckDigitIsValid(gtin)) return null;
    return {
      raw,
      productIdentifiers: [{ ai: identity.ai, value: gtin }],
      lot: text(tokens.find((token) => token.ai === "10")?.value),
      serial: text(tokens.find((token) => token.ai === "21")?.value)
    };
  }

  function parseCompactGs1(raw, hadSymbologyPrefix) {
    const hasGsMarker = raw.includes(GROUP_SEPARATOR);
    if (!hadSymbologyPrefix && !hasGsMarker && !(raw.length > 16 && /^(01|02)\d{14}/.test(raw))) return null;
    const compact = raw.replaceAll(GROUP_SEPARATOR, "");
    if (!/^(01|02)\d{14}/.test(compact)) return null;
    const ai = compact.slice(0, 2);
    const gtin = compact.slice(2, 16);
    if (!gtinCheckDigitIsValid(gtin)) return null;
    let lot = "";
    let serial = "";
    let tail = raw.slice(16);
    while (tail) {
      if (tail.startsWith(GROUP_SEPARATOR)) {
        tail = tail.slice(1);
        continue;
      }
      const variableAi = tail.slice(0, 2);
      if (variableAi !== "10" && variableAi !== "21") break;
      tail = tail.slice(2);
      const separator = tail.indexOf(GROUP_SEPARATOR);
      const value = separator >= 0 ? tail.slice(0, separator) : tail;
      if (variableAi === "10") lot = text(value);
      if (variableAi === "21") serial = text(value);
      tail = separator >= 0 ? tail.slice(separator + 1) : "";
    }
    return { raw, productIdentifiers: [{ ai, value: gtin }], lot, serial };
  }

  function parseGs1(value) {
    const original = scannerValue(value);
    if (!original) return null;
    const hadSymbologyPrefix = SYMBOLOGY_PREFIX.test(original);
    const raw = stripSymbology(original);
    return raw.startsWith("(")
      ? parseParenthesizedGs1(raw)
      : parseCompactGs1(raw, hadSymbologyPrefix);
  }

  function normalizeBarcodeRecord(value, defaults = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : { value };
    const barcode = scannerValue(source.value ?? source.barcode ?? source.code ?? source.gtin);
    if (!barcode) return null;
    const quantity = Number(source.quantity ?? source.unitsPerPack ?? source.baseQuantity ?? defaults.quantity ?? 1);
    return {
      value: barcode,
      verified: source.verified !== false && defaults.verified !== false,
      kind: text(source.kind || source.type || defaults.kind || "single") || "single",
      unit: text(source.unit || source.packageUnit || defaults.unit),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1
    };
  }

  function productBarcodeRecords(product) {
    const source = product && typeof product === "object" ? product : {};
    const records = [];
    const primary = normalizeBarcodeRecord(source.barcode, {
      verified: source.barcodeVerified !== false,
      unit: source.baseUnit || source.unit,
      quantity: 1,
      kind: "single"
    });
    if (primary) records.push(primary);
    const provided = [
      ...(Array.isArray(source.barcodes) ? source.barcodes : []),
      ...(Array.isArray(source.alternativeBarcodes) ? source.alternativeBarcodes : [])
    ];
    for (const item of provided) {
      const record = normalizeBarcodeRecord(item, { verified: true, unit: source.baseUnit || source.unit });
      if (record) records.push(record);
    }
    const seen = new Set();
    return records.filter((record) => {
      if (seen.has(record.value)) return false;
      seen.add(record.value);
      return true;
    });
  }

  function locationBarcodeEntries(locations) {
    return (Array.isArray(locations) ? locations : []).map((location) => {
      const source = location && typeof location === "object" ? location : { barcodeValue: location };
      return {
        location: source,
        value: scannerValue(source.barcodeValue ?? source.locationBarcode ?? source.barcode)
      };
    }).filter((entry) => entry.value);
  }

  function lookupProduct(products, query, locations = []) {
    const raw = scannerValue(query);
    if (!raw) return { kind: "empty", query: "", matches: [] };
    const stripped = stripSymbology(raw);
    const gs1 = parseGs1(raw);
    const barcodeCandidates = [...new Set([
      stripped,
      ...(gs1 ? gs1.productIdentifiers.map((item) => item.value) : [])
    ].filter(Boolean))];
    const locationMatches = locationBarcodeEntries(locations).filter((entry) => entry.value === stripped);
    const matches = [];
    for (const product of Array.isArray(products) ? products : []) {
      if (!product || product.active === false) continue;
      const codeMatch = productCodeKey(product.productCode) && productCodeKey(product.productCode) === productCodeKey(raw);
      const barcodeMatch = productBarcodeRecords(product).find((record) => record.verified && barcodeCandidates.includes(record.value));
      if (!codeMatch && !barcodeMatch) continue;
      matches.push({ product, matchType: codeMatch ? "productCode" : "barcode", barcode: barcodeMatch || null, gs1 });
    }
    const unique = [...new Map(matches.map((match) => [String(match.product.id || match.product.productCode || ""), match])).values()];
    if (locationMatches.length && unique.length) return { kind: "ambiguous", query: raw, matches: unique, locationMatches };
    if (locationMatches.length) return { kind: "location", query: raw, matches: [], locationMatches };
    if (unique.length > 1) return { kind: "ambiguous", query: raw, matches: unique, locationMatches: [] };
    if (unique.length === 1) return { kind: "found", query: raw, ...unique[0], matches: unique };
    return { kind: "notFound", query: raw, matches: [], gs1 };
  }

  function searchText(value) {
    return text(value).toLocaleLowerCase("tr-TR").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/\s+/g, " ");
  }

  function productMatchesSearch(product, query) {
    const wanted = searchText(query);
    if (!wanted) return true;
    if (lookupProduct([product], query).kind === "found") return true;
    if (productBarcodeRecords(product).some((record) => record.verified && searchText(record.value).includes(wanted))) return true;
    return [product?.name, product?.productName, product?.productCode, product?.manufacturerCode, product?.brand, product?.supplier]
      .map(searchText).some((value) => value.includes(wanted));
  }

  return {
    gtinCheckDigitIsValid,
    lookupProduct,
    normalizeBarcodeRecord,
    parseGs1,
    productBarcodeRecords,
    productCodeKey,
    productMatchesSearch,
    scannerValue,
    searchText,
    stripSymbology
  };
});
