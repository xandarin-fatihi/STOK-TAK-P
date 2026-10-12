"use strict";

const crypto = require("crypto");
const { analyzePricingWorkbook, applyPricingImportPlan } = require("./pricing-excel");
const { migratePricingSystem, normalizeProductPricing, pricingOptionsForProduct } = require("./pricing");
const { isFormulaValueMissing } = require("./simple-xlsx");
const { isValidProductCode, normalizeProductCode } = require("./store/product-code-registry");
const { normalizeMenuState } = require("./store/migrations");

const WORKBOOKS = ["menu", "pricing"];
const IMPORT_DOMAINS = ["catalog"];
const AMBIGUOUS = Symbol("ambiguous-data-import-match");
const PRODUCT_CODE_HEADERS = ["ürün kodu", "urun kodu", "product code", "productcode", "sku"];

function analyzeDataImport(data, inputs, context = {}) {
  const now = context.now || new Date().toISOString();
  const analysisId = context.analysisId || `data-import-analysis-${crypto.randomUUID()}`;
  const workbooks = inputs && inputs.workbooks || {};
  const files = inputs && inputs.files || {};
  const staged = {
    menuState: normalizeMenuState(clone(data.menuState || {})),
    pricing: clone(data.pricing || {}),
    mappings: normalizeMappings(data.dataImportMappings),
    referenceRewrites: { menuProducts: {}, menuCategories: {} }
  };
  const report = baseReport();
  const archiveBaseline = scopedArchiveBaseline(data, workbooks);
  const changes = [];
  const issues = [];
  const scopes = [];
  const sharedContext = { now, analysisId, report, changes, issues };
  const selectedDomains = selectedImportDomains(workbooks);

  // Legacy katalog kusurları yalnız içe aktarılan domain içinde kanonikleştirilir.
  // Böylece örneğin stok aktarımı menüdeki eski bir mükerrer kayda bağımlı olmaz.
  consolidateExistingCatalog(staged, sharedContext, selectedDomains);

  if (workbooks.menu) {
    scopes.push("menu");
    analyzeMenuWorkbook(workbooks.menu, staged, { now, analysisId, report, changes, issues });
  }

  if (workbooks.pricing) {
    scopes.push("pricing");
    analyzePricing(workbooks.pricing, staged, { now, analysisId, report, changes, issues });
  }

  const pricingProjection = workbooks.menu || workbooks.pricing
    ? synchronizeProductPricingProjection(staged, {
      analysisId,
      menuSelected: Boolean(workbooks.menu),
      pricingSelected: Boolean(workbooks.pricing)
    })
    : { pendingImportedCodes: [] };
  if (workbooks.menu || workbooks.pricing) {
    report.missingPrices = Math.max(report.missingPrices, countProductsWithoutPrice(staged.menuState));
  }
  report.pricePendingProducts = pricingProjection.pendingImportedCodes.length;
  if (workbooks.menu && pricingProjection.pendingImportedCodes.length) {
    const issue = {
      workbook: "menu",
      sheet: "",
      row: 0,
      productCode: "",
      code: "price_pending",
      severity: workbooks.pricing ? "error" : "warning",
      message: workbooks.pricing
        ? `${pricingProjection.pendingImportedCodes.length} yeni ürünün Fiyat Excel'inde geçerli fiyat seçeneği bulunamadı.`
        : `${pricingProjection.pendingImportedCodes.length} yeni ürün fiyat dosyası uygulanana kadar “fiyat bekliyor” durumunda oluşturulacak.`
    };
    issues.push(issue);
  }
  report.manualInactive = report.manualInactivePreserved;

  report.fileCount = scopes.length;
  report.changeCount = changes.length;
  report.warningCount = issues.filter((item) => item.severity === "warning").length;
  report.errorCount = issues.filter((item) => item.severity !== "warning").length;
  report.blockingErrors = report.errorCount;
  report.archiveBaseline = archiveBaseline;
  report.archiveRatio = archiveBaseline > 0 ? Number((report.archived / archiveBaseline).toFixed(4)) : 0;
  report.requiresArchiveConfirmation = report.archived > 0 && report.archiveRatio >= 0.35;
  const domains = buildDomainReadiness(data, workbooks, scopes, changes, issues);
  report.canApply = Object.values(domains).some((domain) => domain.canApply);

  const importScopes = normalizeFingerprintScopes(scopes);
  return {
    analysisId,
    expectedRevision: importRevision(data),
    fingerprintVersion: 2,
    expectedFingerprint: catalogFingerprint(data, importScopes),
    expectedProductCodeFingerprint: productCodeFingerprint(data, importScopes),
    files: WORKBOOKS.filter((key) => files[key]).map((key) => ({
      workbook: key,
      filename: files[key].filename,
      hash: files[key].hash,
      size: files[key].size
    })),
    scopes: importScopes,
    domains,
    expectedDomainRevisions: domainRevisionSnapshot(data, Object.keys(domains).filter((domain) => domains[domain].selected)),
    expectedDomainFingerprints: domainFingerprintSnapshot(data, Object.keys(domains).filter((domain) => domains[domain].selected)),
    expectedDomainProductCodeFingerprints: domainProductCodeFingerprintSnapshot(data, Object.keys(domains).filter((domain) => domains[domain].selected)),
    report,
    changes: changes.slice(0, 10000),
    issues: issues.slice(0, 5000),
    plan: {
      menuState: staged.menuState,
      pricing: staged.pricing,
      mappings: staged.mappings,
      readbackManifest: buildImportReadbackManifest(staged, importScopes)
    }
  };
}

