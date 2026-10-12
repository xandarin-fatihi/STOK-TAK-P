"use strict";

// Length-prefixed metadata + file bytes: no public paths, base64 expansion, or multipart dependencies.
function decodeDocumentRecordBundle(buffer, { editing = false } = {}) {
  const fail = (message) => Object.assign(new Error(message), { status: 400, code: "DOCUMENT_BUNDLE_INVALID", expose: true });
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) throw fail("Belge yükleme paketi okunamadı.");
  const headerLength = buffer.readUInt32BE(0);
  if (headerLength < 2 || headerLength > 128*1024 || headerLength + 4 > buffer.length) throw fail("Belge başlığı geçersiz.");
  let header;
  try { header = JSON.parse(buffer.subarray(4, headerLength + 4).toString("utf8")); } catch (_) { throw fail("Belge başlığı okunamadı."); }
  if (!header || typeof header !== "object" || Array.isArray(header) || !Array.isArray(header.files)) throw fail("Belge paketi geçersiz.");
  if (header.files.length > 10 || (!editing && !header.files.length)) throw fail("En az bir, en fazla 10 dosya seçin.");
  const input = header.metadata;
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.recordTitle !== "string" || !input.recordTitle.trim() || input.recordTitle.length > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.documentDate || ""))) throw fail("Belge adı ve irsaliye tarihi zorunludur.");
  let offset = headerLength + 4;
  const files = header.files.map((file) => {
    if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || offset + file.size > buffer.length || typeof file.name !== "string" || file.name.length > 255 || typeof file.type !== "string" || file.type.length > 100) throw fail("Belge dosya sınırları geçersiz.");
    const result = { buffer: buffer.subarray(offset, offset + file.size), originalName: file.name, declaredMimeType: file.type };
    offset += file.size;
    return result;
  });
  if (offset !== buffer.length) throw fail("Belge paketinde fazladan veri var.");
  return { input: { recordTitle: input.recordTitle, documentDate: input.documentDate, documentNumber: input.documentNumber, shipmentIds: input.shipmentIds, scanItems: input.scanItems, documentType: "irsaliye", allowDuplicate: input.allowDuplicate === true }, files };
}

module.exports = { decodeDocumentRecordBundle };
