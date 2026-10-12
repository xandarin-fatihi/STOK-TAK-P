const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const ROWS_PER_PAGE = 10;
const FONT_REGULAR_URL = "/assets/fonts/poppins-regular.ttf";
const FONT_SEMIBOLD_URL = "/assets/fonts/poppins-semibold.ttf";

let fontPromise;

export function resolveShipmentNumber(shipment = {}) {
  const supplied = String(shipment.shipmentNumber || shipment.publicNumber || "").trim();
  if (supplied) return supplied;
  const date = shipmentDateKey(shipment) || "TARIHSIZ";
  const source = `${shipment.id || "legacy"}|${shipment.createdAt || ""}|${date}`;
  let checksum = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    checksum ^= source.charCodeAt(index);
    checksum = Math.imul(checksum, 16777619);
  }
  return `SVK-ESKI-${date.replaceAll("-", "")}-${(checksum >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-7)}`;
}

export function shipmentPdfFileName(shipment = {}) {
  const shipmentNumber = safeFilePart(resolveShipmentNumber(shipment), "sevkiyat");
  const supplier = safeFilePart(shipment.supplier?.name || "tedarikci", "tedarikci");
  return `${shipmentNumber}_${supplier}_${numericDate(shipmentDate(shipment))}.pdf`;
}

export function formatShipmentPdfDate(value) {
  if (!value) return "—";
  const raw = String(value).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const parsed = dateOnly ? localDateFromParts(raw) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("tr-TR", dateOnly
    ? { day: "2-digit", month: "short", year: "numeric" }
    : { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
  ).format(parsed);
}

export function paginateShipmentRows(items, size = ROWS_PER_PAGE) {
  const source = Array.isArray(items) ? items : [];
  const pageSize = Math.max(1, Math.floor(Number(size) || ROWS_PER_PAGE));
  if (!source.length) return [[]];
  const pages = [];
  for (let index = 0; index < source.length; index += pageSize) pages.push(source.slice(index, index + pageSize));
  return pages;
}

export function createPrintPaletteSnapshot(source = null) {
  const css = source || browserThemeTokens();
  const primary = ensureUsablePrimary(readColor(css, "--panel-primary", "#625274"));
  const accent = readColor(css, "--panel-accent", primary);
  const sourceSurface = readColor(css, "--panel-surface", "#fffdf9");
  const page = mixHex(sourceSurface, "#ffffff", 0.92);
  const inkCandidate = readColor(css, "--panel-ink", "#2d2736");
  const mutedCandidate = readColor(css, "--panel-muted", "#6f6677");
  const onPrimaryCandidate = readColor(css, "--panel-on-primary", "#ffffff");
  const ink = ensureContrast(inkCandidate, page, 7);
  const muted = ensureContrast(mutedCandidate, page, 4.5);
  const onPrimary = ensureContrast(onPrimaryCandidate, primary, 4.5);
  return Object.freeze({
    primary,
    accent,
    page,
    surface: mixHex(sourceSurface, "#ffffff", 0.84),
    soft: mixHex(primary, "#ffffff", 0.89),
    line: mixHex(primary, "#ffffff", 0.7),
    ink,
    muted,
    onPrimary
  });
}

export function colorContrastRatio(first, second) {
  const a = relativeLuminance(parseColor(first));
  const b = relativeLuminance(parseColor(second));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export async function loadShipmentPdfFonts(timeoutMs = 8000) {
  if (!fontPromise) {
    fontPromise = Promise.all([
      fetchFont(FONT_REGULAR_URL, timeoutMs),
      fetchFont(FONT_SEMIBOLD_URL, timeoutMs)
    ]).then(([regular, semibold]) => Object.freeze({ regular, semibold })).catch((error) => {
      fontPromise = null;
      throw error;
    });
  }
  return fontPromise;
}

export async function prepareShipmentEvidenceImage(blob, timeoutMs = 15000) {
  if (!String(blob?.type || "").toLocaleLowerCase("tr-TR").startsWith("image/")) return null;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  const bitmap = await promiseWithTimeout(createImageBitmap(blob), timeoutMs, "Ek belge görseli zamanında hazırlanamadı.");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Number(bitmap.width) || 1);
    canvas.height = Math.max(1, Number(bitmap.height) || 1);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const jpeg = await canvasToJpegBlob(canvas, timeoutMs);
    return Object.freeze({
      bytes: new Uint8Array(await jpeg.arrayBuffer()),
      width: canvas.width,
      height: canvas.height
    });
  } finally {
    bitmap.close?.();
  }
}