function analyzeMenuWorkbook(workbook, staged, ctx) {
  const rows = workbookRows(workbook, "menu", ctx);
  const menu = staged.menuState;
  const categoryByName = groupedIndex(menu.categories, (item) => normalizeSourceName(item.name));
  const seenProducts = new Set();
  const seenCategories = new Set();
  const workbookKeys = new Set();

  for (const source of rows) {
    const productName = cell(source.row, ["ürün adı", "urun adi", "ürün", "urun", "product", "product name"]);
    if (isPlaceholderName(productName) || (!productName && isBlankTemplateRow(source.row))) continue;
    const codeInfo = readProductCode(source, ctx, "menu");
    if (codeInfo.invalid) continue;
    const productCode = codeInfo.code;
    if (!productName) {
      addIssue(ctx, "menu", source, "missing_product_name", "Ürün adı boş.");
      continue;
    }
    const categoryName = String(source.sheet || "").trim();
    const sheetKey = normalizeSourceName(categoryName);
    const productKey = normalizeSourceName(productName);
    const sourceKey = productCode ? `code\u0000${productCode}` : `${sheetKey}\u0000${productKey}`;
    if (workbookKeys.has(sourceKey)) {
      addIssue(ctx, "menu", source, productCode ? "duplicate_product_code" : "ambiguous_duplicate", productCode
        ? `“${productCode}” Ürün Kodu menü Excel'i içinde birden fazla kez bulundu.`
        : "Aynı kategori ve ürün Excel içinde birden fazla kez bulundu.");
      continue;
    }
    workbookKeys.add(sourceKey);

    let category = resolveImportCandidate({
      candidates: categoryByName.get(sheetKey),
      allItems: menu.categories,
      importKey: sourceImportKey("menu", source.sheet, categoryName),
      mappings: staged.mappings.menu,
      kind: "category",
      sheetKey,
      nameKey: sheetKey,
      ctx,
      workbook: "menu",
      source,
      message: "Kategori adı birden fazla mevcut kayıtla eşleşiyor."
    });
    if (category === AMBIGUOUS) continue;
    if (!category) {
      category = {
        id: generatedId("category"), name: categoryName, active: true, order: menu.categories.length,
        iconKey: "coffee", icon: "fa-mug-hot", products: [],
        ...sourceMetadata("menu", source.sheet, categoryName, ctx.now, ctx.analysisId, "excel_new")
      };
      menu.categories.push(category);
      pushIndex(categoryByName, sheetKey, category);
      ctx.report.newCategories += 1;
      addChange(ctx, "menu", categoryName, "", "kategori", null, categoryName, "create", "active", "excel");
    } else {
      category = menu.categories.find((item) => item.id === category.id);
      if (category.sourcePresent === false) {
        category.sourcePresent = true;
        if (category.statusSource === "excel_removed") {
          category.active = true;
          category.statusSource = "excel_returned";
          ctx.report.autoReactivated += 1;
        } else if (category.statusSource === "manual") {
          category.active = category.manualActive !== undefined ? category.manualActive !== false : category.active !== false;
        }
      }
      Object.assign(category, sourceMetadata("menu", source.sheet, categoryName, ctx.now, ctx.analysisId, category.statusSource || "excel_existing"));
      if (category.statusSource === "manual") {
        category.manualActive = category.active !== false;
      }
    }
    seenCategories.add(category.id);
    upsertMapping(staged.mappings.menu, "category", category.id, source.sheet, categoryName, ctx.now, ctx.analysisId);

    const productCandidates = (category.products || []).filter((item) => normalizeSourceName(item.name) === productKey);
    const allProducts = menu.categories.flatMap((item) => item.products || []);
    const externalId = productCode || String(cell(source.row, ["externalid", "external id", "importkey", "import key"]) || "").trim();
    let product;
    if (productCode) {
      const codeMatches = allProducts.filter((item) => normalizeProductCode(item.productCode) === productCode);
      if (codeMatches.length > 1) {
        addIssue(ctx, "menu", source, "duplicate_product_code", `“${productCode}” Ürün Kodu birden fazla kalıcı menü ürününe bağlı.`);
        continue;
      }
      product = codeMatches[0] || null;
      if (!product) {
        const migrationCandidates = productCandidates.filter((item) => !normalizeProductCode(item.productCode));
        if (migrationCandidates.length === 1) {
          product = migrationCandidates[0];
          product.nameHistory = uniqueStrings([...(product.nameHistory || []), product.name]);
        } else if (migrationCandidates.length > 1) {
          addIssue(ctx, "menu", source, "ambiguous_code_migration", `“${productCode}” kodu için birden fazla kodsuz eski ürün bulundu.`);
          continue;
        } else if (productCandidates.some((item) => normalizeProductCode(item.productCode) && normalizeProductCode(item.productCode) !== productCode)) {
          addIssue(ctx, "menu", source, "same_name_different_code", `“${productName}” adı farklı bir Ürün Kodu ile de kullanılıyor; “${productCode}” ayrı ürün olarak korunacak.`, "warning");
        }
      }
    } else {
      product = resolveImportCandidate({
        candidates: productCandidates,
        allItems: allProducts,
        externalId,
        importKey: sourceImportKey("menu", source.sheet, productName),
        mappings: staged.mappings.menu,
        kind: "product",
        sheetKey,
        nameKey: productKey,
        ctx,
        workbook: "menu",
        source,
        message: "Ürün adı birden fazla mevcut kayıtla eşleşiyor."
      });
    }
    if (product === AMBIGUOUS) continue;
    if (product && productCode && !category.products.includes(product)) {
      const previousCategory = menu.categories.find((item) => (item.products || []).includes(product));
      if (previousCategory) previousCategory.products = previousCategory.products.filter((item) => item !== product);
      category.products.push(product);
      addChange(ctx, "menu", categoryName, productName, "kategori", previousCategory && previousCategory.name || "", categoryName, "move", "unchanged", "excel", productCode);
    }
    const details = {
      ingredients: String(cell(source.row, ["ürün içeriği", "urun icerigi", "içerik", "icerik", "ingredients"]) || "").trim()
    };

    if (!product) {
      product = {
        id: generatedId("product"), name: String(productName).trim(), active: true, order: category.products.length,
        desc: "", stock: "active", image: "", imageUrl: "", pricing: { typeId: "standard", values: {} },
        manualContent: details.ingredients, details,
        ...(externalId ? { externalId } : {}),
        ...(productCode ? { productCode } : {}),
        ...sourceMetadata("menu", source.sheet, productName, ctx.now, ctx.analysisId, "excel_new")
      };
      category.products.push(product);
      ctx.report.newProducts += 1;
      addChange(ctx, "menu", categoryName, product.name, "ürün", null, product.name, "create", "active", "excel", productCode);
    } else {
      const previous = { name: product.name, details: product.details || {}, manualContent: product.manualContent || "" };
      const returned = product.sourcePresent === false;
      if (productCode && normalizeSourceName(previous.name) !== productKey) {
        product.nameHistory = uniqueStrings([...(product.nameHistory || []), previous.name]);
      }
      product.name = String(productName).trim();
      if (productCode) {
        product.productCode = productCode;
        product.externalId = productCode;
      }
      product.details = details;
      product.manualContent = details.ingredients;
      product.sourcePresent = true;
      if (returned) {
        ctx.report.rediscovered += 1;
        if (product.statusSource === "excel_removed") {
          product.active = true;
          product.statusSource = "excel_returned";
          ctx.report.autoReactivated += 1;
        } else if (product.statusSource === "manual") {
          product.active = product.manualActive !== undefined ? product.manualActive !== false : product.active !== false;
        }
      }
      Object.assign(product, sourceMetadata("menu", source.sheet, productName, ctx.now, ctx.analysisId, product.statusSource || "excel_existing"));
      if (product.statusSource === "manual") {
        product.statusSource = "manual";
        product.manualActive = product.active !== false;
        if (!product.active) ctx.report.manualInactivePreserved += 1;
      }
      const fields = [["name", previous.name, product.name], ["ingredients", previous.manualContent, details.ingredients]];
      const changedFields = fields.filter(([, oldValue, newValue]) => String(oldValue) !== String(newValue));
      if (changedFields.length) {
        ctx.report.updatedProducts += 1;
        changedFields.forEach(([field, oldValue, newValue]) => addChange(ctx, "menu", categoryName, product.name, field, oldValue, newValue, "update", product.active ? "unchanged-active" : "unchanged-passive", product.statusSource === "manual" ? "manager" : "excel", productCode));
      } else ctx.report.unchanged += 1;
    }
    if (productCode) ctx.report.codeMatches += 1;
    seenProducts.add(product.id);
    upsertMapping(staged.mappings.menu, "product", product.id, source.sheet, productName, ctx.now, ctx.analysisId, productCode);
  }

  for (const category of menu.categories) {
    for (const product of category.products || []) {
      if (seenProducts.has(product.id) || product.sourceType === "manual") continue;
      if (product.sourcePresent !== false || product.active !== false || product.statusSource !== "excel_removed") {
        const manuallyOwned = product.statusSource === "manual";
        if (manuallyOwned && product.sourcePresent !== false) product.manualActive = product.active !== false;
        product.sourcePresent = false;
        product.active = manuallyOwned ? product.manualActive !== false : false;
        product.statusSource = manuallyOwned ? "manual" : "excel_removed";
        product.lastImportedAt = ctx.now;
        product.lastImportOperationId = ctx.analysisId;
        ctx.report.removed += 1;
        ctx.report.archived += 1;
        addChange(ctx, "menu", category.name, product.name, "sourcePresent", true, false, "archive", manuallyOwned ? "manager-status-preserved" : "deactivate", manuallyOwned ? "manager" : "excel", product.productCode);
      }
    }
    if (!seenCategories.has(category.id) && category.sourceType !== "manual"
      && (category.sourceWorkbook === "menu" || category.sourceType === "legacy" || category.sourceType === "excel")) {
      const manuallyOwned = category.statusSource === "manual";
      if (manuallyOwned && category.sourcePresent !== false) category.manualActive = category.active !== false;
      category.sourcePresent = false;
      category.active = manuallyOwned ? category.manualActive !== false : false;
      category.statusSource = manuallyOwned ? "manual" : "excel_removed";
    }
  }
  const migrated = migratePricingSystem(staged.pricing, menu);
  staged.menuState = migrated.menuState;
  staged.pricing = migrated.pricing;
}

function analyzePricing(workbook, staged, ctx) {
  const filteredWorkbook = withoutEmptyPricingTemplateRows(workbook);
  if (workbookHasProductCodeHeader(filteredWorkbook)) {
    analyzeCodePricingWorkbook(filteredWorkbook, staged, ctx);
    return;
  }
  const analysis = analyzePricingWorkbook(filteredWorkbook, staged.menuState, staged.pricing, { blankPolicy: "preserve" });
  for (const issue of analysis.issues || []) {
    ctx.issues.push({ ...issue, workbook: "pricing", severity: "error" });
  }
  ctx.report.readSheets += Number(analysis.report.sheetCount || 0);
  ctx.report.readRows += Number(analysis.report.rowCount || 0);
  ctx.report.missingPrices += Number(analysis.report.unmatchedProducts || 0);
  ctx.report.unmatchedPricing += Number(analysis.report.unmatchedProducts || 0);
  ctx.report.mixedPricingFamilies += Number(analysis.report.mixedPricingRows || 0);
  (analysis.changes || []).forEach((item) => {
    ctx.changes.push({
      workbook: "pricing", category: item.categoryName || "", product: item.productName || "",
      field: item.optionLabel || item.optionId || "fiyat", oldValue: item.oldPrice, newValue: item.newPrice,
      operation: "update", activeEffect: "unchanged", statusOwner: "manager"
    });
  });
  if ((analysis.issues || []).length === 0 && analysis.plan && analysis.plan.productUpdates.length) {
    const applied = applyPricingImportPlan({ menuState: staged.menuState, pricing: staged.pricing }, analysis.plan);
    staged.menuState = applied.menuState;
    staged.pricing = applied.pricing;
    ctx.report.updatedPrices += applied.changedRows.length;
  }
}

