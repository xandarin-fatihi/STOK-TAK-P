"use strict";

const { validatePricingCatalog, validateProductPricing } = require("./pricing");

const MAX_STATE_BYTES = 7_500_000;
const MAX_STRING_LENGTH = 500_000;
const RESOURCE_KEY_PATTERN = /(url|href|src|image|video|maps|instagram|tiktok|whatsapp|logo|favicon)$/i;
const DESIGN_STYLE_TYPES = new Set(["solid", "gradient", "image"]);
const BANNER_MODES = new Set(["random", "products", "images", "video"]);
const PRODUCT_IMAGE_ASPECTS = new Set(["landscape", "square", "source"]);
const PRODUCT_IMAGE_FITS = new Set(["contain", "cover"]);
const DESIGN_COLOR_KEYS = [
  "bgColor", "darkBgColor", "accentColor", "textColor", "buttonTextColor",
  "cardColor", "productCardColor", "categoryCardColor", "socialIconColor"
];
const TYPOGRAPHY_LIMITS = Object.freeze({
  menuTitle: [18, 54], categoryTitle: [14, 34], productTitle: [10, 28],
  productDesc: [8, 22], productIngredients: [8, 22], productPrice: [8, 22]
});

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 10) return "Sifre en az 10 karakter olmali.";
  if (password.length > 72) return "Sifre en fazla 72 karakter olmali.";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "Sifre en az bir harf ve bir rakam icermeli.";
  return "";
}

function validateMenuState(menuState) {
  if (!isRecord(menuState)) return "menuState nesnesi gerekli.";
  const safetyError = validateSafeState(menuState, "menuState", MAX_STATE_BYTES, { allowEmbeddedMedia: false });
  if (safetyError) return safetyError;
  if (!Array.isArray(menuState.categories)) return "menuState.categories dizi olmali.";
  if (menuState.settings !== undefined && !isRecord(menuState.settings)) return "menuState.settings nesne olmali.";
  const settingsError = validateDesignSettings(menuState.settings);
  if (settingsError) return settingsError;
  if (menuState.pricing !== undefined) {
    const catalogError = validatePricingCatalog(menuState.pricing);
    if (catalogError) return catalogError;
  }
  const categoryIds = new Set();
  const productIds = new Set();
  for (const category of menuState.categories) {
    if (!isRecord(category)) return "Her kategori nesne olmali.";
    if (!category.id || !category.name) return "Her kategoride id ve name olmali.";
    if (categoryIds.has(String(category.id))) return "Kategori kimlikleri benzersiz olmali.";
    categoryIds.add(String(category.id));
    if (!Array.isArray(category.products)) return "Her kategoride products dizisi olmali.";
    const categoryDesignError = validateCategoryDesign(category);
    if (categoryDesignError) return `${category.name}: ${categoryDesignError}`;
    for (const product of category.products) {
      if (!isRecord(product)) return "Her urun nesne olmali.";
      if (!product.id || !product.name) return "Her urunde id ve name olmali.";
      if (productIds.has(String(product.id))) return "Urun kimlikleri benzersiz olmali.";
      productIds.add(String(product.id));
      const productDesignError = validateProductDesign(product);
      if (productDesignError) return `${product.name}: ${productDesignError}`;
      if (product.pricing !== undefined) {
        const pricingError = validateProductPricing(product.pricing);
        if (pricingError) return `${product.name}: ${pricingError}`;
      }
      if (product.contentMode && !["manual", "hidden", "not-required"].includes(product.contentMode)) {
        return "Urun contentMode manual, hidden veya not-required olmali.";
      }
    }
  }
  return "";
}

