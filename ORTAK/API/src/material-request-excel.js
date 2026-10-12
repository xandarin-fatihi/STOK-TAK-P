"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const ExcelJS = require("exceljs");
const sharp = require("sharp");
const TEMPLATE = path.join(__dirname, "../assets/material-request-template.xlsx");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function itemStatus(request, item) {
  return item.decisionStatus || request.status || "onay_bekliyor";
}

function pendingItems(request) {
  return (request.items || []).filter(item => itemStatus(request, item) === "onay_bekliyor");
}

function updateRequestStatus(request) {
  const statuses = (request.items || []).map(item => itemStatus(request, item));
  // Kısmi onayda talep açık kalır; önceki onaylar kalemlerde korunur.
  request.status = statuses.includes("onay_bekliyor") ? "onay_bekliyor"
    : statuses.every(status => status === "reddedildi") ? "reddedildi" : "onaylandı";
}

function requesterName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw fail("Talep eden kişinin adını yazın (en fazla 120 karakter).");
  return name;
}

function selectionSnapshot(data, selections) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 500) throw fail("1–500 malzeme kalemi seçin.");
  const keys = new Set();
  return selections.map(line => {
    if (!line || typeof line !== "object" || Array.isArray(line) || typeof line.requestId !== "string" || typeof line.itemId !== "string") throw fail("Geçerli bir malzeme kalemi seçin.");
    const request = (data.workforceMaterialRequests || []).find(r => r.id === line.requestId);
    const item = request && (request.items || []).find(i => i.id === line.itemId);
    if (!item) throw fail("Seçilen malzeme talebi bulunamadı.", 404);
    const key = JSON.stringify([request.id, item.id]);
    if (keys.has(key)) throw fail("Aynı kalem birden fazla seçilemez.");
    keys.add(key);
    if (itemStatus(request, item) !== "onay_bekliyor") throw fail("Seçilen kalem daha önce işleme alınmış. Listeyi yenileyin.", 409);
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000000) throw fail(`${item.name} için pozitif tam sayı girin.`);
    const user = (data.recipeUsers || []).find(u => u.id === request.personId);
    const locationId = request.depotId || user && user.stockLocationId;
    const depot = (data.stockState && data.stockState.locations || []).find(l => l.id === locationId);
    const productId = item.linkedProductId || item.stockProductId;
    const product = (data.stockState && data.stockState.products || []).find(p => p.id === productId);
    return {
      requestId: request.id, itemId: item.id, requestNumber: request.requestNumber,
      personId: request.personId, personName: request.personName,
      department: String(depot && depot.name || request.depotName || request.department || "Depo belirtilmedi"),
      name: item.name, code: String(product && product.productCode || item.code || ""),
      imageUrl: String(item.imageUrl || product && product.imageUrl || ""),
      requestedQuantity: item.quantity, quantity, unit: "adet",
      supplier: item.supplier || "", usageLocation: item.usageLocation || depot && depot.name || request.depotName || request.department || "",
      neededDate: item.neededDate || "", description: item.description || ""
    };
  });
}

function turkeyDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const get = type => parts.find(part => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

async function localImage(url, options) {
  let filename;
  // Yalnız sunucunun kendi görselleri; kullanıcı URL'sine ağ isteği yapılmaz.
  if (/^\/media\/[a-zA-Z0-9._/-]+$/.test(url)) {
    const root = url.startsWith("/media/products/") ? path.join(options.projectRoot, "ORTAK/VERİ/MEDIA/products") : options.mediaDir;
    const suffix = url.startsWith("/media/products/") ? url.slice(16) : url.slice(7);
    filename = path.resolve(root, suffix);
    if (!filename.startsWith(path.resolve(root) + path.sep)) return null;
  } else if (/^\/assets\/images\/[a-zA-Z0-9._/-]+$/.test(url)) {
    const root = path.join(options.projectRoot, "ORTAK/ASSETS/IMAGES");
    filename = path.resolve(root, url.slice(15));
    if (!filename.startsWith(path.resolve(root) + path.sep)) return null;
  } else return null;
  try {
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 15 * 1024 * 1024) return null;
    // PNG'ye dönüştürme WebP desteğini ve doğal oranı korur, XLSX'i şişirmez.
    const buffer = await sharp(await fs.readFile(filename), { limitInputPixels: 40000000 })
      .rotate().resize(100, 100, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(buffer).metadata();
    return { buffer, width: meta.width, height: meta.height };
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
    // Eski/bozuk tek bir görsel malzeme bilgisinin çıktısını engellemez.
    return null;
  }
}

async function buildMaterialRequestExcel(batch, options = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE);
  const template = workbook.worksheets[0];
  const original = structuredClone(template.model);
  const dateKey = turkeyDate(options.now || new Date());
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const groups = new Map();
  for (const line of batch.lines) {
    if (!groups.has(line.department)) groups.set(line.department, []);
    groups.get(line.department).push(line);
  }
  let page = 0;
  const imageCache = new Map();
  for (const [department, lines] of groups) for (let start = 0; start < lines.length; start += 20) {
    page++;
    const sheet = page === 1 ? template : workbook.addWorksheet(`Talep Formu ${page}`);
    if (page > 1) sheet.model = { ...structuredClone(original), id: sheet.id, name: sheet.name };
    sheet.name = `Talep Formu ${page}`;
    sheet.getCell("C2").value = date; sheet.getCell("C2").numFmt = "dd.mm.yyyy";
    sheet.getCell("H2").value = department;
    const requestNumbers = [...new Set(lines.slice(start, start + 20).map(line => line.requestNumber))].join(", ");
    sheet.getCell("C3").value = requestNumbers;
    sheet.getCell("H3").value = batch.requesterName;
    sheet.getRow(3).height = Math.max(26, Math.ceil(Math.max(requestNumbers.length / 60, batch.requesterName.length / 85)) * 12 + 8);
    const portion = lines.slice(start, start + 20);
    for (let i = 0; i < portion.length; i++) {
      const line = portion[i], row = i + 5;
      sheet.getCell(row, 2).value = line.supplier || null;
      sheet.getCell(row, 4).value = line.code || null;
      sheet.getCell(row, 5).value = line.name;
      sheet.getCell(row, 6).value = line.quantity;
      sheet.getCell(row, 7).value = "AD";
      sheet.getCell(row, 8).value = line.usageLocation || null;
      sheet.getCell(row, 9).value = line.neededDate ? new Date(`${line.neededDate}T00:00:00Z`) : null;
      sheet.getCell(row, 9).numFmt = "dd.mm.yyyy";
      sheet.getCell(row, 10).value = line.description || null;
      if (line.imageUrl && options.mediaDir && options.projectRoot) {
        if (!imageCache.has(line.imageUrl)) imageCache.set(line.imageUrl, await localImage(line.imageUrl, options));
        const image = imageCache.get(line.imageUrl);
        if (image) {
          const scale = Math.min(65 / image.width, 26 / image.height);
          const width = image.width * scale, height = image.height * scale;
          const id = workbook.addImage({ buffer: image.buffer, extension: "png" });
          sheet.addImage(id, { tl: { col: 2 + (88 - width) / 2 / 88, row: row - 1 + (32 - height) / 2 / 32 }, ext: { width, height }, editAs: "oneCell" });
        }
      }
    }
    sheet.getRow(26).height = 32;
    for (const cell of ["A26", "E26", "H26"]) sheet.getCell(cell).value = "Ad-Soyad\nİmza";
    // Yalnız yazdırılan formun hizalaması değişir; şablonun sarma ve diğer stilleri korunur.
    for (let row = 1; row <= 27; row++) for (let column = 1; column <= 11; column++) {
      const cell = sheet.getCell(row, column);
      cell.alignment = { ...cell.alignment, horizontal: "center", vertical: "middle" };
    }
    sheet.pageSetup = { ...sheet.pageSetup, paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1, printArea: "A1:K27", margins: { left: .2, right: .2, top: .25, bottom: .25, header: .1, footer: .1 } };
    sheet.views = [{ showGridLines: false }];
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { itemStatus, pendingItems, updateRequestStatus, requesterName, selectionSnapshot, turkeyDate, localImage, buildMaterialRequestExcel };