function withoutEmptyPricingTemplateRows(workbook) {
  const names = Array.isArray(workbook && workbook.SheetNames) ? workbook.SheetNames : [];
  const sheets = workbook && workbook.Sheets && typeof workbook.Sheets === "object" ? workbook.Sheets : {};
  let changed = false;
  const filteredSheets = { ...sheets };
  for (const sheet of names) {
    const rows = sheets[sheet];
    if (!Array.isArray(rows)) continue;
    const filtered = rows.filter((row) => !isBlankTemplateRow(row));
    if (filtered.length === rows.length) continue;
    filtered.headers = Array.isArray(rows.headers) ? [...rows.headers] : [];
    filteredSheets[sheet] = filtered;
    changed = true;
  }
  return changed ? { ...workbook, SheetNames: [...names], Sheets: filteredSheets } : workbook;
}

function analyzeCodePricingWorkbook(workbook, staged, ctx) {
  const rows = workbookRows(workbook, "pricing", ctx);
  staged.pricing = staged.pricing && typeof staged.pricing === "object" ? staged.pricing : { schemaVersion: 1, types: [] };
  if (!Array.isArray(staged.pricing.types)) staged.pricing.types = [];
  validatePricingOptionHeaders(workbook, staged.pricing, ctx);
  const products = (staged.menuState.categories || []).flatMap((category) => (category.products || []).map((product) => ({ category, product })));
  const byCode = groupedIndex(products, (item) => normalizeProductCode(item.product.productCode));
  const seenCodes = new Set();
  const batches = new Map();

  for (const source of rows) {
    const codeInfo = readProductCode(source, ctx, "pricing");
    if (!codeInfo.coded) {
      addIssue(ctx, "pricing", source, "invalid_product_code", "Kodlu fiyat çalışma kitabındaki her katalog sayfasında Ürün Kodu sütunu bulunmalıdır.");
      continue;
    }
    if (codeInfo.invalid) continue;
    const productCode = codeInfo.code;
    seenCodes.add(productCode);
    const matches = byCode.get(productCode) || [];
    if (matches.length !== 1) {
      addIssue(ctx, "pricing", source, matches.length ? "duplicate_product_code" : "unknown_product_code", matches.length
        ? `“${productCode}” Ürün Kodu birden fazla menü ürününe bağlı.`
        : `“${productCode}” Ürün Kodu menü kataloğunda bulunamadı.`);
      continue;
    }
    const { category, product } = matches[0];
    ctx.report.codeMatches += 1;
    const rowName = String(cell(source.row, ["ürün adı", "urun adi", "ürün", "urun", "product", "product name"]) || "").trim();
    if (rowName && normalizeSourceName(rowName) !== normalizeSourceName(product.name)) {
      addIssue(ctx, "pricing", source, "product_name_alias", `“${productCode}” kodu menüde “${product.name}” adına bağlı; fiyat satırındaki “${rowName}” adı alias olarak değerlendirildi.`, "warning");
    }

    let batch = batches.get(productCode);
    if (!batch) {
      batch = { category, product, entries: new Map(), recognizedOptions: new Map() };
      batches.set(productCode, batch);
    }
    const rowOptionKeys = new Set();
    for (const { header, value: rawValue } of pricingCells(source.row)) {
      const option = pricingOptionFromHeader(header, staged.pricing);
      if (!option) continue;
      const optionKey = `${option.family}\u0000${option.optionId}`;
      // Duplicate physical headers are reported once by the sheet preflight.
      if (rowOptionKeys.has(optionKey)) continue;
      rowOptionKeys.add(optionKey);
      const empty = rawValue === "" || rawValue === null || rawValue === undefined;
      if (!batch.recognizedOptions.has(optionKey)) batch.recognizedOptions.set(optionKey, option);
      if (empty) continue;
      if (isFormulaValueMissing(rawValue)) {
        addIssue(ctx, "pricing", source, "invalid_price_value", `“${header}” formül hücresinin hesaplanmış sayısal değeri bulunamadı.`);
        continue;
      }
      const numeric = parseImportedPrice(rawValue);
      if (numeric === null || numeric < 0) {
        addIssue(ctx, "pricing", source, "invalid_price", `“${header}” fiyatı geçerli, negatif olmayan bir sayı olmalıdır.`);
        continue;
      }
      if (batch.entries.has(optionKey)) {
        addIssue(ctx, "pricing", source, "duplicate_price_option", `“${productCode}” kodu için “${option.label}” fiyat seçeneği birden fazla kez tanımlandı.`);
        continue;
      }
      batch.entries.set(optionKey, { ...option, price: numeric });
    }
  }

  for (const [productCode, batch] of batches) {
    const { category, product } = batch;
    const entries = [...batch.entries.values()];
    const current = normalizeProductPricing(product.pricing);
    const families = current.families.map((family) => ({ ...family, values: clone(family.values || {}) }));
    let changed = false;
    const incomingFamilies = [...new Set(entries.map((entry) => entry.family))];
    if (incomingFamilies.length > 1) {
      ctx.report.mixedPricingFamilies += 1;
      ctx.issues.push({
        workbook: "pricing",
        sheet: category.name,
        row: 0,
        productCode,
        code: "mixed_pricing_families",
        severity: "warning",
        message: `“${productCode}” için ${incomingFamilies.length} fiyat ailesi bulundu; bütün seçenekler korunarak deterministik birincil fiyat tipi seçildi.`
      });
    }
    for (const familyName of incomingFamilies) {
      const familyEntries = entries.filter((entry) => entry.family === familyName);
      const type = ensurePricingFamilyType(staged.pricing, familyName, familyEntries);
      let family = families.find((item) => item.typeId === type.id);
      if (!family) {
        family = { typeId: type.id, values: {} };
        families.push(family);
        changed = true;
      }
      for (const entry of familyEntries) {
        const previousValue = family.values[entry.optionId] || {};
        const previous = previousValue.price;
        const manualStatus = previousValue.statusSource === "manual";
        family.values[entry.optionId] = {
          ...previousValue,
          price: entry.price,
          active: manualStatus ? previousValue.active !== false : true,
          sourceType: "excel",
          sourceWorkbook: "pricing",
          sourcePresent: true,
          statusSource: manualStatus ? "manual" : (previousValue.sourcePresent === false ? "excel_returned" : "excel_existing"),
          lastImportedAt: ctx.now,
          lastImportOperationId: ctx.analysisId
        };
        if (Number(previous) !== entry.price) {
          changed = true;
          ctx.report.updatedPrices += 1;
          addChange(ctx, "pricing", category.name, product.name, entry.label, previous === undefined ? null : previous, entry.price, "update", "unchanged", manualStatus ? "manager" : "excel", productCode);
        } else if (!manualStatus && (previousValue.active === false || previousValue.sourcePresent === false)) {
          changed = true;
          ctx.report.rediscovered += 1;
          ctx.report.autoReactivated += 1;
          addChange(ctx, "pricing", category.name, product.name, entry.label, "arşiv", entry.price, "reactivate", "activate", "excel", productCode);
        }
      }
    }

    for (const [optionKey, option] of batch.recognizedOptions) {
      if (batch.entries.has(optionKey)) continue;
      const family = families.find((item) => item.typeId === option.family);
      const previousValue = family && family.values && family.values[option.optionId];
      if (!previousValue || previousValue.sourceType !== "excel" || previousValue.sourceWorkbook !== "pricing"
        || previousValue.sourcePresent === false || previousValue.statusSource === "manual") continue;
      family.values[option.optionId] = {
        ...previousValue,
        active: false,
        sourcePresent: false,
        statusSource: "excel_removed",
        lastImportedAt: ctx.now,
        lastImportOperationId: ctx.analysisId
      };
      changed = true;
      ctx.report.removed += 1;
      ctx.report.archived += 1;
      addChange(ctx, "pricing", category.name, product.name, option.label, previousValue.price, null, "archive", "deactivate", "excel", productCode);
    }

    const primary = choosePrimaryPricingFamily(families, staged.pricing);
    product.pricing = normalizeProductPricing({ typeId: primary.typeId, values: primary.values, families });
    if (!changed) ctx.report.unchanged += 1;
  }

  for (const { category, product } of products) {
    const productCode = normalizeProductCode(product.productCode);
    if (!productCode || seenCodes.has(productCode)) continue;
    const pricing = normalizeProductPricing(product.pricing);
    let changed = false;
    for (const family of pricing.families || []) {
      for (const [optionId, previousValue] of Object.entries(family.values || {})) {
        if (!previousValue || previousValue.sourceType !== "excel" || previousValue.sourceWorkbook !== "pricing"
          || previousValue.sourcePresent === false || previousValue.statusSource === "manual") continue;
        family.values[optionId] = {
          ...previousValue,
          active: false,
          sourcePresent: false,
          statusSource: "excel_removed",
          lastImportedAt: ctx.now,
          lastImportOperationId: ctx.analysisId
        };
        const option = (staged.pricing.types || []).find((type) => type.id === family.typeId)?.options?.find((item) => item.id === optionId);
        changed = true;
        ctx.report.removed += 1;
        ctx.report.archived += 1;
        addChange(ctx, "pricing", category.name, product.name, option && option.label || optionId, previousValue.price, null, "archive", "deactivate", "excel", productCode);
      }
    }
    if (changed) {
      const primary = choosePrimaryPricingFamily(pricing.families, staged.pricing);
      product.pricing = normalizeProductPricing({ ...pricing, typeId: primary.typeId, values: primary.values, families: pricing.families });
    }
  }

  const migrated = migratePricingSystem(staged.pricing, staged.menuState);
  staged.pricing = migrated.pricing;
  staged.menuState = migrated.menuState;
}

