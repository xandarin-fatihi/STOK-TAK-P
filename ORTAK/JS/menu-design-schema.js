(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MenuSuiteMenuDesignSchema = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DESIGN_SCHEMA_VERSION = 5;
  const DEFAULT_PRESET_ID = "warm-beige";
  const BRAND_BODY_FONT = '"Panel Sans", Poppins, Arial, sans-serif';
  const STYLE_TYPES = new Set(["solid", "gradient", "image"]);
  const BANNER_MODES = new Set(["random", "products", "images", "video"]);
  const PRODUCT_IMAGE_ASPECTS = new Set(["landscape", "square", "source"]);
  const PRODUCT_IMAGE_FITS = new Set(["contain", "cover"]);
  const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  const DEFAULT_THEME_PROFILES = deepFreeze({
    light: {
      presetId: "classic-cream",
      customized: false,
      bgColor: "#F7EFE4",
      accentColor: "#4A2414",
      textColor: "#2A130A",
      buttonTextColor: "#FFF9F0",
      cardColor: "rgba(255,249,240,0.9)",
      productCardColor: "#FFF9F0",
      categoryCardColor: "#EFE1D0",
      socialIconColor: "#4A2414",
      menuBackground: {
        type: "gradient", color: "#F7EFE4", image: "", imageUrl: "",
        gradientStart: "#F7EFE4", gradientEnd: "#EFE1D0", gradientAngle: 160,
        overlay: 0.15, customized: false
      },
      bottomActions: {
        popular: {
          type: "gradient", color: "#4A2414", image: "", imageUrl: "",
          gradientStart: "#3A1B0F", gradientEnd: "#5A2D1A", gradientAngle: 145,
          overlay: 0.1, textColor: "#FFF9F0", customized: false
        },
        home: {
          type: "gradient", color: "#4A2414", image: "", imageUrl: "",
          gradientStart: "#2A130A", gradientEnd: "#4A2414", gradientAngle: 135,
          overlay: 0.12, textColor: "#FFF9F0", customized: false
        },
        suggest: {
          type: "gradient", color: "#4A2414", image: "", imageUrl: "",
          gradientStart: "#3A1B0F", gradientEnd: "#5A2D1A", gradientAngle: 145,
          overlay: 0.1, textColor: "#FFF9F0", customized: false
        }
      }
    },
    dark: {
      presetId: "espresso",
      customized: false,
      bgColor: "#140905",
      accentColor: "#EFE1D0",
      textColor: "#F8E9D2",
      buttonTextColor: "#140905",
      cardColor: "rgba(33,17,10,0.92)",
      productCardColor: "#21110A",
      categoryCardColor: "#2A160D",
      socialIconColor: "#EFE1D0",
      menuBackground: {
        type: "gradient", color: "#140905", image: "", imageUrl: "",
        gradientStart: "#140905", gradientEnd: "#2A160D", gradientAngle: 145,
        overlay: 0.15, customized: false
      },
      bottomActions: {
        popular: {
          type: "gradient", color: "#2A160D", image: "", imageUrl: "",
          gradientStart: "#2A160D", gradientEnd: "#180B06", gradientAngle: 145,
          overlay: 0.1, textColor: "#F8E9D2", customized: false
        },
        home: {
          type: "gradient", color: "#FFF9F0", image: "", imageUrl: "",
          gradientStart: "#FFF9F0", gradientEnd: "#EFE1D0", gradientAngle: 135,
          overlay: 0.12, textColor: "#140905", customized: false
        },
        suggest: {
          type: "gradient", color: "#2A160D", image: "", imageUrl: "",
          gradientStart: "#2A160D", gradientEnd: "#180B06", gradientAngle: 145,
          overlay: 0.1, textColor: "#F8E9D2", customized: false
        }
      }
    }
  });

  const DEFAULT_SETTINGS = deepFreeze({
    designSchemaVersion: DESIGN_SCHEMA_VERSION,
    appliedPresetId: DEFAULT_PRESET_ID,
    bgColor: "#F7EFE4",
    darkBgColor: "#140905",
    accentColor: "#4A2414",
    textColor: "#2A130A",
    buttonTextColor: "#FFF9F0",
    cardColor: "rgba(255,249,240,0.9)",
    productCardColor: "#FFF9F0",
    categoryCardColor: "#EFE1D0",
    socialIconColor: "#4A2414",
    socialIconSize: 30,
    menuBackgroundImage: "",
    menuBackground: {
      type: "gradient",
      color: "#F7EFE4",
      image: "",
      imageUrl: "",
      gradientStart: "#F7EFE4",
      gradientEnd: "#EFE1D0",
      gradientAngle: 160,
      overlay: 0.15,
      customized: false
    },
    fonts: {
      title: BRAND_BODY_FONT,
      category: BRAND_BODY_FONT,
      product: BRAND_BODY_FONT
    },
    typography: {
      menuTitle: 36,
      categoryTitle: 24,
      productTitle: 13,
      productDesc: 10,
      productIngredients: 10,
      productPrice: 10
    },
    bottomActions: {
      popular: {
        type: "gradient",
        color: "#4A2414",
        image: "",
        imageUrl: "",
        gradientStart: "#3A1B0F",
        gradientEnd: "#5A2D1A",
        gradientAngle: 145,
        overlay: 0.1,
        textColor: "#FFF9F0",
        customized: false
      },
      home: {
        type: "gradient",
        color: "#4A2414",
        image: "",
        imageUrl: "",
        gradientStart: "#2A130A",
        gradientEnd: "#4A2414",
        gradientAngle: 135,
        overlay: 0.12,
        textColor: "#FFF9F0",
        customized: false
      },
      suggest: {
        type: "gradient",
        color: "#4A2414",
        image: "",
        imageUrl: "",
        gradientStart: "#3A1B0F",
        gradientEnd: "#5A2D1A",
        gradientAngle: 145,
        overlay: 0.1,
        textColor: "#FFF9F0",
        customized: false
      }
    },
    themeProfiles: DEFAULT_THEME_PROFILES,
    banner: {
      mode: "random",
      title: "ÖNE ÇIKANLAR",
      subtitle: "Öne çıkan lezzetler",
      video: "",
      videoUrl: "",
      videos: [],
      images: [],
      productIds: []
    },
    menuUpdateDate: "",
    brandInfo: {
      cafeName: "",
      shortDescription: "",
      slogan: "",
      menuBrandTitle: "",
      menuBrandSubtitle: "",
      phone: "",
      whatsapp: "",
      address: "",
      hours: "",
      instagram: "",
      tiktok: "",
      email: "",
      logo: "",
      favicon: "",
      lightLogoUrl: "",
      darkLogoUrl: "",
      menuMainLogoUrl: "",
      menuHeaderLogoUrl: "",
      adminLogoUrl: "",
      personelLogoUrl: "",
      passwordResetLogoUrl: "",
      offlineLogoUrl: "",
      aboutLogoUrl: "",
      defaultContentImageUrl: "",
      menuFaviconUrl: "",
      adminFaviconUrl: "",
      personelFaviconUrl: "",
      menuAppIconUrl: "",
      adminAppIconUrl: "",
      personelAppIconUrl: "",
      menuBrowserTitle: "Dijital Menü",
      adminBrowserTitle: "Yönetici Paneli",
      personelBrowserTitle: "Personel",
      aboutButtonText: "Hakkımızda",
      welcomeTitle: "Dijital Menüye Hoş Geldiniz",
      menuButtonText: "MENÜ",
      socialTitle: "Bizi takip edin",
      socialSubtitle: "Sosyal medya hesaplarımız",
      feedbackTitle: "İstek & Şikayet",
      feedbackSubtitle: "Mesajınızı bize iletin",
      aboutTitle: "Hakkımızda",
      storyTitle: "MARKA HİKAYEMİZ",
      storyText: "Markamız, özenle hazırlanan ürünleri ve iyi bir deneyimi bir araya getirir.",
      storySignature: ""
    }
  });

  function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;
    const result = {};
    Object.keys(value).forEach((key) => {
      if (!BLOCKED_KEYS.has(key)) result[key] = cloneValue(value[key]);
    });
    return result;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return Object.freeze(value);
  }

  function stringValue(value, fallback, options) {
    const allowEmpty = Boolean(options && options.allowEmpty);
    const maxLength = Number(options && options.maxLength || 5000);
    if (typeof value !== "string") return String(fallback == null ? "" : fallback);
    const text = value.trim().length || allowEmpty ? value : String(fallback == null ? "" : fallback);
    return text.length <= maxLength ? text : String(fallback == null ? "" : fallback);
  }

  function finiteNumber(value, fallback, min, max) {
    if (value === "" || value === null || value === undefined || typeof value === "boolean") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizedPresetId(source) {
    const explicit = stringValue(source.appliedPresetId, "", { allowEmpty: true, maxLength: 120 }).trim();
    if (explicit) return normalizeTechnicalPresetId(explicit, DEFAULT_PRESET_ID);
    const legacy = stringValue(source.designPresetVersion, "", { allowEmpty: true, maxLength: 120 }).trim();
    return normalizeTechnicalPresetId(legacy, DEFAULT_PRESET_ID);
  }

  function normalizeTechnicalPresetId(value, fallback) {
    const text = String(value || "").trim();
    if (!text) return fallback;
    const retiredNamespace = ["tah", "misci"].join("");
    if (!text.toLowerCase().startsWith(`${retiredNamespace}-`)) return text;
    const suffix = text.slice(retiredNamespace.length + 1).toLowerCase();
    return suffix.includes("legacy-green") ? "classic-green" : "warm-beige";
  }

  function normalizeTechnicalFont(value, fallback) {
    let text = stringValue(value, fallback, { maxLength: 240 });
    const retiredName = ["Tah", "misci"].join("");
    text = text.replace(new RegExp(`${retiredName}\\s+Poppins`, "gi"), "Panel Sans");
    text = text.replace(new RegExp(`${retiredName}\\s+Magnolia`, "gi"), "Panel Script");
    return text;
  }

  function normalizeFonts(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.title = normalizeTechnicalFont(source.title, DEFAULT_SETTINGS.fonts.title);
    source.category = normalizeTechnicalFont(source.category, DEFAULT_SETTINGS.fonts.category);
    source.product = normalizeTechnicalFont(source.product, DEFAULT_SETTINGS.fonts.product);
    return source;
  }

  function normalizeTypography(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.menuTitle = finiteNumber(source.menuTitle, DEFAULT_SETTINGS.typography.menuTitle, 18, 54);
    source.categoryTitle = finiteNumber(source.categoryTitle, DEFAULT_SETTINGS.typography.categoryTitle, 14, 34);
    source.productTitle = finiteNumber(source.productTitle, DEFAULT_SETTINGS.typography.productTitle, 10, 28);
    source.productDesc = finiteNumber(source.productDesc, DEFAULT_SETTINGS.typography.productDesc, 8, 22);
    source.productIngredients = finiteNumber(source.productIngredients, DEFAULT_SETTINGS.typography.productIngredients, 8, 22);
    source.productPrice = finiteNumber(source.productPrice, DEFAULT_SETTINGS.typography.productPrice, 8, 22);
    return source;
  }

  function normalizeStyle(value, defaults) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const fallback = isRecord(defaults) ? defaults : {};
    const explicitCustomized = typeof source.customized === "boolean" ? source.customized : null;
    const image = stringValue(source.image, fallback.image || "", { allowEmpty: true });
    const imageUrl = stringValue(source.imageUrl, fallback.imageUrl || "", { allowEmpty: true });
    const fallbackType = STYLE_TYPES.has(fallback.type)
      ? fallback.type
      : (image || imageUrl ? "image" : "gradient");
    source.type = STYLE_TYPES.has(source.type) ? source.type : (image || imageUrl ? "image" : fallbackType);
    source.color = stringValue(source.color, fallback.color || "", { allowEmpty: true, maxLength: 128 });
    source.image = image;
    source.imageUrl = imageUrl;
    source.gradientStart = stringValue(
      source.gradientStart,
      fallback.gradientStart || source.color || DEFAULT_SETTINGS.productCardColor,
      { maxLength: 128 }
    );
    source.gradientEnd = stringValue(source.gradientEnd, fallback.gradientEnd || "#E5E7EB", { maxLength: 128 });
    source.gradientAngle = finiteNumber(source.gradientAngle, finiteNumber(fallback.gradientAngle, 145, -360, 360), -360, 360);
    source.overlay = finiteNumber(source.overlay, finiteNumber(fallback.overlay, 0, 0, 0.85), 0, 0.85);
    source.textColor = stringValue(source.textColor, fallback.textColor || "", { allowEmpty: true, maxLength: 128 });
    source.customized = explicitCustomized === null ? styleDiffersFromDefaults(source, fallback) : explicitCustomized;
    return source;
  }

  function styleDiffersFromDefaults(style, defaults) {
    if (!isRecord(defaults) || !Object.keys(defaults).length) return false;
    const fallbackImage = stringValue(defaults.image, "", { allowEmpty: true });
    const fallbackImageUrl = stringValue(defaults.imageUrl, "", { allowEmpty: true });
    const fallbackType = STYLE_TYPES.has(defaults.type)
      ? defaults.type
      : (fallbackImage || fallbackImageUrl ? "image" : "gradient");
    const expected = {
      type: fallbackType,
      color: stringValue(defaults.color, "", { allowEmpty: true, maxLength: 128 }),
      image: fallbackImage,
      imageUrl: fallbackImageUrl,
      gradientStart: stringValue(defaults.gradientStart, defaults.color || DEFAULT_SETTINGS.productCardColor, { maxLength: 128 }),
      gradientEnd: stringValue(defaults.gradientEnd, "#E5E7EB", { maxLength: 128 }),
      gradientAngle: finiteNumber(defaults.gradientAngle, 145, -360, 360),
      overlay: finiteNumber(defaults.overlay, 0, 0, 0.85),
      textColor: stringValue(defaults.textColor, "", { allowEmpty: true, maxLength: 128 })
    };
    return style.type !== expected.type
      || !sameStyleValue(style.color, expected.color)
      || style.image !== expected.image
      || style.imageUrl !== expected.imageUrl
      || !sameStyleValue(style.gradientStart, expected.gradientStart)
      || !sameStyleValue(style.gradientEnd, expected.gradientEnd)
      || Number(style.gradientAngle) !== Number(expected.gradientAngle)
      || Number(style.overlay) !== Number(expected.overlay)
      || !sameStyleValue(style.textColor, expected.textColor);
  }

  function sameStyleValue(first, second) {
    return String(first || "").replace(/\s+/g, "").toLowerCase()
      === String(second || "").replace(/\s+/g, "").toLowerCase();
  }

  function normalizeBackground(value, settings) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const fallbackSettings = isRecord(settings) ? settings : DEFAULT_SETTINGS;
    const imageFallback = stringValue(fallbackSettings.menuBackgroundImage, "", { allowEmpty: true });
    const normalized = normalizeStyle(source, {
      type: imageFallback ? "image" : DEFAULT_SETTINGS.menuBackground.type,
      color: fallbackSettings.bgColor || DEFAULT_SETTINGS.bgColor,
      image: imageFallback,
      imageUrl: "",
      gradientStart: fallbackSettings.bgColor || DEFAULT_SETTINGS.bgColor,
      gradientEnd: DEFAULT_SETTINGS.menuBackground.gradientEnd,
      gradientAngle: DEFAULT_SETTINGS.menuBackground.gradientAngle,
      overlay: DEFAULT_SETTINGS.menuBackground.overlay
    });
    if (typeof source.customized !== "boolean") {
      const sourceType = STYLE_TYPES.has(source.type) ? source.type : DEFAULT_SETTINGS.menuBackground.type;
      const sourceColor = stringValue(source.color, "", { allowEmpty: true, maxLength: 128 });
      const sourceStart = stringValue(source.gradientStart, fallbackSettings.bgColor || DEFAULT_SETTINGS.bgColor, { maxLength: 128 });
      const sourceEnd = stringValue(source.gradientEnd, DEFAULT_SETTINGS.menuBackground.gradientEnd, { maxLength: 128 });
      const defaultLike = sourceType === DEFAULT_SETTINGS.menuBackground.type
        && !(source.image || source.imageUrl || imageFallback)
        && (!sourceColor || sameStyleValue(sourceColor, fallbackSettings.bgColor || DEFAULT_SETTINGS.bgColor))
        && (sameStyleValue(sourceStart, DEFAULT_SETTINGS.menuBackground.gradientStart)
          || sameStyleValue(sourceStart, fallbackSettings.bgColor || DEFAULT_SETTINGS.bgColor))
        && sameStyleValue(sourceEnd, DEFAULT_SETTINGS.menuBackground.gradientEnd)
        && finiteNumber(source.gradientAngle, DEFAULT_SETTINGS.menuBackground.gradientAngle, -360, 360) === DEFAULT_SETTINGS.menuBackground.gradientAngle
        && finiteNumber(source.overlay, DEFAULT_SETTINGS.menuBackground.overlay, 0, 0.85) === DEFAULT_SETTINGS.menuBackground.overlay;
      normalized.customized = !defaultLike;
    }
    return normalized;
  }

  function normalizeBottomActions(value, defaults) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const fallback = isRecord(defaults) ? defaults : DEFAULT_SETTINGS.bottomActions;
    source.popular = normalizeStyle(source.popular, fallback.popular || DEFAULT_SETTINGS.bottomActions.popular);
    source.home = normalizeStyle(source.home, fallback.home || DEFAULT_SETTINGS.bottomActions.home);
    source.suggest = normalizeStyle(source.suggest, fallback.suggest || DEFAULT_SETTINGS.bottomActions.suggest);
    return source;
  }

  function normalizeThemeProfile(value, defaults) {
    const fallback = isRecord(defaults) ? defaults : DEFAULT_THEME_PROFILES.light;
    const source = isRecord(value) ? cloneValue(value) : {};
    const explicitCustomized = typeof source.customized === "boolean" ? source.customized : null;
    source.presetId = normalizeTechnicalPresetId(source.presetId, fallback.presetId || "custom");
    [
      "bgColor", "accentColor", "textColor", "buttonTextColor", "cardColor",
      "productCardColor", "categoryCardColor", "socialIconColor"
    ].forEach((key) => {
      source[key] = stringValue(source[key], fallback[key], { maxLength: 128 });
    });
    source.menuBackground = normalizeStyle(source.menuBackground, fallback.menuBackground);
    source.bottomActions = normalizeBottomActions(source.bottomActions, fallback.bottomActions);
    source.customized = explicitCustomized === null
      ? themeProfileDiffersFromDefaults(source, fallback)
      : explicitCustomized;
    return source;
  }

  function themeProfileDiffersFromDefaults(profile, defaults) {
    const baseline = isRecord(defaults) ? defaults : DEFAULT_THEME_PROFILES.light;
    const baselineBackground = isRecord(baseline.menuBackground) ? baseline.menuBackground : DEFAULT_THEME_PROFILES.light.menuBackground;
    const baselineActions = isRecord(baseline.bottomActions) ? baseline.bottomActions : DEFAULT_THEME_PROFILES.light.bottomActions;
    const colorChanged = [
      "bgColor", "accentColor", "textColor", "buttonTextColor", "cardColor",
      "productCardColor", "categoryCardColor", "socialIconColor"
    ].some((key) => !sameStyleValue(profile[key], baseline[key]));
    if (colorChanged || styleDiffersFromDefaults(profile.menuBackground, baselineBackground)) return true;
    return ["popular", "home", "suggest"].some((key) => (
      styleDiffersFromDefaults(profile.bottomActions[key], baselineActions[key])
    ));
  }

  function legacyThemeProfile(settings, mode) {
    const source = isRecord(settings) ? settings : DEFAULT_SETTINGS;
    const legacyBackground = normalizeBackground(source.menuBackground, source);
    if (!legacyBackground.color) legacyBackground.color = source.bgColor || DEFAULT_SETTINGS.bgColor;
    const legacyActions = normalizeBottomActions(source.bottomActions);
    ["popular", "home", "suggest"].forEach((key) => {
      if (!legacyActions[key].textColor) legacyActions[key].textColor = source.buttonTextColor || DEFAULT_SETTINGS.buttonTextColor;
    });
    if (mode === "light") {
      return normalizeThemeProfile({
        presetId: "classic-cream",
        bgColor: source.bgColor,
        accentColor: source.accentColor,
        textColor: source.textColor,
        buttonTextColor: source.buttonTextColor,
        cardColor: source.cardColor,
        productCardColor: source.productCardColor,
        categoryCardColor: source.categoryCardColor,
        socialIconColor: source.socialIconColor,
        menuBackground: legacyBackground,
        bottomActions: legacyActions
      }, DEFAULT_THEME_PROFILES.light);
    }

    const defaults = DEFAULT_SETTINGS;
    const darkDefaults = DEFAULT_THEME_PROFILES.dark;
    const useLegacyBackground = legacyBackground.customized === true
      || legacyBackground.type === "image"
      || legacyBackground.type === "solid";
    const darkActions = {};
    ["popular", "home", "suggest"].forEach((key) => {
      darkActions[key] = legacyActions[key] && legacyActions[key].customized === true
        ? legacyActions[key]
        : darkDefaults.bottomActions[key];
    });
    return normalizeThemeProfile({
      presetId: "espresso",
      bgColor: source.darkBgColor,
      accentColor: sameStyleValue(source.accentColor, defaults.accentColor) ? darkDefaults.accentColor : source.accentColor,
      textColor: sameStyleValue(source.textColor, defaults.textColor) ? darkDefaults.textColor : source.textColor,
      buttonTextColor: sameStyleValue(source.buttonTextColor, defaults.buttonTextColor) ? darkDefaults.buttonTextColor : source.buttonTextColor,
      cardColor: sameStyleValue(source.cardColor, defaults.cardColor) ? darkDefaults.cardColor : source.cardColor,
      productCardColor: sameStyleValue(source.productCardColor, defaults.productCardColor) ? darkDefaults.productCardColor : source.productCardColor,
      categoryCardColor: sameStyleValue(source.categoryCardColor, defaults.categoryCardColor) ? darkDefaults.categoryCardColor : source.categoryCardColor,
      socialIconColor: sameStyleValue(source.socialIconColor, defaults.socialIconColor) ? darkDefaults.socialIconColor : source.socialIconColor,
      menuBackground: useLegacyBackground
        ? Object.assign({}, legacyBackground, legacyBackground.type === "solid" ? { color: source.darkBgColor } : {})
        : darkDefaults.menuBackground,
      bottomActions: darkActions
    }, darkDefaults);
  }

  function normalizeThemeProfiles(value, legacySettings) {
    const source = isRecord(value) ? value : {};
    const lightFallback = legacyThemeProfile(legacySettings, "light");
    const darkFallback = legacyThemeProfile(legacySettings, "dark");
    return {
      light: normalizeThemeProfile(source.light, lightFallback),
      dark: normalizeThemeProfile(source.dark, darkFallback)
    };
  }

  function normalizeMediaItem(value, index, kind) {
    if (typeof value === "string") {
      const src = value.trim();
      return src ? { id: "", src, name: `${kind === "video" ? "Video" : "Görsel"} ${index + 1}`, type: "", size: 0, kind } : null;
    }
    if (!isRecord(value)) return null;
    const source = cloneValue(value);
    const src = stringValue(source.src || source.url || source.data, "", { allowEmpty: true }).trim();
    if (!src) return null;
    source.id = stringValue(source.id, "", { allowEmpty: true, maxLength: 200 }).trim();
    source.src = src;
    source.name = stringValue(source.name, `${kind === "video" ? "Video" : "Görsel"} ${index + 1}`, { maxLength: 300 });
    source.type = stringValue(source.type, "", { allowEmpty: true, maxLength: 160 });
    source.size = finiteNumber(source.size, 0, 0, Number.MAX_SAFE_INTEGER);
    source.kind = stringValue(source.kind, kind, { maxLength: 40 });
    delete source.url;
    delete source.data;
    return source;
  }

  function normalizeMediaList(value, kind) {
    const list = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
        : [];
    return list.map((item, index) => normalizeMediaItem(item, index, kind)).filter(Boolean);
  }

  function normalizeBanner(value) {
    const source = isRecord(value) ? cloneValue(value) : {};
    source.mode = BANNER_MODES.has(source.mode) ? source.mode : DEFAULT_SETTINGS.banner.mode;
    source.title = typeof source.title === "string" ? stringValue(source.title, "", { allowEmpty: true, maxLength: 500 }) : DEFAULT_SETTINGS.banner.title;
    source.subtitle = typeof source.subtitle === "string" ? stringValue(source.subtitle, "", { allowEmpty: true, maxLength: 1000 }) : DEFAULT_SETTINGS.banner.subtitle;
    source.video = stringValue(source.video, "", { allowEmpty: true });
    source.videoUrl = stringValue(source.videoUrl, "", { allowEmpty: true });
    const legacyVideo = source.videoUrl || source.video;
    source.videos = Array.isArray(source.videos)
      ? normalizeMediaList(source.videos, "video")
      : legacyVideo ? normalizeMediaList([legacyVideo], "video") : [];
    source.images = normalizeMediaList(source.images, "image");
    source.productIds = Array.isArray(source.productIds)
      ? source.productIds.map((item) => String(item == null ? "" : item).trim()).filter(Boolean)
      : [];
    return source;
  }

  function normalizeSettings(value) {
    const source = isRecord(value) ? sanitizeLegacyBrandAssets(cloneValue(value)) : {};
    const appliedPresetId = normalizedPresetId(source);
    delete source.designPresetVersion;
    source.designSchemaVersion = DESIGN_SCHEMA_VERSION;
    source.appliedPresetId = appliedPresetId;
    [
      "bgColor", "darkBgColor", "accentColor", "textColor", "buttonTextColor",
      "cardColor", "productCardColor", "categoryCardColor", "socialIconColor"
    ].forEach((key) => {
      source[key] = stringValue(source[key], DEFAULT_SETTINGS[key], { maxLength: 128 });
    });
    source.socialIconSize = finiteNumber(source.socialIconSize, DEFAULT_SETTINGS.socialIconSize, 12, 72);
    source.menuBackgroundImage = stringValue(source.menuBackgroundImage, "", { allowEmpty: true });
    source.fonts = normalizeFonts(source.fonts);
    source.typography = normalizeTypography(source.typography);
    source.menuBackground = normalizeBackground(source.menuBackground, source);
    source.bottomActions = normalizeBottomActions(source.bottomActions);
    source.themeProfiles = normalizeThemeProfiles(source.themeProfiles, source);
    source.bgColor = source.themeProfiles.light.bgColor;
    source.darkBgColor = source.themeProfiles.dark.bgColor;
    source.accentColor = source.themeProfiles.light.accentColor;
    source.textColor = source.themeProfiles.light.textColor;
    source.buttonTextColor = source.themeProfiles.light.buttonTextColor;
    source.cardColor = source.themeProfiles.light.cardColor;
    source.productCardColor = source.themeProfiles.light.productCardColor;
    source.categoryCardColor = source.themeProfiles.light.categoryCardColor;
    source.socialIconColor = source.themeProfiles.light.socialIconColor;
    source.menuBackground = cloneValue(source.themeProfiles.light.menuBackground);
    source.menuBackgroundImage = source.menuBackground.imageUrl || source.menuBackground.image || "";
    source.bottomActions = cloneValue(source.themeProfiles.light.bottomActions);
    source.banner = normalizeBanner(source.banner);
    source.menuUpdateDate = stringValue(source.menuUpdateDate, "", { allowEmpty: true, maxLength: 160 });
    const brandInfo = isRecord(source.brandInfo) ? source.brandInfo : {};
    source.brandInfo = {};
    Object.keys(DEFAULT_SETTINGS.brandInfo).forEach((key) => {
      const longText = key === "shortDescription" || key === "storyText";
      source.brandInfo[key] = stringValue(brandInfo[key], DEFAULT_SETTINGS.brandInfo[key], { allowEmpty: true, maxLength: longText ? 5000 : 500 });
    });
    return source;
  }

  function normalizeCategoryDesign(value, index) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const legacyColor = stringValue(source.color, "", { allowEmpty: true, maxLength: 128 });
    const legacyImage = stringValue(source.image || source.imageUrl, "", { allowEmpty: true });
    const legacyDefaultColor = sameStyleValue(legacyColor, DEFAULT_SETTINGS.categoryCardColor);
    const explicitStyle = isRecord(source.style) ? source.style : {};
    const categoryDefaults = {
      type: legacyImage ? "image" : (legacyColor && !legacyDefaultColor ? "solid" : "gradient"),
      color: legacyColor || DEFAULT_SETTINGS.categoryCardColor,
      image: legacyImage,
      imageUrl: "",
      gradientStart: legacyColor || DEFAULT_SETTINGS.categoryCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 135,
      overlay: 0.12
    };
    source.style = normalizeStyle(explicitStyle, categoryDefaults);
    source.color = hasOwn(source, "color") && typeof source.color === "string" ? source.color : source.style.color;
    source.image = hasOwn(source, "image") && typeof source.image === "string"
      ? source.image
      : (source.style.imageUrl || source.style.image || "");
    source.products = Array.isArray(source.products)
      ? source.products.map((product, productIndex) => normalizeProductDesign(product, productIndex))
      : [];
    if (!hasOwn(source, "order")) source.order = index;
    return source;
  }

  function normalizeProductDesign(value, index) {
    const source = isRecord(value) ? cloneValue(value) : {};
    const legacyColor = stringValue(source.cardColor, "", { allowEmpty: true, maxLength: 128 });
    const legacyDefaultColor = sameStyleValue(legacyColor, DEFAULT_SETTINGS.productCardColor);
    const explicitStyle = isRecord(source.style) ? source.style : {};
    source.style = normalizeStyle(explicitStyle, {
      type: legacyColor && !legacyDefaultColor ? "solid" : "gradient",
      color: legacyColor || DEFAULT_SETTINGS.productCardColor,
      image: "",
      imageUrl: "",
      gradientStart: legacyColor || DEFAULT_SETTINGS.productCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 145,
      overlay: 0
    });
    source.cardColor = hasOwn(source, "cardColor") && typeof source.cardColor === "string" ? source.cardColor : source.style.color;
    source.imageOverlay = finiteNumber(source.imageOverlay, 0, 0, 0.85);
    source.imageAspect = PRODUCT_IMAGE_ASPECTS.has(source.imageAspect) ? source.imageAspect : "landscape";
    source.imageFit = PRODUCT_IMAGE_FITS.has(source.imageFit) ? source.imageFit : "contain";
    if (!hasOwn(source, "order")) source.order = index;
    return source;
  }

  function normalizeMenuState(value) {
    const source = isRecord(value) ? sanitizeLegacyBrandAssets(cloneValue(value)) : {};
    source.settings = normalizeSettings(source.settings);
    source.categories = Array.isArray(source.categories)
      ? source.categories.map((category, index) => normalizeCategoryDesign(category, index))
      : [];
    return source;
  }

  // Old backups/defaults must not resurrect removed packaged photos.
  // Uploaded media, product text and user data are deliberately not rewritten.
  function sanitizeLegacyBrandAssets(value) {
    if (typeof value === "string") {
      const text = value.replace(/\/assets\/images\/(?:hero\/hero-2|products\/product-(?:1|2|4|5|8|10))\.jpg/g, "/assets/images/hero/coffee-service.jpg");
      return /^\/assets\/brand\/(?:favicon(?:\.[a-z0-9]+)?|icon-white|logo-(?:compact|dark|green-compact|large|light-green|light|primary))\.(?:png|svg)$/i.test(text.trim()) ? "" : text;
    }
    if (Array.isArray(value)) return value.map(sanitizeLegacyBrandAssets);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeLegacyBrandAssets(item)]));
    return value;
  }

  function projectStyle(value, defaults) {
    const style = normalizeStyle(value, defaults);
    return {
      type: style.type,
      color: style.color,
      image: style.image,
      imageUrl: style.imageUrl,
      gradientStart: style.gradientStart,
      gradientEnd: style.gradientEnd,
      gradientAngle: style.gradientAngle,
      overlay: style.overlay,
      textColor: style.textColor,
      customized: style.customized
    };
  }

  function projectSettings(value) {
    const settings = normalizeSettings(value);
    return {
      designSchemaVersion: settings.designSchemaVersion,
      appliedPresetId: settings.appliedPresetId,
      bgColor: settings.bgColor,
      darkBgColor: settings.darkBgColor,
      accentColor: settings.accentColor,
      textColor: settings.textColor,
      buttonTextColor: settings.buttonTextColor,
      cardColor: settings.cardColor,
      productCardColor: settings.productCardColor,
      categoryCardColor: settings.categoryCardColor,
      socialIconColor: settings.socialIconColor,
      socialIconSize: settings.socialIconSize,
      menuBackgroundImage: settings.menuBackgroundImage,
      menuBackground: projectStyle(settings.menuBackground, DEFAULT_SETTINGS.menuBackground),
      fonts: {
        title: settings.fonts.title,
        category: settings.fonts.category,
        product: settings.fonts.product
      },
      typography: {
        menuTitle: settings.typography.menuTitle,
        categoryTitle: settings.typography.categoryTitle,
        productTitle: settings.typography.productTitle,
        productDesc: settings.typography.productDesc,
        productIngredients: settings.typography.productIngredients,
        productPrice: settings.typography.productPrice
      },
      bottomActions: {
        popular: projectStyle(settings.bottomActions.popular, DEFAULT_SETTINGS.bottomActions.popular),
        home: projectStyle(settings.bottomActions.home, DEFAULT_SETTINGS.bottomActions.home),
        suggest: projectStyle(settings.bottomActions.suggest, DEFAULT_SETTINGS.bottomActions.suggest)
      },
      themeProfiles: {
        light: projectThemeProfile(settings.themeProfiles.light, DEFAULT_THEME_PROFILES.light),
        dark: projectThemeProfile(settings.themeProfiles.dark, DEFAULT_THEME_PROFILES.dark)
      },
      banner: {
        mode: settings.banner.mode,
        title: settings.banner.title,
        subtitle: settings.banner.subtitle,
        video: settings.banner.video,
        videoUrl: settings.banner.videoUrl,
        videos: cloneValue(settings.banner.videos),
        images: cloneValue(settings.banner.images),
        productIds: settings.banner.productIds.slice()
      },
      menuUpdateDate: settings.menuUpdateDate,
      brandInfo: cloneValue(settings.brandInfo)
    };
  }

  function projectThemeProfile(value, defaults) {
    const profile = normalizeThemeProfile(value, defaults);
    return {
      presetId: profile.presetId,
      customized: profile.customized,
      bgColor: profile.bgColor,
      accentColor: profile.accentColor,
      textColor: profile.textColor,
      buttonTextColor: profile.buttonTextColor,
      cardColor: profile.cardColor,
      productCardColor: profile.productCardColor,
      categoryCardColor: profile.categoryCardColor,
      socialIconColor: profile.socialIconColor,
      menuBackground: projectStyle(profile.menuBackground, defaults.menuBackground),
      bottomActions: {
        popular: projectStyle(profile.bottomActions.popular, defaults.bottomActions.popular),
        home: projectStyle(profile.bottomActions.home, defaults.bottomActions.home),
        suggest: projectStyle(profile.bottomActions.suggest, defaults.bottomActions.suggest)
      }
    };
  }

  function designProjection(value) {
    const menu = normalizeMenuState(value);
    return {
      settings: projectSettings(menu.settings),
      categories: menu.categories.map((category) => ({
        id: String(category.id || ""),
        color: typeof category.color === "string" ? category.color : "",
        image: typeof category.image === "string" ? category.image : "",
        style: projectStyle(category.style, {
          gradientStart: menu.settings.categoryCardColor,
          gradientEnd: "#E5E7EB",
          gradientAngle: 135,
          overlay: 0.12
        }),
        products: category.products.map((product) => ({
          id: String(product.id || ""),
          cardColor: typeof product.cardColor === "string" ? product.cardColor : "",
          image: typeof product.image === "string" ? product.image : "",
          imageUrl: typeof product.imageUrl === "string" ? product.imageUrl : "",
          imageOverlay: finiteNumber(product.imageOverlay, 0, 0, 0.85),
          imageAspect: PRODUCT_IMAGE_ASPECTS.has(product.imageAspect) ? product.imageAspect : "landscape",
          imageFit: PRODUCT_IMAGE_FITS.has(product.imageFit) ? product.imageFit : "contain",
          style: projectStyle(product.style, {
            gradientStart: menu.settings.productCardColor,
            gradientEnd: "#E5E7EB",
            gradientAngle: 145,
            overlay: 0
          })
        }))
      }))
    };
  }

  function normalizeDesignSnapshot(value) {
    const source = isRecord(value) ? value : {};
    const settings = projectSettings(source.settings);
    const categoryIds = new Set();
    const productIds = new Set();
    const categoryDesign = (Array.isArray(source.categoryDesign) ? source.categoryDesign : [])
      .map((item) => {
        if (!isRecord(item)) return null;
        const id = safeDesignId(item.id);
        if (!id || categoryIds.has(id)) return null;
        categoryIds.add(id);
        return {
          id,
          color: stringValue(item.color, settings.categoryCardColor, { allowEmpty: true, maxLength: 128 }),
          style: projectStyle(item.style, {
            type: "gradient",
            color: settings.categoryCardColor,
            gradientStart: settings.categoryCardColor,
            gradientEnd: "#E5E7EB",
            gradientAngle: 135,
            overlay: 0.12
          })
        };
      })
      .filter(Boolean);
    const productDesign = (Array.isArray(source.productDesign) ? source.productDesign : [])
      .map((item) => {
        if (!isRecord(item)) return null;
        const id = safeDesignId(item.id);
        const categoryId = safeDesignId(item.categoryId);
        const identity = `${categoryId}:${id}`;
        if (!id || productIds.has(identity)) return null;
        productIds.add(identity);
        return {
          id,
          categoryId,
          cardColor: stringValue(item.cardColor, settings.productCardColor, { allowEmpty: true, maxLength: 128 }),
          imageOverlay: finiteNumber(item.imageOverlay, 0, 0, 0.85),
          imageAspect: PRODUCT_IMAGE_ASPECTS.has(item.imageAspect) ? item.imageAspect : "landscape",
          imageFit: PRODUCT_IMAGE_FITS.has(item.imageFit) ? item.imageFit : "contain",
          style: projectStyle(item.style, {
            type: "gradient",
            color: settings.productCardColor,
            gradientStart: settings.productCardColor,
            gradientEnd: "#E5E7EB",
            gradientAngle: 145,
            overlay: 0
          })
        };
      })
      .filter(Boolean);
    return {
      schemaVersion: DESIGN_SCHEMA_VERSION,
      settings,
      categoryDesign,
      productDesign
    };
  }

  function createDesignSnapshot(value) {
    const menu = normalizeMenuState(value);
    return normalizeDesignSnapshot({
      schemaVersion: DESIGN_SCHEMA_VERSION,
      settings: menu.settings,
      categoryDesign: menu.categories.map((category) => ({
        id: category.id,
        color: category.color,
        style: category.style
      })),
      productDesign: menu.categories.flatMap((category) => category.products.map((product) => ({
        id: product.id,
        categoryId: category.id,
        cardColor: product.cardColor,
        imageOverlay: product.imageOverlay,
        imageAspect: product.imageAspect,
        imageFit: product.imageFit,
        style: product.style
      })))
    });
  }

  function createFactoryDesignSnapshot(value) {
    const menu = normalizeMenuState(value);
    return normalizeDesignSnapshot({
      schemaVersion: DESIGN_SCHEMA_VERSION,
      settings: DEFAULT_SETTINGS,
      categoryDesign: menu.categories.map((category) => ({
        id: category.id,
        color: DEFAULT_SETTINGS.categoryCardColor,
        style: {
          type: "gradient",
          color: DEFAULT_SETTINGS.categoryCardColor,
          image: "",
          imageUrl: "",
          gradientStart: DEFAULT_SETTINGS.categoryCardColor,
          gradientEnd: "#E5E7EB",
          gradientAngle: 135,
          overlay: 0.12
        }
      })),
      productDesign: menu.categories.flatMap((category) => category.products.map((product) => ({
        id: product.id,
        categoryId: category.id,
        cardColor: DEFAULT_SETTINGS.productCardColor,
        imageOverlay: 0,
        imageAspect: "landscape",
        imageFit: "contain",
        style: {
          type: "gradient",
          color: DEFAULT_SETTINGS.productCardColor,
          image: "",
          imageUrl: "",
          gradientStart: DEFAULT_SETTINGS.productCardColor,
          gradientEnd: "#E5E7EB",
          gradientAngle: 145,
          overlay: 0
        }
      })))
    });
  }

  function applyDesignSnapshot(value, snapshot) {
    const menu = normalizeMenuState(value);
    const design = normalizeDesignSnapshot(snapshot);
    const categoryById = new Map(design.categoryDesign.map((item) => [item.id, item]));
    const productByIdentity = new Map(design.productDesign.map((item) => [`${item.categoryId}:${item.id}`, item]));
    const productById = new Map(design.productDesign.map((item) => [item.id, item]));
    menu.settings = cloneValue(design.settings);
    menu.categories = menu.categories.map((category) => {
      const categoryPatch = categoryById.get(String(category.id || ""));
      if (categoryPatch) {
        category.color = categoryPatch.color;
        category.style = cloneValue(categoryPatch.style);
      }
      category.products = category.products.map((product) => {
        const productPatch = productByIdentity.get(`${String(category.id || "")}:${String(product.id || "")}`)
          || productById.get(String(product.id || ""));
        if (!productPatch) return product;
        product.cardColor = productPatch.cardColor;
        product.imageOverlay = productPatch.imageOverlay;
        product.imageAspect = productPatch.imageAspect;
        product.imageFit = productPatch.imageFit;
        product.style = cloneValue(productPatch.style);
        return product;
      });
      return category;
    });
    return menu;
  }

  function safeDesignId(value) {
    const id = stringValue(value, "", { allowEmpty: true, maxLength: 160 }).trim();
    return !id || BLOCKED_KEYS.has(id) ? "" : id;
  }

  function designSnapshotFingerprint(value) {
    return JSON.stringify(stableValue(normalizeDesignSnapshot(value)));
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!isRecord(value)) return value;
    const result = {};
    Object.keys(value).sort().forEach((key) => { result[key] = stableValue(value[key]); });
    return result;
  }

  function designFingerprint(value) {
    return JSON.stringify(stableValue(designProjection(value)));
  }

  function designMatches(first, second) {
    return designFingerprint(first) === designFingerprint(second);
  }

  return Object.freeze({
    DESIGN_SCHEMA_VERSION,
    PRODUCT_IMAGE_ASPECTS,
    PRODUCT_IMAGE_FITS,
    DEFAULT_PRESET_ID,
    DEFAULT_SETTINGS,
    DEFAULT_THEME_PROFILES,
    normalizeSettings,
    normalizeFonts,
    normalizeTypography,
    normalizeBackground,
    normalizeBottomActions,
    normalizeThemeProfile,
    normalizeThemeProfiles,
    normalizeBanner,
    normalizeStyle,
    normalizeCategoryDesign,
    normalizeProductDesign,
    normalizeMenuState,
    sanitizeLegacyBrandAssets,
    projectSettings,
    projectStyle,
    designProjection,
    designFingerprint,
    designMatches,
    normalizeDesignSnapshot,
    createDesignSnapshot,
    createFactoryDesignSnapshot,
    applyDesignSnapshot,
    designSnapshotFingerprint,
    cloneValue
  });
});
