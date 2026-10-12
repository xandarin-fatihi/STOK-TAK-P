"use strict";

const crypto = require("crypto");
const {
  normalizePricingCatalog,
  normalizeProductPricing,
  pricingOptionsForProduct,
  withLegacyPricing
} = require("./pricing");
const { isSafeMediaResource } = require("./validators");
const categoryIcons = require("../../JS/category-icons");
const menuDesignSchema = require("../../JS/menu-design-schema");
const panelTheme = require("../../JS/panel-theme");

const BRAND_PLACEHOLDER_IMAGE = "/assets/images/neutral-placeholder.svg";
const PUBLIC_BRAND_TEXT_KEYS = Object.freeze([
  "cafeName", "shortDescription", "slogan", "menuBrandTitle", "menuBrandSubtitle",
  "phone", "whatsapp", "address", "hours", "instagram", "tiktok", "email",
  "menuBrowserTitle", "adminBrowserTitle", "personelBrowserTitle", "aboutButtonText",
  "welcomeTitle", "menuButtonText", "socialTitle", "socialSubtitle", "feedbackTitle",
  "feedbackSubtitle", "aboutTitle", "storyTitle", "storyText", "storySignature"
]);
const PUBLIC_BRAND_MEDIA_KEYS = Object.freeze([
  "logo", "favicon", "lightLogoUrl", "darkLogoUrl", "menuMainLogoUrl", "menuHeaderLogoUrl",
  "adminLogoUrl", "personelLogoUrl", "passwordResetLogoUrl", "offlineLogoUrl", "aboutLogoUrl",
  "defaultContentImageUrl", "menuFaviconUrl", "adminFaviconUrl", "personelFaviconUrl",
  "menuAppIconUrl", "adminAppIconUrl", "personelAppIconUrl"
]);
const DEFAULT_CATEGORY_IMAGES = Object.freeze({ default: BRAND_PLACEHOLDER_IMAGE });

function buildPublicBootstrap(storeData) {
  const data = storeData && typeof storeData === "object" ? storeData : {};
  const menuState = menuDesignSchema.normalizeMenuState(data.menuState);
  const defaultContentImage = resource(menuState.settings?.brandInfo?.defaultContentImageUrl) || BRAND_PLACEHOLDER_IMAGE;
  const pricing = normalizePricingCatalog(data.pricing);
  const categories = (menuState.categories || [])
    .filter((category) => category && category.active !== false)
    .sort(byOrder)
    .map((category) => {
      const iconKey = categoryIconKey(category);
      const categoryImage = categoryDefaultImage(category, iconKey, defaultContentImage);
      const products = (category.products || [])
        .filter((product) => product && product.active !== false)
        .sort(byOrder)
        .map((product) => publicProduct(product, category, categoryImage, pricing, defaultContentImage));
      return {
        id: String(category.id), name: String(category.name || ""), order: numberOr(category.order, 0),
        iconKey, icon: categoryIcons.getIconClass(iconKey), iconMark: categoryIcons.getIcon(iconKey).mark,
        image: categoryImage, color: safeCssValue(category.color), style: publicStyle(category.style),
        productCount: products.length, products
      };
    });
  const products = categories.flatMap((category) => category.products);
  const updatedAt = [data.menuUpdatedAt, data.pricingUpdatedAt, data.publishUpdatedAt].filter(Boolean).sort().at(-1) || null;
  const revisions = publicRevisions(data.revisions);
  const menu = { settings: publicMenuSettings(menuState.settings), pricing, categoryCount: categories.length, productCount: products.length, categories, products };
  return {
    schemaVersion: 2,
    version: crypto.createHash("sha256").update(JSON.stringify({ updatedAt, revisions, menu })).digest("hex").slice(0, 16),
    revision: revisions.publish,
    publishRevision: revisions.publish,
    pricingRevision: revisions.pricing,
    catalogRevision: revisions.catalog,
    revisions,
    updatedAt,
    pricing,
    menu
  };
}