function validatePricingOptionHeaders(workbook, pricing, ctx) {
  for (const sheet of workbook && workbook.SheetNames || []) {
    const rows = workbook.Sheets && workbook.Sheets[sheet];
    const seen = new Map();
    for (const header of Array.isArray(rows && rows.headers) ? rows.headers : []) {
      const option = pricingOptionFromHeader(header, pricing);
      if (!option) continue;
      const key = `${option.family}\u0000${option.optionId}`;
      if (seen.has(key)) {
        addIssue(
          ctx,
          "pricing",
          { sheet: String(sheet), rowNumber: 1, productCode: "" },
          "duplicate_price_option",
          `“${seen.get(key)}” ve “${header}” sütunları aynı fiyat seçeneğini tekrar tanımlıyor.`
        );
      } else {
        seen.set(key, String(header));
      }
    }
  }
}

function pricingCells(row) {
  if (row && Array.isArray(row.__xlsxCells)) return row.__xlsxCells;
  return Object.entries(row || {}).map(([header, value], columnIndex) => ({ header, value, columnIndex }));
}

function choosePrimaryPricingFamily(families, pricing) {
  const source = Array.isArray(families) ? families : [];
  const orderByType = new Map((pricing && Array.isArray(pricing.types) ? pricing.types : [])
    .map((type, index) => [String(type.id), Number.isFinite(Number(type.order)) ? Number(type.order) : index]));
  const priced = source.filter((family) => Object.values(family && family.values || {}).some((value) => {
    const record = value && typeof value === "object" ? value : { price: value, active: true };
    return record.active !== false && record.sourcePresent !== false
      && record.price !== null && record.price !== "" && Number.isFinite(Number(record.price));
  }));
  return [...(priced.length ? priced : source)].sort((first, second) => (
    Number(orderByType.get(String(first.typeId)) ?? Number.MAX_SAFE_INTEGER)
      - Number(orderByType.get(String(second.typeId)) ?? Number.MAX_SAFE_INTEGER)
      || String(first.typeId).localeCompare(String(second.typeId))
  ))[0] || { typeId: "standard", values: {} };
}

function workbookHasProductCodeHeader(workbook) {
  for (const sheet of workbook && workbook.SheetNames || []) {
    const rows = workbook.Sheets && workbook.Sheets[sheet];
    const headers = Array.isArray(rows && rows.headers) ? rows.headers : [];
    if (headers.some((header) => PRODUCT_CODE_HEADERS.map(normalizeSourceName).includes(normalizeSourceName(header)))) return true;
  }
  return false;
}

function pricingOptionFromHeader(header, pricing) {
  const normalized = normalizeSourceName(header);
  const fixed = {
    k: { family: "size", optionId: "small", label: "Küçük", unit: "" },
    kucuk: { family: "size", optionId: "small", label: "Küçük", unit: "" },
    o: { family: "size", optionId: "medium", label: "Orta", unit: "" },
    orta: { family: "size", optionId: "medium", label: "Orta", unit: "" },
    b: { family: "size", optionId: "large", label: "Büyük", unit: "" },
    buyuk: { family: "size", optionId: "large", label: "Büyük", unit: "" },
    single: { family: "shot", optionId: "single", label: "Single", unit: "" },
    double: { family: "shot", optionId: "double", label: "Double", unit: "" },
    standart: { family: "standard", optionId: "standard", label: "Standart", unit: "" },
    standard: { family: "standard", optionId: "standard", label: "Standart", unit: "" }
  };
  if (fixed[normalized]) return fixed[normalized];
  const weight = normalized.match(/^(\d+(?:[.,]\d+)?)\s*(gr|g|kg)$/);
  if (weight) {
    const grams = Number(weight[1].replace(",", ".")) * (weight[2] === "kg" ? 1000 : 1);
    if (Number.isFinite(grams) && grams > 0) {
      return { family: "weight", optionId: `${String(grams).replace(".", "-")}-gr`, label: `${grams} GR`, unit: "gr", value: grams };
    }
  }
  for (const type of pricing && Array.isArray(pricing.types) ? pricing.types : []) {
    for (const option of Array.isArray(type.options) ? type.options : []) {
      if (normalizeSourceName(option.id) === normalized || normalizeSourceName(option.label) === normalized) {
        return { family: type.id, optionId: option.id, label: option.label, unit: option.unit || "", ...(option.value !== undefined ? { value: option.value } : {}) };
      }
    }
  }
  return null;
}

function parseImportedPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return null;
  text = text.replace(/(?:₺|\bTRY\b|\bTL\b)/gi, "").replace(/\s+/g, "");
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(text)) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (text.includes(",") && text.includes(".")) {
    const decimal = Math.max(text.lastIndexOf(","), text.lastIndexOf("."));
    const integer = text.slice(0, decimal).replace(/[.,]/g, "");
    const fraction = text.slice(decimal + 1).replace(/[.,]/g, "");
    text = `${integer}.${fraction}`;
  } else {
    text = text.replace(",", ".");
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function ensurePricingFamilyType(pricing, familyName, entries) {
  const typeId = familyName;
  let type = pricing.types.find((item) => item.id === typeId);
  if (!type) {
    type = {
      id: typeId,
      name: familyName === "weight" ? "Gramaj" : familyName,
      active: true,
      order: pricing.types.length,
      options: []
    };
    pricing.types.push(type);
  }
  if (!Array.isArray(type.options)) type.options = [];
  for (const entry of entries) {
    if (type.options.some((option) => option.id === entry.optionId)) continue;
    type.options.push({
      id: entry.optionId,
      label: entry.label,
      unit: entry.unit || "",
      ...(entry.value !== undefined ? { value: entry.value } : {}),
      order: type.options.length,
      active: true
    });
  }
  return type;
}

function consolidateExistingCatalog(staged, ctx) {
  const domains = arguments.length > 2 && arguments[2] instanceof Set ? arguments[2] : new Set();
  if (domains.has("catalog")) consolidateMenuCatalog(staged, ctx);
  rewriteMappingEntityIds(staged.mappings, staged.referenceRewrites);
  if (domains.has("catalog")) pruneStaleCatalogMappings(staged);
}

function pruneStaleCatalogMappings(staged) {
  const categoryIds = new Set();
  const productIds = new Set();
  const pricingIds = new Set();
  for (const category of staged.menuState && staged.menuState.categories || []) {
    collectEntityIdentity(categoryIds, category);
    for (const product of category.products || []) collectEntityIdentity(productIds, product);
  }
  for (const type of staged.pricing && staged.pricing.types || []) {
    collectEntityIdentity(pricingIds, type);
    for (const option of type.options || []) collectEntityIdentity(pricingIds, option);
  }
  const allIds = new Set([...categoryIds, ...productIds, ...pricingIds]);
  const mappings = staged.mappings || {};
  mappings.menu = (mappings.menu || []).filter((mapping) => {
    const id = String(mapping && mapping.entityId || "");
    if (!id) return false;
    if (mapping.kind === "category") return categoryIds.has(id);
    if (mapping.kind === "product") return productIds.has(id);
    return allIds.has(id);
  });
  mappings.pricing = (mappings.pricing || []).filter((mapping) => {
    const id = String(mapping && mapping.entityId || "");
    return Boolean(id) && (productIds.has(id) || pricingIds.has(id));
  });
}

function collectEntityIdentity(target, entity) {
  const id = String(entity && entity.id || "");
  if (id) target.add(id);
  for (const aliasId of Array.isArray(entity && entity.aliasIds) ? entity.aliasIds : []) {
    const alias = String(aliasId || "");
    if (alias) target.add(alias);
  }
}

function consolidateMenuCatalog(staged, ctx) {
  const categories = Array.isArray(staged.menuState.categories) ? staged.menuState.categories : [];
  const groupedCategories = groupedIndex(categories, (item) => normalizeSourceName(item.name));
  const nextCategories = [];

  for (const records of groupedCategories.values()) {
    const canonical = chooseCanonical(records, staged.mappings.menu, ["category"]);
    const duplicates = records.filter((item) => item !== canonical);
    const mergedProducts = [];
    for (const category of records) {
      if (category !== canonical) {
        staged.referenceRewrites.menuCategories[String(category.id)] = String(canonical.id);
        canonical.aliasIds = uniqueStrings([...(canonical.aliasIds || []), category.id, ...(category.aliasIds || [])]).filter((id) => id !== String(canonical.id));
        ctx.report.mergedDuplicates += 1;
        addChange(ctx, "menu", canonical.name, "", "mükerrer kategori", category.id, canonical.id, "merge", "unchanged", "system");
      }
      for (const product of category.products || []) mergedProducts.push(product);
    }
    canonical.products = mergedProducts;
    mergeOwnership(canonical, records);
    nextCategories.push(canonical);
  }

  staged.menuState.categories = nextCategories;
  const canonicalProductsByCode = new Map();
  for (const category of staged.menuState.categories) {
    const groups = groupedIndex(category.products || [], (item) => normalizeProductCode(item.productCode)
      ? `code\u0000${normalizeProductCode(item.productCode)}`
      : `name\u0000${normalizeSourceName(item.name)}`);
    const nextProducts = [];
    for (const records of groups.values()) {
      const canonical = chooseCanonical(records, staged.mappings.menu, ["product"]);
      const duplicates = records.filter((item) => item !== canonical);
      const productCode = normalizeProductCode(canonical.productCode);
      const crossCategory = productCode ? canonicalProductsByCode.get(productCode) : null;
      if (crossCategory && crossCategory.product !== canonical) {
        mergeMenuProduct(crossCategory.product, canonical);
        staged.referenceRewrites.menuProducts[String(canonical.id)] = String(crossCategory.product.id);
        crossCategory.product.aliasIds = uniqueStrings([...(crossCategory.product.aliasIds || []), canonical.id, ...(canonical.aliasIds || [])]).filter((id) => id !== String(crossCategory.product.id));
        for (const duplicate of duplicates) {
          mergeMenuProduct(crossCategory.product, duplicate);
          staged.referenceRewrites.menuProducts[String(duplicate.id)] = String(crossCategory.product.id);
        }
        ctx.report.mergedDuplicates += records.length;
        addChange(ctx, "menu", crossCategory.category.name, crossCategory.product.name, "mükerrer ürün kodu", canonical.id, crossCategory.product.id, "merge", "unchanged", "system", productCode);
        continue;
      }
      for (const duplicate of duplicates) {
        mergeMenuProduct(canonical, duplicate);
        if (String(duplicate.id) !== String(canonical.id)) staged.referenceRewrites.menuProducts[String(duplicate.id)] = String(canonical.id);
        canonical.aliasIds = uniqueStrings([...(canonical.aliasIds || []), duplicate.id, ...(duplicate.aliasIds || [])]).filter((id) => id !== String(canonical.id));
        ctx.report.mergedDuplicates += 1;
        addChange(ctx, "menu", category.name, canonical.name, "mükerrer ürün", duplicate.id, canonical.id, "merge", "unchanged", "system");
      }
      nextProducts.push(canonical);
      if (productCode) canonicalProductsByCode.set(productCode, { category, product: canonical });
    }
    category.products = nextProducts;
  }
}

function chooseCanonical(records, mappings, kinds) {
  const candidates = Array.isArray(records) ? records : [];
  const mappedIds = new Set((mappings || []).filter((item) => kinds.includes(item.kind)).map((item) => String(item.entityId || "")).filter(Boolean));
  return candidates.slice().sort((first, second) => {
    const firstMapped = mappedIds.has(String(first.id)) ? 1 : 0;
    const secondMapped = mappedIds.has(String(second.id)) ? 1 : 0;
    if (firstMapped !== secondMapped) return secondMapped - firstMapped;
    const firstPresent = first.sourcePresent === false ? 0 : 1;
    const secondPresent = second.sourcePresent === false ? 0 : 1;
    if (firstPresent !== secondPresent) return secondPresent - firstPresent;
    const firstManual = first.statusSource === "manual" ? 1 : 0;
    const secondManual = second.statusSource === "manual" ? 1 : 0;
    if (firstManual !== secondManual) return secondManual - firstManual;
    const orderDifference = Number(first.order || 0) - Number(second.order || 0);
    return orderDifference || String(first.id || "").localeCompare(String(second.id || ""));
  })[0];
}

function mergeMenuProduct(target, source) {
  target.order = Math.min(Number(target.order || 0), Number(source.order || 0));
  for (const field of ["desc", "image", "imageUrl", "manualContent"]) if (!target[field] && source[field]) target[field] = source[field];
  target.details = { ...(source.details || {}), ...(target.details || {}) };
  const targetPricing = target.pricing || {};
  const sourcePricing = source.pricing || {};
  target.pricing = {
    typeId: targetPricing.typeId || sourcePricing.typeId || "standard",
    values: { ...(sourcePricing.values || {}), ...(targetPricing.values || {}) }
  };
  mergeOwnership(target, [target, source]);
}

function mergeOwnership(target, records) {
  const manual = (records || []).find((item) => item.statusSource === "manual");
  if (manual) {
    target.statusSource = "manual";
    target.manualActive = manual.manualActive !== undefined ? manual.manualActive !== false : manual.active !== false;
    target.active = target.manualActive;
  } else {
    target.active = (records || []).some((item) => item.active !== false && item.sourcePresent !== false);
    target.sourcePresent = (records || []).some((item) => item.sourcePresent !== false);
  }
}

function rewriteMappingEntityIds(mappings, rewrites) {
  const replacements = { ...rewrites.menuCategories, ...rewrites.menuProducts };
  for (const entries of Object.values(mappings || {})) {
    for (const mapping of entries || []) if (replacements[String(mapping.entityId)]) mapping.entityId = replacements[String(mapping.entityId)];
  }
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => String(item || "")).filter(Boolean))];
}

function workbookRows(workbook, kind, ctx, sheetFilter = () => true) {
  const result = [];
  const names = Array.isArray(workbook && workbook.SheetNames) ? workbook.SheetNames : [];
  let schemaSheetCount = 0;
  const workbookUsesProductCodes = workbookHasProductCodeHeader(workbook);
  for (const sheet of names) {
    if (!sheetFilter(sheet)) continue;
    const rows = Array.isArray(workbook.Sheets && workbook.Sheets[sheet]) ? workbook.Sheets[sheet] : [];
    ctx.report.readSheets += 1;
    const headers = Array.isArray(rows.headers) ? rows.headers.map(normalizeSourceName) : [];
    const hasProductHeader = headers.some((header) => ["urun adi", "urun", "product", "product name"].includes(header));
    const hasProductCodeHeader = headers.some((header) => PRODUCT_CODE_HEADERS.map(normalizeSourceName).includes(header));
    if (!hasProductHeader) {
      ctx.issues.push({
        workbook: kind,
        sheet: String(sheet).trim(),
        row: 1,
        code: "ignored_non_catalog_sheet",
        severity: "warning",
        message: "Beklenen Ürün Adı başlığı bulunmadığı için açıklama/özet sayfası işleme alınmadı."
      });
      continue;
    }
    schemaSheetCount += 1;
    rows.forEach((row, index) => {
      ctx.report.readRows += 1;
      result.push({ kind, sheet: String(sheet).trim(), row, rowNumber: index + 2, headers, hasProductCodeHeader, workbookUsesProductCodes });
    });
  }
  if (!schemaSheetCount) {
    addIssue(ctx, kind, { sheet: "", rowNumber: 1 }, "missing_catalog_schema", "Çalışma kitabında beklenen Ürün Adı başlıklı bir katalog sayfası bulunamadı.");
  }
  return result;
}

function cell(row, aliases) {
  const wanted = new Set(aliases.map(normalizeSourceName));
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.has(normalizeSourceName(key))) return isFormulaValueMissing(value) ? "" : value;
  }
  return "";
}

function isPlaceholderName(value) {
  return /^[-–—]+$/.test(String(value || "").trim());
}

function isBlankTemplateRow(row) {
  return Object.values(row && typeof row === "object" ? row : {}).every((value) => {
    if (isFormulaValueMissing(value)) return true;
    const text = String(value ?? "").trim();
    return !text || isPlaceholderName(text);
  });
}

function sourceMetadata(workbook, sheet, name, now, operationId, statusSource) {
  return {
    sourceType: "excel",
    sourceWorkbook: workbook,
    sourceSheet: String(sheet || ""),
    sourceNormalizedName: normalizeSourceName(name),
    importKey: sourceImportKey(workbook, sheet, name),
    sourcePresent: true,
    statusSource,
    lastImportedAt: now,
    lastImportOperationId: operationId
  };
}

function readProductCode(source, ctx, workbook) {
  if (!source.hasProductCodeHeader) {
    if (source.workbookUsesProductCodes) {
      addIssue(ctx, workbook, source, "missing_product_code", "Kodlu çalışma kitabındaki her katalog sayfasında Ürün Kodu sütunu bulunmalıdır.");
      return { coded: true, code: "", invalid: true };
    }
    return { coded: false, code: "" };
  }
  const rawCode = cell(source.row, PRODUCT_CODE_HEADERS);
  const code = normalizeProductCode(rawCode);
  source.productCode = code;
  if (!String(rawCode ?? "").trim()) {
    addIssue(ctx, workbook, source, "missing_product_code", "Kodlu çalışma kitabındaki her ürün satırında Ürün Kodu zorunludur.");
    return { coded: true, code: "", invalid: true };
  }
  if (!isValidProductCode(rawCode)) {
    addIssue(
      ctx,
      workbook,
      source,
      "invalid_product_code",
      "Ürün Kodu en az iki bölümlü, harf/rakam ve kısa çizgiden oluşan güvenli bir kod olmalıdır."
    );
    return { coded: true, code: "", invalid: true };
  }
  return { coded: true, code };
}

