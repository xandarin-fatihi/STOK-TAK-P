(function (root, factory) {
  const identity = factory();
  if (typeof module === "object" && module.exports) module.exports = identity;
  else root.BrandIdentity = identity;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const defaults = Object.freeze({
    name: "",
    lightLogo: "/assets/brand/neutral-mark.svg",
    darkLogo: "/assets/brand/neutral-mark.svg",
    adminLogo: "/assets/app-icons/yonetici/master.svg",
    personelLogo: "/assets/app-icons/personel/master.svg",
    favicon: "/assets/app-icons/yonetici/favicon-32.png"
  });
  const CACHE_KEY = "menu-suite:public-brand:v1";
  let currentBrand = {};
  let pendingLoad = null;

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function brandName(brand, fallback = "") {
    return text(brand && (brand.cafeName || brand.menuBrandTitle)) || text(fallback);
  }

  function logoKey(kind) {
    if (kind === "personel") return "personelLogoUrl";
    if (kind === "passwordReset") return "passwordResetLogoUrl";
    if (kind === "offline") return "offlineLogoUrl";
    if (kind === "about") return "aboutLogoUrl";
    if (kind === "menuHeader") return "menuHeaderLogoUrl";
    if (kind === "menu") return "menuMainLogoUrl";
    return "adminLogoUrl";
  }

  function role(kind, appId) {
    const value = `${text(kind)} ${text(appId)}`.toLocaleLowerCase("tr-TR");
    if (value.includes("personel")) return "personel";
    if (value.includes("muhasebe") || value.includes("accounting")) return "admin";
    if (value.includes("menu")) return "menu";
    return "admin";
  }

  function defaultLogo(kind, appId) {
    const resolved = role(kind, appId);
    if (resolved === "personel") return defaults.personelLogo;
    if (resolved === "menu") return defaults.lightLogo;
    return defaults.adminLogo;
  }

  function isDefaultLogo(value) {
    return [defaults.lightLogo, defaults.darkLogo, defaults.adminLogo, defaults.personelLogo].includes(value);
  }

  function logo(brand, mode = "light", kind = "admin", appId) {
    const source = brand && typeof brand === "object" ? brand : {};
    return text(source[logoKey(kind)])
      || text(mode === "dark" ? source.darkLogoUrl : source.lightLogoUrl)
      || text(source.logo)
      || defaultLogo(kind, appId);
  }

  function favicon(brand, kind, appId, size = 32) {
    const source = brand && typeof brand === "object" ? brand : {};
    const resolved = role(kind, appId);
    const key = resolved === "personel" ? "personelFaviconUrl" : resolved === "menu" ? "menuFaviconUrl" : "adminFaviconUrl";
    const folder = resolved === "admin" ? "yonetici" : resolved;
    const normalizedSize = Number(size) === 48 ? 48 : 32;
    return text(source[key]) || text(source.favicon) || `/assets/app-icons/${folder}/favicon-${normalizedSize}.png`;
  }

  function appIcon(brand, kind, appId) {
    const source = brand && typeof brand === "object" ? brand : {};
    const resolved = role(kind, appId);
    const key = resolved === "personel" ? "personelAppIconUrl" : resolved === "menu" ? "menuAppIconUrl" : "adminAppIconUrl";
    const folder = resolved === "admin" ? "yonetici" : resolved;
    return text(source[key]) || `/assets/app-icons/${folder}/apple-touch-icon-180.png`;
  }

  function hasRegisteredLogo(brand, kind) {
    const source = brand && typeof brand === "object" ? brand : {};
    return Boolean(text(source[logoKey(kind)]) || text(source.lightLogoUrl) || text(source.darkLogoUrl) || text(source.logo));
  }

  function apply(brand, options = {}) {
    currentBrand = brand && typeof brand === "object" ? brand : currentBrand;
    if (typeof document === "undefined") return brandName(currentBrand, options.fallbackName);
    const kind = options.kind || options.appId || "admin";
    const resolvedRole = role(kind, options.appId);
    const fallbackName = resolvedRole === "personel" ? "Personel Paneli" : resolvedRole === "menu" ? "Uygulama" : "Yönetici Paneli";
    const name = brandName(currentBrand, options.fallbackName || fallbackName);
    document.documentElement.dataset.brandName = name;
    document.documentElement.dataset.brandEmpty = hasRegisteredLogo(currentBrand, kind) ? "false" : "true";
    const mode = options.mode === "dark" || options.mode === "light"
      ? options.mode
      : document.documentElement.dataset.appearanceMode === "dark" ? "dark" : "light";
    document.querySelectorAll(options.logoSelector || "[data-brand-logo]").forEach((image) => {
      const imageMode = image.dataset.brandLogoMode || mode;
      const imageKind = image.dataset.brandLogoKind || kind;
      const target = logo(currentBrand, imageMode, imageKind, options.appId || kind);
      image.src = target;
      image.alt = brandName(currentBrand) ? `${brandName(currentBrand)} logosu` : "Uygulama simgesi";
      image.classList.add("brand-identity-logo");
      image.classList.toggle("brand-custom-logo", !isDefaultLogo(target));
      image.onerror = () => {
        image.onerror = null;
        image.src = defaultLogo(imageKind, options.appId || kind);
        image.classList.remove("brand-custom-logo");
      };
    });
    document.querySelectorAll('link[rel~="icon"]').forEach((link) => {
      const iconSize = /(?:^|\s)48x48(?:\s|$)/.test(link.getAttribute("sizes") || "") ? 48 : 32;
      link.href = favicon(currentBrand, kind, options.appId, iconSize);
    });
    document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((link) => { link.href = appIcon(currentBrand, kind, options.appId); });
    return name;
  }

  function cachedBrand() {
    if (typeof localStorage === "undefined") return {};
    try {
      const value = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (_error) {
      return {};
    }
  }

  function cacheBrand(brand) {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(brand || {})); } catch (_error) {}
    cachePublicBrandAssets(brand);
  }

  function cachePublicBrandAssets(brand) {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const source = brand && typeof brand === "object" ? brand : {};
    const urls = [
      source.lightLogoUrl, source.darkLogoUrl, source.menuMainLogoUrl, source.menuHeaderLogoUrl,
      source.adminLogoUrl, source.personelLogoUrl, source.passwordResetLogoUrl, source.offlineLogoUrl,
      source.aboutLogoUrl, source.defaultContentImageUrl, source.menuFaviconUrl, source.adminFaviconUrl,
      source.personelFaviconUrl, source.menuAppIconUrl, source.adminAppIconUrl, source.personelAppIconUrl,
      source.logo, source.favicon
    ].map(text).filter(Boolean);
    navigator.serviceWorker.ready.then((registration) => {
      const worker = registration.active || registration.waiting || registration.installing;
      worker?.postMessage({ type: "CACHE_PUBLIC_BRAND", urls });
    }).catch(() => {});
  }

  async function fetchBrand() {
    const response = await fetch("/api/public/bootstrap", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error(`Public brand request failed (${response.status})`);
    const result = await response.json();
    const brand = result && result.menu && result.menu.settings && result.menu.settings.brandInfo || {};
    cacheBrand(brand);
    return brand;
  }

  async function load(options = {}) {
    const cached = cachedBrand();
    if (Object.keys(cached).length) apply(cached, options);
    if (!pendingLoad) pendingLoad = fetchBrand().finally(() => { pendingLoad = null; });
    try {
      const brand = await pendingLoad;
      apply(brand, options);
      return brand;
    } catch (_error) {
      const fallback = Object.keys(cached).length ? cached : {};
      apply(fallback, options);
      return fallback;
    }
  }

  function remember(brand, options = {}) {
    const source = brand && typeof brand === "object" ? brand : {};
    cacheBrand(source);
    apply(source, options);
    return source;
  }

  return Object.freeze({ defaults, brandName, logo, favicon, appIcon, apply, load, remember });
});