function validateDesignSettings(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "menuState.settings nesne olmali.";
  if (value.designSchemaVersion !== undefined && !isDesignSchemaVersion(value.designSchemaVersion)) return "designSchemaVersion gecersiz.";
  for (const key of ["appliedPresetId", "designPresetVersion"]) {
    if (value[key] !== undefined && !isSafeIdentifier(value[key], 120)) return `${key} gecersiz.`;
  }
  for (const key of DESIGN_COLOR_KEYS) {
    if (value[key] !== undefined && !isSafeCssValue(value[key])) return `${key} gecersiz renk degeri tasiyor.`;
  }
  if (value.socialIconSize !== undefined && !isFiniteInRange(value.socialIconSize, 12, 72)) return "socialIconSize 12 ile 72 arasinda olmali.";
  if (value.menuBackgroundImage !== undefined && !isSafeMediaResource(value.menuBackgroundImage)) return "menuBackgroundImage guvenli bir medya adresi olmali.";
  if (value.menuUpdateDate !== undefined && !isBoundedString(value.menuUpdateDate, 160)) return "menuUpdateDate gecersiz.";
  if (value.brandInfo !== undefined) {
    if (!isRecord(value.brandInfo)) return "brandInfo nesne olmali.";
    for (const key of ["cafeName", "shortDescription", "slogan", "menuBrandTitle", "menuBrandSubtitle", "phone", "whatsapp", "address", "hours", "instagram", "tiktok", "email", "menuBrowserTitle", "adminBrowserTitle", "personelBrowserTitle", "aboutButtonText", "welcomeTitle", "menuButtonText", "socialTitle", "socialSubtitle", "feedbackTitle", "feedbackSubtitle", "aboutTitle", "storyTitle", "storyText", "storySignature"]) {
      const limit = key === "storyText" ? 5000 : 1000;
      if (value.brandInfo[key] !== undefined && !isBoundedString(value.brandInfo[key], limit)) return `brandInfo.${key} gecersiz.`;
    }
    for (const key of ["logo", "favicon", "lightLogoUrl", "darkLogoUrl", "menuMainLogoUrl", "menuHeaderLogoUrl", "adminLogoUrl", "personelLogoUrl", "passwordResetLogoUrl", "offlineLogoUrl", "aboutLogoUrl", "defaultContentImageUrl", "menuFaviconUrl", "adminFaviconUrl", "personelFaviconUrl", "menuAppIconUrl", "adminAppIconUrl", "personelAppIconUrl"]) {
      if (value.brandInfo[key] !== undefined && !isSafeMediaResource(value.brandInfo[key])) return `brandInfo.${key} guvenli bir medya adresi olmali.`;
    }
  }
  const fontsError = validateFonts(value.fonts);
  if (fontsError) return fontsError;
  const typographyError = validateTypography(value.typography);
  if (typographyError) return typographyError;
  const backgroundError = validateDesignStyle(value.menuBackground, "menuBackground");
  if (backgroundError) return backgroundError;
  if (value.bottomActions !== undefined) {
    if (!isRecord(value.bottomActions)) return "bottomActions nesne olmali.";
    for (const key of ["popular", "home", "suggest"]) {
      const actionError = validateDesignStyle(value.bottomActions[key], `bottomActions.${key}`);
      if (actionError) return actionError;
    }
  }
  if (value.themeProfiles !== undefined) {
    if (!isRecord(value.themeProfiles)) return "themeProfiles nesne olmali.";
    for (const mode of ["light", "dark"]) {
      const profileError = validateThemeProfile(value.themeProfiles[mode], `themeProfiles.${mode}`);
      if (profileError) return profileError;
    }
  }
  return validateBanner(value.banner);
}

function validateThemeProfile(value, label) {
  if (value === undefined) return "themeProfiles light ve dark profilleri icermeli.";
  if (!isRecord(value)) return `${label} nesne olmali.`;
  if (value.presetId !== undefined && !isSafeIdentifier(value.presetId, 120)) return `${label}.presetId gecersiz.`;
  if (value.customized !== undefined && typeof value.customized !== "boolean") return `${label}.customized boolean olmali.`;
  for (const key of ["bgColor", "accentColor", "textColor", "buttonTextColor", "cardColor", "productCardColor", "categoryCardColor", "socialIconColor"]) {
    if (value[key] !== undefined && !isSafeCssValue(value[key])) return `${label}.${key} gecersiz renk degeri tasiyor.`;
  }
  const backgroundError = validateDesignStyle(value.menuBackground, `${label}.menuBackground`);
  if (backgroundError) return backgroundError;
  if (value.bottomActions !== undefined) {
    if (!isRecord(value.bottomActions)) return `${label}.bottomActions nesne olmali.`;
    for (const key of ["popular", "home", "suggest"]) {
      const actionError = validateDesignStyle(value.bottomActions[key], `${label}.bottomActions.${key}`);
      if (actionError) return actionError;
    }
  }
  return "";
}