function sourceImportKey(workbook, sheet, name) {
  return `${String(workbook || "")}:${normalizeSourceName(sheet)}:${normalizeSourceName(name)}`;
}

function normalizeSourceName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR").replace(/ı/g, "i").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeMappings(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(WORKBOOKS.map((key) => [key, Array.isArray(source[key]) ? clone(source[key]) : []]));
}

function resolveImportCandidate(options) {
  const {
    candidates = [], allItems = candidates, externalId = "", importKey = "", mappings = [],
    kind, sheetKey, nameKey, ctx, workbook, source, message
  } = options || {};
  const pool = Array.isArray(allItems) ? allItems : [];
  const byExternalId = externalId
    ? pool.filter((item) => [item && item.externalId, item && item.importKey]
      .some((value) => String(value || "") === externalId))
    : [];
  if (byExternalId.length === 1) return byExternalId[0];
  if (byExternalId.length > 1) {
    addIssue(ctx, workbook, source, "ambiguous_external_id", `${message} Kalıcı dış kimlik birden fazla kayda bağlı.`);
    return AMBIGUOUS;
  }

  const byImportKey = importKey ? pool.filter((item) => String(item && item.importKey || "") === importKey) : [];
  if (byImportKey.length === 1) return byImportKey[0];
  if (byImportKey.length > 1) {
    addIssue(ctx, workbook, source, "ambiguous_import_key", `${message} Kalıcı import anahtarı birden fazla kayda bağlı.`);
    return AMBIGUOUS;
  }

  const normalized = uniqueCandidate(candidates, ctx, workbook, source, message);
  if (normalized) return normalized;

  const matchingMappings = (mappings || [])
    .filter((item) => (!item.kind || item.kind === kind) && item.sheetNormalizedName === sheetKey && item.sourceNormalizedName === nameKey);
  const mappedIds = [...new Set(matchingMappings
    .map((item) => String(item.entityId || ""))
    .filter(Boolean))];
  if (mappedIds.length) {
    const resolved = [];
    const staleIds = new Set();
    for (const mappedId of mappedIds) {
      const matches = pool.filter((item) => String(item && item.id || "") === mappedId
        || Array.isArray(item && item.aliasIds) && item.aliasIds.some((aliasId) => String(aliasId) === mappedId));
      const uniqueMatches = [...new Map(matches.map((item) => [String(item && item.id || ""), item])).values()];
      if (uniqueMatches.length > 1) {
        addIssue(ctx, workbook, source, "ambiguous_alias", `${message} Eski kayıt kimliği birden fazla kanonik kayda bağlı.`);
        return AMBIGUOUS;
      }
      if (uniqueMatches.length === 1) resolved.push(uniqueMatches[0]);
      else staleIds.add(mappedId);
    }
    if (staleIds.size) {
      for (let index = mappings.length - 1; index >= 0; index -= 1) {
        const mapping = mappings[index];
        if (matchingMappings.includes(mapping) && staleIds.has(String(mapping.entityId || ""))) mappings.splice(index, 1);
      }
    }
    const liveMatches = [...new Map(resolved.map((item) => [String(item && item.id || ""), item])).values()];
    if (liveMatches.length === 1) return liveMatches[0];
    if (liveMatches.length > 1) {
      addIssue(ctx, workbook, source, "ambiguous_mapping", `${message} Önceki import eşlemesi birden fazla kayda bağlı.`);
      return AMBIGUOUS;
    }
    return null;
  }
  return null;
}

function upsertMapping(items, kind, entityId, sheet, name, now, operationId, productCode = "") {
  const next = {
    kind,
    entityId,
    sourceSheet: String(sheet),
    sheetNormalizedName: normalizeSourceName(sheet),
    sourceNormalizedName: normalizeSourceName(name),
    importKey: sourceImportKey(kind, sheet, name),
    externalId: normalizeProductCode(productCode),
    productCode: normalizeProductCode(productCode),
    aliasIds: [],
    lastImportedAt: now,
    lastImportOperationId: operationId
  };
  const sameIdentity = (item) => (!item.kind || item.kind === kind) && (
    String(item.entityId || "") === String(entityId)
    || item.sheetNormalizedName === next.sheetNormalizedName && item.sourceNormalizedName === next.sourceNormalizedName
    || Boolean(next.productCode) && normalizeProductCode(item.productCode || item.externalId) === next.productCode
  );
  const index = items.findIndex(sameIdentity);
  if (index >= 0) {
    items[index] = next;
    for (let cursor = items.length - 1; cursor >= 0; cursor -= 1) {
      if (cursor !== index && sameIdentity(items[cursor])) items.splice(cursor, 1);
    }
  } else {
    items.push(next);
  }
}

function groupedIndex(items, keyFn) {
  const result = new Map();
  for (const item of items || []) pushIndex(result, keyFn(item), item);
  return result;
}

function pushIndex(index, key, item) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(item);
}

