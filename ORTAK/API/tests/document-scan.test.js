"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const sharp = require("sharp");
const {scanDocument,parseOcrDocument,validateScanItems,exportScanWorkbook} = require("../src/document-scan");
const sampleSvg = `<svg width="1600" height="1100" xmlns="http://www.w3.org/2000/svg"><rect width="1600" height="1100" fill="white"/><g font-family="Arial" font-size="32" fill="black"><text x="100" y="100">İRSALİYE</text><text x="100" y="170">Tarih: 09.10.2026</text><text x="100" y="230">İrsaliye No: IRS-2026-0148</text><text x="100" y="350">Malzeme</text><text x="800" y="350">Kodu</text><text x="1150" y="350">Miktar</text><text x="100" y="440">Rulman 6204-2RS</text><text x="800" y="440">RUL-6204</text><text x="1150" y="440">6</text><text x="100" y="530">V Kayışı A42</text><text x="800" y="530">KYS-A42</text><text x="1150" y="530">4</text></g></svg>`;
test("yerel Türkçe fotoğraf okuma gerçek OCR ile iki satırı çıkarır",{skip:process.platform!=="win32"},async()=>{
  const image=await sharp(Buffer.from(sampleSvg)).png().toBuffer();
  const result=await scanDocument(image);
  assert.equal(result.documentDate,"2026-10-09");assert.equal(result.documentNumber,"IRS-2026-0148");
  assert.equal(result.items.length,2);assert.equal(result.items[0].quantity,6);assert.equal(result.items[1].quantity,4);
  assert.match(result.items[0].name,/Rulman/);assert.equal(result.items[0].code,"RUL-6204");
});
test("tanınmayan tablo ürün veya miktar uydurmaz",()=>{
  const result=parseOcrDocument({text:"Bulanık belge",words:[]});
  assert.deepEqual(result.items,[]);assert.equal(result.documentDate,"");assert.ok(result.warnings.length);
});
test("fiyatlı bakım irsaliyesinde beş miktar fiyatlardan ayrı okunur",{skip:process.platform!=="win32"},async()=>{
  const fs=require("node:fs/promises");const path=require("node:path");
  const image=await fs.readFile(path.resolve(__dirname,"fixtures/test-irsaliye-fiyatli.png"));
  const result=await scanDocument(image);
  assert.equal(result.documentDate,"2026-10-09");assert.equal(result.items.length,5);
  assert.deepEqual(result.items.map(item=>item.quantity),[6,4,3,20,5]);
  assert.deepEqual(result.items.map(item=>item.code),["RUL-6204","KYS-A42","RLE-24V","CVT-M8","GRS-400"]);
  assert.ok(result.items.every(item=>!item.warning));assert.match(result.text,/185,00/);
});
test("Excel yalnız seçilen düzenlenmiş satırları typed ve ortalanmış hücrelerle dışa aktarır",async()=>{
  const buffer=await exportScanWorkbook({recordTitle:"Test belge",documentDate:"2026-10-09",documentNumber:"001",items:[{name:"Rulman",code:"000123",quantity:5},{name:"=HYPERLINK(\"bad\")",code:"X",quantity:2}]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.getWorksheet("Malzemeler");
  assert.equal(sheet.getCell("C5").value,"000123");assert.equal(sheet.getCell("D5").value,5);assert.equal(sheet.getCell("D5").alignment.horizontal,"center");
  assert.equal(sheet.getCell("B6").type,ExcelJS.ValueType.String);assert.equal(sheet.getCell("D6").value,2);assert.equal(sheet.rowCount,6);
});
test("boş, ondalık, negatif, çok büyük miktar ve geçersiz tarihi reddeder",async()=>{
  for(const quantity of [0,-1,1.2,Infinity,1000000001,"5"]) assert.throws(()=>validateScanItems([{name:"Rulman",code:"X",quantity}]));
  assert.throws(()=>validateScanItems([]));
  await assert.rejects(()=>exportScanWorkbook({documentDate:"2026-02-31",items:[{name:"A",code:"",quantity:1}]}));
});
module.exports={sampleSvg};