function publicProduct(product, category, categoryImage, pricingCatalog, defaultContentImage) {
  const content = resolvePublicContent(product);
  const productPricing = normalizeProductPricing(product.pricing);
  const priceOptions = pricingOptionsForProduct({ pricing: productPricing }, pricingCatalog);
  const synchronized = product && product.pricing && product.pricing.typeId
    ? withLegacyPricing({ ...product, pricing: productPricing }, pricingCatalog)
    : product;
  const variants = priceOptions.length
    ? priceOptions.map((option) => ({ id: option.id, name: option.label, label: option.label, unit: option.unit, price: option.price }))
    : normalizeVariants(synchronized);
  const prices = normalizePrices(synchronized && synchronized.prices);
  const image = productDefaultImage(product, categoryImage, defaultContentImage);
  return {
    id: String(product.id), productCode: String(product.productCode || ""), categoryId: String(category.id),
    categoryName: String(category.name || ""), name: String(product.name || ""),
    description: String(product.desc || product.description || ""), image: image.src,
    imageUrl: resource(product.imageUrl), imageSource: image.source, image_source: image.source,
    imageOverlay: numberOr(product.imageOverlay, 0), cardColor: safeCssValue(product.cardColor),
    imageAspect: ["landscape", "square", "source"].includes(product.imageAspect) ? product.imageAspect : "landscape",
    imageFit: ["contain", "cover"].includes(product.imageFit) ? product.imageFit : "contain",
    style: publicStyle(product.style), pricing: productPricing, priceOptions,
    stock: String(product.stock || (product.soldOut ? "sold-out" : "active")), soldOut: Boolean(product.soldOut || product.stock === "sold-out"),
    priceMode: String(synchronized && synchronized.priceMode || product.priceMode || "standard"),
    prices, variants, basePrice: firstPrice(priceOptions, prices, variants),
    priceLabel: priceLabel(priceOptions, prices, variants),
    ingredients: String(product.details?.ingredients ?? product.ingredients ?? content ?? ""),
    content, popular: Boolean(product.popular), kind: String(product.kind || ""),
    temperature: String(product.temperature || ""), order: numberOr(product.order, 0)
  };
}

function resolvePublicContent(product) {
  const mode = ["manual", "hidden", "not-required"].includes(product && product.contentMode)
    ? product.contentMode : "manual";
  if (mode === "hidden" || mode === "not-required") return "";
  return String(product && (product.manualContent ?? product.details?.ingredients ?? product.ingredients) || "").trim();
}

function categoryIconKey(category) {
  const explicit = String(category.iconKey || "").trim();
  if (explicit && categoryIcons.ICONS[explicit]) return explicit;
  const legacy = String(category.icon || "").trim();
  return legacy && categoryIcons.ICONS[legacy] ? legacy : categoryIcons.inferIconKey(category.name);
}

function categoryDefaultImage(category, iconKey, defaultContentImage) {
  return resource(category.imageUrl || category.image || category.style?.imageUrl || category.style?.image)
    || defaultContentImage || DEFAULT_CATEGORY_IMAGES[iconKey] || DEFAULT_CATEGORY_IMAGES.default;
}

function productDefaultImage(product, categoryImage, defaultContentImage) {
  const explicit = resource(product.imageUrl || product.image || product.img);
  if (explicit) return { src: explicit, source: "product" };
  if (categoryImage) return { src: categoryImage, source: "category" };
  return { src: defaultContentImage || BRAND_PLACEHOLDER_IMAGE, source: "brand-placeholder" };
}

function publicMenuSettings(settings) {
  const projected = menuDesignSchema.projectSettings(settings);
  return {
    ...projected,
    bgColor: safeCssValue(projected.bgColor), darkBgColor: safeCssValue(projected.darkBgColor),
    accentColor: safeCssValue(projected.accentColor), textColor: safeCssValue(projected.textColor),
    buttonTextColor: safeCssValue(projected.buttonTextColor), cardColor: safeCssValue(projected.cardColor),
    productCardColor: safeCssValue(projected.productCardColor), categoryCardColor: safeCssValue(projected.categoryCardColor),
    socialIconColor: safeCssValue(projected.socialIconColor), menuBackgroundImage: resource(projected.menuBackgroundImage),
    menuBackground: publicStyle(projected.menuBackground),
    bottomActions: {
      popular: publicStyle(projected.bottomActions?.popular),
      home: publicStyle(projected.bottomActions?.home),
      suggest: publicStyle(projected.bottomActions?.suggest)
    },
    themeProfiles: {
      light: publicThemeProfile(projected.themeProfiles?.light),
      dark: publicThemeProfile(projected.themeProfiles?.dark)
    },
    banner: publicBanner(projected.banner),
    brandInfo: publicBrandInfo(projected.brandInfo)
  };
}

