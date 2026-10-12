"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const sharp = require("sharp");
const ExcelJS = require("exceljs");
const execute = promisify(execFile);
const error = (message, code = "DOCUMENT_SCAN_INVALID", status = 400) => Object.assign(new Error(message), {code, status, expose:true});
const fold = (value) => String(value || "").toLocaleLowerCase("tr-TR").replace(/ı/g,"i").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max);

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
}
function validateScanItems(input) {
  if (!Array.isArray(input) || !input.length || input.length > 200) throw error("En az bir, en fazla 200 malzeme seçin.");
  return input.map((item) => {
    if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 240 || typeof item.code !== "string" || item.code.length > 120 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000000000) throw error("Seçilen malzemelerin adını ve pozitif tam sayı miktarını kontrol edin.");
    return {name:clean(item.name,240), code:clean(item.code,120), quantity:item.quantity};
  });
}

// Geometric rows avoid relying on OCR's reading order, which often reads whole columns first.
function geometricRows(words) {
  const rows = [];
  for (const word of words.filter(w => w && typeof w.text === "string" && [w.x,w.y,w.width,w.height].every(Number.isFinite) && w.height > 0).sort((a,b) => a.y+a.height/2-b.y-b.height/2)) {
    const cy = word.y+word.height/2;
    let row = rows.find(r => Math.abs(r.cy-cy) < Math.max(7,Math.min(r.height,word.height)*.55));
    if (!row) { row = {cy, height:word.height, words:[]}; rows.push(row); }
    row.words.push(word);
  }
  return rows.map(row => ({...row, words:row.words.sort((a,b)=>a.x-b.x), text:row.words.sort((a,b)=>a.x-b.x).map(w=>w.text).join(" ")}));
}

function parseOcrDocument(result) {
  const rows = geometricRows(Array.isArray(result.words) ? result.words : []);
  const text = rows.map(r=>r.text).join("\n") || String(result.text || "");
  const dateMatch = text.match(/(?:tarih[i]?\s*[:：]?\s*)(\d{2})[./-](\d{2})[./-](\d{4})/i) || text.match(/\b(\d{2})[./-](\d{2})[./-](\d{4})\b/);
  let documentDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : "";
  if (documentDate && !validDate(documentDate)) documentDate = "";
  const no = text.match(/(?:irsaliye\s*(?:no(?:su)?|numaras[ıi])|belge\s*no)\s*[:：]?\s*([\w/-]+)/i);
  const items = [];
  let columns = null;
  let headerY = 0;
  const warnings = [];
  for (const row of rows) {
    const normalized = fold(row.text);
    if (/miktar|adet|quantity/.test(normalized) && /malzeme|urun|aciklama|cinsi|product/.test(normalized)) {
      const labels=[];
      for(const word of row.words) {
        const last=labels.at(-1);
        if(last && word.x-last.end < row.height*1.7) { last.text+=` ${word.text}`;last.end=word.x+word.width; }
        else labels.push({x:word.x,end:word.x+word.width,text:word.text});
      }
      const code = labels.find(w=>/kod|code/.test(fold(w.text)));
      const name = labels.find(w=>/malzeme|urun|aciklama|cinsi|product/.test(fold(w.text)) && w !== code);
      const quantity = labels.find(w=>/miktar|adet|quantity/.test(fold(w.text)));
      const unit = labels.find(w=>/^birim$/.test(fold(w.text)));
      // The beginning of each header column is the robust delimiter for left-aligned tables.
      if (name && quantity) {
        columns = {name:name.x-8, quantity:quantity.x-8, code:code?.x-8, unit:unit?.x-8};
        // Prices, totals and row numbers delimit cells too, but are not quantity/unit data.
        labels.filter(label=>![name,quantity,code,unit].includes(label)).forEach((label,index)=>{columns[`ignored${index}`]=label.x-8;});
        headerY = row.cy;
      }
      continue;
    }
    if (!columns || row.cy <= headerY) continue;
    if (/^(genel toplam|toplam|teslim|aciklama:|imza|kdv|ara toplam|yalniz)/.test(normalized)) { columns=null; continue; }
    const ordered = Object.entries(columns).filter(([,x])=>Number.isFinite(x)).sort((a,b)=>a[1]-b[1]);
    const cells = {};
    for (const word of row.words) {
      const column = ordered.filter(([,x])=>word.x >= x).at(-1)?.[0];
      if (column) (cells[column] ||= []).push(word.text);
    }
    const name = (cells.name || []).join(" ").trim();
    if (!name || !/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(name)) continue;
    const quantityText = (cells.quantity || []).join("");
    // 1.000 can mean one or one thousand. Do not silently guess a locale/grouping convention.
    const numeric = /^\d+(?:[.,]0{1,2})?$/.test(quantityText) ? Number(quantityText.replace(",",".")) : null;
    const quantity = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
    const unit = (cells.unit || []).join(" ");
    items.push({name:clean(name,240),code:clean((cells.code || []).join(" "),120),quantity,needsReview:true,warning:!quantity ? "Miktar okunamadı; kontrol edin." : unit && !/^(adet|ad\.?|pcs)$/i.test(unit) ? `Belgede birim ${unit}; miktarı kontrol edin.` : ""});
    if(items.length > 200) throw error("Belgede 200'den fazla satır var; belgeyi bölerek tarayın.");
  }
  if(!items.length) warnings.push("Malzeme tablosu tanınamadı. Belgeyi daha net çekin veya okunan metni kontrol ederek satır ekleyin.");
  if(!documentDate) warnings.push("Belge tarihi okunamadı; tarihi girin.");
  warnings.push("Yerel okuma sonuçlarını orijinal belgeyle karşılaştırın. Farklı irsaliye düzenleri yanlış okunabilir.");
  return {documentNumber:clean(no?.[1] || "",120),documentDate,items,text:clean(text,50000),warnings,engine:"windows-local-tr"};
}

