"use strict";

// Existing panel theme presets and token mapping, shared without a new palette.
(function (root, factory) {
  const theme = factory();
  if (typeof module === "object" && module.exports) module.exports = theme;
  else root.MenuSuitePanelTheme = theme;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const defaultPresetId = "coffee-beige";
  const PRESETS = Object.freeze([
    {
      id: "coffee-beige",
      name: "Kahve & Bej",
      swatches: ["#F5EBDD", "#E2C9A6", "#A67C52", "#6B4F3B", "#2F241C"],
      colors: {
        canvas: "#F5EBDD", surface: "#FFFAF3", surfaceAlt: "#F1E2CF", header: "#FBF4EA", input: "#FFFCF8",
        sidebar: "#6B4F3B", sidebarActive: "#A67C52", sidebarText: "#FFF8EE", sidebarActiveText: "#FFFFFF",
        primary: "#6B4F3B", primaryHover: "#2F241C", onPrimary: "#FFFFFF", accent: "#A67C52",
        text: "#2F241C", textSoft: "#6B4F3B", border: "#E2C9A6", chip: "#EEDCC5", chipText: "#6B4F3B",
        focus: "rgba(166, 124, 82, 0.32)", shadow: "rgba(47, 36, 28, 0.10)"
      }
    },
    {
      id: "olive-cream",
      name: "Zeytin & Krem",
      swatches: ["#F6F3EB", "#D8D2B0", "#A3A380", "#6B705C", "#2F3A2B"],
      colors: {
        canvas: "#F6F3EB", surface: "#FFFCF4", surfaceAlt: "#ECE8D5", header: "#F8F5EB", input: "#FFFEF9",
        sidebar: "#59634E", sidebarActive: "#A3A380", sidebarText: "#F8F6EA", sidebarActiveText: "#263126",
        primary: "#6B705C", primaryHover: "#2F3A2B", onPrimary: "#FFFFFF", accent: "#8B906B",
        text: "#2F3A2B", textSoft: "#68705F", border: "#D8D2B0", chip: "#E5E0C8", chipText: "#4E5947",
        focus: "rgba(107, 112, 92, 0.30)", shadow: "rgba(47, 58, 43, 0.10)"
      }
    },
    {
      id: "navy-ice-gray",
      name: "Lacivert & Buz Gri",
      swatches: ["#F5F7FB", "#DCE4F2", "#7C93C3", "#2E4A7D", "#1E293B"],
      colors: {
        canvas: "#F5F7FB", surface: "#FFFFFF", surfaceAlt: "#EAF0F8", header: "#F7F9FC", input: "#FFFFFF",
        sidebar: "#263F6C", sidebarActive: "#7C93C3", sidebarText: "#F4F7FD", sidebarActiveText: "#FFFFFF",
        primary: "#2E4A7D", primaryHover: "#1E293B", onPrimary: "#FFFFFF", accent: "#627FB7",
        text: "#1E293B", textSoft: "#607089", border: "#DCE4F2", chip: "#E3EBF7", chipText: "#2E4A7D",
        focus: "rgba(46, 74, 125, 0.28)", shadow: "rgba(30, 41, 59, 0.10)"
      }
    },
    {
      id: "anthracite-sand",
      name: "Antrasit & Kum",
      swatches: ["#F3F0EB", "#D8CEC2", "#9B8F87", "#4A4A4A", "#232323"],
      colors: {
        canvas: "#F3F0EB", surface: "#FCFAF7", surfaceAlt: "#E9E3DC", header: "#F7F4EF", input: "#FFFFFF",
        sidebar: "#3B3B3B", sidebarActive: "#80756E", sidebarText: "#F7F3EE", sidebarActiveText: "#FFFFFF",
        primary: "#4A4A4A", primaryHover: "#232323", onPrimary: "#FFFFFF", accent: "#8A7B70",
        text: "#232323", textSoft: "#68625E", border: "#D8CEC2", chip: "#E7DED5", chipText: "#4A4A4A",
        focus: "rgba(74, 74, 74, 0.26)", shadow: "rgba(35, 35, 35, 0.10)"
      }
    },
    {
      id: "burgundy-champagne",
      name: "Bordo & Şampanya",
      swatches: ["#FAF4EF", "#E7D3C4", "#C08A6B", "#7A2E3A", "#2F1A1F"],
      colors: {
        canvas: "#FAF4EF", surface: "#FFFDFC", surfaceAlt: "#F3E4DA", header: "#FCF7F3", input: "#FFFFFF",
        sidebar: "#6D2734", sidebarActive: "#A45A5D", sidebarText: "#FFF6F2", sidebarActiveText: "#FFFFFF",
        primary: "#7A2E3A", primaryHover: "#2F1A1F", onPrimary: "#FFFFFF", accent: "#C08A6B",
        text: "#2F1A1F", textSoft: "#795D60", border: "#E7D3C4", chip: "#F1DED5", chipText: "#7A2E3A",
        focus: "rgba(122, 46, 58, 0.28)", shadow: "rgba(47, 26, 31, 0.10)"
      }
    },
    {
      id: "petrol-light-gray",
      name: "Petrol & Açık Gri",
      swatches: ["#F4F8FB", "#D6E1E2", "#7BA7AB", "#2F5D62", "#21363A"],
      colors: {
        canvas: "#F4F8FB", surface: "#FCFEFF", surfaceAlt: "#E7EFF0", header: "#F7FAFB", input: "#FFFFFF",
        sidebar: "#28565B", sidebarActive: "#66969A", sidebarText: "#F1FAFA", sidebarActiveText: "#FFFFFF",
        primary: "#2F5D62", primaryHover: "#21363A", onPrimary: "#FFFFFF", accent: "#6D9EA2",
        text: "#21363A", textSoft: "#587176", border: "#D6E1E2", chip: "#DEEAEB", chipText: "#2F5D62",
        focus: "rgba(47, 93, 98, 0.28)", shadow: "rgba(33, 54, 58, 0.10)"
      }
    },
    {
      id: "forest-ivory",
      name: "Orman Yeşili & Fildişi",
      swatches: ["#F7F6EE", "#DDDCC8", "#9DA57A", "#3F5A42", "#1F2D21"],
      colors: {
        canvas: "#F7F6EE", surface: "#FFFDF5", surfaceAlt: "#ECEBDA", header: "#F9F8F1", input: "#FFFFFA",
        sidebar: "#354F38", sidebarActive: "#788667", sidebarText: "#F7F8ED", sidebarActiveText: "#FFFFFF",
        primary: "#3F5A42", primaryHover: "#1F2D21", onPrimary: "#FFFFFF", accent: "#87956C",
        text: "#1F2D21", textSoft: "#5E6D5F", border: "#DDDCC8", chip: "#E6E5D2", chipText: "#3F5A42",
        focus: "rgba(63, 90, 66, 0.28)", shadow: "rgba(31, 45, 33, 0.10)"
      }
    },
    {
      id: "purple-gray-stone",
      name: "Mor Gri & Taş",
      swatches: ["#F6F4F7", "#DDD5E2", "#A796B8", "#625274", "#2D2736"],
      colors: {
        canvas: "#F6F4F7", surface: "#FFFDFF", surfaceAlt: "#ECE7EF", header: "#F9F7FA", input: "#FFFFFF",
        sidebar: "#574867", sidebarActive: "#8B78A0", sidebarText: "#FAF7FC", sidebarActiveText: "#FFFFFF",
        primary: "#625274", primaryHover: "#2D2736", onPrimary: "#FFFFFF", accent: "#927FA6",
        text: "#2D2736", textSoft: "#6F6677", border: "#DDD5E2", chip: "#E9E2ED", chipText: "#625274",
        focus: "rgba(98, 82, 116, 0.28)", shadow: "rgba(45, 39, 54, 0.10)"
      }
    },
    {
      id: "dark-blue-sand-beige",
      name: "Koyu Mavi & Kum Beji",
      swatches: ["#F8F5EE", "#E4DAC8", "#B7A182", "#355070", "#1F2A3A"],
      colors: {
        canvas: "#F8F5EE", surface: "#FFFDF9", surfaceAlt: "#EEE7DA", header: "#FAF8F3", input: "#FFFFFF",
        sidebar: "#2D4866", sidebarActive: "#9E896D", sidebarText: "#F7F4ED", sidebarActiveText: "#FFFFFF",
        primary: "#355070", primaryHover: "#1F2A3A", onPrimary: "#FFFFFF", accent: "#A58D6C",
        text: "#1F2A3A", textSoft: "#617081", border: "#E4DAC8", chip: "#EDE4D5", chipText: "#355070",
        focus: "rgba(53, 80, 112, 0.28)", shadow: "rgba(31, 42, 58, 0.10)"
      }
    },
    {
      id: "terracotta-milky-cream",
      name: "Terracotta & Sütlü Krem",
      swatches: ["#FBF4ED", "#EFCDB8", "#D08C60", "#9A4F2E", "#3A251C"],
      colors: {
        canvas: "#FBF4ED", surface: "#FFFCF8", surfaceAlt: "#F5E1D4", header: "#FCF7F1", input: "#FFFFFF",
        sidebar: "#8A4429", sidebarActive: "#C4734C", sidebarText: "#FFF7F0", sidebarActiveText: "#FFFFFF",
        primary: "#9A4F2E", primaryHover: "#3A251C", onPrimary: "#FFFFFF", accent: "#D08C60",
        text: "#3A251C", textSoft: "#795E51", border: "#EFCDB8", chip: "#F3DCCB", chipText: "#8A4429",
        focus: "rgba(154, 79, 46, 0.28)", shadow: "rgba(58, 37, 28, 0.10)"
      }
    }
  ]);

  function presetById(id) {
    return PRESETS.find((preset) => preset.id === id)
      || PRESETS.find((preset) => preset.id === defaultPresetId);
  }

  const defaultAppearance = Object.freeze({ presetId: "purple-gray-stone", mode: "light" });

  function normalizeAppearance(value, fallback = defaultAppearance) {
    const source = value && typeof value === "object" ? value : {};
    return {
      presetId: PRESETS.some((preset) => preset.id === source.presetId) ? source.presetId : fallback.presetId,
      mode: source.mode === "dark" || source.mode === "light" ? source.mode : fallback.mode
    };
  }

  function mix(first, second, amount) {
    const rgb = (hex) => hex.replace("#", "").match(/../g).map((part) => parseInt(part, 16));
    const a = rgb(first), b = rgb(second);
    return "#" + a.map((part, index) => Math.round(part * (1 - amount) + b[index] * amount).toString(16).padStart(2, "0")).join("");
  }

  function colorsForPreset(id, mode = "light") {
    const base = presetById(id).colors;
    if (mode !== "dark") return base;
    const canvas = mix(base.text, "#080b12", 0.76);
    const surface = mix(base.sidebar, "#10141c", 0.73);
    const primary = mix(base.primary, "#ffffff", 0.56);
    return {
      ...base, canvas, surface, surfaceAlt: mix(base.sidebar, "#181e28", 0.66),
      header: surface, input: mix(canvas, base.sidebar, 0.24),
      sidebar: mix(base.sidebar, "#080c14", 0.68), sidebarActive: mix(base.sidebarActive, "#ffffff", 0.28),
      sidebarText: "#edf0f6", sidebarActiveText: "#10141c",
      primary, primaryHover: mix(primary, "#ffffff", 0.22), onPrimary: "#10141c",
      accent: mix(base.accent, "#ffffff", 0.4), text: "#edf0f6", textSoft: "#b9c1cf",
      border: mix(base.sidebar, "#788396", 0.38), chip: mix(surface, base.sidebar, 0.4), chipText: primary,
      focus: primary + "66", shadow: "rgba(0, 0, 0, 0.32)"
    };
  }

  function tokensForPreset(id, mode = "light") {
    const colors = colorsForPreset(id, mode);
    return {
      "--panel-canvas": colors.canvas,
      "--panel-surface": colors.surface,
      "--panel-surface-soft": colors.surfaceAlt,
      "--panel-ink": colors.text,
      "--panel-primary": colors.primary,
      "--panel-muted": colors.textSoft,
      "--panel-line": colors.border,
      "--panel-accent": colors.accent,
      "--panel-focus": colors.focus,
      "--panel-shadow": `0 8px 24px ${colors.shadow}`,
      "--panel-primary-hover": colors.primaryHover,
      "--panel-on-primary": colors.onPrimary,
      "--panel-sidebar": colors.sidebar,
      "--panel-sidebar-active": colors.sidebarActive,
      "--panel-sidebar-text": colors.sidebarText,
      "--panel-sidebar-active-text": colors.sidebarActiveText,
      "--panel-header": colors.header,
      "--panel-input": colors.input,
      "--panel-chip": colors.chip,
      "--panel-chip-text": colors.chipText,
      "--panel-surface-alt": colors.surfaceAlt,
      "--panel-text-soft": colors.textSoft,
      "--panel-danger": mode === "dark" ? "#ff9b9b" : "#b42332",
      "--panel-danger-soft": mode === "dark" ? "#43232d" : "#ffedf0",
      "--panel-success": mode === "dark" ? "#9adbb3" : "#276749",
      "--panel-success-soft": mode === "dark" ? "#1a352c" : "#eaf7ef",
      "--panel-warning": mode === "dark" ? "#f5d08a" : "#805b16",
      "--panel-warning-soft": mode === "dark" ? "#3c3220" : "#fff5dc",
      "--page": colors.canvas,
      "--surface": colors.surface,
      "--surface-soft": colors.surfaceAlt,
      "--ink": colors.text,
      "--muted": colors.textSoft,
      "--line": colors.border,
      "--brand": colors.primary,
      "--brand-2": colors.chip,
      "--on-brand": colors.onPrimary,
      "--shadow": `0 8px 24px ${colors.shadow}`
    };
  }

  function apply(id, mode = "light") {
    const preset = presetById(id);
    const tokens = tokensForPreset(preset.id, mode);
    if (typeof document !== "undefined") {
      [document.documentElement, document.body].filter(Boolean).forEach((target) => {
        target.dataset.adminThemePreset = preset.id;
        target.dataset.appearanceMode = mode === "dark" ? "dark" : "light";
        target.style.colorScheme = mode === "dark" ? "dark" : "light";
        Object.entries(tokens).forEach(([name, value]) => target.style.setProperty(name, value));
      });
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", colorsForPreset(preset.id, mode).sidebar);
    }
    return preset;
  }

  return Object.freeze({ defaultPresetId, defaultAppearance, PRESETS, presetById, normalizeAppearance, colorsForPreset, tokensForPreset, apply });
});