function publicThemeProfile(value) {
  const profile = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    presetId: boundedString(profile.presetId, 120),
    customized: Boolean(profile.customized),
    bgColor: safeCssValue(profile.bgColor),
    accentColor: safeCssValue(profile.accentColor),
    textColor: safeCssValue(profile.textColor),
    buttonTextColor: safeCssValue(profile.buttonTextColor),
    cardColor: safeCssValue(profile.cardColor),
    productCardColor: safeCssValue(profile.productCardColor),
    categoryCardColor: safeCssValue(profile.categoryCardColor),
    socialIconColor: safeCssValue(profile.socialIconColor),
    menuBackground: publicStyle(profile.menuBackground),
    bottomActions: {
      popular: publicStyle(profile.bottomActions?.popular),
      home: publicStyle(profile.bottomActions?.home),
      suggest: publicStyle(profile.bottomActions?.suggest)
    }
  };
}

function publicBrandInfo(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of PUBLIC_BRAND_TEXT_KEYS) result[key] = boundedString(source[key], key === "storyText" ? 5000 : 1000);
  for (const key of PUBLIC_BRAND_MEDIA_KEYS) result[key] = resource(source[key]);
  return result;
}

function buildPwaManifest(storeData, appKind) {
  const menuState = menuDesignSchema.normalizeMenuState(storeData && storeData.menuState);
  const brand = publicBrandInfo(menuState.settings && menuState.settings.brandInfo);
  const defaults = menuDesignSchema.DEFAULT_SETTINGS.brandInfo || {};
  const manager = appKind === "admin";
  const personel = appKind === "personel";
  const brandName = boundedString(brand.cafeName || brand.menuBrandTitle || "", 60).trim();
  const theme = manager || personel ? panelTheme.colorsForPreset(storeData?.panelConfig?.appearance?.adminThemePresetId) : {
    canvas: menuState.settings.themeProfiles.light.bgColor,
    sidebar: menuState.settings.themeProfiles.light.accentColor
  };
  const fallbackTitle = personel ? "Personel Paneli" : manager ? "Yönetici Paneli" : "Dijital Menü";
  const titleKey = personel ? "personelBrowserTitle" : manager ? "adminBrowserTitle" : "menuBrowserTitle";
  const storedTitle = boundedString(brand[titleKey], 120).trim();
  const defaultTitle = String(defaults[titleKey] || fallbackTitle).trim();
  const name = storedTitle && storedTitle !== defaultTitle
    ? storedTitle
    : brandName ? `${brandName} ${personel ? "Personel Paneli" : manager ? "Yönetici Paneli" : "Dijital Menü"}` : fallbackTitle;
  const shortName = boundedString(brandName ? `${brandName} ${personel ? "Personel" : manager ? "Yönetici" : "Menü"}` : fallbackTitle, 30).trim();
  const customIcon = resource(personel ? brand.personelAppIconUrl : manager ? brand.adminAppIconUrl : brand.menuAppIconUrl);
  const iconRoot = personel ? "/assets/app-icons/personel" : manager ? "/assets/app-icons/yonetici" : "/assets/app-icons/menu";
  const icons = [];
  if (customIcon) {
    icons.push({ src: customIcon, type: manifestIconType(customIcon), purpose: "any" });
  }
  icons.push(
    { src: `${iconRoot}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${iconRoot}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `${iconRoot}/icon-maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: `${iconRoot}/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" }
  );
  return {
    name,
    short_name: shortName,
    id: personel ? "/personel/" : manager ? "/yonetici/" : "/",
    start_url: personel ? "/personel/" : manager ? "/yonetici/" : "/",
    scope: personel ? "/personel/" : manager ? "/yonetici/" : "/",
    display: "standalone",
    background_color: theme.canvas,
    theme_color: theme.sidebar,
    icons
  };
}

function manifestIconType(value) {
  const path = String(value || "").split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function publicStyle(value) {
  const style = menuDesignSchema.projectStyle(value);
  return {
    type: ["solid", "gradient", "image"].includes(style.type) ? style.type : "gradient",
    color: safeCssValue(style.color), image: resource(style.image), imageUrl: resource(style.imageUrl),
    gradientStart: safeCssValue(style.gradientStart), gradientEnd: safeCssValue(style.gradientEnd),
    gradientAngle: numberOr(style.gradientAngle, 145), overlay: numberOr(style.overlay, 0),
    textColor: safeCssValue(style.textColor), customized: Boolean(style.customized)
  };
}

function publicBanner(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: ["random", "products", "images", "video"].includes(source.mode) ? source.mode : "random",
    title: boundedString(source.title, 500), subtitle: boundedString(source.subtitle, 1000),
    video: resource(source.video), videoUrl: resource(source.videoUrl),
    videos: publicMediaList(source.videos, "video"), images: publicMediaList(source.images, "image"),
    productIds: (Array.isArray(source.productIds) ? source.productIds : []).map((item) => boundedString(item, 200).trim()).filter(Boolean)
  };
}

function publicMediaList(value, kind) {
  return (Array.isArray(value) ? value : []).map((item, index) => {
    const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    const src = resource(typeof item === "string" ? item : source.src || source.url || source.data);
    return src ? { id: boundedString(source.id, 200), src, name: boundedString(source.name || `${kind === "video" ? "Video" : "Görsel"} ${index + 1}`, 300), type: boundedString(source.type, 160), size: Math.max(0, numberOr(source.size, 0)), kind } : null;
  }).filter(Boolean);
}

function normalizeVariants(product) {
  if (!product || !Array.isArray(product.variants)) return [];
  return product.variants.map((variant) => ({ name: String(variant?.name || "").trim(), price: numberOr(variant?.price, null) })).filter((variant) => variant.name || variant.price !== null);
}
function normalizePrices(value) { const result = {}; for (const [key, item] of Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})) { const number = numberOr(item, null); if (number !== null) result[key] = number; } return result; }
function firstPrice(priceOptions, prices, variants) { const values = [...(priceOptions || []).map((item) => item.price), ...Object.values(prices || {}), ...(variants || []).map((item) => item.price)].map(publicPriceNumber).filter((item) => item !== null); return values.length ? values[0] : 0; }
function priceLabel(priceOptions, prices, variants) { const values = [...(priceOptions || []).map((item) => item.price), ...Object.values(prices || {}), ...(variants || []).map((item) => item.price)].map(publicPriceNumber).filter((item) => item !== null).sort((a,b)=>a-b); if (!values.length) return ""; const format = (value) => `₺${Number(value).toLocaleString("tr-TR")}`; return values[0] === values.at(-1) ? format(values[0]) : `${format(values[0])} - ${format(values.at(-1))}`; }
function publicPriceNumber(value) { if (value === "" || value === null || value === undefined) return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function publicRevisions(value) { const source = value && typeof value === "object" && !Array.isArray(value) ? value : {}; return { publish: nonNegativeInteger(source.publish), pricing: nonNegativeInteger(source.pricing), catalog: nonNegativeInteger(source.dataImportCatalog), dataImport: nonNegativeInteger(source.dataImport) }; }
function nonNegativeInteger(value) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : 0; }
function resource(value) { const text = String(value || "").trim(); return text && isSafeMediaResource(text) ? text : ""; }
function safeCssValue(value) { const text = boundedString(value, 128).trim(); return !text || /[;{}<>\u0000-\u001f]/.test(text) || /(?:url|expression)\s*\(|javascript:/i.test(text) ? "" : text; }
function boundedString(value, maxLength) { const text = typeof value === "string" ? value : String(value == null ? "" : value); return text.length <= maxLength ? text : ""; }
function byOrder(first, second) { return numberOr(first.order, 0) - numberOr(second.order, 0); }
function numberOr(value, fallback) { if (value === "" || value === null || value === undefined) return fallback; const number = Number(value); return Number.isFinite(number) ? number : fallback; }

module.exports = { buildPublicBootstrap, buildPwaManifest, resolvePublicContent };