let active = false;
async function scanDocument(buffer) {
  if (active) throw error("Bir belge okunuyor. Biraz sonra tekrar deneyin.","DOCUMENT_SCAN_BUSY",429);
  if (process.platform !== "win32") throw error("Yerel belge okuma bu sunucuda kullanılamıyor.","DOCUMENT_SCAN_UNAVAILABLE",503);
  if(!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 15*1024*1024) throw error("En fazla 15 MB bir fotoğraf seçin.");
  active = true;
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(),"sts-ocr-"));
    const imagePath = path.join(directory,"document.png");
    // Normalization is only for OCR. The original uploaded photo remains separate and unmodified.
    const metadata = await sharp(buffer,{limitInputPixels:60000000}).metadata();
    if (!['jpeg','png','webp'].includes(metadata.format)) throw error("Tarama için JPEG, PNG veya WebP fotoğraf seçin.");
    await sharp(buffer,{limitInputPixels:60000000}).rotate().resize({width:2400,height:2400,fit:"inside",withoutEnlargement:true}).flatten({background:"white"}).png().toFile(imagePath);
    const executable = path.join(process.env.SystemRoot || "C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");
    const {stdout} = await execute(executable,["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",path.join(__dirname,"document-ocr.ps1"),"-ImagePath",imagePath],{windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,encoding:"utf8"});
    return parseOcrDocument(JSON.parse(stdout.replace(/^\uFEFF/,"").trim()));
  } catch (cause) {
    if(cause.expose) throw cause;
    throw error("Fotoğraf okunamadı. Net bir JPEG/PNG deneyin; Türkçe Windows OCR dil paketinin kurulu olduğundan emin olun.","DOCUMENT_SCAN_FAILED",422);
  } finally {
    if(directory) await fs.rm(directory,{recursive:true,force:true});
    active=false;
  }
}

async function exportScanWorkbook(input) {
  const items = validateScanItems(input?.items);
  const date = String(input.documentDate || "");
  if(!validDate(date)) throw error("Geçerli bir belge tarihi girin.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "STS";
  const sheet = workbook.addWorksheet("Malzemeler");
  sheet.columns = [{width:8},{width:48},{width:25},{width:16}];
  sheet.mergeCells("A1:D1"); sheet.getCell("A1").value=clean(input.recordTitle || "İrsaliye malzemeleri",180);
  sheet.mergeCells("A2:B2");sheet.getCell("A2").value=`İrsaliye no: ${clean(input.documentNumber,120) || "—"}`;
  sheet.getCell("C2").value="Belge tarihi";sheet.getCell("D2").value=new Date(`${date}T12:00:00Z`);sheet.getCell("D2").numFmt="dd.mm.yyyy";
  sheet.getRow(4).values=["Sıra","Malzeme adı","Malzeme kodu","Miktar"];
  items.forEach((item,i)=>{sheet.getRow(i+5).values=[i+1,item.name,item.code,item.quantity];sheet.getRow(i+5).height=34;});
  sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{cell.alignment={horizontal:"center",vertical:"middle",wrapText:true};cell.font={name:"Arial",size:11};cell.border={bottom:{style:"thin",color:{argb:"FFD8CEC2"}}};}));
  sheet.getRow(1).height=32;sheet.getCell("A1").font={name:"Arial",size:16,bold:true};sheet.getRow(2).height=30;sheet.getRow(4).height=28;
  sheet.getRow(4).eachCell(cell=>{cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF333333"}};cell.font={name:"Arial",size:11,bold:true,color:{argb:"FFFFFFFF"}};});
  sheet.views=[{state:"frozen",ySplit:4}];sheet.autoFilter={from:"A4",to:`D${items.length+4}`};
  sheet.pageSetup={paperSize:9,orientation:"portrait",fitToPage:true,fitToWidth:1,fitToHeight:0};
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
module.exports = {scanDocument,parseOcrDocument,validateScanItems,exportScanWorkbook,validDate};