function uniqueCandidate(items, ctx, workbook, source, message) {
  const candidates = Array.isArray(items) ? items : [];
  if (candidates.length > 1) {
    addIssue(ctx, workbook, source, "ambiguous_match", message);
    return AMBIGUOUS;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function addIssue(ctx, workbook, source, code, message, severity = "error") {
  ctx.issues.push({ workbook, sheet: source.sheet, row: source.rowNumber, productCode: normalizeProductCode(source.productCode), code, severity, message });
  ctx.report.invalidRows += 1;
  if (code.includes("ambiguous")) ctx.report.ambiguousMatches += 1;
  if (code === "invalid_product_code" || code === "missing_product_code") ctx.report.invalidProductCodes += 1;
  if (code === "duplicate_product_code") ctx.report.duplicateProductCodes += 1;
  if (code === "duplicate_price_option") ctx.report.duplicatePriceOptions += 1;
  if (code === "orphan_product_code" || code === "unknown_product_code") {
    ctx.report.orphanProductCodes += 1;
    ctx.report.unknownProductCodes += 1;
  }

}

function addChange(ctx, workbook, category, product, field, oldValue, newValue, operation, activeEffect, statusOwner, productCode = "") {
  ctx.changes.push({ workbook, category, product, productCode: normalizeProductCode(productCode), field, oldValue, newValue, operation, activeEffect, statusOwner });
}

function baseReport() {
  return {
    fileCount: 0, newCategories: 0, updatedCategories: 0, newProducts: 0, updatedProducts: 0,
    updatedPrices: 0, missingPrices: 0, invalidPrices: 0, archived: 0,
    manualInactivePreserved: 0, manualInactive: 0, autoReactivated: 0,
    duplicateProductCodes: 0, missingProductCodes: 0, invalidProductCodes: 0,
    orphanProductCodes: 0, unknownProductCodes: 0, codeMatches: 0,
    pricePendingProducts: 0, mergedDuplicates: 0, changeCount: 0,
    warningCount: 0, errorCount: 0, blockingErrors: 0, canApply: false
  };
}

function scopedArchiveBaseline(data, workbooks) {
  if (!workbooks || !workbooks.menu) return 0;
  return (data?.menuState?.categories || []).reduce((total, category) =>
    total + 1 + (category.products || []).filter((product) => product && product.sourcePresent !== false).length, 0);
}

function countProductsWithoutPrice(menuState) {
  let count = 0;
  for (const category of menuState && menuState.categories || []) {
    for (const product of category.products || []) {
      if (product.active === false || product.sourcePresent === false) continue;
      const values = normalizeProductPricing(product.pricing).families
        .flatMap((family) => Object.values(family.values || {}));
      const hasPrice = values.some((record) => {
        const value = record && typeof record === "object" ? record : { price: record, active: true };
        return value.active !== false && value.price !== null && value.price !== "" && Number.isFinite(Number(value.price));
      });
      if (!hasPrice) count += 1;
    }
  }
  return count;
}

function synchronizeProductPricingProjection(staged, options = {}) {
  const pendingImportedCodes = [];
  const catalog = staged.pricing || {};
  for (const category of staged.menuState && staged.menuState.categories || []) {
    for (const product of category.products || []) {
      const canonical = normalizeProductPricing(product.pricing);
      const activeOptions = pricingOptionsForProduct({ pricing: canonical }, catalog)
        .filter((option) => Number.isFinite(Number(option.price)) && Number(option.price) >= 0)
        .map((option) => ({
          id: option.id,
          optionId: option.optionId,
          typeId: option.typeId,
          label: option.label,
          unit: option.unit || "",
          ...(option.value !== undefined ? { value: option.value } : {}),
          price: Number(option.price),
          active: option.active !== false
        }));
      product.priceType = canonical.typeId;
      product.priceOptions = activeOptions;
      product.basePrice = activeOptions.length ? activeOptions[0].price : null;
      product.pricePending = activeOptions.length === 0;
      product.pricingStatus = product.pricePending ? "pending" : "priced";
      if (product.active === false || product.sourcePresent === false) continue;
      if (product.pricePending && options.menuSelected
        && String(product.lastImportOperationId || "") === String(options.analysisId || "")) {
        pendingImportedCodes.push(normalizeProductCode(product.productCode) || String(product.id || ""));
      }
    }
  }
  return { pendingImportedCodes: [...new Set(pendingImportedCodes)].sort() };
}

function buildImportReadbackManifest(data, scopes) {
  const selected = normalizeFingerprintScopes(scopes);
  const manifest = { fingerprintVersion: 2, scopes: selected };
  if (selected.includes("menu") || selected.includes("pricing")) {
    const pricing = migratePricingSystem(data && data.pricing, data && data.menuState).pricing;
    manifest.catalog = {
      products: stableSort((data && data.menuState && data.menuState.categories || []).flatMap((category) =>
        (category.products || []).map((product) => {
          const activeOptions = pricingOptionsForProduct(product, pricing, { includeInactive: false })
            .filter((option) => Number.isFinite(Number(option.price)));
          return {
            categoryId: String(category.id || ""),
            categoryName: String(category.name || ""),
            id: String(product.id || ""),
            productCode: normalizeProductCode(product.productCode),
            name: String(product.name || ""),
            ingredients: String(product.details && product.details.ingredients || ""),
            options: activeOptions.map((option) => ({
              id: option.id, optionId: option.optionId, typeId: option.typeId, price: Number(option.price)
            }))
          };
        })), menuProductSortKey)
    };
  }
  return normalizeFingerprintValue(manifest);
}

function selectedImportDomains(workbooks) {
  const selected = new Set();
  if (workbooks && (workbooks.menu || workbooks.pricing)) selected.add("catalog");
  return selected;
}

function normalizeImportDomains(domains, fallbackScopes = []) {
  const source = Array.isArray(domains) && domains.length ? domains : scopesToDomains(fallbackScopes);
  const requested = new Set(source.map((domain) => String(domain || "").trim().toLowerCase()));
  return IMPORT_DOMAINS.filter((domain) => requested.has(domain));
}

function scopesToDomains(scopes) {
  const selected = new Set(normalizeFingerprintScopes(scopes));
  const domains = [];
  if (selected.has("menu") || selected.has("pricing")) domains.push("catalog");
  return domains;
}

function domainsToScopes(domains, availableScopes = []) {
  const available = new Set(normalizeFingerprintScopes(availableScopes));
  const scopes = [];
  for (const domain of normalizeImportDomains(domains)) {
    if (domain === "catalog") {
      if (available.has("menu")) scopes.push("menu");
      if (available.has("pricing")) scopes.push("pricing");
    }
  }
  return normalizeFingerprintScopes(scopes);
}

function buildDomainReadiness(data, workbooks, scopes, changes, issues) {
  void data;
  void scopes;
  const selected = selectedImportDomains(workbooks);
  const relevant = new Set(["menu", "pricing"]);
  const domainIssues = issues.filter((issue) => relevant.has(String(issue.workbook || "")));
  const domainChanges = changes.filter((change) => relevant.has(String(change.workbook || "")));
  const blockingIssues = domainIssues.filter((issue) => issue.severity !== "warning");
  return {
    catalog: {
      selected: selected.has("catalog"),
      changeCount: domainChanges.length,
      warningCount: domainIssues.filter((issue) => issue.severity === "warning").length,
      errorCount: blockingIssues.length,
      canApply: selected.has("catalog") && blockingIssues.length === 0 && domainChanges.length > 0,
      blockingIssues: blockingIssues.slice(0, 100)
    }
  };
}

function domainRevisionSnapshot(data, domains) {
  const revisions = data && data.revisions || {};
  const result = {};
  for (const domain of normalizeImportDomains(domains)) result[domain] = Math.max(0, Number(revisions[`dataImport${domain[0].toUpperCase()}${domain.slice(1)}`] || 0));
  return result;
}

function domainFingerprintSnapshot(data, domains) {
  const result = {};
  for (const domain of normalizeImportDomains(domains)) result[domain] = catalogFingerprint(data, domain === "catalog" ? ["menu", "pricing"] : [domain]);
  return result;
}

function domainProductCodeFingerprintSnapshot(data, domains) {
  const result = {};
  for (const domain of normalizeImportDomains(domains)) result[domain] = productCodeFingerprint(data, domain === "catalog" ? ["menu", "pricing"] : [domain]);
  return result;
}

function domainCatalogSnapshot(data, domains) {
  const selected = new Set(normalizeImportDomains(domains));
  const snapshot = { domains: [...selected] };
  if (selected.has("catalog")) Object.assign(snapshot, clone({
    menuState: data.menuState, pricing: data.pricing,
    menuUpdatedAt: data.menuUpdatedAt, pricingUpdatedAt: data.pricingUpdatedAt
  }));
  snapshot.dataImportMappings = {};
  const mappings = data.dataImportMappings || {};
  if (selected.has("catalog")) { snapshot.dataImportMappings.menu = clone(mappings.menu || []); snapshot.dataImportMappings.pricing = clone(mappings.pricing || []); }
  const registryScopes = new Set(selected.has("catalog") ? ["menu"] : []);
  const registry = data.productCodeRegistry || {};
  snapshot.productCodeRegistry = {
    schemaVersion: registry.schemaVersion || 1,
    entries: clone((registry.entries || []).filter((entry) => registryScopes.has(entry.scope))),
    conflicts: clone((registry.conflicts || []).filter((entry) => registryScopes.has(entry.scope)))
  };
  return snapshot;
}

function restoreDomainCatalogSnapshot(data, snapshot, domains) {
  const selected = new Set(normalizeImportDomains(domains, snapshot && snapshot.domains));
  const copy = (key) => { if (Object.prototype.hasOwnProperty.call(snapshot || {}, key)) data[key] = clone(snapshot[key]); };
  if (selected.has("catalog")) ["menuState", "pricing", "menuUpdatedAt", "pricingUpdatedAt"].forEach(copy);
  const targetMappings = data.dataImportMappings || (data.dataImportMappings = { menu: [], pricing: [] });
  const savedMappings = snapshot && snapshot.dataImportMappings || {};
  if (selected.has("catalog")) { targetMappings.menu = clone(savedMappings.menu || []); targetMappings.pricing = clone(savedMappings.pricing || []); }
  restoreRegistryDomains(data, snapshot && snapshot.productCodeRegistry, selected);
  return data;
}

function restoreRegistryDomains(data, savedRegistry, selectedDomains) {
  const registryScopes = new Set(selectedDomains.has("catalog") ? ["menu"] : []);
  const current = data.productCodeRegistry || { schemaVersion: 1, entries: [], conflicts: [] };
  const saved = savedRegistry || { entries: [], conflicts: [] };
  data.productCodeRegistry = {
    schemaVersion: Math.max(Number(current.schemaVersion || 1), Number(saved.schemaVersion || 1)),
    entries: clone((current.entries || []).filter((entry) => !registryScopes.has(entry.scope))).concat(clone(saved.entries || [])),
    conflicts: clone((current.conflicts || []).filter((entry) => !registryScopes.has(entry.scope))).concat(clone(saved.conflicts || []))
  };
}

function importRevision(data) { return Math.max(0, Number(data && data.revisions && data.revisions.dataImport || 0)); }

function catalogSnapshot(data) {
  return clone({
    menuState: data.menuState, pricing: data.pricing, dataImportMappings: data.dataImportMappings,
    productCodeRegistry: data.productCodeRegistry,
    menuUpdatedAt: data.menuUpdatedAt, pricingUpdatedAt: data.pricingUpdatedAt
  });
}

function restoreCatalogSnapshot(data, snapshot) {
  for (const [key, value] of Object.entries(snapshot || {})) data[key] = clone(value);
  return data;
}

function catalogFingerprint(data, scopes) {
  return hashFingerprintValue(catalogScopeSnapshot(data, scopes));
}

function legacyCatalogFingerprint(data) {
  // v1 analiz/geçmiş kayıtları registry snapshot'ından önce üretilmişti. Eski
  // draft ve undo kayıtlarının güvenli biçimde çalışabilmesi için v1 kapsamını
  // burada aynen koru; yeni işlemler daima scope-aware v2 kullanır.
  return hashFingerprintValue({
    menuState: data.menuState,
    pricing: data.pricing,
    dataImportMappings: data.dataImportMappings,
    menuUpdatedAt: data.menuUpdatedAt,
    pricingUpdatedAt: data.pricingUpdatedAt
  });
}

function catalogScopeSnapshot(data, scopes) {
  const selected = normalizeFingerprintScopes(scopes);
  const snapshot = { fingerprintVersion: 2, scopes: selected };
  if (selected.includes("menu")) snapshot.menu = menuFingerprintProjection(data);
  if (selected.includes("pricing")) snapshot.pricing = pricingFingerprintProjection(data);

  return normalizeFingerprintValue(snapshot);
}

function productCodeFingerprint(data, scopes) {
  const selected = normalizeFingerprintScopes(scopes);
  const requiredRegistryScopes = new Set();
  if (selected.includes("menu") || selected.includes("pricing")) requiredRegistryScopes.add("menu");

  const snapshot = { fingerprintVersion: 2, scopes: selected };

  if (requiredRegistryScopes.has("menu")) snapshot.menu = menuProductCodes(data);

  const registry = data && data.productCodeRegistry && typeof data.productCodeRegistry === "object"
    ? data.productCodeRegistry
    : {};
  snapshot.registry = {
    schemaVersion: finiteFingerprintNumber(registry.schemaVersion, 1),
    entries: stableSort((Array.isArray(registry.entries) ? registry.entries : [])
      .filter((entry) => requiredRegistryScopes.has(String(entry && entry.scope || "")))
      .map(registryEntryFingerprintProjection), registryEntrySortKey),
    conflicts: stableSort((Array.isArray(registry.conflicts) ? registry.conflicts : [])
      .filter((entry) => requiredRegistryScopes.has(String(entry && entry.scope || "")))
      .map((entry) => withoutTransientFingerprintFields(entry)), registryConflictSortKey)
  };
  return hashFingerprintValue(normalizeFingerprintValue(snapshot));
}

function normalizeFingerprintScopes(scopes) {
  const source = Array.isArray(scopes) && scopes.length ? scopes : ["menu", "pricing"];
  const requested = new Set(source.map((scope) => String(scope || "").trim()));
  return ["menu", "pricing"].filter((scope) => requested.has(scope));
}

function menuFingerprintProjection(data) {
  const categories = stableSort((data && data.menuState && data.menuState.categories || []).map((category) => {
    const projected = withoutTransientFingerprintFields(category, new Set(["products"]));
    projected.products = stableSort((category.products || []).map((product) =>
      withoutTransientFingerprintFields(product, new Set(["pricing", "price", "prices", "variants", "priceMode"]))
    ), menuProductSortKey);
    return projected;
  }), menuCategorySortKey);
  return {
    categories,
    mappings: fingerprintMappings(data, "menu")
  };
}

function pricingFingerprintProjection(data) {
  const products = [];
  for (const category of data && data.menuState && data.menuState.categories || []) {
    for (const product of category.products || []) {
      products.push({
        categoryId: String(category.id || ""),
        categoryName: String(category.name || ""),
        id: String(product.id || ""),
        productCode: normalizeProductCode(product.productCode),
        active: product.active !== false,
        sourcePresent: product.sourcePresent !== false,
        pricing: productPricingFingerprintProjection(product.pricing || {})
      });
    }
  }
  return {
    pricing: pricingCatalogFingerprintProjection(data && data.pricing || {}),
    products: stableSort(products, menuProductSortKey),
    mappings: fingerprintMappings(data, "pricing")
  };
}

function fingerprintMappings(data, scope) {
  const entries = data && data.dataImportMappings && data.dataImportMappings[scope] || [];
  return stableSort(entries.map((entry) => withoutTransientFingerprintFields(entry)), mappingSortKey);
}

function pricingCatalogFingerprintProjection(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const projected = withoutTransientFingerprintFields(source, new Set(["types"]));
  projected.types = stableSort((Array.isArray(source.types) ? source.types : []).map((type) => {
    const next = withoutTransientFingerprintFields(type, new Set(["options"]));
    next.options = stableSort((Array.isArray(type.options) ? type.options : []).map((option) =>
      withoutTransientFingerprintFields(option)
    ), pricingOptionSortKey);
    return next;
  }), pricingTypeSortKey);
  return projected;
}

function productPricingFingerprintProjection(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const projected = withoutTransientFingerprintFields(source, new Set(["families"]));
  projected.families = stableSort((Array.isArray(source.families) ? source.families : []).map((family) =>
    withoutTransientFingerprintFields(family)
  ), pricingFamilySortKey);
  return projected;
}

function registryEntryFingerprintProjection(entry) {
  return normalizeFingerprintValue({
    scope: String(entry && entry.scope || ""),
    entityId: String(entry && entry.entityId || ""),
    productCode: normalizeProductCode(entry && entry.productCode),
    aliases: normalizedCodeList(entry && entry.aliases),
    normalizedName: String(entry && entry.normalizedName || ""),
    normalizedCategory: String(entry && entry.normalizedCategory || ""),
    sourcePresent: entry && entry.sourcePresent !== false,
    archived: entry && entry.archived === true,
    active: entry && entry.active !== false
  });
}

function menuProductCodes(data) {
  return stableSort((data && data.menuState && data.menuState.categories || []).flatMap((category) =>
    (category.products || []).map((product) => ({
      categoryId: String(category.id || ""),
      id: String(product.id || ""),
      productCode: normalizeProductCode(product.productCode),
      aliases: normalizedCodeList(product.productCodeAliases),
      sourcePresent: product.sourcePresent !== false,
      active: product.active !== false
    }))
  ), menuProductSortKey);
}

function withoutTransientFingerprintFields(value, extraExcluded = new Set()) {
  const excluded = new Set([
    "lastImportedAt", "lastImportOperationId", "updatedAt", "createdAt",
    "firstSeenAt", "lastSeenAt", "publishedAt", "approvedAt",
    ...extraExcluded
  ]);
  return projectFingerprintValue(value, excluded);
}

function projectFingerprintValue(value, excluded) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return normalizeFingerprintValue(value);
  if (Array.isArray(value)) return value.map((entry) => projectFingerprintValue(entry, excluded));
  const projected = {};
  for (const key of Object.keys(value).sort()) {
    if (!excluded.has(key)) projected[key] = projectFingerprintValue(value[key], excluded);
  }
  return projected;
}

function normalizeFingerprintValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (Array.isArray(value)) return value.map(normalizeFingerprintValue);
  if (typeof value !== "object") return String(value);
  const normalized = {};
  for (const key of Object.keys(value).sort()) normalized[key] = normalizeFingerprintValue(value[key]);
  return normalized;
}