function validateFonts(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "fonts nesne olmali.";
  for (const key of ["title", "category", "product"]) {
    if (value[key] !== undefined && !isBoundedString(value[key], 240)) return `fonts.${key} gecersiz.`;
  }
  return "";
}

function validateTypography(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "typography nesne olmali.";
  for (const [key, limits] of Object.entries(TYPOGRAPHY_LIMITS)) {
    if (value[key] !== undefined && !isFiniteInRange(value[key], limits[0], limits[1])) return `typography.${key} gecersiz.`;
  }
  return "";
}

function validateCategoryDesign(category) {
  if (category.color !== undefined && !isSafeCssValue(category.color, true)) return "Kategori rengi gecersiz.";
  for (const key of ["image", "imageUrl"]) {
    if (category[key] !== undefined && !isSafeMediaResource(category[key])) return `Kategori ${key} adresi guvensiz.`;
  }
  return validateDesignStyle(category.style, "Kategori style");
}

function validateProductDesign(product) {
  if (product.cardColor !== undefined && !isSafeCssValue(product.cardColor, true)) return "Urun kart rengi gecersiz.";
  for (const key of ["image", "imageUrl", "img"]) {
    if (product[key] !== undefined && !isSafeMediaResource(product[key])) return `Urun ${key} adresi guvensiz.`;
  }
  if (product.imageOverlay !== undefined && !isFiniteInRange(product.imageOverlay, 0, 0.85)) return "Urun imageOverlay gecersiz.";
  if (product.imageAspect !== undefined && !PRODUCT_IMAGE_ASPECTS.has(product.imageAspect)) return "Urun imageAspect gecersiz.";
  if (product.imageFit !== undefined && !PRODUCT_IMAGE_FITS.has(product.imageFit)) return "Urun imageFit gecersiz.";
  return validateDesignStyle(product.style, "Urun style");
}

function validateDesignStyle(value, label) {
  if (value === undefined) return "";
  if (!isRecord(value)) return `${label} nesne olmali.`;
  if (value.type !== undefined && !DESIGN_STYLE_TYPES.has(value.type)) return `${label}.type gecersiz.`;
  for (const key of ["color", "gradientStart", "gradientEnd", "textColor"]) {
    if (value[key] !== undefined && !isSafeCssValue(value[key], true)) return `${label}.${key} gecersiz.`;
  }
  for (const key of ["image", "imageUrl"]) {
    if (value[key] !== undefined && !isSafeMediaResource(value[key])) return `${label}.${key} guvensiz.`;
  }
  if (value.gradientAngle !== undefined && !isFiniteInRange(value.gradientAngle, -360, 360)) return `${label}.gradientAngle gecersiz.`;
  if (value.overlay !== undefined && !isFiniteInRange(value.overlay, 0, 0.85)) return `${label}.overlay gecersiz.`;
  if (value.customized !== undefined && typeof value.customized !== "boolean") return `${label}.customized boolean olmali.`;
  return "";
}

function validateBanner(value) {
  if (value === undefined) return "";
  if (!isRecord(value)) return "banner nesne olmali.";
  if (value.mode !== undefined && !BANNER_MODES.has(value.mode)) return "banner.mode gecersiz.";
  if (value.title !== undefined && !isBoundedString(value.title, 500)) return "banner.title gecersiz.";
  if (value.subtitle !== undefined && !isBoundedString(value.subtitle, 1000)) return "banner.subtitle gecersiz.";
  for (const key of ["video", "videoUrl"]) {
    if (value[key] !== undefined && !isSafeMediaResource(value[key])) return `banner.${key} guvensiz.`;
  }
  for (const [key, kind] of [["videos", "video"], ["images", "image"]]) {
    if (value[key] === undefined) continue;
    if (!Array.isArray(value[key]) || value[key].length > 100) return `banner.${key} gecersiz.`;
    for (let index = 0; index < value[key].length; index += 1) {
      const mediaError = validateMediaItem(value[key][index], `banner.${key}[${index}]`, kind);
      if (mediaError) return mediaError;
    }
  }
  if (value.productIds !== undefined) {
    if (!Array.isArray(value.productIds) || value.productIds.length > 500) return "banner.productIds gecersiz.";
    if (value.productIds.some((item) => !isBoundedString(item, 200) || !String(item).trim())) return "banner.productIds degerleri gecersiz.";
  }
  return "";
}