export async function buildShipmentPdfBlob(shipment, options = {}) {
  const result = await buildShipmentPdfBytes(shipment, options);
  return Object.freeze({
    blob: new Blob([result.bytes], { type: "application/pdf" }),
    pageCount: result.pageCount,
    shipmentNumber: result.shipmentNumber
  });
}

export async function buildShipmentPdfBytes(shipment = {}, options = {}) {
  const palette = Object.freeze({ ...(options.palette || createPrintPaletteSnapshot()) });
  const fonts = options.fonts || await loadShipmentPdfFonts();
  const writer = new PdfWriter();
  const catalogId = writer.reserve();
  const pagesId = writer.reserve();
  const regular = new EmbeddedTrueTypeFont(writer, fonts.regular, "PoppinsRegular");
  const semibold = new EmbeddedTrueTypeFont(writer, fonts.semibold || fonts.regular, "PoppinsSemibold");
  const resources = Object.freeze({ regular, semibold });
  const pageIds = [];
  const pageRows = paginateShipmentRows(shipment.items);
  const shipmentNumber = resolveShipmentNumber(shipment);
  const totalPages = pageRows.length + (options.evidence ? 1 : 0);

  pageRows.forEach((rows, pageIndex) => {
    const page = new VectorPage(resources, palette);
    drawReceiptPage(page, shipment, shipmentNumber, rows, pageIndex, pageRows.length, totalPages);
    pageIds.push(addPage(writer, pagesId, page));
  });

  if (options.evidence) {
    const page = new VectorPage(resources, palette);
    const image = addJpegImage(writer, options.evidence);
    drawEvidencePage(page, shipment, shipmentNumber, options.evidenceMeta || {}, image, totalPages);
    pageIds.push(addPage(writer, pagesId, page, image));
  }

  regular.finalize();
  semibold.finalize();
  writer.set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  writer.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /Lang (tr-TR) >>`);
  const infoId = writer.add(`<< /Title ${pdfUnicodeString(`Sevkiyat Fişi ${shipmentNumber}`)} /Author ${pdfUnicodeString("PAKET 3 Muhasebe")} /Subject ${pdfUnicodeString("Sevkiyat fişi")} /Creator ${pdfUnicodeString("PAKET 3")} /Producer ${pdfUnicodeString("PAKET 3 vektör PDF motoru")} /CreationDate (${pdfDate(new Date())}) >>`);
  return Object.freeze({ bytes: writer.build(catalogId, infoId), pageCount: pageIds.length, shipmentNumber });
}

function drawReceiptPage(page, shipment, shipmentNumber, rows, pageIndex, receiptPageCount, totalPages) {
  const supplier = shipment.supplier?.name || "Tedarikçi belirtilmedi";
  const destination = shipment.destinationLocationName || shipment.destinationWarehouseName || shipment.destinationLocation?.name || "Stoğa işlenmedi";
  const pricesVisible = shipment.pricesVisible !== false;
  const total = shipmentTotal(shipment);
  page.background();
  page.strokeRoundedRect(26, 24, 543.28, 792, 12, page.palette.line, 1.2);
  page.text("MUHASEBE", 46, 48, 9.5, { font: "semibold", color: page.palette.primary, letterSpacing: 0.6 });
  page.text(pageIndex ? `Sevkiyat Fişi · ${pageIndex + 1}` : "Sevkiyat Fişi", 46, 67, 24, { font: "semibold", color: page.palette.ink });
  page.text(supplier, 549, 54, 10.5, { font: "semibold", color: page.palette.ink, align: "right", maxWidth: 230 });
  page.line(46, 108, 549, 108, page.palette.primary, 1.8);

  drawMetaBox(page, 46, 127, 154, "TARİH", formatShipmentPdfDate(shipmentDate(shipment)));
  drawMetaBox(page, 211, 127, 154, "SEVKİYAT NO", shipmentNumber);
  drawMetaBox(page, 376, 127, 173, "HEDEF DEPO", destination);
  drawTableHeader(page, 46, 201);

  let top = 233;
  rows.forEach((item, index) => {
    drawReceiptRow(page, item, top, index + pageIndex * ROWS_PER_PAGE + 1, pricesVisible);
    top += 46;
  });
  if (!rows.length) page.text("Ürün satırı bulunmuyor.", 58, top + 18, 10, { color: page.palette.muted });

  if (pageIndex === receiptPageCount - 1 && pricesVisible) {
    page.fillRoundedRect(366, 716, 183, 50, 8, page.palette.primary);
    page.text("GENEL TOPLAM", 380, 729, 8.5, { font: "semibold", color: page.palette.onPrimary });
    page.text(formatMoney(total), 535, 741, 14, { font: "semibold", color: page.palette.onPrimary, align: "right", maxWidth: 142 });
  }
  page.text(`${shipmentNumber} · ${pageIndex + 1}/${totalPages}`, 46, 792, 8, { color: page.palette.muted });
}

function drawMetaBox(page, x, top, width, label, value) {
  page.fillRoundedRect(x, top, width, 54, 7, page.palette.soft);
  page.text(label, x + 10, top + 10, 7.4, { font: "semibold", color: page.palette.muted, letterSpacing: 0.35 });
  page.text(value || "—", x + 10, top + 29, 9.5, { font: "semibold", color: page.palette.ink, maxWidth: width - 20 });
}

function drawTableHeader(page, x, top) {
  page.fillRoundedRect(x, top, 503, 28, 5, page.palette.primary);
  page.text("ÜRÜN", x + 12, top + 9, 8, { font: "semibold", color: page.palette.onPrimary });
  page.text("MİKTAR", x + 260, top + 9, 8, { font: "semibold", color: page.palette.onPrimary });
  page.text("BİRİM FİYAT", x + 350, top + 9, 8, { font: "semibold", color: page.palette.onPrimary });
  page.text("TOPLAM", x + 443, top + 9, 8, { font: "semibold", color: page.palette.onPrimary });
}

function drawReceiptRow(page, item, top, rowNumber, pricesVisible) {
  const quantity = Number(item.quantityBulk ?? item.quantity ?? 0);
  const total = Number(item.totalKurus || item.lineTotalKurus || 0);
  const unitPrice = Number(item.unitPriceKurus || (quantity > 0 ? Math.round(total / quantity) : 0));
  const product = String(item.name || item.productName || "Ürün");
  page.fillRoundedRect(46, top, 503, 40, 5, page.palette.surface);
  page.strokeRoundedRect(46, top, 503, 40, 5, page.palette.line, 0.65);
  page.text(String(rowNumber), 55, top + 13, 7.2, { font: "semibold", color: page.palette.muted, align: "right", maxWidth: 12 });
  page.text(product, 64, top + 8, 8.8, { font: "semibold", color: page.palette.ink, maxWidth: 229, maxLines: 2, lineHeight: 10.5 });
  page.text(shipmentQuantityText(item), 306, top + 13, 8, { color: page.palette.ink, maxWidth: 83 });
  page.text(pricesVisible ? `${formatMoney(unitPrice)}${unitPriceSuffix(item)}` : "—", 397, top + 13, 7.6, { color: page.palette.ink, maxWidth: 87 });
  page.text(pricesVisible ? formatMoney(total) : "—", 537, top + 13, 8, { font: "semibold", color: page.palette.ink, align: "right", maxWidth: 82 });
}

function drawEvidencePage(page, shipment, shipmentNumber, evidenceMeta, image, totalPages) {
  page.background();
  page.strokeRoundedRect(26, 24, 543.28, 792, 12, page.palette.line, 1.2);
  page.text("SEVKİYAT EKİ", 46, 48, 9.5, { font: "semibold", color: page.palette.primary, letterSpacing: 0.6 });
  page.text(String(evidenceMeta.documentType || "Sevkiyat Belgesi"), 46, 68, 21, { font: "semibold", color: page.palette.ink, maxWidth: 330 });
  page.text(shipmentNumber, 549, 58, 10, { font: "semibold", color: page.palette.primary, align: "right", maxWidth: 190 });
  page.line(46, 108, 549, 108, page.palette.primary, 1.8);
  page.fillRoundedRect(46, 127, 503, 625, 8, page.palette.soft);
  const bounds = contain(image.width, image.height, 483, 605);
  const x = 56 + (483 - bounds.width) / 2;
  const top = 137 + (605 - bounds.height) / 2;
  page.image(image, x, top, bounds.width, bounds.height);
  page.text(`${shipment.supplier?.name || "Tedarikçi belirtilmedi"} · ${formatShipmentPdfDate(shipmentDate(shipment))}`, 46, 772, 8.5, { color: page.palette.muted, maxWidth: 390 });
  page.text(`${totalPages}/${totalPages}`, 549, 792, 8, { color: page.palette.muted, align: "right" });
}

function addPage(writer, parentId, page, image = null) {
  const contentId = writer.add({ stream: asciiBytes(page.commands.join("\n")), dict: "" });
  const pageId = writer.reserve();
  const imageResource = image ? ` /XObject << /${image.name} ${image.objectId} 0 R >>` : "";
  writer.set(pageId, `<< /Type /Page /Parent ${parentId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${page.fonts.regular.type0Id} 0 R /F2 ${page.fonts.semibold.type0Id} 0 R >>${imageResource} >> /Contents ${contentId} 0 R >>`);
  return pageId;
}

function addJpegImage(writer, evidence) {
  const width = Math.max(1, Math.floor(Number(evidence.width) || 1));
  const height = Math.max(1, Math.floor(Number(evidence.height) || 1));
  const bytes = uint8(evidence.bytes);
  const objectId = writer.add({
    stream: bytes,
    dict: `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`
  });
  return Object.freeze({ name: `Evidence${objectId}`, objectId, width, height });
}

class VectorPage {
  constructor(fonts, palette) {
    this.fonts = fonts;
    this.palette = palette;
    this.commands = [];
  }

  background() { this.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, this.palette.page); }
  fillRect(x, top, width, height, color) { this.commands.push(`${pdfColor(color)} rg ${n(x)} ${n(PAGE_HEIGHT - top - height)} ${n(width)} ${n(height)} re f`); }
  fillRoundedRect(x, top, width, height, radius, color) { this.commands.push(`${pdfColor(color)} rg ${roundedRectPath(x, PAGE_HEIGHT - top - height, width, height, radius)} f`); }
  strokeRoundedRect(x, top, width, height, radius, color, lineWidth) { this.commands.push(`${pdfColor(color)} RG ${n(lineWidth)} w ${roundedRectPath(x, PAGE_HEIGHT - top - height, width, height, radius)} S`); }
  line(x1, top1, x2, top2, color, width) { this.commands.push(`${pdfColor(color)} RG ${n(width)} w ${n(x1)} ${n(PAGE_HEIGHT - top1)} m ${n(x2)} ${n(PAGE_HEIGHT - top2)} l S`); }
  image(image, x, top, width, height) { this.commands.push(`q ${n(width)} 0 0 ${n(height)} ${n(x)} ${n(PAGE_HEIGHT - top - height)} cm /${image.name} Do Q`); }

  text(value, x, top, size, options = {}) {
    const font = options.font === "semibold" ? this.fonts.semibold : this.fonts.regular;
    const maxWidth = Number(options.maxWidth || 0);
    const lineHeight = Number(options.lineHeight || size * 1.24);
    const maxLines = Math.max(1, Number(options.maxLines || 1));
    const lines = maxLines > 1
      ? wrapText(font, value, size, maxWidth || Infinity, maxLines)
      : [maxWidth ? fitText(font, value, size, maxWidth) : font.sanitize(value)];
    lines.forEach((line, lineIndex) => {
      let drawX = x;
      const width = font.width(line, size, Number(options.letterSpacing || 0));
      if (options.align === "right") drawX -= width;
      else if (options.align === "center") drawX -= width / 2;
      const baseline = PAGE_HEIGHT - (top + lineIndex * lineHeight) - size;
      this.commands.push(`BT /${font === this.fonts.semibold ? "F2" : "F1"} ${n(size)} Tf ${pdfColor(options.color || this.palette.ink)} rg ${n(Number(options.letterSpacing || 0))} Tc 1 0 0 1 ${n(drawX)} ${n(baseline)} Tm <${font.encode(line)}> Tj ET`);
    });
  }
}

class PdfWriter {
  constructor() { this.objects = [null]; }
  reserve() { this.objects.push(null); return this.objects.length - 1; }
  set(id, body) { this.objects[id] = body; }
  add(body) { const id = this.reserve(); this.set(id, body); return id; }
  build(rootId, infoId) {
    const chunks = [];
    const offsets = new Array(this.objects.length).fill(0);
    let length = 0;
    const push = (value) => { const bytes = typeof value === "string" ? asciiBytes(value) : uint8(value); chunks.push(bytes); length += bytes.length; };
    push("%PDF-1.7\n"); push(new Uint8Array([37, 226, 227, 207, 211, 10]));
    for (let id = 1; id < this.objects.length; id += 1) {
      offsets[id] = length;
      push(`${id} 0 obj\n`);
      const body = this.objects[id];
      if (body && body.stream !== undefined) {
        const stream = uint8(body.stream);
        push(`<< ${body.dict || ""} /Length ${stream.length} >>\nstream\n`);
        push(stream);
        push("\nendstream");
      } else push(body || "<<>>");
      push("\nendobj\n");
    }
    const xrefOffset = length;
    push(`xref\n0 ${this.objects.length}\n0000000000 65535 f \n`);
    for (let id = 1; id < this.objects.length; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${this.objects.length} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    return concatBytes(chunks, length);
  }
}

class EmbeddedTrueTypeFont {
  constructor(writer, bytes, baseName) {
    this.writer = writer;
    this.bytes = uint8(bytes);
    this.metrics = parseTrueType(this.bytes);
    this.baseName = baseName;
    this.used = new Set([32, 63, 8230]);
    this.type0Id = writer.reserve();
    this.cidFontId = writer.reserve();
    this.descriptorId = writer.reserve();
    this.fontFileId = writer.reserve();
    this.toUnicodeId = writer.reserve();
    this.cidMapId = writer.reserve();
  }

  sanitize(value) {
    return Array.from(String(value ?? "—")).map((char) => {
      const code = char.codePointAt(0);
      if (code > 0xffff || (this.metrics.glyphId(code) === 0 && code !== 32)) return "?";
      return char;
    }).join("");
  }

  width(value, size, letterSpacing = 0) {
    const chars = Array.from(this.sanitize(value));
    const units = chars.reduce((sum, char) => sum + this.metrics.advance(char.codePointAt(0)), 0);
    return units / this.metrics.unitsPerEm * size + Math.max(0, chars.length - 1) * letterSpacing;
  }

  encode(value) {
    let result = "";
    for (const char of Array.from(this.sanitize(value))) {
      const code = char.codePointAt(0);
      this.used.add(code);
      result += code.toString(16).padStart(4, "0");
    }
    return result.toUpperCase();
  }

  finalize() {
    const scale = (value) => Math.round(value / this.metrics.unitsPerEm * 1000);
    const codes = [...this.used].sort((a, b) => a - b);
    const maxCode = codes[codes.length - 1] || 255;
    const cidMap = new Uint8Array((maxCode + 1) * 2);
    codes.forEach((code) => {
      const glyph = this.metrics.glyphId(code);
      cidMap[code * 2] = glyph >>> 8;
      cidMap[code * 2 + 1] = glyph & 255;
    });
    const widths = widthArray(codes, (code) => scale(this.metrics.advance(code)));
    const bbox = this.metrics.bbox.map(scale).join(" ");
    this.writer.set(this.fontFileId, { stream: this.bytes, dict: `/Length1 ${this.bytes.length}` });
    this.writer.set(this.descriptorId, `<< /Type /FontDescriptor /FontName /${this.baseName} /Flags 32 /FontBBox [${bbox}] /ItalicAngle 0 /Ascent ${scale(this.metrics.ascent)} /Descent ${scale(this.metrics.descent)} /CapHeight ${scale(this.metrics.ascent)} /StemV 80 /FontFile2 ${this.fontFileId} 0 R >>`);
    this.writer.set(this.cidMapId, { stream: cidMap, dict: "" });
    this.writer.set(this.cidFontId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${this.baseName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${this.descriptorId} 0 R /DW 500 /W [${widths}] /CIDToGIDMap ${this.cidMapId} 0 R >>`);
    this.writer.set(this.toUnicodeId, { stream: asciiBytes(toUnicodeCMap(codes)), dict: "" });
    this.writer.set(this.type0Id, `<< /Type /Font /Subtype /Type0 /BaseFont /${this.baseName} /Encoding /Identity-H /DescendantFonts [${this.cidFontId} 0 R] /ToUnicode ${this.toUnicodeId} 0 R >>`);
  }
}