function stableSort(items, keyFn) {
  return [...(Array.isArray(items) ? items : [])].sort((first, second) => {
    const firstKey = String(keyFn(first));
    const secondKey = String(keyFn(second));
    return firstKey < secondKey ? -1 : (firstKey > secondKey ? 1 : 0);
  });
}

function menuCategorySortKey(item) { return `${finiteFingerprintNumber(item && item.order, 0)}\u0000${item && item.id || ""}\u0000${item && item.name || ""}`; }
function menuProductSortKey(item) { return `${item && item.categoryId || ""}\u0000${finiteFingerprintNumber(item && item.order, 0)}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.id || ""}`; }
function mappingSortKey(item) { return `${item && item.kind || ""}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.entityId || ""}\u0000${item && item.importKey || ""}`; }
function pricingTypeSortKey(item) { return `${finiteFingerprintNumber(item && item.order, 0)}\u0000${item && item.id || ""}`; }
function pricingOptionSortKey(item) { return `${finiteFingerprintNumber(item && item.order, 0)}\u0000${item && item.id || ""}`; }
function pricingFamilySortKey(item) { return String(item && item.typeId || ""); }
function registryEntrySortKey(item) { return `${item && item.scope || ""}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.entityId || ""}`; }
function registryConflictSortKey(item) { return `${item && item.scope || ""}\u0000${normalizeProductCode(item && item.productCode)}\u0000${item && item.type || ""}\u0000${item && item.canonicalEntityId || ""}\u0000${item && item.conflictingEntityId || ""}`; }
function normalizedCodeList(value) { return [...new Set((Array.isArray(value) ? value : []).map(normalizeProductCode).filter(Boolean))].sort(); }
function finiteFingerprintNumber(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function hashFingerprintValue(value) {
  return crypto.createHash("sha256").update(stableJson(normalizeFingerprintValue(value))).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function generatedId(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }

module.exports = {
  WORKBOOKS,
  analyzeDataImport,
  catalogFingerprint,
  catalogScopeSnapshot,
  catalogSnapshot,
  importRevision,
  legacyCatalogFingerprint,
  normalizeFingerprintScopes,
  normalizeImportDomains,
  domainsToScopes,
  scopesToDomains,
  domainRevisionSnapshot,
  domainFingerprintSnapshot,
  domainProductCodeFingerprintSnapshot,
  domainCatalogSnapshot,
  restoreDomainCatalogSnapshot,
  normalizeSourceName,
  productCodeFingerprint,
  buildImportReadbackManifest,
  restoreCatalogSnapshot
};