function validateMediaItem(value, label, kind) {
  if (typeof value === "string") return isSafeMediaResource(value) ? "" : `${label} guvensiz medya adresi tasiyor.`;
  if (!isRecord(value)) return `${label} metin veya nesne olmali.`;
  const source = value.src ?? value.url ?? value.data;
  if (typeof source !== "string" || !source.trim() || !isSafeMediaResource(source)) return `${label} guvenli bir ${kind} adresi icermeli.`;
  if (value.id !== undefined && !isBoundedString(value.id, 200)) return `${label}.id gecersiz.`;
  if (value.name !== undefined && !isBoundedString(value.name, 300)) return `${label}.name gecersiz.`;
  if (value.type !== undefined && !isBoundedString(value.type, 160)) return `${label}.type gecersiz.`;
  if (value.kind !== undefined && !isBoundedString(value.kind, 40)) return `${label}.kind gecersiz.`;
  if (value.size !== undefined && !isFiniteInRange(value.size, 0, Number.MAX_SAFE_INTEGER)) return `${label}.size gecersiz.`;
  return "";
}

function validateSafeState(value, label, maxBytes = MAX_STATE_BYTES, options = {}) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch (_error) { return `${label} JSON olarak kaydedilemedi.`; }
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) return `${label} cok buyuk.`;
  const stack = [{ key: label, path: label, value }];
  while (stack.length) {
    const current = stack.pop();
    const currentValue = current.value;
    if (typeof currentValue === "string") {
      if (currentValue.length > MAX_STRING_LENGTH && !isLargeDataResource(currentValue)) return `${current.path} metni cok uzun.`;
      if (hasUnsafeMarkup(currentValue)) return `${current.path} guvensiz script icerigi tasiyor.`;
      if (!options.allowEmbeddedMedia && /^data:(?:image|video)\//i.test(currentValue)) return `${current.path} gomulu medya iceremez; /media yolu kullanin.`;
      if (RESOURCE_KEY_PATTERN.test(current.key) && !isSafeResource(currentValue)) return `${current.path} guvenli olmayan kaynak adresi iceriyor.`;
      continue;
    }
    if (!currentValue || typeof currentValue !== "object") continue;
    if (Array.isArray(currentValue)) currentValue.forEach((item, index) => stack.push({ key: String(index), path: `${current.path}[${index}]`, value: item }));
    else for (const [key, item] of Object.entries(currentValue)) stack.push({ key, path: `${current.path}.${key}`, value: item });
  }
  return "";
}