function parseTrueType(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map();
  const tableCount = view.getUint16(4);
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    const tag = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    tables.set(tag, { offset: view.getUint32(offset + 8), length: view.getUint32(offset + 12) });
  }
  for (const required of ["head", "hhea", "hmtx", "maxp", "cmap"]) if (!tables.has(required)) throw new Error(`PDF yazı tipi ${required} tablosunu içermiyor.`);
  const head = tables.get("head").offset;
  const hhea = tables.get("hhea").offset;
  const hmtx = tables.get("hmtx").offset;
  const maxp = tables.get("maxp").offset;
  const unitsPerEm = view.getUint16(head + 18);
  const ascent = view.getInt16(hhea + 4);
  const descent = view.getInt16(hhea + 6);
  const bbox = [view.getInt16(head + 36), view.getInt16(head + 38), view.getInt16(head + 40), view.getInt16(head + 42)];
  const hMetricCount = view.getUint16(hhea + 34);
  const glyphCount = view.getUint16(maxp + 4);
  const advances = new Uint16Array(glyphCount);
  let lastAdvance = unitsPerEm;
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    if (glyph < hMetricCount) lastAdvance = view.getUint16(hmtx + glyph * 4);
    advances[glyph] = lastAdvance;
  }
  const glyphId = cmapLookup(view, tables.get("cmap").offset);
  return Object.freeze({ unitsPerEm, ascent, descent, bbox, glyphId, advance: (code) => advances[glyphId(code)] || advances[0] || unitsPerEm / 2 });
}

