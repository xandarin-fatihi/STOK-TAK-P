(function () {
  "use strict";

  const BACKEND_URL_KEY = "menu-suite.backend.url";
  const LAST_ACTIVE_SECTION_KEY = "menu-suite.admin.lastActiveSection";
  const PANEL_THEME_KEY = "menu-suite.panel.theme";
  const PANEL_LAYOUT_KEY = "menu-suite.panel.layout";
  const PANEL_SETTINGS_KEY = "menu-suite.admin.settings.v1";
  const PANEL_SETTINGS_DRAFT_KEY = "menu-suite.admin.settings.draft.v1";
  const PANEL_SETTINGS_DEFAULT_KEY = "menu-suite.admin.settings.default.v1";
  const SIDEBAR_STATE_KEY = "menu-suite.admin.sidebar.collapsed.v1";
  const SIDEBAR_BREAKPOINT = window.matchMedia("(max-width: 1180px)");
  const ADMIN_DRAWER_BREAKPOINT = window.matchMedia("(max-width: 900px)");
  const ADMIN_NOTIFICATION_API = "/api/admin/notifications";
  const ADMIN_NOTIFICATION_DEVICE_KEY = "menu-suite.notifications.admin.device.v1";
  const ADMIN_NOTIFICATION_SOUND_CLAIMS_KEY = "menu-suite.notifications.admin.sound-claims.v1";
  const ADMIN_NOTIFICATION_POLL_MS = 30000;
  const CHANNEL_NAME = "menu-suite-menu-updates";
  const MEDIA_DB_NAME = "menu-suite.media.v1";
  const MEDIA_STORE_NAME = "files";
  const MEDIA_REF_PREFIX = "media:";
  const SESSION_REQUIRED_MESSAGE = "Oturum geçersiz. Lütfen tekrar giriş yapın.";
  const MENU_DESIGN_SCHEMA = window.MenuSuiteMenuDesignSchema;
  if (!MENU_DESIGN_SCHEMA || typeof MENU_DESIGN_SCHEMA.normalizeMenuState !== "function") {
    throw new Error("Ortak menü tasarım şeması yüklenemedi. Yönetici paneli güvenli biçimde başlatılamadı.");
  }
  const BRAND_TITLE_FONT = '"Panel Script", "Dancing Script", cursive';
  const BRAND_BODY_FONT = '"Panel Sans", Poppins, Arial, sans-serif';
  const SECTION_TITLES = {
    overview: "Genel Bakış",
    product: "Ürün yönetimi",
    category: "Kategori yönetimi",
    barcode: "Depo",
    locations: "Malzemenin Yeri",
    approvals: "Talepler",
    shipments: "Sevkiyat arşivi",
    receipts: "Mal kabul",
    staffAccess: "Personel",
    procurementDocuments: "Belgeler",
    audit: "İşlem geçmişi",
    profile: "Yönetici Profili",
    settings: "Ayarlar"
  };
  const SECTION_DESCRIPTIONS = {
    overview: "Stok operasyonunun genel durumunu görüntüleyin.",
    product: "Ürün kartlarını ve temel ürün bilgilerini yönetin.",
    category: "Ürün kategorilerini düzenleyin.",
    barcode: "Depoları, malzeme bakiyelerini ve transferleri yönetin.",
    locations: "Malzemelerin raf, dolap veya bölme bilgisini depo bazında yönetin.",
    approvals: "Personel taleplerini inceleyip sonuçlandırın.",
    shipments: "Tamamlanan tedarikçi sevkiyatlarını ve fişlerini inceleyin.",
    receipts: "Gelen ürünlerin mal kabul kayıtlarını yönetin.",
    staffAccess: "Kullanıcı hesaplarını yönetin.",
    procurementDocuments: "Tedarik belgelerini güvenli arşivde yönetin.",
    audit: "Kaldırılan ve ters çevrilen kayıtların denetim geçmişini inceleyin.",
    settings: "Tema, görünüm ve sistem tercihlerini yönetin."
  };
  const PROCUREMENT_SECTION_VIEWS = Object.freeze({
    product: "stock",
    category: "stock",
    barcode: "stock",
    locations: "stock",
    receipts: "receipts",
    shipments: "shipmentArchive",
    procurementDocuments: "documents",
    audit: "history"
  });
  const PANEL_THEME = window.MenuSuitePanelTheme;
  if (!PANEL_THEME || !Array.isArray(PANEL_THEME.PRESETS)) throw new Error("Ortak panel tema sistemi yüklenemedi.");
  const DEFAULT_ADMIN_THEME_PRESET_ID = PANEL_THEME.defaultPresetId;
  const ADMIN_THEME_PRESETS = PANEL_THEME.PRESETS;
  const DEFAULT_PANEL_CONFIG = {
    appearance: {
      adminThemePresetId: DEFAULT_ADMIN_THEME_PRESET_ID
    },
    behavior: {
      keepLastSection: true,
      sidebarDefaultOpen: true,
      confirmOnExit: true,
      defaultSection: "overview"
    },
    backup: { lastBackupAt: "" }
  };
  const CATEGORY_ICON_REGISTRY = window.MenuSuiteCategoryIcons || {
    inferIconKey: () => "default",
    getIconClass: () => "fas fa-tags",
    options: () => [
      { key: "cold", label: "Soğuklar", mark: "❄" },
      { key: "hot", label: "Sıcaklar", mark: "♨" },
      { key: "dessert", label: "Tatlı & Sandwich", mark: "✦" }
    ]
  };
  const memoryStore = {};
  const adminNotificationSoundOwner = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let adminNotificationSoundUnlocked = false;
  const FONT_OPTIONS = [
    ["Panel Script", BRAND_TITLE_FONT],
    ["Panel Sans", BRAND_BODY_FONT],
    ["Montserrat", '"Montserrat", Arial, sans-serif'],
    ["Poppins", '"Poppins", Arial, sans-serif'],
    ["Roboto", '"Roboto", Arial, sans-serif'],
    ["Open Sans", '"Open Sans", Arial, sans-serif'],
    ["Lato", '"Lato", Arial, sans-serif'],
    ["Raleway", '"Raleway", Arial, sans-serif'],
    ["Playfair Display", '"Playfair Display", Georgia, serif'],
    ["Playfair Display SC", '"Playfair Display SC", Georgia, serif'],
    ["Vidaloka", '"Vidaloka", Georgia, serif'],
    ["Merriweather", '"Merriweather", Georgia, serif'],
    ["Oswald", '"Oswald", Arial, sans-serif'],
    ["Bebas Neue", '"Bebas Neue", Arial, sans-serif'],
    ["Pacifico", '"Pacifico", cursive'],
    ["Dancing Script", '"Dancing Script", cursive'],
    ["Great Vibes", '"Great Vibes", cursive'],
    ["Cinzel", '"Cinzel", Georgia, serif'],
    ["Cormorant Garamond", '"Cormorant Garamond", Georgia, serif'],
    ["Libre Baskerville", '"Libre Baskerville", Georgia, serif'],
    ["Nunito", '"Nunito", Arial, sans-serif'],
    ["Quicksand", '"Quicksand", Arial, sans-serif'],
    ["Source Sans 3", '"Source Sans 3", Arial, sans-serif'],
    ["Inter", '"Inter", Arial, sans-serif'],
    ["Rubik", '"Rubik", Arial, sans-serif'],
    ["Work Sans", '"Work Sans", Arial, sans-serif'],
    ["Josefin Sans", '"Josefin Sans", Arial, sans-serif'],
    ["Caveat", '"Caveat", cursive'],
    ["Lobster", '"Lobster", cursive'],
    ["Abril Fatface", '"Abril Fatface", Georgia, serif'],
    ["DM Sans", '"DM Sans", Arial, sans-serif'],
    ["Manrope", '"Manrope", Arial, sans-serif']
  ];
  const DEFAULT_SETTINGS = MENU_DESIGN_SCHEMA.cloneValue(MENU_DESIGN_SCHEMA.DEFAULT_SETTINGS);
  const MENU_THEME_PRESETS = Object.freeze({
    light: Object.freeze([
      { id: "classic-cream", name: "Klasik Krem", colors: ["#F7EFE4", "#FFF9F1", "#4A2414", "#B77945", "#2A160D"] },
      { id: "minimal-white", name: "Minimal Beyaz", colors: ["#F7F7F5", "#FFFFFF", "#36312D", "#8B7564", "#22211F"] },
      { id: "natural-green", name: "Doğal Yeşil", colors: ["#F3F4EA", "#FCFCF5", "#415238", "#7D9163", "#283020"] },
      { id: "modern-ice", name: "Modern Buz", colors: ["#F1F5F8", "#FBFDFE", "#274B6A", "#6992B8", "#18324A"] },
      { id: "warm-terracotta", name: "Sıcak Terracotta", colors: ["#FFF1E8", "#FFF9F4", "#8F422A", "#C77750", "#4A261B"] }
    ]),
    dark: Object.freeze([
      { id: "espresso", name: "Espresso", colors: ["#140905", "#21110A", "#F3DFC6", "#C58B5B", "#F8E9D2"] },
      { id: "charcoal", name: "Kömür", colors: ["#141414", "#222222", "#EFE9DF", "#AA9780", "#F4F1EC"] },
      { id: "midnight-navy", name: "Gece Laciverti", colors: ["#0C1622", "#142536", "#E4EDF6", "#7198C2", "#EFF6FC"] },
      { id: "forest-night", name: "Orman Gecesi", colors: ["#0F1913", "#18271D", "#E3EDDB", "#7F9F6B", "#EEF5E9"] },
      { id: "burgundy-night", name: "Bordo Gece", colors: ["#241014", "#34181E", "#F5E4E4", "#B97983", "#FAEEEE"] }
    ])
  });
  const BRAND_TEXT_FIELDS = Object.freeze({
    cafeName: "siteCafeName",
    shortDescription: "siteShortDescription",
    slogan: "brandSlogan",
    menuBrandTitle: "brandMenuTitle",
    menuBrandSubtitle: "brandMenuSubtitle",
    menuBrowserTitle: "brandMenuBrowserTitle",
    adminBrowserTitle: "brandAdminBrowserTitle",
    personelBrowserTitle: "brandPersonelBrowserTitle",
    aboutButtonText: "brandAboutButtonText",
    welcomeTitle: "brandWelcomeTitle",
    menuButtonText: "brandMenuButtonText",
    socialTitle: "brandSocialTitle",
    socialSubtitle: "brandSocialSubtitle",
    feedbackTitle: "brandFeedbackTitle",
    feedbackSubtitle: "brandFeedbackSubtitle",
    aboutTitle: "brandAboutTitle",
    storyTitle: "brandStoryTitle",
    storyText: "brandStoryText",
    storySignature: "brandStorySignature",
    phone: "sitePhoneInfo",
    whatsapp: "siteWhatsappInfo",
    address: "siteAddressInfo",
    hours: "siteHoursInfo",
    instagram: "siteInstagramInfo",
    tiktok: "siteTikTokInfo",
    email: "siteEmailInfo"
  });
  const BRAND_MEDIA_CONTROLS = Object.freeze({
    lightLogoUrl: ["brandLightLogoPreview", "brandLightLogoFile", "brandLightLogoClear", "Ortak açık zemin logosu yok"],
    darkLogoUrl: ["brandDarkLogoPreview", "brandDarkLogoFile", "brandDarkLogoClear", "Ortak koyu zemin logosu yok"],
    menuMainLogoUrl: ["brandMenuMainLogoPreview", "brandMenuMainLogoFile", "brandMenuMainLogoClear", "Ana logo yok"],
    menuHeaderLogoUrl: ["brandMenuHeaderLogoPreview", "brandMenuHeaderLogoFile", "brandMenuHeaderLogoClear", "Header logosu yok"],
    adminLogoUrl: ["brandAdminLogoPreview", "brandAdminLogoFile", "brandAdminLogoClear", "Panel logosu yok"],
    personelLogoUrl: ["brandPersonelLogoPreview", "brandPersonelLogoFile", "brandPersonelLogoClear", "Personel logosu yok"],
    passwordResetLogoUrl: ["brandPasswordResetLogoPreview", "brandPasswordResetLogoFile", "brandPasswordResetLogoClear", "Şifre yenileme logosu yok"],
    offlineLogoUrl: ["brandOfflineLogoPreview", "brandOfflineLogoFile", "brandOfflineLogoClear", "Çevrimdışı logosu yok"],
    aboutLogoUrl: ["brandAboutLogoPreview", "brandAboutLogoFile", "brandAboutLogoClear", "Hakkımızda görseli yok"],
    defaultContentImageUrl: ["brandDefaultContentImagePreview", "brandDefaultContentImageFile", "brandDefaultContentImageClear", "Varsayılan içerik görseli yok"],
    menuFaviconUrl: ["brandMenuFaviconPreview", "brandMenuFaviconFile", "brandMenuFaviconClear", "Menü faviconu yok"],
    adminFaviconUrl: ["brandAdminFaviconPreview", "brandAdminFaviconFile", "brandAdminFaviconClear", "Yönetici faviconu yok"],
    personelFaviconUrl: ["brandPersonelFaviconPreview", "brandPersonelFaviconFile", "brandPersonelFaviconClear", "Personel faviconu yok"],
    menuAppIconUrl: ["brandMenuAppIconPreview", "brandMenuAppIconFile", "brandMenuAppIconClear", "Menü uygulama ikonu yok"],
    adminAppIconUrl: ["brandAdminAppIconPreview", "brandAdminAppIconFile", "brandAdminAppIconClear", "Yönetici uygulama ikonu yok"],
    personelAppIconUrl: ["brandPersonelAppIconPreview", "brandPersonelAppIconFile", "brandPersonelAppIconClear", "Personel uygulama ikonu yok"]
  });

  const state = {
    data: null,
    recipes: {}, recipeCatalog: [], recipeLinkReview: [],
    recipeAccess: { users: [], assignments: [], activity: [], revision: 0 },
    selectedStaffUserId: "", staffSectionAccessUserId: "", staffSectionAccessMessage: "", staffUserFilter: "active", staffActivityTab: "login", staffMessage: "",
    activeSection: "overview",
    selectedCategoryId: "",
    selectedProductId: "",
    pendingStockProductId: "",
    pendingProcurementDocumentId: "",
    pendingNotificationTarget: null,
    allowEmptyProductSelection: false,
    feedbackFilter: "all",
    channel: null,
    menuEventSource: null,
    feedbackEventSource: null,
    notificationEventSource: null,
    notificationPollTimer: null,
    notificationReconnectTimer: null,
    notificationReconnectAttempt: 0,
    requestPromises: new Map(),
    sectionLoadPromises: new Map(),
    modulePromises: new Map(),
    loadedScopes: new Set(),
    scopeRevisions: { menu: 0 },
    previewRevisions: { menu: 0 },
    bound: false,
    mediaDbPromise: null,
    dirtyMenu: false,
    dirtyPanelConfig: false,
    menuThemeEditorMode: "light",
    saving: false,
    publishRevision: 0,
    saveStatus: "clean",
    pendingPublishVerification: null,
    renderTimer: null,
    panelConfig: cloneData(DEFAULT_PANEL_CONFIG),
    publishedPanelConfigFingerprint: "",
    publishedAdminThemePresetId: DEFAULT_ADMIN_THEME_PRESET_ID,
    feedbackItems: [],
    feedbackLoaded: false,
    focusedFeedbackId: "",
    adminDefaults: { menuDesign: null, systemSettings: null },
    defaultModalScope: "menu",
    defaultModalMode: "restore",
    defaultModalTrigger: null,
    defaultOperationBusy: false,
    dataImportCenter: {
      files: { menu: null, pricing: null },
      analysis: null,
      history: [],
      historyLoaded: false,
      busy: "",
      message: "",
      messageType: "",
      lastResult: null,
      issueScope: "all",
      issueCode: "all",
      archiveOnly: false,
      analysisEpoch: 0
    },
    notificationCenter: {
      items: [],
      unreadCount: 0,
      nextCursor: "",
      filter: "all",
      category: "all",
      preferences: null,
      capabilities: {},
      personnelOptions: [],
      devices: [],
      deliveries: [],
      scheduledNotifications: [],
      loading: false,
      preferencesLoading: false,
      devicesLoading: false,
      deliveryLoading: false,
      schedulesLoading: false,
      settingsTab: "inbox",
      mutationKeys: new Set(),
      suppressedIds: new Set(),
      undoItems: new Map(),
      reloadRequested: false,
      open: false,
      lastFocus: null
    },
    systemHealth: { value: null, loading: false }
  };

  const els = {};
  const SaveCoordinator = window.MenuSuiteSaveCoordinator;
  const saveCoordinator = SaveCoordinator ? new SaveCoordinator({
    onStatus(status) {
      state.saveStatus = state.pendingPublishVerification && (status === "error" || status === "conflict")
        ? "unverified"
        : status;
    }
  }) : null;

  window.MenuSuiteAdminBridge = {
    snapshot() {
      return {
        menuState: state.data,
        recipeState: state.recipes,
        pricing: state.data && state.data.pricing || null,
        activeSection: state.activeSection
      };
    },
    activeSection() { return state.activeSection; },
    openSection(section) { setActiveSection(section); },
    logout() { return logoutAdminSession(); },
    previewRevision() {
      return Number(state.previewRevisions.menu || 0) + Number(state.scopeRevisions.menu || 0);
    },
    selectedProduct() { return selectedProductStrict(); },
    hasPendingChanges,
    hasPendingMenuChanges() { return state.dirtyMenu; },
    isScopeDirty(section) {
      return ["menu", "banner", "brand", "category", "product", "bulkPrice", "settings"].includes(section) && state.dirtyMenu;
    },
    applyPreviewSnapshot(previewSnapshot) {
      if (!previewSnapshot || typeof previewSnapshot !== "object" || !previewSnapshot.menuState) return false;
      state.data = normalizeState(cloneData(previewSnapshot.menuState));
      ensureSelection();
      markDirty("menu", "Kaydedilmemiş önizleme değişikliği");
      renderActiveSection(state.activeSection);
      return true;
    },
    markMenuDirty(message) { markDirty("menu", message || "Fiyat değişikliği kaydedilmedi"); },
    backendRequest,
    replaceMenuState(menuState) {
      if (!menuState || typeof menuState !== "object") return;
      state.data = normalizeState(menuState);
      state.dirtyMenu = false;
      ensureSelection();
      renderActiveSection(state.activeSection);
      notifyLivePreviewDraft();
      updateSaveControls("Fiyatlar backend üzerinde güncellendi");
    },
    setPricing(pricing) {
      if (!state.data || !pricing || typeof pricing !== "object") return;
      state.data.pricing = cloneData(pricing);
    },
    setPublishRevision(revision) {
      const value = Number(revision);
      if (Number.isSafeInteger(value) && value >= 0) state.publishRevision = value;
    },
    render() { renderActiveSection(state.activeSection); }
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    setupProcurementBridge();
    bindAdminNotificationSoundUnlock();
    state.panelConfig = loadPanelConfig();
    applyPanelRuntimeSettings();
    populateFontSelects();
    applyPanelTheme();
    applyPanelLayout();
    bindLogin();

    await hydratePublicBrandIdentity();
    if (await verifyBackendSession()) {
      showPanel();
    } else {
      if (els.loginScreen) {
        els.loginScreen.hidden = false;
        els.loginScreen.style.display = "grid";
      }
      if (els.panelShell) {
        els.panelShell.hidden = true;
        els.panelShell.style.display = "none";
      }
    }
  }

  function cacheElements() {
    document.querySelectorAll("[id]").forEach((element) => {
      els[element.id] = element;
    });
  }

  function populateFontSelects() {
    ["titleFont", "categoryFont", "productFont"].forEach((id) => {
      const select = els[id];
      if (!select) return;
      select.innerHTML = FONT_OPTIONS.map(([label, value]) => (
        `<option value="${escapeAttribute(value)}">${escapeHTML(label)}</option>`
      )).join("");
    });
  }

  function applyPanelTheme(theme) {
    const nextTheme = theme || safeLocalGet(PANEL_THEME_KEY) || "dark";
    document.body.dataset.panelTheme = nextTheme;
    if (els.panelThemeToggle) {
      els.panelThemeToggle.textContent = nextTheme === "dark" ? "Aydınlık Tema" : "Koyu Tema";
    }
  }

  function togglePanelTheme() {
    const nextTheme = document.body.dataset.panelTheme === "dark" ? "light" : "dark";
    safeLocalSet(PANEL_THEME_KEY, nextTheme);
    applyPanelTheme(nextTheme);
    applyAdminBrandIdentity();
  }

  function applyPanelLayout(layout) {
    const nextLayout = layout || safeLocalGet(PANEL_LAYOUT_KEY) || "desktop";
    const mobile = nextLayout === "mobile";
    document.body.dataset.panelLayout = mobile ? "mobile" : "desktop";
    if (els.panelShell) els.panelShell.classList.toggle("is-mobile-panel", mobile);
    if (els.mobilePanelToggle) {
      els.mobilePanelToggle.textContent = mobile ? "Masaüstü Panele Dön" : "Mobil Paneli Kullan";
    }
  }

  function togglePanelLayout() {
    const nextLayout = document.body.dataset.panelLayout === "mobile" ? "desktop" : "mobile";
    safeLocalSet(PANEL_LAYOUT_KEY, nextLayout);
    applyPanelLayout(nextLayout);
    if (nextLayout === "mobile") setSidebarCollapsed(true);
  }

  function bindLogin() {
    els.loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = els.passwordInput.value.trim();
      const backendLogin = await loginBackend(password);
      if (backendLogin.ok) {
        els.loginError.hidden = true;
        showPanel();
      } else {
        els.loginError.textContent = backendLogin.message || (backendBaseUrl()
          ? "Şifre hatalı veya oturum açılamadı."
          : "Backend adresi tanımlı değil. Panel için backend bağlantısı gerekli.");
        els.loginError.hidden = false;
        els.passwordInput.select();
      }
    });
  }

  async function showPanel() {
    try {
      clearInitialAdminNavigation();
      els.loginScreen.hidden = true;
      els.loginScreen.style.display = "none";
      els.panelShell.hidden = false;
      els.panelShell.style.display = "grid";
      setSidebarCollapsed(defaultSidebarCollapsed());
      state.data = loadData();
      ensureSelection();
      setActiveSection(resolveInitialActiveSection(), { collapseSidebar: false, render: false });
      try {
        if ("BroadcastChannel" in window && !state.channel) state.channel = new BroadcastChannel(CHANNEL_NAME);
      } catch (_error) {
        state.channel = null;
      }
      bindPanelEvents();
      renderActiveSection(state.activeSection);
      await Promise.allSettled([
        hydrateAdminCoreFromBackend(),
        ensureSectionData(state.activeSection)
      ]);
      await initializeAdminNotifications();
      setupBackendEvents();
      document.dispatchEvent(new CustomEvent("menu-suite:admin-session-started", { detail: { source: "admin-shell" } }));
    } catch (error) {
      console.error("Panel açılırken hata oluştu:", error);
      els.loginScreen.hidden = true;
      els.loginScreen.style.display = "none";
      els.panelShell.hidden = false;
      els.panelShell.style.display = "grid";
      els.panelShell.innerHTML = `
        <section class="panel-card" style="margin:24px">
          <h1>Panel açıldı ancak veri yüklenirken hata oluştu</h1>
          <p class="muted">Tarayıcı eski kayıtları bozmuş olabilir. Aşağıdaki butonla panel verisini sıfırlayıp yeniden açabilirsiniz.</p>
          <button class="primary-action" type="button" id="panicResetButton">Panel Verisini Sıfırla</button>
        </section>`;
      const reset = document.getElementById("panicResetButton");
      if (reset) reset.addEventListener("click", () => {
        safeLocalRemove(PANEL_SETTINGS_KEY);
        safeLocalRemove(PANEL_SETTINGS_DRAFT_KEY);
        safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
        safeLocalRemove(SIDEBAR_STATE_KEY);
        window.location.reload();
      });
    }
  }

  function bindPanelEvents() {
    if (state.bound) return;
    state.bound = true;
if (els.staffRefreshButton) els.staffRefreshButton.addEventListener("click", hydrateRecipeAccessFromBackend);

if (els.staffUserSaveButton) els.staffUserSaveButton.addEventListener("click", saveStaffUser);

if (els.staffUserResetButton) els.staffUserResetButton.addEventListener("click", resetStaffUserForm);
  document.getElementById("staffPersonnelModal")?.addEventListener("click", event => {
    if (event.target.closest("[data-staff-personnel-close]")) closeStaffPersonnelDialog();
    if (event.target.closest("#staffPersonnelLifecycle")) handleStaffUserListClick(event);
  });
  document.getElementById("staffPasswordToggle")?.addEventListener("click", event => {
    if (!els.staffPassword) return;
    const show = els.staffPassword.type === "password";
    els.staffPassword.type = show ? "text" : "password";
    event.currentTarget.textContent = show ? "Gizle" : "Göster";
    event.currentTarget.setAttribute("aria-label", show ? "Girilen yeni şifreyi gizle" : "Girilen yeni şifreyi göster");
  });
  document.addEventListener("keydown", event => {
    const modal = document.getElementById("staffPersonnelModal");
    if (!modal || modal.hidden || (els.staffDeleteModal && !els.staffDeleteModal.hidden)) return;
    if (event.key === "Escape") { event.preventDefault(); closeStaffPersonnelDialog(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(modal.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),summary")).filter(el => el.getClientRects().length && el.tabIndex >= 0);
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) return;
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });


if (els.staffUserEmail) els.staffUserEmail.addEventListener("input", () => {
      if (els.staffUserEmailStatus) els.staffUserEmailStatus.textContent = "Kaydedildikten sonra personel bu adresi kendi profilinden doğrular.";
    });

if (els.staffUserList) els.staffUserList.addEventListener("click", handleStaffUserListClick);

if (els.staffUserFilter) els.staffUserFilter.addEventListener("click", handleStaffUserFilterClick);

if (els.staffSectionAccessUser) els.staffSectionAccessUser.addEventListener("change", () => {
      state.staffSectionAccessUserId = els.staffSectionAccessUser.value;
      state.staffSectionAccessMessage = "";
      renderStaffSectionAccess(state.recipeAccess.users || []);
    });

if (els.staffSectionAccessGrid) els.staffSectionAccessGrid.addEventListener("change", renderStaffSectionAccessSummary);

if (els.staffSectionAccessSave) els.staffSectionAccessSave.addEventListener("click", saveStaffSectionAccess);

if (els.staffDeleteModal) els.staffDeleteModal.addEventListener("click", handleStaffDeleteModalClick);

if (els.staffDeleteConsent) els.staffDeleteConsent.addEventListener("change", syncStaffDeleteConsent);

if (els.staffDeleteConfirmButton) els.staffDeleteConfirmButton.addEventListener("click", confirmPermanentStaffDelete);

if (els.staffAssignmentList) els.staffAssignmentList.addEventListener("click", handleStaffAssignmentListClick);

if (els.staffActivityTabs) els.staffActivityTabs.addEventListener("click", handleStaffActivityTabClick);

    els.sidebarToggle.addEventListener("click", toggleSidebar);
    if (els.adminSidebarOverlay) els.adminSidebarOverlay.addEventListener("click", () => setSidebarCollapsed(true, { persist: false, restoreFocus: true }));
    if (els.adminProfileButton) els.adminProfileButton.addEventListener("click", toggleAdminProfileMenu);
    if (els.adminProfileMenu) els.adminProfileMenu.addEventListener("click", handleAdminProfileAction);
    document.querySelectorAll('[data-admin-profile-action="profile"]').forEach(button => { if (!button.closest("#adminProfileMenu")) button.addEventListener("click", () => setActiveSection("profile")); });
    bindAdminNotificationEvents();
    document.addEventListener("click", closeAdminProfileMenuFromOutside);
    document.addEventListener("keydown", handleAdminShellKeydown);
    document.addEventListener("menu-suite:admin-preview-open", () => {
      if (!isSidebarCollapsed()) setSidebarCollapsed(true, { persist: false });
    });
    if (typeof SIDEBAR_BREAKPOINT.addEventListener === "function") SIDEBAR_BREAKPOINT.addEventListener("change", syncSidebarForViewport);
    else if (typeof SIDEBAR_BREAKPOINT.addListener === "function") SIDEBAR_BREAKPOINT.addListener(syncSidebarForViewport);
    if (typeof ADMIN_DRAWER_BREAKPOINT.addEventListener === "function") ADMIN_DRAWER_BREAKPOINT.addEventListener("change", syncAdminDrawerForViewport);
    else if (typeof ADMIN_DRAWER_BREAKPOINT.addListener === "function") ADMIN_DRAWER_BREAKPOINT.addListener(syncAdminDrawerForViewport);
    if (els.settingsToggle && els.settingsMenu) {
      els.settingsToggle.addEventListener("click", toggleSettingsMenu);
      document.addEventListener("click", handleDocumentClick);
    }
    window.addEventListener("hashchange", handleSectionHashChange);
    const panelNav = document.querySelector(".panel-nav");
    if (panelNav) panelNav.addEventListener("click", handlePanelNavClick);
    document.addEventListener("menu-suite:open-stock-product", handleOpenStockProduct);
    if (els.overviewGrid) els.overviewGrid.addEventListener("click", handleOverviewAction);
    bindDataImportCenterEvents();
    els.addCategoryButton.addEventListener("click", addCategory);
    if (els.categorySearch) els.categorySearch.addEventListener("input", renderLists);
    if (els.resetButton) els.resetButton.addEventListener("click", (event) => openDefaultChoiceModal(state.activeSection === "settings" ? "system" : "menu", event.currentTarget));
    if (els.saveDefaultButton) els.saveDefaultButton.addEventListener("click", saveAdminMenuDefault);
    if (els.saveAdminMenuDefaultButton) els.saveAdminMenuDefaultButton.addEventListener("click", saveAdminMenuDefault);
    if (els.restoreMenuDefaultButton) els.restoreMenuDefaultButton.addEventListener("click", (event) => openDefaultChoiceModal("menu", event.currentTarget));
    if (els.menuThemeModeSwitch) els.menuThemeModeSwitch.addEventListener("click", handleMenuThemeModeChange);
    if (els.menuThemePresetGrid) els.menuThemePresetGrid.addEventListener("click", handleMenuThemePresetSelect);
    if (els.resetMenuThemeProfile) els.resetMenuThemeProfile.addEventListener("click", resetActiveMenuThemeProfile);
    if (els.settingsResetDeviceButton) els.settingsResetDeviceButton.addEventListener("click", (event) => openDefaultConfirmationModal("device", event.currentTarget));
    if (els.settingsSaveSystemDefaultButton) els.settingsSaveSystemDefaultButton.addEventListener("click", saveAdminSystemDefault);
    if (els.settingsRestoreSystemDefaultButton) els.settingsRestoreSystemDefaultButton.addEventListener("click", (event) => openDefaultChoiceModal("system", event.currentTarget));
    bindPanelSettingsEvents();
    if (els.defaultChoiceModal) els.defaultChoiceModal.addEventListener("click", handleDefaultChoice);
    if (els.defaultChoiceClose) els.defaultChoiceClose.addEventListener("click", closeDefaultChoiceModal);

    els.categoryList.addEventListener("click", (event) => {
      const row = event.target.closest("[data-category-id]");
      if (!row) return;
      state.selectedCategoryId = row.dataset.categoryId;
      const category = selectedCategory();
      state.selectedProductId = category && category.products[0] ? category.products[0].id : "";
      state.allowEmptyProductSelection = false;
      setActiveSection("category", { collapseSidebar: true, render: false });
      renderActiveSection("category");
    });
    els.productCategoryTabs.addEventListener("click", handleProductCategoryTabs);
    els.productQuickList.addEventListener("click", handleProductQuickList);
    els.productCategoryTabs.addEventListener("change", handleProductCategoryTabs);
    els.productQuickList.addEventListener("change", handleProductQuickList);
    if (els.productEditorCard) els.productEditorCard.addEventListener("click", handleProductEditorCardClick);
    els.deleteCategoryButton.addEventListener("click", deleteSelectedCategory);
    els.deleteProductButton.addEventListener("click", deleteSelectedProduct);
    if (els.saveChangesButton) els.saveChangesButton.addEventListener("click", handleSaveButtonClick);
    if (els.adminUnsavedSave) els.adminUnsavedSave.addEventListener("click", handleSaveButtonClick);
    if (els.adminUnsavedDiscard) els.adminUnsavedDiscard.addEventListener("click", discardPendingAdminChanges);
    if (els.panelThemeToggle) els.panelThemeToggle.addEventListener("click", togglePanelTheme);
    if (els.mobilePanelToggle) els.mobilePanelToggle.addEventListener("click", togglePanelLayout);
    els.feedbackTabs.addEventListener("click", handleFeedbackTabs);
    if (els.feedbackList) els.feedbackList.addEventListener("click", handleFeedbackListClick);
    els.refreshFeedbackButton.addEventListener("click", refreshFeedbackInbox);
    if (els.clearFeedbackButton) els.clearFeedbackButton.addEventListener("click", clearFeedbackItems);

    [
      "bgColor", "darkBgColor", "accentColor", "textColor", "buttonTextColor", "cardColor",
      "productCardColor", "categoryCardColor", "socialIconColor", "socialIconSize", "menuBgType", "menuGradientStart", "menuGradientEnd",
      "menuGradientAngle", "menuBgUrl", "menuOverlay", "menuUpdateDate",
      "titleFont", "categoryFont", "productFont", "menuTitleSize", "categoryTitleSize",
      "productTitleSize", "productDescSize", "productIngredientsSize", "productPriceSize",
      "popularBoxType", "popularBoxColor", "popularGradientStart", "popularGradientEnd", "popularGradientAngle",
      "popularImageUrl", "popularOverlay", "homeBoxType", "homeBoxColor", "homeGradientStart", "homeGradientEnd",
      "homeGradientAngle", "homeImageUrl", "homeOverlay", "homeTextColor", "suggestBoxType", "suggestBoxColor", "suggestGradientStart",
      "suggestGradientEnd", "suggestGradientAngle", "suggestImageUrl", "suggestOverlay",
      "bannerMode", "bannerTitle", "bannerSubtitle", "bannerVideoUrl", "bannerImages"
    ].forEach((id) => {
      if (!els[id]) return;
      els[id].addEventListener("input", updateSettingsFromForm);
      els[id].addEventListener("change", updateSettingsFromForm);
    });
    if (els.bannerProductList) els.bannerProductList.addEventListener("change", updateSettingsFromForm);
    if (els.bannerProductCategory) els.bannerProductCategory.addEventListener("change", () => {
      const banner = normalizeBanner(state.data.settings && state.data.settings.banner);
      renderBannerProductList(banner.productIds);
    });
    if (els.bannerProductSearch) els.bannerProductSearch.addEventListener("input", () => {
      const banner = normalizeBanner(state.data.settings && state.data.settings.banner);
      renderBannerProductList(banner.productIds);
    });
    window.addEventListener("beforeunload", (event) => {
      if (!shouldConfirmLogout() || !hasPendingChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    });

    [
      "categoryName", "categoryActive", "categoryIconKey", "categoryStyleType", "categoryColor", "categoryGradientStart",
      "categoryGradientEnd", "categoryGradientAngle", "categoryImageUrl", "categoryOverlay"
    ].forEach((id) => {
      els[id].addEventListener("input", updateCategoryFromForm);
      els[id].addEventListener("change", updateCategoryFromForm);
    });
    [
      "productName", "productCategory", "productDesc", "productStock", "productKind", "productTemperature",
      "productPopular", "productActive", "productStyleType", "productColor", "productGradientStart",
      "productGradientEnd", "productGradientAngle", "productImageUrl", "productImageAspect", "productImageFit", "productImageOverlay",
      "productIngredients", "productContentMode"
    ].forEach((id) => {
      if (!els[id]) return;
      els[id].addEventListener("input", updateProductFromForm);
      els[id].addEventListener("change", updateProductFromForm);
    });

    els.menuBgFile.addEventListener("change", (event) => {
      const mode = state.menuThemeEditorMode === "dark" ? "dark" : "light";
      readImage(event.target, (src) => {
        const settings = state.data.settings;
        const profile = ensureMenuThemeProfiles(settings)[mode];
        profile.menuBackground.image = "";
        profile.menuBackground.imageUrl = src;
        profile.menuBackground.type = "image";
        profile.menuBackground.customized = true;
        profile.customized = true;
        syncThemeProfileLegacyFields(settings);
        if (state.menuThemeEditorMode === mode) els.menuBgUrl.value = src;
        saveAndRender();
      });
    });
    els.clearMenuBg.addEventListener("click", () => {
      const settings = state.data.settings;
      const profile = activeMenuThemeProfile(settings);
      profile.menuBackground.image = "";
      profile.menuBackground.imageUrl = "";
      profile.menuBackground.customized = true;
      profile.customized = true;
      syncThemeProfileLegacyFields(settings);
      saveAndRender();
    });
    els.popularImageFile.addEventListener("change", (event) => {
      const mode = state.menuThemeEditorMode === "dark" ? "dark" : "light";
      readImage(event.target, (src) => {
        const settings = state.data.settings;
        const profile = ensureMenuThemeProfiles(settings)[mode];
        profile.bottomActions.popular.image = "";
        profile.bottomActions.popular.imageUrl = src;
        profile.bottomActions.popular.type = "image";
        profile.bottomActions.popular.customized = true;
        profile.customized = true;
        syncThemeProfileLegacyFields(settings);
        if (state.menuThemeEditorMode === mode) els.popularImageUrl.value = src;
        saveAndRender();
      });
    });
    els.clearPopularImage.addEventListener("click", () => {
      const settings = state.data.settings;
      const profile = activeMenuThemeProfile(settings);
      profile.bottomActions.popular.image = "";
      profile.bottomActions.popular.imageUrl = "";
      profile.bottomActions.popular.customized = true;
      profile.customized = true;
      syncThemeProfileLegacyFields(settings);
      saveAndRender();
    });
    els.homeImageFile.addEventListener("change", (event) => {
      const mode = state.menuThemeEditorMode === "dark" ? "dark" : "light";
      readImage(event.target, (src) => {
        const settings = state.data.settings;
        const profile = ensureMenuThemeProfiles(settings)[mode];
        profile.bottomActions.home.image = "";
        profile.bottomActions.home.imageUrl = src;
        profile.bottomActions.home.type = "image";
        profile.bottomActions.home.customized = true;
        profile.customized = true;
        syncThemeProfileLegacyFields(settings);
        if (state.menuThemeEditorMode === mode) els.homeImageUrl.value = src;
        saveAndRender();
      });
    });
    els.clearHomeImage.addEventListener("click", () => {
      const settings = state.data.settings;
      const profile = activeMenuThemeProfile(settings);
      profile.bottomActions.home.image = "";
      profile.bottomActions.home.imageUrl = "";
      profile.bottomActions.home.customized = true;
      profile.customized = true;
      syncThemeProfileLegacyFields(settings);
      saveAndRender();
    });
    els.suggestImageFile.addEventListener("change", (event) => {
      const mode = state.menuThemeEditorMode === "dark" ? "dark" : "light";
      readImage(event.target, (src) => {
        const settings = state.data.settings;
        const profile = ensureMenuThemeProfiles(settings)[mode];
        profile.bottomActions.suggest.image = "";
        profile.bottomActions.suggest.imageUrl = src;
        profile.bottomActions.suggest.type = "image";
        profile.bottomActions.suggest.customized = true;
        profile.customized = true;
        syncThemeProfileLegacyFields(settings);
        if (state.menuThemeEditorMode === mode) els.suggestImageUrl.value = src;
        saveAndRender();
      });
    });
    els.clearSuggestImage.addEventListener("click", () => {
      const settings = state.data.settings;
      const profile = activeMenuThemeProfile(settings);
      profile.bottomActions.suggest.image = "";
      profile.bottomActions.suggest.imageUrl = "";
      profile.bottomActions.suggest.customized = true;
      profile.customized = true;
      syncThemeProfileLegacyFields(settings);
      saveAndRender();
    });
    if (els.bannerVideoFile) els.bannerVideoFile.addEventListener("change", handleBannerVideoUpload);
    if (els.bannerImageFile) els.bannerImageFile.addEventListener("change", handleBannerImageUpload);
    if (els.bannerVideoList) {
      els.bannerVideoList.addEventListener("click", handleBannerMediaClick);
      els.bannerVideoList.addEventListener("change", handleBannerMediaOrderChange);
    }
    if (els.bannerImageList) {
      els.bannerImageList.addEventListener("click", handleBannerMediaClick);
      els.bannerImageList.addEventListener("change", handleBannerMediaOrderChange);
    }
    if (els.clearBannerVideo) els.clearBannerVideo.addEventListener("click", () => {
      state.data.settings.banner = normalizeBanner(state.data.settings.banner);
      state.data.settings.banner.videos.forEach(deleteStoredMediaItem);
      state.data.settings.banner.videos = [];
      state.data.settings.banner.video = "";
      state.data.settings.banner.videoUrl = "";
      if (state.data.settings.banner.mode === "video") state.data.settings.banner.mode = "random";
      saveAndRender();
    });
    if (els.clearBannerImages) els.clearBannerImages.addEventListener("click", () => {
      state.data.settings.banner = normalizeBanner(state.data.settings.banner);
      state.data.settings.banner.images.forEach(deleteStoredMediaItem);
      state.data.settings.banner.images = [];
      if (state.data.settings.banner.mode === "images") state.data.settings.banner.mode = "random";
      saveAndRender();
    });
    els.categoryImageFile.addEventListener("change", (event) => readImage(event.target, (src) => {
      const category = selectedCategory();
      if (!category) return;
      category.style.image = "";
      category.style.imageUrl = src;
      category.style.type = "image";
      category.style.customized = true;
      category.image = "";
      els.categoryImageUrl.value = src;
      saveAndRender();
    }));
    els.clearCategoryImage.addEventListener("click", () => {
      const category = selectedCategory();
      if (!category) return;
      category.style.image = "";
      category.style.imageUrl = "";
      category.style.customized = true;
      category.image = "";
      saveAndRender();
    });
    els.applyBulkProductImage.addEventListener("click", applyBulkProductImageUrl);
    els.bulkProductImageFile.addEventListener("change", (event) => readImage(event.target, (src) => applyBulkProductImage(src, true)));
    els.clearBulkProductImage.addEventListener("click", clearBulkProductImages);
    els.applyBulkProductStyle.addEventListener("click", applyBulkProductStyle);
    els.productImageFile.addEventListener("change", (event) => readImage(event.target, (src) => {
      const product = selectedProduct();
      if (!product) return;
      product.image = "";
      product.imageUrl = src;
      els.productImageUrl.value = src;
      saveAndRender();
    }));
    els.clearProductImage.addEventListener("click", () => {
      const product = selectedProduct();
      if (!product) return;
      product.image = "";
      product.imageUrl = "";
      saveAndRender();
    });
  }

  function bindPanelSettingsEvents() {
    [els.settingsLastSectionToggle, els.settingsSidebarDefaultOpen, els.settingsConfirmOnExit, els.settingsDefaultSection].forEach((control) => {
      if (!control) return;
      control.addEventListener("change", handlePanelSettingsChange);
      control.addEventListener("input", handlePanelSettingsChange);
    });
    Object.values(BRAND_TEXT_FIELDS).map((id) => els[id]).forEach((control) => {
      if (!control) return;
      control.addEventListener("input", handleSiteInfoSettingsChange);
      control.addEventListener("change", handleSiteInfoSettingsChange);
    });
    Object.entries(BRAND_MEDIA_CONTROLS).forEach(([key, controls]) => {
      const fileInput = els[controls[1]];
      const clearButton = els[controls[2]];
      if (fileInput) fileInput.addEventListener("change", (event) => handleSettingsMediaInput(event, key));
      if (clearButton) clearButton.addEventListener("click", () => clearSettingsMedia(key));
    });
    if (els.settingsChangePassword) els.settingsChangePassword.addEventListener("click", () => window.open("/password-reset/?scope=admin&returnTo=%2Fyonetici%2F", "_blank", "noopener"));
    if (els.settingsLogoutNow) els.settingsLogoutNow.addEventListener("click", logoutAdminSession);
    if (els.exportMenuData) els.exportMenuData.addEventListener("click", () => exportAdminDataset("menu"));
    if (els.createBackup) els.createBackup.addEventListener("click", createAdminBackup);
    if (els.adminThemePresetGrid) els.adminThemePresetGrid.addEventListener("click", handleAdminThemePresetClick);
    if (els.adminThemeApplyButton) els.adminThemeApplyButton.addEventListener("click", applyAndPublishAdminTheme);
    if (els.adminThemeDraftButton) els.adminThemeDraftButton.addEventListener("click", saveAdminThemeDraft);
    if (els.adminThemeResetButton) els.adminThemeResetButton.addEventListener("click", resetAdminThemePreset);
  }

  function handlePanelSettingsChange(event) {
    writePanelConfigFromForm();
    savePanelConfig();
    if (event && event.currentTarget === els.settingsSidebarDefaultOpen) {
      safeLocalRemove(SIDEBAR_STATE_KEY);
      setSidebarCollapsed(defaultSidebarCollapsed());
    }
    applyPanelRuntimeSettings();
  }

  function handleSiteInfoSettingsChange() {
    writeSiteInfoFromSettings({ dirty: true });
  }

  function defaultSidebarCollapsed() {
    if (isAdminMobileSidebar()) return true;
    const saved = safeLocalGet(SIDEBAR_STATE_KEY);
    if (saved === "1" || saved === "0") return saved === "1";
    if (SIDEBAR_BREAKPOINT.matches) return true;
    return state.panelConfig && state.panelConfig.behavior.sidebarDefaultOpen === false;
  }

  function shouldConfirmLogout() {
    const config = state.panelConfig || DEFAULT_PANEL_CONFIG;
    return config.behavior.confirmOnExit !== false;
  }

  function toggleAdminProfileMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!els.adminProfileMenu || !els.adminProfileButton) return;
    const willOpen = els.adminProfileMenu.hidden;
    els.adminProfileMenu.hidden = !willOpen;
    els.adminProfileButton.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) {
      const firstAction = els.adminProfileMenu.querySelector("[role='menuitem']:not(:disabled)");
      if (firstAction) window.setTimeout(() => firstAction.focus(), 0);
    }
  }

  function closeAdminProfileMenu() {
    if (els.adminProfileMenu) els.adminProfileMenu.hidden = true;
    if (els.adminProfileButton) els.adminProfileButton.setAttribute("aria-expanded", "false");
  }

  function closeAdminProfileMenuFromOutside(event) {
    if (!els.adminProfileMenu || els.adminProfileMenu.hidden) return;
    if (event.target.closest("#adminProfileMenu") || event.target.closest("#adminProfileButton")) return;
    closeAdminProfileMenu();
  }

  function handleAdminShellKeydown(event) {
    if (state.notificationCenter.open) return;
    if (els.defaultChoiceModal && !els.defaultChoiceModal.hidden) {
      if (event.key === "Tab") trapDefaultChoiceFocus(event);
      if (event.key === "Escape") {
        event.preventDefault();
        if (!state.defaultOperationBusy) closeDefaultChoiceModal();
      }
      return;
    }
    if (event.key === "Tab" && trapAdminDrawerFocus(event)) return;
    if (event.key !== "Escape") return;
    if (els.adminProfileMenu && !els.adminProfileMenu.hidden) {
      closeAdminProfileMenu();
      if (els.adminProfileButton) els.adminProfileButton.focus();
      return;
    }
    if (isAdminMobileSidebar() && !isSidebarCollapsed()) setSidebarCollapsed(true, { persist: false, restoreFocus: true });
  }

  function handleAdminProfileAction(event) {
    const action = event.target.closest("[data-admin-profile-action]");
    if (!action) return;
    closeAdminProfileMenu();
    if (action.dataset.adminProfileAction === "profile") { setActiveSection("profile"); return; }
    if (action.dataset.adminProfileAction === "settings") {
      setActiveSection("settings", { collapseSidebar: true });
      return;
    }
    if (action.dataset.adminProfileAction === "logout") logoutAdminSession();
  }

  function toggleSidebar() {
    const collapsed = !isSidebarCollapsed();
    setSidebarCollapsed(collapsed, { persist: !isAdminMobileSidebar(), focusDrawer: !collapsed });
  }

  function isSidebarCollapsed() {
    return Boolean(els.panelShell && els.panelShell.classList.contains("is-sidebar-collapsed"));
  }

  function isAdminMobileSidebar() {
    return Boolean(ADMIN_DRAWER_BREAKPOINT.matches);
  }

  function setSidebarCollapsed(collapsed, options = {}) {
    if (!els.panelShell) return;
    const wasCollapsed = isSidebarCollapsed();
    const nextCollapsed = Boolean(collapsed);
    els.panelShell.classList.toggle("is-sidebar-collapsed", nextCollapsed);
    if (options.persist !== false && !isAdminMobileSidebar()) {
      safeLocalSet(SIDEBAR_STATE_KEY, nextCollapsed ? "1" : "0");
    }
    syncAdminSidebarUi();
    if (isAdminMobileSidebar() && !nextCollapsed && (options.focusDrawer || wasCollapsed)) {
      window.setTimeout(focusFirstAdminSidebarControl, 0);
    } else if (isAdminMobileSidebar() && nextCollapsed && options.restoreFocus && els.sidebarToggle) {
      window.setTimeout(() => els.sidebarToggle.focus(), 0);
    }
  }

  function syncAdminSidebarUi() {
    const collapsed = isSidebarCollapsed();
    const mobile = isAdminMobileSidebar();
    const panelVisible = Boolean(els.panelShell && !els.panelShell.hidden && els.panelShell.style.display !== "none");
    const drawerOpen = panelVisible && mobile && !collapsed;
    if (els.sidebarToggle) {
      els.sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
      const label = collapsed ? "Kenar çubuğunu aç" : "Kenar çubuğunu kapat";
      els.sidebarToggle.setAttribute("aria-label", label);
      els.sidebarToggle.setAttribute("title", label);
    }
    if (els.sidebarPanel) {
      els.sidebarPanel.setAttribute("aria-hidden", "false");
      els.sidebarPanel.inert = false;
      const hiddenRegions = els.sidebarPanel.querySelectorAll(".sidebar-scroll-region, .admin-profile-wrap");
      hiddenRegions.forEach((region) => {
        region.inert = Boolean(mobile && collapsed);
        region.setAttribute("aria-hidden", mobile && collapsed ? "true" : "false");
      });
    }
    if (els.adminSidebarOverlay) {
      els.adminSidebarOverlay.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
      els.adminSidebarOverlay.tabIndex = -1;
    }
    const workspace = els.panelShell && els.panelShell.querySelector(":scope > .workspace");
    if (workspace) workspace.inert = drawerOpen;
    document.body.classList.toggle("is-admin-drawer-open", drawerOpen);
  }

  function focusFirstAdminSidebarControl() {
    if (!els.sidebarPanel || !isAdminMobileSidebar() || isSidebarCollapsed()) return;
    const target = els.sidebarPanel.querySelector(".panel-nav a, .sidebar-profile");
    if (target) target.focus();
  }

  function trapAdminDrawerFocus(event) {
    if (!isAdminMobileSidebar() || isSidebarCollapsed() || !els.sidebarPanel) return false;
    const controls = Array.from(els.sidebarPanel.querySelectorAll("a[href], button:not(:disabled)"))
      .filter((control) => control.getClientRects().length && control.getAttribute("aria-hidden") !== "true");
    if (!controls.length) return false;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.sidebarPanel.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    if (!els.sidebarPanel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function syncSidebarForViewport() {
    setSidebarCollapsed(defaultSidebarCollapsed(), { persist: false });
  }

  function syncAdminDrawerForViewport(event) {
    if (event && event.matches) {
      setSidebarCollapsed(true, { persist: false });
      return;
    }
    setSidebarCollapsed(defaultSidebarCollapsed(), { persist: false });
  }

  function toggleSettingsMenu(event) {
    if (!els.settingsMenu || !els.settingsToggle) return;
    event.stopPropagation();
    const hidden = els.settingsMenu.hidden;
    els.settingsMenu.hidden = !hidden;
    els.settingsToggle.setAttribute("aria-expanded", String(hidden));
  }

  function closeSettingsMenu() {
    if (!els.settingsMenu || !els.settingsToggle) return;
    els.settingsMenu.hidden = true;
    els.settingsToggle.setAttribute("aria-expanded", "false");
  }

  function handleDocumentClick(event) {
    if (event.target.closest(".settings-popover")) return;
    closeSettingsMenu();
  }

  function handlePanelNavClick(event) {
    const link = event.target.closest("[data-panel-section]");
    if (!link) return;
    event.preventDefault();
    setActiveSection(link.dataset.panelSection, { collapseSidebar: true });
  }

  function handleOverviewAction(event) {
    const target = event.target.closest("[data-overview-section]");
    if (!target) return;
    event.preventDefault();
    setActiveSection(target.dataset.overviewSection, {
      collapseSidebar: window.matchMedia("(max-width: 1180px)").matches
    });
  }

  function handleSectionHashChange() {
    const section = resolveHashSection();
    if (!section || section === state.activeSection) return;
    setActiveSection(section, { collapseSidebar: false });
  }

  function resolveInitialActiveSection() {
    return "overview";
  }

  function clearInitialAdminNavigation() {
    safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
    const url = new URL(window.location.href);
    for (const key of ["section", "workforce", "panel", "entityId", "taskId", "requestId", "feedbackId"]) url.searchParams.delete(key);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  function resolveAdminNavigationQuery() {
    const query = new URLSearchParams(window.location.search);
    const target = String(query.get("workforce") || query.get("panel") || "").trim().toLowerCase();
    const entityId = String(query.get("entityId") || query.get("taskId") || query.get("requestId") || "").trim().slice(0, 180);
    const navigation = resolveWorkforceNavigation(normalizeAdminNotificationSection(String(query.get("section") || "").trim()), target, entityId);
    return {
      section: navigation.section,
      feedbackId: String(query.get("feedbackId") || "").trim().slice(0, 180),
      workforceTarget: navigation.target,
      entityId
    };
  }

  function resolveWorkforceNavigation(section, target, entityId) {
    const normalized = ({ task: "tasks", shift: "shifts", materialrequest: "materialrequests", "material-request": "materialrequests", leave: "leaverequests", "leave-requests": "leaverequests" }[target] || target);
    if (normalized === "materialrequests") return { section: "approvals", target: normalized };
    if (normalized === "leaverequests" || normalized === "shifts" && (entityId || section === "approvals")) return { section: "approvals", target: "leaverequests" };
    if (["tasks", "shifts"].includes(normalized)) return { section: "staffAccess", target: normalized };
    return { section, target: normalized };
  }

  function handleOpenStockProduct(event) {
    const productId = String(event && event.detail && event.detail.productId || "").trim();
    if (!productId) return;
    state.pendingStockProductId = productId;
    setActiveSection("product", { collapseSidebar: true, forceLoad: true });
  }

  function applyInitialAdminNavigationTarget() {
    const target = resolveAdminNavigationQuery();
    if (target.feedbackId) {
      state.focusedFeedbackId = target.feedbackId;
      state.feedbackFilter = "all";
    }
    if (target.section) setActiveSection(target.section, { collapseSidebar: false });
    if (["staffAccess", "approvals"].includes(target.section)) revealAdminNavigationTarget(target.section, target.workforceTarget, target.entityId);
  }

  function resolveHashSection() {
    const hash = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
    if (!hash) return "";
    const normalizedHash = normalizePanelSection(hash);
    if (normalizedHash) return normalizedHash;
    const directLink = Array.from(document.querySelectorAll("[data-panel-section]"))
      .find((link) => link.getAttribute("href") === `#${hash}`);
    if (directLink) return normalizePanelSection(directLink.dataset.panelSection);
    const target = document.getElementById(hash);
    if (!target) return "";
    return normalizePanelSection(target.dataset.sectionPanel || target.closest("[data-section-panel]")?.dataset.sectionPanel);
  }

  function normalizePanelSection(section) {
    if (section === "audit") return "procurementDocuments";
    if (["labels", "labelCreationCard"].includes(section)) return "product";
    // Kaldırılan bağımsız sekmeler için mevcut kayıtları koruyan güvenli hedefler.
    if (["procurementInvoices", "procurementDeliveryNotes", "procurementDocumentImages"].includes(section)) return "procurementDocuments";
    if (["procurementPayments", "procurementLedger", "procurementReversals"].includes(section)) return "procurementDocuments";
    if (["procurementSuppliers", "procurementProducts"].includes(section)) return "overview";
    if (["permissions", "dataCenter", "dataImportCenter"].includes(section)) return "overview";
    // Eski son-sekme ayarları ve yer imleri kaldırılan ekranları tekrar açmasın.
    const depotAliases = ["stockMovements", "transfers", "counts", "critical", "transfersCard", "countsCard", "criticalStockCard"];
    const normalized = ["notifications", "notificationCenterCard"].includes(section) ? "overview" : depotAliases.includes(section) ? "barcode" : section === "category" ? "product" : section;
    return Object.prototype.hasOwnProperty.call(SECTION_TITLES, normalized) ? normalized : "";
  }

  function setActiveSection(section, options) {
    const previousSection = state.activeSection;
    state.activeSection = normalizePanelSection(section) || "overview";
    if (state.activeSection === "overview") { state.stockOverview = null; void loadStockOverview(); }
    if (!options || options.persist !== false) {
      if (state.panelConfig && state.panelConfig.behavior.keepLastSection !== false) safeLocalSet(LAST_ACTIVE_SECTION_KEY, state.activeSection);
      else safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
    }
    if ((!options || options.collapseSidebar !== false) && isAdminMobileSidebar()) {
      setSidebarCollapsed(true, { persist: false });
    }
    if (!options || options.render !== false) renderActiveSection(state.activeSection);
    if (state.activeSection === "dataCenter" && !state.dataImportCenter.historyLoaded && !state.dataImportCenter.busy) {
      loadDataImportHistory().catch(() => {});
    }
    if (previousSection !== state.activeSection || options && options.forceLoad) {
      document.dispatchEvent(new CustomEvent("menu-suite:admin-section-change", { detail: { section: state.activeSection } }));
      ensureSectionModule(state.activeSection)
        .then(() => ensureSectionData(state.activeSection))
        .then(() => syncSectionBackendEvents(state.activeSection))
        .catch((error) => updateSaveControls(error.message || "Bölüm verisi yüklenemedi"));
    } else {
      syncSectionBackendEvents(state.activeSection);
    }
  }

  function loadData() {
    return normalizeState({
      settings: DEFAULT_SETTINGS,
      categories: []
    });
  }

  function readStoredJSON(key) {
    const stored = safeLocalGet(key);
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch (error) {
      return null;
    }
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function loadPanelConfig() {
    return normalizePanelConfig(readStoredJSON(PANEL_SETTINGS_KEY));
  }

  function normalizePanelConfig(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const appearance = source.appearance && typeof source.appearance === "object" ? source.appearance : {};
    const behavior = source.behavior && typeof source.behavior === "object" ? source.behavior : {};
    const backup = source.backup && typeof source.backup === "object" ? source.backup : {};
    const section = normalizePanelSection(behavior.defaultSection) || DEFAULT_PANEL_CONFIG.behavior.defaultSection;
    return {
      appearance: {
        adminThemePresetId: adminThemePresetById(appearance.adminThemePresetId).id
      },
      behavior: {
        keepLastSection: behavior.keepLastSection !== false,
        sidebarDefaultOpen: behavior.sidebarDefaultOpen !== false,
        confirmOnExit: behavior.confirmOnExit !== false,
        defaultSection: section
      },
      backup: {
        lastBackupAt: String(backup.lastBackupAt || "")
      }
    };
  }

  function panelConfigFingerprint(value) {
    return JSON.stringify(normalizePanelConfig(value));
  }

  function savePanelConfig() {
    state.panelConfig = normalizePanelConfig(state.panelConfig);
    safeLocalSet(PANEL_SETTINGS_KEY, JSON.stringify(state.panelConfig));
    state.dirtyPanelConfig = panelConfigFingerprint(state.panelConfig) !== state.publishedPanelConfigFingerprint;
    if (state.dirtyPanelConfig) safeLocalSet(PANEL_SETTINGS_DRAFT_KEY, "1");
    else safeLocalRemove(PANEL_SETTINGS_DRAFT_KEY);
    updateSaveControls(state.dirtyPanelConfig ? "Kaydedilmemiş panel ayarı" : undefined);
    updateAdminThemeSelectionStatus();
  }

  function renderPanelSettings() {
    state.panelConfig = normalizePanelConfig(state.panelConfig);
    renderAdminThemePresets();
    if (!els.settingsLastSectionToggle) return;
    populatePanelSettingsSelects();
    const behavior = state.panelConfig.behavior;

    els.settingsLastSectionToggle.checked = behavior.keepLastSection;
    els.settingsSidebarDefaultOpen.checked = behavior.sidebarDefaultOpen;
    els.settingsConfirmOnExit.checked = behavior.confirmOnExit;
    els.settingsDefaultSection.value = normalizePanelSection(behavior.defaultSection) || "overview";
    if (els.settingsLastBackup) els.settingsLastBackup.textContent = state.panelConfig.backup.lastBackupAt ? formatDateTime(state.panelConfig.backup.lastBackupAt) : "Henüz yedek yok";
  }

  function renderBrandSettings() {
    const info = readSiteInfoFromState();
    Object.entries(BRAND_TEXT_FIELDS).forEach(([key, id]) => {
      if (els[id]) els[id].value = info[key];
    });
    Object.entries(BRAND_MEDIA_CONTROLS).forEach(([key, controls]) => {
      renderSettingsMediaPreview(els[controls[0]], info[key], controls[3]);
    });
    applyAdminBrandIdentity(info);
  }

  function populatePanelSettingsSelects() {
    if (els.settingsDefaultSection && !els.settingsDefaultSection.options.length) {
      els.settingsDefaultSection.innerHTML = Object.keys(SECTION_TITLES)
        .map((key) => `<option value="${escapeAttribute(key)}">${escapeHTML(SECTION_TITLES[key])}</option>`)
        .join("");
    }
  }

  function writePanelConfigFromForm() {
    if (!els.settingsLastSectionToggle) return;
    state.panelConfig = normalizePanelConfig({
      behavior: {
        keepLastSection: els.settingsLastSectionToggle.checked,
        sidebarDefaultOpen: els.settingsSidebarDefaultOpen.checked,
        confirmOnExit: els.settingsConfirmOnExit.checked,
        defaultSection: els.settingsDefaultSection.value || "overview"
      },
      appearance: state.panelConfig && state.panelConfig.appearance,
      backup: state.panelConfig && state.panelConfig.backup
    });
  }

  function adminThemePresetById(id) {
    return PANEL_THEME.presetById(id);
  }

  function currentAdminThemePreset() {
    const config = normalizePanelConfig(state.panelConfig);
    return adminThemePresetById(config.appearance.adminThemePresetId);
  }

  function applyAdminThemePreset(id) {
    return PANEL_THEME.apply(id);
  }

  function renderAdminThemePresets() {
    if (!els.adminThemePresetGrid) return;
    const activePreset = currentAdminThemePreset();
    els.adminThemePresetGrid.innerHTML = ADMIN_THEME_PRESETS.map((preset, index) => {
      const active = preset.id === activePreset.id;
      const colors = preset.colors;
      const previewStyle = [
        `--theme-preview-canvas:${colors.canvas}`,
        `--theme-preview-surface:${colors.surface}`,
        `--theme-preview-sidebar:${colors.sidebar}`,
        `--theme-preview-active:${colors.sidebarActive}`,
        `--theme-preview-primary:${colors.primary}`,
        `--theme-preview-accent:${colors.accent}`,
        `--theme-preview-text:${colors.text}`,
        `--theme-preview-border:${colors.border}`,
        `--theme-preview-on-sidebar:${colors.sidebarText}`
      ].join(";");
      return `
        <div class="admin-theme-preset-item" role="listitem">
          <button class="admin-theme-preset-card${active ? " is-active" : ""}" type="button"
            data-admin-theme-preset-id="${escapeAttribute(preset.id)}"
            aria-pressed="${active ? "true" : "false"}"
            aria-label="${escapeAttribute(`${preset.name} temasını seç`)}">
            <span class="admin-theme-preset-card__head">
              <span class="admin-theme-preset-card__number">${index + 1}</span>
              <strong>${escapeHTML(preset.name)}</strong>
              <span class="admin-theme-active-badge"${active ? "" : " hidden"}>Aktif</span>
            </span>
            <span class="admin-theme-mini-preview" style="${escapeAttribute(previewStyle)}" aria-hidden="true">
              <span class="admin-theme-mini-sidebar">
                <i></i><b></b><b class="is-active"></b><b></b><b></b>
              </span>
              <span class="admin-theme-mini-main">
                <span class="admin-theme-mini-top"><i></i><em></em></span>
                <span class="admin-theme-mini-stats"><i></i><i></i><i></i></span>
                <span class="admin-theme-mini-chart">
                  <svg viewBox="0 0 160 48" preserveAspectRatio="none"><path d="M2 38 C18 36 22 18 38 23 S58 39 73 24 S92 8 108 20 S129 29 158 8"></path></svg>
                </span>
              </span>
            </span>
            <span class="admin-theme-swatches" aria-label="${escapeAttribute(`${preset.name} renk paleti`)}">
              ${preset.swatches.map((color) => `<i style="--theme-swatch:${escapeAttribute(color)}" title="${escapeAttribute(color)}"></i>`).join("")}
            </span>
          </button>
        </div>`;
    }).join("");
    updateAdminThemeSelectionStatus();
  }

  function updateAdminThemeSelectionStatus(message, tone) {
    const preset = currentAdminThemePreset();
    const isPublishedTheme = preset.id === state.publishedAdminThemePresetId;
    if (els.adminThemeSelectionStatus) {
      els.adminThemeSelectionStatus.textContent = message || (isPublishedTheme
        ? `${preset.name} · Aktif tema`
        : `${preset.name} · Kaydedilmeyi bekleyen taslak`);
      els.adminThemeSelectionStatus.dataset.tone = tone || (isPublishedTheme ? "active" : "draft");
    }
    if (els.adminThemeApplyButton) els.adminThemeApplyButton.disabled = Boolean(state.saving);
  }

  function selectAdminThemePreset(id, message) {
    const preset = adminThemePresetById(id);
    state.panelConfig = normalizePanelConfig(state.panelConfig);
    state.panelConfig.appearance.adminThemePresetId = preset.id;
    applyAdminThemePreset(preset.id);
    savePanelConfig();
    renderAdminThemePresets();
    if (message) updateAdminThemeSelectionStatus(message, "draft");
    return preset;
  }

  function handleAdminThemePresetClick(event) {
    const card = event.target.closest("[data-admin-theme-preset-id]");
    if (!card || !els.adminThemePresetGrid.contains(card)) return;
    const preset = selectAdminThemePreset(card.dataset.adminThemePresetId);
    updateAdminThemeSelectionStatus(`${preset.name} canlı önizlemede`, "draft");
  }

  async function applyAndPublishAdminTheme() {
    const preset = currentAdminThemePreset();
    applyAdminThemePreset(preset.id);
    savePanelConfig();
    if (els.adminThemeApplyButton) {
      els.adminThemeApplyButton.disabled = true;
      els.adminThemeApplyButton.setAttribute("aria-busy", "true");
    }
    try {
      await savePendingChanges();
      renderAdminThemePresets();
    } catch (_error) {
      updateAdminThemeSelectionStatus(`${preset.name} taslağı korunuyor`, "draft");
    } finally {
      if (els.adminThemeApplyButton) {
        els.adminThemeApplyButton.disabled = false;
        els.adminThemeApplyButton.removeAttribute("aria-busy");
      }
    }
  }

  function saveAdminThemeDraft() {
    const preset = currentAdminThemePreset();
    savePanelConfig();
    updateAdminThemeSelectionStatus(`${preset.name} taslak olarak kaydedildi`, "draft");
  }

  function resetAdminThemePreset() {
    const preset = selectAdminThemePreset(DEFAULT_ADMIN_THEME_PRESET_ID);
    updateAdminThemeSelectionStatus(`${preset.name} varsayılanı taslağa uygulandı`, "draft");
  }

  function readSiteInfoFromState() {
    const source = state.data && state.data.settings && state.data.settings.brandInfo;
    const info = source && typeof source === "object" && !Array.isArray(source) ? source : {};
    const keys = new Set([
      ...Object.keys(DEFAULT_SETTINGS.brandInfo || {}),
      ...Object.keys(BRAND_TEXT_FIELDS),
      ...Object.keys(BRAND_MEDIA_CONTROLS),
      "logo", "favicon"
    ]);
    return Object.fromEntries(Array.from(keys).map((key) => [key, String(info[key] ?? DEFAULT_SETTINGS.brandInfo?.[key] ?? "")]));
  }

  function readSiteInfoFromForm() {
    const info = readSiteInfoFromState();
    Object.entries(BRAND_TEXT_FIELDS).forEach(([key, id]) => {
      if (els[id]) info[key] = els[id].value.trim();
    });
    return info;
  }

  function writeSiteInfoFromSettings(options) {
    if (!els.siteCafeName) return;
    applySiteInfoToState(readSiteInfoFromForm(), options);
  }

  function applySiteInfoToState(info, options) {
    if (!state.data) state.data = loadData();
    if (!state.data.settings) state.data.settings = cloneData(DEFAULT_SETTINGS);
    const previous = readSiteInfoFromState();
    const next = { ...previous };
    Object.keys(next).forEach((key) => {
      if (info && Object.prototype.hasOwnProperty.call(info, key)) next[key] = String(info[key] ?? "");
    });
    state.data.settings.brandInfo = next;
    state.data = normalizeState(state.data);
    if (!(options && options.dirty === false) && JSON.stringify(previous) !== JSON.stringify(next)) markDirty("menu");
    Object.entries(BRAND_MEDIA_CONTROLS).forEach(([key, controls]) => {
      renderSettingsMediaPreview(els[controls[0]], next[key], controls[3]);
    });
    applyAdminBrandIdentity(next);
  }

  function applyAdminBrandIdentity(info) {
    const brand = info || readSiteInfoFromState();
    const identity = window.BrandIdentity;
    const registeredName = String(brand.cafeName || brand.menuBrandTitle || "").trim();
    const name = registeredName || "Yönetici Paneli";
    document.documentElement.dataset.brandName = name;
    const customLogo = String(brand.adminLogoUrl || brand.lightLogoUrl || brand.darkLogoUrl || brand.logo || "").trim();
    const mode = document.body.dataset.panelTheme === "dark" ? "dark" : "light";
    const logo = identity?.logo(brand, mode, "admin", "yonetici") || "/assets/app-icons/yonetici/master.svg";
    if (customLogo) document.documentElement.style.setProperty("--admin-brand-watermark", `url(${JSON.stringify(logo)})`);
    else document.documentElement.style.setProperty("--admin-brand-watermark", "none");
    const favicon = identity?.favicon(brand, "admin") || "/assets/app-icons/yonetici/favicon-32.png";
    const appIcon = identity?.appIcon(brand, "admin", "yonetici") || "/assets/app-icons/yonetici/apple-touch-icon-180.png";
    const storedTitle = String(brand.adminBrowserTitle || "").trim();
    document.title = storedTitle || (registeredName ? `${registeredName} Yönetici` : "Yönetici Paneli");
    document.querySelectorAll("[data-admin-brand-logo]").forEach((image) => {
      image.src = logo;
      image.alt = `${name} Logo`;
      image.classList.toggle("has-custom-logo", Boolean(customLogo));
    });
    if (els.adminSidebarBrandName) els.adminSidebarBrandName.textContent = "STS Yönetici Paneli";
    if (els.adminProfileBrandName) els.adminProfileBrandName.textContent = `${name} paneli`;
    if (els.adminNotificationBrandName) els.adminNotificationBrandName.textContent = `${name} Yönetici`.toLocaleUpperCase("tr-TR");
    document.querySelectorAll('link[rel~="icon"]').forEach((link) => {
      if (!link.dataset.defaultBrandHref) link.dataset.defaultBrandHref = link.getAttribute("href") || "";
      link.href = favicon || link.dataset.defaultBrandHref;
    });
    document.querySelectorAll('link[rel="apple-touch-icon"]').forEach((link) => {
      if (!link.dataset.defaultBrandHref) link.dataset.defaultBrandHref = link.getAttribute("href") || "";
      link.href = appIcon || favicon || link.dataset.defaultBrandHref;
    });
    identity?.apply(brand, { logoSelector: "[data-admin-brand-logo]", appId: "yonetici", kind: "admin", mode, fallbackName: "Yönetici Paneli" });
  }

  function renderSettingsMediaPreview(target, src, emptyText) {
    if (!target) return;
    const url = String(src || "");
    target.innerHTML = url
      ? `<img src="${escapeAttribute(url)}" alt="">`
      : `<span>${escapeHTML(emptyText)}</span>`;
  }

  function applyPanelRuntimeSettings() {
    state.panelConfig = normalizePanelConfig(state.panelConfig);
    applyAdminThemePreset(state.panelConfig.appearance.adminThemePresetId);
    if (!state.panelConfig.behavior.keepLastSection) safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
  }

  async function handleSettingsMediaInput(event, kind) {
    const input = event.currentTarget;
    const file = input && input.files && input.files[0];
    if (!file || !file.type.startsWith("image/")) {
      if (input) input.value = "";
      return;
    }
    try {
      const media = await storeMediaFile(file, "image");
      const info = readSiteInfoFromState();
      info[kind] = media.src;
      applySiteInfoToState(info, { dirty: true });
      updateSaveControls("Marka görseli kaydedilmedi");
    } catch (error) {
      updateSaveControls(error.message || "Görsel yüklenemedi");
    } finally {
      input.value = "";
    }
  }

  function clearSettingsMedia(kind) {
    const info = readSiteInfoFromState();
    info[kind] = "";
    applySiteInfoToState(info, { dirty: true });
  }

  function exportAdminDataset(kind) {
    const source = {
      menu: () => state.data || loadData()
    }[kind];
    if (!source) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      type: kind,
      data: source()
    };
    downloadJSONFile(payload, `${brandExportStem()}-${kind}-${isoDateForFile()}.json`);
  }

  async function createAdminBackup() {
    if (!state.feedbackLoaded) {
      try {
        await loadFeedbackFromBackend();
      } catch (error) {
        updateSaveControls(error.message || "Geri bildirim verisi alınamadığı için yedek oluşturulamadı");
        return;
      }
    }
    const createdAt = new Date().toISOString();
    const payload = {
      createdAt,
      menuState: state.data || loadData(),
      panelSettings: normalizePanelConfig(state.panelConfig),
      feedbackItems: cloneData(state.feedbackItems)
    };
    downloadJSONFile(payload, `${brandExportStem()}-backup-${isoDateForFile()}.json`);
    state.panelConfig.backup.lastBackupAt = createdAt;
    savePanelConfig();
    if (els.settingsLastBackup) els.settingsLastBackup.textContent = formatDateTime(createdAt);
    updateSaveControls("Yedek indirildi");
    window.setTimeout(() => updateSaveControls(), 1200);
  }

  function downloadJSONFile(payload, filename) {
    const text = JSON.stringify(payload, null, 2);
    const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(text)}`;
    downloadDataUrl(dataUrl, filename);
  }

  function brandExportStem() {
    const name = readSiteInfoFromState().cafeName || "marka";
    return String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "marka";
  }

  function backendBaseUrl() {
    const queryValue = (() => {
      try {
        return new URLSearchParams(window.location.search).get("backend") || "";
      } catch (error) {
        return "";
      }
    })();
    if (queryValue) safeLocalSet(BACKEND_URL_KEY, queryValue);

    const explicit = window.MENU_SUITE_BACKEND_URL
      || queryValue
      || safeLocalGet(BACKEND_URL_KEY)
      || "";
    if (explicit) return String(explicit).replace(/\/+$/, "");

    if (window.location.protocol === "http:" || window.location.protocol === "https:") {
      return window.location.origin;
    }

    return "";
  }

  async function backendRequest(path, options) {
    const baseUrl = backendBaseUrl();
    if (!baseUrl || !window.fetch) throw new Error("Backend adresi tanımlı değil.");

    const method = String(options && options.method || "GET").toUpperCase();
    const dedupe = method === "GET" && !(options && options.noDedupe);
    const dedupeKey = dedupe ? `${method}:${path}` : "";
    if (dedupeKey && state.requestPromises.has(dedupeKey)) return state.requestPromises.get(dedupeKey);
    const request = (async () => {
    const rawBody = options && Object.prototype.hasOwnProperty.call(options, "rawBody") ? options.rawBody : null;
    const headers = Object.assign(rawBody ? {} : { "Content-Type": "application/json" }, {
      "X-Menu-Suite-App-Id": "yonetici",
      "X-Menu-Suite-App-Target": "yonetici"
    }, options && options.headers);

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      cache: options && options.cache || "no-store",
      signal: options && options.signal,
      body: rawBody || (options && options.body ? JSON.stringify(options.body) : undefined)
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      if ((response.status === 401 || response.status === 403) && !(options && options.skipAuthFailure)) {
        handleSessionEnded(result.message || SESSION_REQUIRED_MESSAGE);
      }
      const error = new Error(result.message || "Backend isteği başarısız.");
      error.status = response.status;
      error.code = result.code || "";
      error.payload = result;
      throw error;
    }

      return result;
    })();
    if (dedupeKey) state.requestPromises.set(dedupeKey, request);
    try {
      return await request;
    } finally {
      if (dedupeKey && state.requestPromises.get(dedupeKey) === request) state.requestPromises.delete(dedupeKey);
    }
  }

  async function logoutAdminSession() {
    if (shouldConfirmLogout() && !window.confirm("Oturumu kapatmak istiyor musunuz?")) return;
    await detachAdminPushSubscription().catch(() => null);
    try {
      await backendRequest("/api/admin/logout", {
        method: "POST",
        skipAuthFailure: true
      });
    } catch (_error) {}
    handleSessionEnded("Oturum kapatildi.");
  }

  function handleSessionEnded(message) {
    closeBackendEvents();
    document.dispatchEvent(new CustomEvent("menu-suite:admin-session-ended", { detail: { source: "admin-shell", message: message || SESSION_REQUIRED_MESSAGE } }));
    closeAdminNotificationDrawer({ restoreFocus: false });
    state.saving = false;
    if (els.panelShell) {
      els.panelShell.hidden = true;
      els.panelShell.style.display = "none";
    }
    closeAdminProfileMenu();
    closeDefaultChoiceModal();
    setSidebarCollapsed(true, { persist: false });
    if (els.loginScreen) {
      els.loginScreen.hidden = false;
      els.loginScreen.style.display = "grid";
    }
    if (els.loginError) {
      els.loginError.textContent = message || SESSION_REQUIRED_MESSAGE;
      els.loginError.hidden = false;
    }
    if (els.passwordInput) {
      els.passwordInput.value = "";
      window.setTimeout(() => els.passwordInput.focus(), 60);
    }
    updateSaveControls(message || SESSION_REQUIRED_MESSAGE);
  }

  function closeBackendEvents() {
    ["menuEventSource", "feedbackEventSource", "notificationEventSource"].forEach((key) => {
      if (!state[key]) return;
      try { state[key].close(); } catch (_error) {}
      state[key] = null;
    });
    if (state.notificationPollTimer) {
      window.clearInterval(state.notificationPollTimer);
      state.notificationPollTimer = null;
    }
    if (state.notificationReconnectTimer) {
      window.clearTimeout(state.notificationReconnectTimer);
      state.notificationReconnectTimer = null;
    }
    state.notificationReconnectAttempt = 0;
  }

  async function loginBackend(password) {
    if (!backendBaseUrl()) return { ok: false };
    try {
      const result = await backendRequest("/api/admin/login", {
        method: "POST",
        skipToken: true,
        body: { password }
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "" };
    }
  }

  async function verifyBackendSession() {
    if (!backendBaseUrl()) return false;

    try {
      await backendRequest("/api/admin/me", { skipAuthFailure: true });
      return true;
    } catch (error) {
      return false;
    }
  }

  function setupBackendEvents() {
    setupAdminNotificationRealtime();
    syncSectionBackendEvents(state.activeSection);
  }

  function catalogScopeForSection(section) {
    return ["overview", "menu", "banner", "brand", "category", "product", "bulkPrice", "settings"].includes(section) ? "menu" : "";
  }

  function realtimeScopeForSection(section) {
    return section === "feedback" ? "feedback" : catalogScopeForSection(section);
  }

  function syncSectionBackendEvents(section) {
    const baseUrl = backendBaseUrl();
    if (!baseUrl || !window.EventSource || !els.panelShell || els.panelShell.hidden) return;
    const scope = realtimeScopeForSection(section);
    const config = {
      menu: { key: "menuEventSource", path: "/api/menu/events", event: "menu" },
      feedback: { key: "feedbackEventSource", path: "/api/feedback/events", event: "feedback" }
    }[scope];
    ["menuEventSource", "feedbackEventSource"].forEach((key) => {
      if (!state[key] || config && key === config.key) return;
      state[key].close();
      state[key] = null;
    });
    if (!config || state[config.key]) return;
    const source = new EventSource(`${baseUrl}${config.path}`, { withCredentials: true });
    state[config.key] = source;
    const handle = (event) => handleCatalogEvent(scope, event);
    source.addEventListener("ready", handle);
    source.addEventListener(config.event, handle);
    source.addEventListener("message", handle);
    // EventSource sunucunun `retry` yönergesiyle kontrollü biçimde yeniden bağlanır.
  }

  function handleCatalogEvent(scope, event) {
    let payload;
    try { payload = JSON.parse(event.data || "{}"); } catch (_error) { return; }
    if (scope === "feedback" && Array.isArray(payload.feedbackItems)) {
      state.feedbackItems = normalizeFeedbackItems(payload.feedbackItems);
      state.feedbackLoaded = true;
      state.loadedScopes.add("feedback");
      if (state.activeSection === "feedback") renderFeedbackInbox();
      return;
    }
    const incomingRevision = responseRevision(payload, scope);
    if (scope === "menu" && hasMenuContent(payload.menuState)) {
      if (state.dirtyMenu || state.saving || state.pendingPublishVerification) return;
      state.data = normalizeState(payload.menuState);
      state.scopeRevisions.menu = incomingRevision;
      state.loadedScopes.add("menu");
      if (catalogScopeForSection(state.activeSection) === scope) renderActiveSection(state.activeSection);
      return;
    }
    if (incomingRevision <= Number(state.scopeRevisions[scope] || 0) && !payload.requiresRefetch) return;
    state.loadedScopes.delete(scope);
    loadSectionScope(scope, { force: true })
      .then(() => {
        if (catalogScopeForSection(state.activeSection) === scope) renderActiveSection(state.activeSection);
      })
      .catch(() => {});
  }

  function responseRevision(result, scope) {
    const sourceValue = result && typeof result === "object" ? result : {};
    const revisions = sourceValue.revisions && typeof sourceValue.revisions === "object" ? sourceValue.revisions : {};
    const candidates = [sourceValue.revision, sourceValue[`${scope}Revision`], revisions[scope], revisions.publish];
    const found = candidates.map(Number).find((value) => Number.isSafeInteger(value) && value >= 0);
    return found == null ? Number(state.scopeRevisions[scope] || 0) : found;
  }

  async function hydrateAdminCoreFromBackend() {
    if (!backendBaseUrl()) return;
    const [publishResult, defaultsResult] = await Promise.allSettled([
      backendRequest("/api/admin/publish-state"),
      backendRequest("/api/admin/defaults")
    ]);
    if (publishResult.status === "fulfilled") {
      state.publishRevision = Number(publishResult.value.revision || 0);
      const rawPanelConfig = publishResult.value.panelConfig;
      const hasServerPanelConfig = Boolean(rawPanelConfig
        && typeof rawPanelConfig === "object"
        && !Array.isArray(rawPanelConfig)
        && Object.keys(rawPanelConfig).length);
      const serverPanelConfig = normalizePanelConfig(rawPanelConfig);
      state.publishedPanelConfigFingerprint = panelConfigFingerprint(serverPanelConfig);
      state.publishedAdminThemePresetId = serverPanelConfig.appearance.adminThemePresetId;
      const localPanelConfigFingerprint = panelConfigFingerprint(state.panelConfig);
      const hasLocalPanelDraft = safeLocalGet(PANEL_SETTINGS_DRAFT_KEY) === "1";
      if (hasLocalPanelDraft && localPanelConfigFingerprint !== state.publishedPanelConfigFingerprint) {
        state.dirtyPanelConfig = true;
        applyPanelRuntimeSettings();
        if (state.activeSection === "settings") renderPanelSettings();
        updateSaveControls("Kaydedilmiş panel taslağı yayınlanmayı bekliyor");
      } else if (!hasServerPanelConfig && localPanelConfigFingerprint !== state.publishedPanelConfigFingerprint) {
        state.dirtyPanelConfig = true;
        safeLocalSet(PANEL_SETTINGS_DRAFT_KEY, "1");
        updateSaveControls("Panel ayarları backend'e kaydedilmedi");
      } else if (!state.dirtyPanelConfig) {
        state.panelConfig = serverPanelConfig;
        safeLocalSet(PANEL_SETTINGS_KEY, JSON.stringify(state.panelConfig));
        safeLocalRemove(PANEL_SETTINGS_DRAFT_KEY);
        applyPanelRuntimeSettings();
        if (safeLocalGet(SIDEBAR_STATE_KEY) == null) setSidebarCollapsed(defaultSidebarCollapsed(), { persist: false });
        if (state.activeSection === "settings") renderPanelSettings();
      }
    }
    if (defaultsResult.status === "fulfilled") {
      const defaults = defaultsResult.value.adminDefaults || {};
      state.adminDefaults = {
        menuDesign: defaults.menuDesign ? cloneData(defaults.menuDesign) : null,
        systemSettings: defaults.systemSettings ? cloneData(defaults.systemSettings) : null
      };
      syncAdminDefaultUi();
    }
  }

  function scopesForSection(section) {
    if (Object.prototype.hasOwnProperty.call(PROCUREMENT_SECTION_VIEWS, section)) return [];
    if (section === "staffAccess") return ["staffAccess"];
    if (section === "feedback") return ["feedback"];
    return ["overview", "menu", "banner", "brand", "category", "product", "bulkPrice", "settings"].includes(section) ? ["menu"] : [];
  }

  async function ensureSectionData(section, options = {}) {
    await ensureSectionModule(section);
    const scopes = scopesForSection(section);
    await Promise.all(scopes.map((scope) => loadSectionScope(scope, options)));
    if (state.activeSection === section) renderActiveSection(section);
  }

  function ensureSectionModule(section) {
    if (Object.prototype.hasOwnProperty.call(PROCUREMENT_SECTION_VIEWS, section)) return Promise.resolve();
    if (["staffAccess", "approvals"].includes(section)) return loadScriptOnce("workforce", "scripts/workforce.js?v=20261007-requests-v6&batch=20261008-v1&approved=20261008-v1&personnel=20261008-v10&fixes=20261011-v2");
    if (["bulkPrice", "product"].includes(section)) {
      return loadScriptOnce("pricing", "scripts/pricing.js?v=20260815-performance");
    }
    return Promise.resolve();
  }

  function loadScriptOnce(key, sourceUrl) {
    if (key === "workforce" && window.__MENU_SUITE_WORKFORCE_MOUNTED__) return Promise.resolve(true);
    if (key === "pricing" && window.MenuSuitePricing) return Promise.resolve(window.MenuSuitePricing);
    if (state.modulePromises.has(key)) return state.modulePromises.get(key);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-lazy-admin-module="${key}"]`);
      if (existing && existing.dataset.loaded === "true") return resolve(true);
      const script = existing || document.createElement("script");
      script.defer = true;
      script.src = sourceUrl;
      script.dataset.lazyAdminModule = key;
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        document.dispatchEvent(new CustomEvent("menu-suite:admin-section-change", { detail: { section: state.activeSection } }));
        resolve(true);
      }, { once: true });
      script.addEventListener("error", () => reject(new Error("Bölüm modülü yüklenemedi.")), { once: true });
      if (!existing) document.head.appendChild(script);
    });
    state.modulePromises.set(key, promise);
    return promise;
  }

  function loadSectionScope(scope, options = {}) {
    if (!options.force && state.loadedScopes.has(scope)) return Promise.resolve();
    if (state.sectionLoadPromises.has(scope)) return state.sectionLoadPromises.get(scope);
    const load = (async () => {
      if (scope === "menu") {
        const result = await backendRequest("/api/menu", { skipToken: true, noDedupe: Boolean(options.force) });
        syncPublishRevision(result);
        if (hasMenuContent(result.menuState) && !state.dirtyMenu && !state.saving && !state.pendingPublishVerification) {
          state.data = normalizeState(result.menuState);
          if (result.pricing && typeof result.pricing === "object") state.data.pricing = cloneData(result.pricing);
          ensureSelection();
        }
        state.scopeRevisions.menu = responseRevision(result, "menu");
      } else if (scope === "staffAccess") {
        await hydrateRecipeAccessFromBackend();
      } else if (scope === "feedback") {
        await loadFeedbackFromBackend({ noDedupe: Boolean(options.force) });
      }
      state.loadedScopes.add(scope);
    })().finally(() => {
      if (state.sectionLoadPromises.get(scope) === load) state.sectionLoadPromises.delete(scope);
    });
    state.sectionLoadPromises.set(scope, load);
    return load;
  }

  function bindAdminNotificationEvents() {
    if (els.adminNotificationUndoRegion) els.adminNotificationUndoRegion.addEventListener("click", (event) => {
      const button = event.target.closest("[data-notification-undo]");
      if (button) undoAdminNotificationDelete(button.dataset.notificationUndo);
    });
    if (!els.adminNotificationTrigger || !els.adminNotificationDrawer) return;
    registerAdminPwaNotificationIntro();
    els.adminNotificationTrigger.addEventListener("click", openAdminNotificationDrawer);
    if (els.adminNotificationClose) els.adminNotificationClose.addEventListener("click", () => closeAdminNotificationDrawer());
    if (els.adminNotificationOverlay) els.adminNotificationOverlay.addEventListener("click", () => closeAdminNotificationDrawer());
    if (els.adminNotificationList) els.adminNotificationList.addEventListener("click", handleAdminNotificationListClick);
    if (els.adminNotificationSettingsList) els.adminNotificationSettingsList.addEventListener("click", handleAdminNotificationListClick);
    if (els.adminNotificationSettingsTabs) els.adminNotificationSettingsTabs.addEventListener("click", handleAdminNotificationSettingsTabClick);
    if (els.adminNotificationOpenDrawer) els.adminNotificationOpenDrawer.addEventListener("click", openAdminNotificationDrawer);
    if (els.adminNotificationDeliveryRefresh) els.adminNotificationDeliveryRefresh.addEventListener("click", () => loadAdminNotificationDeliveries(true));
    if (els.adminNotificationDeliveryList) els.adminNotificationDeliveryList.addEventListener("click", handleAdminNotificationDeliveryClick);
    if (els.adminNotificationRules) els.adminNotificationRules.addEventListener("change", syncAdminNotificationRuleCards);
    if (els.adminNotificationScheduleForm) els.adminNotificationScheduleForm.addEventListener("submit", saveAdminNotificationSchedule);
    if (els.adminNotificationScheduleList) els.adminNotificationScheduleList.addEventListener("click", handleAdminNotificationScheduleClick);
    if (els.adminNotificationLoadMore) els.adminNotificationLoadMore.addEventListener("click", () => loadAdminNotifications({ append: true }));
    if (els.adminNotificationReadAll) els.adminNotificationReadAll.addEventListener("click", markAllAdminNotificationsRead);
    if (els.adminNotificationArchiveRead) els.adminNotificationArchiveRead.addEventListener("click", archiveReadAdminNotifications);
    if (els.adminNotificationDeleteRead) els.adminNotificationDeleteRead.addEventListener("click", deleteReadAdminNotifications);
    if (els.adminNotificationClearArchive) els.adminNotificationClearArchive.addEventListener("click", clearAdminNotificationArchive);
    document.querySelectorAll("[data-notification-category]").forEach((button) => {
      button.addEventListener("click", () => {
        const category = String(button.dataset.notificationCategory || "all");
        state.notificationCenter.category = ["feedback", "task", "shipment", "stock", "shift", "system"].includes(category) ? category : "all";
        syncAdminNotificationFilters();
        loadAdminNotifications().catch(() => {});
      });
    });
    document.querySelectorAll("[data-notification-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const requested = String(button.dataset.notificationFilter || "all");
        state.notificationCenter.filter = ["unread", "archived"].includes(requested) ? requested : "all";
        syncAdminNotificationFilters();
        loadAdminNotifications().catch(() => {});
      });
    });
    if (els.adminNotificationSettings) {
      els.adminNotificationSettings.addEventListener("toggle", () => {
        if (!els.adminNotificationSettings.open) return;
        loadAdminNotificationPreferences().catch(() => {});
        loadAdminNotificationDeliveryHealth().catch(() => {});
        loadAdminNotificationDevices().catch(() => {});
        loadAdminNotifications().catch(() => {});
        if (state.notificationCenter.settingsTab === "schedule") loadAdminNotificationSchedules().catch(() => {});
        if (state.notificationCenter.settingsTab === "deliveries") loadAdminNotificationDeliveries().catch(() => {});
      });
    }
    if (els.adminNotificationPreferences) els.adminNotificationPreferences.addEventListener("submit", saveAdminNotificationPreferences);
    if (els.adminNotificationPreferences) {
      const quietHours = els.adminNotificationPreferences.elements.namedItem("quietHoursEnabled");
      if (quietHours) quietHours.addEventListener("change", syncAdminNotificationQuietHours);
    }
    if (els.adminNotificationPush) els.adminNotificationPush.addEventListener("click", toggleAdminPushSubscription);
    if (els.adminNotificationTest) els.adminNotificationTest.addEventListener("click", sendAdminTestNotification);
    if (els.adminNotificationDevicesRefresh) els.adminNotificationDevicesRefresh.addEventListener("click", () => loadAdminNotificationDevices(true));
    if (els.adminNotificationDevices) els.adminNotificationDevices.addEventListener("click", handleAdminNotificationDeviceClick);
    if (els.adminNotificationManageEmail) els.adminNotificationManageEmail.addEventListener("click", openAdminAccountSecurity);
    document.addEventListener("menu-suite:account-security-updated", (event) => {
      if (event.detail && event.detail.scope === "admin") loadAdminNotificationPreferences().catch(() => {});
    });
    const previewTrigger = document.querySelector("[data-global-preview-trigger]");
    if (previewTrigger) previewTrigger.addEventListener("click", () => {
      if (state.notificationCenter.open) closeAdminNotificationDrawer({ restoreFocus: false });
    });
    document.addEventListener("keydown", handleAdminNotificationKeydown);
    if (els.adminSystemHealthSettings) els.adminSystemHealthSettings.addEventListener("toggle", () => {
      if (els.adminSystemHealthSettings.open) loadAdminSystemHealth().catch(() => {});
    });
    if (els.adminSystemHealthRefresh) els.adminSystemHealthRefresh.addEventListener("click", () => loadAdminSystemHealth(true));
    resetAdminNotificationScheduleForm();
  }

  function handleAdminNotificationSettingsTabClick(event) {
    const button = event.target.closest("[data-notification-settings-tab]");
    if (!button) return;
    selectAdminNotificationSettingsTab(button.dataset.notificationSettingsTab);
  }

  function selectAdminNotificationSettingsTab(tab) {
    const selected = ["inbox", "rules", "schedule", "deliveries"].includes(tab) ? tab : "inbox";
    state.notificationCenter.settingsTab = selected;
    els.adminNotificationSettingsTabs?.querySelectorAll("[data-notification-settings-tab]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.notificationSettingsTab === selected));
    });
    document.querySelectorAll("[data-notification-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.notificationSettingsPanel !== selected;
    });
    if (selected === "inbox") loadAdminNotifications().catch(() => {});
    if (selected === "rules" || selected === "schedule") loadAdminNotificationPreferences().catch(() => {});
    if (selected === "schedule") loadAdminNotificationSchedules().catch(() => {});
    if (selected === "deliveries") Promise.allSettled([loadAdminNotificationDeliveries(), loadAdminNotificationDeliveryHealth()]);
  }

  function openAdminNotificationRule(ruleId) {
    closeAdminNotificationDrawer({ restoreFocus: false });
    state.notificationCenter.undoItems.forEach((item) => window.clearTimeout(item.timer));
    state.notificationCenter.undoItems.clear();
    state.notificationCenter.suppressedIds.clear();
    state.notificationCenter.items = [];
    renderAdminNotificationUndo();
    setActiveSection("settings", { collapseSidebar: true });
    if (els.adminNotificationSettings) els.adminNotificationSettings.open = true;
    selectAdminNotificationSettingsTab("rules");
    window.setTimeout(() => {
      const card = Array.from(els.adminNotificationRules?.querySelectorAll("[data-notification-rule-id]") || [])
        .find((item) => item.dataset.notificationRuleId === String(ruleId || ""));
      card?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      card?.querySelector("input,select")?.focus({ preventScroll: true });
    }, 80);
  }

  function registerAdminPwaNotificationIntro() {
    if (!window.MenuSuitePWA || typeof window.MenuSuitePWA.registerNotificationPrompt !== "function") return;
    window.MenuSuitePWA.registerNotificationPrompt({
      canShow: () => Boolean(els.panelShell && !els.panelShell.hidden && supportsAdminPush()),
      onEnable: async () => {
        if (!state.notificationCenter.capabilities.vapidPublicKey) await loadAdminNotificationPreferences();
        return toggleAdminPushSubscription();
      }
    });
  }

  async function initializeAdminNotifications() {
    syncAdminNotificationFilters();
    renderAdminNotifications();
    await Promise.allSettled([
      loadAdminNotificationUnreadCount(),
      loadAdminNotificationPreferences()
    ]);
  }

  function openAdminNotificationDrawer() {
    const center = state.notificationCenter;
    if (center.open || !els.adminNotificationDrawer) return;
    center.open = true;
    center.lastFocus = document.activeElement;
    closeAdminProfileMenu();
    const previewClose = document.querySelector("[data-global-preview-drawer].is-open [data-global-preview-close]");
    if (previewClose) previewClose.click();
    els.adminNotificationDrawer.inert = false;
    els.adminNotificationDrawer.setAttribute("aria-hidden", "false");
    els.adminNotificationDrawer.classList.add("is-open");
    if (els.adminNotificationOverlay) els.adminNotificationOverlay.hidden = false;
    els.adminNotificationTrigger.setAttribute("aria-expanded", "true");
    els.adminNotificationTrigger.setAttribute("aria-label", "Bildirimleri kapat");
    if (els.panelShell) els.panelShell.inert = true;
    document.body.classList.add("is-notification-drawer-open");
    window.setTimeout(() => els.adminNotificationTitle && els.adminNotificationTitle.focus(), 30);
    loadAdminNotifications().catch(() => {});
  }

  function closeAdminNotificationDrawer(options = {}) {
    const center = state.notificationCenter;
    if (!els.adminNotificationDrawer) return;
    center.open = false;
    if (els.panelShell) els.panelShell.inert = false;
    els.adminNotificationDrawer.classList.remove("is-open");
    els.adminNotificationDrawer.setAttribute("aria-hidden", "true");
    els.adminNotificationDrawer.inert = true;
    if (els.adminNotificationOverlay) els.adminNotificationOverlay.hidden = true;
    if (els.adminNotificationTrigger) {
      els.adminNotificationTrigger.setAttribute("aria-expanded", "false");
      els.adminNotificationTrigger.setAttribute("aria-label", "Bildirimleri aç");
    }
    document.body.classList.remove("is-notification-drawer-open");
    if (options.restoreFocus !== false && center.lastFocus && typeof center.lastFocus.focus === "function") {
      center.lastFocus.focus();
    }
    center.lastFocus = null;
  }

  function handleAdminNotificationKeydown(event) {
    if (!state.notificationCenter.open || !els.adminNotificationDrawer) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeAdminNotificationDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(els.adminNotificationDrawer.querySelectorAll(
      "button:not([disabled]), select:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex='-1'])"
    )).filter((node) => !node.hidden && node.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function loadAdminNotificationUnreadCount() {
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/unread-count`);
      setAdminNotificationUnreadCount(result.unreadCount ?? result.count ?? 0);
      return result;
    } catch (error) {
      if (![401, 403].includes(Number(error.status))) setAdminNotificationMessage(error.message || "Bildirim sayısı alınamadı.", "error");
      throw error;
    }
  }

  async function loadAdminNotifications(options = {}) {
    const center = state.notificationCenter;
    if (center.loading) { if (!options.append) center.reloadRequested = true; return; }
    const append = options.append === true;
    center.loading = true;
    if (els.adminNotificationList) els.adminNotificationList.setAttribute("aria-busy", "true");
    if (!append) setAdminNotificationMessage("Bildirimler yükleniyor.");
    try {
      const query = new URLSearchParams({ limit: center.filter === "archived" ? "100" : "20" });
      if (center.filter === "unread") query.set("unread", "true");
      if (center.filter === "archived") {
        query.set("includeArchived", "true");
        query.set("archived", "true");
      }
      if (center.category !== "all") query.set("category", center.category);
      if (append && center.nextCursor) query.set("cursor", center.nextCursor);
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}?${query.toString()}`);
      const listed = Array.isArray(result.notifications)
        ? result.notifications.filter((item) => !isRetiredAdminNotification(item) && !center.suppressedIds.has(String(item.id || item.notificationId)))
        : [];
      const incoming = center.filter === "archived" ? listed.filter((item) => Boolean(item && item.archivedAt)) : listed.filter((item) => !item || !item.archivedAt);
      const merged = append ? center.items.concat(incoming) : incoming;
      center.items = uniqueAdminNotifications(merged);
      center.nextCursor = String(result.nextCursor || "");
      setAdminNotificationUnreadCount(result.unreadCount ?? center.unreadCount);
      setAdminNotificationMessage("");
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirimler alınamadı.", "error");
      if (!append) center.items = [];
    } finally {
      center.loading = false;
      if (els.adminNotificationList) els.adminNotificationList.setAttribute("aria-busy", "false");
      renderAdminNotifications();
      if (center.reloadRequested) { center.reloadRequested = false; loadAdminNotifications().catch(() => {}); }
    }
  }

  function uniqueAdminNotifications(items) {
    const seen = new Set();
    return items.filter((item) => {
      const id = String(item && (item.id || item.notificationId) || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function isRetiredAdminNotification() { return false; }

  function renderAdminNotifications() {
    if (!els.adminNotificationList) return;
    const center = state.notificationCenter;
    if (center.loading && !center.items.length) {
      els.adminNotificationList.innerHTML = `<div class="admin-notification-empty"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"></path><path d="M10 21h4"></path></svg><br>Bildirimler yükleniyor...</div></div>`;
      if (els.adminNotificationSettingsList) els.adminNotificationSettingsList.innerHTML = els.adminNotificationList.innerHTML;
      return;
    }
    if (!center.items.length) {
      const label = center.filter === "unread"
        ? "Okunmamış bildiriminiz yok."
        : center.filter === "archived" ? "Arşivlenmiş bildiriminiz yok." : "Henüz bildiriminiz yok.";
      els.adminNotificationList.innerHTML = `<div class="admin-notification-empty"><div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"></path><path d="M9 17a3 3 0 0 0 6 0"></path></svg><br>${escapeHTML(label)}</div></div>`;
    } else {
      els.adminNotificationList.innerHTML = center.items.map(renderAdminNotificationCard).join("");
    }
    if (els.adminNotificationLoadMore) els.adminNotificationLoadMore.hidden = !center.nextCursor;
    if (els.adminNotificationReadAll) {
      els.adminNotificationReadAll.hidden = center.filter === "archived";
      els.adminNotificationReadAll.disabled = center.unreadCount < 1 || center.loading || center.filter === "archived";
    }
    if (els.adminNotificationArchiveRead) els.adminNotificationArchiveRead.hidden = center.filter === "archived";
    if (els.adminNotificationDeleteRead) els.adminNotificationDeleteRead.hidden = center.filter === "unread";
    if (els.adminNotificationClearArchive) {
      els.adminNotificationClearArchive.hidden = center.filter !== "archived";
      els.adminNotificationClearArchive.disabled = center.loading || !center.items.length;
    }
    if (els.adminNotificationSettingsList) {
      const settingsItems = center.items.slice(0, 8);
      els.adminNotificationSettingsList.innerHTML = settingsItems.length
        ? settingsItems.map(renderAdminNotificationCard).join("")
        : '<div class="admin-notification-empty">Bu filtrede bildirim bulunmuyor.</div>';
    }
  }

  function renderAdminNotificationCard(notification) {
    const id = String(notification.id || notification.notificationId || "");
    const category = normalizeAdminNotificationCategory(notification.category || notification.type || notification.kind);
    const severity = normalizeAdminNotificationSeverity(notification.severity);
    const read = adminNotificationIsRead(notification);
    const title = notification.title || notification.subject || adminNotificationCategoryLabel(category);
    const body = notification.body || notification.message || notification.description || "Bildirim ayrıntısını açın.";
    const createdAt = notification.createdAt || notification.timestamp || notification.sentAt;
    const busy = state.notificationCenter.mutationKeys.has(`notification:${id}`);
    return `
      <article class="admin-notification-card is-${escapeAttribute(severity)} ${read ? "" : "is-unread"}" data-notification-id="${escapeAttribute(id)}" data-severity="${escapeAttribute(severity)}">
        <button type="button" class="admin-notification-row-open" data-notification-open="${escapeAttribute(id)}" ${busy ? "disabled" : ""}>
          <span class="admin-notification-kind" data-kind="${escapeAttribute(category)}" aria-hidden="true">${adminNotificationIcon(category)}</span>
          <span class="admin-notification-copy">
            <strong>${escapeHTML(title)}</strong>
            <span class="admin-notification-body">${escapeHTML(body)}</span>
            <time datetime="${escapeAttribute(createdAt || "")}">${escapeHTML(formatAdminNotificationTime(createdAt))}</time>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"></path></svg>
        </button>
        <div class="admin-notification-actions">
          <button type="button" data-notification-action="delete" data-notification-id="${escapeAttribute(id)}" aria-label="${escapeAttribute(title)} bildirimini sil" title="Bildirimi sil" ${busy ? "disabled" : ""}>${adminNotificationIcon("delete")}</button>
        </div>
      </article>`;
  }

  function adminNotificationIcon(kind) {
    const icons = {
      task: `<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="m8 9 1.5 1.5L12 8M8 15h8"></path></svg>`,
      shift: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18M12 13v4l3 1"></path></svg>`,
      system: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16h.01"></path></svg>`,
      feedback: `<svg viewBox="0 0 24 24"><path d="M4 4h16v13H9l-5 4z"></path><path d="M8 9h8M8 13h5"></path></svg>`,
      shipment: `<svg viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z"></path><circle cx="7" cy="18" r="2"></circle><circle cx="18" cy="18" r="2"></circle></svg>`,
      stock: `<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"></path></svg>`,
      materialRequest: `<svg viewBox="0 0 24 24"><path d="M6 3h12a2 2 0 0 1 2 2v16l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2z"></path><path d="M8 8h8M8 12h6"></path></svg>`,
      read: `<svg viewBox="0 0 24 24"><path d="M4 12.5 9 17l11-11"></path></svg>`,
      unread: `<svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM4 7l8 6 8-6"></path></svg>`,
      archive: `<svg viewBox="0 0 24 24"><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"></path></svg>`,
      restore: `<svg viewBox="0 0 24 24"><path d="M4 8h16v12H4zM3 4h18v4H3zM8 14h8M11 11l-3 3 3 3"></path></svg>`,
      delete: `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>`
    };
    return icons[kind] || icons.system;
  }

  function normalizeAdminNotificationCategory(value) {
    const text = String(value || "system").toLocaleLowerCase("tr-TR");
    if (text === "feedback") return "feedback";
    if (/task|görev|todo|assignment|reminder.*task/.test(text)) return "task";
    if (/shipment|sevkiyat|teslimat|dispatch/.test(text)) return "shipment";
    if (/stock|stok|inventory|envanter/.test(text)) return "stock";
    if (/material.?request|malzeme.?talep/.test(text)) return "materialRequest";
    if (/shift|vardiya|izin/.test(text)) return "shift";
    return "system";
  }

  function adminNotificationCategoryLabel(category) {
    return { feedback: "Dilek & Şikayet", task: "Yapılacaklar", shipment: "Sevkiyat", stock: "Stok", materialRequest: "Malzeme Talebi", shift: "Vardiya", system: "Sistem" }[category] || "Sistem";
  }

  function normalizeAdminNotificationSeverity(value) {
    return ["info", "success", "warning", "critical"].includes(value) ? value : "info";
  }

  function adminNotificationSeverityLabel(severity) {
    return { info: "Bilgi", success: "Başarılı", warning: "Uyarı", critical: "Kritik" }[severity] || "Bilgi";
  }

  function formatAdminNotificationTime(value) {
    const timestamp = new Date(value || 0).getTime();
    if (!Number.isFinite(timestamp) || timestamp <= 0) return "Az önce";
    const seconds = Math.round((timestamp - Date.now()) / 1000);
    const absolute = Math.abs(seconds);
    const units = absolute < 60 ? [seconds, "second"]
      : absolute < 3600 ? [Math.round(seconds / 60), "minute"]
        : absolute < 86400 ? [Math.round(seconds / 3600), "hour"]
          : absolute < 604800 ? [Math.round(seconds / 86400), "day"] : null;
    if (!units || typeof Intl.RelativeTimeFormat !== "function") return formatDateTime(value) || "Az önce";
    return new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" }).format(units[0], units[1]);
  }

  function adminNotificationIsRead(notification) {
    return Boolean(notification.read === true || notification.readAt || String(notification.status || "").toLowerCase() === "read");
  }

  function setAdminNotificationUnreadCount(value) {
    const count = Math.max(0, Number(value || 0));
    state.notificationCenter.unreadCount = count;
    if (els.adminNotificationBadge) {
      els.adminNotificationBadge.hidden = count < 1;
      els.adminNotificationBadge.textContent = count > 99 ? "99+" : String(count);
      els.adminNotificationBadge.setAttribute("aria-label", `${count} okunmamış bildirim`);
    }
    if (els.adminNotificationSummary) {
      els.adminNotificationSummary.textContent = count ? `${count} yeni bildirim` : "Yeni bildirim yok";
    }
    if (els.adminNotificationReadAll) els.adminNotificationReadAll.disabled = count < 1 || state.notificationCenter.filter === "archived";
  }

  function setAdminNotificationMessage(message, tone = "") {
    if (!els.adminNotificationMessage) return;
    els.adminNotificationMessage.textContent = message || "";
    if (tone) els.adminNotificationMessage.dataset.tone = tone;
    else delete els.adminNotificationMessage.dataset.tone;
  }

  function syncAdminNotificationFilters() {
    document.querySelectorAll("[data-notification-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.notificationFilter === state.notificationCenter.filter));
    });
    document.querySelectorAll("[data-notification-category]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.notificationCategory === state.notificationCenter.category));
    });
    if (els.adminNotificationReadAll) els.adminNotificationReadAll.hidden = state.notificationCenter.filter === "archived";
    if (els.adminNotificationArchiveRead) els.adminNotificationArchiveRead.hidden = state.notificationCenter.filter === "archived";
    if (els.adminNotificationDeleteRead) els.adminNotificationDeleteRead.hidden = state.notificationCenter.filter === "unread";
    if (els.adminNotificationClearArchive) els.adminNotificationClearArchive.hidden = state.notificationCenter.filter !== "archived";
  }

  async function handleAdminNotificationListClick(event) {
    const ruleButton = event.target.closest("[data-notification-rule-edit]");
    if (ruleButton) {
      openAdminNotificationRule(ruleButton.dataset.notificationRuleEdit);
      return;
    }
    const actionButton = event.target.closest("[data-notification-action]");
    if (actionButton) {
      await mutateAdminNotification(actionButton.dataset.notificationId, actionButton.dataset.notificationAction, actionButton);
      return;
    }
    const openButton = event.target.closest("[data-notification-open]");
    if (!openButton) return;
    const notification = state.notificationCenter.items.find((item) => String(item.id || item.notificationId) === openButton.dataset.notificationOpen);
    if (!notification) return;
    if (!adminNotificationIsRead(notification)) {
      const updated = await mutateAdminNotification(openButton.dataset.notificationOpen, "read", openButton, { refresh: false });
      if (!updated) return;
    }
    followAdminNotificationDeepLink(notification);
  }

  async function mutateAdminNotification(id, action, button, options = {}) {
    const center = state.notificationCenter;
    if (!["read", "unread", "archive", "restore", "delete"].includes(action)) return false;
    const key = `notification:${id}`;
    if (!id || center.mutationKeys.has(key)) return false;
    center.mutationKeys.add(key);
    if (button) button.disabled = true;
    setAdminNotificationMessage("İşlem uygulanıyor.");
    try {
      const path = action === "delete"
        ? `${ADMIN_NOTIFICATION_API}/${encodeURIComponent(id)}`
        : `${ADMIN_NOTIFICATION_API}/${encodeURIComponent(id)}/${action}`;
      const result = await backendRequest(path, action === "delete" ? { method: "DELETE" } : { method: "PATCH", body: {} });
      if (action === "delete") {
        center.suppressedIds.add(String(id));
        offerAdminNotificationUndo([String(id)]);
      }
      if (result.notification) {
        center.items = center.items.map((item) => String(item.id || item.notificationId) === String(id) ? result.notification : item);
      }
      if (["archive", "restore", "delete"].includes(action)) center.items = center.items.filter((item) => String(item.id || item.notificationId) !== String(id));
      setAdminNotificationUnreadCount(result.unreadCount ?? center.unreadCount);
      const message = {
        archive: "Bildirim arşivlendi.",
        restore: "Bildirim gelen kutusuna geri yüklendi.",
        delete: "Bildirim silindi."
      }[action] || "Bildirim durumu güncellendi.";
      setAdminNotificationMessage(message, "success");
      if (options.refresh !== false) await loadAdminNotifications();
      else renderAdminNotifications();
      return true;
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim güncellenemedi.", "error");
      return false;
    } finally {
      center.mutationKeys.delete(key);
      if (button && button.isConnected) button.disabled = false;
    }
  }

  async function clearAdminNotificationArchive() {
    const button = els.adminNotificationClearArchive;
    if (!button || button.disabled || !window.confirm("Arşivdeki tüm bildirimler kalıcı olarak silinsin mi?")) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Temizleniyor...";
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/archive`, { method: "DELETE" });
      state.notificationCenter.items = [];
      state.notificationCenter.nextCursor = "";
      setAdminNotificationUnreadCount(result.unreadCount ?? state.notificationCenter.unreadCount);
      setAdminNotificationMessage(`${Number(result.deletedCount || 0)} arşiv kaydı kalıcı olarak silindi.`, "success");
      renderAdminNotifications();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim arşivi temizlenemedi.", "error");
    } finally {
      button.textContent = previous;
      button.disabled = state.notificationCenter.loading || !state.notificationCenter.items.length;
    }
  }

  async function archiveReadAdminNotifications() {
    const button = els.adminNotificationArchiveRead;
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/archive-read`, { method: "POST", body: {} });
      setAdminNotificationUnreadCount(result.unreadCount ?? state.notificationCenter.unreadCount);
      setAdminNotificationMessage(`${Number(result.updatedCount || 0)} okunmuş bildirim arşivlendi.`, "success");
      await loadAdminNotifications();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Okunmuş bildirimler arşivlenemedi.", "error");
    } finally {
      button.disabled = false;
    }
  }

  async function deleteReadAdminNotifications() {
    const button = els.adminNotificationDeleteRead;
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/read?recoverable=1`, { method: "DELETE" });
      const ids = Array.isArray(result.deletedIds) ? result.deletedIds.map(String) : [];
      ids.forEach((id) => state.notificationCenter.suppressedIds.add(id));
      state.notificationCenter.items = state.notificationCenter.items.filter((item) => !ids.includes(String(item.id || item.notificationId)));
      if (ids.length) offerAdminNotificationUndo(ids);
      setAdminNotificationUnreadCount(result.unreadCount ?? state.notificationCenter.unreadCount);
      setAdminNotificationMessage(`${Number(result.deletedCount || 0)} okunmuş bildirim silindi.`, "success");
      await loadAdminNotifications();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Okunmuş bildirimler silinemedi.", "error");
    } finally {
      button.disabled = false;
    }
  }

  function renderAdminNotificationUndo() {
    if (!els.adminNotificationUndoRegion) return;
    els.adminNotificationUndoRegion.innerHTML = Array.from(state.notificationCenter.undoItems.entries()).map(([key, item]) =>
      `<div><span>${item.ids.length} bildirim silindi.</span><button type="button" class="ghost" data-notification-undo="${escapeAttribute(key)}" ${item.busy ? "disabled" : ""}>Geri al</button></div>`
    ).join("");
  }

  function offerAdminNotificationUndo(ids) {
    const center = state.notificationCenter;
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item = { ids: [...new Set(ids)], busy: false, timer: null };
    item.timer = window.setTimeout(() => { center.undoItems.delete(key); renderAdminNotificationUndo(); }, 10000);
    center.undoItems.set(key, item);
    renderAdminNotificationUndo();
  }

  async function undoAdminNotificationDelete(key) {
    const center = state.notificationCenter;
    const item = center.undoItems.get(key);
    if (!item || item.busy) return;
    item.busy = true;
    window.clearTimeout(item.timer);
    renderAdminNotificationUndo();
    try {
      while (item.ids.length) {
        const ids = item.ids.slice(0, 100);
        const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/undo-delete`, { method: "POST", body: { ids } });
        ids.forEach((id) => center.suppressedIds.delete(id));
        item.ids.splice(0, ids.length);
        setAdminNotificationUnreadCount(result.unreadCount ?? center.unreadCount);
      }
      center.undoItems.delete(key);
      setAdminNotificationMessage("Bildirimler geri alındı.", "success");
      await loadAdminNotifications();
      if (center.open) els.adminNotificationClose.focus();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Silme geri alınamadı.", "error");
      item.busy = false;
      item.timer = window.setTimeout(() => { center.undoItems.delete(key); renderAdminNotificationUndo(); }, 10000);
    } finally { renderAdminNotificationUndo(); }
  }

  async function markAllAdminNotificationsRead() {
    const button = els.adminNotificationReadAll;
    if (!button || button.disabled) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Güncelleniyor...";
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/read-all`, { method: "POST", body: {} });
      setAdminNotificationUnreadCount(result.unreadCount ?? 0);
      setAdminNotificationMessage("Tüm bildirimler okundu olarak işaretlendi.", "success");
      await loadAdminNotifications();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirimler güncellenemedi.", "error");
    } finally {
      button.textContent = previous;
      button.disabled = state.notificationCenter.unreadCount < 1;
    }
  }

  function followAdminNotificationDeepLink(notification) {
    const details = notification.data || notification.metadata || notification.context || {};
    const rawLink = String(notification.deepLink || notification.actionUrl || notification.url || details.deepLink || details.url || "").trim();
    let section = normalizeAdminNotificationSection(notification.section || details.section || "") || "overview";
    let feedbackId = String(notification.entityType === "feedback" && notification.entityId || details.feedbackId || details.sourceId || "").trim().slice(0, 180);
    const category = normalizeAdminNotificationCategory(notification.category);
    let workforceTarget = String(details.workforce || details.panel || "").trim().toLowerCase();
    let entityId = String(notification.entityId || details.entityId || details.taskId || details.requestId || "").trim().slice(0, 180);
    let productId = String(details.productId || "").slice(0, 180);
    let locationId = String(details.locationId || "").slice(0, 180);
    if (rawLink) {
      try {
        const target = new URL(rawLink, window.location.href);
        if (target.origin === window.location.origin && /^\/(?:muhasebe|fatura)(?:\/|$)/i.test(target.pathname)) {
          const legacyView = String(target.searchParams.get("view") || "").trim();
          const legacySections = {
            dashboard: "suppliers", suppliers: "suppliers", supplierProducts: "supplierProducts",
            receipts: "receipts", documents: "documents", invoices: "invoices",
            deliveryNotes: "deliveryNotes", gallery: "documentGallery", shipments: "shipmentArchive",
            ledger: "ledger", payments: "payments", trash: "trash", access: "procurementAccess",
            audit: "procurementAudit", stock: "product"
          };
          section = legacySections[legacyView] || section;
          entityId = String(
            target.searchParams.get("entityId") || target.searchParams.get("shipmentId")
            || target.searchParams.get("supplierId") || target.searchParams.get("documentId") || entityId
          ).trim().slice(0, 180);
        }
        if (target.origin === window.location.origin && (target.pathname === "/yonetici" || target.pathname.startsWith("/yonetici/"))) {
          section = normalizeAdminNotificationSection(target.searchParams.get("section")) || section;
          feedbackId = String(target.searchParams.get("feedbackId") || feedbackId).trim().slice(0, 180);
          workforceTarget = String(target.searchParams.get("workforce") || target.searchParams.get("panel") || workforceTarget).trim().toLowerCase();
          entityId = String(target.searchParams.get("entityId") || target.searchParams.get("taskId") || target.searchParams.get("requestId") || entityId).trim().slice(0, 180);
          const hashSection = target.hash ? normalizeAdminNotificationSection(decodeURIComponent(target.hash.slice(1))) : "";
          productId = String(target.searchParams.get("productId") || productId).slice(0, 180);
          locationId = String(target.searchParams.get("locationId") || locationId).slice(0, 180);
          section = hashSection || section;
        }
      } catch (_error) {}
    }
    if (!workforceTarget) workforceTarget = { task: "tasks", shift: "shifts", materialRequest: "materialrequests", materialrequest: "materialrequests", "material-request": "materialrequests" }[category] || "";
    if (workforceTarget === "task") workforceTarget = "tasks";
    if (workforceTarget === "shift") workforceTarget = "shifts";
    if (["materialrequest", "material-request", "materialrequests"].includes(workforceTarget)) workforceTarget = "materialrequests";
    const workforceNavigation = resolveWorkforceNavigation(section, workforceTarget, entityId);
    section = workforceNavigation.section;
    workforceTarget = workforceNavigation.target;
    state.pendingNotificationTarget = null;
    if (category === "stock" && productId) {
      section = "barcode"; workforceTarget = "";
      state.pendingNotificationTarget = { productId, locationId };
    } else if (category === "shipment" && entityId) {
      section = "procurementDocuments"; workforceTarget = "";
      state.pendingNotificationTarget = { shipmentId: entityId };
    }
    if (feedbackId) {
      section = "feedback";
      state.focusedFeedbackId = feedbackId;
      state.feedbackFilter = "all";
    }
    closeAdminNotificationDrawer();
    state.pendingProcurementDocumentId = section === "procurementDocuments" && notification.entityType === "document" ? entityId : "";
    replaceAdminNavigationQuery(section, feedbackId, workforceTarget, entityId);
    setActiveSection(section, { collapseSidebar: true });
    revealAdminNavigationTarget(section, workforceTarget, entityId);
    document.dispatchEvent(new CustomEvent("menu-suite:admin-notification-open", {
      detail: { notification: cloneData(notification), category, section, feedbackId, workforce: workforceTarget, entityId }
    }));
  }

  function replaceAdminNavigationQuery(section, feedbackId = "", workforceTarget = "", entityId = "") {
    try {
      const target = new URL(window.location.href);
      target.searchParams.set("section", section);
      if (feedbackId) target.searchParams.set("feedbackId", feedbackId);
      else target.searchParams.delete("feedbackId");
      if (workforceTarget) target.searchParams.set("workforce", workforceTarget);
      else target.searchParams.delete("workforce");
      if (entityId && workforceTarget) target.searchParams.set("entityId", entityId);
      else target.searchParams.delete("entityId");
      target.searchParams.delete("panel");
      const hashSection = target.hash ? normalizeAdminNotificationSection(decodeURIComponent(target.hash.slice(1))) : "";
      if (hashSection && hashSection !== section) target.hash = "";
      window.history.replaceState(null, "", `${target.pathname}${target.search}${target.hash}`);
    } catch (_error) {}
  }

  function normalizeAdminNotificationSection(value) {
    const direct = normalizePanelSection(String(value || ""));
    if (direct) return direct;
    const alias = String(value || "").trim().toLocaleLowerCase("tr-TR");
    if (["personel", "personnel", "staff", "staffaccess", "staffaccesscard", "tasks", "shifts", "materialrequest", "materialrequests", "material-request"].includes(alias)) return "staffAccess";
    if (["genel-bakis", "genelbakis", "dashboard", "home"].includes(alias)) return "overview";
    return "";
  }

  function revealAdminNavigationTarget(section, workforceTarget, entityId) {
    const targetKind = String(workforceTarget || "").toLowerCase();
    if (!targetKind) return;
    ensureSectionModule(section).then(() => {
      let attempts = 0;
      const reveal = () => {
        attempts += 1;
        let accordion = null;
        if (section === "approvals" && ["materialrequest", "material-request", "materialrequests"].includes(targetKind)) {
          accordion = document.getElementById("workforceMaterialRequestsAccordion");
        } else if (section === "approvals" && ["shifts", "leaverequests"].includes(targetKind)) {
          accordion = document.getElementById("workforceLeaveRequestsAccordion");
        } else if (section === "staffAccess" && targetKind === "tasks") {
          accordion = document.getElementById("workforceTasksAccordion");
        } else if (section === "staffAccess" && targetKind === "shifts") {
          accordion = document.getElementById("workforceShiftsAccordion");
        }
        if (accordion && !accordion.open) accordion.open = true;
        if (!entityId) return;
        const escapedId = window.CSS && typeof window.CSS.escape === "function" ? window.CSS.escape(entityId) : entityId.replace(/["\\]/g, "\\$&");
        const entity = document.querySelector(`[data-task-detail="${escapedId}"], [data-request-inspect="${escapedId}"]`);
        if (entity) {
          entity.click();
          entity.focus({ preventScroll: true });
          entity.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          return;
        }
        if (attempts < 20) window.setTimeout(reveal, 100);
        else void adminNotice("Bu bildirimdeki kayıt kaldırılmış veya artık erişilemiyor.");
      };
      window.setTimeout(reveal, 0);
    }).catch((error) => updateSaveControls(error.message || "Bölüm modülü yüklenemedi"));
  }

  async function loadAdminNotificationPreferences() {
    const center = state.notificationCenter;
    if (center.preferencesLoading) return;
    center.preferencesLoading = true;
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/preferences`);
      center.preferences = result.preferences && typeof result.preferences === "object" ? result.preferences : {};
      center.capabilities = result.capabilities && typeof result.capabilities === "object" ? result.capabilities : {};
      center.personnelOptions = Array.isArray(result.personnelOptions) ? result.personnelOptions : [];
      renderAdminNotificationPreferences();
      await syncAdminPushSubscriptionState();
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim ayarları alınamadı.", "error");
    } finally {
      center.preferencesLoading = false;
    }
  }

  function renderAdminNotificationPreferences() {
    const form = els.adminNotificationPreferences;
    if (!form) return;
    const preferences = state.notificationCenter.preferences || {};
    const channels = preferences.channels || {};
    setNotificationPreferenceInput(form, "inAppEnabled", preferences.inAppEnabled ?? channels.inApp ?? channels.in_app ?? true);
    setNotificationPreferenceInput(form, "emailEnabled", preferences.emailEnabled ?? channels.email ?? false);
    setNotificationPreferenceInput(form, "pushEnabled", preferences.pushEnabled ?? channels.push ?? false);
    const email = form.elements.namedItem("emailAddress");
    if (email) {
      email.value = String(preferences.emailAddress || "");
      email.readOnly = true;
      email.setAttribute("aria-readonly", "true");
    }
    const emailEnabled = form.elements.namedItem("emailEnabled");
    if (emailEnabled) {
      emailEnabled.disabled = !preferences.emailVerified;
      if (!preferences.emailVerified) emailEnabled.checked = false;
      emailEnabled.title = preferences.emailVerified ? "" : "Önce hesap e-postanızı doğrulayın.";
    }
    setNotificationPreferenceInput(form, "quietHoursEnabled", preferences.quietHoursEnabled === true);
    const quietStart = form.elements.namedItem("quietHoursStart");
    const quietEnd = form.elements.namedItem("quietHoursEnd");
    if (quietStart) quietStart.value = String(preferences.quietHoursStart || "22:00");
    if (quietEnd) quietEnd.value = String(preferences.quietHoursEnd || "08:00");
    syncAdminNotificationQuietHours();
    const pushSupported = state.notificationCenter.capabilities.pushSupported !== false
      && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (els.adminNotificationPush) {
      els.adminNotificationPush.disabled = !pushSupported;
      if (!pushSupported) els.adminNotificationPush.textContent = "Anlık bildirim desteklenmiyor";
    }
    renderAdminNotificationRules(preferences.rules);
  }

  function renderAdminNotificationRules(rules) {
    const items = Array.isArray(rules) ? rules : [];
    const personnel = Array.isArray(state.notificationCenter.personnelOptions) ? state.notificationCenter.personnelOptions : [];
    if (els.adminNotificationRules) {
      els.adminNotificationRules.innerHTML = items.length ? items.map((rule) => {
        const recipients = Array.isArray(rule.allowedRecipientModes) ? rule.allowedRecipientModes : [rule.recipientMode || "manager"];
        const recipientOptions = recipients.map((value) => `<option value="${escapeAttribute(value)}" ${value === rule.recipientMode ? "selected" : ""}>${escapeHTML(notificationRecipientModeLabel(value))}</option>`).join("");
        const channels = rule.channels || {};
        const quiet = rule.quietHours || {};
        const requiredSection = rule.category === "task" ? "tasks" : rule.category === "shift" ? "shift" : "recipe";
        const eligiblePersonnel = personnel.filter((item) => item.personelSectionAccess?.[requiredSection] !== false);
        const selectedIds = new Set(Array.isArray(rule.selectedPersonnelIds) ? rule.selectedPersonnelIds.map(String) : []);
        const personnelChoices = eligiblePersonnel.length
          ? eligiblePersonnel.map((item) => `<label><input type="checkbox" data-rule-personnel-id="${escapeAttribute(item.id)}" ${selectedIds.has(String(item.id)) ? "checked" : ""}> <span>${escapeHTML(item.name || item.username || "Personel")}</span></label>`).join("")
          : '<small>Bu kural için yetkili aktif personel bulunmuyor.</small>';
        return `<article class="admin-notification-rule ${rule.enabled ? "" : "is-disabled"}" data-notification-rule-id="${escapeAttribute(rule.id || "")}">
          <header class="admin-notification-rule__head"><div><strong>${escapeHTML(rule.label || rule.id || "Bildirim kuralı")}</strong><small>${rule.timed ? "Zamanlı hatırlatma · varsayılan kapalı" : "İşlem gerektiren olay"}</small></div><label><input type="checkbox" data-rule-field="enabled" ${rule.enabled ? "checked" : ""}> Etkin</label></header>
          <div class="admin-notification-rule__grid">
            <label>Alıcı<select data-rule-field="recipientMode">${recipientOptions}</select></label>
            <label>Zamanlama<select data-rule-field="timing"><option value="immediate" ${rule.timing === "immediate" ? "selected" : ""}>Anında</option><option value="daily" ${rule.timing === "daily" ? "selected" : ""}>Günlük özet</option><option value="weekly" ${rule.timing === "weekly" ? "selected" : ""}>Haftalık özet</option><option value="off" ${rule.timing === "off" ? "selected" : ""}>Kapalı</option></select></label>
            <label>Günlük sınır<input type="number" min="1" max="500" data-rule-field="dailyLimit" value="${escapeAttribute(rule.dailyLimit || 50)}"></label>
            <label>Tekrar aralığı (dk)<input type="number" min="0" max="10080" data-rule-field="repeatIntervalMinutes" value="${escapeAttribute(rule.repeatIntervalMinutes || 0)}"></label>
            <label>Azami tekrar<input type="number" min="0" max="50" data-rule-field="repeatMax" value="${escapeAttribute(rule.repeatMax || 0)}"></label>
            <label data-rule-schedule-field>Saat<input type="time" data-rule-field="scheduleTime" value="${escapeAttribute(rule.scheduleTime || "09:00")}"></label>
            <label data-rule-weekly-field>Haftanın günü<select data-rule-field="weeklyDay">${[[1,"Pazartesi"],[2,"Salı"],[3,"Çarşamba"],[4,"Perşembe"],[5,"Cuma"],[6,"Cumartesi"],[7,"Pazar"]].map(([value,label]) => `<option value="${value}" ${Number(rule.weeklyDay || 1) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
            <label>Saat dilimi<input type="text" data-rule-field="timezone" value="${escapeAttribute(rule.timezone || "Europe/Istanbul")}" autocomplete="off"></label>
          </div>
          <fieldset class="admin-notification-rule__personnel" data-rule-selected-personnel><legend>Seçili personel</legend>${personnelChoices}</fieldset>
          <div class="admin-notification-rule__channels" aria-label="Teslim kanalları">
            ${["inApp", "push", "email", "sound"].map((channel) => `<label><input type="checkbox" data-rule-channel="${channel}" ${channels[channel] ? "checked" : ""}> ${notificationChannelLabel(channel)}</label>`).join("")}
            <label><input type="checkbox" data-rule-field="mergeSimilar" ${rule.mergeSimilar !== false ? "checked" : ""}> Benzerleri birleştir</label>
            <label><input type="checkbox" data-rule-field="quietEnabled" ${quiet.enabled ? "checked" : ""}> Sessiz saat</label>
            <label>Başlangıç <input type="time" data-rule-field="quietStart" value="${escapeAttribute(quiet.start || "22:00")}"></label>
            <label>Bitiş <input type="time" data-rule-field="quietEnd" value="${escapeAttribute(quiet.end || "08:00")}"></label>
          </div>
          <small>${rule.nextScheduledAt ? `Sonraki plan: ${escapeHTML(formatDateTime(rule.nextScheduledAt))}` : "Sonraki plan: yok"}</small>
        </article>`;
      }).join("") : '<div class="admin-notification-empty">Bildirim kuralları yüklenemedi.</div>';
      syncAdminNotificationRuleCards();
    }
    renderAdminNotificationSchedule(items);
  }

  function notificationRecipientModeLabel(value) {
    return { manager: "Yönetici", event_recipient: "Olaydaki personel", all_active_personnel: "Tüm aktif personel", selected_personnel: "Seçili personel" }[value] || value;
  }

  function notificationChannelLabel(value) {
    return { inApp: "Panel içi", push: "Push", email: "E-posta", sound: "Panel içi bildirim sesi" }[value] || value;
  }

  function syncAdminNotificationRuleCards(event) {
    const changed = event && event.target;
    const card = changed && changed.closest("[data-notification-rule-id]");
    if (card && changed.matches('[data-rule-field="enabled"]') && changed.checked) {
      const timing = card.querySelector('[data-rule-field="timing"]');
      if (timing && timing.value === "off") timing.value = "immediate";
    }
    if (card && changed?.matches('[data-rule-field="timing"]') && changed.value === "off") {
      const enabled = card.querySelector('[data-rule-field="enabled"]');
      if (enabled) enabled.checked = false;
    }
    (card ? [card] : Array.from(els.adminNotificationRules?.querySelectorAll("[data-notification-rule-id]") || [])).forEach((item) => {
      const enabled = Boolean(item.querySelector('[data-rule-field="enabled"]')?.checked);
      const timing = String(item.querySelector('[data-rule-field="timing"]')?.value || "off");
      const recipientMode = String(item.querySelector('[data-rule-field="recipientMode"]')?.value || "");
      item.classList.toggle("is-disabled", !enabled);
      const personnelField = item.querySelector("[data-rule-selected-personnel]");
      if (personnelField) personnelField.hidden = recipientMode !== "selected_personnel";
      item.querySelectorAll("[data-rule-schedule-field]").forEach((field) => { field.hidden = !["daily", "weekly"].includes(timing); });
      item.querySelectorAll("[data-rule-weekly-field]").forEach((field) => { field.hidden = timing !== "weekly"; });
      ["repeatIntervalMinutes", "repeatMax"].forEach((field) => {
        const input = item.querySelector(`[data-rule-field="${field}"]`);
        if (input) input.disabled = !enabled || timing !== "immediate";
      });
    });
  }

  function collectAdminNotificationRules() {
    return Array.from(els.adminNotificationRules?.querySelectorAll("[data-notification-rule-id]") || []).map((card) => {
      const value = (field, fallback = "") => String(card.querySelector(`[data-rule-field="${field}"]`)?.value || fallback);
      const checked = (field) => Boolean(card.querySelector(`[data-rule-field="${field}"]`)?.checked);
      const channel = (name) => Boolean(card.querySelector(`[data-rule-channel="${name}"]`)?.checked);
      return {
        id: card.dataset.notificationRuleId,
        enabled: checked("enabled"),
        recipientMode: value("recipientMode"),
        selectedPersonnelIds: Array.from(card.querySelectorAll("[data-rule-personnel-id]:checked")).map((input) => String(input.dataset.rulePersonnelId || "")).filter(Boolean),
        timing: checked("enabled") ? value("timing", "immediate") : "off",
        channels: { inApp: channel("inApp"), push: channel("push"), email: channel("email"), sound: channel("sound") },
        dailyLimit: Number(value("dailyLimit", "50")),
        repeatIntervalMinutes: Number(value("repeatIntervalMinutes", "0")),
        repeatMax: Number(value("repeatMax", "0")),
        mergeSimilar: checked("mergeSimilar"),
        quietHours: { enabled: checked("quietEnabled"), start: value("quietStart", "22:00"), end: value("quietEnd", "08:00") },
        timezone: value("timezone", "Europe/Istanbul"),
        scheduleTime: value("scheduleTime", "09:00"),
        weeklyDay: Number(value("weeklyDay", "1"))
      };
    });
  }

  function renderAdminNotificationSchedule(rules) {
    if (!els.adminNotificationRuleSchedule) return;
    const items = (Array.isArray(rules) ? rules : []).filter((rule) => rule && rule.timed);
    els.adminNotificationRuleSchedule.innerHTML = items.length ? items.map((rule) => `<article class="admin-notification-schedule-card">
      <div><strong>${escapeHTML(rule.label || rule.id)}</strong><small>${rule.enabled ? `${escapeHTML(rule.timing)} · sonraki: ${escapeHTML(formatDateTime(rule.nextScheduledAt) || "olay zamanında")}` : "Kapalı · yönetici açıkça etkinleştirmedi"}</small></div>
      <button type="button" class="ui-button ui-button--ghost ui-button--sm" data-schedule-rule-edit="${escapeAttribute(rule.id)}">Kuralı düzenle</button>
    </article>`).join("") : '<div class="admin-notification-empty">Zamanlı kural bulunmuyor.</div>';
    els.adminNotificationRuleSchedule.querySelectorAll("[data-schedule-rule-edit]").forEach((button) => button.addEventListener("click", () => openAdminNotificationRule(button.dataset.scheduleRuleEdit)));
  }

  async function loadAdminNotificationSchedules() {
    const center = state.notificationCenter;
    if (center.schedulesLoading) return;
    center.schedulesLoading = true;
    if (els.adminNotificationScheduleList && !center.scheduledNotifications.length) {
      els.adminNotificationScheduleList.innerHTML = '<div class="admin-notification-empty">Zamanlamalar yükleniyor...</div>';
    }
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/schedules`, { noDedupe: true });
      center.scheduledNotifications = Array.isArray(result.schedules) ? result.schedules : [];
      renderAdminNotificationSchedules();
    } catch (error) {
      if (els.adminNotificationScheduleList) {
        els.adminNotificationScheduleList.innerHTML = `<div class="admin-notification-empty">${escapeHTML(error.message || "Zamanlamalar alınamadı.")}</div>`;
      }
    } finally {
      center.schedulesLoading = false;
    }
  }

  function renderAdminNotificationSchedules() {
    if (!els.adminNotificationScheduleList) return;
    const items = state.notificationCenter.scheduledNotifications || [];
    els.adminNotificationScheduleList.innerHTML = items.length ? items.map((item) => {
      const executed = item.status === "executed" || Boolean(item.executedAt);
      const detail = executed
        ? `Gönderildi: ${formatDateTime(item.executedAt) || "-"}`
        : `Planlanan: ${formatDateTime(item.scheduledAt) || "-"}`;
      return `<article class="admin-notification-schedule-card ${executed ? "is-executed" : ""}" data-scheduled-notification-id="${escapeAttribute(item.id || "")}">
        <div><strong>${escapeHTML(item.title || "Kritik stok kontrolü")}</strong><small>${escapeHTML(detail)}${item.note ? ` · ${escapeHTML(item.note)}` : ""}</small></div>
        <div class="admin-notification-schedule-actions">
          ${executed ? "" : '<button type="button" class="ui-button ui-button--ghost ui-button--sm" data-schedule-action="edit">Düzenle</button>'}
          <button type="button" class="ui-button ${executed ? "ui-button--ghost" : "ui-button--danger"} ui-button--sm" data-schedule-action="delete">${executed ? "Kaydı sil" : "İptal et"}</button>
        </div>
      </article>`;
    }).join("") : '<div class="admin-notification-empty">Henüz tek seferlik bildirim oluşturulmadı.</div>';
  }

  function handleAdminNotificationScheduleClick(event) {
    const button = event.target.closest("[data-schedule-action]");
    const card = button && button.closest("[data-scheduled-notification-id]");
    if (!button || !card) return;
    const item = (state.notificationCenter.scheduledNotifications || [])
      .find((entry) => String(entry.id) === String(card.dataset.scheduledNotificationId));
    if (!item) return;
    if (button.dataset.scheduleAction === "edit") editAdminNotificationSchedule(item);
    if (button.dataset.scheduleAction === "delete") deleteAdminNotificationSchedule(item, button);
  }

  function editAdminNotificationSchedule(item) {
    const form = els.adminNotificationScheduleForm;
    if (!form || item.status === "executed") return;
    form.dataset.scheduleId = String(item.id || "");
    form.elements.namedItem("title").value = String(item.title || "Kritik stok kontrolü");
    form.elements.namedItem("note").value = String(item.note || "");
    form.elements.namedItem("scheduledAt").value = localDateTimeInputValue(item.scheduledAt);
    form.querySelector('[type="submit"]').textContent = "Zamanlamayı güncelle";
    setAdminNotificationScheduleMessage("Zamanlama düzenleniyor. Yeni gün ve saati kaydedebilirsiniz.");
    form.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    form.elements.namedItem("scheduledAt").focus({ preventScroll: true });
  }

  async function saveAdminNotificationSchedule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const scheduledAtInput = form.elements.namedItem("scheduledAt");
    const selectedDate = new Date(scheduledAtInput.value || "");
    if (!Number.isFinite(selectedDate.getTime()) || selectedDate.getTime() <= Date.now()) {
      setAdminNotificationScheduleMessage("Gelecekte bir gün ve saat seçin.", "error");
      scheduledAtInput.focus();
      return;
    }
    const scheduleId = String(form.dataset.scheduleId || "");
    const originalLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = scheduleId ? "Güncelleniyor..." : "Oluşturuluyor...";
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/schedules${scheduleId ? `/${encodeURIComponent(scheduleId)}` : ""}`, {
        method: scheduleId ? "PATCH" : "POST",
        body: {
          kind: "stock_critical_snapshot",
          title: String(form.elements.namedItem("title").value || ""),
          note: String(form.elements.namedItem("note").value || ""),
          scheduledAt: selectedDate.toISOString()
        }
      });
      resetAdminNotificationScheduleForm();
      await loadAdminNotificationSchedules();
      setAdminNotificationScheduleMessage(scheduleId ? "Zamanlama güncellendi." : "Kritik stok bildirimi oluşturuldu.", "success");
      return result;
    } catch (error) {
      setAdminNotificationScheduleMessage(error.message || "Zamanlama kaydedilemedi.", "error");
    } finally {
      submit.disabled = false;
      if (submit.textContent.endsWith("...")) submit.textContent = originalLabel;
    }
  }

  async function deleteAdminNotificationSchedule(item, button) {
    const executed = item.status === "executed" || Boolean(item.executedAt);
    const question = executed
      ? "Gönderilmiş zamanlama kaydı listeden silinsin mi? Bildirim merkezindeki kayıt korunur."
      : "Bu planlı kritik stok bildirimi iptal edilsin mi?";
    if (!window.confirm(question)) return;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = executed ? "Siliniyor..." : "İptal ediliyor...";
    try {
      await backendRequest(`${ADMIN_NOTIFICATION_API}/schedules/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (String(els.adminNotificationScheduleForm?.dataset.scheduleId || "") === String(item.id)) resetAdminNotificationScheduleForm();
      await loadAdminNotificationSchedules();
      setAdminNotificationScheduleMessage(executed ? "Zamanlama kaydı silindi." : "Planlı bildirim iptal edildi.", "success");
    } catch (error) {
      button.disabled = false;
      button.textContent = originalLabel;
      setAdminNotificationScheduleMessage(error.message || "Zamanlama silinemedi.", "error");
    }
  }

  function resetAdminNotificationScheduleForm() {
    const form = els.adminNotificationScheduleForm;
    if (!form) return;
    form.reset();
    delete form.dataset.scheduleId;
    const title = form.elements.namedItem("title");
    const input = form.elements.namedItem("scheduledAt");
    const minimum = new Date(Date.now() + 60 * 1000);
    const suggested = new Date(Date.now() + 10 * 60 * 1000);
    if (title) title.value = "Kritik stok kontrolü";
    if (input) {
      input.min = localDateTimeInputValue(minimum);
      input.value = localDateTimeInputValue(suggested);
    }
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.textContent = "Bildirim oluştur";
  }

  function setAdminNotificationScheduleMessage(message, tone = "") {
    if (!els.adminNotificationScheduleMessage) return;
    els.adminNotificationScheduleMessage.textContent = message || "";
    if (tone) els.adminNotificationScheduleMessage.dataset.tone = tone;
    else delete els.adminNotificationScheduleMessage.dataset.tone;
  }

  function localDateTimeInputValue(value) {
    const date = value instanceof Date ? value : new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function setNotificationPreferenceInput(form, name, checked) {
    const input = form.elements.namedItem(name);
    if (input) input.checked = Boolean(checked);
  }

  function syncAdminNotificationQuietHours() {
    const form = els.adminNotificationPreferences;
    if (!form) return;
    const enabled = Boolean(form.elements.namedItem("quietHoursEnabled")?.checked);
    ["quietHoursStart", "quietHoursEnd"].forEach((name) => {
      const input = form.elements.namedItem(name);
      if (input) input.disabled = !enabled;
    });
  }

  function collectAdminNotificationPreferences() {
    const form = els.adminNotificationPreferences;
    const current = state.notificationCenter.preferences || {};
    const checked = (name) => Boolean(form && form.elements.namedItem(name) && form.elements.namedItem(name).checked);
    const value = (name, fallback = "") => String(form && form.elements.namedItem(name)?.value || fallback);
    const channels = Object.assign({}, current.channels || {}, {
      inApp: checked("inAppEnabled"),
      email: checked("emailEnabled"),
      push: checked("pushEnabled")
    });
    return {
      inAppEnabled: channels.inApp,
      emailEnabled: channels.email,
      pushEnabled: channels.push,
      emailAddress: value("emailAddress").trim().toLowerCase(),
      channels,
      categories: { system: true },
      systemNotifications: true,
      quietHoursEnabled: checked("quietHoursEnabled"),
      quietHoursStart: value("quietHoursStart", "22:00"),
      quietHoursEnd: value("quietHoursEnd", "08:00"),
      timezone: "Europe/Istanbul",
      rules: collectAdminNotificationRules()
    };
  }

  async function saveAdminNotificationPreferences(event) {
    if (event) event.preventDefault();
    const button = els.adminNotificationSavePreferences;
    if (!button || button.disabled) return false;
    const payload = collectAdminNotificationPreferences();
    if (payload.emailEnabled && (!state.notificationCenter.preferences?.emailVerified || !isValidAdminNotificationEmail(payload.emailAddress))) {
      setAdminNotificationMessage("E-posta bildirimleri için önce hesap e-postanızı doğrulayın.", "error");
      els.adminNotificationManageEmail?.focus();
      return false;
    }
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Kaydediliyor...";
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/preferences`, {
        method: "PUT",
        body: payload
      });
      state.notificationCenter.preferences = result.preferences || payload;
      state.notificationCenter.capabilities = result.capabilities || state.notificationCenter.capabilities;
      state.notificationCenter.personnelOptions = Array.isArray(result.personnelOptions) ? result.personnelOptions : state.notificationCenter.personnelOptions;
      renderAdminNotificationPreferences();
      setAdminNotificationMessage("Bildirim ayarları kaydedildi.", "success");
      return true;
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim ayarları kaydedilemedi.", "error");
      return false;
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function isValidAdminNotificationEmail(value) {
    const text = String(value || "");
    return text.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  }

  function openAdminAccountSecurity() {
    closeAdminNotificationDrawer({ restoreFocus: false });
    setActiveSection("profile", { collapseSidebar: true });
    window.setTimeout(() => {
      const card = document.querySelector('[data-account-security][data-account-scope="admin"]');
      const details = card && card.closest("details");
      if (details) details.open = true;
      card?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      card?.querySelector("[data-account-email]")?.focus({ preventScroll: true });
      window.MenuSuiteAccountSecurity?.refresh("admin");
    }, 80);
  }

  function adminNotificationDeviceId() {
    let value = safeLocalGet(ADMIN_NOTIFICATION_DEVICE_KEY);
    if (value) return value;
    value = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    safeLocalSet(ADMIN_NOTIFICATION_DEVICE_KEY, value);
    return value;
  }

  function adminNotificationDeviceName() {
    const platform = String(navigator.userAgentData?.platform || navigator.platform || "Tarayıcı").slice(0, 60);
    const standalone = window.matchMedia("(display-mode: standalone)").matches ? "PWA" : "Web";
    return `${platform} · ${standalone}`;
  }

  function adminNotificationDeviceHeaders() {
    return { "X-Menu-Suite-Device-Id": adminNotificationDeviceId() };
  }

  async function loadAdminNotificationDevices(force = false) {
    const center = state.notificationCenter;
    if (!els.adminNotificationDevices || center.devicesLoading || (!force && center.devices.length)) return;
    center.devicesLoading = true;
    els.adminNotificationDevices.innerHTML = '<div class="admin-notification-device-empty">Bağlı cihazlar yükleniyor...</div>';
    if (els.adminNotificationDevicesRefresh) els.adminNotificationDevicesRefresh.disabled = true;
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
        headers: adminNotificationDeviceHeaders(),
        noDedupe: force
      });
      center.devices = Array.isArray(result.devices) ? result.devices : Array.isArray(result.subscriptions) ? result.subscriptions : [];
      renderAdminNotificationDevices();
    } catch (error) {
      els.adminNotificationDevices.innerHTML = `<div class="admin-notification-device-empty">${escapeHTML(error.message || "Bağlı cihazlar alınamadı.")}</div>`;
    } finally {
      center.devicesLoading = false;
      if (els.adminNotificationDevicesRefresh) els.adminNotificationDevicesRefresh.disabled = false;
    }
  }

  function renderAdminNotificationDevices() {
    if (!els.adminNotificationDevices) return;
    const currentId = adminNotificationDeviceId();
    const devices = state.notificationCenter.devices || [];
    if (!devices.length) {
      els.adminNotificationDevices.innerHTML = '<div class="admin-notification-device-empty">Bu hesaba bağlı bildirim cihazı yok.</div>';
      return;
    }
    els.adminNotificationDevices.innerHTML = devices.map((device) => {
      const id = String(device.id || device.subscriptionId || "");
      const current = Boolean(device.current ?? device.isCurrent) || String(device.deviceId || "") === currentId;
      const name = String(device.deviceName || device.name || "Tarayıcı cihazı");
      const seen = formatDateTime(device.lastSeenAt || device.updatedAt || device.createdAt) || "Zaman bilgisi yok";
      return `<div class="admin-notification-device-row ${current ? "is-current" : ""}" data-notification-device-row="${escapeAttribute(id)}">
        <div class="admin-notification-device-copy"><span>${escapeHTML(name)} ${current ? '<small class="admin-notification-device-current">· Bu cihaz</small>' : ""}</span><time>${escapeHTML(`Son kullanım: ${seen}`)}</time></div>
        <button class="ui-button ui-button--ghost ui-button--sm" type="button" data-notification-device-remove="${escapeAttribute(id)}" data-current-device="${current ? "true" : "false"}">Kaldır</button>
      </div>`;
    }).join("");
  }

  async function handleAdminNotificationDeviceClick(event) {
    const button = event.target.closest("[data-notification-device-remove]");
    if (!button || button.disabled) return;
    const id = String(button.dataset.notificationDeviceRemove || "");
    if (!id || !window.confirm("Bu cihazın anlık bildirim bağlantısı kaldırılsın mı?")) return;
    button.disabled = true;
    try {
      await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: adminNotificationDeviceHeaders()
      });
      if (button.dataset.currentDevice === "true") {
        const subscription = await currentAdminPushSubscription().catch(() => null);
        await subscription?.unsubscribe().catch(() => false);
        state.notificationCenter.pushSubscribed = false;
      }
      state.notificationCenter.devices = state.notificationCenter.devices.filter((device) => String(device.id || device.subscriptionId || "") !== id);
      renderAdminNotificationDevices();
      await syncAdminPushSubscriptionState();
      setAdminNotificationMessage("Bildirim cihazı kaldırıldı.", "success");
    } catch (error) {
      setAdminNotificationMessage(error.message || "Bildirim cihazı kaldırılamadı.", "error");
      button.disabled = false;
    }
  }

  async function syncAdminPushSubscriptionState() {
    if (!supportsAdminPush() || !els.adminNotificationPush) return;
    try {
      const subscription = await currentAdminPushSubscription();
      state.notificationCenter.pushSubscribed = Boolean(subscription);
      els.adminNotificationPush.textContent = subscription ? "Anlık bildirimi kapat" : "Anlık bildirimi etkinleştir";
    } catch (_error) {}
  }

  async function toggleAdminPushSubscription() {
    const button = els.adminNotificationPush;
    if (!button || button.disabled) return false;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "İşleniyor...";
    let createdSubscription = null;
    try {
      if (!supportsAdminPush()) {
        throw new Error("Bu tarayıcı anlık bildirimi desteklemiyor.");
      }
      if (!state.notificationCenter.pushSubscribed) {
        let permission = window.Notification.permission;
        if (permission === "default") permission = await window.Notification.requestPermission();
        if (permission !== "granted") throw new Error("Anlık bildirim izni verilmedi.");
      }
      const registration = await ensureAdminServiceWorker();
      let subscription = await registration.pushManager.getSubscription();
      const pushInput = els.adminNotificationPreferences && els.adminNotificationPreferences.elements.namedItem("pushEnabled");
      if (subscription) {
        await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
          method: "DELETE",
          body: { endpoint: subscription.endpoint },
          headers: adminNotificationDeviceHeaders()
        });
        await subscription.unsubscribe();
        subscription = null;
        if (pushInput) pushInput.checked = false;
      } else {
        const vapidPublicKey = String(state.notificationCenter.capabilities.vapidPublicKey || "").trim();
        if (!vapidPublicKey) throw new Error("Anlık bildirim sunucu anahtarı tanımlı değil.");
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
        });
        createdSubscription = subscription;
        await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
          method: "POST",
          body: {
            subscription: subscription.toJSON(),
            deviceId: adminNotificationDeviceId(),
            deviceName: adminNotificationDeviceName()
          },
          headers: adminNotificationDeviceHeaders()
        });
        if (pushInput) pushInput.checked = true;
      }
      const saved = await saveAdminNotificationPreferences();
      if (!saved) throw new Error("Anlık bildirim tercihi kaydedilemedi.");
      state.notificationCenter.pushSubscribed = Boolean(subscription);
      state.notificationCenter.devices = [];
      await loadAdminNotificationDevices(true);
      setAdminNotificationMessage(subscription ? "Anlık bildirim etkinleştirildi." : "Anlık bildirim kapatıldı.", "success");
      return Boolean(subscription);
    } catch (error) {
      if (createdSubscription) {
        await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
          method: "DELETE",
          body: { endpoint: createdSubscription.endpoint },
          headers: adminNotificationDeviceHeaders(),
          skipAuthFailure: true
        }).catch(() => null);
        await createdSubscription.unsubscribe().catch(() => false);
        const pushInput = els.adminNotificationPreferences && els.adminNotificationPreferences.elements.namedItem("pushEnabled");
        if (pushInput) pushInput.checked = false;
        state.notificationCenter.pushSubscribed = false;
      }
      setAdminNotificationMessage(error.message || "Anlık bildirim ayarı değiştirilemedi.", "error");
      return false;
    } finally {
      button.disabled = false;
      button.textContent = state.notificationCenter.pushSubscribed ? "Anlık bildirimi kapat" : previous.includes("kapat") ? "Anlık bildirimi etkinleştir" : previous;
    }
  }

  function supportsAdminPush() {
    return Boolean(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }

  async function ensureAdminServiceWorker() {
    const existing = await navigator.serviceWorker.getRegistration("/yonetici/");
    if (existing) return existing;
    return navigator.serviceWorker.register("/yonetici/sw.js", { scope: "/yonetici/", updateViaCache: "none" });
  }

  async function currentAdminPushSubscription() {
    if (!supportsAdminPush()) return null;
    const registration = await navigator.serviceWorker.getRegistration("/yonetici/");
    return registration ? registration.pushManager.getSubscription() : null;
  }

  async function detachAdminPushSubscription() {
    const subscription = await currentAdminPushSubscription().catch(() => null);
    if (!subscription) return;
    await backendRequest(`${ADMIN_NOTIFICATION_API}/push-subscriptions`, {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
      headers: adminNotificationDeviceHeaders(),
      skipAuthFailure: true
    }).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
    state.notificationCenter.pushSubscribed = false;
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  async function sendAdminTestNotification() {
    const button = els.adminNotificationTest;
    if (!button || button.disabled) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Gönderiliyor...";
    try {
      await backendRequest(`${ADMIN_NOTIFICATION_API}/test`, { method: "POST", body: { channels: ["in_app"] } });
      setAdminNotificationMessage("Test bildirimi kuyruğa alındı.", "success");
      await loadAdminNotifications();
      await loadAdminNotificationDeliveryHealth();
    } catch (error) {
      if (Number(error.status) === 404) button.hidden = true;
      setAdminNotificationMessage(error.message || "Test bildirimi gönderilemedi.", "error");
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function loadAdminNotificationDeliveryHealth() {
    if (!els.adminNotificationHealth) return;
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}/delivery-health`);
      const health = result.health || {};
      const channels = health.channels || {};
      const email = health.email || channels.email || {};
      const push = health.push || channels.push || {};
      const metric = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
      const display = (value) => value === null ? "—" : String(value);
      const pendingEmail = metric(health.pendingEmail ?? email.pending);
      const sent = metric(health.sent ?? health.delivered, 0);
      const failed = metric(health.failed, 0);
      const pendingPush = metric(health.pendingPush ?? push.pending);
      const invalidPush = metric(health.invalidPushSubscriptions ?? health.invalidPush ?? push.invalid, 0);
      const lastRun = health.lastProcessedAt || health.lastWorkerRunAt || health.lastRunAt || "";
      els.adminNotificationHealth.innerHTML = `
        <span><strong>${display(pendingEmail)}</strong><small>Bekleyen e-posta</small></span>
        <span><strong>${display(sent)}</strong><small>Gönderilen</small></span>
        <span><strong>${display(failed)}</strong><small>Başarısız</small></span>
        <span><strong>${display(pendingPush)}</strong><small>Bekleyen push</small></span>
        <span><strong>${display(invalidPush)}</strong><small>Geçersiz abonelik</small></span>
        <span class="is-wide"><strong>${escapeHTML(formatDateTime(lastRun) || "Henüz çalışmadı")}</strong><small>Son worker çalışması</small></span>`;
    } catch (error) {
      els.adminNotificationHealth.textContent = error.message || "Teslimat sağlığı alınamadı.";
    }
  }

  async function loadAdminNotificationDeliveries(force = false) {
    const center = state.notificationCenter;
    if (center.deliveryLoading || (!force && center.deliveries.length)) return;
    center.deliveryLoading = true;
    if (els.adminNotificationDeliveryRefresh) {
      els.adminNotificationDeliveryRefresh.disabled = true;
      els.adminNotificationDeliveryRefresh.textContent = "Yükleniyor...";
    }
    if (els.adminNotificationDeliveryList && !center.deliveries.length) els.adminNotificationDeliveryList.textContent = "Teslim geçmişi yükleniyor...";
    try {
      const result = await backendRequest(`${ADMIN_NOTIFICATION_API}?view=deliveries&limit=100`, { noDedupe: force });
      center.deliveries = Array.isArray(result.deliveries) ? result.deliveries : [];
      renderAdminNotificationDeliveries();
    } catch (error) {
      if (els.adminNotificationDeliveryList) els.adminNotificationDeliveryList.textContent = error.message || "Teslim geçmişi alınamadı.";
    } finally {
      center.deliveryLoading = false;
      if (els.adminNotificationDeliveryRefresh) {
        els.adminNotificationDeliveryRefresh.disabled = false;
        els.adminNotificationDeliveryRefresh.textContent = "Teslim geçmişini yenile";
      }
    }
  }

  function renderAdminNotificationDeliveries() {
    if (!els.adminNotificationDeliveryList) return;
    const items = state.notificationCenter.deliveries || [];
    els.adminNotificationDeliveryList.innerHTML = items.length ? items.map((item) => {
      const status = ["pending", "processing", "sent", "failed", "cancelled", "suppressed", "merged"].includes(item.status) ? item.status : "pending";
      const statusLabel = { pending: "Bekliyor", processing: "İşleniyor", sent: "Gönderildi", failed: "Başarısız", cancelled: "İptal edildi", suppressed: "Bastırıldı", merged: "Birleştirildi" }[status];
      const retry = status === "failed" ? `<button class="ui-button ui-button--secondary ui-button--sm" type="button" data-delivery-action="retry" data-delivery-id="${escapeAttribute(item.id)}">Yeniden dene</button>` : "";
      const cancel = status === "pending" ? `<button class="ui-button ui-button--ghost ui-button--sm" type="button" data-delivery-action="cancel" data-delivery-id="${escapeAttribute(item.id)}">Bekleyeni iptal et</button>` : "";
      const stop = ["pending", "failed"].includes(status) ? `<button class="ui-button ui-button--ghost ui-button--sm" type="button" data-delivery-action="stop-retry" data-delivery-id="${escapeAttribute(item.id)}">Yeniden denemeyi durdur</button>` : "";
      return `<article class="admin-notification-delivery" data-delivery-row="${escapeAttribute(item.id)}"><div><strong>${escapeHTML(item.title || "Bildirim teslimi")}</strong><span class="admin-notification-status is-${status}">${statusLabel}</span><div class="admin-notification-delivery__meta"><span>${escapeHTML(String(item.channel || "").toUpperCase())}</span><span>${escapeHTML(item.destination || "")}</span><span>${Number(item.attemptCount || 0)} deneme</span><time>${escapeHTML(formatDateTime(item.updatedAt) || "Zaman yok")}</time></div>${item.reason ? `<small>${escapeHTML(item.reason)}</small>` : ""}</div><div class="admin-notification-delivery__actions">${retry}${cancel}${stop}</div></article>`;
    }).join("") : '<div class="admin-notification-empty">Henüz bildirim teslim kaydı yok.</div>';
  }

  async function handleAdminNotificationDeliveryClick(event) {
    const button = event.target.closest("[data-delivery-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.deliveryAction;
    const id = button.dataset.deliveryId;
    const key = `delivery:${id}:${action}`;
    if (!id || state.notificationCenter.mutationKeys.has(key)) return;
    if (["cancel", "stop-retry"].includes(action) && !window.confirm(action === "cancel"
      ? "Bekleyen bu teslim iptal edilsin mi?" : "Bu teslim için yeniden deneme durdurulsun mu?")) return;
    state.notificationCenter.mutationKeys.add(key);
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = action === "retry" ? "Kuyruğa alınıyor..." : "Uygulanıyor...";
    try {
      await backendRequest(`${ADMIN_NOTIFICATION_API}/outbox/${encodeURIComponent(id)}/${action}`, { method: "POST", body: {} });
      state.notificationCenter.deliveries = [];
      await Promise.allSettled([loadAdminNotificationDeliveries(true), loadAdminNotificationDeliveryHealth()]);
    } catch (error) {
      setAdminNotificationMessage(error.message || "Teslim işlemi uygulanamadı.", "error");
      button.disabled = false;
      button.textContent = previous;
    } finally {
      state.notificationCenter.mutationKeys.delete(key);
    }
  }

  async function loadAdminSystemHealth(force = false) {
    if (!els.adminSystemHealthGrid || state.systemHealth.loading) return;
    if (!force && state.systemHealth.value) { renderAdminSystemHealth(); return; }
    state.systemHealth.loading = true;
    if (els.adminSystemHealthRefresh) {
      els.adminSystemHealthRefresh.disabled = true;
      els.adminSystemHealthRefresh.textContent = "Denetleniyor...";
    }
    els.adminSystemHealthGrid.textContent = "Store ve çalışma servisleri denetleniyor...";
    try {
      const result = await backendRequest("/api/admin/system-health", { noDedupe: force });
      state.systemHealth.value = result.health || {};
      renderAdminSystemHealth();
    } catch (error) {
      els.adminSystemHealthGrid.textContent = error.message || "Sistem sağlığı alınamadı.";
    } finally {
      state.systemHealth.loading = false;
      if (els.adminSystemHealthRefresh) {
        els.adminSystemHealthRefresh.disabled = false;
        els.adminSystemHealthRefresh.textContent = "Sistem sağlığını yenile";
      }
    }
  }

  function renderAdminSystemHealth() {
    if (!els.adminSystemHealthGrid) return;
    const health = state.systemHealth.value || {};
    const storeHealth = health.store || {};
    const media = health.media || {};
    const backup = health.backup || {};
    const sse = health.sse || {};
    const scheduler = health.scheduler || {};
    const outbox = health.outbox || {};
    const disk = health.disk || {};
    const deployment = health.deployment || {};
    const card = (title, value, detail) => `<article><small>${escapeHTML(title)}</small><strong>${escapeHTML(String(value))}</strong><span>${escapeHTML(String(detail || ""))}</span></article>`;
    els.adminSystemHealthGrid.innerHTML = [
      card("Store", storeHealth.writable ? "Yazılabilir" : "Yazma sorunu", `Rev ${storeHealth.revision || 0} · ${formatFileSize(storeHealth.sizeBytes || 0)}`),
      card("Medya", media.writable ? "Yazılabilir" : "Yazma sorunu", `${media.fileCount || 0} dosya · ${formatFileSize(media.sizeBytes || 0)}`),
      card("Yedek", backup.count ? `${backup.count} kayıt` : "Yedek yok", formatDateTime(backup.lastBackupAt) || "Henüz oluşturulmadı"),
      card("SSE bağlantıları", sse.total || 0, `Menü ${sse.menu || 0} · Personel ${sse.authenticatedEvents || 0} · Bildirim ${sse.notifications || 0}`),
      card("Zamanlayıcı / worker", scheduler.running && outbox.workerRunning ? "Çalışıyor" : "Kontrol gerekli", `Bekleyen ${outbox.pending || 0} · Başarısız ${outbox.failed || 0}`),
      card("Disk", disk.available ? formatFileSize(disk.freeBytes || 0) : "Bilgi yok", disk.available ? `${formatFileSize(disk.totalBytes || 0)} toplam` : "Dosya sistemi ölçemedi"),
      card("PWA release", health.pwaReleaseId || "Tanımsız", "Her build/deploy için türetilen kimlik"),
      card("Dağıtım", deployment.persistentDataConfigured ? "Kalıcı yollar tanımlı" : "Yerel varsayılan yollar", `Secure cookie: ${deployment.cookieSecure ? "açık" : "kapalı"} · Origin ${deployment.allowedOriginCount || 0}`),
      card("Son önemli hata", health.lastImportantError ? health.lastImportantError.message : "Yok", health.lastImportantError ? formatDateTime(health.lastImportantError.occurredAt) : "Çalışma sürecinde kayıt yok")
    ].join("");
  }

  function setupAdminNotificationRealtime() {
    const baseUrl = backendBaseUrl();
    if (!baseUrl) return;
    if (!window.EventSource) {
      startAdminNotificationPolling();
      return;
    }
    if (state.notificationEventSource) return;
    try {
      const source = new EventSource(`${baseUrl}${ADMIN_NOTIFICATION_API}/events`, { withCredentials: true });
      state.notificationEventSource = source;
      source.addEventListener("open", () => {
        state.notificationReconnectAttempt = 0;
        if (state.notificationReconnectTimer) window.clearTimeout(state.notificationReconnectTimer);
        state.notificationReconnectTimer = null;
        stopAdminNotificationPolling();
      });
      source.addEventListener("notification", handleAdminNotificationEvent);
      source.addEventListener("message", handleAdminNotificationEvent);
      source.addEventListener("error", () => {
        try { source.close(); } catch (_error) {}
        if (state.notificationEventSource === source) state.notificationEventSource = null;
        startAdminNotificationPolling();
        scheduleAdminNotificationReconnect();
      });
    } catch (_error) {
      startAdminNotificationPolling();
      scheduleAdminNotificationReconnect();
    }
  }

  function scheduleAdminNotificationReconnect() {
    if (state.notificationReconnectTimer || !els.panelShell || els.panelShell.hidden || !window.EventSource) return;
    const delay = Math.min(30000, 1000 * (2 ** Math.min(state.notificationReconnectAttempt, 5)));
    state.notificationReconnectAttempt += 1;
    state.notificationReconnectTimer = window.setTimeout(() => {
      state.notificationReconnectTimer = null;
      setupAdminNotificationRealtime();
    }, delay);
  }

  function handleAdminNotificationEvent(event) {
    try {
      const payload = JSON.parse(event.data || "{}");
      if (payload.unreadCount !== undefined) setAdminNotificationUnreadCount(payload.unreadCount);
      if (payload.action === "created" && payload.notification) scheduleAdminNotificationSound(payload.notification);
      if (state.notificationCenter.open) loadAdminNotifications().catch(() => {});
    } catch (_error) {}
  }

  function bindAdminNotificationSoundUnlock() {
    const unlock = () => { adminNotificationSoundUnlocked = true; };
    document.addEventListener("pointerdown", unlock, { once: true, capture: true });
    document.addEventListener("keydown", unlock, { once: true, capture: true });
  }

  function scheduleAdminNotificationSound(notification) {
    if (!adminNotificationSoundUnlocked || document.visibilityState !== "visible"
      || !notification || notification.metadata?.soundEnabled !== true || adminNotificationQuietNow()) return;
    const id = String(notification.id || "");
    if (!id) return;
    const now = Date.now();
    let claims = {};
    try { claims = JSON.parse(safeLocalGet(ADMIN_NOTIFICATION_SOUND_CLAIMS_KEY) || "{}"); } catch (_error) {}
    for (const [key, claim] of Object.entries(claims)) if (!claim || now - Number(claim.at || 0) > 7 * 24 * 60 * 60 * 1000) delete claims[key];
    if (claims[id]) return;
    claims[id] = { owner: adminNotificationSoundOwner, at: now };
    safeLocalSet(ADMIN_NOTIFICATION_SOUND_CLAIMS_KEY, JSON.stringify(claims));
    window.setTimeout(() => {
      let current = {};
      try { current = JSON.parse(safeLocalGet(ADMIN_NOTIFICATION_SOUND_CLAIMS_KEY) || "{}"); } catch (_error) {}
      if (current[id]?.owner !== adminNotificationSoundOwner) return;
      playAdminNotificationTone();
    }, 50);
  }

  function adminNotificationQuietNow() {
    const preferences = state.notificationCenter.preferences || {};
    if (preferences.quietHoursEnabled !== true) return false;
    let hour = new Date().getHours();
    let minutePart = new Date().getMinutes();
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: String(preferences.timezone || "Europe/Istanbul"), hour: "2-digit", minute: "2-digit", hourCycle: "h23"
      }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
      hour = Number(parts.hour); minutePart = Number(parts.minute);
    } catch (_error) {}
    const minute = hour * 60 + minutePart;
    const toMinute = (value, fallback) => {
      const match = /^(\d{2}):(\d{2})$/.exec(String(value || fallback));
      return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
    };
    const start = toMinute(preferences.quietHoursStart, "22:00");
    const end = toMinute(preferences.quietHoursEnd, "08:00");
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  function playAdminNotificationTone() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.17);
      oscillator.addEventListener("ended", () => void context.close().catch(() => {}), { once: true });
    } catch (_error) {}
  }

  function startAdminNotificationPolling() {
    if (state.notificationPollTimer) return;
    state.notificationPollTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadAdminNotificationUnreadCount().catch(() => {});
      if (state.notificationCenter.open) loadAdminNotifications().catch(() => {});
    }, ADMIN_NOTIFICATION_POLL_MS);
  }

  function stopAdminNotificationPolling() {
    if (!state.notificationPollTimer) return;
    window.clearInterval(state.notificationPollTimer);
    state.notificationPollTimer = null;
  }

  function hasMenuContent(menuState) {
    return Boolean(menuState
      && typeof menuState === "object"
      && !Array.isArray(menuState)
      && (Array.isArray(menuState.categories)
        || Boolean(menuState.settings && typeof menuState.settings === "object" && !Array.isArray(menuState.settings))));
  }

  function hasPendingChanges() {
    return state.dirtyMenu || state.dirtyPanelConfig;
  }

  function markDirty(scope, message) {
    if (scope !== "menu") return;
    state.dirtyMenu = true;
    state.previewRevisions.menu = Number(state.previewRevisions.menu || 0) + 1;
    state.saveStatus = "dirty";
    updateSaveControls(message || "Kaydedilmemiş değişiklik");
    notifyLivePreviewDraft();
  }

  function notifyLivePreviewDraft() {
    if (window.MenuSuiteLivePreview && typeof window.MenuSuiteLivePreview.notifyDraft === "function") {
      window.MenuSuiteLivePreview.notifyDraft();
    }
  }

  function updateSaveControls(message) {
    const pending = hasPendingChanges();
    const awaitingVerification = Boolean(state.pendingPublishVerification);
    const status = state.saving
      ? awaitingVerification ? "verifying" : "saving"
      : awaitingVerification ? "unverified" : pending ? "dirty" : state.saveStatus;
    const statusText = {
      clean: "Değişiklik yok",
      dirty: "Kaydedilmemiş değişiklik",
      saving: "Kaydediliyor",
      verifying: "Kayıt doğrulanıyor",
      published: "Kaydedildi",
      unverified: "Kayıt doğrulanamadı",
      error: "Kayıt hatası",
      conflict: "Veri çakışması"
    }[status] || "Değişiklik yok";
    if (els.saveChangesButton) {
      const disabled = state.saving || (!pending && !awaitingVerification);
      els.saveChangesButton.classList.toggle("is-disabled", disabled);
      els.saveChangesButton.disabled = disabled;
      els.saveChangesButton.setAttribute("aria-disabled", String(disabled));
      els.saveChangesButton.toggleAttribute("aria-busy", state.saving);
      els.saveChangesButton.textContent = state.saving
        ? awaitingVerification ? "Doğrulanıyor..." : "Kaydediliyor..."
        : awaitingVerification ? "Kaydı Doğrula" : "Kaydet";
    }
    if (els.saveState) {
      els.saveState.textContent = message || statusText;
      els.saveState.dataset.saveStatus = status;
    }

    if (els.menuSummaryStatus) {
      els.menuSummaryStatus.textContent = state.saving
        ? awaitingVerification ? "Doğrulanıyor" : "Kaydediliyor"
        : awaitingVerification ? "Doğrulanamadı" : pending ? "Taslak" : "Hazır";
      const summaryStatus = els.menuSummaryStatus.closest(".menu-summary-status");
      if (summaryStatus) summaryStatus.classList.toggle("is-pending", pending || awaitingVerification || state.saving);
    }
    syncAdminUnsavedBar(pending, awaitingVerification, status, message || statusText);
  }

  function syncAdminUnsavedBar(pending, awaitingVerification, status, message) {
    if (!els.adminUnsavedBar) return;
    const visible = Boolean(pending || awaitingVerification || state.saving || ["error", "conflict", "unverified"].includes(status));
    els.adminUnsavedBar.hidden = !visible;
    if (!visible) {
      if (els.adminUnsavedDetails) els.adminUnsavedDetails.open = false;
      return;
    }
    const changes = [];
    if (state.dirtyMenu) changes.push("Uygulama, ürün, kategori veya marka taslağı");
    if (state.dirtyPanelConfig) changes.push("Yönetici paneli görünüm ve davranış ayarları");
    if (awaitingVerification) changes.push("Sunucudan tekrar okunarak doğrulanacak kayıt");
    if (els.adminUnsavedSummary) els.adminUnsavedSummary.textContent = message || `${changes.length} değişiklik grubu kaydedilmeyi bekliyor.`;
    if (els.adminUnsavedList) els.adminUnsavedList.innerHTML = changes.length
      ? changes.map((item) => `<li>${escapeHTML(item)}</li>`).join("")
      : `<li>${escapeHTML(message || "Kayıt işlemi tamamlanmayı bekliyor.")}</li>`;
    for (const button of [els.adminUnsavedSave, els.adminUnsavedDiscard]) {
      if (!button) continue;
      button.disabled = state.saving;
      button.toggleAttribute("aria-busy", state.saving);
    }
    if (els.adminUnsavedDiscard) els.adminUnsavedDiscard.disabled = state.saving || awaitingVerification;
    if (els.adminUnsavedSave) els.adminUnsavedSave.textContent = state.saving
      ? awaitingVerification ? "Doğrulanıyor..." : "Kaydediliyor..."
      : awaitingVerification ? "Kaydı Doğrula" : "Kaydet";
  }

  async function discardPendingAdminChanges(event) {
    event?.preventDefault();
    if (state.saving || state.pendingPublishVerification || !hasPendingChanges()) return;
    if (!window.confirm("Kaydedilmemiş değişikliklerden vazgeçip son yayınlanan veriye dönülsün mü?")) return;
    const button = els.adminUnsavedDiscard;
    if (button) { button.disabled = true; button.textContent = "Geri alınıyor..."; }
    try {
      const [menuResult, publishResult] = await Promise.all([
        backendRequest("/api/menu", { skipToken: true, noDedupe: true }),
        backendRequest("/api/admin/publish-state", { noDedupe: true })
      ]);
      if (!hasMenuContent(menuResult.menuState)) throw new Error("Yayınlanan menü verisi alınamadı.");
      state.data = normalizeState(menuResult.menuState);
      if (menuResult.pricing && typeof menuResult.pricing === "object") state.data.pricing = cloneData(menuResult.pricing);
      state.panelConfig = normalizePanelConfig(publishResult.panelConfig);
      state.publishedPanelConfigFingerprint = panelConfigFingerprint(state.panelConfig);
      state.publishedAdminThemePresetId = state.panelConfig.appearance.adminThemePresetId;
      state.dirtyMenu = false;
      state.dirtyPanelConfig = false;
      state.pendingPublishVerification = null;
      state.saveStatus = "clean";
      safeLocalSet(PANEL_SETTINGS_KEY, JSON.stringify(state.panelConfig));
      safeLocalRemove(PANEL_SETTINGS_DRAFT_KEY);
      applyPanelRuntimeSettings();
      ensureSelection();
      renderActiveSection(state.activeSection);
      syncPublishRevision(menuResult || publishResult);
      window.MenuSuiteLivePreview?.markPublished?.({ menuState: cloneData(state.data), pricing: cloneData(state.data.pricing || null) });
      updateSaveControls("Taslak değişikliklerden vazgeçildi");
    } catch (error) {
      state.saveStatus = "error";
      updateSaveControls(error.message || "Taslak geri alınamadı; değişiklikler korundu.");
    } finally {
      if (button) { button.textContent = "Vazgeç"; button.disabled = false; }
    }
  }

  function queueRenderAll() {
    window.clearTimeout(state.renderTimer);
    state.renderTimer = window.setTimeout(() => {
      state.renderTimer = null;
      const focusedControl = captureFocusedEditorControl();
      renderActiveSection(state.activeSection);
      restoreFocusedEditorControl(focusedControl);
    }, 80);
  }

  function captureFocusedEditorControl() {
    const element = document.activeElement;
    if (!element || !element.isConnected || !element.matches("input, select, textarea")) return null;
    if (!element.closest("[data-section-panel]")) return null;
    const supportsSelection = element.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="url"], input[type="tel"], input[type="password"]');
    return {
      element,
      value: element.value,
      checked: element.matches('input[type="checkbox"], input[type="radio"]') ? element.checked : undefined,
      selectionStart: supportsSelection && typeof element.selectionStart === "number" ? element.selectionStart : null,
      selectionEnd: supportsSelection && typeof element.selectionEnd === "number" ? element.selectionEnd : null
    };
  }

  function restoreFocusedEditorControl(snapshot) {
    if (!snapshot || !snapshot.element.isConnected) return;
    const element = snapshot.element;
    if (snapshot.checked !== undefined) element.checked = snapshot.checked;
    else element.value = snapshot.value;
    if (snapshot.selectionStart !== null && typeof element.setSelectionRange === "function") {
      element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
  }

  async function hydratePublicBrandIdentity() {
    applyAdminBrandIdentity(DEFAULT_SETTINGS.brandInfo);
    const identity = window.BrandIdentity;
    if (identity?.load) {
      try {
        const brandInfo = await identity.load({ logoSelector: "[data-admin-brand-logo]", appId: "yonetici", kind: "admin", mode: document.body.dataset.panelTheme === "dark" ? "dark" : "light", fallbackName: "Yönetici Paneli" });
        applyAdminBrandIdentity(brandInfo);
      } catch (_error) {}
      return;
    }
    if (!backendBaseUrl()) return;
    try {
      const result = await backendRequest("/api/public/bootstrap", {
        noDedupe: true,
        skipAuthFailure: true
      });
      const brandInfo = result && result.menu && result.menu.settings && result.menu.settings.brandInfo;
      if (brandInfo && typeof brandInfo === "object" && !Array.isArray(brandInfo)) {
        applyAdminBrandIdentity(brandInfo);
      }
    } catch (_error) {}
  }

  function handleSaveButtonClick(event) {
    event?.preventDefault();
    savePendingChanges().catch(() => {});
  }

  function captureCurrentEditorState() {
    if (!state.data) return;
    if (state.activeSection === "menu" || state.activeSection === "banner") return updateSettingsFromForm();
    if (state.activeSection === "category") return updateCategoryFromForm();
    if (state.activeSection === "product") return updateProductFromForm();
    if (state.activeSection === "brand") return writeSiteInfoFromSettings({ dirty: true });
    if (state.activeSection === "settings") {
      writePanelConfigFromForm();
      savePanelConfig();
    }
  }

  function savePendingChanges() {
    captureCurrentEditorState();
    if (state.pendingPublishVerification) return retryPendingPublishVerification();
    if (!hasPendingChanges()) {
      state.saveStatus = "clean";
      updateSaveControls("Değişiklik yok");
      window.setTimeout(() => updateSaveControls(), 1200);
      return Promise.resolve({ ok: true, unchanged: true, revision: state.publishRevision });
    }

    const operation = async () => {
      const snapshot = createPublishSnapshot();
      if (!backendBaseUrl()) throw new Error("Backend adresi tanımlı değil; değişiklikler kaydedilmedi.");
      state.saving = true;
      state.saveStatus = "saving";
      updateSaveControls();
      try {
        const requestId = createRequestId("publish");
        const result = await backendRequest("/api/admin/publish", {
          method: "POST",
          headers: { "Idempotency-Key": requestId },
          body: { requestId, expectedRevision: state.publishRevision, changes: snapshot.changes }
        });
        const acceptedRevision = Number(result && (result.revision ?? result.publishRevision));
        if (Number.isSafeInteger(acceptedRevision) && acceptedRevision >= 0) state.publishRevision = acceptedRevision;
        const pendingVerification = createPendingPublishVerification(snapshot, result, requestId);
        state.pendingPublishVerification = pendingVerification;
        updateSaveControls("Kayıt sunucudan doğrulanıyor");
        return await verifyPendingPublishReadback();
      } catch (error) {
        if (error && error.publishAccepted) {
          console.warn("Yayın kabul edildi ancak doğrulanamadı:", error);
          state.saveStatus = "unverified";
          updateSaveControls(error.message || "Kayıt doğrulanamadı. Değişiklikleriniz korunuyor.");
          alert(error.message || "Kayıt sunucu tarafından kabul edildi ancak doğrulanamadı. Değişiklikleriniz korunuyor.");
        } else {
          console.error("Kaydetme başarısız:", error);
          state.saveStatus = Number(error && error.status) === 409 ? "conflict" : "error";
          updateSaveControls();
          alert(error.message || "Kayıt tamamlanamadı. Değişiklikleriniz korunuyor.");
        }
        throw error;
      } finally {
        state.saving = false;
        updateSaveControls();
      }
    };

    return saveCoordinator
      ? saveCoordinator.run("admin-publish", operation, {
        button: els.saveChangesButton,
        busyText: "Kaydediliyor...",
        onSettled: updateSaveControls
      })
      : operation();
  }

  function createPendingPublishVerification(snapshot, publishResult, requestId) {
    const expectedMenuState = snapshot.changes.menuState ? cloneData(snapshot.changes.menuState) : null;
    return {
      snapshot,
      publishResult: cloneData(publishResult || {}),
      requestId,
      acceptedAt: new Date().toISOString(),
      expectedMenuFingerprint: String(publishResult && publishResult.menuFingerprint || ""),
      expectedDesignFingerprint: expectedMenuState ? MENU_DESIGN_SCHEMA.designFingerprint(expectedMenuState) : "",
      expectedServerPanelConfigFingerprint: String(publishResult && publishResult.panelConfigFingerprint || ""),
      expectedPanelConfigFingerprint: snapshot.changes.panelConfig ? panelConfigFingerprint(snapshot.changes.panelConfig) : "",
      lastError: ""
    };
  }

  async function verifyPendingPublishReadback() {
    const pending = state.pendingPublishVerification;
    if (!pending) return { ok: true, unchanged: true, revision: state.publishRevision };

    try {
      const needsMenu = Boolean(pending.snapshot.changes.menuState);
      const needsPanelConfig = Boolean(pending.snapshot.changes.panelConfig);
      const [menuReadback, panelReadback] = await Promise.all([
        needsMenu ? backendRequest("/api/menu", { skipToken: true, noDedupe: true }) : Promise.resolve(null),
        needsPanelConfig ? backendRequest("/api/admin/publish-state", { noDedupe: true }) : Promise.resolve(null)
      ]);
      const acceptedRevision = Number(pending.publishResult && pending.publishResult.revision);
      for (const readback of [menuReadback, panelReadback]) {
        if (!readback) continue;
        const readbackRevision = Number(readback.publishRevision ?? readback.revision);
        if (!Number.isSafeInteger(readbackRevision) || readbackRevision < acceptedRevision) {
          throw createPublishVerificationError("Kayıt kabul edildi, ancak tekrar okuma henüz güncel revizyona ulaşmadı. Yeniden doğrulayabilirsiniz.");
        }
      }
      syncPublishRevision(menuReadback || panelReadback);
      if (needsMenu) {
        const actualServerFingerprint = String(menuReadback && menuReadback.menuFingerprint || "");
        if (pending.expectedMenuFingerprint && actualServerFingerprint !== pending.expectedMenuFingerprint) {
          throw createPublishVerificationError("Kayıt sunucu tarafından kabul edildi ancak menü doğrulama verisi eksik veya farklı. Yeniden doğrulayabilirsiniz.");
        }
        const canonicalMenuState = menuReadback && menuReadback.menuState;
        const actualFingerprint = hasMenuContent(canonicalMenuState)
          ? MENU_DESIGN_SCHEMA.designFingerprint(canonicalMenuState)
          : "";
        if (!actualFingerprint || actualFingerprint !== pending.expectedDesignFingerprint) {
          throw createPublishVerificationError("Kayıt sunucu tarafından kabul edildi ancak menü doğrulama verisiyle eşleşmedi. Yeniden doğrulayabilirsiniz.");
        }
      }
      if (needsPanelConfig) {
        const actualServerPanelFingerprint = String(panelReadback && panelReadback.panelConfigFingerprint || "");
        if (pending.expectedServerPanelConfigFingerprint && actualServerPanelFingerprint !== pending.expectedServerPanelConfigFingerprint) {
          throw createPublishVerificationError("Kayıt sunucu tarafından kabul edildi ancak panel doğrulama verisi eksik veya farklı. Yeniden doğrulayabilirsiniz.");
        }
        const actualPanelFingerprint = panelConfigFingerprint(panelReadback && panelReadback.panelConfig);
        if (actualPanelFingerprint !== pending.expectedPanelConfigFingerprint) {
          throw createPublishVerificationError("Kayıt sunucu tarafından kabul edildi ancak panel ayarları doğrulama verisiyle eşleşmedi. Yeniden doğrulayabilirsiniz.");
        }
      }

      completePublishedVerification(pending, {
        menuState: menuReadback && menuReadback.menuState,
        pricing: menuReadback && menuReadback.pricing,
        panelConfig: panelReadback && panelReadback.panelConfig
      });
      return Object.assign({}, pending.publishResult, {
        verified: true,
        publishRevision: state.publishRevision
      });
    } catch (error) {
      const verificationError = error && error.publishAccepted
        ? error
        : createPublishVerificationError("Kayıt sunucu tarafından kabul edildi ancak doğrulama isteği tamamlanamadı. Değişiklikleriniz korunuyor.", error);
      pending.lastError = verificationError.message;
      state.pendingPublishVerification = pending;
      state.saveStatus = "unverified";
      updateSaveControls(verificationError.message);
      throw verificationError;
    }
  }

  function retryPendingPublishVerification() {
    if (!state.pendingPublishVerification) {
      return Promise.resolve({ ok: true, unchanged: true, revision: state.publishRevision });
    }

    const operation = async () => {
      state.saving = true;
      state.saveStatus = "unverified";
      updateSaveControls("Kayıt yeniden doğrulanıyor");
      try {
        return await verifyPendingPublishReadback();
      } catch (error) {
        console.warn("Yayın readback doğrulaması başarısız:", error);
        alert(error.message || "Kayıt henüz doğrulanamadı. Değişiklikleriniz korunuyor.");
        throw error;
      } finally {
        state.saving = false;
        updateSaveControls();
      }
    };

    return saveCoordinator
      ? saveCoordinator.run("admin-publish", operation, {
        button: els.saveChangesButton,
        busyText: "Doğrulanıyor...",
        onSettled: updateSaveControls
      })
      : operation();
  }

  function createPublishVerificationError(message, cause) {
    const error = new Error(message);
    error.code = "PUBLISH_VERIFICATION_FAILED";
    error.publishAccepted = true;
    if (cause) error.originalError = cause;
    return error;
  }

  function completePublishedVerification(pending, readback) {
    const snapshot = pending.snapshot;
    clearPublishedScopes(snapshot);
    persistPublishedSnapshot(snapshot, readback);
    state.pendingPublishVerification = null;
    state.saveStatus = hasPendingChanges() ? "dirty" : "published";
    if (snapshot.changes.menuState && window.MenuSuiteLivePreview && typeof window.MenuSuiteLivePreview.markPublished === "function") {
      window.MenuSuiteLivePreview.markPublished(snapshot.previewSnapshot);
    }
    if (snapshot.changes.menuState && state.channel) state.channel.postMessage({ type: "menu-updated", time: Date.now() });
    if (snapshot.changes.menuState) {
      const identity = window.BrandIdentity;
      identity?.remember?.(readSiteInfoFromState(), {
        logoSelector: "[data-admin-brand-logo]",
        appId: "yonetici",
        kind: "admin",
        mode: document.body.dataset.panelTheme === "dark" ? "dark" : "light",
        fallbackName: "Yönetici Paneli"
      });
    }
    if (snapshot.changes.panelConfig) renderAdminThemePresets();
    updateSaveControls("Kayıt sunucudan doğrulandı");
  }

  function createPublishSnapshot() {
    const changes = {};
    const fingerprints = {};
    if (state.dirtyMenu) {
      changes.menuState = cloneData(state.data);
      if (!changes.menuState.pricing || typeof changes.menuState.pricing !== "object" || Array.isArray(changes.menuState.pricing)) {
        delete changes.menuState.pricing;
      }
    }
    if (state.dirtyPanelConfig) changes.panelConfig = normalizePanelConfig(state.panelConfig);
    Object.keys(changes).forEach((key) => { fingerprints[key] = JSON.stringify(changes[key]); });
    return {
      changes,
      fingerprints,
      previewSnapshot: {
        menuState: cloneData(state.data),
        pricing: cloneData(state.data && state.data.pricing || null)
      }
    };
  }

  function persistPublishedSnapshot(snapshot, readback) {
    if (snapshot.changes.menuState && snapshot.fingerprints.menuState === JSON.stringify(state.data)) {
      const canonicalMenuState = readback && readback.menuState
        ? readback.menuState
        : snapshot.changes.menuState;
      state.data = normalizeState(canonicalMenuState);
      if (readback && readback.pricing && typeof readback.pricing === "object") {
        state.data.pricing = cloneData(readback.pricing);
      }
    }
    if (snapshot.changes.panelConfig) {
      const canonicalPanelConfig = normalizePanelConfig(readback && readback.panelConfig || snapshot.changes.panelConfig);
      state.publishedPanelConfigFingerprint = panelConfigFingerprint(canonicalPanelConfig);
      state.publishedAdminThemePresetId = canonicalPanelConfig.appearance.adminThemePresetId;
      if (snapshot.fingerprints.panelConfig === panelConfigFingerprint(state.panelConfig)) {
        state.panelConfig = canonicalPanelConfig;
        safeLocalSet(PANEL_SETTINGS_KEY, JSON.stringify(state.panelConfig));
        applyPanelRuntimeSettings();
      }
    }
  }

  function clearPublishedScopes(snapshot) {
    if (snapshot.fingerprints.menuState === JSON.stringify(state.data)) state.dirtyMenu = false;
    if (snapshot.fingerprints.panelConfig === panelConfigFingerprint(state.panelConfig)) {
      state.dirtyPanelConfig = false;
      safeLocalRemove(PANEL_SETTINGS_DRAFT_KEY);
    }
  }

  function createRequestId(prefix) {
    const id = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${id}`;
  }

  function syncPublishRevision(result) {
    const revision = Number(result && (result.publishRevision ?? result.revision));
    if (Number.isSafeInteger(revision) && revision >= 0) state.publishRevision = Math.max(state.publishRevision, revision);
  }

  function ensureMenuThemeProfiles(settings) {
    const target = settings && typeof settings === "object" ? settings : state.data.settings;
    target.themeProfiles = MENU_DESIGN_SCHEMA.normalizeThemeProfiles(target.themeProfiles, target);
    return target.themeProfiles;
  }

  function activeMenuThemeProfile(settings) {
    const profiles = ensureMenuThemeProfiles(settings);
    return profiles[state.menuThemeEditorMode === "dark" ? "dark" : "light"];
  }

  function syncThemeProfileLegacyFields(settings) {
    const profiles = ensureMenuThemeProfiles(settings);
    const light = profiles.light;
    settings.bgColor = light.bgColor;
    settings.darkBgColor = profiles.dark.bgColor;
    settings.accentColor = light.accentColor;
    settings.textColor = light.textColor;
    settings.buttonTextColor = light.buttonTextColor;
    settings.cardColor = light.cardColor;
    settings.productCardColor = light.productCardColor;
    settings.categoryCardColor = light.categoryCardColor;
    settings.socialIconColor = light.socialIconColor;
    settings.menuBackground = cloneData(light.menuBackground);
    settings.menuBackgroundImage = light.menuBackground.imageUrl || light.menuBackground.image || "";
    settings.bottomActions = cloneData(light.bottomActions);
  }

  function handleMenuThemeModeChange(event) {
    const button = event.target.closest("[data-menu-theme-mode]");
    if (!button || !["light", "dark"].includes(button.dataset.menuThemeMode)) return;
    state.menuThemeEditorMode = button.dataset.menuThemeMode;
    renderForms();
  }

  function handleMenuThemePresetSelect(event) {
    const button = event.target.closest("[data-menu-theme-preset]");
    if (!button) return;
    const mode = state.menuThemeEditorMode === "dark" ? "dark" : "light";
    const preset = MENU_THEME_PRESETS[mode].find((item) => item.id === button.dataset.menuThemePreset);
    if (!preset) return;
    const settings = state.data.settings;
    ensureMenuThemeProfiles(settings)[mode] = createMenuThemeProfileFromPreset(preset, mode);
    syncThemeProfileLegacyFields(settings);
    saveAndRender();
  }

  function resetActiveMenuThemeProfile() {
    const mode = state.menuThemeEditorMode === "dark" ? "dark" : "light";
    const settings = state.data.settings;
    const defaults = MENU_DESIGN_SCHEMA.DEFAULT_THEME_PROFILES || DEFAULT_SETTINGS.themeProfiles;
    ensureMenuThemeProfiles(settings)[mode] = MENU_DESIGN_SCHEMA.normalizeThemeProfile(defaults[mode], defaults[mode]);
    syncThemeProfileLegacyFields(settings);
    saveAndRender();
  }

  function createMenuThemeProfileFromPreset(preset, mode) {
    const [background, surface, primary, accent, text] = preset.colors;
    const dark = mode === "dark";
    const buttonText = dark ? background : "#FFFFFF";
    const edge = dark ? background : surface;
    const actionText = dark ? text : "#FFFFFF";
    const profile = {
      presetId: preset.id,
      customized: false,
      bgColor: background,
      accentColor: primary,
      textColor: text,
      buttonTextColor: buttonText,
      cardColor: surface,
      productCardColor: surface,
      categoryCardColor: dark ? surface : background,
      socialIconColor: primary,
      menuBackground: {
        type: "gradient", color: background, image: "", imageUrl: "",
        gradientStart: background, gradientEnd: surface, gradientAngle: 150,
        overlay: dark ? 0.24 : 0.1, customized: false
      },
      bottomActions: {
        popular: {
          type: "gradient", color: dark ? surface : primary, image: "", imageUrl: "",
          gradientStart: dark ? edge : primary, gradientEnd: dark ? surface : accent,
          gradientAngle: 145, overlay: 0.1, textColor: actionText, customized: false
        },
        home: {
          type: "gradient", color: dark ? primary : surface, image: "", imageUrl: "",
          gradientStart: dark ? primary : surface, gradientEnd: dark ? accent : background,
          gradientAngle: 135, overlay: 0.08, textColor: dark ? background : text, customized: false
        },
        suggest: {
          type: "gradient", color: dark ? surface : primary, image: "", imageUrl: "",
          gradientStart: dark ? edge : primary, gradientEnd: dark ? surface : accent,
          gradientAngle: 145, overlay: 0.1, textColor: actionText, customized: false
        }
      }
    };
    const defaults = (MENU_DESIGN_SCHEMA.DEFAULT_THEME_PROFILES || DEFAULT_SETTINGS.themeProfiles)[mode];
    return MENU_DESIGN_SCHEMA.normalizeThemeProfile(profile, defaults);
  }

  function normalizeState(raw) {
    const sourceValue = MENU_DESIGN_SCHEMA.normalizeMenuState(raw);
    const settings = MENU_DESIGN_SCHEMA.normalizeSettings(sourceValue.settings);
    settings.menuBackground = normalizeBackground(settings.menuBackground, settings);
    settings.fonts = normalizeFonts(settings.fonts);
    settings.typography = normalizeTypography(settings.typography);
    settings.bottomActions = normalizeBottomActions(settings.bottomActions);
    settings.banner = normalizeBanner(settings.banner);
    delete settings["menu" + "Output"];
    const categories = Array.isArray(sourceValue.categories)
      ? sourceValue.categories.map((category, index) => normalizeCategory(category, index)).filter(Boolean)
      : [];
    return Object.assign({}, sourceValue, {
      settings,
      categories,
      pricing: sourceValue.pricing && typeof sourceValue.pricing === "object" ? cloneData(sourceValue.pricing) : null
    });
  }

  function normalizeCategory(category, index) {
    if (!category) return null;
    const source = MENU_DESIGN_SCHEMA.normalizeCategoryDesign(category, index);
    const id = source.id || makeId("cat", source.name || `Kategori ${index + 1}`);
    const style = normalizeStyle(source.style, {
      color: typeof source.color === "string" ? source.color : "",
      image: typeof source.image === "string" ? source.image : "",
      imageUrl: "",
      gradientStart: typeof source.color === "string" && source.color ? source.color : DEFAULT_SETTINGS.categoryCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 135,
      overlay: 0.12
    });

    return Object.assign({}, source, {
      id,
      name: source.name || "Kategori",
      active: source.active !== false,
      iconKey: normalizeCategoryIconKey(source.iconKey || source.icon, source.name),
      icon: CATEGORY_ICON_REGISTRY.getIconClass(normalizeCategoryIconKey(source.iconKey || source.icon, source.name)),
      color: typeof source.color === "string" ? source.color : style.color,
      image: typeof source.image === "string" ? source.image : (style.imageUrl || style.image || ""),
      style,
      products: Array.isArray(source.products)
        ? source.products.map((product, productIndex) => normalizeProduct(product, id, productIndex)).filter(Boolean)
        : []
    });
  }

  function normalizeCategoryIconKey(value, categoryName) {
    const key = String(value || "").trim();
    const allowed = CATEGORY_ICON_REGISTRY.options().some((item) => item.key === key);
    return allowed ? key : CATEGORY_ICON_REGISTRY.inferIconKey(categoryName);
  }

  function normalizeProduct(product, categoryId, index) {
    if (!product) return null;
    const sourceValue = MENU_DESIGN_SCHEMA.normalizeProductDesign(product, index);
    const prices = normalizePrices(sourceValue.prices || pricesFromLegacyProduct(sourceValue));
    const priceMode = normalizePriceMode(sourceValue, prices);
    const normalizedPrices = normalizePricesForMode(prices, priceMode);
    const style = normalizeStyle(sourceValue.style, {
      color: typeof sourceValue.cardColor === "string" ? sourceValue.cardColor : "",
      image: "",
      imageUrl: "",
      gradientStart: typeof sourceValue.cardColor === "string" && sourceValue.cardColor ? sourceValue.cardColor : DEFAULT_SETTINGS.productCardColor,
      gradientEnd: "#E5E7EB",
      gradientAngle: 145,
      overlay: 0
    });
    const normalized = Object.assign({}, sourceValue, {
      id: sourceValue.id || makeId(`${categoryId}-urun`, sourceValue.name || `Ürün ${index + 1}`),
      name: sourceValue.name || "Ürün",
      desc: sourceValue.desc || "",
      active: sourceValue.active !== false,
      stock: sourceValue.stock || (sourceValue.soldOut ? "sold-out" : "active"),
      image: typeof sourceValue.image === "string" ? sourceValue.image : String(sourceValue.img || ""),
      imageUrl: typeof sourceValue.imageUrl === "string" ? sourceValue.imageUrl : "",
      imageOverlay: Number.isFinite(Number(sourceValue.imageOverlay)) ? Number(sourceValue.imageOverlay) : 0,
      imageAspect: ["landscape", "square", "source"].includes(sourceValue.imageAspect) ? sourceValue.imageAspect : "landscape",
      imageFit: ["contain", "cover"].includes(sourceValue.imageFit) ? sourceValue.imageFit : "contain",
      cardColor: typeof sourceValue.cardColor === "string" ? sourceValue.cardColor : style.color,
      style,
      priceMode,
      prices: normalizedPrices,
      variants: normalizeVariants(sourceValue.variants, normalizedPrices, priceMode),
      pricing: sourceValue.pricing && typeof sourceValue.pricing === "object" ? cloneData(sourceValue.pricing) : null,
      popular: Boolean(sourceValue.popular),
      kind: sourceValue.kind || inferKind("", "", sourceValue.name || ""),
      temperature: sourceValue.temperature || inferTemperature("", "", sourceValue.name || ""),
      contentMode: ["manual", "hidden", "not-required"].includes(sourceValue.contentMode) ? sourceValue.contentMode : "manual",
      manualContent: String(sourceValue.manualContent || sourceValue.details && sourceValue.details.ingredients || sourceValue.ingredients || ""),
      order: Number.isFinite(Number(sourceValue.order)) ? Number(sourceValue.order) : index,
      details: {
        ingredients: sourceValue.details && sourceValue.details.ingredients || sourceValue.ingredients || ""
      }
    });
    ["rec" + "ipeId", "rec" + "ipeSize", "rec" + "ipeLinkStatus"].forEach((key) => delete normalized[key]);
    return normalized;
  }

  function normalizeBackground(bg, settings) {
    return MENU_DESIGN_SCHEMA.normalizeBackground(bg, settings || DEFAULT_SETTINGS);
  }

  function normalizeFonts(fonts) {
    return MENU_DESIGN_SCHEMA.normalizeFonts(fonts);
  }

  function normalizeTypography(typography) {
    return MENU_DESIGN_SCHEMA.normalizeTypography(typography);
  }

  function normalizeBottomActions(actions) {
    return MENU_DESIGN_SCHEMA.normalizeBottomActions(actions);
  }

  function normalizeBanner(banner) {
    return MENU_DESIGN_SCHEMA.normalizeBanner(banner);
  }

  function normalizeStyle(style, defaults) {
    return MENU_DESIGN_SCHEMA.normalizeStyle(style, defaults);
  }

  function ensureSelection() {
    if (!state.data.categories.length) {
      state.selectedCategoryId = "";
      state.selectedProductId = "";
      return;
    }
    if (!state.selectedCategoryId || !state.data.categories.some((category) => category.id === state.selectedCategoryId)) {
      state.selectedCategoryId = state.data.categories[0].id;
    }
    const category = selectedCategory();
    if (category && (!state.selectedProductId || !category.products.some((product) => product.id === state.selectedProductId))) {
      if (state.activeSection === "product" && state.allowEmptyProductSelection) {
        state.selectedProductId = "";
        return;
      }
      state.selectedProductId = category.products[0] ? category.products[0].id : "";
    }
  }

  function renderActiveSection(section) {
    const active = normalizePanelSection(section) || "overview";
    const procurementActive = Object.prototype.hasOwnProperty.call(PROCUREMENT_SECTION_VIEWS, active);
    if (!procurementActive && ["overview", "menu", "banner", "brand", "category", "product", "bulkPrice", "settings"].includes(active)) ensureSelection();
    applyAdminBrandIdentity();
    if (!procurementActive) {
      if (active === "overview") renderStats();
      else if (active === "bulkPrice") renderBulkPriceTools();
      else if (active === "brand") renderBrandSettings();
      else if (["menu", "banner", "category", "product"].includes(active)) {
        renderLists();
        renderForms();
      } else if (active === "dataCenter") renderDataImportCenter();
      else if (active === "settings") renderPanelSettings();
      else if (active === "staffAccess") renderStaffAccess();
      else if (active === "feedback") renderFeedbackInbox();
    }
    renderSections();
    if (!procurementActive && window.MenuSuitePricing && typeof window.MenuSuitePricing.syncFromAdmin === "function" && ["bulkPrice", "product"].includes(active)) {
      window.MenuSuitePricing.syncFromAdmin();
    }
    if (window.MenuSuiteLivePreview && typeof window.MenuSuiteLivePreview.notifyDraft === "function") window.MenuSuiteLivePreview.notifyDraft();
  }

  function renderSections() {
    const activeSection = normalizePanelSection(state.activeSection) || "overview";
    const procurementActive = Object.prototype.hasOwnProperty.call(PROCUREMENT_SECTION_VIEWS, activeSection);
    state.activeSection = activeSection;
    document.querySelectorAll("[data-section-panel]").forEach((section) => {
      section.hidden = section.dataset.sectionPanel !== activeSection;
    });
    if (els.contentGrid) els.contentGrid.hidden = procurementActive || [
      "overview", "dataCenter", "barcode", "locations", "approvals", "shipments",
      "receipts", "permissions", "audit"
    ].includes(activeSection);
    if (els.panelShell) {
      els.panelShell.dataset.activeSection = activeSection;
      els.panelShell.dataset.procurementActive = String(procurementActive);
    }
    if (els.contentGrid) els.contentGrid.classList.add("is-wide");
    if (els.workspaceTitle) els.workspaceTitle.textContent = SECTION_TITLES[activeSection];
    const topbarDescription = document.querySelector(".topbar-description");
    if (topbarDescription) topbarDescription.textContent = SECTION_DESCRIPTIONS[activeSection] || "Stok operasyonunuzu PAKET 3 çalışma düzeninde yönetin.";
    document.querySelectorAll("[data-panel-section]").forEach((link) => {
      link.classList.toggle("is-active", link.dataset.panelSection === activeSection);
    });
    syncProcurementModule(activeSection);
    if (window.MenuSuiteLivePreview && typeof window.MenuSuiteLivePreview.updateSection === "function") {
      const previewSection = activeSection === "staffAccess" && typeof window.__MENU_SUITE_WORKFORCE_PREVIEW_SECTION__ === "function"
        ? window.__MENU_SUITE_WORKFORCE_PREVIEW_SECTION__()
        : activeSection;
      window.MenuSuiteLivePreview.updateSection(previewSection);
    }
  }

  async function loadStockOverview() {
    if (state.stockOverviewLoading) return;
    state.stockOverviewLoading = true;
    try {
      state.stockOverview = await backendRequest("/api/admin/stock/overview");
      if (state.activeSection === "overview") renderStats();
    } catch (error) {
      if (state.activeSection === "overview" && els.overviewGrid) els.overviewGrid.textContent = error.message || "Stok özeti alınamadı. Genel Bakış'ı yeniden açın.";
    } finally { state.stockOverviewLoading = false; }
  }

  function renderStats() {
    if (!state.stockOverview) {
      if (els.overviewGrid) els.overviewGrid.textContent = "Stok özeti yükleniyor…";
      void loadStockOverview();
      return;
    }
    const categories = state.stockOverview.categories;
    const products = state.stockOverview.products;
    const activeProducts = products.filter(product => product.active !== false).length;
    const soldOut = products.filter(product => product.active === false).length;
    const popular = state.stockOverview.criticalProducts;
    const menuIsOpen = activeProducts > 0;
    const summaryCards = [
      { label: "Toplam Kategori", value: categories.length, icon: "categories" },
      { label: "Toplam Ürün", value: products.length, icon: "products" },
      { label: "Aktif Ürün", value: activeProducts, icon: "active" },
      { label: "Aktif Depo", value: state.stockOverview.locationCount, icon: "live" },
      { label: "Pasif Ürün", value: soldOut, icon: "hidden", secondary: true },
      { label: "Kritik Ürün", value: popular, icon: "popular", secondary: true }
    ];
    const distribution = overviewCategoryDistribution(categories, products.length);
    const conicGradient = distribution.length
      ? `conic-gradient(${distribution.map((item) => `${item.color} ${item.start.toFixed(2)}% ${item.end.toFixed(2)}%`).join(", ")})`
      : "conic-gradient(#e7d8ca 0 100%)";
    const updateDate = state.stockOverview.updatedAt || new Date().toISOString();
    const updates = [
      { icon: "menu", title: "Ürün kataloğu güncel", meta: `${formatOverviewNumber(products.length)} ürün · ${formatOverviewTime(updateDate)}` },
      { icon: "categories", title: "Kategoriler hazır", meta: `${formatOverviewNumber(categories.length)} aktif yapı` },
      { icon: "popular", title: "Kritik stok özeti", meta: `${formatOverviewNumber(popular)} ürün` }
    ];
    els.overviewGrid.innerHTML = `
      <div class="overview-dashboard">
        <div class="overview-summary-grid" aria-label="Stok özeti">
          ${summaryCards.map((card) => `
            <article class="overview-summary-card${card.secondary ? " is-secondary" : ""}">
              <span class="overview-icon">${overviewIcon(card.icon)}</span>
              <div><span>${escapeHTML(card.label)}</span><strong>${typeof card.value === "number" ? formatOverviewNumber(card.value) : escapeHTML(card.value)}</strong></div>
              ${Object.hasOwn(card, "status") ? `<i class="overview-status-dot${card.status ? " is-open" : ""}" aria-label="${card.status ? "Stok sistemi açık" : "Stok sistemi kapalı"}"></i>` : ""}
            </article>`).join("")}
        </div>
        <div class="overview-main-grid">
          <article class="overview-panel overview-distribution-panel">
            <header><h3>Kategorilere Göre Ürün Dağılımı</h3></header>
            <div class="overview-distribution-content">
              <div class="overview-donut" style="background:${conicGradient}" role="img" aria-label="Toplam ${formatOverviewNumber(products.length)} ürünün kategori dağılımı"><div><strong>${formatOverviewNumber(products.length)}</strong><span>Toplam</span></div></div>
              <ul class="overview-legend">${distribution.map((item) => `<li><i style="--legend-color:${item.color}"></i><span>${escapeHTML(item.label)}</span><strong>${Math.round(item.percent)}%</strong></li>`).join("") || `<li><span>Henüz ürün yok</span><strong>0%</strong></li>`}</ul>
            </div>
          </article>
          <article class="overview-panel overview-updates-panel">
            <header><h3>Son Güncellemeler</h3></header>
            <div class="overview-update-list">${updates.map((item) => `<div class="overview-update-row"><span class="overview-icon is-small">${overviewIcon(item.icon)}</span><div><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.meta)}</small></div></div>`).join("")}</div>
            <button class="overview-list-action" type="button" data-overview-section="product">Ürünleri Yönet</button>
          </article>
          <article class="overview-panel overview-shortcuts-panel">
            <header><h3>Kısa Yollar</h3></header>
            <div class="overview-shortcut-list">
              <button type="button" data-overview-section="product"><span>${overviewIcon("products")}</span><strong>Ürün Yönetimi</strong><i>›</i></button>
              <button type="button" data-overview-section="barcode"><span>${overviewIcon("movement")}</span><strong>Depo</strong><i>›</i></button>
            </div>
          </article>
        </div>
      </div>`;
    if (els.miniStats) {
      const miniStats = [["Kategori", categories.length], ["Ürün", products.length], ["Aktif", activeProducts], ["Gizli/Tükendi", soldOut]];
      els.miniStats.innerHTML = miniStats.map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${formatOverviewNumber(value)}</strong></article>`).join("");
    }
  }

  function overviewIcon(name) {
    const paths = {
      categories: `<path d="M3.5 7.5h17v12h-17z"/><path d="M3.5 7.5 6 4.5h5l2 3"/>`,
      products: `<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>`,
      active: `<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>`,
      live: `<path d="M6 8h10a4 4 0 0 1 0 8H6zM8 5v3M13 4v4M7 19h10"/>`,
      hidden: `<path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.8 5.2A10.7 10.7 0 0 1 21 12a12 12 0 0 1-3.2 4.2M6.2 7.1A12 12 0 0 0 3 12a10.8 10.8 0 0 0 6.2 5.8"/>`,
      popular: `<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9z"/>`,
      menu: `<path d="M7 6h14M7 12h14M7 18h14"/><circle cx="3.5" cy="6" r=".7"/><circle cx="3.5" cy="12" r=".7"/><circle cx="3.5" cy="18" r=".7"/>`,
      movement: `<path d="M4 7h12M12 3l4 4-4 4M20 17H8M12 13l-4 4 4 4"/>`,
      count: `<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h3M8 16h3M15 12v5M12.5 14.5h5"/>`,
      banner: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m6 16 4-4 3 3 2-2 3 3"/>`
    };
    return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.active}</svg>`;
  }

  function overviewCategoryDistribution(categories, totalProducts) {
    const colors = ["var(--panel-primary)", "var(--panel-accent)", "var(--panel-muted)", "var(--panel-chip-text)", "var(--panel-line)"];
    const sorted = categories.map((category) => ({
      label: category.name,
      count: Array.isArray(category.products) ? category.products.length : 0
    })).sort((a, b) => b.count - a.count);
    const visible = sorted.slice(0, 4);
    const otherCount = sorted.slice(4).reduce((sum, item) => sum + item.count, 0);
    if (otherCount) visible.push({ label: "Diğer", count: otherCount });
    let cursor = 0;
    return visible.filter((item) => item.count > 0).map((item, index) => {
      const percent = totalProducts ? (item.count / totalProducts) * 100 : 0;
      const start = cursor;
      cursor += percent;
      return { ...item, percent, start, end: cursor, color: colors[index % colors.length] };
    });
  }

  function formatOverviewNumber(value) {
    return new Intl.NumberFormat("tr-TR").format(Number(value) || 0);
  }

  function formatOverviewTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Şimdi";
    return new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function renderBulkPriceTools() {
    if (window.MenuSuitePricing && typeof window.MenuSuitePricing.renderBulk === "function") {
      window.MenuSuitePricing.renderBulk();
    }
  }

  function syncAdminModalLock() {
    const modalOpen = Boolean(els.defaultChoiceModal && !els.defaultChoiceModal.hidden);
    document.documentElement.classList.toggle("is-panel-modal-open", modalOpen);
  }

  function procurementThemeSnapshot() {
    const style = getComputedStyle(document.documentElement);
    const names = [
      "--panel-canvas", "--panel-surface", "--panel-surface-soft", "--panel-ink", "--panel-muted",
      "--panel-line", "--panel-primary", "--panel-primary-hover", "--panel-accent", "--panel-success",
      "--panel-warning", "--panel-danger", "--panel-on-primary", "--panel-card-radius", "--panel-shadow"
    ];
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]).filter(([, value]) => value));
  }

  function postProcurementMessage(message) {
    const frame = document.getElementById("procurementModuleFrame");
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ source: "menu-suite:admin", ...message }, window.location.origin);
  }

  function setupProcurementBridge() {
    if (window.__MENU_SUITE_PROCUREMENT_BRIDGE__) return;
    window.__MENU_SUITE_PROCUREMENT_BRIDGE__ = true;
    window.addEventListener("message", (event) => {
      const frame = document.getElementById("procurementModuleFrame");
      if (!frame || event.origin !== window.location.origin || event.source !== frame.contentWindow) return;
      const message = event.data && typeof event.data === "object" ? event.data : {};
      if (message.source !== "menu-suite:procurement") return;
      if (message.type === "height") {
        const height = Math.min(5600, Math.max(520, Math.ceil(Number(message.height) || 0)));
        frame.style.height = `${height}px`;
        return;
      }
      if (message.type === "ready") {
        const host = document.getElementById("procurementModuleHost");
        const loading = document.getElementById("procurementModuleLoading");
        if (host) host.setAttribute("aria-busy", "false");
        if (loading) loading.hidden = true;
        const view = PROCUREMENT_SECTION_VIEWS[state.activeSection];
        if (view) {
          postProcurementMessage({ type: "view", view, section: state.activeSection, productId: state.pendingStockProductId || "", documentId: state.pendingProcurementDocumentId || "", notificationTarget: state.pendingNotificationTarget, force: false });
          state.pendingNotificationTarget = null;
          state.pendingStockProductId = "";
          state.pendingProcurementDocumentId = "";
        }
        postProcurementMessage({ type: "theme", theme: procurementThemeSnapshot() });
      }
    });
  }

  function syncProcurementModule(section) {
    const host = document.getElementById("procurementModuleHost");
    const frame = document.getElementById("procurementModuleFrame");
    if (!host || !frame) return;
    const view = PROCUREMENT_SECTION_VIEWS[section];
    host.hidden = !view;
    if (!view) { state.pendingProcurementDocumentId = ""; postProcurementMessage({ type: "suspend" }); return; }
    frame.dataset.view = view;
    frame.dataset.section = section;
    if (!frame.getAttribute("src")) {
      host.setAttribute("aria-busy", "true");
      frame.setAttribute("src", `/yonetici/modules/tedarik-muhasebe/?embedded=1&view=${encodeURIComponent(view)}&panelSection=${encodeURIComponent(section)}&documents=20261008-v5&history=20261009-v1`);
      frame.addEventListener("load", () => {
        postProcurementMessage({ type: "view", view: frame.dataset.view || view, section: frame.dataset.section || section, productId: state.pendingStockProductId || "", force: false });
        state.pendingStockProductId = "";
        postProcurementMessage({ type: "theme", theme: procurementThemeSnapshot() });
      });
      return;
    }
    const documentId = host.getAttribute("aria-busy") !== "true" ? state.pendingProcurementDocumentId || "" : "";
    const notificationTarget = host.getAttribute("aria-busy") !== "true" ? state.pendingNotificationTarget : null;
    postProcurementMessage({ type: "view", view, section, productId: state.pendingStockProductId || "", documentId, notificationTarget, force: false });
    if (notificationTarget) state.pendingNotificationTarget = null;
    if (documentId) state.pendingProcurementDocumentId = "";
    state.pendingStockProductId = "";
    postProcurementMessage({ type: "theme", theme: procurementThemeSnapshot() });
  }

  function renderFeedbackInbox() {
    if (!els.feedbackList) return;
    const items = state.feedbackItems.slice();
    renderFeedbackInsights(items);
    const filter = state.feedbackFilter || "all";
    const favoriteCounts = favoriteRanking(items);
    const filtered = filter === "all"
      ? items
      : items.filter((item) => filter === "favori"
        ? normalizeFeedbackType(item.type) === "favori" || Boolean(item.favorite)
        : normalizeFeedbackType(item.type) === filter);
    if (filter === "favori") {
      filtered.sort((a, b) => {
        const aKey = favoriteKey(a.favorite);
        const bKey = favoriteKey(b.favorite);
        return (favoriteCounts.get(bKey) || 0) - (favoriteCounts.get(aKey) || 0)
          || new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
    }

    if (els.feedbackTabs) {
      els.feedbackTabs.querySelectorAll("[data-feedback-filter]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.feedbackFilter === filter);
      });
    }

    if (!filtered.length) {
      els.feedbackList.innerHTML = `
        <div class="feedback-empty-state">
          <strong>Kayıt yok</strong>
          <p>Müşteri mesajları, puanlamalar ve favori içecek tercihleri burada listelenecek.</p>
        </div>
      `;
      return;
    }

    const rankingHtml = filter === "favori" ? renderFavoriteRanking(favoriteCounts) : "";
    els.feedbackList.innerHTML = rankingHtml + `
      <div class="feedback-table" role="table" aria-label="Dilek ve şikayet kayıtları">
        <div class="feedback-table-row feedback-table-head" role="row">
          <span role="columnheader">Tarih</span>
          <span role="columnheader">Müşteri</span>
          <span role="columnheader">Kategori</span>
          <span role="columnheader">Puan / Detay</span>
          <span role="columnheader">Mesaj</span>
          <span role="columnheader">Favori içecek</span>
          <span role="columnheader">İşlem</span>
        </div>
        ${filtered.map((item) => {
      const type = normalizeFeedbackType(item.type);
      const count = favoriteCounts.get(favoriteKey(item.favorite)) || 0;
      const favorite = String(item.favorite || "").trim();
      const text = String(item.text || "").trim();
      const emptyText = type === "puanlama" ? "Sadece puanlama gönderildi." : "Metin girilmedi.";
      return `
          <div class="feedback-table-row${String(item.id || "") === state.focusedFeedbackId ? " is-targeted" : ""}" role="row" data-feedback-id="${escapeAttribute(String(item.id || ""))}">
            <span class="feedback-date" role="cell">${escapeHTML(formatFeedbackDate(item.createdAt) || "-")}</span>
            <span class="feedback-customer" role="cell">
              <strong>${escapeHTML(feedbackCustomerName(item))}</strong>
              <small>${escapeHTML(feedbackCustomerDetail(item))}</small>
            </span>
            <span role="cell"><em class="feedback-type-badge is-${escapeAttribute(type)}">${escapeHTML(feedbackTypeLabel(type))}</em></span>
            <span class="feedback-rating-cell" role="cell">${escapeHTML(feedbackStars(item.rating))}${type === "favori" && count ? `<small>${count} tercih</small>` : ""}</span>
            <span class="feedback-message-cell" role="cell">${escapeHTML(text || emptyText)}</span>
            <span class="feedback-favorite-cell" role="cell">${favorite ? `<strong>${escapeHTML(favorite)}</strong><small>Favori içecek</small>` : "<small>—</small>"}</span>
            <span class="feedback-actions-cell" role="cell">
              <button class="feedback-mini-action" type="button" data-feedback-view="${escapeAttribute(String(item.id || ""))}" aria-label="Kaydı görüntüle">Göz at</button>
            </span>
          </div>
        `;
        }).join("")}
      </div>
      `;
    if (state.focusedFeedbackId) {
      window.requestAnimationFrame(() => {
        const target = els.feedbackList && Array.from(els.feedbackList.querySelectorAll("[data-feedback-id]"))
          .find((row) => row.dataset.feedbackId === state.focusedFeedbackId);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        const action = target.querySelector("[data-feedback-view]");
        if (action) action.focus({ preventScroll: true });
      });
    }
  }

  async function refreshFeedbackInbox() {
    try {
      await loadFeedbackFromBackend({ noDedupe: true });
      renderFeedbackInbox();
      if (els.saveState) els.saveState.textContent = "Geri bildirim yenilendi";
    } catch (error) {
      console.warn("Geri bildirim backend'den alınamadı.", error);
      renderFeedbackInbox();
      if (els.saveState) els.saveState.textContent = error.message || "Geri bildirim alınamadı";
    }
    window.setTimeout(() => updateSaveControls(), 1200);
  }

  async function loadFeedbackFromBackend(options = {}) {
    if (!backendBaseUrl()) throw new Error("Backend adresi tanımlı değil.");
    const result = await backendRequest("/api/feedback", { noDedupe: Boolean(options.noDedupe) });
    if (!Array.isArray(result.feedbackItems)) throw new Error("Backend geri bildirim listesi geçersiz.");
    state.feedbackItems = normalizeFeedbackItems(result.feedbackItems);
    state.feedbackLoaded = true;
    state.loadedScopes.add("feedback");
    return state.feedbackItems;
  }

  function favoriteRanking(items) {
    const counts = new Map();
    items.forEach((item) => {
      const key = favoriteKey(item.favorite);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function renderFavoriteRanking(counts) {
    const ranked = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))
      .slice(0, 8);
    if (!ranked.length) return "";
    return `
      <div class="favorite-ranking">
        ${ranked.map(([name, count], index) => `
          <article>
            <span>${index + 1}</span>
            <strong>${escapeHTML(displayFavoriteName(name))}</strong>
            <small>${count} tercih</small>
          </article>
        `).join("")}
      </div>
    `;
  }

  function favoriteKey(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
  }

  function displayFavoriteName(value) {
    return String(value || "").replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("tr-TR"));
  }

  function renderFeedbackInsights(items) {
    if (!els.feedbackInsights) return;
    const total = items.length;
    const ratingItems = items.filter((item) => Number(item.rating || 0) > 0);
    const ratingTotal = ratingItems.reduce((sum, item) => sum + Number(item.rating || 0), 0);
    const average = ratingItems.length ? (ratingTotal / ratingItems.length).toFixed(1) : "0.0";
    const complaints = items.filter((item) => normalizeFeedbackType(item.type) === "sikayet").length;
    const suggestions = items.filter((item) => normalizeFeedbackType(item.type) === "oneri").length;
    const requests = items.filter((item) => normalizeFeedbackType(item.type) === "istek").length;
    const favorites = items.filter((item) => normalizeFeedbackType(item.type) === "favori" || String(item.favorite || "").trim()).length;
    const ratings = items.filter((item) => normalizeFeedbackType(item.type) === "puanlama").length;

    const insights = [
      ["Toplam kayıt", total],
      ["Yıldızlayan kişi", ratingItems.length],
      ["Ortalama puan", `${average}/5`],
      ["Puanlama", ratings],
      ["Şikayet", complaints],
      ["Öneri", suggestions],
      ["Dilek/İstek", requests],
      ["Favori içecek", favorites]
    ];

    els.feedbackInsights.innerHTML = insights.map(([label, value]) => (
      `<article class="feedback-insight"><span>${escapeHTML(label)}</span><strong>${escapeHTML(String(value))}</strong></article>`
    )).join("");
  }

  function feedbackCustomerName(item) {
    const value = item.customerName || item.displayName || item.name || item.customer || "";
    return String(value || "").trim() || "Anonim misafir";
  }

  function feedbackCustomerDetail(item) {
    const value = item.phoneMasked || item.maskedPhone || item.phone || item.customerPhone || item.memberId || item.customerId || item.id || "";
    return value ? String(value).trim() : "Kanal: Uygulama";
  }

  function handleFeedbackTabs(event) {
    const button = event.target.closest("[data-feedback-filter]");
    if (!button) return;
    state.feedbackFilter = button.dataset.feedbackFilter || "all";
    renderFeedbackInbox();
  }

  function handleFeedbackListClick(event) {
    const button = event.target.closest("[data-feedback-view]");
    if (!button) return;
    const item = state.feedbackItems.find((entry) => String(entry.id || "") === String(button.dataset.feedbackView || ""));
    if (!item) return;
    const details = [
      `Tarih: ${formatFeedbackDate(item.createdAt) || "-"}`,
      `Müşteri: ${feedbackCustomerName(item)}`,
      `Kategori: ${feedbackTypeLabel(normalizeFeedbackType(item.type))}`,
      `Puan: ${Number(item.rating || 0) > 0 ? `${clamp(Number(item.rating), 1, 5)}/5` : "-"}`,
      `Mesaj: ${String(item.text || "-")}`,
      `Favori içecek: ${String(item.favorite || "-")}`
    ];
    window.alert(details.join("\n"));
  }

  async function clearFeedbackItems() {
    if (!confirm("Dilek, istek, şikayet ve favori kayıtları sıfırlansın mı? Puanlamalar korunacak.")) return;
    if (!state.feedbackLoaded) {
      try {
        await loadFeedbackFromBackend({ noDedupe: true });
      } catch (error) {
        updateSaveControls(error.message || "Geri bildirim listesi alınamadı");
        return;
      }
    }
    const preservedRatings = state.feedbackItems
      .filter((item) => Number(item.rating || 0) > 0)
      .map((item) => ({
        id: `rating-${item.id || Date.now()}`,
        createdAt: item.createdAt || new Date().toISOString(),
        type: "puanlama",
        text: "Puanlama kaydı",
        favorite: "",
        rating: clamp(Number(item.rating || 0), 1, 5)
      }));
    try {
      const result = await backendRequest("/api/feedback", {
        method: "PUT",
        body: { feedbackItems: preservedRatings }
      });
      state.feedbackItems = normalizeFeedbackItems(result.feedbackItems || preservedRatings);
      state.feedbackLoaded = true;
      renderFeedbackInbox();
      if (els.saveState) els.saveState.textContent = "Kayıtlar sıfırlandı, puanlamalar korundu";
    } catch (error) {
      console.warn("Geri bildirim backend temizleme kaydedilemedi.", error);
      if (els.saveState) els.saveState.textContent = error.message || "Kayıtlar sıfırlanamadı";
    }
    window.setTimeout(() => {
      updateSaveControls();
    }, 1200);
  }

  function normalizeFeedbackItems(items) {
    return (Array.isArray(items) ? items : [])
      .map(normalizeFeedbackItem)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  function normalizeFeedbackItem(item) {
    const next = Object.assign({}, item);
    if (
      normalizeFeedbackType(next.type) === "istek"
      && Number(next.rating || 0) > 0
      && !String(next.favorite || "").trim()
      && String(next.text || "").trim().toLocaleLowerCase("tr-TR") === "puanlama kaydı"
    ) {
      next.type = "puanlama";
    }
    return next;
  }

  function normalizeFeedbackType(type) {
    if (type === "puanlama" || type === "puan" || type === "rating") return "puanlama";
    if (type === "sikayet" || type === "şikayet") return "sikayet";
    if (type === "oneri" || type === "öneri") return "oneri";
    if (type === "favori" || type === "favorite") return "favori";
    return "istek";
  }

  function feedbackTypeLabel(type) {
    return {
      istek: "İstek",
      puanlama: "Puanlama",
      sikayet: "Şikayet",
      oneri: "Öneri",
      favori: "Favori içecek"
    }[type] || "İstek";
  }

  function feedbackStars(value) {
    const rating = Math.round(clamp(Number(value || 0), 0, 5));
    return rating ? `${"★".repeat(rating)}${"\u2606".repeat(5 - rating)} ${rating}/5` : "Puan yok";
  }

  function formatFeedbackDate(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function renderLists() {
    const searchTerm = String(els.categorySearch && els.categorySearch.value || "").trim().toLocaleLowerCase("tr-TR");
    const visibleCategories = searchTerm
      ? state.data.categories.filter((category) => String(category.name || "").toLocaleLowerCase("tr-TR").includes(searchTerm))
      : state.data.categories;
    els.categoryList.innerHTML = visibleCategories.length ? visibleCategories.map((category) => `
      <button class="nav-row${category.id === state.selectedCategoryId ? " is-active" : ""}" type="button" data-category-id="${escapeAttribute(category.id)}" title="${escapeAttribute(category.name)}">
        <strong>${category.active ? "" : "Gizli · "}${escapeHTML(category.name)}</strong>
        <small>${category.products.length} ürün</small>
      </button>
    `).join("") : `<p class="category-search-empty" role="status">Eşleşen kategori bulunamadı.</p>`;

  }

  function renderForms() {
    const settings = state.data.settings;
    const profile = activeMenuThemeProfile(settings);
    const profileDefaults = (MENU_DESIGN_SCHEMA.DEFAULT_THEME_PROFILES || DEFAULT_SETTINGS.themeProfiles)[state.menuThemeEditorMode];
    els.bgColor.value = toColor(profile.bgColor, profileDefaults.bgColor);
    els.darkBgColor.value = toColor(settings.themeProfiles.dark.bgColor, DEFAULT_SETTINGS.darkBgColor);
    els.accentColor.value = toColor(profile.accentColor, profileDefaults.accentColor);
    els.textColor.value = toColor(profile.textColor, profileDefaults.textColor);
    els.buttonTextColor.value = toColor(profile.buttonTextColor, profileDefaults.buttonTextColor);
    if (els.cardColor) els.cardColor.value = toColor(profile.cardColor, toColor(profile.productCardColor, "#FFF9F0"));
    els.productCardColor.value = toColor(profile.productCardColor, profileDefaults.productCardColor);
    if (els.categoryCardColor) els.categoryCardColor.value = toColor(profile.categoryCardColor, profileDefaults.categoryCardColor);
    if (els.socialIconColor) els.socialIconColor.value = toColor(profile.socialIconColor, profileDefaults.socialIconColor);
    if (els.socialIconSize) els.socialIconSize.value = clamp(Number(settings.socialIconSize || DEFAULT_SETTINGS.socialIconSize), 18, 64);
    if (els.socialIconSizeValue && els.socialIconSize) els.socialIconSizeValue.textContent = `${els.socialIconSize.value}px`;
    const socialPreview = document.querySelector(".social-preview");
    if (socialPreview && els.socialIconColor && els.socialIconSize) {
      socialPreview.style.setProperty("--social-preview-color", els.socialIconColor.value);
      socialPreview.style.setProperty("--social-preview-size", `${els.socialIconSize.value}px`);
    }
    els.menuBgType.value = profile.menuBackground.type;
    els.menuGradientStart.value = toColor(profile.menuBackground.gradientStart, profile.bgColor);
    els.menuGradientEnd.value = toColor(profile.menuBackground.gradientEnd, toColor(profile.productCardColor, "#E5E7EB"));
    els.menuGradientAngle.value = profile.menuBackground.gradientAngle;
    els.menuBgUrl.value = profile.menuBackground.imageUrl || profile.menuBackground.image || "";
    els.menuOverlay.value = profile.menuBackground.overlay;
    els.menuUpdateDate.value = settings.menuUpdateDate || "";
    setFontSelectValue(els.titleFont, settings.fonts.title);
    setFontSelectValue(els.categoryFont, settings.fonts.category);
    setFontSelectValue(els.productFont, settings.fonts.product);
    const typography = normalizeTypography(settings.typography);
    els.menuTitleSize.value = typography.menuTitle;
    els.categoryTitleSize.value = typography.categoryTitle;
    els.productTitleSize.value = typography.productTitle;
    els.productDescSize.value = typography.productDesc;
    els.productIngredientsSize.value = typography.productIngredients;
    els.productPriceSize.value = typography.productPrice;
    renderActionStyleForm("popular", profile.bottomActions.popular);
    renderActionStyleForm("home", profile.bottomActions.home);
    renderActionStyleForm("suggest", profile.bottomActions.suggest);
    renderMenuThemeProfileEditor(settings, profile);
    renderMenuUiSummary(settings);
    renderBannerSettingsForm(settings.banner);

    const category = selectedCategory();
    if (category) {
      els.categoryEditorTitle.textContent = `${category.name} kategorisi`;
      els.categoryName.value = category.name;
      els.categoryActive.checked = category.active;
      renderCategoryIconOptions(category);
      els.categoryStyleType.value = category.style.type || "gradient";
      els.categoryColor.value = toColor(category.style.color || profile.categoryCardColor, profile.categoryCardColor);
      els.categoryGradientStart.value = toColor(category.style.gradientStart, DEFAULT_SETTINGS.categoryCardColor);
      els.categoryGradientEnd.value = toColor(category.style.gradientEnd, "#E5E7EB");
      els.categoryGradientAngle.value = category.style.gradientAngle;
      els.categoryImageUrl.value = category.style.imageUrl || category.style.image || "";
      els.categoryOverlay.value = category.style.overlay;
      els.bulkProductStyleType.value = "solid";
      els.bulkProductColor.value = toColor(profile.productCardColor, profile.productCardColor);
      els.bulkProductGradientStart.value = toColor(profile.productCardColor, profile.productCardColor);
      els.bulkProductGradientEnd.value = "#E5E7EB";
      els.bulkProductGradientAngle.value = 145;
      renderImagePreview(els.categoryImagePreview, category.style.imageUrl || category.style.image, "Kategori görseli yok");
    }
    els.productCategory.innerHTML = state.data.categories.map((item) => `<option value="${escapeAttribute(item.id)}">${escapeHTML(item.name)}</option>`).join("");
    renderProductNavigation();
    const product = selectedProductStrict();
    els.deleteProductButton.disabled = !product;
    if (els.productDetailsAccordion) {
      els.productDetailsAccordion.hidden = !product;
    }
    if (!product) {
      els.productEditorTitle.textContent = "Ürün Detayları";
      clearProductForm();
      return;
    }
    els.productEditorTitle.textContent = "Ürün Detayları";
    els.productName.value = product.name;
    els.productCategory.value = category ? category.id : "";
    els.productDesc.value = product.desc;
    els.priceMode.value = product.priceMode || "standard";
    els.standardPrice.value = product.prices.standard;
    els.priceK.value = product.prices.k;
    els.priceO.value = product.prices.o;
    els.priceB.value = product.prices.b;
    els.priceSingle.value = product.prices.single;
    els.priceDouble.value = product.prices.double;
    renderPriceModeFields();
    els.productStock.value = product.stock;
    els.productKind.value = product.kind;
    els.productTemperature.value = product.temperature;
    els.productPopular.checked = product.popular;
    els.productActive.checked = product.active;
    els.productStyleType.value = product.style.type === "solid" ? "solid" : "gradient";
    els.productColor.value = toColor(product.style.color || profile.productCardColor, profile.productCardColor);
    els.productGradientStart.value = toColor(product.style.gradientStart, DEFAULT_SETTINGS.productCardColor);
    els.productGradientEnd.value = toColor(product.style.gradientEnd, "#E5E7EB");
    els.productGradientAngle.value = product.style.gradientAngle;
    els.productImageUrl.value = product.imageUrl || product.image || "";
    els.productImageAspect.value = product.imageAspect;
    els.productImageFit.value = product.imageFit;
    els.productImageOverlay.value = product.imageOverlay;
    renderImagePreview(els.productImagePreview, product.imageUrl || product.image, "Ürün görseli yok", {
      aspect: product.imageAspect,
      fit: product.imageFit
    });
    els.productIngredients.value = product.manualContent || product.details.ingredients;
    if (els.productContentMode) els.productContentMode.value = ["manual", "hidden", "not-required"].includes(product.contentMode) ? product.contentMode : "manual";
  }

  function clearProductForm() {
    [
      "productName", "productDesc", "standardPrice", "priceK", "priceO", "priceB", "priceSingle", "priceDouble", "productImageUrl",
      "productIngredients"
    ].forEach((id) => {
      els[id].value = "";
    });
    els.priceMode.value = "standard";
    els.productStock.value = "active";
    els.productKind.value = "drink";
    els.productTemperature.value = "none";
    els.productPopular.checked = false;
    els.productActive.checked = true;
    els.productImageAspect.value = "landscape";
    els.productImageFit.value = "contain";
    if (els.productContentMode) els.productContentMode.value = "manual";
    renderPriceModeFields();
    renderImagePreview(els.productImagePreview, "", "Ürün görseli yok");
  }

  function renderProductNavigation() {
    if (!els.productCategoryTabs || !els.productQuickList) return;
    const category = selectedCategory();
    const product = selectedProductStrict();
    els.productCategoryTabs.innerHTML = `
      <label class="product-select-field">
        <span>Kategori seç</span>
        <select data-product-category-select>
          <option value="">Kategori seç</option>
          ${state.data.categories.map((item) => `
            <option value="${escapeAttribute(item.id)}"${category && item.id === category.id ? " selected" : ""}>${escapeHTML(item.name)}</option>
          `).join("")}
        </select>
      </label>
    `;

    els.productQuickList.innerHTML = `
      <label class="product-select-field">
        <span>Ürün seç</span>
        <select data-product-select${!category ? " disabled" : ""}>
          <option value="">Ürün seç</option>
          ${(category && category.products.length ? category.products : []).map((item) => `
            <option value="${escapeAttribute(item.id)}"${product && item.id === product.id ? " selected" : ""}>${escapeHTML(item.name)}</option>
          `).join("")}
        </select>
      </label>
      <p class="product-selection-status">${product ? `Seçili ürün: ${escapeHTML(product.name)} (${escapeHTML(category.name)})` : "Ürün seçilince detay alanı açılır."}</p>
    `;
  }

  function renderCategoryIconOptions(category) {
    if (!els.categoryIconKey) return;
    const current = normalizeCategoryIconKey(category.iconKey || category.icon, category.name);
    els.categoryIconKey.innerHTML = CATEGORY_ICON_REGISTRY.options().map((item) => (
      `<option value="${escapeAttribute(item.key)}">${escapeHTML(`${item.mark || ""} ${item.label}`.trim())}</option>`
    )).join("");
    els.categoryIconKey.value = current;
  }

  function handleProductCategoryTabs(event) {
    const select = event.target.closest("[data-product-category-select]");
    const button = event.target.closest("[data-product-category-tab]");
    if (!button && !select) return;
    state.selectedCategoryId = select ? select.value : button.dataset.productCategoryTab;
    const category = selectedCategory();
    state.allowEmptyProductSelection = Boolean(select);
    state.selectedProductId = select ? "" : (category && category.products[0] ? category.products[0].id : "");
    setActiveSection("product", { collapseSidebar: false, render: false });
    renderActiveSection("product");
  }

  function handleProductQuickList(event) {
    const select = event.target.closest("[data-product-select]");
    const button = event.target.closest("[data-product-chip]");
    if (!button && !select) return;
    state.selectedProductId = select ? select.value : button.dataset.productChip;
    if (!state.selectedProductId && button) state.selectedProductId = button.dataset.productChip;
    state.allowEmptyProductSelection = !state.selectedProductId;
    setActiveSection("product", { collapseSidebar: false, render: false });
    renderActiveSection("product");
  }

  function handleProductEditorCardClick(event) {
    const addButton = event.target.closest("[data-product-add-inline]");
    if (!addButton) return;
    event.preventDefault();
    event.stopPropagation();
    addProduct();
  }

  function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function isoDateForFile() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(date);
  }

  const DATA_IMPORT_SCOPES = Object.freeze([
    { key: "menu", input: "dataImportMenuFile", name: "dataImportMenuFileName", label: "Menü" },
    { key: "pricing", input: "dataImportPricingFile", name: "dataImportPricingFileName", label: "Fiyat" }
  ]);

  const DATA_IMPORT_DOMAINS = Object.freeze([
    { key: "catalog", label: "Menü + Fiyat", scopes: ["menu", "pricing"] }
  ]);

  function bindDataImportCenterEvents() {
    if (!els.dataImportCenter) return;
    DATA_IMPORT_SCOPES.forEach((scope) => {
      const input = els[scope.input];
      if (!input) return;
      input.addEventListener("change", () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        if (file && !/\.xlsx$/i.test(file.name)) {
          input.value = "";
          invalidateDataImportAnalysis();
          setDataImportMessage("Yalnızca .xlsx çalışma kitapları kabul edilir.", "error");
          state.dataImportCenter.files[scope.key] = null;
        } else {
          state.dataImportCenter.files[scope.key] = file;
          invalidateDataImportAnalysis();
        }
        renderDataImportCenter();
      });
    });
    els.dataImportCenter.addEventListener("click", (event) => {
      const clearButton = event.target.closest("[data-data-import-clear]");
      if (!clearButton || state.dataImportCenter.busy) return;
      clearDataImportFile(clearButton.dataset.dataImportClear);
    });
    if (els.dataImportAnalyze) els.dataImportAnalyze.addEventListener("click", analyzeDataImportFiles);
    if (els.dataImportApply) els.dataImportApply.addEventListener("click", applyDataImportAnalysis);
    if (els.dataImportReset) els.dataImportReset.addEventListener("click", resetDataImportCenter);
    if (els.dataImportRefreshHistory) els.dataImportRefreshHistory.addEventListener("click", () => loadDataImportHistory(true));
    if (els.dataImportHistoryList) els.dataImportHistoryList.addEventListener("click", handleDataImportHistoryAction);
    if (els.dataImportArchiveOnly) els.dataImportArchiveOnly.addEventListener("change", () => {
      state.dataImportCenter.archiveOnly = els.dataImportArchiveOnly.checked;
      renderDataImportAnalysis();
    });
    if (els.dataImportIssueScope) els.dataImportIssueScope.addEventListener("change", () => {
      state.dataImportCenter.issueScope = els.dataImportIssueScope.value || "all";
      renderDataImportAnalysis();
    });
    if (els.dataImportIssueCode) els.dataImportIssueCode.addEventListener("change", () => {
      state.dataImportCenter.issueCode = els.dataImportIssueCode.value || "all";
      renderDataImportAnalysis();
    });
  }

  function invalidateDataImportAnalysis() {
    const center = state.dataImportCenter;
    center.analysisEpoch += 1;
    center.analysis = null;
    center.lastResult = null;
    center.issueScope = "all";
    center.issueCode = "all";
    center.archiveOnly = false;
    center.message = "";
    center.messageType = "";
  }

  function clearDataImportFile(scopeKey) {
    const scope = DATA_IMPORT_SCOPES.find((item) => item.key === scopeKey);
    if (!scope) return;
    state.dataImportCenter.files[scope.key] = null;
    if (els[scope.input]) els[scope.input].value = "";
    invalidateDataImportAnalysis();
    renderDataImportCenter();
  }

  function resetDataImportCenter() {
    if (state.dataImportCenter.busy) return;
    DATA_IMPORT_SCOPES.forEach((scope) => {
      state.dataImportCenter.files[scope.key] = null;
      if (els[scope.input]) els[scope.input].value = "";
    });
    invalidateDataImportAnalysis();
    renderDataImportCenter();
  }

  function setDataImportMessage(message, type) {
    state.dataImportCenter.message = String(message || "");
    state.dataImportCenter.messageType = type || "info";
    renderDataImportCenter();
  }

  function setDataImportBusy(kind) {
    state.dataImportCenter.busy = kind || "";
    renderDataImportCenter();
  }

  async function analyzeDataImportFiles() {
    const center = state.dataImportCenter;
    if (center.busy) return;
    const selected = DATA_IMPORT_SCOPES.filter((scope) => center.files[scope.key]);
    if (!selected.length) {
      setDataImportMessage("Analiz için en az bir Excel dosyası seçin.", "error");
      return;
    }

    center.analysisEpoch += 1;
    const analysisEpoch = center.analysisEpoch;
    const selectedSignature = dataImportFileSelectionSignature(center.files);
    center.analysis = null;
    center.lastResult = null;
    center.issueScope = "all";
    center.issueCode = "all";
    center.archiveOnly = false;
    setDataImportBusy("analyze");
    center.message = "Dosyalar güvenli analiz için hazırlanıyor…";
    center.messageType = "info";
    renderDataImportCenter();
    try {
      const files = {};
      const encoded = await Promise.all(selected.map(async (scope) => ({
        key: scope.key,
        filename: center.files[scope.key].name,
        contentBase64: await fileToBase64(center.files[scope.key])
      })));
      encoded.forEach((item) => {
        files[item.key] = { filename: item.filename, contentBase64: item.contentBase64 };
      });
      const requestId = createRequestId("data-import-analysis");
      const result = await backendRequest("/api/admin/data-imports/analyze", {
        method: "POST",
        headers: { "X-Request-ID": requestId },
        body: { requestId, files }
      });
      if (analysisEpoch !== center.analysisEpoch || selectedSignature !== dataImportFileSelectionSignature(center.files)) {
        return;
      }
      center.analysis = normalizeDataImportAnalysis(result);
      center.lastResult = null;
      const hasErrors = Number(center.analysis.report && center.analysis.report.errorCount || 0) > 0
        || center.analysis.issues.some((issue) => dataImportIssueSeverity(issue) === "error");
      const hasChanges = dataImportAnalysisHasChanges(center.analysis);
      const applicableDomains = dataImportApplicableDomains(center.analysis);
      const blockedDomains = dataImportBlockedDomains(center.analysis);
      center.message = applicableDomains.length
        ? `Analiz tamamlandı. Uygulanmaya hazır: ${dataImportDomainListLabel(applicableDomains)}.${blockedDomains.length ? ` Engelli: ${dataImportDomainListLabel(blockedDomains)}.` : ""}`
        : hasErrors
          ? "Analiz tamamlandı; kritik kayıtlar giderilmeden uygulama yapılamaz."
          : hasChanges
            ? "Analiz tamamlandı; yalnız uyarı içeren kayıtları inceleyin."
            : "Analiz tamamlandı. Kalıcı veride uygulanacak yeni bir değişiklik bulunmadı.";
      center.messageType = applicableDomains.length ? (blockedDomains.length ? "warning" : "success") : (!hasChanges ? "success" : (hasErrors ? "error" : "warning"));
    } catch (error) {
      center.analysis = null;
      center.message = error.message || "Excel dosyaları analiz edilemedi.";
      center.messageType = "error";
    } finally {
      center.busy = "";
      renderDataImportCenter();
    }
  }

  async function applyDataImportAnalysis() {
    const center = state.dataImportCenter;
    const analysis = center.analysis;
    if (center.busy || !analysis || analysis.applied) return;
    if (!dataImportAnalysisHasChanges(analysis)) {
      setDataImportMessage("Analiz tamamlandı. Kalıcı veride uygulanacak değişiklik bulunmadığı için yeni bir işlem oluşturulmadı.", "success");
      return;
    }
    const applicableDomains = dataImportApplicableDomains(analysis);
    if (!applicableDomains.length) return;
    if (hasPendingChanges()) {
      setDataImportMessage("Kalıcı veri aktarımından önce mevcut taslak değişikliklerini Kaydet ile tamamlayın.", "error");
      return;
    }
    const blockedDomains = dataImportBlockedDomains(analysis);
    const report = analysis.report || {};
    const archived = Number(report.archived || 0);
    const requiresArchiveConfirmation = report.requiresArchiveConfirmation === true;
    const domainConfirmation = `Uygulanacak: ${dataImportDomainListLabel(applicableDomains)}.\nEngelli: ${blockedDomains.length ? dataImportDomainListLabel(blockedDomains) : "Yok"}.`;
    const confirmationMessage = requiresArchiveConfirmation
      ? `${domainConfirmation}\n\nBu aktarım ${archived} kaydı arşivleyecek ve ilgili canlı veri revizyonlarını güncelleyecek. Önizlemeyi kontrol ettiniz mi; atomik uygulamaya devam edilsin mi?`
      : `${domainConfirmation}\n\nÖnizlenen Excel değişiklikleri kalıcı store'a atomik olarak uygulansın mı?`;
    if (!window.confirm(confirmationMessage)) return;
    const requestId = createRequestId("data-import-apply");
    setDataImportBusy("apply");
    center.message = "Onaylanan analiz backend üzerinde atomik olarak uygulanıyor…";
    center.messageType = "info";
    renderDataImportCenter();
    try {
      const result = await backendRequest("/api/admin/data-imports/apply", {
        method: "POST",
        headers: { "Idempotency-Key": requestId, "X-Request-ID": requestId },
        body: {
          analysisId: analysis.analysisId,
          expectedRevision: analysis.expectedRevision,
          domains: applicableDomains,
          confirmArchiveImpact: requiresArchiveConfirmation,
          requestId
        }
      });
      syncPublishRevision(result);
      center.lastResult = result;
      center.analysis = Object.assign({}, analysis, { canApply: false, applied: true, appliedDomains: applicableDomains });
      center.message = `${dataImportDomainListLabel(applicableDomains)} kalıcı veriye uygulandı${blockedDomains.length ? `; ${dataImportDomainListLabel(blockedDomains)} uygulanmadı` : ""}${result.operationId ? ` · İşlem ${result.operationId}` : ""}.`;
      center.messageType = "success";
      await ensureSectionData("menu", { force: true });
      await loadDataImportHistory(true);
    } catch (error) {
      const staleAnalysis = error.status === 409 && /revizyon|analizden sonra|yeniden analiz/i.test(String(error.message || ""));
      if (staleAnalysis) {
        center.analysis = Object.assign({}, analysis, {
          canApply: false,
          domains: Object.fromEntries(Object.entries(analysis.domains || {}).map(([key, domain]) => [key, Object.assign({}, domain, { canApply: false })])),
          blockedReasons: ["Veri revizyonu analizden sonra değişti. Dosyaları yeniden analiz edin."]
        });
      }
      center.message = staleAnalysis
        ? "Veri revizyonu analizden sonra değişti. Dosyaları yeniden analiz edin."
        : (error.message || "Excel aktarımı uygulanamadı.");
      center.messageType = "error";
    } finally {
      center.busy = "";
      renderDataImportCenter();
    }
  }

  async function loadDataImportHistory(force) {
    const center = state.dataImportCenter;
    if (!els.dataImportHistoryList || (center.busy && !force)) return;
    if (center.historyLoaded && !force) {
      renderDataImportCenter();
      return;
    }
    const previousBusy = center.busy;
    if (!previousBusy) setDataImportBusy("history");
    try {
      const result = await backendRequest("/api/admin/data-imports/history?limit=50");
      center.history = Array.isArray(result.history)
        ? result.history
        : (Array.isArray(result.items) ? result.items : (Array.isArray(result.operations) ? result.operations : []));
      center.historyRevision = result.revision ?? result.currentRevision ?? center.historyRevision;
      center.historyLoaded = true;
    } catch (error) {
      center.message = error.message || "Aktarım geçmişi yüklenemedi.";
      center.messageType = "error";
    } finally {
      if (!previousBusy) center.busy = "";
      renderDataImportCenter();
    }
  }

  async function handleDataImportHistoryAction(event) {
    const button = event.target.closest("[data-data-import-undo]");
    const center = state.dataImportCenter;
    if (!button || center.busy || button.disabled) return;
    const operationId = button.dataset.dataImportUndo;
    const operation = center.history.find((item) => String(dataImportOperationId(item)) === String(operationId));
    if (!operation || !window.confirm("Bu Excel aktarımı güvenli bir geri alma işlemiyle geri alınsın mı?")) return;
    const requestId = createRequestId("data-import-undo");
    setDataImportBusy("undo");
    try {
      const expectedRevision = operation.expectedRevision
        ?? operation.currentRevision
        ?? center.historyRevision
        ?? operation.revision;
      const result = await backendRequest(`/api/admin/data-imports/${encodeURIComponent(operationId)}/undo`, {
        method: "POST",
        headers: { "Idempotency-Key": requestId, "X-Request-ID": requestId },
        body: { expectedRevision, requestId }
      });
      syncPublishRevision(result);
      center.lastResult = result;
      center.analysis = null;
      center.message = "Excel aktarımı backend tarafından güvenli biçimde geri alındı.";
      center.messageType = "success";
      await ensureSectionData("menu", { force: true });
      await loadDataImportHistory(true);
    } catch (error) {
      center.message = error.status === 409
        ? "Geri alma, sonradan yapılan değişiklikleri korumak için durduruldu. Geçmişi yenileyin."
        : (error.message || "Excel aktarımı geri alınamadı.");
      center.messageType = "error";
    } finally {
      center.busy = "";
      renderDataImportCenter();
    }
  }

  function normalizeDataImportAnalysis(result) {
    const source = result && result.analysis && typeof result.analysis === "object" ? result.analysis : (result || {});
    const report = source.report || result.report || source.summary || result.summary || {};
    const changes = Array.isArray(source.changes) ? source.changes : (Array.isArray(result.changes) ? result.changes : []);
    const issues = normalizeDataImportIssues(source, result);
    const legacyCanApplyValue = source.canApply ?? result.canApply;
    const domains = normalizeDataImportDomains(source, result, report, changes, issues, legacyCanApplyValue);
    return {
      analysisId: source.analysisId || result.analysisId || source.id || "",
      expectedRevision: source.expectedRevision ?? result.expectedRevision ?? source.baseRevision ?? result.baseRevision,
      report,
      changes,
      issues,
      domains,
      canApply: DATA_IMPORT_DOMAINS.some((domain) => domains[domain.key] && domains[domain.key].selected && domains[domain.key].canApply && domains[domain.key].changeCount > 0),
      workbookReports: source.workbookReports || source.fileReports || report.workbooks || report.byWorkbook || report.files || {},
      crossLinks: source.crossLinks || source.crossLinkSummary || report.crossLinks || report.links || {},
      blockedReasons: normalizeDataImportBlockedReasons(source, result, report),
      createdAt: source.createdAt || result.createdAt || new Date().toISOString(),
      applied: false
    };
  }

  function normalizeDataImportDomains(source, result, report, changes, issues, legacyCanApplyValue) {
    const raw = [
      source.domains, result.domains, source.domainReadiness, result.domainReadiness,
      source.domainResults, result.domainResults, report.domains, report.domainReadiness
    ].find((item) => item && typeof item === "object") || null;
    return DATA_IMPORT_DOMAINS.reduce((domains, definition) => {
      const aliases = ["catalog", "menupricing", "menu"];
      let value = null;
      if (Array.isArray(raw)) value = raw.find((item) => aliases.includes(dataImportDomainKey(item && (item.key || item.domain || item.name))));
      else if (raw) {
        const rawKey = Object.keys(raw).find((key) => aliases.includes(dataImportDomainKey(key)));
        value = rawKey ? raw[rawKey] : null;
      }
      const domainIssues = issues.filter((issue) => dataImportDomainForRecord(issue) === definition.key);
      const errorCount = dataImportDomainMetric(value, ["errorCount", "errors", "blockingErrorCount"], domainIssues.filter((issue) => dataImportIssueSeverity(issue) === "error").length);
      const warningCount = dataImportDomainMetric(value, ["warningCount", "warnings"], domainIssues.filter((issue) => dataImportIssueSeverity(issue) !== "error").length);
      const inferredChangeCount = changes.filter((change) => dataImportDomainForRecord(change) === definition.key).length;
      const changeCount = dataImportDomainMetric(value, ["changeCount", "changedCount", "changes", "totalChanges"], inferredChangeCount);
      const fileSelected = definition.scopes.some((scope) => Boolean(state.dataImportCenter.files[scope]));
      const selected = value && Object.prototype.hasOwnProperty.call(value, "selected")
        ? value.selected === true
        : (fileSelected || Boolean(value));
      const blockingIssuesValue = value && (value.blockingIssues || value.blockedReasons || value.blockingReasons || value.errors);
      const blockingIssues = (Array.isArray(blockingIssuesValue) ? blockingIssuesValue : (blockingIssuesValue ? [blockingIssuesValue] : []))
        .map((item) => typeof item === "string" ? item : (item.message || item.reason || item.code || ""))
        .filter(Boolean);
      if (!blockingIssues.length) domainIssues.filter((issue) => dataImportIssueSeverity(issue) === "error").forEach((issue) => {
        blockingIssues.push(issue.message || issue.reason || dataImportIssueCode(issue));
      });
      const explicitCanApply = value && (value.canApply ?? value.ready ?? value.isReady);
      const canApply = selected && (explicitCanApply !== undefined
        ? explicitCanApply === true
        : (legacyCanApplyValue !== undefined ? legacyCanApplyValue === true : errorCount === 0));
      domains[definition.key] = { selected, changeCount, warningCount, errorCount, canApply, blockingIssues };
      return domains;
    }, {});
  }

  function dataImportDomainMetric(source, keys, fallback) {
    if (source && typeof source === "object") {
      for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value)) return value.length;
        if (Number.isFinite(Number(value))) return Number(value);
      }
    }
    return Number(fallback || 0);
  }

  function normalizeDataImportBlockedReasons(source, result, report) {
    const candidates = [
      source.blockedReasons, source.blockReasons, source.applyBlockedReasons,
      result.blockedReasons, result.blockReasons, result.applyBlockedReasons,
      report.blockedReasons, report.blockReasons, report.applyBlockedReasons
    ];
    const reasons = candidates.find(Array.isArray) || [];
    const single = source.blockedReason || source.blockReason || result.blockedReason || result.blockReason || report.blockedReason || report.blockReason;
    return reasons.concat(single ? [single] : []).map((item) => typeof item === "string" ? item : (item.message || item.reason || item.code || "")).filter(Boolean);
  }

  function normalizeDataImportIssues(source, result) {
    const direct = Array.isArray(source.issues) ? source.issues : (Array.isArray(result.issues) ? result.issues : []);
    const report = source.report || result.report || {};
    const errors = Array.isArray(report.errors) ? report.errors.map((item) => Object.assign({ severity: "error" }, item)) : [];
    const warnings = Array.isArray(report.warnings) ? report.warnings.map((item) => Object.assign({ severity: "warning" }, item)) : [];
    return direct.concat(errors, warnings);
  }

  function renderDataImportCenter() {
    if (!els.dataImportCenter) return;
    const center = state.dataImportCenter;
    if (els.dataImportRevision && !center.analysis) {
      els.dataImportRevision.textContent = center.historyRevision !== null && center.historyRevision !== undefined
        ? `Güncel revizyon ${formatDataImportValue(center.historyRevision)}`
        : "Revizyon bekleniyor";
    }
    const selectedCount = DATA_IMPORT_SCOPES.filter((scope) => center.files[scope.key]).length;
    DATA_IMPORT_SCOPES.forEach((scope) => {
      const file = center.files[scope.key];
      const card = els.dataImportCenter.querySelector(`[data-import-file-card="${scope.key}"]`);
      if (card) card.classList.toggle("has-file", Boolean(file));
      if (els[scope.name]) els[scope.name].textContent = file ? `${file.name} · ${formatDataImportFileSize(file.size)}` : "Henüz dosya seçilmedi.";
      if (els[scope.input]) els[scope.input].disabled = Boolean(center.busy);
      const clear = els.dataImportCenter.querySelector(`[data-data-import-clear="${scope.key}"]`);
      if (clear) {
        clear.hidden = !file;
        clear.disabled = Boolean(center.busy);
      }
    });
    if (els.dataImportFileCount) els.dataImportFileCount.textContent = `${selectedCount} / ${DATA_IMPORT_SCOPES.length} dosya`;
    if (els.dataImportAnalyze) {
      els.dataImportAnalyze.disabled = Boolean(center.busy) || selectedCount === 0;
      els.dataImportAnalyze.textContent = center.busy === "analyze" ? "Analiz Ediliyor…" : "Backend’de Analiz Et";
    }
    if (els.dataImportApply) {
      els.dataImportApply.disabled = Boolean(center.busy) || !center.analysis || !dataImportAnalysisHasChanges(center.analysis) || dataImportApplicableDomains(center.analysis).length === 0 || center.analysis.applied;
      els.dataImportApply.textContent = center.busy === "apply" ? "Uygulanıyor…" : "Onayla ve Atomik Uygula";
    }
    if (els.dataImportReset) els.dataImportReset.disabled = Boolean(center.busy) || (selectedCount === 0 && !center.analysis && !center.lastResult);
    if (els.dataImportRefreshHistory) {
      els.dataImportRefreshHistory.disabled = Boolean(center.busy);
      els.dataImportRefreshHistory.textContent = center.busy === "history" ? "Yükleniyor…" : "Geçmişi Yenile";
    }
    if (els.dataImportMessage) {
      els.dataImportMessage.hidden = !center.message;
      els.dataImportMessage.textContent = center.message;
      els.dataImportMessage.className = `data-import-message is-${center.messageType || "info"}`;
    }
    [els.dataImportArchiveOnly, els.dataImportIssueScope, els.dataImportIssueCode].forEach((control) => {
      if (control) control.disabled = Boolean(center.busy) || !center.analysis;
    });
    renderDataImportSteps();
    renderDataImportAnalysis();
    renderDataImportHistory();
  }

  function renderDataImportSteps() {
    const center = state.dataImportCenter;
    const steps = Array.from(els.dataImportCenter.querySelectorAll("[data-data-import-step]"));
    steps.forEach((step) => step.classList.remove("is-active", "is-complete"));
    if (center.lastResult) {
      steps.forEach((step) => step.classList.add("is-complete"));
      return;
    }
    const active = center.busy === "apply" ? "apply" : (center.analysis ? "preview" : (center.busy === "analyze" ? "analysis" : "files"));
    const order = ["files", "analysis", "preview", "apply"];
    steps.forEach((step) => {
      const index = order.indexOf(step.dataset.dataImportStep);
      const activeIndex = order.indexOf(active);
      step.classList.toggle("is-complete", index < activeIndex);
      step.classList.toggle("is-active", index === activeIndex);
    });
  }

  function renderDataImportAnalysis() {
    const center = state.dataImportCenter;
    const analysis = center.analysis;
    if (!els.dataImportAnalysis) return;
    els.dataImportAnalysis.hidden = !analysis;
    if (!analysis) return;
    if (els.dataImportRevision) els.dataImportRevision.textContent = analysis.expectedRevision !== undefined
      ? `Analiz revizyonu ${formatDataImportValue(analysis.expectedRevision)}`
      : "Analiz revizyonu backend tarafından saklanıyor";
    if (els.dataImportAnalysisMeta) els.dataImportAnalysisMeta.textContent = `${formatDateTime(analysis.createdAt) || "Şimdi"} · Analiz ${analysis.analysisId || "kimliği backend'de"}`;
    if (els.dataImportReadiness) {
      const hasChanges = dataImportAnalysisHasChanges(analysis);
      const ready = dataImportApplicableDomains(analysis);
      const blocked = dataImportBlockedDomains(analysis);
      els.dataImportReadiness.textContent = analysis.applied
        ? "Uygulandı"
        : (blocked.length && !ready.length
          ? "Uygulama engelli"
          : (!hasChanges ? "Değişiklik yok" : (ready.length ? (blocked.length ? "Kısmen hazır" : "Uygulamaya hazır") : "Uygulama engelli")));
      els.dataImportReadiness.className = `ui-badge ${analysis.applied || (ready.length && !blocked.length) ? "is-success" : (hasChanges ? "is-warning" : "")}`.trim();
    }
    if (els.dataImportStats) {
      els.dataImportStats.innerHTML = dataImportSummaryEntries(analysis.report).map((item) => `
        <article><span>${escapeHTML(item.label)}</span><strong>${escapeHTML(String(item.value))}</strong></article>
      `).join("");
    }

    renderDataImportDomains(analysis);
    renderDataImportWorkbookSummary(analysis);
    renderDataImportCrossLinkSummary(analysis);
    renderDataImportApplyBlocker(analysis);

    const allChanges = analysis.changes || [];
    const productCodeLookup = dataImportProductCodeLookup(allChanges);
    if (els.dataImportArchiveOnly) els.dataImportArchiveOnly.checked = Boolean(center.archiveOnly);
    const changes = center.archiveOnly ? allChanges.filter(isDataImportArchiveChange) : allChanges;
    if (els.dataImportChangeCount) {
      els.dataImportChangeCount.textContent = center.archiveOnly
        ? `${changes.length} / ${allChanges.length} kayıt`
        : `${allChanges.length} kayıt`;
    }
    if (els.dataImportChanges) {
      els.dataImportChanges.innerHTML = changes.length ? changes.slice(0, 400).map((change) => `
        <tr class="${isDataImportArchiveChange(change) ? "is-archive" : ""}">
          <td>${escapeHTML(dataImportScopeLabel(change.scope || change.workbook || change.sourceWorkbook))}</td>
          <td><strong>${escapeHTML(change.category || change.sheet || change.sourceSheet || "-")}</strong><small>${escapeHTML(change.product || change.name || change.item || "-")}</small></td>
          <td><code class="data-import-product-code">${escapeHTML(dataImportProductCode(change) || productCodeLookup.get(dataImportChangeIdentity(change)) || "-")}</code></td>
          <td>${escapeHTML(change.field || change.path || "-")}</td>
          <td>${escapeHTML(formatDataImportValue(change.oldValue ?? change.before))}</td>
          <td>${escapeHTML(formatDataImportValue(change.newValue ?? change.after))}</td>
          <td><span class="data-import-action-tag">${escapeHTML(change.operation || change.action || change.changeType || change.type || "Değişiklik")}</span><small>${escapeHTML(change.activeEffect || change.statusSource || change.statusOwner || "Durum korunur")}</small></td>
        </tr>
      `).join("") : `<tr><td colspan="7"><div class="empty-mini">${center.archiveOnly ? "Arşivlenecek kayıt bulunmadı." : "Değişiklik bulunmadı."}</div></td></tr>`;
    }

    const allIssues = analysis.issues || [];
    renderDataImportIssueFilterOptions(allIssues);
    const issues = allIssues.filter((issue) => {
      const scope = dataImportIssueScopeKey(issue);
      const code = dataImportIssueCode(issue);
      return (center.issueScope === "all" || center.issueScope === scope)
        && (center.issueCode === "all" || center.issueCode === code);
    });
    if (els.dataImportIssueCount) {
      const filtered = center.issueScope !== "all" || center.issueCode !== "all";
      els.dataImportIssueCount.textContent = filtered ? `${issues.length} / ${allIssues.length} kayıt` : `${allIssues.length} kayıt`;
    }
    if (els.dataImportIssues) {
      els.dataImportIssues.innerHTML = issues.length ? issues.slice(0, 300).map((issue) => `
        <article class="is-${escapeAttribute(dataImportIssueSeverity(issue))}">
          <div><strong>${escapeHTML(dataImportIssueScopeLabel(issue))}</strong><span>${escapeHTML(dataImportIssueCode(issue))}</span></div>
          <p class="data-import-issue-reason"><strong>Neden:</strong> ${escapeHTML(issue.message || issue.reason || "İnceleme gereken kayıt")}</p>
          <dl class="data-import-issue-detail">
            <div><dt>Dosya</dt><dd>${escapeHTML(issue.filename || issue.fileName || issue.file || issue.sourceFile || issue.workbook || issue.sourceWorkbook || "-")}</dd></div>
            <div><dt>Sayfa</dt><dd>${escapeHTML(issue.sheet || issue.sheetName || issue.sourceSheet || "-")}</dd></div>
            <div><dt>Satır</dt><dd>${escapeHTML(formatDataImportValue(issue.rowNumber || issue.row || issue.sourceRow))}</dd></div>
            <div><dt>Ürün</dt><dd>${escapeHTML(issue.product || issue.productName || issue.name || issue.item || "-")}</dd></div>
            <div><dt>Ürün Kodu</dt><dd><code class="data-import-product-code">${escapeHTML(dataImportProductCode(issue, true) || "-")}</code></dd></div>
          </dl>
        </article>
      `).join("") : `<div class="empty-mini">${allIssues.length ? "Seçili filtrelerle eşleşen kayıt yok." : "Uyarı veya hata bulunmadı."}</div>`;
    }
  }

  function renderDataImportDomains(analysis) {
    if (!els.dataImportDomains) return;
    els.dataImportDomains.innerHTML = DATA_IMPORT_DOMAINS.map((definition) => {
      const domain = analysis.domains && analysis.domains[definition.key] || {};
      const hasChanges = Number(domain.changeCount || 0) > 0;
      let statusKey = "not-selected";
      let statusLabel = "Seçilmedi";
      if (analysis.applied && (analysis.appliedDomains || []).includes(definition.key)) {
        statusKey = "ready";
        statusLabel = "Uygulandı";
      } else if (domain.selected) {
        if (!hasChanges && Number(domain.errorCount || 0) === 0) {
          statusKey = "unchanged";
          statusLabel = "Değişiklik yok";
        } else if (domain.canApply && hasChanges) {
          statusKey = "ready";
          statusLabel = "Uygulamaya hazır";
        } else {
          statusKey = "blocked";
          statusLabel = "Engelli";
        }
      }
      const blocking = Array.isArray(domain.blockingIssues) ? domain.blockingIssues.filter(Boolean) : [];
      return `<article class="data-import-domain-card is-${statusKey}">
        <header><strong>${escapeHTML(definition.label)}</strong><span>${escapeHTML(statusLabel)}</span></header>
        <dl><div><dt>Değişiklik</dt><dd>${Number(domain.changeCount || 0)}</dd></div><div><dt>Uyarı</dt><dd>${Number(domain.warningCount || 0)}</dd></div><div><dt>Hata</dt><dd>${Number(domain.errorCount || 0)}</dd></div></dl>
        ${blocking.length ? `<ul>${blocking.slice(0, 3).map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul>` : ""}
      </article>`;
    }).join("");
  }

  function renderDataImportWorkbookSummary(analysis) {
    if (!els.dataImportWorkbookSummary) return;
    const reports = analysis.workbookReports;
    const cards = DATA_IMPORT_SCOPES.map((scope) => {
      const source = Array.isArray(reports)
        ? reports.find((item) => dataImportScopeKey(item.scope || item.workbook || item.key) === scope.key)
        : (reports && (reports[scope.key] || reports[scope.label])) || {};
      const changes = analysis.changes.filter((item) => dataImportScopeKey(item.scope || item.workbook || item.sourceWorkbook) === scope.key).length;
      const issues = analysis.issues.filter((item) => dataImportScopeKey(item.scope || item.workbook || item.sourceWorkbook) === scope.key);
      const rows = firstImportMetric(source, ["readRows", "rowCount", "totalRows", "rowsRead"]);
      const errors = issues.filter((item) => dataImportIssueSeverity(item) === "error").length;
      const warnings = issues.length - errors;
      const file = state.dataImportCenter.files[scope.key];
      const included = Boolean(file || Object.keys(source || {}).length || changes || issues.length);
      if (!included) return "";
      return `<article>
        <header><strong>${escapeHTML(scope.label)}</strong><span>${escapeHTML(file ? file.name : "Backend raporu")}</span></header>
        <dl><div><dt>Satır</dt><dd>${rows}</dd></div><div><dt>Değişiklik</dt><dd>${changes}</dd></div><div><dt>Uyarı</dt><dd>${warnings}</dd></div><div><dt>Hata</dt><dd>${errors}</dd></div></dl>
      </article>`;
    }).filter(Boolean);
    els.dataImportWorkbookSummary.innerHTML = cards.length ? cards.join("") : `<div class="empty-mini">Dosya bazlı rapor bulunmadı.</div>`;
  }

  function renderDataImportCrossLinkSummary(analysis) {
    if (!els.dataImportCrossLinkSummary) return;
    const sourceValue = analysis.crossLinks && typeof analysis.crossLinks === "object" ? analysis.crossLinks : {};
    if (Array.isArray(sourceValue) && sourceValue.length) {
      els.dataImportCrossLinkSummary.innerHTML = sourceValue.map((item) => `<article><span>${escapeHTML(item.label || item.name || item.code || "Bağlantı")}</span><strong>${escapeHTML(formatDataImportValue(item.value ?? item.count ?? item.status))}</strong></article>`).join("");
      return;
    }
    const report = analysis.report || {};
    const definitions = [
      ["Kodla eşleşen", ["linkedByProductCode", "productCodeMatches", "codeMatches"]],
      ["Karşılıksız fiyat", ["orphanPrices", "unmatchedPrices", "unmatchedPricing"]],
      ["Kod çakışması", ["productCodeConflicts", "codeConflicts", "duplicateProductCodes"]]
    ];
    const entries = definitions.map(([label, keys]) => ({ label, value: firstImportMetric(sourceValue, keys) || firstImportMetric(report, keys) }));
    els.dataImportCrossLinkSummary.innerHTML = entries.map((item) => `<article class="${item.value ? "has-value" : ""}"><span>${escapeHTML(item.label)}</span><strong>${item.value}</strong></article>`).join("");
  }

  function renderDataImportApplyBlocker(analysis) {
    if (!els.dataImportApplyBlocker) return;
    const applicableDomains = dataImportApplicableDomains(analysis);
    const blockedDomains = dataImportBlockedDomains(analysis);
    if (analysis.applied || (!dataImportAnalysisHasChanges(analysis) && !blockedDomains.length) || (!blockedDomains.length && applicableDomains.length)) {
      els.dataImportApplyBlocker.hidden = true;
      els.dataImportApplyBlocker.innerHTML = "";
      return;
    }
    const reasons = blockedDomains.flatMap((domainKey) => {
      const domain = analysis.domains && analysis.domains[domainKey] || {};
      return (domain.blockingIssues || []).map((reason) => `${dataImportDomainLabel(domainKey)}: ${reason}`);
    }).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
    if (!reasons.length && !applicableDomains.length) {
      const errorIssues = analysis.issues.filter((issue) => dataImportIssueSeverity(issue) === "error");
      reasons.push(...[...analysis.blockedReasons, ...errorIssues.map((issue) => issue.message || issue.reason || dataImportIssueCode(issue))]
        .filter(Boolean).filter((item, index, list) => list.indexOf(item) === index));
    }
    if (!reasons.length && blockedDomains.length) reasons.push("Seçili veri alanı backend doğrulaması nedeniyle engelli.");
    if (!reasons.length && !analysis.changes.length) reasons.push("Kalıcı veride uygulanacak yeni bir değişiklik bulunmuyor.");
    if (!reasons.length) reasons.push("Backend bu analizi atomik uygulama için uygun bulmadı.");
    els.dataImportApplyBlocker.hidden = false;
    els.dataImportApplyBlocker.classList.toggle("is-partial", applicableDomains.length > 0);
    els.dataImportApplyBlocker.innerHTML = `<strong>${applicableDomains.length ? `${dataImportDomainListLabel(applicableDomains)} uygulanabilir; ${dataImportDomainListLabel(blockedDomains)} engelli` : "Uygulama engelli"}</strong><ul>${reasons.slice(0, 8).map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}</ul>`;
  }

  function renderDataImportIssueFilterOptions(issues) {
    const center = state.dataImportCenter;
    const scopes = [...new Set(issues.map(dataImportIssueScopeKey).filter(Boolean))].sort();
    const codes = [...new Set(issues.map(dataImportIssueCode).filter(Boolean))].sort();
    if (!scopes.includes(center.issueScope)) center.issueScope = "all";
    if (!codes.includes(center.issueCode)) center.issueCode = "all";
    if (els.dataImportIssueScope) {
      els.dataImportIssueScope.innerHTML = `<option value="all">Tümü</option>${scopes.map((scope) => `<option value="${escapeAttribute(scope)}">${escapeHTML(dataImportDomainKey(scope) === scope ? dataImportDomainLabel(scope) : dataImportScopeLabel(scope))}</option>`).join("")}`;
      els.dataImportIssueScope.value = center.issueScope;
    }
    if (els.dataImportIssueCode) {
      els.dataImportIssueCode.innerHTML = `<option value="all">Tümü</option>${codes.map((code) => `<option value="${escapeAttribute(code)}">${escapeHTML(code)}</option>`).join("")}`;
      els.dataImportIssueCode.value = center.issueCode;
    }
  }

  function dataImportProductCode(record, issueRecord) {
    if (!record || typeof record !== "object") return "";
    return String(record.productCode || record.product_code || record.externalProductCode || record.sourceProductCode || record.itemCode || record.sku || (!issueRecord ? record.code : "") || "").trim();
  }

  function dataImportProductCodeLookup(changes) {
    const lookup = new Map();
    changes.forEach((change) => {
      const direct = dataImportProductCode(change);
      const field = String(change && (change.field || change.path) || "").toLowerCase().replace(/[^a-z]/g, "");
      const fromField = field.includes("productcode") || field.includes("externalid")
        ? String(change.newValue ?? change.after ?? "").trim()
        : "";
      const code = direct || fromField;
      if (code) lookup.set(dataImportChangeIdentity(change), code);
    });
    return lookup;
  }

  function dataImportChangeIdentity(record) {
    return [
      dataImportScopeKey(record && (record.scope || record.workbook || record.sourceWorkbook)),
      String(record && (record.category || record.sheet || record.sourceSheet) || "").trim().toLocaleLowerCase("tr-TR"),
      String(record && (record.product || record.name || record.item) || "").trim().toLocaleLowerCase("tr-TR")
    ].join("|");
  }

  function dataImportIssueCode(issue) {
    return String(issue && (issue.issueCode || issue.code || issue.type || dataImportIssueSeverity(issue)) || "warning").trim().toLowerCase();
  }

  function dataImportIssueScopeKey(issue) {
    const value = issue && (issue.domain || issue.domainKey || issue.scope || issue.workbook || issue.sourceWorkbook);
    const domain = dataImportDomainKey(value);
    return DATA_IMPORT_DOMAINS.some((item) => item.key === domain) ? domain : dataImportScopeKey(value);
  }

  function dataImportIssueScopeLabel(issue) {
    const key = dataImportIssueScopeKey(issue);
    return DATA_IMPORT_DOMAINS.some((item) => item.key === key) ? dataImportDomainLabel(key) : dataImportScopeLabel(key);
  }

  function dataImportScopeKey(value) {
    const key = String(value || "").trim().toLowerCase();
    return key === "price" ? "pricing" : key;
  }

  function dataImportDomainKey(value) {
    const key = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    return ["catalog", "menupricing", "menuprice", "menu", "pricing", "price"].includes(key) ? "catalog" : key;
  }

  function dataImportDomainForRecord(record) {
    return dataImportDomainKey(record && (record.domain || record.domainKey || record.scope || record.workbook || record.sourceWorkbook));
  }

  function dataImportDomainLabel(value) {
    const key = dataImportDomainKey(value);
    const definition = DATA_IMPORT_DOMAINS.find((item) => item.key === key);
    return definition ? definition.label : String(value || "Veri alanı");
  }

  function dataImportDomainListLabel(values) {
    return values.map(dataImportDomainLabel).join(", ");
  }

  function dataImportApplicableDomains(analysis) {
    if (!analysis || !analysis.domains) return [];
    return DATA_IMPORT_DOMAINS.filter(({ key }) => {
      const domain = analysis.domains[key];
      return domain && domain.selected && domain.canApply === true && Number(domain.changeCount || 0) > 0;
    }).map(({ key }) => key);
  }

  function dataImportBlockedDomains(analysis) {
    if (!analysis || !analysis.domains) return [];
    return DATA_IMPORT_DOMAINS.filter(({ key }) => {
      const domain = analysis.domains[key];
      return domain && domain.selected && domain.canApply !== true && (Number(domain.changeCount || 0) > 0 || Number(domain.errorCount || 0) > 0 || (domain.blockingIssues || []).length > 0);
    }).map(({ key }) => key);
  }

  function isDataImportArchiveChange(change) {
    const operation = String(change && (change.operation || change.action || change.changeType || change.type) || "").toLowerCase();
    const effect = String(change && (change.activeEffect || change.statusSource || "") || "").toLowerCase();
    return operation.includes("archive") || operation.includes("remove") || effect.includes("deactivate")
      || (String(change && (change.field || change.path) || "").toLowerCase().includes("sourcepresent")
        && (change.newValue === false || change.after === false));
  }


  function renderDataImportHistory() {
    if (!els.dataImportHistoryList) return;
    const center = state.dataImportCenter;
    if (!center.historyLoaded && center.busy === "history") {
      els.dataImportHistoryList.innerHTML = `<div class="empty-mini">Aktarım geçmişi backend'den yükleniyor…</div>`;
      return;
    }
    if (!center.history.length) {
      els.dataImportHistoryList.innerHTML = `<div class="empty-mini">Henüz tamamlanmış Excel aktarımı yok.</div>`;
      return;
    }
    els.dataImportHistoryList.innerHTML = center.history.map((operation) => {
      const id = dataImportOperationId(operation);
      const scopes = dataImportHistoryScopes(operation);
      const historyState = dataImportHistoryState(operation);
      const canUndo = operation.canUndo === true && historyState.key === "applied" && !operation.undoneAt && !operation.undone;
      return `
        <article class="data-import-history-row ${historyState.key === "undone" ? "is-closed" : ""}">
          <div class="data-import-history-row__identity">
            <span>${escapeHTML(String(id || "İşlem"))}</span>
            <div><strong>${escapeHTML(scopes.length ? scopes.map(dataImportScopeLabel).join(" · ") : "Excel veri aktarımı")}</strong><small>${escapeHTML(formatDateTime(operation.createdAt || operation.analyzedAt || operation.appliedAt || operation.failedAt || operation.rolledBackAt || operation.timestamp) || "Tarih belirtilmedi")}</small></div>
          </div>
          <div class="data-import-history-row__summary">
            <span>Revizyon ${escapeHTML(formatDataImportValue(operation.revision ?? operation.resultRevision ?? operation.revisionAfter ?? operation.expectedRevision ?? "-"))}</span>
            <small>${escapeHTML(dataImportHistorySummary(operation))}</small>
          </div>
          <span class="data-import-history-status is-${historyState.key}">${escapeHTML(historyState.label)}</span>
          <button class="ui-button ui-button--secondary ui-button--sm" type="button" data-data-import-undo="${escapeAttribute(String(id || ""))}" ${canUndo && id ? "" : "disabled"}>Geri Al</button>
        </article>
      `;
    }).join("");
  }

  function dataImportAnalysisHasChanges(analysis) {
    if (!analysis || typeof analysis !== "object") return false;
    if (Array.isArray(analysis.changes) && analysis.changes.length > 0) return true;
    if (analysis.domains && DATA_IMPORT_DOMAINS.some(({ key }) => Number(analysis.domains[key] && analysis.domains[key].changeCount || 0) > 0)) return true;
    const report = analysis.report && typeof analysis.report === "object" ? analysis.report : {};
    const count = report.changeCount ?? report.changedCount ?? report.totalChanges ?? analysis.changeCount;
    return Number.isFinite(Number(count)) && Number(count) > 0;
  }

  function dataImportHistoryScopes(operation) {
    const direct = operation && (operation.changedScopes || operation.scopes || operation.importScope);
    if (Array.isArray(direct)) return direct.filter(Boolean);
    if (direct) return [direct];
    if (Array.isArray(operation && operation.files)) {
      return operation.files.map((file) => file && (file.workbook || file.scope || file.key)).filter(Boolean);
    }
    return Object.keys(operation && operation.files && typeof operation.files === "object" ? operation.files : {});
  }

  function dataImportHistoryState(operation) {
    const status = String(operation && (operation.status || operation.resultStatus) || "").toLocaleLowerCase("tr-TR");
    const validationStatus = String(operation && operation.validationStatus || "").toLocaleLowerCase("tr-TR");
    const failureState = `${status} ${validationStatus}`;
    const kind = String(operation && (operation.kind || operation.type) || "").toLocaleLowerCase("tr-TR");
    const validationFailed = failureState.includes("failed_readback")
      || failureState.includes("readback_failed")
      || failureState.includes("validation_failed")
      || failureState.includes("doğrulama_başarısız")
      || failureState.includes("dogrulama_basarisiz")
      || validationStatus === "failed"
      || validationStatus === "mismatch"
      || (validationStatus.includes("failed") && (operation.rollbackApplied || operation.rolledBackAt || operation.rollbackReason))
      || (status.includes("failed") && (operation.rollbackApplied || operation.rolledBackAt || operation.rollbackReason));
    if (validationFailed) {
      const rolledBack = Boolean(operation.rollbackApplied || operation.rolledBackAt || operation.undoneAt || operation.rollbackReason);
      return { key: "failed", label: rolledBack ? "Doğrulama başarısız — sistem geri aldı" : "Doğrulama başarısız" };
    }
    if (kind === "undo" || status === "undone" || status === "user_undone") {
      return { key: "undone", label: "Kullanıcı tarafından geri alındı" };
    }
    if (kind === "apply" && (operation.undoneAt || operation.undone)) {
      return { key: "undone", label: "Geri alındı" };
    }
    const unchanged = status === "unchanged" || status === "no_changes" || status === "no-change" || status === "no_change" || operation.unchanged === true;
    if (unchanged) return { key: "unchanged", label: "Değişiklik yok" };
    if (kind === "analysis" || kind === "analyze" || status === "analyzed" || status === "analysed") {
      const report = operation.report && typeof operation.report === "object" ? operation.report : {};
      const count = Number(operation.changeCount ?? report.changeCount ?? report.changedCount ?? 0);
      return count === 0
        ? { key: "unchanged", label: "Değişiklik yok" }
        : { key: "analyzed", label: "Analiz edildi" };
    }
    if (kind === "apply" || status === "applied" || status === "success" || status === "completed") {
      return { key: "applied", label: "Uygulandı" };
    }
    if (status.includes("failed")) return { key: "failed", label: "Doğrulama başarısız" };
    return { key: "analyzed", label: "Analiz edildi" };
  }

  function dataImportSummaryEntries(reportValue) {
    const report = reportValue && typeof reportValue === "object" ? reportValue : {};
    const definitions = [
      ["Okunan sayfa", ["readSheets", "sheetCount", "sheetsRead"]],
      ["Okunan satır", ["readRows", "rowCount", "totalRows", "rowsRead"]],
      ["Yeni kategori", ["newCategories", "createdCategories"]],
      ["Yeni ürün", ["newProducts", "createdProducts", "createdRecords"]],
      ["Güncellenecek", ["updatedProducts", "updatedRecords", "updatedCount"]],
      ["Değişiklik yok", ["unchanged", "unchangedCount"]],
      ["Arşivlenecek", ["archived", "archiveCount", "removedProducts"]],
      ["Yeniden bulunan", ["restored", "rediscovered", "reactivated"]],
      ["Manuel pasif", ["manualInactive", "manualInactivePreserved", "keptManualInactive"]],
      ["Geçersiz satır", ["invalidRows", "errorCount"]],
      ["Belirsiz eşleşme", ["ambiguousMatches", "ambiguousCount"]],
      ["Fiyatsız ürün", ["missingPrices", "missingPriceCount"]],
      ["Karşılıksız fiyat", ["orphanPrices", "unmatchedPrices", "unmatchedPricing"]],
    ];
    const values = definitions.map(([label, keys]) => ({ label, value: firstImportMetric(report, keys) }));
    return values.filter((item, index) => item.value !== 0 || index < 6);
  }

  function firstImportMetric(report, keys) {
    for (const key of keys) {
      const value = report[key] ?? (report.summary && report.summary[key]) ?? (report.counts && report.counts[key]);
      if (Number.isFinite(Number(value))) return Number(value);
    }
    return 0;
  }

  function dataImportOperationId(operation) {
    return operation && (operation.operationId || operation.id || operation.requestId || "");
  }

  function dataImportScopeLabel(value) {
    const key = String(value || "").toLowerCase();
    if (key === "menu") return "Menü";
    if (key === "pricing" || key === "price") return "Fiyat";
    return value ? String(value) : "Genel";
  }

  function dataImportIssueSeverity(issue) {
    const value = String(issue && (issue.severity || issue.level || issue.type) || "warning").toLowerCase();
    return ["critical", "fatal", "error"].includes(value) ? "error" : "warning";
  }

  function dataImportHistorySummary(operation) {
    const report = operation.report || operation.summary || {};
    const changed = Number(report.changedCount ?? report.updatedCount ?? operation.changedCount ?? 0);
    const created = Number(report.createdCount ?? report.newProducts ?? operation.createdCount ?? 0);
    const archived = Number(report.archivedCount ?? operation.archivedCount ?? 0);
    return `${created || 0} yeni · ${changed || 0} güncel · ${archived || 0} arşiv`;
  }

  function formatDataImportValue(value) {
    if (value === null) return "boş";
    if (value === undefined || value === "") return "-";
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch (_error) { return String(value); }
    }
    return String(value);
  }

  function formatDataImportFileSize(size) {
    const bytes = Number(size || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function dataImportFileSelectionSignature(files) {
    return DATA_IMPORT_SCOPES.map((scope) => {
      const file = files && files[scope.key];
      return file ? `${scope.key}:${file.name}:${file.size}:${file.lastModified || 0}` : `${scope.key}:-`;
    }).join("|");
  }

  async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return window.btoa(binary);
  }

  function renderPriceModeFields() {
    const mode = els.priceMode ? els.priceMode.value : "standard";
    if (els.standardPriceField) els.standardPriceField.hidden = mode !== "standard";
    if (els.sizePriceFields) els.sizePriceFields.hidden = mode !== "sizes";
    if (els.singleDoublePriceFields) els.singleDoublePriceFields.hidden = mode !== "singleDouble";
  }

  function renderImagePreview(target, src, emptyText, layout) {
    if (!target) return;
    const aspect = layout && ["landscape", "square", "source"].includes(layout.aspect) ? layout.aspect : "landscape";
    const fit = layout && ["contain", "cover"].includes(layout.fit) ? layout.fit : "contain";
    target.dataset.imageAspect = aspect;
    target.dataset.imageFit = fit;
    target.innerHTML = src
      ? `<img src="${escapeAttribute(src)}" alt=""><span>Önizleme hazır</span>`
      : `<span>${escapeHTML(emptyText)}</span>`;
  }

  function setFontSelectValue(select, value) {
    if (!select) return;
    if (!Array.from(select.options).some((option) => option.value === value)) {
      select.insertAdjacentHTML("beforeend", `<option value="${escapeAttribute(value)}">${escapeHTML(value)}</option>`);
    }
    select.value = value;
  }

  function renderActionStyleForm(prefix, style) {
    const normalized = normalizeStyle(style || DEFAULT_SETTINGS.bottomActions[prefix], DEFAULT_SETTINGS.bottomActions[prefix]);
    els[`${prefix}BoxType`].value = normalized.type || "solid";
    els[`${prefix}BoxColor`].value = toColor(normalized.color, DEFAULT_SETTINGS.bottomActions[prefix].color);
    els[`${prefix}GradientStart`].value = toColor(normalized.gradientStart, DEFAULT_SETTINGS.bottomActions[prefix].gradientStart);
    els[`${prefix}GradientEnd`].value = toColor(normalized.gradientEnd, DEFAULT_SETTINGS.bottomActions[prefix].gradientEnd);
    els[`${prefix}GradientAngle`].value = normalized.gradientAngle;
    els[`${prefix}ImageUrl`].value = normalized.imageUrl || normalized.image || "";
    els[`${prefix}Overlay`].value = normalized.overlay;
    if (prefix === "home" && els.homeTextColor) {
      els.homeTextColor.value = toColor(normalized.textColor, DEFAULT_SETTINGS.bottomActions.home.textColor);
    }
  }

  function renderMenuThemeProfileEditor(settings, profile) {
    const mode = state.menuThemeEditorMode === "dark" ? "dark" : "light";
    const presets = MENU_THEME_PRESETS[mode];
    const selectedPreset = presets.find((item) => item.id === profile.presetId);
    if (els.menuThemeProfileHeading) els.menuThemeProfileHeading.textContent = mode === "dark" ? "Karanlık Tema" : "Aydınlık Tema";
    if (els.menuProfileBgColorLabel) els.menuProfileBgColorLabel.textContent = mode === "dark" ? "Karanlık profil arka planı" : "Aydınlık profil arka planı";
    if (els.menuThemeModeSwitch) {
      els.menuThemeModeSwitch.querySelectorAll("[data-menu-theme-mode]").forEach((button) => {
        const selected = button.dataset.menuThemeMode === mode;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    }
    if (els.menuThemePresetGrid) {
      els.menuThemePresetGrid.innerHTML = presets.map((preset) => {
        const selected = preset.id === profile.presetId;
        const [background, surface, primary, accent] = preset.colors;
        return `
          <button class="menu-theme-preset-card${selected ? " is-selected" : ""}" type="button" data-menu-theme-preset="${escapeAttribute(preset.id)}" aria-pressed="${selected}" style="--preset-bg:${escapeAttribute(background)};--preset-surface:${escapeAttribute(surface)};--preset-primary:${escapeAttribute(primary)};--preset-accent:${escapeAttribute(accent)}">
            <span class="menu-theme-preset-card__check" aria-hidden="true">✓</span>
            <span class="menu-theme-preset-card__name">${escapeHTML(preset.name)}</span>
            <span class="menu-theme-preset-card__preview" aria-hidden="true"></span>
            <span class="menu-theme-preset-card__swatches" aria-hidden="true">${preset.colors.map((color) => `<i style="background:${escapeAttribute(color)}"></i>`).join("")}</span>
          </button>`;
      }).join("");
    }
    const activeName = selectedPreset ? selectedPreset.name : "Özel Tasarım";
    if (els.menuThemeProfileSummary) els.menuThemeProfileSummary.textContent = activeName;
    if (els.menuThemeProfileCustomState) els.menuThemeProfileCustomState.textContent = profile.customized ? "Özelleştirildi" : "Hazır taslak";
    if (els.menuThemeProfileSwatches) {
      const colors = [profile.bgColor, profile.cardColor, profile.accentColor, profile.categoryCardColor, profile.textColor];
      els.menuThemeProfileSwatches.innerHTML = colors.map((color) => `<i style="background:${escapeAttribute(color)}"></i>`).join("");
    }
    if (els.resetMenuThemeProfile) {
      els.resetMenuThemeProfile.textContent = mode === "dark"
        ? "Karanlık Temayı Varsayılana Döndür"
        : "Aydınlık Temayı Varsayılana Döndür";
    }
  }

  function renderMenuUiSummary(settings) {
    if (!settings) return;
    const profile = activeMenuThemeProfile(settings);
    const swatches = [
      [els.menuSummaryTheme, profile.bgColor],
      [els.menuSummaryDark, settings.themeProfiles.dark.bgColor],
      [els.menuSummaryAccent, profile.accentColor],
      [els.menuSummaryText, profile.textColor],
      [els.menuSummaryCard, profile.productCardColor]
    ];
    swatches.forEach(([element, value]) => {
      if (element) element.style.backgroundColor = toColor(value, "#F4EBDC");
    });
    if (els.menuSummaryThemeText) {
      const labels = { solid: "Düz renk", gradient: "Gradient", image: "Görsel" };
      els.menuSummaryThemeText.textContent = `${state.menuThemeEditorMode === "dark" ? "Karanlık" : "Aydınlık"} · ${labels[profile.menuBackground.type] || "Tema"}`;
    }
    if (els.menuSummaryAccentText) {
      els.menuSummaryAccentText.textContent = toColor(profile.accentColor, DEFAULT_SETTINGS.accentColor).toUpperCase();
    }
    if (els.menuOverlayValue) els.menuOverlayValue.textContent = `${Math.round(Number(profile.menuBackground.overlay || 0) * 100)}%`;
    const popular = normalizeStyle(profile.bottomActions.popular, DEFAULT_SETTINGS.bottomActions.popular);
    const home = normalizeStyle(profile.bottomActions.home, DEFAULT_SETTINGS.bottomActions.home);
    const suggest = normalizeStyle(profile.bottomActions.suggest, DEFAULT_SETTINGS.bottomActions.suggest);
    if (els.popularOverlayValue) els.popularOverlayValue.textContent = `${Math.round(Number(popular.overlay || 0) * 100)}%`;
    if (els.homeOverlayValue) els.homeOverlayValue.textContent = `${Math.round(Number(home.overlay || 0) * 100)}%`;
    if (els.suggestOverlayValue) els.suggestOverlayValue.textContent = `${Math.round(Number(suggest.overlay || 0) * 100)}%`;
  }

  function readActionStyleForm(prefix, previous, explicitChange) {
    const key = prefix;
    const imageUrl = els[`${key}ImageUrl`].value.trim();
    return normalizeStyle({
      type: els[`${key}BoxType`].value,
      color: els[`${key}BoxColor`].value,
      image: "",
      imageUrl,
      gradientStart: els[`${key}GradientStart`].value,
      gradientEnd: els[`${key}GradientEnd`].value,
      gradientAngle: Number(els[`${key}GradientAngle`].value || 145),
      overlay: Number(els[`${key}Overlay`].value || 0),
      textColor: key === "home" && els.homeTextColor
        ? els.homeTextColor.value
        : previous && previous.textColor || "",
      customized: explicitChange ? true : Boolean(previous && previous.customized)
    }, DEFAULT_SETTINGS.bottomActions[key]);
  }

  function renderBannerSettingsForm(bannerSettings) {
    const banner = normalizeBanner(bannerSettings);
    if (els.bannerMode) els.bannerMode.value = banner.mode;
    if (els.bannerTitle) els.bannerTitle.value = banner.title;
    if (els.bannerSubtitle) els.bannerSubtitle.value = banner.subtitle;
    if (els.bannerVideoUrl) els.bannerVideoUrl.value = banner.videoUrl;
    if (els.bannerImages) els.bannerImages.value = banner.images.map((item) => item.src).join("\n");
    renderBannerMediaList("videos", banner.videos);
    renderBannerMediaList("images", banner.images);
    renderBannerCategorySelect();
    renderBannerProductList(banner.productIds);
  }

  function renderBannerMediaList(kind, items) {
    const target = kind === "videos" ? els.bannerVideoList : els.bannerImageList;
    if (!target) return;
    const title = kind === "videos" ? "video" : "görsel";
    target.innerHTML = items.length
      ? items.map((item, index) => `
        <article class="banner-media-row" data-banner-media-kind="${escapeAttribute(kind)}" data-banner-media-index="${index}">
          <label>
            <span>Sıra</span>
            <input type="number" min="1" max="${items.length}" value="${index + 1}" data-banner-media-order>
          </label>
          <div class="banner-media-name">
            <strong>${escapeHTML(item.name || `${title} ${index + 1}`)}</strong>
            <small>${escapeHTML(formatFileSize(item.size))}</small>
          </div>
          <button class="danger-action" type="button" data-banner-media-delete>Sil</button>
        </article>
      `).join("")
      : `<div class="empty-mini">Henüz yüklenen ${title} yok.</div>`;
  }

  function renderBannerCategorySelect() {
    if (!els.bannerProductCategory) return;
    const categories = state.data.categories.filter((category) => category.active !== false);
    const current = els.bannerProductCategory.value;
    els.bannerProductCategory.innerHTML = categories.length
      ? categories.map((category) => `<option value="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</option>`).join("")
      : `<option value="">Kategori yok</option>`;
    if (categories.some((category) => category.id === current)) {
      els.bannerProductCategory.value = current;
    } else if (state.selectedCategoryId && categories.some((category) => category.id === state.selectedCategoryId)) {
      els.bannerProductCategory.value = state.selectedCategoryId;
    } else if (categories[0]) {
      els.bannerProductCategory.value = categories[0].id;
    }
  }

  function renderBannerProductList(selectedIds) {
    if (!els.bannerProductList) return;
    const selected = new Set(selectedIds || []);
    const categoryId = els.bannerProductCategory && els.bannerProductCategory.value || "";
    const query = normalizeText(els.bannerProductSearch && els.bannerProductSearch.value || "");
    const category = state.data.categories.find((item) => item.id === categoryId) || state.data.categories.find((item) => item.active !== false);
    const products = category
      ? category.products
        .filter((product) => product.active !== false)
        .filter((product) => !query || normalizeText(`${product.name} ${product.desc}`).includes(query))
      : [];
    els.bannerProductList.innerHTML = products.length
      ? products.map((product) => `
        <label class="banner-product-option">
          <input type="checkbox" value="${escapeAttribute(product.id)}" ${selected.has(product.id) ? "checked" : ""}>
          <span>${escapeHTML(product.name)}</span>
          <small>${escapeHTML(category ? category.name : "")}</small>
        </label>
      `).join("")
      : `<div class="empty-mini">Bu kategoride ürün bulunamadı.</div>`;
  }

  function readBannerForm(previous) {
    const previousIds = new Set(previous && previous.productIds || []);
    const visibleInputs = els.bannerProductList ? Array.from(els.bannerProductList.querySelectorAll("input[type='checkbox']")) : [];
    const visibleIds = new Set(visibleInputs.map((input) => input.value));
    visibleIds.forEach((id) => previousIds.delete(id));
    visibleInputs.filter((input) => input.checked).forEach((input) => previousIds.add(input.value));
    const previousVideos = Array.isArray(previous && previous.videos) ? previous.videos : [];
    const previousVideoUrl = String(previous && (previous.videoUrl || previous.video) || "").trim();
    const videoUrl = els.bannerVideoUrl ? els.bannerVideoUrl.value.trim() : previousVideoUrl;
    const videos = videoUrl === previousVideoUrl
      ? previousVideos
      : videoUrl ? [{ src: videoUrl, name: "Video", kind: "video" }] : [];
    const previousImages = Array.isArray(previous && previous.images) ? previous.images : [];
    const previousImageText = previousImages.map((item) => String(item && item.src || item || "")).join("\n");
    const imageText = els.bannerImages ? els.bannerImages.value.trim() : previousImageText;
    return normalizeBanner({
      mode: els.bannerMode ? els.bannerMode.value : previous && previous.mode,
      title: els.bannerTitle ? els.bannerTitle.value.trim() : previous && previous.title,
      subtitle: els.bannerSubtitle ? els.bannerSubtitle.value.trim() : previous && previous.subtitle,
      video: "",
      videoUrl,
      videos,
      images: imageText === previousImageText ? previousImages : imageText,
      productIds: Array.from(previousIds)
    });
  }

  async function handleBannerVideoUpload(event) {
    await appendBannerFiles(event.target, "videos", "video");
  }

  async function handleBannerImageUpload(event) {
    await appendBannerFiles(event.target, "images", "image");
  }

  async function appendBannerFiles(input, listName, kind) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    const banner = normalizeBanner(state.data.settings.banner);
    try {
      const mediaItems = [];
      for (const file of files) {
        mediaItems.push(await storeMediaFile(file, kind));
      }
      banner[listName].push(...mediaItems);
      banner.video = "";
      if (kind === "video") banner.videoUrl = banner.videos[0] ? banner.videos[0].src : "";
      banner.mode = kind === "video" ? "video" : "images";
      state.data.settings.banner = banner;
      saveAndRender();
    } catch (error) {
      console.error("Banner medyası yüklenemedi:", error);
      alert(`Medya backend'e yüklenemedi. ${error.message || "Dosya türünü, boyutunu ve oturumu kontrol edin."}`);
    } finally {
      input.value = "";
    }
  }

  function handleBannerMediaClick(event) {
    const button = event.target.closest("[data-banner-media-delete]");
    if (!button) return;
    const row = button.closest("[data-banner-media-kind]");
    if (!row) return;
    const kind = row.dataset.bannerMediaKind;
    const index = Number(row.dataset.bannerMediaIndex || -1);
    const banner = normalizeBanner(state.data.settings.banner);
    const list = kind === "videos" ? banner.videos : banner.images;
    const removed = list.splice(index, 1)[0];
    deleteStoredMediaItem(removed);
    if (kind === "videos") {
      banner.video = "";
      banner.videoUrl = banner.videos[0] ? banner.videos[0].src : "";
      if (!banner.videos.length && banner.mode === "video") banner.mode = "random";
    }
    if (kind === "images" && !banner.images.length && banner.mode === "images") banner.mode = "random";
    state.data.settings.banner = banner;
    saveAndRender();
  }

  function handleBannerMediaOrderChange(event) {
    const input = event.target.closest("[data-banner-media-order]");
    if (!input) return;
    const row = input.closest("[data-banner-media-kind]");
    if (!row) return;
    const kind = row.dataset.bannerMediaKind;
    const from = Number(row.dataset.bannerMediaIndex || -1);
    const banner = normalizeBanner(state.data.settings.banner);
    const list = kind === "videos" ? banner.videos : banner.images;
    if (from < 0 || from >= list.length) return;
    const to = clamp(Number(input.value || 1), 1, list.length) - 1;
    if (from === to) {
      renderBannerSettingsForm(banner);
      return;
    }
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    if (kind === "videos") {
      banner.video = "";
      banner.videoUrl = banner.videos[0] ? banner.videos[0].src : "";
    }
    state.data.settings.banner = banner;
    saveAndRender();
  }

  function readTypographyForm() {
    return normalizeTypography({
      menuTitle: els.menuTitleSize.value,
      categoryTitle: els.categoryTitleSize.value,
      productTitle: els.productTitleSize.value,
      productDesc: els.productDescSize.value,
      productIngredients: els.productIngredientsSize.value,
      productPrice: els.productPriceSize.value
    });
  }

  function updateSettingsFromForm(event) {
    const settings = state.data.settings;
    const profile = activeMenuThemeProfile(settings);
    const changedId = String(event && event.target && event.target.id || "");
    profile.bgColor = els.bgColor.value;
    profile.accentColor = els.accentColor.value;
    profile.textColor = els.textColor.value;
    profile.buttonTextColor = els.buttonTextColor.value;
    if (els.cardColor && changedId === "cardColor") profile.cardColor = els.cardColor.value;
    profile.productCardColor = els.productCardColor.value;
    if (els.categoryCardColor) profile.categoryCardColor = els.categoryCardColor.value;
    if (els.socialIconColor) profile.socialIconColor = els.socialIconColor.value;
    if (els.socialIconSize) settings.socialIconSize = clamp(Number(els.socialIconSize.value || DEFAULT_SETTINGS.socialIconSize), 18, 64);
    profile.menuBackground.type = els.menuBgType.value;
    if (changedId === "bgColor") profile.menuBackground.color = profile.bgColor;
    profile.menuBackground.gradientStart = els.menuGradientStart.value;
    profile.menuBackground.gradientEnd = els.menuGradientEnd.value;
    profile.menuBackground.gradientAngle = Number(els.menuGradientAngle.value || 160);
    profile.menuBackground.imageUrl = els.menuBgUrl.value.trim();
    profile.menuBackground.image = "";
    profile.menuBackground.overlay = Number(els.menuOverlay.value || 0);
    if (["menuBgType", "menuGradientStart", "menuGradientEnd", "menuGradientAngle", "menuBgUrl", "menuOverlay"].includes(changedId)) {
      profile.menuBackground.customized = true;
    }
    settings.menuUpdateDate = els.menuUpdateDate.value || "";
    settings.fonts = {
      title: els.titleFont.value || DEFAULT_SETTINGS.fonts.title,
      category: els.categoryFont.value || DEFAULT_SETTINGS.fonts.category,
      product: els.productFont.value || DEFAULT_SETTINGS.fonts.product
    };
    settings.typography = readTypographyForm();
    profile.bottomActions.popular = readActionStyleForm("popular", profile.bottomActions.popular, changedId.startsWith("popular"));
    profile.bottomActions.home = readActionStyleForm("home", profile.bottomActions.home, changedId.startsWith("home"));
    profile.bottomActions.suggest = readActionStyleForm("suggest", profile.bottomActions.suggest, changedId.startsWith("suggest"));
    const profileControl = [
      "bgColor", "accentColor", "textColor", "buttonTextColor", "cardColor", "productCardColor",
      "categoryCardColor", "socialIconColor", "menuBgType", "menuGradientStart", "menuGradientEnd",
      "menuGradientAngle", "menuBgUrl", "menuOverlay"
    ].includes(changedId) || /^(popular|home|suggest)/.test(changedId);
    if (profileControl) profile.customized = true;
    syncThemeProfileLegacyFields(settings);
    settings.banner = readBannerForm(settings.banner);
    saveAndRender();
  }

  function updateCategoryFromForm(event) {
    const category = selectedCategory();
    if (!category) return;
    category.name = els.categoryName.value.trim() || "Kategori";
    category.active = els.categoryActive.checked;
    category.iconKey = normalizeCategoryIconKey(els.categoryIconKey && els.categoryIconKey.value, category.name);
    category.icon = CATEGORY_ICON_REGISTRY.getIconClass(category.iconKey);
    category.style.type = els.categoryStyleType.value;
    category.style.color = els.categoryColor.value;
    category.color = category.style.color;
    category.style.gradientStart = els.categoryGradientStart.value;
    category.style.gradientEnd = els.categoryGradientEnd.value;
    category.style.gradientAngle = Number(els.categoryGradientAngle.value || 145);
    category.style.imageUrl = els.categoryImageUrl.value.trim();
    category.style.image = "";
    category.style.overlay = Number(els.categoryOverlay.value || 0);
    if (["categoryStyleType", "categoryColor", "categoryGradientStart", "categoryGradientEnd", "categoryGradientAngle", "categoryImageUrl", "categoryOverlay"].includes(String(event && event.target && event.target.id || ""))) {
      category.style.customized = true;
    }
    category.image = "";
    saveAndRender();
  }

  function updateProductFromForm(event) {
    const product = selectedProduct();
    if (!product) return;
    const currentCategory = selectedCategory();
    if (currentCategory && els.productCategory.value && els.productCategory.value !== currentCategory.id) {
      moveProductToCategory(product.id, currentCategory.id, els.productCategory.value);
      return;
    }
    product.name = els.productName.value.trim() || "Ürün";
    product.desc = els.productDesc.value.trim();
    product.active = els.productActive.checked;
    product.stock = els.productStock.value;
    product.kind = els.productKind.value;
    product.temperature = els.productTemperature.value;
    product.popular = els.productPopular.checked;
    const flexiblePricingHandled = Boolean(window.MenuSuitePricing
      && typeof window.MenuSuitePricing.writeProductFromForm === "function"
      && window.MenuSuitePricing.writeProductFromForm(product));
    if (!flexiblePricingHandled) {
      product.priceMode = ["sizes", "singleDouble"].includes(els.priceMode.value) ? els.priceMode.value : "standard";
      product.prices = normalizePricesForMode(normalizePrices({
        standard: els.standardPrice.value,
        k: els.priceK.value,
        o: els.priceO.value,
        b: els.priceB.value,
        single: els.priceSingle.value,
        double: els.priceDouble.value
      }), product.priceMode);
      product.variants = normalizeVariants(null, product.prices, product.priceMode);
    }
    product.style.type = els.productStyleType.value;
    product.style.color = els.productColor.value;
    product.cardColor = product.style.color;
    product.style.gradientStart = els.productGradientStart.value;
    product.style.gradientEnd = els.productGradientEnd.value;
    product.style.gradientAngle = Number(els.productGradientAngle.value || 145);
    if (["productStyleType", "productColor", "productGradientStart", "productGradientEnd", "productGradientAngle"].includes(String(event && event.target && event.target.id || ""))) {
      product.style.customized = true;
    }
    product.imageUrl = els.productImageUrl.value.trim();
    product.image = "";
    product.imageAspect = ["landscape", "square", "source"].includes(els.productImageAspect.value) ? els.productImageAspect.value : "landscape";
    product.imageFit = ["contain", "cover"].includes(els.productImageFit.value) ? els.productImageFit.value : "contain";
    product.imageOverlay = Number(els.productImageOverlay.value || 0);
    product.manualContent = els.productIngredients.value.trim();
    product.details.ingredients = product.manualContent;
    product.contentMode = els.productContentMode && ["manual", "hidden", "not-required"].includes(els.productContentMode.value)
      ? els.productContentMode.value : "manual";
    ["rec" + "ipeId", "rec" + "ipeSize", "rec" + "ipeLinkStatus"].forEach((key) => delete product[key]);
    saveAndRender();
  }

  function applyBulkProductImageUrl() {
    const url = els.bulkProductImageUrl.value.trim();
    if (!url) return;
    applyBulkProductImage(url, false);
  }

  function applyBulkProductImage(src, isEmbedded) {
    const category = selectedCategory();
    if (!category) return;
    category.products.forEach((product) => {
      product.imageUrl = src;
      product.image = "";
    });
    saveAndRender();
  }

  function clearBulkProductImages() {
    const category = selectedCategory();
    if (!category) return;
    category.products.forEach((product) => {
      product.image = "";
      product.imageUrl = "";
    });
    els.bulkProductImageUrl.value = "";
    saveAndRender();
  }

  function applyBulkProductStyle() {
    const category = selectedCategory();
    if (!category) return;
    const stylePatch = {
      type: els.bulkProductStyleType.value,
      color: els.bulkProductColor.value,
      gradientStart: els.bulkProductGradientStart.value,
      gradientEnd: els.bulkProductGradientEnd.value,
      gradientAngle: Number(els.bulkProductGradientAngle.value || 145)
    };
    category.products.forEach((product) => {
      product.style = normalizeStyle(Object.assign({}, product.style, stylePatch, { customized: true }));
      product.cardColor = product.style.color;
    });
    saveAndRender();
  }

  function addCategory() {
    const category = makeCategory(`Yeni Kategori ${state.data.categories.length + 1}`);
    state.data.categories.push(category);
    state.selectedCategoryId = category.id;
    state.selectedProductId = "";
    if (els.categorySearch) els.categorySearch.value = "";
    saveAndRender();
  }

  function addProduct() {
    const category = selectedCategory();
    if (!category) return;
    const product = makeProduct(`Yeni Ürün ${category.products.length + 1}`, category.id);
    category.products.push(product);
    state.selectedProductId = product.id;
    state.allowEmptyProductSelection = false;
    saveAndRender();
  }

  function deleteSelectedCategory() {
    const category = selectedCategory();
    if (!category) return;
    if (!confirm(`${category.name} kategorisi ve içindeki ürünler silinsin mi?`)) return;
    state.data.categories = state.data.categories.filter((item) => item.id !== category.id);
    ensureSelection();
    saveAndRender();
  }

  function deleteSelectedProduct() {
    const category = selectedCategory();
    const product = selectedProduct();
    if (!category || !product) return;
    if (!confirm(`${product.name} ürünü silinsin mi?`)) return;
    category.products = category.products.filter((item) => item.id !== product.id);
    state.selectedProductId = category.products[0] ? category.products[0].id : "";
    state.allowEmptyProductSelection = !state.selectedProductId;
    saveAndRender();
  }

  function moveProductToCategory(productId, fromCategoryId, toCategoryId) {
    const from = state.data.categories.find((category) => category.id === fromCategoryId);
    const to = state.data.categories.find((category) => category.id === toCategoryId);
    if (!from || !to) return;
    const index = from.products.findIndex((product) => product.id === productId);
    if (index < 0) return;
    const [product] = from.products.splice(index, 1);
    to.products.push(product);
    state.selectedCategoryId = to.id;
    state.selectedProductId = product.id;
    state.allowEmptyProductSelection = false;
    saveAndRender();
  }

  function saveAdminMenuDefault(event) {
    captureCurrentEditorState();
    openDefaultConfirmationModal("save-menu", event && event.currentTarget);
  }

  function saveAdminSystemDefault(event) {
    writeSiteInfoFromSettings({ dirty: false });
    openDefaultConfirmationModal("save-system", event && event.currentTarget);
  }

  function openDefaultChoiceModal(scope, trigger) {
    state.defaultModalScope = scope === "system" ? "system" : "menu";
    state.defaultModalMode = "restore";
    state.defaultModalTrigger = trigger || document.activeElement;
    configureDefaultChoiceModal();
    showDefaultChoiceModal();
  }

  function openDefaultConfirmationModal(mode, trigger) {
    state.defaultModalScope = mode === "save-system" ? "system" : mode === "device" ? "device" : "menu";
    state.defaultModalMode = mode;
    state.defaultModalTrigger = trigger || document.activeElement;
    configureDefaultChoiceModal();
    showDefaultChoiceModal();
  }

  function configureDefaultChoiceModal() {
    const mode = state.defaultModalMode;
    const scope = state.defaultModalScope;
    const isRestore = mode === "restore";
    const record = scope === "system" ? state.adminDefaults.systemSettings : state.adminDefaults.menuDesign;
    if (els.adminDefaultChoice) {
      els.adminDefaultChoice.hidden = !isRestore;
      els.adminDefaultChoice.disabled = isRestore && !record;
      els.adminDefaultChoice.setAttribute("aria-disabled", String(isRestore && !record));
    }
    if (isRestore && scope === "menu") {
      setDefaultModalCopy({
        kicker: "Sistem Genelinde Tasarım",
        title: "Menü tasarımı varsayılanına dön",
        description: "Seçilen varsayılan önce taslağa uygulanır. Uygulama yalnızca Kaydet işleminden sonra değişir.",
        factoryLabel: "İlk Tasarım Varsayılanı",
        factoryDescription: "Uygulamanın bej-kahverengi açık tema ve koyu kahverengi karanlık tema tasarımına döner.",
        adminDescription: "Yönetici tarafından sistem varsayılanı olarak kaydedilen son tasarımı yükler."
      });
    } else if (isRestore && scope === "system") {
      setDefaultModalCopy({
        kicker: "Sistem Genelindeki Bilgiler",
        title: "Sistem ayarları varsayılanına dön",
        description: "Seçilen marka ve iletişim bilgileri taslağa uygulanır; Kaydet işleminden önce uygulamaya yansımaz.",
        factoryLabel: "İlk Sistem Varsayılanı",
        factoryDescription: "Boş marka ve iletişim bilgilerini taslağa yükler.",
        adminDescription: "Yöneticinin sistem varsayılanı olarak kaydettiği son güvenli bilgileri yükler."
      });
    } else if (mode === "device") {
      setDefaultModalCopy({
        kicker: "Yalnızca Bu Cihaz",
        title: "Bu cihazın ayarları sıfırlansın mı?",
        description: "Son açık sekme, sidebar ve çıkış onayı gibi yalnızca bu tarayıcıdaki panel davranışları sıfırlanır.",
        factoryLabel: "Bu Cihazın Ayarlarını Sıfırla",
        factoryDescription: "Yayınlanmış menü ve marka verilerine dokunmaz."
      });
    } else {
      const system = mode === "save-system";
      setDefaultModalCopy({
        kicker: system ? "Sistem Genelindeki Bilgiler" : "Sistem Genelinde Tasarım",
        title: "Yönetici varsayılanı olarak kaydedilsin mi?",
        description: system
          ? "Mevcut marka ve iletişim bilgileri backend'de bütün yetkili cihazlar için kalıcı varsayılan olur."
          : "Mevcut taslağın yalnızca görsel tasarım alanları backend'de kalıcı varsayılan olur; ürün ve kategori içeriği kaydedilmez.",
        factoryLabel: "Yönetici Varsayılanını Kaydet",
        factoryDescription: "Revision kontrolü ve canonical readback doğrulamasıyla kaydedilir."
      });
    }
    if (els.adminDefaultChoiceMeta) {
      els.adminDefaultChoiceMeta.textContent = record && record.savedAt
        ? `Son kayıt: ${formatAdminDefaultDate(record.savedAt)}`
        : "Henüz Yönetici varsayılanı kaydedilmedi.";
    }
  }

  function setDefaultModalCopy(copy) {
    if (els.defaultChoiceKicker) els.defaultChoiceKicker.textContent = copy.kicker || "Varsayılan";
    if (els.defaultChoiceTitle) els.defaultChoiceTitle.textContent = copy.title || "Varsayılana dön";
    if (els.defaultChoiceDescription) {
      els.defaultChoiceDescription.textContent = copy.description || "";
      els.defaultChoiceDescription.classList.remove("is-error");
      els.defaultChoiceDescription.removeAttribute("role");
    }
    if (els.factoryDefaultLabel) els.factoryDefaultLabel.textContent = copy.factoryLabel || "Uygula";
    if (els.factoryDefaultDescription) els.factoryDefaultDescription.textContent = copy.factoryDescription || "";
    if (els.adminDefaultDescription && copy.adminDescription) els.adminDefaultDescription.textContent = copy.adminDescription;
  }

  function showDefaultChoiceModal() {
    if (!els.defaultChoiceModal) return;
    els.defaultChoiceModal.hidden = false;
    syncAdminModalLock();
    const first = els.defaultChoiceModal.querySelector("button:not([hidden]):not(:disabled)");
    window.setTimeout(() => first && first.focus(), 30);
  }

  function closeDefaultChoiceModal() {
    if (state.defaultOperationBusy) return;
    if (els.defaultChoiceModal) els.defaultChoiceModal.hidden = true;
    syncAdminModalLock();
    const trigger = state.defaultModalTrigger;
    state.defaultModalTrigger = null;
    if (trigger && typeof trigger.focus === "function") window.setTimeout(() => trigger.focus(), 20);
  }

  async function handleDefaultChoice(event) {
    const button = event.target.closest("[data-default-choice]");
    if (!button) {
      if (event.target === els.defaultChoiceModal && !state.defaultOperationBusy) closeDefaultChoiceModal();
      return;
    }
    const choice = button.dataset.defaultChoice;
    if (choice === "cancel") {
      closeDefaultChoiceModal();
      return;
    }
    if (button.disabled || state.defaultOperationBusy) return;
    if (state.defaultModalMode === "save-menu") return performSaveAdminMenuDefault();
    if (state.defaultModalMode === "save-system") return performSaveAdminSystemDefault();
    if (state.defaultModalMode === "device") {
      resetDevicePanelSettings();
      closeDefaultChoiceModal();
      return;
    }
    const applied = state.defaultModalScope === "menu" ? applyMenuDefault(choice) : applySystemDefault(choice);
    if (applied) closeDefaultChoiceModal();
  }

  async function performSaveAdminMenuDefault() {
    const revision = Number(state.adminDefaults.menuDesign && state.adminDefaults.menuDesign.revision || 0);
    const requestId = createRequestId("menu-default");
    const design = MENU_DESIGN_SCHEMA.createDesignSnapshot(state.data);
    setDefaultModalBusy(true, "Yönetici varsayılanı kaydediliyor...");
    try {
      const result = await backendRequest("/api/admin/defaults/menu-design", {
        method: "PUT",
        headers: { "Idempotency-Key": requestId },
        body: { requestId, revision, design }
      });
      const readback = await backendRequest("/api/admin/defaults/menu-design");
      if (!readback.menuDesign || MENU_DESIGN_SCHEMA.designSnapshotFingerprint(readback.menuDesign) !== MENU_DESIGN_SCHEMA.designSnapshotFingerprint(design)) {
        throw new Error("Yönetici varsayılanı kaydedildi ancak kalıcı okuma doğrulanamadı.");
      }
      state.adminDefaults.menuDesign = cloneData(readback.menuDesign || result.menuDesign);
      syncAdminDefaultUi();
      updateSaveControls(`Yönetici varsayılanı kaydedildi · ${formatAdminDefaultDate(state.adminDefaults.menuDesign.savedAt)}`);
      setDefaultModalBusy(false);
      closeDefaultChoiceModal();
    } catch (error) {
      setDefaultModalBusy(false);
      showDefaultModalError(error.message || "Yönetici varsayılanı kaydedilemedi.");
    }
  }

  async function performSaveAdminSystemDefault() {
    const revision = Number(state.adminDefaults.systemSettings && state.adminDefaults.systemSettings.revision || 0);
    const requestId = createRequestId("system-default");
    const settings = readSiteInfoFromState();
    setDefaultModalBusy(true, "Sistem varsayılanı kaydediliyor...");
    try {
      const result = await backendRequest("/api/admin/defaults/system-settings", {
        method: "PUT",
        headers: { "Idempotency-Key": requestId },
        body: { requestId, revision, settings }
      });
      const readback = await backendRequest("/api/admin/defaults/system-settings");
      if (!readback.systemSettings || JSON.stringify(readback.systemSettings.settings) !== JSON.stringify(settings)) {
        throw new Error("Sistem varsayılanı canonical readback ile eşleşmedi.");
      }
      state.adminDefaults.systemSettings = cloneData(readback.systemSettings || result.systemSettings);
      syncAdminDefaultUi();
      updateSaveControls(`Sistem varsayılanı kaydedildi · ${formatAdminDefaultDate(state.adminDefaults.systemSettings.savedAt)}`);
      setDefaultModalBusy(false);
      closeDefaultChoiceModal();
    } catch (error) {
      setDefaultModalBusy(false);
      showDefaultModalError(error.message || "Sistem varsayılanı kaydedilemedi.");
    }
  }

  function applyMenuDefault(choice) {
    const snapshot = choice === "admin"
      ? state.adminDefaults.menuDesign
      : MENU_DESIGN_SCHEMA.createFactoryDesignSnapshot(state.data);
    if (!snapshot) {
      showDefaultModalError("Henüz Yönetici varsayılanı kaydedilmedi.");
      return false;
    }
    state.data = normalizeState(MENU_DESIGN_SCHEMA.applyDesignSnapshot(state.data, snapshot));
    ensureSelection();
    saveAndRender();
    updateSaveControls(choice === "admin" ? "Yönetici varsayılanı taslağa uygulandı" : "İlk tasarım varsayılanı taslağa uygulandı");
    return true;
  }

  function applySystemDefault(choice) {
    const info = choice === "admin"
      ? state.adminDefaults.systemSettings && state.adminDefaults.systemSettings.settings
      : factorySystemSettings();
    if (!info) {
      showDefaultModalError("Henüz Yönetici varsayılanı kaydedilmedi.");
      return false;
    }
    applySiteInfoToState(cloneData(info), { dirty: true });
    renderBrandSettings();
    renderPanelSettings();
    updateSaveControls(choice === "admin" ? "Admin sistem varsayılanı taslağa uygulandı" : "İlk sistem varsayılanı taslağa uygulandı");
    return true;
  }

  function factorySystemSettings() {
    return cloneData(DEFAULT_SETTINGS.brandInfo);
  }

  function resetDevicePanelSettings() {
    const appearance = normalizePanelConfig(state.panelConfig).appearance;
    state.panelConfig = normalizePanelConfig({ ...DEFAULT_PANEL_CONFIG, appearance });
    savePanelConfig();
    safeLocalRemove(PANEL_SETTINGS_DEFAULT_KEY);
    safeLocalRemove(LAST_ACTIVE_SECTION_KEY);
    safeLocalRemove(SIDEBAR_STATE_KEY);
    renderPanelSettings();
    applyPanelRuntimeSettings();
    setSidebarCollapsed(defaultSidebarCollapsed(), { persist: false });
    updateSaveControls("Bu cihazın panel ayarları sıfırlandı");
    window.setTimeout(() => updateSaveControls(), 1400);
  }

  function setDefaultModalBusy(busy, message) {
    state.defaultOperationBusy = busy;
    if (!els.defaultChoiceModal) return;
    els.defaultChoiceModal.querySelectorAll("button").forEach((button) => { button.disabled = busy || (button === els.adminDefaultChoice && !defaultRecordForScope()); });
    if (els.defaultChoiceClose) els.defaultChoiceClose.disabled = busy;
    if (message && els.defaultChoiceDescription) els.defaultChoiceDescription.textContent = message;
  }

  function showDefaultModalError(message) {
    if (!els.defaultChoiceDescription) return;
    els.defaultChoiceDescription.textContent = message;
    els.defaultChoiceDescription.classList.add("is-error");
    els.defaultChoiceDescription.setAttribute("role", "alert");
  }

  function defaultRecordForScope() {
    return state.defaultModalScope === "system" ? state.adminDefaults.systemSettings : state.adminDefaults.menuDesign;
  }

  function trapDefaultChoiceFocus(event) {
    const focusable = Array.from(els.defaultChoiceModal.querySelectorAll("button:not([hidden]):not(:disabled)"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function syncAdminDefaultUi() {
    const menu = state.adminDefaults.menuDesign;
    const system = state.adminDefaults.systemSettings;
    if (els.menuDefaultMeta) els.menuDefaultMeta.textContent = menu && menu.savedAt
      ? `Son kayıt: ${formatAdminDefaultDate(menu.savedAt)} · revizyon ${menu.revision}`
      : "Henüz Yönetici varsayılanı kaydedilmedi.";
    if (els.systemDefaultMeta) els.systemDefaultMeta.textContent = system && system.savedAt
      ? `Son kayıt: ${formatAdminDefaultDate(system.savedAt)} · revizyon ${system.revision}. Değişiklikler yayınlanmadan public alana çıkmaz.`
      : "Henüz Yönetici varsayılanı kaydedilmedi. Değişiklikler yayınlanmadan herkese açık alana çıkmaz.";
  }

  function formatAdminDefaultDate(value) {
    const date = new Date(value || "");
    return Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(date)
      : "bilinmiyor";
  }

  function saveAndRender() {
    markDirty("menu");
    queueRenderAll();
  }

  function makeCategory(name) {
    return {
      id: makeId("cat", `${name}-${Date.now()}`),
      name,
      active: true,
      color: "",
      iconKey: normalizeCategoryIconKey("", name),
      icon: CATEGORY_ICON_REGISTRY.getIconClass(normalizeCategoryIconKey("", name)),
      image: "",
      style: normalizeStyle({
        color: DEFAULT_SETTINGS.categoryCardColor,
        gradientStart: DEFAULT_SETTINGS.categoryCardColor,
        gradientEnd: "#E5E7EB",
        gradientAngle: 135,
        overlay: 0.12
      }),
      products: []
    };
  }

  function makeProduct(name, categoryId) {
    return normalizeProduct({
      id: makeId(categoryId, `${name}-${Date.now()}`),
      name,
      prices: { standard: "", k: "", o: "", b: "", single: "", double: "" },
      active: true,
      stock: "active",
      kind: "drink",
      temperature: "none"
    }, categoryId, 0);
  }

  function selectedCategory() {
    return state.data.categories.find((category) => category.id === state.selectedCategoryId) || state.data.categories[0] || null;
  }

  function selectedProduct() {
    const category = selectedCategory();
    if (!category) return null;
    return category.products.find((product) => product.id === state.selectedProductId) || category.products[0] || null;
  }

  function selectedProductStrict() {
    const category = selectedCategory();
    if (!category || !state.selectedProductId) return null;
    return category.products.find((product) => product.id === state.selectedProductId) || null;
  }

  function flatProducts() {
    return state.data.categories.flatMap((category) => category.products.map((product) => ({ category, product })));
  }

  async function readImage(input, callback) {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const media = await storeMediaFile(file, "image");
      callback(media.src);
    } catch (error) {
      updateSaveControls(error.message || "Görsel yüklenemedi");
    } finally {
      input.value = "";
    }
  }

  function mediaRef(id) {
    return `${MEDIA_REF_PREFIX}${id}`;
  }

  function mediaIdFromRef(src) {
    const value = String(src || "");
    return value.startsWith(MEDIA_REF_PREFIX) ? value.slice(MEDIA_REF_PREFIX.length) : "";
  }

  function formatFileSize(size) {
    const bytes = Number(size || 0);
    if (!bytes) return "Boyut bilgisi yok";
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
  }

  function openMediaDb() {
    if (!window.indexedDB) return Promise.reject(new Error("Tarayıcı medya depolamayı desteklemiyor."));
    if (state.mediaDbPromise) return state.mediaDbPromise;
    state.mediaDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(MEDIA_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
          db.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Medya deposu acilamadi."));
    });
    return state.mediaDbPromise;
  }

  async function storeMediaFile(file, kind) {
    if (!backendBaseUrl() || !window.fetch) throw new Error("Medya yüklemek için backend bağlantısı gerekli.");
    return uploadMediaFile(file, kind);
  }

  async function uploadMediaFile(file, kind) {
    const result = await backendRequest("/api/media", {
      method: "POST",
      rawBody: file,
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || ""),
        "X-Media-Kind": kind
      }
    });
    const media = result && result.media;
    const src = media && (media.src || media.url);
    if (!src) throw new Error("Backend medya adresi döndürmedi.");
    return {
      id: String(media.id || ""),
      src,
      name: media.name || file.name || (kind === "video" ? "Video" : "Görsel"),
      type: media.type || file.type || "",
      size: media.size || file.size || 0,
      kind
    };
  }

  function deleteStoredMediaItem(item) {
    const id = item && mediaIdFromRef(item.src);
    if (!id) return;
    openMediaDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      tx.objectStore(MEDIA_STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Medya silinemedi."));
    })).catch((error) => console.warn("Medya silinemedi.", error));
  }

  function pricesFromLegacyProduct(product) {
    const prices = { standard: "", k: "", o: "", b: "", single: "", double: "" };
    const variants = Array.isArray(product && product.variants) ? product.variants : [];
    if (variants.length) {
      variants.forEach((variant) => {
        const label = normalizeText(variant.name || variant.label || "");
        const price = variant.price ?? "";
        if (price === "" || price === null || price === undefined) return;
        if (label.includes("KUCUK") || label === "K") prices.k = price;
        else if (label.includes("ORTA") || label === "O") prices.o = price;
        else if (label.includes("BUYUK") || label === "B") prices.b = price;
        else if (label.includes("SINGLE")) prices.single = price;
        else if (label.includes("DOUBLE")) prices.double = price;
        else if (label.includes("TEK") || label.includes("FINCAN") || label.includes("PORSIYON") || label.includes("ADET")) prices.standard = price;
        else if (variants.length === 1) prices.standard = price;
        else if (!prices.o) prices.o = price;
      });
    } else if (product && (product.price || product.price === 0)) {
      prices.standard = product.price;
    }
    return normalizePrices(prices);
  }

  function normalizeVariants(variants, prices, priceMode) {
    if (priceMode === "standard") {
      return [{ label: "", price: prices.standard }];
    }
    if (priceMode === "singleDouble") {
      return [
        { label: "Single", price: prices.single },
        { label: "Double", price: prices.double }
      ];
    }
    if (Array.isArray(variants) && variants.length) {
      const normalizedVariants = variants.map((variant) => ({
        label: variant.label || variant.name || "",
        price: cleanPrice(variant.price)
      })).filter((variant) => variant.label);
      if (normalizedVariants.length) return normalizedVariants;
    }
    return [
      { label: "K", price: prices.k },
      { label: "O", price: prices.o },
      { label: "B", price: prices.b }
    ];
  }

  function normalizePrices(prices) {
    return {
      standard: cleanPrice(prices && prices.standard),
      k: cleanPrice(prices && prices.k),
      o: cleanPrice(prices && prices.o),
      b: cleanPrice(prices && prices.b),
      single: cleanPrice(prices && prices.single),
      double: cleanPrice(prices && prices.double)
    };
  }

  function normalizePriceMode(product, prices) {
    if (product && product.priceMode === "sizes") return "sizes";
    if (product && product.priceMode === "singleDouble") return "singleDouble";
    if (product && product.priceMode === "standard") return "standard";
    if (hasPrice(prices.standard)) return "standard";
    if (hasPrice(prices.single) || hasPrice(prices.double)) return "singleDouble";
    if (hasPrice(prices.o) && !hasPrice(prices.k) && !hasPrice(prices.b)) return "standard";
    if (hasPrice(prices.k) || hasPrice(prices.o) || hasPrice(prices.b)) return "sizes";
    return "standard";
  }

  function normalizePricesForMode(prices, priceMode) {
    if (priceMode === "standard") {
      return {
        standard: firstFilledPrice(prices.standard, prices.o, prices.k, prices.b, prices.single, prices.double),
        k: "",
        o: "",
        b: "",
        single: "",
        double: ""
      };
    }
    if (priceMode === "singleDouble") {
      return {
        standard: "",
        k: "",
        o: "",
        b: "",
        single: prices.single,
        double: prices.double
      };
    }
    return {
      standard: "",
      k: prices.k,
      o: prices.o,
      b: prices.b,
      single: "",
      double: ""
    };
  }

  function priceSummary(product) {
    if (!product || product.priceMode === "standard") {
      return formatPrice(product && product.prices && product.prices.standard);
    }
    if (product.priceMode === "singleDouble") {
      return `Single ${formatPrice(product.prices.single)} | Double ${formatPrice(product.prices.double)}`;
    }
    return `K ${formatPrice(product.prices.k)} | O ${formatPrice(product.prices.o)} | B ${formatPrice(product.prices.b)}`;
  }

  function firstFilledPrice() {
    return Array.from(arguments).find(hasPrice) ?? "";
  }

  function hasPrice(value) {
    return value !== "" && value !== null && value !== undefined;
  }

  function cleanPrice(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "number") return Number.isFinite(value) ? value : "";
    const cleaned = String(value).replace(/[^\d.,]/g, "").replace(",", ".").trim();
    if (!cleaned) return "";
    const numberValue = Number(cleaned);
    return Number.isFinite(numberValue) ? numberValue : "";
  }

  function formatPrice(value) {
    if (value === "" || value === null || value === undefined) return "-";
    const clean = cleanPrice(value);
    if (clean === "") return "-";
    return `${new Intl.NumberFormat("tr-TR").format(clean)}\u20BA`;
  }

  function inferKind(top, sub, product) {
    const text = normalizeText(`${top} ${sub} ${product}`);
    if (/(TATLI|PASTA|WAFFLE|SAN SEBASTIAN|MAGNOLIA|CHEESECAKE|KURABIYE|DONDURMA)/.test(text)) return "dessert";
    if (/(SANDVIC|TOST|YIYECEK|KAHVALTI)/.test(text)) return "food";
    return "drink";
  }

  function inferTemperature(top, sub, product) {
    const text = normalizeText(`${top} ${sub} ${product}`);
    if (/(SOGUK|FROZEN|MILKSHAKE|ICE|BUZLU|LIMONATA|CHURCHILL|SMOOTHIE)/.test(text)) return "cold";
    if (/(SICAK|ESPRESSO|LATTE|CAPPUCCINO|AMERICANO|TURK|CAY|SAHLEP|SALEP|KAHVE)/.test(text)) return "hot";
    return "none";
  }

  function makeId(prefix, value) {
    const slug = normalizeText(`${prefix}-${value}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || Math.random().toString(36).slice(2, 8);
  }

  function normalizeText(text) {
    return String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/İ/g, "I")
      .replace(/ç/g, "c")
      .replace(/Ç/g, "C")
      .replace(/ğ/g, "g")
      .replace(/Ğ/g, "G")
      .replace(/ö/g, "o")
      .replace(/Ö/g, "O")
      .replace(/ş/g, "s")
      .replace(/Ş/g, "S")
      .replace(/ü/g, "u")
      .replace(/Ü/g, "U")
      .toUpperCase();
  }

  function toColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
  }

  function safeLocalGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return memoryStore[key] || "";
    }
  }

  function safeLocalSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      memoryStore[key] = value;
      return true;
    } catch (error) {
      memoryStore[key] = value;
      console.warn("Yerel kayıt yapılamadı.", error);
      return false;
    }
  }

  function safeLocalRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      delete memoryStore[key];
      return;
    }
    delete memoryStore[key];
  }

let adminDialogPending = null;

function ensureAdminApplicationDialog() {
    let layer = document.getElementById("adminApplicationDialog");
    if (layer) return layer;
    layer = document.createElement("div");
    layer.id = "adminApplicationDialog";
    layer.className = "admin-application-dialog";
    layer.hidden = true;
    layer.innerHTML = `
      <button class="admin-application-dialog__backdrop" type="button" data-admin-dialog-cancel aria-label="İletişim kutusunu kapat"></button>
      <section class="admin-application-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="adminApplicationDialogTitle" aria-describedby="adminApplicationDialogDescription">
        <header><div><p class="eyebrow">YÖNETİCİ PANELİ</p><h2 id="adminApplicationDialogTitle">İşlemi onaylayın</h2></div><button type="button" data-admin-dialog-cancel aria-label="Kapat">×</button></header>
        <div class="admin-application-dialog__body"><p id="adminApplicationDialogDescription"></p><label data-admin-dialog-input-wrap hidden><span data-admin-dialog-input-label>Değer</span><input type="text" data-admin-dialog-input maxlength="2048"></label></div>
        <footer><button class="ui-button ui-button--secondary" type="button" data-admin-dialog-cancel>Vazgeç</button><button class="ui-button ui-button--primary" type="button" data-admin-dialog-confirm>Onayla</button></footer>
      </section>`;
    document.body.appendChild(layer);
    layer.addEventListener("click", (event) => {
      if (event.target.closest("[data-admin-dialog-cancel]")) return closeAdminApplicationDialog(null);
      if (!event.target.closest("[data-admin-dialog-confirm]")) return;
      const input = layer.querySelector("[data-admin-dialog-input]");
      closeAdminApplicationDialog(layer.dataset.mode === "prompt" ? input.value : true);
    });
    layer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAdminApplicationDialog(null);
      }
      if (event.key === "Enter" && layer.dataset.mode === "prompt" && event.target.matches("[data-admin-dialog-input]")) {
        event.preventDefault();
        closeAdminApplicationDialog(event.target.value);
      }
    });
    return layer;
  }

function openAdminApplicationDialog(options = {}) {
    const layer = ensureAdminApplicationDialog();
    if (adminDialogPending) adminDialogPending(null);
    const mode = options.mode === "prompt" ? "prompt" : options.mode === "alert" ? "alert" : "confirm";
    layer.dataset.mode = mode;
    layer.querySelector("#adminApplicationDialogTitle").textContent = options.title || (mode === "alert" ? "Bilgi" : "İşlemi onaylayın");
    layer.querySelector("#adminApplicationDialogDescription").textContent = options.description || "";
    const inputWrap = layer.querySelector("[data-admin-dialog-input-wrap]");
    const input = layer.querySelector("[data-admin-dialog-input]");
    inputWrap.hidden = mode !== "prompt";
    layer.querySelector("[data-admin-dialog-input-label]").textContent = options.label || "Değer";
    input.value = mode === "prompt" ? String(options.value || "") : "";
    input.type = options.inputType || "text";
    const cancel = layer.querySelector("footer [data-admin-dialog-cancel]");
    cancel.hidden = mode === "alert";
    const confirm = layer.querySelector("[data-admin-dialog-confirm]");
    confirm.textContent = options.confirmLabel || (mode === "alert" ? "Tamam" : "Onayla");
    confirm.classList.toggle("ui-button--danger", options.danger === true);
    layer.hidden = false;
    document.body.classList.add("is-admin-dialog-open");
    window.setTimeout(() => (mode === "prompt" ? input : confirm).focus(), 0);
    return new Promise((resolve) => { adminDialogPending = resolve; });
  }

function closeAdminApplicationDialog(value) {
    const layer = document.getElementById("adminApplicationDialog");
    if (layer) layer.hidden = true;
    document.body.classList.remove("is-admin-dialog-open");
    const resolve = adminDialogPending;
    adminDialogPending = null;
    if (resolve) resolve(value);
  }

function adminConfirm(description, options = {}) {
    return openAdminApplicationDialog({ ...options, mode: "confirm", description: String(description || "") });
  }

function adminNotice(description, options = {}) {
    return openAdminApplicationDialog({ ...options, mode: "alert", description: String(description || "") });
  }

function adminPrompt(label, value = "", options = {}) {
    return openAdminApplicationDialog({ ...options, mode: "prompt", label, value, description: options.description || "" });
  }

let staffDeleteUserId = "";

let staffDeleteTrigger = null;

let staffDeleteBusy = false;

function bindStaffAssignmentEvents() {
    if (els.staffAssignmentCategory) els.staffAssignmentCategory.addEventListener("change", renderStaffAssignmentOptions);
    if (els.staffAssignmentProduct) els.staffAssignmentProduct.addEventListener("change", renderStaffAssignmentSizeOptions);
    if (els.staffAssignmentKind) els.staffAssignmentKind.addEventListener("change", updateStaffAssignmentControls);
    if (els.staffScopeType) els.staffScopeType.addEventListener("change", updateStaffAssignmentControls);
    if (els.staffProductPicker) els.staffProductPicker.addEventListener("change", () => {
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = "";
      syncStaffProductPickerChips();
    });
    if (els.staffAssignmentCreateButton) els.staffAssignmentCreateButton.addEventListener("click", createStaffAssignment);
  }

let staffAccessRequestEpoch = 0;
async function hydrateRecipeAccessFromBackend() {
    if (!backendBaseUrl()) return;
    const requestEpoch = ++staffAccessRequestEpoch;
    try {
      const result = await backendRequest("/api/admin/recipe-access", { noDedupe: true });
      if (requestEpoch !== staffAccessRequestEpoch) return;
      const access = normalizeRecipeAccess(result);
      if (access.revision < state.recipeAccess.revision) return;
      state.recipeAccess = access;
      syncStaffOverviewUsers();
      renderStaffAccess();
      updateSaveControls("Kullanıcı yetkileri güncel");
      window.clearTimeout(hydrateRecipeAccessFromBackend.timer);
      hydrateRecipeAccessFromBackend.timer = window.setTimeout(updateSaveControls, 1200);
    } catch (error) {
      if (requestEpoch !== staffAccessRequestEpoch) return;
      state.staffMessage = error.message || "Kullanıcı yetkileri alınamadı";
      renderStaffAccess();
    }
  }

function syncStaffOverviewUsers() {
    const users = state.recipeAccess.users || [];
    const sync = window.__MENU_SUITE_WORKFORCE_SYNC_STAFF__;
    if (typeof sync === "function") sync(users, state.recipeAccess.revision);
    else window.__MENU_SUITE_WORKFORCE_OVERVIEW__ = null;
  }

function normalizeRecipeAccess(result) {
    return {
      users: Array.isArray(result && result.users) ? result.users : [],
      assignments: Array.isArray(result && result.assignments) ? result.assignments : [],
      activity: Array.isArray(result && result.activity) ? result.activity : [],
      revision: Math.max(0, Number(result && result.revision || 0))
    };
  }

function renderStaffAccess() {
    if (!els.staffUserList) return;
    const access = state.recipeAccess || { users: [], assignments: [], activity: [] };
    renderStaffOverview(access);
    renderStaffUsers(access.users || []);
    renderStaffSectionAccess(access.users || []);
    // PASİF MODÜL: Eğitim / Görev / Sınav Atama — yeniden etkinleştirilmek üzere korunuyor.
    // renderStaffAssignmentOptions();
    // renderStaffAssignments(access.assignments || []);
    renderStaffActivity(access.activity || []);
    if (els.staffUserMessage) els.staffUserMessage.textContent = state.staffMessage || "";
  }

function renderStaffOverview(access) {
    if (!els.staffOverviewGrid) return;
    if (window.__MENU_SUITE_WORKFORCE_OVERVIEW__) {
      els.staffOverviewGrid.innerHTML = window.__MENU_SUITE_WORKFORCE_OVERVIEW__;
      return;
    }
    const users = Array.isArray(access && access.users) ? access.users : [];
    const activityItems = Array.isArray(access && access.activity) ? access.activity : [];
    const activeCount = users.filter((user) => user.active !== false).length;
    const passiveCount = Math.max(0, users.length - activeCount);
    els.staffOverviewGrid.innerHTML = [
      ["Toplam Personel", users.length, "Tüm personel sayısı"],
      ["Aktif Personel", activeCount, "Aktif çalışan personel"],
      ["Pasif Personel", passiveCount, "Pasif durumda personel"],
      ["Kayıtlı Hareketler", activityItems.length, "Korunan personel kayıtları"]
    ].map(([label, value, note]) => `
      <article>
        <span aria-hidden="true"></span>
        <div>
          <p>${escapeHTML(label)}</p>
          <strong>${escapeHTML(value)}</strong>
          <small>${escapeHTML(note)}</small>
        </div>
      </article>
    `).join("");
  }

function renderStaffUsers(users) {
    const list = Array.isArray(users) ? users : [];
    const visible = list;
    els.staffUserList.innerHTML = visible.length ? `<div class="staff-personnel-table"><div class="staff-personnel-row staff-personnel-head"><span>Ad Soyad</span><span>Görev Tanımı</span><span>Kullanıcı Adı</span><span>Şifre</span><span></span></div>${visible.map(user => `<button class="staff-personnel-row" type="button" data-staff-user="${escapeAttribute(user.id)}" aria-label="${escapeAttribute(user.name || user.username)} personel detayını aç"><strong>${escapeHTML(user.name || user.username)}${user.active === false ? '<small>Pasif</small>' : ''}</strong><span>${escapeHTML(user.jobTitle || "—")}</span><span>${escapeHTML(user.username)}</span><span aria-label="Şifre güvenli biçimde saklanıyor">••••••••</span><span aria-hidden="true">›</span></button>`).join("")}</div>` : '<div class="staff-empty">Henüz kayıtlı personel yok.</div>';
  }

  let staffPersonnelTrigger = null;
  function openStaffPersonnelDialog() {
    const modal = document.getElementById("staffPersonnelModal");
    if (!modal) return;
    staffPersonnelTrigger = document.activeElement;
    document.getElementById("staffPersonnelTitle").textContent = state.selectedStaffUserId ? "Personel Detayı" : "Personel Ekle";
    if (els.staffPassword) els.staffPassword.type = "password";
    document.getElementById("staffPasswordToggle").textContent = "Göster";
    if (els.staffSectionAccessAccordion) els.staffSectionAccessAccordion.open = false;
    modal.hidden = false;
    document.body.classList.add("is-staff-personnel-open");
    els.staffUserName?.focus();
  }

  function closeStaffPersonnelDialog() {
    const modal = document.getElementById("staffPersonnelModal");
    if (!modal || modal.hidden || els.staffUserSaveButton?.disabled) return;
    modal.hidden = true;
    if (els.staffPassword) { els.staffPassword.value = ""; els.staffPassword.type = "password"; }
    document.body.classList.remove("is-staff-personnel-open");
    if (staffPersonnelTrigger?.isConnected) staffPersonnelTrigger.focus();
  }

const PERSONEL_SECTION_ACCESS_KEYS = ["recipe", "tasks", "stock", "materialRequest", "shipment", "shift"];

function normalizePersonelSectionAccess(value) {
    const source = value && typeof value === "object" ? value : {};
    return PERSONEL_SECTION_ACCESS_KEYS.reduce((result, key) => {
      result[key] = ["stock", "shipment"].includes(key) ? source[key] === true : source[key] !== false;
      return result;
    }, {});
  }

function renderStaffSectionAccess(users) {
    if (!els.staffSectionAccessUser || !els.staffSectionAccessGrid) return;
    const list = (Array.isArray(users) ? users : []).filter((user) => user && user.id);
    if (!list.some((user) => user.id === state.staffSectionAccessUserId)) state.staffSectionAccessUserId = "";
    els.staffSectionAccessUser.innerHTML = list.length
      ? `<option value="">Personel seçin</option>${list.map((user) => `<option value="${escapeAttribute(user.id)}">${escapeHTML(user.name || user.username)} · @${escapeHTML(user.username)}</option>`).join("")}`
      : '<option value="">Personel bulunamadı</option>';
    els.staffSectionAccessUser.value = state.staffSectionAccessUserId;
    const user = list.find((item) => item.id === state.staffSectionAccessUserId);
    const access = normalizePersonelSectionAccess(user && user.personelSectionAccess);
    els.staffSectionAccessGrid.querySelectorAll("[data-personel-section-access]").forEach((input) => {
      input.checked = access[input.dataset.personelSectionAccess] !== false;
      input.disabled = !user;
    });
    if (els.staffSectionAccessSave) els.staffSectionAccessSave.disabled = !user;
    if (els.staffSectionAccessMessage) els.staffSectionAccessMessage.textContent = state.staffSectionAccessMessage || (user ? "" : "Yetkilerini düzenlemek için personel seçin.");
    renderStaffSectionAccessSummary();
  }

function renderStaffSectionAccessSummary() {
    if (!els.staffSectionAccessGrid || !els.staffSectionAccessSummary) return;
    const inputs = Array.from(els.staffSectionAccessGrid.querySelectorAll("[data-personel-section-access]"));
    if (!state.staffSectionAccessUserId) {
      els.staffSectionAccessSummary.textContent = "Personel seçin";
      return;
    }
    const enabled = inputs.filter((input) => input.checked).length;
    els.staffSectionAccessSummary.textContent = `${enabled}/${inputs.length || 6} bölüm açık`;
  }

async function saveStaffSectionAccess() {
    const id = String(state.staffSectionAccessUserId || "");
    const user = (state.recipeAccess.users || []).find((item) => item.id === id);
    if (!user || !els.staffSectionAccessGrid) return;
    const personelSectionAccess = {};
    els.staffSectionAccessGrid.querySelectorAll("[data-personel-section-access]").forEach((input) => {
      personelSectionAccess[input.dataset.personelSectionAccess] = Boolean(input.checked);
    });
    try {
      const mutation = staffMutationOptions("personnel-section-access", { personelSectionAccess });
      const result = await runStaffImmediateOperation(`staff-section-access:${id}`, els.staffSectionAccessSave, () => backendRequest(`/api/admin/recipe-users/${encodeURIComponent(id)}/section-access`, {
        method: "PATCH",
        ...mutation
      }), { busyText: "Kaydediliyor…" });
      applyStaffAccessResponse(result);
      state.staffSectionAccessMessage = "Personel arayüz yetkileri güncellendi.";
      renderStaffAccess();
    } catch (error) {
      state.staffSectionAccessMessage = error.message || "Arayüz yetkileri kaydedilemedi";
      renderStaffAccess();
    }
  }

function staffUserEmailValue(user) {
    return String(user && (user.pendingEmail || user.email) || "").trim().toLowerCase();
  }

function staffUserEmailVerified(user) {
    return Boolean(user && user.email && user.emailVerifiedAt && !user.emailVerificationRequired && !user.pendingEmail);
  }

function staffUserEmailSummary(user) {
    const email = staffUserEmailValue(user);
    if (!email) return "E-posta eklenmedi";
    return `${email} · ${staffUserEmailVerified(user) ? "doğrulandı" : "doğrulama bekliyor"}`;
  }

function handleStaffUserListClick(event) {
    const permanentDeleteButton = event.target.closest("[data-permanent-delete-user]");
    if (permanentDeleteButton) {
      openStaffDeleteDialog(permanentDeleteButton.dataset.permanentDeleteUser, permanentDeleteButton);
      return;
    }

    const toggleButton = event.target.closest("[data-toggle-staff-user]");
    if (toggleButton) {
      void toggleStaffUserAccess(toggleButton.dataset.toggleStaffUser, toggleButton.dataset.nextActive === "true", toggleButton);
      return;
    }

    const button = event.target.closest("[data-staff-user]");
    if (!button) return;
    const user = (state.recipeAccess.users || []).find((item) => item.id === button.dataset.staffUser);
    if (!user) return;
    state.selectedStaffUserId = user.id;
    state.staffSectionAccessUserId = user.id;
    if (els.staffUserName) els.staffUserName.value = user.name || "";
    if (els.staffUsername) els.staffUsername.value = user.username || "";
    if (els.staffUserEmail) els.staffUserEmail.value = staffUserEmailValue(user);
    if (els.staffUserEmailStatus) els.staffUserEmailStatus.textContent = staffUserEmailSummary(user);
    if (els.staffPassword) els.staffPassword.value = "";
    if (els.staffUserActive) els.staffUserActive.checked = user.active !== false;
    document.getElementById("staffJobTitle").value = user.jobTitle || "";
    state.staffMessage = "";
    renderStaffAccess();
    openStaffPersonnelDialog();
  }

function handleStaffUserFilterClick(event) {
    const button = event.target.closest("[data-staff-user-filter]");
    if (!button) return;
    state.staffUserFilter = button.dataset.staffUserFilter || "active";
    renderStaffAccess();
  }

function runStaffImmediateOperation(key, button, operation, options = {}) {
    const coordinator = window.MenuSuiteOperations;
    if (!coordinator || typeof coordinator.run !== "function") return Promise.resolve().then(operation);
    return coordinator.run(key, operation, {
      button,
      busyText: options.busyText || "İşleniyor…",
      classification: window.MenuSuiteOperationClasses && window.MenuSuiteOperationClasses.IMMEDIATE || "immediate-operation"
    });
  }

function applyStaffAccessResponse(result) {
    const revision = Number(result && result.revision);
    if (Number.isSafeInteger(revision) && revision < state.recipeAccess.revision) return;
    staffAccessRequestEpoch += 1;
    if (Array.isArray(result && result.users)) state.recipeAccess.users = result.users;
    if (Array.isArray(result && result.assignments)) state.recipeAccess.assignments = result.assignments;
    if (Array.isArray(result && result.activity)) state.recipeAccess.activity = result.activity;
    if (Number.isSafeInteger(revision) && revision >= 0) state.recipeAccess.revision = revision;
    syncStaffOverviewUsers();
  }

function staffMutationOptions(prefix, body = {}) {
    const requestId = createRequestId(prefix);
    return {
      headers: {
        "Idempotency-Key": requestId,
        "X-Request-ID": requestId
      },
      body: { ...body, requestId }
    };
  }

async function toggleStaffUserAccess(id, nextActive, button) {
    const user = (state.recipeAccess.users || []).find((item) => item.id === id);
    if (!user) return;

    if (!nextActive && !await adminConfirm("Bu kullanıcının reçete erişim yetkisi kaldırılacak. Geçmiş görev ve aktivite kayıtları korunacak.", { title: "Personeli pasifleştir", confirmLabel: "Pasifleştir", danger: true })) {
      return;
    }

    try {
      const mutation = staffMutationOptions(nextActive ? "personnel-reactivate" : "personnel-deactivate", nextActive ? {
        name: user.name || user.username,
        username: user.username,
        email: staffUserEmailValue(user),
        password: "",
        active: true
      } : {});
      const result = await runStaffImmediateOperation(`staff-access:${id}`, button, () => (
        nextActive
          ? backendRequest(`/api/admin/recipe-users/${encodeURIComponent(id)}`, {
            method: "PUT",
            ...mutation
          })
          : backendRequest(`/api/admin/recipe-users/${encodeURIComponent(id)}`, { method: "DELETE", ...mutation })
      ), { busyText: nextActive ? "Aktifleştiriliyor…" : "Pasifleştiriliyor…" });

      applyStaffAccessResponse(result);
      state.staffMessage = nextActive ? "Personel tekrar aktif edildi" : "Personel pasif hale getirildi";
      if (!nextActive && state.selectedStaffUserId === id && els.staffUserActive) els.staffUserActive.checked = false;
      renderStaffAccess();
    } catch (error) {
      state.staffMessage = error.message || "Personel durumu güncellenemedi";
      renderStaffAccess();
    }
  }

function openStaffDeleteDialog(id, trigger) {
    const user = (state.recipeAccess.users || []).find((item) => item.id === id);
    if (!user || !els.staffDeleteModal) return;
    staffDeleteUserId = id;
    staffDeleteTrigger = trigger || document.activeElement;
    if (els.staffDeleteName) els.staffDeleteName.textContent = user.name || user.username || "Personel";
    if (els.staffDeleteUsername) els.staffDeleteUsername.textContent = `@${user.username || "personel"}`;
    if (els.staffDeleteError) {
      els.staffDeleteError.hidden = true;
      els.staffDeleteError.textContent = "";
    }
    if (els.staffDeleteConsent) els.staffDeleteConsent.checked = false;
    setStaffDeleteBusy(false);
    syncStaffDeleteConsent();
    els.staffDeleteModal.hidden = false;
    els.staffDeleteModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-staff-delete-open");
    window.setTimeout(() => els.staffDeleteCancelButton && els.staffDeleteCancelButton.focus(), 0);
  }

function closeStaffDeleteDialog(options = {}) {
    if (!els.staffDeleteModal || els.staffDeleteModal.hidden) return;
    if (staffDeleteBusy && options.force !== true) return;
    const restoreTarget = staffDeleteTrigger;
    setStaffDeleteBusy(false);
    if (els.staffDeleteConsent) els.staffDeleteConsent.checked = false;
    els.staffDeleteModal.hidden = true;
    els.staffDeleteModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-staff-delete-open");
    staffDeleteUserId = "";
    staffDeleteTrigger = null;
    if (options.restoreFocus !== false && restoreTarget && restoreTarget.isConnected && !restoreTarget.disabled) {
      window.setTimeout(() => restoreTarget.focus(), 0);
    }
  }

function handleStaffDeleteModalClick(event) {
    if (staffDeleteBusy) return;
    if (event.target === els.staffDeleteModal || event.target.closest("[data-staff-delete-close]")) {
      closeStaffDeleteDialog();
    }
  }

function setStaffDeleteBusy(isBusy, options = {}) {
    staffDeleteBusy = Boolean(isBusy);
    if (els.staffDeleteModal) {
      els.staffDeleteModal.classList.toggle("is-busy", staffDeleteBusy);
      if (staffDeleteBusy) els.staffDeleteModal.setAttribute("aria-busy", "true");
      else els.staffDeleteModal.removeAttribute("aria-busy");
    }
    if (els.staffDeleteCloseButton) els.staffDeleteCloseButton.disabled = staffDeleteBusy;
    if (els.staffDeleteCancelButton) els.staffDeleteCancelButton.disabled = staffDeleteBusy;
    if (els.staffDeleteConsent) els.staffDeleteConsent.disabled = staffDeleteBusy;
    if (options.includeConfirm !== false) syncStaffDeleteConsent();
  }

function syncStaffDeleteConsent() {
    if (!els.staffDeleteConfirmButton) return;
    const consented = Boolean(els.staffDeleteConsent && els.staffDeleteConsent.checked);
    els.staffDeleteConfirmButton.disabled = staffDeleteBusy || !consented;
  }

function trapStaffDeleteFocus(event) {
    if (!els.staffDeleteModal || els.staffDeleteModal.hidden || event.key !== "Tab") return false;
    const controls = Array.from(els.staffDeleteModal.querySelectorAll("button:not(:disabled), [href], input:not(:disabled)"))
      .filter((control) => control.getClientRects().length);
    if (!controls.length) return false;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.staffDeleteModal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && (document.activeElement === last || !els.staffDeleteModal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

async function confirmPermanentStaffDelete() {
    const id = staffDeleteUserId;
    const user = (state.recipeAccess.users || []).find((item) => item.id === id);
    if (!id || !user || !els.staffDeleteConfirmButton || staffDeleteBusy) return;
    if (!els.staffDeleteConsent || !els.staffDeleteConsent.checked) {
      if (els.staffDeleteError) {
        els.staffDeleteError.textContent = "Devam etmek için kalıcı silme onayını işaretleyin.";
        els.staffDeleteError.hidden = false;
      }
      return;
    }
    if (els.staffDeleteError) {
      els.staffDeleteError.hidden = true;
      els.staffDeleteError.textContent = "";
    }

    try {
      const mutation = staffMutationOptions("personnel-permanent-delete");
      setStaffDeleteBusy(true);
      const result = await runStaffImmediateOperation(
        `staff-permanent-delete:${id}`,
        els.staffDeleteConfirmButton,
        () => backendRequest(`/api/admin/recipe-users/${encodeURIComponent(id)}/permanent`, { method: "DELETE", ...mutation }),
        { busyText: "Siliniyor…" }
      );
      applyStaffAccessResponse(result);
      if (state.selectedStaffUserId === id) {
        state.selectedStaffUserId = "";
        if (els.staffUserName) els.staffUserName.value = "";
        if (els.staffUsername) els.staffUsername.value = "";
        if (els.staffUserEmail) els.staffUserEmail.value = "";
        if (els.staffUserEmailStatus) els.staffUserEmailStatus.textContent = "Personel ilk girişinde bu adresi doğrular.";
        if (els.staffPassword) els.staffPassword.value = "";
        if (els.staffUserActive) els.staffUserActive.checked = true;
      }
      state.staffMessage = "Kullanıcı kalıcı silindi; eski kayıtlar korundu";
      setStaffDeleteBusy(false);
      closeStaffDeleteDialog({ force: true, restoreFocus: false });
      renderStaffAccess();
      if (els.staffUserFilter) window.setTimeout(() => els.staffUserFilter.querySelector("[data-staff-user-filter].is-active")?.focus(), 0);
    } catch (error) {
      setStaffDeleteBusy(false);
      if (els.staffDeleteError) {
        els.staffDeleteError.textContent = error.message || "Kullanıcı kalıcı silinemedi";
        els.staffDeleteError.hidden = false;
      }
    }
  }

function resetStaffUserForm() {
    state.selectedStaffUserId = "";
    state.staffMessage = "";
    document.getElementById("staffJobTitle").value = "";
    if (els.staffUserName) els.staffUserName.value = "";
    if (els.staffUsername) els.staffUsername.value = "";
    if (els.staffUserEmail) els.staffUserEmail.value = "";
    if (els.staffUserEmailStatus) els.staffUserEmailStatus.textContent = "Personel ilk girişinde bu adresi doğrular.";
    if (els.staffPassword) els.staffPassword.value = "";
    if (els.staffUserActive) els.staffUserActive.checked = true;
    renderStaffAccess();
    openStaffPersonnelDialog();
  }

async function saveStaffUser() {
    const selectedId = state.selectedStaffUserId;
    const selectedUser = (state.recipeAccess.users || []).find(user => user.id === selectedId);
    const payload = {
      name: (els.staffUserName && els.staffUserName.value || "").trim(),
      jobTitle: (document.getElementById("staffJobTitle")?.value || "").trim(),
      username: (els.staffUsername && els.staffUsername.value || "").trim(),
      password: (els.staffPassword && els.staffPassword.value || "").trim(),
      active: selectedUser ? selectedUser.active !== false : true
    };
    // Account email and section access are not part of this simplified form.
    // Omit them so the backend preserves verified/pending email and permissions.

    try {
      const mutation = staffMutationOptions(selectedId ? "personnel-update" : "personnel-create", payload);
      const result = await runStaffImmediateOperation(
        `staff-save:${selectedId || payload.username}`,
        els.staffUserSaveButton,
        () => backendRequest(selectedId ? `/api/admin/recipe-users/${encodeURIComponent(selectedId)}` : "/api/admin/recipe-users", {
          method: selectedId ? "PUT" : "POST",
          ...mutation
        }),
        { busyText: selectedId ? "Güncelleniyor…" : "Oluşturuluyor…" }
      );
      applyStaffAccessResponse(result);
      state.selectedStaffUserId = result.user && result.user.id || selectedId || "";
      state.staffMessage = selectedId ? "Personel güncellendi" : "Personel oluşturuldu";
      if (els.staffUserEmailStatus) els.staffUserEmailStatus.textContent = result.user ? staffUserEmailSummary(result.user) : "Doğrulama bekliyor";
      if (els.staffPassword) els.staffPassword.value = "";
      renderStaffAccess();
    } catch (error) {
      state.staffMessage = error.message || "Personel kaydedilemedi";
      renderStaffAccess();
    }
  }

function renderStaffAssignmentOptions() {
    if (!els.staffAssignmentUser || !els.staffAssignmentCategory) return;
    const users = (state.recipeAccess.users || []).filter((user) => user.active !== false);
    els.staffAssignmentUser.innerHTML = users.length
      ? users.map((user) => `<option value="${escapeAttribute(user.id)}">${escapeHTML(user.name || user.username)}</option>`).join("")
      : `<option value="">Aktif kullanıcı yok</option>`;

    const categories = recipeCategoryNames();
    const currentCategory = categories.includes(els.staffAssignmentCategory.value)
      ? els.staffAssignmentCategory.value
      : categories[0] || "";
    els.staffAssignmentCategory.innerHTML = categories.length
      ? categories.map((category) => `<option value="${escapeAttribute(category)}">${escapeHTML(category)}</option>`).join("")
      : `<option value="">Reçete yok</option>`;
    els.staffAssignmentCategory.value = currentCategory;
    renderStaffAssignmentProductOptions();
    updateStaffAssignmentControls();
  }

function renderStaffAssignmentProductOptions() {
    if (!els.staffAssignmentProduct) return;
    const category = els.staffAssignmentCategory ? els.staffAssignmentCategory.value : "";
    const products = recipeProductNames(category);
    const currentProduct = products.includes(els.staffAssignmentProduct.value)
      ? els.staffAssignmentProduct.value
      : products[0] || "";
    els.staffAssignmentProduct.innerHTML = products.length
      ? products.map((product) => `<option value="${escapeAttribute(product)}">${escapeHTML(product)}</option>`).join("")
      : `<option value="">Ürün yok</option>`;
    els.staffAssignmentProduct.value = currentProduct;
    renderStaffAssignmentSizeOptions();
    renderStaffProductPicker();
  }

function renderStaffAssignmentSizeOptions() {
    if (!els.staffAssignmentSize) return;
    const category = els.staffAssignmentCategory ? els.staffAssignmentCategory.value : "";
    const product = els.staffAssignmentProduct ? els.staffAssignmentProduct.value : "";
    const sizes = Object.keys((state.recipes && state.recipes[category] && state.recipes[category][product]) || {});
    const currentSize = sizes.includes(els.staffAssignmentSize.value) ? els.staffAssignmentSize.value : sizes[0] || "";
    els.staffAssignmentSize.innerHTML = sizes.length
      ? sizes.map((size) => `<option value="${escapeAttribute(size)}">${escapeHTML(size)}</option>`).join("")
      : `<option value="">Ölçü yok</option>`;
    els.staffAssignmentSize.value = currentSize;
    renderStaffProductPicker();
  }

function updateStaffAssignmentControls() {
    const kind = staffAssignmentKindValue();
    const scope = staffScopeTypeValue();
    const needsQuestions = ["quick_quiz", "exam", "retraining"].includes(kind);
    const usesCategory = scope === "category" || scope === "products";
    const usesProducts = scope === "products";

    if (els.staffAssignmentCategory) els.staffAssignmentCategory.disabled = !usesCategory;
    if (els.staffAssignmentProduct) els.staffAssignmentProduct.disabled = !usesProducts;
    if (els.staffAssignmentSize) els.staffAssignmentSize.disabled = !usesProducts;
    if (els.staffQuestionCount) els.staffQuestionCount.disabled = !needsQuestions;
    if (els.staffPassingScore) els.staffPassingScore.disabled = !needsQuestions;
    if (els.staffDifficulty) els.staffDifficulty.disabled = !needsQuestions;
    renderStaffProductPicker();
  }

function renderStaffProductPicker() {
    if (!els.staffProductPicker) return;
    const scope = staffScopeTypeValue();
    if (scope !== "products") {
      els.staffProductPicker.innerHTML = `<span class="staff-picker-note">${escapeHTML(staffScopeTypeLabel(scope))} kapsamı seçili.</span>`;
      return;
    }

    const category = els.staffAssignmentCategory ? els.staffAssignmentCategory.value : "";
    const items = flattenRecipeAssignmentItems(category);
    if (!items.length) {
      els.staffProductPicker.innerHTML = `<span class="staff-picker-note">Seçilebilir reçete yok.</span>`;
      return;
    }

    const currentProduct = els.staffAssignmentProduct ? els.staffAssignmentProduct.value : "";
    const currentSize = els.staffAssignmentSize ? els.staffAssignmentSize.value : "";
    const selectedLabels = items
      .filter((item) => item.product === currentProduct && (!currentSize || item.size === currentSize))
      .map((item) => [item.product, item.size].filter(Boolean).join(" / "));
    els.staffProductPicker.innerHTML = `
      <details class="staff-multiselect">
        <summary class="staff-multiselect-control">
          <span class="staff-multiselect-chips">
            ${staffProductPickerChipMarkup(selectedLabels)}
          </span>
          <span class="staff-multiselect-arrow" aria-hidden="true"></span>
        </summary>
        <div class="staff-multiselect-menu">
          ${items.map((item) => {
      const checked = item.product === currentProduct && (!currentSize || item.size === currentSize);
      return `
        <label class="staff-multiselect-option">
          <input type="checkbox" value="${escapeAttribute(recipeItemKey(item))}"${checked ? " checked" : ""}>
          <span>${escapeHTML([item.product, item.size].filter(Boolean).join(" / "))}</span>
        </label>
      `;
    }).join("")}
        </div>
      </details>
    `;
  }

function syncStaffProductPickerChips() {
    if (!els.staffProductPicker) return;
    const chipBox = els.staffProductPicker.querySelector(".staff-multiselect-chips");
    if (!chipBox) return;
    const labels = Array.from(els.staffProductPicker.querySelectorAll(".staff-multiselect-option input[type='checkbox']:checked"))
      .map((input) => {
        const label = input.closest(".staff-multiselect-option");
        return label ? label.textContent.trim() : "";
      })
      .filter(Boolean);
    chipBox.innerHTML = staffProductPickerChipMarkup(labels);
  }

function staffProductPickerChipMarkup(labels) {
    const visible = labels.slice(0, 2);
    const overflow = Math.max(0, labels.length - visible.length);
    if (!visible.length) return `<em>Ürün seçin</em>`;
    return [
      ...visible.map((label) => `<span>${escapeHTML(label)}</span>`),
      overflow ? `<span>+${overflow}</span>` : ""
    ].join("");
  }

function flattenRecipeAssignmentItems(categoryFilter) {
    const items = [];
    Object.keys(state.recipes || {}).forEach((category) => {
      if (categoryFilter && category !== categoryFilter) return;
      const products = state.recipes[category] || {};
      Object.keys(products).forEach((product) => {
        const sizes = products[product] || {};
        Object.keys(sizes).forEach((size) => {
          items.push({ category, product, size });
        });
      });
    });
    return items;
  }

function selectedStaffProducts() {
    const checked = els.staffProductPicker
      ? Array.from(els.staffProductPicker.querySelectorAll("input[type='checkbox']:checked"))
      : [];
    const byKey = new Map(flattenRecipeAssignmentItems("").map((item) => [recipeItemKey(item), item]));
    const selected = checked.map((input) => byKey.get(input.value)).filter(Boolean);
    if (selected.length) return selected;

    const category = els.staffAssignmentCategory && els.staffAssignmentCategory.value || "";
    const product = els.staffAssignmentProduct && els.staffAssignmentProduct.value || "";
    const size = els.staffAssignmentSize && els.staffAssignmentSize.value || "";
    return category && product && size ? [{ category, product, size }] : [];
  }

function recipeItemKey(item) {
    return [item.category, item.product, item.size].map((part) => String(part || "")).join("|||");
  }

function staffAssignmentKindValue() {
    const value = els.staffAssignmentKind && els.staffAssignmentKind.value || "quick_quiz";
    return ["quick_quiz", "training", "homework", "exam", "retraining"].includes(value) ? value : "quick_quiz";
  }

function staffScopeTypeValue() {
    const value = els.staffScopeType && els.staffScopeType.value || "products";
    return ["all", "category", "products", "failed_items"].includes(value) ? value : "products";
  }

async function createStaffAssignment() {
    const kind = staffAssignmentKindValue();
    const scopeType = staffScopeTypeValue();
    const selectedProducts = scopeType === "products" ? selectedStaffProducts() : [];
    const payload = {
      userId: els.staffAssignmentUser && els.staffAssignmentUser.value || "",
      assignmentKind: kind,
      scopeType,
      category: els.staffAssignmentCategory && els.staffAssignmentCategory.value || "",
      product: els.staffAssignmentProduct && els.staffAssignmentProduct.value || "",
      size: els.staffAssignmentSize && els.staffAssignmentSize.value || "",
      selectedProducts,
      questionCount: els.staffQuestionCount && els.staffQuestionCount.value || (kind === "quick_quiz" ? 3 : 8),
      passingScore: els.staffPassingScore && els.staffPassingScore.value || 70,
      difficulty: els.staffDifficulty && els.staffDifficulty.value || "normal",
      adminNote: els.staffAdminNote && els.staffAdminNote.value || ""
    };

    try {
      const result = await backendRequest("/api/admin/recipe-assignments", {
        method: "POST",
        body: payload
      });
      if (Array.isArray(result.assignments)) state.recipeAccess.assignments = result.assignments;
      if (Array.isArray(result.activity)) state.recipeAccess.activity = result.activity;
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = "Program atandı";
      if (els.staffAdminNote) els.staffAdminNote.value = "";
      renderStaffAccess();
    } catch (error) {
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = error.message || "Program atanamadı";
    }
  }

function renderStaffAssignments(assignments) {
    const list = Array.isArray(assignments) ? assignments : [];
    if (els.staffAssignmentCount) els.staffAssignmentCount.textContent = `${list.length} kayıt`;
    if (!els.staffAssignmentList) return;
    if (els.staffAssignmentSummary) {
      const total = list.length;
      const pending = list.filter((item) => staffAssignmentStatus(item) === "pending").length;
      const completed = list.filter((item) => staffAssignmentStatus(item) === "completed").length;
      const retry = list.filter((item) => ["retry_required", "failed"].includes(staffAssignmentStatus(item))).length;
      els.staffAssignmentSummary.innerHTML = [
        ["Toplam kayıt", total],
        ["Bekleyen", pending],
        ["Tamamlanan", completed],
        ["Tekrar gerekli", retry]
      ].map(([label, value]) => `<article><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></article>`).join("");
    }
    if (!list.length) {
      els.staffAssignmentList.innerHTML = `<div class="staff-empty">Henüz eğitim, ödev veya sınav yok.</div>`;
      if (els.staffAssignmentDetail) els.staffAssignmentDetail.hidden = true;
      return;
    }

    els.staffAssignmentList.innerHTML = `
      <div class="staff-ledger staff-assignment-ledger">
        <div class="staff-ledger-head">
          <span>Tarih</span>
          <span>Personel</span>
          <span>Tip</span>
          <span>Başlık</span>
          <span>Kapsam</span>
          <span>Durum</span>
          <span>İlerleme</span>
          <span>Skor</span>
          <span>İşlem</span>
        </div>
        ${list.map((assignment) => {
      const score = staffAssignmentScore(assignment);
      const userName = assignment.name || assignment.username || "Silinmiş Kullanıcı";
      return `
        <article class="staff-assignment-row">
          <span>${escapeHTML(formatStaffDate(assignment.createdAt))}</span>
          <strong>${escapeHTML(userName)}</strong>
          <span>${escapeHTML(staffAssignmentKindLabel(assignment.assignmentKind || assignment.assignmentType))}</span>
          <span>${escapeHTML(assignment.title || [assignment.category, assignment.product, assignment.size].filter(Boolean).join(" / ") || "Program")}</span>
          <span>${escapeHTML(staffScopeSummary(assignment))}</span>
          <em class="${escapeAttribute(staffAssignmentStatus(assignment))}">${escapeHTML(staffAssignmentStatusLabel(assignment.status))}</em>
          <span>${escapeHTML(staffAssignmentProgress(assignment))}</span>
          <span>${escapeHTML(score)}</span>
          <span class="staff-row-actions">
            <button class="line-action ui-button ui-button--secondary ui-button--sm" type="button" data-assignment-detail="${escapeAttribute(assignment.id)}">Detay</button>
            <button class="danger-mini ui-button ui-button--danger ui-button--sm" type="button" data-delete-assignment="${escapeAttribute(assignment.id)}">Sil</button>
          </span>
        </article>
      `;
    }).join("")}
      </div>
    `;
  }

async function handleStaffAssignmentListClick(event) {
    const detailButton = event.target.closest("[data-assignment-detail]");
    if (detailButton) {
      renderStaffAssignmentDetail(detailButton.dataset.assignmentDetail);
      return;
    }

    const button = event.target.closest("[data-delete-assignment]");
    if (!button) return;
    if (!await adminConfirm("Bu ödev kalıcı olarak silinecek.", { title: "Ödevi sil", confirmLabel: "Sil", danger: true })) return;
    try {
      const result = await backendRequest(`/api/admin/recipe-assignments/${encodeURIComponent(button.dataset.deleteAssignment)}`, {
        method: "DELETE"
      });
      if (Array.isArray(result.assignments)) state.recipeAccess.assignments = result.assignments;
      if (els.staffAssignmentDetail) els.staffAssignmentDetail.hidden = true;
      renderStaffAccess();
    } catch (error) {
      if (els.staffAssignmentMessage) els.staffAssignmentMessage.textContent = error.message || "Ödev silinemedi";
    }
  }

function renderStaffAssignmentDetail(id) {
    const assignment = (state.recipeAccess.assignments || []).find((item) => item.id === id);
    if (!assignment || !els.staffAssignmentDetail) return;
    const questions = Array.isArray(assignment.questions) ? assignment.questions : [];
    const answers = Array.isArray(assignment.answers) ? assignment.answers : [];
    const recipeItems = Array.isArray(assignment.recipeItems) ? assignment.recipeItems : [];
    const failedItems = Array.isArray(assignment.failedItems) ? assignment.failedItems : [];
    els.staffAssignmentDetail.hidden = false;
    els.staffAssignmentDetail.innerHTML = `
      <div class="staff-box-head">
        <h4>Program Detayı</h4>
        <button class="line-action" type="button" data-close-assignment-detail>Kapat</button>
      </div>
      <div class="staff-detail-grid">
        <span>Personel</span><strong>${escapeHTML(assignment.name || assignment.username || "Silinmiş Kullanıcı")}</strong>
        <span>Başlık</span><strong>${escapeHTML(assignment.title || "-")}</strong>
        <span>Tip</span><strong>${escapeHTML(staffAssignmentKindLabel(assignment.assignmentKind || assignment.assignmentType))}</strong>
        <span>Kapsam</span><strong>${escapeHTML(staffScopeSummary(assignment))}</strong>
        <span>Durum</span><strong>${escapeHTML(staffAssignmentStatusLabel(assignment.status))}</strong>
        <span>İlerleme</span><strong>${escapeHTML(staffAssignmentProgress(assignment))}</strong>
        <span>Skor</span><strong>${escapeHTML(staffAssignmentScore(assignment))}</strong>
        <span>Tamamlanma</span><strong>${escapeHTML(formatStaffDate(assignment.completedAt))}</strong>
        <span>Yönetici notu</span><strong>${escapeHTML(assignment.adminNote || "-")}</strong>
      </div>
      ${recipeItems.length ? `
        <div class="staff-question-list">
          <article>
            <strong>Kapsamdaki reçeteler</strong>
            <span>${escapeHTML(recipeItems.map((item) => [item.category, item.product, item.size].filter(Boolean).join(" / ")).join(" | "))}</span>
          </article>
        </div>
      ` : ""}
      ${failedItems.length ? `
        <div class="staff-question-list">
          <article>
            <strong>Yanlış yapılan ürünler</strong>
            <span>${escapeHTML(failedItems.map((item) => [item.category, item.product, item.size].filter(Boolean).join(" / ")).join(" | "))}</span>
          </article>
        </div>
      ` : ""}
      <div class="staff-question-list">
        ${questions.map((question, index) => {
      const givenIndex = Number(answers[index]);
      const correctIndex = Number(question.correctIndex);
      const options = Array.isArray(question.options) ? question.options : [];
      return `
          <article>
            <strong>${escapeHTML(index + 1)}. ${escapeHTML(question.text || "Soru")}</strong>
            <span>Verilen cevap: ${escapeHTML(options[givenIndex] || "-")}</span>
            <span>Dogru cevap: ${escapeHTML(options[correctIndex] || "-")}</span>
          </article>
        `;
    }).join("")}
      </div>
    `;
    const closeButton = els.staffAssignmentDetail.querySelector("[data-close-assignment-detail]");
    if (closeButton) closeButton.addEventListener("click", () => {
      els.staffAssignmentDetail.hidden = true;
    });
  }

function renderStaffActivity(activity) {
    const tab = state.staffActivityTab || "login";
    const list = (Array.isArray(activity) ? activity : [])
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const filtered = list.filter((item) => staffActivityMatchesTab(item, tab)).slice(0, 50);
    if (els.staffActivityCount) els.staffActivityCount.textContent = `${list.length} kayıt`;
    if (!els.staffActivityList) return;
    if (els.staffActivityTabs) {
      Array.from(els.staffActivityTabs.querySelectorAll("[data-staff-activity-tab]")).forEach((button) => {
        button.classList.toggle("is-active", button.dataset.staffActivityTab === tab);
      });
    }
    if (!filtered.length) {
      els.staffActivityList.innerHTML = `<div class="staff-empty">Bu sekmede aktivite yok.</div>`;
      return;
    }

    els.staffActivityList.innerHTML = `
      <div class="staff-ledger staff-activity-ledger">
        <div class="staff-ledger-head">
          <span>Personel</span>
          <span>Hareket</span>
          <span>Detay</span>
          <span>Tarih</span>
        </div>
        ${filtered.map((item) => `
          <article class="staff-activity-row">
            <strong>${escapeHTML(item.name || item.username || "Bilinmeyen kullanıcı")}</strong>
            <span>${escapeHTML(staffActivityLabel(item.type))}</span>
            <span>${escapeHTML(staffActivityDetail(item))}</span>
            <time>${escapeHTML(formatStaffDate(item.createdAt))}</time>
          </article>
        `).join("")}
      </div>
    `;
  }

function handleStaffActivityTabClick(event) {
    const button = event.target.closest("[data-staff-activity-tab]");
    if (!button) return;
    state.staffActivityTab = button.dataset.staffActivityTab || "login";
    renderStaffActivity((state.recipeAccess && state.recipeAccess.activity) || []);
  }

function staffActivityLabel(type) {
    const value = String(type || "");
    if (value === "login") return "Giriş yaptı";
    if (value === "login_failed") return "Hatalı giriş";
    if (value === "view_recipe") return "Reçete açtı";
    if (value === "view_preparation") return "Hazırlanışa baktı";
    if (value === "assignment_created") return "Ödev atandı";
    if (value === "assignment_started") return "Ödev başladı";
    if (value === "training_started") return "Eğitim başladı";
    if (value === "training_assigned") return "Eğitim atandı";
    if (value === "training_completed") return "Eğitim tamamlandı";
    if (value === "homework_assigned") return "Ödev atandı";
    if (value === "homework_started") return "Ödev başladı";
    if (value === "homework_completed") return "Ödev tamamlandı";
    if (value === "exam_assigned") return "Sınav atandı";
    if (value === "exam_started") return "Sınav başladı";
    if (value === "exam_completed") return "Sınav tamamlandı";
    if (value === "exam_failed") return "Sınav başarısız";
    if (value === "retry_training_suggested") return "Tekrar eğitimi önerildi";
    if (value === "assignment_completed") return "Ödev tamamlandı";
    if (value === "assignment_retry_required") return "Tekrar gerekli";
    if (value === "recipe_user_deactivated") return "Yetki kaldırıldı";
    if (value === "recipe_user_reactivated") return "Yetki tekrar verildi";
    if (value === "recipe_user_permanently_deleted") return "Kalıcı silindi";
    if (value === "task_assigned") return "Görev atandı";
    if (value === "task_progress") return "Görev ilerledi";
    if (value === "task_completed") return "Görev tamamlandı";
    if (value === "task_status_changed") return "Görev durumu değişti";
    if (value === "shift_requested") return "Vardiya talebi gönderildi";
    if (value === "shift_request_cancelled") return "Vardiya talebi iptal edildi";
    if (value === "shift_request_approved") return "Vardiya talebi onaylandı";
    if (value === "shift_request_rejected") return "Vardiya talebi reddedildi";
    if (value === "shifts_drafted") return "Vardiya taslağı kaydedildi";
    if (value === "shifts_auto_drafted") return "Otomatik vardiya taslağı oluşturuldu";
    if (value === "shifts_draft_applied") return "Vardiya taslağı uygulandı";
    if (value === "shifts_published") return "Vardiyalar yayınlandı";
    if (value === "shift_settings_updated") return "Vardiya saatleri güncellendi";
    return value || "Aktivite";
  }

function staffActivityMatchesTab(item, tab) {
    const value = String(item && item.type || "");
    if (tab === "login") return value === "login" || value === "login_failed";
    if (tab === "recipe") return value === "view_recipe" || value === "view_preparation";
    if (tab === "training") {
      return ["training_assigned", "training_started", "training_completed", "retry_training_suggested"].includes(value);
    }
    if (tab === "homework") {
      return ["homework_assigned", "homework_started", "homework_completed"].includes(value);
    }
    if (tab === "exam") {
      return ["exam_assigned", "exam_started", "exam_completed", "exam_failed", "assignment_created", "assignment_started", "assignment_completed", "assignment_retry_required"].includes(value);
    }
    if (tab === "operations") {
      return [
        "task_assigned", "task_progress", "task_completed", "task_status_changed",
        "shift_requested", "shift_request_cancelled", "shift_request_approved", "shift_request_rejected",
        "shifts_drafted", "shifts_auto_drafted", "shifts_draft_applied", "shifts_published",
        "shift_settings_updated"
      ].includes(value);
    }
    return ["recipe_user_deactivated", "recipe_user_reactivated", "recipe_user_permanently_deleted", "login_failed"].includes(value);
  }

function staffActivityDetail(item) {
    const parts = [item.category, item.product, item.size, item.panel].filter(Boolean);
    if (item.assignmentTitle) parts.unshift(item.assignmentTitle);
    if (item.status) parts.push(staffAssignmentStatusLabel(item.status));
    if (Number(item.total || 0)) parts.push(staffAssignmentScore(item));
    return parts.join(" / ") || "-";
  }

function staffAssignmentStatus(assignment) {
    const value = String(assignment && assignment.status || "pending");
    return ["pending", "in_progress", "completed", "failed", "retry_required"].includes(value) ? value : "pending";
  }

function staffAssignmentStatusLabel(status) {
    const value = String(status || "pending");
    return {
      pending: "Bekliyor",
      in_progress: "Devam ediyor",
      completed: "Tamamlandı",
      failed: "Tekrar gerekli",
      retry_required: "Tekrar gerekli"
    }[value] || "Bekliyor";
  }

function staffAssignmentKindLabel(type) {
    return {
      quick_quiz: "Hizli Quiz",
      quiz: "Hizli Quiz",
      training: "Eğitim Paketi",
      homework: "Çalışma Ödevi",
      exam: "Hakimiyet Sınavı",
      training_quiz: "Eğitim + Test (Eski)",
      retraining: "Tekrar Eğitimi"
    }[String(type || "quick_quiz")] || "Hizli Quiz";
  }

function staffScopeTypeLabel(type) {
    return {
      all: "Tüm reçeteler",
      category: "Kategori",
      products: "Ürünler",
      failed_items: "Yanlış yapılanlar"
    }[String(type || "products")] || "Ürünler";
  }

function staffScopeSummary(assignment) {
    const scope = String(assignment && assignment.scopeType || "products");
    const items = Array.isArray(assignment && assignment.recipeItems) ? assignment.recipeItems : [];
    if (scope === "all") return "Tüm reçeteler";
    if (scope === "category") return assignment.category || "Kategori";
    if (scope === "failed_items") return items.length ? `${items.length} yanlış ürün` : "Yanlış yapılanlar";
    if (items.length > 1) return `${items.length} reçete`;
    if (items.length === 1) return [items[0].product, items[0].size].filter(Boolean).join(" / ");
    return [assignment && assignment.category, assignment && assignment.product, assignment && assignment.size].filter(Boolean).join(" / ") || "Ürünler";
  }

function staffAssignmentProgress(assignment) {
    const totalItems = Array.isArray(assignment && assignment.recipeItems) ? assignment.recipeItems.length : 0;
    const completedItems = Array.isArray(assignment && assignment.completedItems) ? assignment.completedItems.length : 0;
    if (totalItems) return `${completedItems}/${totalItems}`;
    const percent = Number(assignment && assignment.percent);
    if (Number.isFinite(percent) && percent > 0) return `%${Math.round(percent)}`;
    return staffAssignmentStatusLabel(staffAssignmentStatus(assignment));
  }

function staffAssignmentScore(assignment) {
    const total = Number(assignment && assignment.total || 0) || 0;
    const score = Number(assignment && assignment.score || 0) || 0;
    if (!total) return "-";
    const status = staffAssignmentStatus(assignment);
    if (status === "pending") return "Bekliyor";
    if (status === "in_progress") return "Devam ediyor";
    return `${score}/${total}`;
  }

function formatStaffDate(value) {
    if (!value) return "-";
    try {
      return new Intl.DateTimeFormat("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    } catch (error) {
      return String(value);
    }
  }

function recipeCategoryNames() {
    return Object.keys(state.recipes || {});
  }

function recipeProductNames(categoryName) {
    return Object.keys((state.recipes && state.recipes[categoryName]) || {});
  }
window.MenuSuiteAdminDialogs = Object.freeze({
    confirm: adminConfirm,
    alert: adminNotice,
    prompt: adminPrompt
  });
window.__MENU_SUITE_REFRESH_STAFF_LEDGER__ = hydrateRecipeAccessFromBackend;
  document.addEventListener("keydown", event => { if(!els.staffDeleteModal || els.staffDeleteModal.hidden) return; if(event.key==="Tab")trapStaffDeleteFocus(event); if(event.key==="Escape"&&!staffDeleteBusy){event.preventDefault();closeStaffDeleteDialog();} });
  let staffGateway=null;
  function stopStaffGateway(){if(staffGateway){staffGateway.close();staffGateway=null;}}
  document.addEventListener("menu-suite:admin-session-ended",stopStaffGateway);
  document.addEventListener("menu-suite:admin-section-change",event=>{
    if(!["overview", "staffAccess", "approvals"].includes(event.detail?.section)){stopStaffGateway();return;}
    if(staffGateway||typeof EventSource!=="function")return;
    staffGateway=new EventSource("/api/events?appId=yonetici",{withCredentials:true});
    staffGateway.addEventListener("event",event=>{try{const data=JSON.parse(event.data);document.dispatchEvent(new CustomEvent("menu-suite:gateway-event",{detail:data}));if(state.activeSection==="overview"&&["catalog","inventory"].includes(data.topic))void loadStockOverview();}catch(_error){}});
  });

})();