function hasUnsafeMarkup(value) { return /<\s*\/?\s*[a-z][^>]*>|on[a-z]+\s*=|javascript:/i.test(value); }
function isRecord(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isBoundedString(value, maxLength) { return typeof value === "string" && value.length <= maxLength; }
function isSafeIdentifier(value, maxLength) { return isBoundedString(value, maxLength) && /^[a-z0-9][a-z0-9._:-]*$/i.test(value); }
function isDesignSchemaVersion(value) { return Number.isSafeInteger(value) ? value >= 1 : typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,39}$/i.test(value); }
function isFiniteInRange(value, minimum, maximum) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}
function isSafeCssValue(value, allowEmpty = false) {
  if (typeof value !== "string" || value.length > 128) return false;
  const text = value.trim();
  return text ? !/[;{}<>\u0000-\u001f]/.test(text) && !/(?:url|expression)\s*\(|javascript:/i.test(text) : allowEmpty;
}
function isSafeResource(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/[<>"'\\]/.test(text) || /^data:/i.test(text)) return false;
  if (/^media:[a-z0-9._-]+$/i.test(text)) return true;
  try { return ["http:", "https:", "mailto:", "tel:"].includes(new URL(text, "https://paket1.local/").protocol); } catch (_error) { return false; }
}
function isSafeMediaResource(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/[<>"'\\\u0000-\u001f]/.test(text) || /^(?:data|blob|javascript):/i.test(text)) return false;
  if (/^media:[a-z0-9._-]+$/i.test(text)) return true;
  try { return ["http:", "https:"].includes(new URL(text, "https://paket1.local/").protocol); } catch (_error) { return false; }
}
function isLargeDataResource(value) { return /^data:(?:image\/(?:png|jpe?g|gif|webp)|video\/[a-z0-9.+-]+);base64,/i.test(String(value || "")); }

module.exports = {
  validateMenuState, validateDesignSettings, validateCategoryDesign, validateProductDesign,
  validatePassword, validateSafeState, isSafeResource, isSafeMediaResource
};

function validateRecipeState(recipeState) {
  if (!recipeState || typeof recipeState !== "object" || Array.isArray(recipeState)) {
    return "recipeState nesnesi gerekli.";
  }

  const safetyError = validateSafeState(recipeState, "recipeState", MAX_STATE_BYTES, { allowEmbeddedMedia: false });
  if (safetyError) return safetyError;

  for (const [categoryName, products] of Object.entries(recipeState)) {
    if (!categoryName || typeof products !== "object" || Array.isArray(products) || products === null) {
      return "Her recete kategorisi urun nesnesi icermeli.";
    }

    for (const [productName, sizes] of Object.entries(products)) {
      if (!productName || typeof sizes !== "object" || Array.isArray(sizes) || sizes === null) {
        return "Her recete urunu olcu nesnesi icermeli.";
      }

      for (const [sizeName, recipe] of Object.entries(sizes)) {
        if (!sizeName) return "Her recete olcusunun adi olmali.";
        if (!isRecipeText(recipe)) return "Recete metni string veya { content, preparation } nesnesi olmali.";
      }
    }
  }

  return "";
}

function isRecipeText(recipe) {
  if (typeof recipe === "string") return true;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) return false;
  const stringFields = new Set([
    "content", "preparation", "recipe", "ingredients", "method", "steps", "description", "note", "productNote",
    "id", "sourceType", "sourceWorkbook", "sourceSheet", "sourceNormalizedName", "statusSource", "lastImportOperationId",
    "importKey", "externalId", "productCode"
  ]);
  const nullableStringFields = new Set(["lastImportedAt"]);
  const booleanFields = new Set(["active", "manualActive", "sourcePresent"]);
  const numberFields = new Set(["order"]);
  return Object.entries(recipe).every(([key, value]) => (
    (stringFields.has(key) && typeof value === "string")
    || (nullableStringFields.has(key) && (value === null || typeof value === "string"))
    || (key === "aliasIds" && Array.isArray(value) && value.length <= 100 && value.every((item) => isBoundedString(item, 200)))
    || (key === "productCodeAliases" && Array.isArray(value) && value.length <= 100 && value.every((item) => isBoundedString(item, 120)))
    || (key === "nameHistory" && Array.isArray(value) && value.length <= 100 && value.every((item) => isBoundedString(item, 240)))
    || (booleanFields.has(key) && typeof value === "boolean")
    || (numberFields.has(key) && Number.isFinite(Number(value)))
  ));
}

function validateRecipeCatalog(recipeCatalog, recipeState) {
  if (!Array.isArray(recipeCatalog)) return "recipeCatalog dizi olmali.";
  const ids = new Set();
  for (const record of recipeCatalog) {
    if (!record || typeof record !== "object" || !record.id || !record.category || !record.product) {
      return "Her recipeCatalog kaydinda id, category ve product olmali.";
    }
    if (ids.has(record.id)) return "recipeCatalog kimlikleri benzersiz olmali.";
    ids.add(record.id);
    if (!recipeState?.[record.category]?.[record.product]) {
      return `recipeCatalog kaydi bulunamayan receteye isaret ediyor: ${record.id}`;
    }
  }
  return validateSafeState(recipeCatalog, "recipeCatalog", 1_000_000, { allowEmbeddedMedia: false });
}
Object.assign(module.exports, { validateRecipeState, validateRecipeCatalog });