function cmapLookup(view, cmapOffset) {
  const count = view.getUint16(cmapOffset + 2);
  let chosen = null;
  for (let index = 0; index < count; index += 1) {
    const record = cmapOffset + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const offset = cmapOffset + view.getUint32(record + 4);
    const format = view.getUint16(offset);
    const score = format === 12 ? (platform === 3 && encoding === 10 ? 40 : 30) : format === 4 ? (platform === 3 ? 20 : 10) : 0;
    if (score && (!chosen || score > chosen.score)) chosen = { offset, format, score };
  }
  if (!chosen) throw new Error("PDF yazı tipi desteklenen Unicode cmap tablosunu içermiyor.");
  if (chosen.format === 12) {
    const groupCount = view.getUint32(chosen.offset + 12);
    return (code) => {
      let low = 0, high = groupCount - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const group = chosen.offset + 16 + mid * 12;
        const start = view.getUint32(group), end = view.getUint32(group + 4);
        if (code < start) high = mid - 1;
        else if (code > end) low = mid + 1;
        else return view.getUint32(group + 8) + code - start;
      }
      return 0;
    };
  }
  const segCount = view.getUint16(chosen.offset + 6) / 2;
  const endCodes = chosen.offset + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const deltas = startCodes + segCount * 2;
  const ranges = deltas + segCount * 2;
  return (code) => {
    if (code > 0xffff) return 0;
    for (let segment = 0; segment < segCount; segment += 1) {
      const end = view.getUint16(endCodes + segment * 2);
      if (code > end) continue;
      const start = view.getUint16(startCodes + segment * 2);
      if (code < start) return 0;
      const delta = view.getInt16(deltas + segment * 2);
      const range = view.getUint16(ranges + segment * 2);
      if (!range) return (code + delta) & 0xffff;
      const glyphOffset = ranges + segment * 2 + range + (code - start) * 2;
      const glyph = view.getUint16(glyphOffset);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
}

function widthArray(codes, widthFor) {
  const groups = [];
  let current = [];
  codes.forEach((code) => {
    if (!current.length || code === current[current.length - 1] + 1) current.push(code);
    else { groups.push(current); current = [code]; }
  });
  if (current.length) groups.push(current);
  return groups.map((group) => `${group[0]} [${group.map(widthFor).join(" ")}]`).join(" ");
}

function toUnicodeCMap(codes) {
  const lines = [
    "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Paket3Unicode def", "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"
  ];
  for (let index = 0; index < codes.length; index += 100) {
    const batch = codes.slice(index, index + 100);
    lines.push(`${batch.length} beginbfchar`);
    batch.forEach((code) => lines.push(`<${hex4(code)}> <${hex4(code)}>`));
    lines.push("endbfchar");
  }
  lines.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
  return lines.join("\n");
}

function fitText(font, value, size, maxWidth) {
  const sanitized = font.sanitize(value);
  if (font.width(sanitized, size) <= maxWidth) return sanitized;
  const chars = Array.from(sanitized);
  while (chars.length && font.width(`${chars.join("")}…`, size) > maxWidth) chars.pop();
  return chars.length ? `${chars.join("")}…` : "…";
}

function wrapText(font, value, size, maxWidth, maxLines) {
  const words = font.sanitize(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || font.width(candidate, size) <= maxWidth) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push("—");
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(font, lines.slice(maxLines - 1).join(" "), size, maxWidth);
    return kept;
  }
  return lines.map((line) => fitText(font, line, size, maxWidth));
}

