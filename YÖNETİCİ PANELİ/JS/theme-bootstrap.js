"use strict";

// CSP uyumlu erken tema seçimi: gövde çizilmeden kayıtlı açık/koyu tercihi uygular.
try {
  document.body.dataset.panelTheme = localStorage.getItem("menu-suite.panel.theme") === "light" ? "light" : "dark";
} catch (_error) {
  document.body.dataset.panelTheme = "dark";
}