function browserThemeTokens() {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return {};
  const root = getComputedStyle(document.documentElement);
  const body = document.body ? getComputedStyle(document.body) : null;
  return new Proxy({}, { get: (_target, name) => root.getPropertyValue(name) || body?.getPropertyValue(name) || "" });
}

function readColor(source, key, fallback) {
  const raw = typeof source?.getPropertyValue === "function" ? source.getPropertyValue(key) : source?.[key];
  return parseColor(raw || fallback).hex;
}

function ensureUsablePrimary(value) {
  const color = parseColor(value).hex;
  if (relativeLuminance(parseColor(color)) > 0.88) return mixHex(color, "#000000", 0.45);
  return color;
}

function ensureContrast(candidate, background, minimum) {
  const color = parseColor(candidate).hex;
  if (colorContrastRatio(color, background) >= minimum) return color;
  const black = colorContrastRatio("#111827", background);
  const white = colorContrastRatio("#ffffff", background);
  return black >= white ? "#111827" : "#ffffff";
}

function parseColor(value) {
  const raw = String(value || "").trim().toLowerCase();
  let red, green, blue;
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    red = parseInt(raw[1] + raw[1], 16); green = parseInt(raw[2] + raw[2], 16); blue = parseInt(raw[3] + raw[3], 16);
  } else if (/^#[0-9a-f]{6}$/.test(raw)) {
    red = parseInt(raw.slice(1, 3), 16); green = parseInt(raw.slice(3, 5), 16); blue = parseInt(raw.slice(5, 7), 16);
  } else {
    const parts = raw.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    [red, green, blue] = parts?.length === 3 ? parts : [98, 82, 116];
  }
  const rgb = [red, green, blue].map((item) => Math.max(0, Math.min(255, Math.round(item))));
  return { rgb, hex: `#${rgb.map((item) => item.toString(16).padStart(2, "0")).join("")}` };
}

function mixHex(first, second, amount) {
  const a = parseColor(first).rgb, b = parseColor(second).rgb;
  return parseColor(`rgb(${a.map((value, index) => value * (1 - amount) + b[index] * amount).join(",")})`).hex;
}

function relativeLuminance(color) {
  const channels = color.rgb.map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

async function fetchFont(url, timeoutMs) {
  if (typeof fetch !== "function") throw new Error("PDF yazı tipi yüklenemedi.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "force-cache", signal: controller.signal });
    if (!response.ok) throw new Error(`PDF yazı tipi yüklenemedi (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  } finally { clearTimeout(timeout); }
}

function canvasToJpegBlob(canvas, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Ek belge görseli zamanında hazırlanamadı.")), timeoutMs);
    canvas.toBlob((blob) => {
      clearTimeout(timeout);
      if (blob) resolve(blob); else reject(new Error("Ek belge görseli hazırlanamadı."));
    }, "image/jpeg", 0.91);
  });
}

function promiseWithTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then((value) => { clearTimeout(timeout); resolve(value); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}

function roundedRectPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const k = 0.5522847498, c = r * k;
  return `${n(x + r)} ${n(y)} m ${n(x + width - r)} ${n(y)} l ${n(x + width - r + c)} ${n(y)} ${n(x + width)} ${n(y + r - c)} ${n(x + width)} ${n(y + r)} c ${n(x + width)} ${n(y + height - r)} l ${n(x + width)} ${n(y + height - r + c)} ${n(x + width - r + c)} ${n(y + height)} ${n(x + width - r)} ${n(y + height)} c ${n(x + r)} ${n(y + height)} l ${n(x + r - c)} ${n(y + height)} ${n(x)} ${n(y + height - r + c)} ${n(x)} ${n(y + height - r)} c ${n(x)} ${n(y + r)} l ${n(x)} ${n(y + r - c)} ${n(x + r - c)} ${n(y)} ${n(x + r)} ${n(y)} c h`;
}

function shipmentQuantityText(item) {
  const bulkUnit = item.bulkUnitSnapshot || item.bulkUnit || item.purchaseUnit || item.unit || "";
  if (item.quantityBase === undefined || item.quantityBase === null) return `${formatNumber(Number(item.quantityBulk ?? item.quantity ?? 0))} ${bulkUnit}`.trim();
  const bulk = Number(item.quantityBulk || 0), base = Number(item.quantityBase || 0);
  const baseUnit = item.baseUnitSnapshot || item.baseUnit || item.unit || "";
  return [bulk > 0 ? `${formatNumber(bulk)} ${bulkUnit}`.trim() : "", base > 0 ? `${formatNumber(base)} ${baseUnit}`.trim() : ""].filter(Boolean).join(" + ") || `0 ${baseUnit}`.trim();
}

function unitPriceSuffix(item) {
  const unit = String(item.bulkUnitSnapshot || item.bulkUnit || item.purchaseUnit || item.unit || "").trim();
  return unit ? ` / ${unit}` : "";
}

function shipmentTotal(shipment) { return (shipment.items || []).reduce((sum, item) => sum + Number(item.totalKurus || item.lineTotalKurus || 0), 0); }
function shipmentDate(shipment) { return shipment.shipmentDate || shipment.documentDate || shipment.createdAt || ""; }
function shipmentDateKey(shipment) { const value = String(shipmentDate(shipment)); return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : toDateKey(value); }
function numericDate(value) { const key = /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : toDateKey(value); return key ? `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}` : "tarihsiz"; }
function toDateKey(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function localDateFromParts(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day, 12, 0, 0, 0); }
function safeFilePart(value, fallback) { return String(value || fallback).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/İ/g, "I").replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U").replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O").replace(/ç/g, "c").replace(/Ç/g, "C").replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || fallback; }
function formatMoney(kurus) { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2 }).format(Number(kurus || 0) / 100); }
function formatNumber(value) { return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value || 0)); }
function contain(sourceWidth, sourceHeight, maxWidth, maxHeight) { const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight); return { width: sourceWidth * scale, height: sourceHeight * scale }; }
function pdfColor(value) { return parseColor(value).rgb.map((item) => n(item / 255)).join(" "); }
function n(value) { return Number(value).toFixed(3).replace(/\.000$/, "").replace(/(\.\d*?)0+$/, "$1"); }
function hex4(value) { return Number(value).toString(16).padStart(4, "0").toUpperCase(); }
function asciiBytes(value) { return new TextEncoder().encode(String(value)); }
function uint8(value) { return value instanceof Uint8Array ? value : new Uint8Array(value || 0); }
function concatBytes(chunks, length) { const output = new Uint8Array(length); let offset = 0; chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.length; }); return output; }
function pdfDate(date) { return `D:${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`; }
function pdfUnicodeString(value) { let hex = "FEFF"; for (let index = 0; index < String(value).length; index += 1) hex += String(value).charCodeAt(index).toString(16).padStart(4, "0"); return `<${hex.toUpperCase()}>`; }
