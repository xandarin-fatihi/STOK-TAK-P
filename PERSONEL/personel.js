(function () {
  "use strict";

  const LEGACY_SECTION_REDIRECTS = Object.freeze({
    barcode: "materialLocation",
    stockAction: "stock",
    count: "stock",
    notifications: "home",
    newProduct: "materialLocation",
    "new-product": "materialLocation"
  });
  const PERSONEL_SECTION_KEYS = ["home", "stock", "materialLocation", "materialRequest", "shift", "shipment", "tasks"];
  const PREVIEW_TOKEN = readPreviewToken();
  const PREVIEW_SECTION = readPreviewSection();
  const SIDEBAR_KEY = "menu-suite.personel.sidebarCollapsed.v1";
  const LAST_SECTION_KEY = "menu-suite.personel.lastSection.v1";
  const MOBILE_SIDEBAR_QUERY = "(max-width: 880px)";
  const WORKFORCE_SECTIONS = new Set(["materialRequest", "shipment", "shift", "tasks"]);
  const LAZY_RESOURCE_TIMEOUT_MS = 10000;
  const OVERVIEW_PAGE_SIZE = 7;
  const lazyResources = new Map();
  let notificationsModulePromise = null;
  let notificationLoadWanted = false;
  let themeRequest = null;
  let activeBrandName = "Personel";
  let activeBrand = {};

  const sectionMeta = {
    home: {
      kicker: "",
      title: "Genel Bakış",
      description: ""
    },
    barcode: {
      kicker: "Personel",
      title: "Barkod Sorgula",
      description: "Barkod veya ürün koduyla stok kataloğunda arama yapın."
    },
    materialLocation: {
      kicker: "Personel",
      title: "Malzeme Nerede?",
      description: "Malzemeyi adı, modeli, ürün kodu veya markasıyla bulun ve kayıtlı konumunu görüntüleyin."
    },
    stock: {
      kicker: "Personel",
      title: "Stok",
      description: "Yetkili olduğunuz deponun güncel stok durumunu görüntüleyin ve stok işlemlerini kaydedin."
    },
    profile: {
      kicker: "Personel",
      title: "Profil",
      description: "Kendi personel profilinizi düzenleyin."
    },
    shipment: {
      kicker: "Personel",
      title: "Sevkiyat",
      description: "Gelen stok ürünlerini yönetici onayına bildirin ve durumunu takip edin."
    },
    materialRequest: {
      kicker: "Personel",
      title: "Malzeme Talebi",
      description: "İhtiyaç duyduğunuz malzemeleri tek talepte hazırlayın ve yöneticiye gönderin."
    },
    tasks: { kicker: "Personel", title: "Görevlerim", description: "" },
    shift: {
      kicker: "Personel",
      title: "İzin Talebi",
      description: "İzin ve çalışma saati taleplerinizi oluşturup durumlarını takip edin."
    }
  };

  const state = {
    user: null,
    section: "home",
    stock: emptyStockState(),
    stockEventSource: null,
    stockLoaded: false,
    stockLoadPromise: null,
    stockRevision: 0,
    stockSearchTimer: null,
    stockRefreshTimer: null,
    stockRefreshPending: false,
    query: "",
    category: "all",
    detailProductId: null,
    detailTrigger: null,
    stockAction: null,
    stockActionSubmitting: false,
    stockImageViewerTrigger: null,
    stockImageZoom: 1,
    stockImagePanX: 0,
    stockImagePanY: 0,
    stockImageDrag: null,
    barcodeQuerySequence: 0,
    barcodeQueryPromise: null,
    barcodeLastQuery: "",
    barcodeLastProductId: "",
    barcodeReader: null,
    barcodeCameraControls: null,
    barcodeCameraStarting: false,
    barcodeCameraSession: 0,
    barcodeScannerTrigger: null,
    criticalRequestMode: false,
    criticalRequestItems: Object.create(null),
    criticalRequestBusy: false,
    criticalRequestId: "",
    criticalRequestFingerprint: "",
    materialQuery: "",
    materialCategory: "all",
    materialInStock: false,
    materialLocationProductId: "",
    materialLocationTrigger: null,
    stockHistoryLoadPromise: null,
    stockHistoryLoadProductId: "",
    stockReversePendingId: "",
    gatewayEventSource: null,
    gatewayEventIds: new Set(),
    gatewayTopicRevisions: Object.create(null),
    previewRecipeDraft: null,
    pendingProfileAvatar: "",
    mobileSidebar: false,
    sessionActive: false,
    sessionPreview: false,
    notificationUnreadCount: 0,
    notificationUnreadLoaded: false,
    notificationUnreadLoadedAt: 0,
    notificationBadgePromise: null,
    profileWorkspace: "profile",
    logoutPending: false,
    appearanceDraft: null,
    readPromises: new Map(),
    overviewStatus: "idle",
    overviewError: "",
    overviewLoadPromise: null,
    overviewMovementsLoaded: false,
    overviewWorkforceLoaded: false,
    overviewWorkforce: { shipments: [], materialRequests: [], shiftRequests: [] },
    overviewSources: {
      stock: { status: "idle", error: "" },
      movements: { status: "idle", error: "" },
      workforce: { status: "idle", error: "" }
    },
    overviewDialog: {
      open: false,
      kind: "",
      query: "",
      page: 1,
      expandedId: "",
      trigger: null
    },
    overviewRefreshTimer: null,
    overviewRefreshPending: false,
    overviewRefreshKinds: new Set()
  };

  const els = {};

  window.MenuSuitePersonelShell = Object.freeze({
    getContext: personelShellContext,
    read: readPersonelData,
    navigate: navigatePersonelSection,
    openNotificationRecord: async (section, entityId) => {
      if (!personelSectionAllowed(section)) throw new Error("Bu bildirimin bağlı olduğu bölüme erişiminiz kapalı.");
      setSection(section, { updateHash: false });
      if (section === "stock") {
        await loadStock({ force: true });
        if (entityId && !stockProducts().some(product => String(product.id) === String(entityId))) throw new Error("Bu stok kartı kaldırılmış veya artık erişilemiyor.");
        if (entityId) openStockDetail(entityId);
      } else if (["tasks", "shipment", "shift", "materialRequest"].includes(section)) {
        await ensureWorkforceModule();
        await window.MenuSuitePersonelWorkforce.openNotificationRecord(section, entityId);
      }
    },
    ensureWorkforce: ensureWorkforceModule,
    ensureNotifications: ensureNotificationsModule,
    ensureAccountSecurity: ensureAccountSecurityModule
  });

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    [
      "personelApp", "personelLogin", "personelDashboard", "personelLoginForm", "personelUsername", "personelPassword", "recipeFrame",
      "loginMessage", "personelSidebarToggle", "personelSidebar", "personelSidebarOverlay", "sectionKicker", "sectionTitle",
      "sectionDescription", "sectionHome", "sectionBarcode", "sectionMaterialLocation", "sectionStock", "sectionProfile", "sectionMaterialRequest", "sectionShipment", "sectionShift", "sectionTasks", "sidebarUser", "profilePopover",
      "profileMenuAvatar", "profileMenuName", "profileMenuRole", "profileMenuMessage",
      "profileForm", "profileName", "profileAvatarUrl", "profilePhotoInput", "profileBio",
      "profileMessage", "profileAvatar", "profileAppearance", "profileAppearanceCancel", "personelNotificationTrigger", "personelNotificationBadge", "personelNotificationUnreadText",
      "personelNotificationDrawer", "personelNotificationBackdrop", "personelNotificationClose", "personelNotificationList",
      "personelNotificationPreferencesState", "personelAccountSecurityMessage", "personelOverviewState", "personelOverviewStateTitle", "personelOverviewStateText", "personelOverviewRetry", "personelOverviewContent",
      "overviewCriticalCount", "overviewShipmentCount", "overviewRequestCount", "overviewProductCount", "overviewCriticalList", "overviewMovementList",
      "personelOverviewDialogShell", "personelOverviewBackdrop", "personelOverviewDialog", "personelOverviewDialogClose", "personelOverviewDialogTitle", "personelOverviewDialogMeta", "personelOverviewSearch", "personelOverviewSearchInput", "personelOverviewDialogBody", "personelOverviewPagination",
      "stockMessage", "stockSearchInput", "stockCategoryPills", "stockGrid",
      "stockDetailModal", "stockDetailClose", "stockDetailTitle", "stockDetailMedia", "stockDetailImage",
      "stockDetailQuantity", "stockDetailMessage",
      "stockActionForm", "stockActionPanel", "stockActionQuantity", "stockActionMessage", "stockActionSubmit",
      "stockImageViewer", "stockImageViewerBackdrop", "stockImageViewerTitle", "stockImageViewerImage", "stockImageViewerStage",
      "stockImageZoomOut", "stockImageZoomReset", "stockImageZoomIn", "stockImageViewerClose"
      , "barcodeLookupForm", "barcodeLookupInput", "barcodeLookupSubmit", "barcodeCameraOpen", "barcodePhotoOpen", "barcodePhotoInput", "barcodeCameraPanel", "barcodeCameraVideo", "barcodeCameraClose", "barcodeReaderMessage", "barcodeLookupResult"
      , "materialSearchForm", "materialSearchInput", "materialSearchSubmit", "materialCategoryFilter", "materialInStockFilter", "materialSearchMessage", "materialSearchResults"
      , "materialLocationModal", "materialLocationBackdrop", "materialLocationClose", "materialLocationTitle", "materialLocationCode", "materialLocationContent"
      , "barcodeScannerModal", "barcodeScannerBackdrop", "overviewCriticalActions", "overviewCriticalSelection", "overviewCriticalCancel", "overviewCriticalRequest", "overviewCriticalMessage"
    ].forEach((id) => { els[id] = document.getElementById(id); });

    setView("booting");
    bindEvents();
    await Promise.all([boot(), refreshPanelTheme()]);
  }

  function refreshPanelTheme() {
    if (themeRequest) return themeRequest;
    const theme = window.MenuSuitePanelTheme;
    if (!theme) return Promise.resolve();
    applyAppearance(state.user && state.user.appearance || {
      presetId: document.documentElement.dataset.adminThemePreset || theme.defaultAppearance.presetId,
      mode: document.documentElement.dataset.appearanceMode || "light"
    });
    const identity = window.BrandIdentity;
    identity?.load({ logoSelector: ".login-logo, .brand-block img", appId: "personel", kind: "personel", fallbackName: "Personel" })
      .then(applyPersonelBrand).catch(() => {});
    themeRequest = fetch("/api/public/panel-theme", {
      credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store"
    }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json();
      if (state.user) applyAppearance(state.appearanceDraft || state.user.appearance);
      const brand = payload.brandInfo && typeof payload.brandInfo === "object" ? payload.brandInfo : {};
      applyPersonelBrand(brand);
    }).catch(() => {}).finally(() => { themeRequest = null; });
    return themeRequest;
  }

  function applyPersonelBrand(brand) {
    activeBrand = brand && typeof brand === "object" ? brand : {};
    const identity = window.BrandIdentity;
    const registeredName = String(activeBrand.cafeName || activeBrand.menuBrandTitle || "").trim();
    activeBrandName = registeredName || "Personel";
    const logoUrl = identity?.logo(activeBrand, document.documentElement.dataset.appearanceMode === "dark" ? "dark" : "light", "personel", "personel") || "/assets/app-icons/personel/master.svg";
    document.title = String(activeBrand.personelBrowserTitle || "").trim() || (registeredName ? `${registeredName} Personel` : "Personel");
    document.querySelectorAll(".login-logo, .brand-block img").forEach((image) => {
      image.src = logoUrl;
      image.alt = registeredName ? `${registeredName} logosu` : "Uygulama simgesi";
    });
    document.querySelectorAll(".brand-copy small").forEach((label) => { label.textContent = activeBrandName; });
    identity?.apply(activeBrand, { logoSelector: ".login-logo, .brand-block img", appId: "personel", kind: "personel", fallbackName: "Personel" });
  }

  function bindEvents() {
    els.profileAppearance?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-appearance-preset], [data-appearance-mode]");
      if (!button || !state.user) return;
      const appearance = window.MenuSuitePanelTheme.normalizeAppearance(state.appearanceDraft || state.user.appearance);
      if (button.dataset.appearancePreset) appearance.presetId = button.dataset.appearancePreset;
      if (button.dataset.appearanceMode) appearance.mode = button.dataset.appearanceMode;
      state.appearanceDraft = appearance;
      applyAppearance(appearance);
      renderAppearance();
    });
    els.profileAppearanceCancel?.addEventListener("click", () => {
      state.appearanceDraft = null;
      fillProfileForm();
      applyAppearance(state.user && state.user.appearance);
      setProfileMessage("Son kaydedilmiş tercihler geri yüklendi.");
    });
    document.addEventListener("menu-suite:preview-draft", handlePreviewDraftMessage);
    document.addEventListener("personel:session-ended", handlePersonelSessionEnded);
    document.addEventListener("personel:overview-stale", (event) => {
      const scope = event && event.detail && event.detail.scope;
      if (scope === "workforce") state.overviewWorkforceLoaded = false;
      if (scope === "movements") state.overviewMovementsLoaded = false;
      if (state.section === "home" && scope) scheduleOverviewRefresh([scope]);
    });
    if (els.personelLoginForm) els.personelLoginForm.addEventListener("submit", login);
    if (els.personelSidebarToggle) els.personelSidebarToggle.addEventListener("click", () => {
      const collapsed = !isSidebarCollapsed();
      setSidebarCollapsed(collapsed, { focusDrawer: !collapsed });
    });
    if (els.personelSidebarOverlay) els.personelSidebarOverlay.addEventListener("click", () => {
      setSidebarCollapsed(true, { persist: false, restoreFocus: true });
    });

    if (els.sidebarUser) els.sidebarUser.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleProfilePopover();
    });

    els.personelNotificationTrigger?.addEventListener("click", () => {
      if (!state.sessionActive || state.sessionPreview) return;
      if (notificationLoadWanted || !els.personelNotificationDrawer?.hidden) {
        notificationLoadWanted = false;
        if (window.MenuSuitePersonelNotifications) window.MenuSuitePersonelNotifications.close();
        else closeNotificationModuleShell();
        return;
      }
      void openNotificationsFromShell();
    });
    els.personelNotificationClose?.addEventListener("click", () => {
      if (!window.MenuSuitePersonelNotifications) closeNotificationModuleShell();
    });
    els.personelNotificationBackdrop?.addEventListener("click", () => {
      if (!window.MenuSuitePersonelNotifications) closeNotificationModuleShell();
    });
    els.personelNotificationList?.addEventListener("click", (event) => {
      if (event.target.closest("[data-notification-module-retry]")) void openNotificationsFromShell();
    });

    if (els.profilePopover) els.profilePopover.addEventListener("click", (event) => {
      const action = event.target.closest("[data-profile-action]");
      if (!action) return;
      if (action.dataset.profileAction === "edit") {
        closeProfilePopover();
        setProfileWorkspace("profile");
        setSection("profile", { updateHash: false });
        if (isMobileSidebar()) setSidebarCollapsed(true, { persist: false });
      }
      if (action.dataset.profileAction === "notifications") {
        closeProfilePopover();
        setProfileWorkspace("notifications");
        setSection("profile", { updateHash: false });
        if (isMobileSidebar()) setSidebarCollapsed(true, { persist: false });
        void Promise.all([ensureNotificationsModule(), ensureAccountSecurityModule()]).then(() => {
          document.getElementById("personelNotificationPreferencesForm")?.focus?.({ preventScroll: true });
        }).catch(() => setProfileMenuMessage("Bildirim ayarları yüklenemedi."));
      }
      if (action.dataset.profileAction === "logout") {
        closeProfilePopover();
        logout();
      }
    });
    if (els.profilePopover) els.profilePopover.addEventListener("keydown", handleProfileMenuKeydown);
    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-profile-workspace-back]")) return;
      setProfileWorkspace("profile");
    });

    document.querySelectorAll(".personel-nav [data-section]").forEach((button) => {
      button.addEventListener("click", () => {
        setSection(button.dataset.section, { updateHash: false });
        if (isMobileSidebar()) setSidebarCollapsed(true, { persist: false, restoreFocus: true });
      });
    });

    els.sectionHome?.addEventListener("click", (event) => {
      const retryButton = event.target.closest("[data-overview-retry-source]");
      if (retryButton) {
        void retryOverviewSource(retryButton.dataset.overviewRetrySource);
        return;
      }
      const pageButton = event.target.closest("[data-overview-page]");
      if (pageButton) {
        state.overviewDialog.page = Math.max(1, Number(pageButton.dataset.overviewPage) || 1);
        renderOverviewDialog({ focusBody: true });
        return;
      }
      const recordButton = event.target.closest("[data-overview-record-id]");
      if (recordButton) {
        toggleOverviewRecord(recordButton.dataset.overviewRecordId);
        return;
      }
      const productButton = event.target.closest("[data-overview-product-id]");
      if (productButton) {
        void openOverviewProduct(productButton.dataset.overviewProductId, productButton);
        return;
      }
      const movementButton = event.target.closest("[data-overview-movement-id]");
      if (movementButton) {
        openOverviewDialog("movements", { trigger: movementButton, expandedId: movementButton.dataset.overviewMovementId });
        return;
      }
      const action = event.target.closest("[data-overview-action]");
      if (action) void handleOverviewAction(action.dataset.overviewAction, action);
    });
    els.personelOverviewRetry?.addEventListener("click", () => {
      void loadOverview({ forceStock: true, forceMovements: true, forceWorkforce: true }).catch(() => {});
    });
    els.personelOverviewDialogClose?.addEventListener("click", closeOverviewDialog);
    els.personelOverviewBackdrop?.addEventListener("click", closeOverviewDialog);
    els.personelOverviewSearchInput?.addEventListener("input", () => {
      state.overviewDialog.query = els.personelOverviewSearchInput.value;
      state.overviewDialog.page = 1;
      state.overviewDialog.expandedId = "";
      renderOverviewDialog();
    });

    document.querySelectorAll("[data-personel-go-stock]").forEach((button) => {
      button.addEventListener("click", () => setSection("stock", { updateHash: false }));
    });
    els.barcodeLookupForm?.addEventListener("submit", submitBarcodeLookup);
    els.barcodeLookupInput?.addEventListener("input", clearBarcodeDraftResult);
    els.barcodeCameraOpen?.addEventListener("click", openBarcodeScanner);
    els.barcodeCameraClose?.addEventListener("click", () => closeBarcodeScanner());
    els.barcodeScannerBackdrop?.addEventListener("click", () => closeBarcodeScanner());
    els.barcodePhotoOpen?.addEventListener("click", () => els.barcodePhotoInput?.click());
    els.barcodePhotoInput?.addEventListener("change", () => void decodeBarcodePhoto());
    els.barcodeLookupResult?.addEventListener("click", (event) => {
      const action = event.target.closest("[data-barcode-action]");
      if (!action) return;
      if (action.dataset.barcodeAction === "retry") void submitBarcodeLookup(null, { force: true });
      if (action.dataset.barcodeAction === "material") void openMaterialSearch();
      if (action.dataset.barcodeAction === "location") openMaterialLocation(action.dataset.productId, action);
    });
    els.materialSearchForm?.addEventListener("submit", submitMaterialSearch);
    els.materialCategoryFilter?.addEventListener("change", submitMaterialSearch);
    els.materialInStockFilter?.addEventListener("change", submitMaterialSearch);
    els.materialSearchResults?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-material-location-product]");
      if (button) openMaterialLocation(button.dataset.materialLocationProduct, button);
    });
    els.materialLocationClose?.addEventListener("click", closeMaterialLocation);
    els.materialLocationBackdrop?.addEventListener("click", closeMaterialLocation);
    els.overviewCriticalRequest?.addEventListener("click", () => {
      if (state.criticalRequestMode) void submitCriticalMaterialRequest();
      else { state.criticalRequestMode = true; state.overviewDialog.expandedId = ""; renderOverviewDialog(); }
    });
    els.overviewCriticalCancel?.addEventListener("click", () => {
      if (state.criticalRequestBusy) return;
      state.criticalRequestMode = false;
      state.criticalRequestItems = Object.create(null);
      renderOverviewDialog();
    });
    els.personelOverviewDialogBody?.addEventListener("change", handleCriticalRequestInput);
    els.personelOverviewDialogBody?.addEventListener("input", handleCriticalRequestInput);
    els.personelOverviewDialogBody?.addEventListener("click", (event) => {
      const step = event.target.closest("[data-critical-step]");
      if (!step || state.criticalRequestBusy) return;
      const input = step.closest(".overview-critical-row").querySelector("[data-critical-quantity]");
      input.value = String(Math.max(1, (Number(input.value) || 1) + Number(step.dataset.criticalStep)));
      handleCriticalRequestInput({ target: input });
    });
    document.querySelectorAll("[data-personel-open-notifications]").forEach((button) => {
      button.addEventListener("click", () => void openNotificationsFromShell());
    });

    els.stockSearchInput?.addEventListener("input", () => {
      window.clearTimeout(state.stockSearchTimer);
      state.stockSearchTimer = window.setTimeout(() => {
        state.query = els.stockSearchInput.value.trim();
        renderStock();
      }, 200);
    });
    els.stockCategoryPills?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category || "all";
      renderStock();
    });
    els.stockGrid?.addEventListener("click", (event) => {
      const card = event.target.closest("[data-stock-product-id]");
      if (card) openStockDetail(card.dataset.stockProductId);
    });
    els.stockGrid?.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key) || event.target.closest("button")) return;
      const card = event.target.closest("[data-stock-product-id]");
      if (!card) return;
      event.preventDefault();
      openStockDetail(card.dataset.stockProductId);
    });
    els.stockDetailClose?.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); closeStockDetail(); });
    els.stockDetailModal?.addEventListener("click", (event) => { if (event.target === els.stockDetailModal) closeStockDetail(); });
    els.stockDetailMedia?.addEventListener("click", openStockImageViewer);
    els.stockImageViewerBackdrop?.addEventListener("click", () => closeStockImageViewer());
    els.stockImageViewerClose?.addEventListener("click", () => closeStockImageViewer());
    els.stockImageZoomOut?.addEventListener("click", () => setStockImageZoom(state.stockImageZoom - 0.25));
    els.stockImageZoomReset?.addEventListener("click", () => setStockImageZoom(1));
    els.stockImageZoomIn?.addEventListener("click", () => setStockImageZoom(state.stockImageZoom + 0.25));
    els.stockImageViewerStage?.addEventListener("wheel", handleStockImageWheel, { passive: false });
    els.stockImageViewerStage?.addEventListener("dblclick", () => setStockImageZoom(state.stockImageZoom > 1 ? 1 : 2));
    els.stockImageViewerStage?.addEventListener("pointerdown", startStockImageDrag);
    els.stockImageViewerStage?.addEventListener("pointermove", moveStockImageDrag);
    els.stockImageViewerStage?.addEventListener("pointerup", endStockImageDrag);
    els.stockImageViewerStage?.addEventListener("pointercancel", endStockImageDrag);
    els.stockImageViewerImage?.addEventListener("load", applyStockImageTransform);
    els.stockActionForm?.addEventListener("submit", submitStockAction);
    els.stockActionQuantity?.addEventListener("input", () => {
      setStockActionMessage("");
      syncStockActionState();
    });

    if (els.profileForm) els.profileForm.addEventListener("submit", saveProfile);
    if (els.profilePhotoInput) els.profilePhotoInput.addEventListener("change", previewProfilePhoto);
    if (els.recipeFrame) els.recipeFrame.addEventListener("load", () => {
      compactRecipeFrame();
      forwardRecipePreviewDraft();
      sendRecipeAppearance();
    });

    document.addEventListener("keydown", (event) => {
      if (els.barcodeScannerModal && !els.barcodeScannerModal.hidden) {
        if (event.key === "Escape") { event.preventDefault(); closeBarcodeScanner(); return; }
        if (event.key === "Tab") { trapStockModalFocus(event, els.barcodeScannerModal.querySelector(".barcode-scanner-dialog")); return; }
      }
      if (event.key === "Tab" && trapOverviewDialogFocus(event)) return;
      if (event.key === "Tab" && trapStockModalFocus(event)) return;
      if (event.key === "Tab" && trapPersonelDrawerFocus(event)) return;
      if (isStockImageViewerOpen() && ["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        if (["+", "="].includes(event.key)) setStockImageZoom(state.stockImageZoom + 0.25);
        if (event.key === "-") setStockImageZoom(state.stockImageZoom - 0.25);
        if (event.key === "0") setStockImageZoom(1);
        return;
      }
      if (event.key === "Escape") {
        if (isOverviewDialogOpen()) {
          closeOverviewDialog();
          return;
        }
        if (els.materialLocationModal && !els.materialLocationModal.hidden) {
          closeMaterialLocation();
          return;
        }
        if (isStockImageViewerOpen()) {
          closeStockImageViewer();
          return;
        }
        if (els.stockDetailModal && !els.stockDetailModal.hidden) {
          if (!state.stockActionSubmitting) closeStockDetail();
          return;
        }
        closeProfilePopover({ restoreFocus: true });
        if (isMobileSidebar() && !isSidebarCollapsed()) {
          setSidebarCollapsed(true, { persist: false, restoreFocus: true });
        }
      }
    });

    document.addEventListener("click", (event) => {
      if (!els.profilePopover || els.profilePopover.hidden) return;
      if (event.target.closest("#profilePopover") || event.target.closest("#sidebarUser")) return;
      closeProfilePopover();
    });

    document.addEventListener("click", (event) => {
      if (!isMobileSidebar() || isSidebarCollapsed()) return;
      if (event.target.closest("#personelSidebar") || event.target.closest("#personelSidebarToggle")) return;
      setSidebarCollapsed(true, { persist: false, restoreFocus: true });
    });

    window.addEventListener("resize", syncSidebarBreakpoint);
  }

  function handlePreviewDraftMessage(event) {
    const payload = event.detail;
    if (!payload || payload.type !== "menu-suite:preview-draft" || payload.schemaVersion !== 1) return;
    if (payload.scope === "stock" && payload.data && typeof payload.data === "object") {
      state.stock = normalizeStock(payload.data.stockState && typeof payload.data.stockState === "object"
        ? payload.data.stockState : payload.data);
      state.stockLoaded = true;
      renderStock();
      refreshLookupSurfaces();
    }
    if (payload.scope === "recipe" && payload.data && typeof payload.data === "object") {
      state.previewRecipeDraft = payload.data.recipeState && typeof payload.data.recipeState === "object"
        ? payload.data.recipeState
        : payload.data;
      forwardRecipePreviewDraft();
    }
  }

  function forwardRecipePreviewDraft() {
    if (!state.previewRecipeDraft || !els.recipeFrame || !els.recipeFrame.contentWindow) return;
    if (els.recipeFrame.getAttribute("src") === "about:blank") return;
    els.recipeFrame.contentWindow.postMessage({
      type: "menu-suite:preview-draft",
      schemaVersion: 1,
      scope: "recipes",
      data: state.previewRecipeDraft,
      source: "personel",
      draft: true
    }, window.location.origin);
  }

  async function boot() {
    try {
      const session = await api("/api/recipe/me");
      activatePersonelSession(session);
      showDashboard();
      if (!PREVIEW_TOKEN) history.replaceState(null, "", "/personel/");
      setSection(PREVIEW_SECTION || readLastSection(), { updateHash: false, persist: false });
    } catch (_error) {
      showLogin();
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginMessage("");
    const username = els.personelUsername ? els.personelUsername.value.trim() : "";
    const password = els.personelPassword ? els.personelPassword.value : "";
    if (!password) {
      setLoginMessage("Şifre gerekli.");
      return;
    }

    try {
      await api("/api/recipe/login", {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      const session = await api("/api/recipe/me");
      activatePersonelSession(session);
      showDashboard();
      history.replaceState(null, "", "/personel/");
      setSection(firstAllowedPersonelSection(), { updateHash: false });
    } catch (error) {
      setLoginMessage(error.message || "Giriş yapılamadı.");
    }
  }

  async function logout() {
    if (state.logoutPending) return;
    state.logoutPending = true;
    setProfileMenuMessage("");
    const logoutButton = els.profilePopover && els.profilePopover.querySelector('[data-profile-action="logout"]');
    const originalLabel = logoutButton ? logoutButton.textContent : "";
    if (logoutButton) {
      logoutButton.disabled = true;
      logoutButton.setAttribute("aria-busy", "true");
      logoutButton.textContent = "Çıkış yapılıyor…";
    }
    try {
      if (window.MenuSuitePersonelNotifications && typeof window.MenuSuitePersonelNotifications.beforeLogout === "function") {
        await window.MenuSuitePersonelNotifications.beforeLogout().catch(() => null);
      }
      const response = await fetch("/api/recipe/logout", { method: "POST", credentials: "include" });
      if (!response.ok && response.status !== 401) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Çıkış işlemi tamamlanamadı.");
      }
      localStorage.removeItem(LAST_SECTION_KEY);
      if (state.sessionActive) {
        document.dispatchEvent(new CustomEvent("personel:session-ended", {
          detail: { source: "personel-shell", reason: "logout", message: "" }
        }));
        return;
      }
      resetPersonelSession();
      showLogin();
    } catch (error) {
      setProfileMenuMessage(error && error.message || "Çıkış işlemi tamamlanamadı.");
      if (els.profilePopover) els.profilePopover.hidden = false;
      if (els.sidebarUser) els.sidebarUser.setAttribute("aria-expanded", "true");
    } finally {
      state.logoutPending = false;
      if (logoutButton && logoutButton.isConnected) {
        logoutButton.disabled = false;
        logoutButton.removeAttribute("aria-busy");
        logoutButton.textContent = originalLabel || "Çıkış yap";
      }
    }
  }

  function activatePersonelSession(session) {
    const user = session && (session.user || session.recipeUser) || null;
    const userId = String(session && session.userId || user && user.id || "").trim();
    if (!user || !userId || user.active === false) {
      const error = new Error("Aktif personel hesabı bulunamadı. Lütfen personel girişi yapın.");
      error.status = 403;
      throw error;
    }
    state.user = mergeProfile({ ...user, id: userId });
    state.appearanceDraft = null;
    applyAppearance(state.user.appearance);
    state.sessionActive = true;
    state.sessionPreview = session.role === "preview";
    document.dispatchEvent(new CustomEvent("personel:session-started", {
      detail: { userId, preview: state.sessionPreview }
    }));
    setupGatewayEvents();
    setupStockEvents();
    reconcilePersonelSectionAccess({ redirect: false });
    taskBadgeRevision = -1;
    void refreshTaskBadge();
    if (!state.sessionPreview) void loadNotificationUnreadBadge();
  }

  function handlePersonelSessionEnded(event) {
    const detail = event && event.detail || {};
    const message = detail.reason === "logout"
      ? ""
      : detail.message || "Oturumunuz sona erdi. Lütfen yeniden giriş yapın.";
    resetPersonelSession();
    closeProfilePopover();
    if (history.replaceState) history.replaceState(null, "", "/personel/");
    showLogin();
    setLoginMessage(message);
  }

  function resetPersonelSession() {
    closeNotificationModuleShell();
    closeBarcodeScanner({ restoreFocus: false });
    ++taskBadgeSequence;
    taskBadgeRevision = -1;
    window.clearTimeout(taskBadgeTimer);
    clearTaskBadge();
    state.criticalRequestMode = false;
    state.criticalRequestItems = Object.create(null);
    state.criticalRequestBusy = false;
    state.criticalRequestId = "";
    state.criticalRequestFingerprint = "";
    stopBarcodeCamera();
    closeMaterialLocation({ restoreFocus: false });
    closeOverviewDialog({ restoreFocus: false });
    state.sessionActive = false;
    state.sessionPreview = false;
    state.user = null;
    state.stock = emptyStockState();
    state.stockLoaded = false;
    state.stockLoadPromise = null;
    state.stockRevision = 0;
    state.barcodeQuerySequence += 1;
    state.barcodeQueryPromise = null;
    state.barcodeLastQuery = "";
    state.barcodeLastProductId = "";
    state.materialQuery = "";
    state.materialCategory = "all";
    state.materialInStock = false;
    state.detailProductId = null;
    state.stockAction = null;
    window.clearTimeout(state.stockSearchTimer);
    window.clearTimeout(state.stockRefreshTimer);
    state.stockSearchTimer = null;
    state.stockRefreshTimer = null;
    state.stockRefreshPending = false;
    window.clearTimeout(state.overviewRefreshTimer);
    state.overviewRefreshTimer = null;
    state.overviewRefreshPending = false;
    state.overviewRefreshKinds.clear();
    state.overviewStatus = "idle";
    state.overviewError = "";
    state.overviewLoadPromise = null;
    state.overviewMovementsLoaded = false;
    state.overviewWorkforceLoaded = false;
    state.overviewWorkforce = { shipments: [], materialRequests: [], shiftRequests: [] };
    state.overviewSources = {
      stock: { status: "idle", error: "" },
      movements: { status: "idle", error: "" },
      workforce: { status: "idle", error: "" }
    };
    state.overviewDialog = { open: false, kind: "", query: "", page: 1, expandedId: "", trigger: null };
    state.readPromises.clear();
    state.appearanceDraft = null;
    applyAppearance(window.MenuSuitePanelTheme.defaultAppearance);
    state.notificationUnreadCount = 0;
    state.notificationUnreadLoaded = false;
    state.notificationUnreadLoadedAt = 0;
    state.notificationBadgePromise = null;
    state.gatewayEventIds.clear();
    state.gatewayTopicRevisions = Object.create(null);
    renderNotificationUnreadBadge(0);
  }

  function showLogin() {
    closeStockEvents();
    closeGatewayEvents();
    unloadRecipeFrame();
    setView("login");
    if (els.personelPassword) els.personelPassword.value = "";
  }

  function showDashboard() {
    setView("dashboard");
    applySidebarPreference();
    renderUser();
    fillProfileForm();
  }

  function setView(view) {
    const isLogin = view === "login";
    const isDashboard = view === "dashboard";
    toggleRoot(els.personelLogin, isLogin);
    toggleRoot(els.personelDashboard, isDashboard);
    if (els.personelApp) els.personelApp.dataset.view = view;
    document.body.classList.toggle("is-personel-authenticated", isDashboard);
    if (!isDashboard) document.body.classList.remove("is-personel-drawer-open");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function toggleRoot(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.classList.toggle("is-hidden", !visible);
    element.style.display = visible ? "" : "none";
  }

  function applySidebarPreference() {
    state.mobileSidebar = isMobileSidebar();
    const collapsed = state.mobileSidebar || localStorage.getItem(SIDEBAR_KEY) === "1";
    setSidebarCollapsed(collapsed, { persist: false });
  }

  function isSidebarCollapsed() {
    return Boolean(els.personelDashboard && els.personelDashboard.classList.contains("is-sidebar-collapsed"));
  }

  function setSidebarCollapsed(collapsed, options) {
    if (!els.personelDashboard) return;
    const wasCollapsed = isSidebarCollapsed();
    els.personelDashboard.classList.toggle("is-sidebar-collapsed", Boolean(collapsed));
    if ((!options || options.persist !== false) && !isMobileSidebar()) {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
    }
    syncSidebarUi();
    closeProfilePopover();
    if (isMobileSidebar() && !collapsed && ((options && options.focusDrawer) || wasCollapsed)) {
      window.setTimeout(focusFirstPersonelSidebarControl, 0);
    } else if (isMobileSidebar() && collapsed && options && options.restoreFocus && els.personelSidebarToggle) {
      window.setTimeout(() => els.personelSidebarToggle.focus(), 0);
    }
  }

  function syncSidebarUi() {
    const collapsed = isSidebarCollapsed();
    const mobile = isMobileSidebar();
    const drawerOpen = Boolean(document.body.classList.contains("is-personel-authenticated") && mobile && !collapsed);
    if (els.personelSidebarToggle) {
      const label = collapsed ? "Kenar çubuğunu aç" : "Kenar çubuğunu kapat";
      els.personelSidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      els.personelSidebarToggle.setAttribute("aria-label", label);
      els.personelSidebarToggle.setAttribute("title", label);
    }
    if (els.personelSidebar) {
      els.personelSidebar.setAttribute("aria-hidden", "false");
      els.personelSidebar.inert = false;
      els.personelSidebar.querySelectorAll(":scope > .personel-nav, :scope > .personel-profile-wrap").forEach((region) => {
        region.inert = Boolean(mobile && collapsed);
        region.setAttribute("aria-hidden", mobile && collapsed ? "true" : "false");
      });
    }
    if (els.personelSidebarOverlay) {
      els.personelSidebarOverlay.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
      els.personelSidebarOverlay.tabIndex = -1;
    }
    const workspace = document.querySelector(".personel-dashboard > .personel-workspace");
    if (workspace) workspace.inert = drawerOpen;
    document.body.classList.toggle("is-personel-drawer-open", drawerOpen);
  }

  function focusFirstPersonelSidebarControl() {
    if (!els.personelSidebar || !isMobileSidebar() || isSidebarCollapsed()) return;
    const target = els.personelSidebar.querySelector(".personel-nav button, .sidebar-user");
    if (target) target.focus();
  }

  function trapPersonelDrawerFocus(event) {
    if (!isMobileSidebar() || isSidebarCollapsed() || !els.personelSidebar) return false;
    const controls = Array.from(els.personelSidebar.querySelectorAll("button:not(:disabled), a[href]"))
      .filter((control) => !control.hidden && control.getAttribute("aria-hidden") !== "true");
    if (!controls.length) return false;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.personelSidebar.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    if (!els.personelSidebar.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function syncSidebarBreakpoint() {
    const mobile = isMobileSidebar();
    if (mobile === state.mobileSidebar) {
      syncSidebarUi();
      return;
    }
    state.mobileSidebar = mobile;
    if (mobile) setSidebarCollapsed(true, { persist: false });
    else setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1", { persist: false });
  }

  function isMobileSidebar() {
    return Boolean(window.matchMedia && window.matchMedia(MOBILE_SIDEBAR_QUERY).matches);
  }

  function toggleProfilePopover() {
    if (!els.profilePopover || !els.sidebarUser) return;
    const willOpen = els.profilePopover.hidden;
    els.profilePopover.hidden = !willOpen;
    els.sidebarUser.setAttribute("aria-expanded", willOpen ? "true" : "false");
    if (willOpen) {
      const firstAction = els.profilePopover.querySelector("button:not(:disabled)");
      if (firstAction) window.setTimeout(() => firstAction.focus(), 0);
    }
  }

  function closeProfilePopover(options = {}) {
    if (els.profilePopover) els.profilePopover.hidden = true;
    if (els.sidebarUser) els.sidebarUser.setAttribute("aria-expanded", "false");
    if (options.restoreFocus && els.sidebarUser) els.sidebarUser.focus();
  }

  function handleProfileMenuKeydown(event) {
    if (!els.profilePopover || els.profilePopover.hidden) return;
    const actions = Array.from(els.profilePopover.querySelectorAll('[role="menuitem"]:not(:disabled)'));
    if (!actions.length) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeProfilePopover({ restoreFocus: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, actions.indexOf(document.activeElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? actions.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % actions.length
          : (current - 1 + actions.length) % actions.length;
    actions[nextIndex].focus();
  }

  function setProfileMenuMessage(message) {
    if (!els.profileMenuMessage) return;
    els.profileMenuMessage.textContent = String(message || "");
    els.profileMenuMessage.hidden = !message;
  }

  function setProfileWorkspace(mode) {
    state.profileWorkspace = mode === "notifications" ? "notifications" : "profile";
    document.querySelectorAll("#sectionProfile [data-profile-workspace]").forEach((node) => {
      node.hidden = node.dataset.profileWorkspace !== state.profileWorkspace;
    });
    if (state.section === "profile") {
      const notifications = state.profileWorkspace === "notifications";
      if (els.sectionTitle) els.sectionTitle.textContent = notifications ? "Bildirim Ayarları" : "Profil";
      if (els.sectionDescription) els.sectionDescription.textContent = notifications
        ? "Uygulama ve e-posta bildirim tercihlerinizi yönetin."
        : "Kendi personel profilinizi ve hesap güvenliğinizi düzenleyin.";
    }
  }

  function loadOverview(options = {}) {
    if (!state.sessionActive) return Promise.resolve(null);
    if (state.overviewLoadPromise) {
      const pendingKinds = [];
      if (options.forceStock) pendingKinds.push("stock");
      if (options.forceMovements) pendingKinds.push("movements");
      if (options.forceWorkforce) pendingKinds.push("workforce");
      if (pendingKinds.length) scheduleOverviewRefresh(pendingKinds);
      return state.overviewLoadPromise;
    }
    const stockTask = queueOverviewSource("stock", Boolean(options.forceStock) || !state.stockLoaded, () => loadStock({ force: Boolean(options.forceStock) }));
    const movementTask = queueOverviewSource("movements", Boolean(options.forceMovements) || !state.overviewMovementsLoaded, () => (
      stockTask.catch(() => null).then(() => loadOverviewMovements({ force: Boolean(options.forceMovements) }))
    ));
    const workforceTask = queueOverviewSource("workforce", Boolean(options.forceWorkforce) || !state.overviewWorkforceLoaded, () => loadOverviewWorkforce({ force: Boolean(options.forceWorkforce) }));
    syncOverviewStatus();
    renderOverview();
    if (els.sectionHome) els.sectionHome.setAttribute("aria-busy", "true");

    const promise = Promise.allSettled([stockTask, movementTask, workforceTask]).then(() => {
      syncOverviewStatus();
      renderOverview();
      return overviewSnapshot();
    }).finally(() => {
      if (els.sectionHome) els.sectionHome.removeAttribute("aria-busy");
      if (state.overviewLoadPromise === promise) state.overviewLoadPromise = null;
      if (state.overviewRefreshPending && state.section === "home") {
        state.overviewRefreshPending = false;
        scheduleOverviewRefresh();
      }
    });
    state.overviewLoadPromise = promise;
    return promise;
  }

  function queueOverviewSource(source, shouldLoad, loader) {
    const sourceState = state.overviewSources[source];
    if (!shouldLoad) {
      sourceState.status = "ready";
      sourceState.error = "";
      return Promise.resolve(null);
    }
    sourceState.status = "loading";
    sourceState.error = "";
    return Promise.resolve().then(loader).then((value) => {
      sourceState.status = "ready";
      sourceState.error = "";
      syncOverviewStatus();
      renderOverview();
      return value;
    }).catch((error) => {
      sourceState.status = "error";
      sourceState.error = error && error.message || "Veriler alınamadı.";
      syncOverviewStatus();
      renderOverview();
      throw error;
    });
  }

  function syncOverviewStatus() {
    const sources = Object.values(state.overviewSources);
    const usable = ["stock", "movements", "workforce"].some(overviewSourceLoaded);
    const loading = sources.some((source) => source.status === "loading");
    state.overviewStatus = usable ? "ready" : loading ? "loading" : "error";
    state.overviewError = sources.filter((source) => source.status === "error").map((source) => source.error).filter(Boolean).join(" ");
  }

  function overviewSourceLoaded(source) {
    if (source === "stock") return state.stockLoaded;
    if (source === "movements") return state.overviewMovementsLoaded;
    if (source === "workforce") return state.overviewWorkforceLoaded;
    return false;
  }

  function loadOverviewMovements(options = {}) {
    if (!options.force && state.overviewMovementsLoaded) return Promise.resolve(stockMovements());
    return readPersonelData("/api/workforce/stock/movements?limit=200").then((result) => {
      state.stock.movements = Array.isArray(result.movements) ? result.movements : [];
      state.stockRevision = responseRevision(result, state.stockRevision);
      state.overviewMovementsLoaded = true;
      return state.stock.movements;
    });
  }

  async function loadOverviewWorkforce(options = {}) {
    if (!options.force && state.overviewWorkforceLoaded) return state.overviewWorkforce;
    const scopes = [];
    if (personelSectionAllowed("shipment")) scopes.push("shipments");
    if (personelSectionAllowed("materialRequest")) scopes.push("materialrequests");
    if (!scopes.length) {
      state.overviewWorkforce = { shipments: [], materialRequests: [], shiftRequests: [] };
      state.overviewWorkforceLoaded = true;
      return state.overviewWorkforce;
    }
    await ensureWorkforceModule();
    const module = window.MenuSuitePersonelWorkforce;
    if (!module || typeof module.loadOverview !== "function") throw new Error("Sevkiyat ve talep verileri hazırlanamadı.");
    const snapshot = await module.loadOverview({ force: Boolean(options.force), scopes });
    state.overviewWorkforce = {
      shipments: Array.isArray(snapshot && snapshot.shipments) ? snapshot.shipments : [],
      materialRequests: Array.isArray(snapshot && snapshot.materialRequests) ? snapshot.materialRequests : [],
      shiftRequests: Array.isArray(snapshot && snapshot.shiftRequests) ? snapshot.shiftRequests : []
    };
    state.overviewWorkforceLoaded = true;
    return state.overviewWorkforce;
  }

  function overviewSnapshot() {
    return Object.freeze({
      products: stockProducts(),
      movements: stockMovements(),
      shipments: state.overviewWorkforce.shipments.slice(),
      materialRequests: state.overviewWorkforce.materialRequests.slice(),
      shiftRequests: state.overviewWorkforce.shiftRequests.slice()
    });
  }

  function renderOverview() {
    if (!els.personelOverviewState || !els.personelOverviewContent) return;
    const usable = ["stock", "movements", "workforce"].some(overviewSourceLoaded);
    const failed = state.overviewStatus === "error" && !usable;
    els.personelOverviewState.hidden = usable;
    els.personelOverviewContent.hidden = !usable;
    if (!usable) {
      els.personelOverviewState.classList.toggle("is-error", failed);
      if (els.personelOverviewStateTitle) els.personelOverviewStateTitle.textContent = failed ? "Genel bakış yüklenemedi" : "Genel bakış yükleniyor";
      if (els.personelOverviewStateText) els.personelOverviewStateText.textContent = failed
        ? state.overviewError || "Bağlantıyı kontrol edip yeniden deneyin."
        : "Güncel stok ve işlem kayıtları hazırlanıyor.";
      if (els.personelOverviewRetry) els.personelOverviewRetry.hidden = !failed;
      if (state.overviewDialog.open) renderOverviewDialog();
      return;
    }

    const products = stockProducts();
    const criticalProducts = products.filter(isCriticalProduct).sort((left, right) => {
      const leftThreshold = Math.max(1, numberValue(left.criticalThreshold));
      const rightThreshold = Math.max(1, numberValue(right.criticalThreshold));
      return numberValue(left.stockQuantity) / leftThreshold - numberValue(right.stockQuantity) / rightThreshold
        || normalizeText(left.name).localeCompare(normalizeText(right.name), "tr");
    });
    const pendingShipments = state.overviewWorkforce.shipments.filter(isOpenWorkflowRecord);
    const openRequests = state.overviewWorkforce.materialRequests.filter(isOpenWorkflowRecord);
    renderOverviewCount(els.overviewCriticalCount, "stock", criticalProducts.length);
    renderOverviewCount(els.overviewShipmentCount, "workforce", pendingShipments.length);
    renderOverviewCount(els.overviewRequestCount, "workforce", openRequests.length);
    renderOverviewCount(els.overviewProductCount, "stock", products.length);
    renderOverviewCriticalProducts(criticalProducts);
    renderOverviewMovements(stockMovements().slice(0, 8), products);
    if (state.overviewDialog.open) renderOverviewDialog();
  }

  function renderOverviewCount(element, source, count) {
    if (!element) return;
    const loaded = overviewSourceLoaded(source);
    const sourceState = state.overviewSources[source];
    element.textContent = loaded ? String(count) : sourceState.status === "error" ? "!" : "—";
    element.closest(".personel-summary-card")?.setAttribute("data-source-state", loaded ? "ready" : sourceState.status);
  }

  function renderOverviewCriticalProducts(products) {
    if (!els.overviewCriticalList) return;
    if (!overviewSourceLoaded("stock")) {
      els.overviewCriticalList.innerHTML = overviewSourceStateMarkup("stock");
      return;
    }
    if (!products.length) {
      els.overviewCriticalList.innerHTML = overviewEmptyState("Kritik stok yok", "Minimum seviyenin altında ürün bulunmuyor.");
      return;
    }
    const visible = products.slice(0, 6);
    els.overviewCriticalList.innerHTML = visible.map((product) => {
      const imageUrl = String(product.imageUrl || product.image || "/assets/images/neutral-placeholder.svg").trim();
      return `<button class="personel-overview-product" type="button" data-overview-product-id="${escapeAttribute(product.id)}" aria-label="${escapeAttribute(product.name)} ürün detayını aç">
        <span class="personel-overview-product__media"><img src="${escapeAttribute(imageUrl)}" alt="" loading="lazy" decoding="async"></span>
        <span class="personel-overview-product__copy"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(safeText(product.productCode || product.barcode, "Ürün kodu yok"))}</small></span>
        <span class="personel-overview-product__stock"><strong>${escapeHTML(currentStockLabel(product))}</strong><small>Min. ${escapeHTML(formatNumber(product.criticalThreshold))} ${escapeHTML(productBaseUnit(product))}</small></span>
        <b aria-hidden="true">›</b>
      </button>`;
    }).join("");
    installOverviewImageFallbacks(els.overviewCriticalList);
    syncCriticalRequestActions();
  }

  function renderCriticalRequestRow(product) {
    const id = String(product.id), chosen = state.criticalRequestItems[id];
    const disabled = !chosen || state.criticalRequestBusy ? "disabled" : "";
    return `<div class="overview-critical-row">
      <input type="checkbox" data-critical-select="${escapeAttribute(id)}" aria-label="${escapeAttribute(product.name)} seç" ${chosen ? "checked" : ""} ${state.criticalRequestBusy ? "disabled" : ""}>
      <span class="personel-overview-product__media"><img src="${escapeAttribute(overviewProductImage(product))}" alt="" loading="lazy" decoding="async"></span>
      <span class="personel-overview-product__copy"><strong>${escapeHTML(product.name)}</strong><small>${escapeHTML(product.productCode || "")}</small><small>Mevcut: ${escapeHTML(currentStockLabel(product))}</small></span>
      <label class="overview-critical-quantity"><span>Talep miktarı</span><span><button type="button" data-critical-step="-1" aria-label="${escapeAttribute(product.name)} miktarını azalt" ${disabled}>−</button><input type="number" min="1" step="1" inputmode="numeric" data-critical-quantity="${escapeAttribute(id)}" aria-label="${escapeAttribute(product.name)} talep miktarı" value="${escapeAttribute(chosen?.quantity ?? 1)}" ${disabled}><button type="button" data-critical-step="1" aria-label="${escapeAttribute(product.name)} miktarını artır" ${disabled}>+</button></span></label>
    </div>`;
  }

  function handleCriticalRequestInput(event) {
    if (state.criticalRequestBusy) return;
    const input = event.target;
    if (input.dataset.criticalSelect) {
      const id = input.dataset.criticalSelect;
      if (input.checked) state.criticalRequestItems[id] = { quantity: 1 };
      else delete state.criticalRequestItems[id];
      const row = input.closest(".overview-critical-row");
      if (input.checked) row.querySelector("[data-critical-quantity]").value = "1";
      row.querySelectorAll("button, [data-critical-quantity]").forEach((control) => { control.disabled = !input.checked; });
    } else if (input.dataset.criticalQuantity) {
      const selected = state.criticalRequestItems[input.dataset.criticalQuantity];
      if (selected) selected.quantity = Number(input.value);
    }
    syncCriticalRequestActions();
  }

  function syncCriticalRequestActions() {
    const products = stockProducts().filter(isCriticalProduct);
    if (els.overviewCriticalActions) els.overviewCriticalActions.hidden = !isOverviewDialogOpen() || state.overviewDialog.kind !== "critical" || !overviewSourceLoaded("stock") || !products.length || !personelSectionAllowed("materialRequest");
    const selected = products.filter((product) => state.criticalRequestItems[String(product.id)]);
    const valid = selected.length && selected.every((product) => {
      const quantity = state.criticalRequestItems[String(product.id)].quantity;
      return Number.isSafeInteger(quantity) && quantity > 0;
    });
    if (els.overviewCriticalSelection) els.overviewCriticalSelection.textContent = state.criticalRequestMode ? `${selected.length} malzeme seçildi` : "";
    if (els.overviewCriticalCancel) { els.overviewCriticalCancel.hidden = !state.criticalRequestMode; els.overviewCriticalCancel.disabled = state.criticalRequestBusy; }
    if (els.overviewCriticalRequest) {
      els.overviewCriticalRequest.textContent = state.criticalRequestBusy ? "Gönderiliyor…" : state.criticalRequestMode ? "Talebi Gönder" : "Talep Aç";
      els.overviewCriticalRequest.disabled = state.criticalRequestBusy || state.criticalRequestMode && !valid;
    }
  }

  async function submitCriticalMaterialRequest() {
    if (state.criticalRequestBusy || !isOverviewDialogOpen() || state.overviewDialog.kind !== "critical" || !personelSectionAllowed("materialRequest")) return;
    const items = stockProducts().filter(isCriticalProduct).filter((product) => state.criticalRequestItems[String(product.id)]).map((product) => ({
      productId: product.id, name: product.name, productCode: product.productCode || "", imageUrl: product.imageUrl || product.image || "",
      quantity: state.criticalRequestItems[String(product.id)].quantity, unit: "adet"
    }));
    if (!items.length || items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) return;
    const fingerprint = JSON.stringify(items);
    if (!state.criticalRequestId || state.criticalRequestFingerprint !== fingerprint) {
      state.criticalRequestId = window.crypto?.randomUUID?.() || `critical-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      state.criticalRequestFingerprint = fingerprint;
    }
    state.criticalRequestBusy = true;
    const owner = String(state.user?.id || "");
    renderOverviewDialog();
    try {
      await ensureWorkforceModule();
      if (!state.sessionActive || String(state.user?.id || "") !== owner) return;
      const result = await window.MenuSuitePersonelWorkforce.createMaterialRequestFromStock(items, state.criticalRequestId, String(state.stock.location?.name || ""));
      if (!state.sessionActive || String(state.user?.id || "") !== owner) return;
      if (state.overviewWorkforceLoaded && result.materialRequest) state.overviewWorkforce.materialRequests = [result.materialRequest, ...state.overviewWorkforce.materialRequests.filter((item) => item.id !== result.materialRequest.id)];
      state.criticalRequestMode = false;
      state.criticalRequestItems = Object.create(null);
      state.criticalRequestId = "";
      setCriticalRequestMessage(`${result.materialRequest?.requestNumber || "Talep"} yönetici onayına gönderildi.`);
      renderOverview();
    } catch (error) { if (state.sessionActive && String(state.user?.id || "") === owner) setCriticalRequestMessage(error.message || "Talep gönderilemedi. Yeniden deneyebilirsiniz.", true); }
    finally { if (state.sessionActive && String(state.user?.id || "") === owner) { state.criticalRequestBusy = false; renderOverviewDialog(); } }
  }

  function setCriticalRequestMessage(message, error = false) {
    if (!els.overviewCriticalMessage) return;
    els.overviewCriticalMessage.textContent = message;
    els.overviewCriticalMessage.hidden = !message;
    els.overviewCriticalMessage.classList.toggle("is-error", error);
  }

  function renderOverviewMovements(movements, products) {
    if (!els.overviewMovementList) return;
    if (!overviewSourceLoaded("movements")) {
      els.overviewMovementList.innerHTML = overviewSourceStateMarkup("movements");
      return;
    }
    if (!movements.length) {
      els.overviewMovementList.innerHTML = overviewEmptyState("Henüz işlem yok", "Yaptığınız stok hareketleri burada görünecek.");
      return;
    }
    const productMap = new Map(products.map((product) => [String(product.id), product]));
    els.overviewMovementList.innerHTML = movements.map((movement, index) => {
      const productId = String(movement.productId || movement.stockProductId || "");
      const product = productMap.get(productId);
      const productName = product && product.name || safeText(movement.productName || movement.product && movement.product.name, "Stok ürünü");
      const movementId = overviewMovementId(movement, index);
      return `<button type="button" class="personel-overview-movement" data-overview-movement-id="${escapeAttribute(movementId)}" aria-label="${escapeAttribute(productName)} işlem ayrıntısını aç">
        <span class="personel-overview-movement__icon is-${movementDirectionIcon(movement) === "+" ? "in" : "out"}" aria-hidden="true">${movementDirectionIcon(movement)}</span>
        <span><strong>${escapeHTML(productName)}</strong><small>${escapeHTML(stockMovementLabel(movement.type))} · ${escapeHTML(formatDateTimeShort(movement.createdAt))}</small></span>
        <b>${escapeHTML(formatMovementQuantity(movement))}</b>
        <em aria-hidden="true">›</em>
      </button>`;
    }).join("");
  }

  function overviewSourceStateMarkup(source) {
    const sourceState = state.overviewSources[source] || { status: "loading", error: "" };
    if (sourceState.status === "error") {
      return `<div class="personel-overview-empty is-error"><span aria-hidden="true">!</span><strong>Veriler alınamadı</strong><p>${escapeHTML(sourceState.error || "Bağlantıyı kontrol edip yeniden deneyin.")}</p><button type="button" data-overview-retry-source="${escapeAttribute(source)}">Yeniden Dene</button></div>`;
    }
    return `<div class="personel-overview-empty is-loading"><span class="personel-overview-spinner" aria-hidden="true"></span><strong>Veriler yükleniyor</strong><p>Güncel kayıtlar hazırlanıyor.</p></div>`;
  }

  function overviewEmptyState(title, detail) {
    return `<div class="personel-overview-empty"><span aria-hidden="true">✓</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(detail)}</p></div>`;
  }

  function installOverviewImageFallbacks(root) {
    root.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => {
      if (!image.src.endsWith("/assets/images/neutral-placeholder.svg")) image.src = "/assets/images/neutral-placeholder.svg";
    }, { once: true }));
  }

  function isCriticalProduct(product) {
    const threshold = numberValue(product && product.criticalThreshold);
    return threshold > 0 && numberValue(product && product.stockQuantity) <= threshold;
  }

  function isOpenWorkflowRecord(record) {
    const status = normalizeText(record && record.status).replace(/\s+/g, "_");
    return !["onaylandi", "approved", "completed", "published", "reddedildi", "rejected", "iptal_edildi", "cancelled"].includes(status);
  }

  function handleOverviewAction(action, trigger) {
    if (!["critical", "shipments", "requests", "products", "movements"].includes(action)) return Promise.resolve();
    openOverviewDialog(action, { trigger });
    return loadOverview().catch(() => null);
  }

  function openOverviewProduct(productId, trigger) {
    openOverviewDialog("critical", { trigger, expandedId: String(productId || "") });
    return loadOverview().catch(() => null);
  }

  function openOverviewDialog(kind, options = {}) {
    if (!els.personelOverviewDialogShell || !els.personelOverviewDialog) return;
    const changedKind = state.overviewDialog.kind !== kind;
    if (!state.overviewDialog.open) {
      state.overviewDialog.trigger = options.trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    }
    state.overviewDialog.open = true;
    state.overviewDialog.kind = kind;
    if (changedKind) {
      state.overviewDialog.query = "";
      state.overviewDialog.page = 1;
      state.overviewDialog.expandedId = "";
    }
    if (options.expandedId) state.overviewDialog.expandedId = String(options.expandedId);
    els.personelOverviewDialogShell.hidden = false;
    renderOverviewDialog();
    syncPanelModalLock();
    window.requestAnimationFrame(() => {
      if (kind === "products") els.personelOverviewSearchInput?.focus({ preventScroll: true });
      else els.personelOverviewDialogClose?.focus({ preventScroll: true });
    });
  }

  function closeOverviewDialog(options = {}) {
    if (!state.overviewDialog.open && (!els.personelOverviewDialogShell || els.personelOverviewDialogShell.hidden)) return;
    const restoreTarget = state.overviewDialog.trigger;
    state.overviewDialog.open = false;
    state.overviewDialog.trigger = null;
    if (els.personelOverviewDialogShell) els.personelOverviewDialogShell.hidden = true;
    syncPanelModalLock();
    if (options.restoreFocus !== false && restoreTarget && restoreTarget.isConnected) {
      window.setTimeout(() => restoreTarget.focus({ preventScroll: true }), 0);
    }
  }

  function isOverviewDialogOpen() {
    return Boolean(state.overviewDialog.open && els.personelOverviewDialogShell && !els.personelOverviewDialogShell.hidden);
  }

  function trapOverviewDialogFocus(event) {
    if (!isOverviewDialogOpen()) return false;
    const focusable = Array.from(els.personelOverviewDialog.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return false;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !els.personelOverviewDialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && (document.activeElement === last || !els.personelOverviewDialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  function retryOverviewSource(source) {
    if (source === "stock") return loadOverview({ forceStock: true });
    if (source === "movements") return loadOverview({ forceMovements: true });
    if (source === "workforce") return loadOverview({ forceWorkforce: true });
    return Promise.resolve();
  }

  function overviewSourceForKind(kind) {
    if (["critical", "products"].includes(kind)) return "stock";
    if (kind === "movements") return "movements";
    return "workforce";
  }

  function overviewDialogMeta(kind) {
    const values = {
      critical: ["Kritik Stoklar", "Minimum seviyesine ulaşan erişilebilir ürünler"],
      shipments: ["Bekleyen Sevkiyatlar", "Yönetici işlemi bekleyen sevkiyat bildirimleri"],
      requests: ["Açık Malzeme Talepleri", "Yönetici kararı bekleyen talepler"],
      products: ["Toplam Ürün", "Erişebildiğiniz ürün kayıtları"],
      movements: ["Tüm İşlemlerim", "Erişebildiğiniz stok hareketleri"]
    };
    return values[kind] || ["Genel Bakış", "Kayıt ayrıntıları"];
  }

  function overviewDialogRecords(kind) {
    if (kind === "critical") return stockProducts().filter(isCriticalProduct).sort(compareCriticalProducts);
    if (kind === "products") return stockProducts().slice().sort((a, b) => normalizeText(a.name).localeCompare(normalizeText(b.name), "tr"));
    if (kind === "shipments") return state.overviewWorkforce.shipments.filter(isOpenWorkflowRecord).sort(compareNewest);
    if (kind === "requests") return state.overviewWorkforce.materialRequests.filter(isOpenWorkflowRecord).sort(compareNewest);
    if (kind === "movements") return stockMovements().slice().sort(compareNewest);
    return [];
  }

  function compareCriticalProducts(left, right) {
    const leftThreshold = Math.max(1, numberValue(left.criticalThreshold));
    const rightThreshold = Math.max(1, numberValue(right.criticalThreshold));
    return numberValue(left.stockQuantity) / leftThreshold - numberValue(right.stockQuantity) / rightThreshold
      || normalizeText(left.name).localeCompare(normalizeText(right.name), "tr");
  }

  function compareNewest(left, right) {
    return Date.parse(right && (right.createdAt || right.updatedAt) || 0) - Date.parse(left && (left.createdAt || left.updatedAt) || 0);
  }

  function renderOverviewDialog(options = {}) {
    if (!isOverviewDialogOpen() || !els.personelOverviewDialogBody) return;
    const kind = state.overviewDialog.kind;
    const source = overviewSourceForKind(kind);
    const sourceState = state.overviewSources[source] || { status: "loading", error: "" };
    const loaded = overviewSourceLoaded(source);
    const [title, description] = overviewDialogMeta(kind);
    if (els.personelOverviewDialogTitle) els.personelOverviewDialogTitle.textContent = title;
    if (els.personelOverviewSearch) els.personelOverviewSearch.hidden = kind !== "products";
    if (els.personelOverviewSearchInput && els.personelOverviewSearchInput.value !== state.overviewDialog.query) {
      els.personelOverviewSearchInput.value = state.overviewDialog.query;
    }
    syncCriticalRequestActions();
    if (!loaded) {
      if (els.personelOverviewDialogMeta) els.personelOverviewDialogMeta.textContent = description;
      els.personelOverviewDialogBody.innerHTML = overviewSourceStateMarkup(source);
      if (els.personelOverviewPagination) els.personelOverviewPagination.hidden = true;
      return;
    }

    let records = overviewDialogRecords(kind);
    if (kind === "products" && state.overviewDialog.query.trim()) {
      const query = normalizeText(state.overviewDialog.query);
      records = records.filter((product) => normalizeText([product.name, product.productCode, product.barcode].filter(Boolean).join(" ")).includes(query));
    }
    const total = records.length;
    const pageCount = Math.max(1, Math.ceil(total / OVERVIEW_PAGE_SIZE));
    state.overviewDialog.page = Math.min(pageCount, Math.max(1, state.overviewDialog.page));
    const start = (state.overviewDialog.page - 1) * OVERVIEW_PAGE_SIZE;
    const pageRecords = records.slice(start, start + OVERVIEW_PAGE_SIZE);
    if (els.personelOverviewDialogMeta) {
      els.personelOverviewDialogMeta.textContent = `${description} · ${total} kayıt`;
    }
    const staleWarning = sourceState.status === "error"
      ? `<div class="personel-overview-dialog__warning"><strong>Veriler alınamadı.</strong><span>Son alınan kayıtlar gösteriliyor.</span><button type="button" data-overview-retry-source="${escapeAttribute(source)}">Yeniden Dene</button></div>`
      : "";
    els.personelOverviewDialogBody.innerHTML = staleWarning + (pageRecords.length
      ? `<div class="personel-overview-dialog__list">${pageRecords.map((record, index) => renderOverviewDialogRecord(kind, record, start + index)).join("")}</div>`
      : overviewEmptyState("Kayıt bulunmuyor", kind === "products" && state.overviewDialog.query.trim() ? "Arama ölçütünü değiştirerek yeniden deneyin." : "Bu kartın ölçütlerine uyan kayıt bulunmuyor."));
    installOverviewImageFallbacks(els.personelOverviewDialogBody);
    renderOverviewPagination(pageCount);
    if (options.focusBody) window.requestAnimationFrame(() => els.personelOverviewDialogBody.querySelector("[data-overview-record-id]")?.focus({ preventScroll: true }));
  }

  function renderOverviewPagination(pageCount) {
    if (!els.personelOverviewPagination) return;
    if (pageCount <= 1) {
      els.personelOverviewPagination.hidden = true;
      els.personelOverviewPagination.innerHTML = "";
      return;
    }
    const page = state.overviewDialog.page;
    els.personelOverviewPagination.hidden = false;
    els.personelOverviewPagination.innerHTML = `<button type="button" data-overview-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Önceki sayfa">‹</button><span>${page} / ${pageCount}</span><button type="button" data-overview-page="${page + 1}" ${page >= pageCount ? "disabled" : ""} aria-label="Sonraki sayfa">›</button>`;
  }

  function renderOverviewDialogRecord(kind, record, index) {
    if (kind === "critical" && state.criticalRequestMode && personelSectionAllowed("materialRequest")) return renderCriticalRequestRow(record);
    const recordId = overviewRecordId(kind, record, index);
    const expanded = state.overviewDialog.expandedId === recordId;
    const summary = overviewRecordSummary(kind, record);
    return `<article class="personel-overview-record${expanded ? " is-expanded" : ""}">
      <button class="personel-overview-record__summary" type="button" data-overview-record-id="${escapeAttribute(recordId)}" aria-expanded="${expanded}">
        ${summary}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5 5 5-5"/></svg>
      </button>
      <div class="personel-overview-record__detail" ${expanded ? "" : "hidden"}>${expanded ? overviewRecordDetail(kind, record) : ""}</div>
    </article>`;
  }

  function overviewRecordId(kind, record, index) {
    if (kind === "movements") return overviewMovementId(record, index);
    return String(record && record.id || `${kind}-${index}`);
  }

  function overviewMovementId(movement, index) {
    return String(movement && movement.id || `movement-${movement && movement.createdAt || "record"}-${index}`);
  }

  function toggleOverviewRecord(recordId) {
    state.overviewDialog.expandedId = state.overviewDialog.expandedId === String(recordId) ? "" : String(recordId);
    renderOverviewDialog();
    window.requestAnimationFrame(() => Array.from(els.personelOverviewDialogBody?.querySelectorAll("[data-overview-record-id]") || [])
      .find((button) => button.dataset.overviewRecordId === String(recordId))?.focus({ preventScroll: true }));
  }

  function overviewRecordSummary(kind, record) {
    if (kind === "critical" || kind === "products") {
      const imageUrl = overviewProductImage(record);
      const threshold = kind === "critical" ? `<small>Kritik eşik: ${escapeHTML(formatNumber(record.criticalThreshold))} ${escapeHTML(productBaseUnit(record))}</small>` : "";
      return `<span class="personel-overview-record__media"><img src="${escapeAttribute(imageUrl)}" alt="" loading="lazy" decoding="async"></span><span class="personel-overview-record__copy"><strong>${escapeHTML(record.name || "Ürün")}</strong><small>${escapeHTML(safeText(record.productCode || record.barcode, "Ürün kodu yok"))}</small>${threshold}</span><span class="personel-overview-record__value"><small>Mevcut</small><b>${escapeHTML(accessibleStockLabel(record))}</b></span>`;
    }
    if (kind === "shipments") {
      return `<span class="personel-overview-record__marker is-shipment" aria-hidden="true">${overviewTruckIcon()}</span><span class="personel-overview-record__copy"><strong>${escapeHTML(record.shipmentNumber || "Sevkiyat bildirimi")}</strong><small>${escapeHTML(formatDateTimeShort(record.createdAt))} · ${(record.items || []).length} ürün</small></span><span class="personel-overview-status">${escapeHTML(overviewStatusLabel(record.status))}</span>`;
    }
    if (kind === "requests") {
      return `<span class="personel-overview-record__marker is-request" aria-hidden="true">${overviewClipboardIcon()}</span><span class="personel-overview-record__copy"><strong>${escapeHTML(record.requestNumber || "Malzeme talebi")}</strong><small>${escapeHTML(formatDateTimeShort(record.createdAt))} · ${(record.items || []).length} malzeme</small></span><span class="personel-overview-status">${escapeHTML(overviewStatusLabel(record.status))}</span>`;
    }
    const product = stockProducts().find((item) => String(item.id) === String(record.productId || record.stockProductId || ""));
    const productName = product && product.name || safeText(record.productName || record.product && record.product.name, "Stok ürünü");
    return `<span class="personel-overview-movement__icon is-${movementDirectionIcon(record) === "+" ? "in" : "out"}" aria-hidden="true">${movementDirectionIcon(record)}</span><span class="personel-overview-record__copy"><strong>${escapeHTML(productName)}</strong><small>${escapeHTML(stockMovementLabel(record.type))} · ${escapeHTML(formatDateTimeShort(record.createdAt))}</small></span><span class="personel-overview-record__value"><b>${escapeHTML(formatMovementQuantity(record))}</b></span>`;
  }

  function overviewRecordDetail(kind, record) {
    if (kind === "critical" || kind === "products") return overviewProductDetail(record);
    if (kind === "shipments") return overviewWorkflowDetail(record, "shipment");
    if (kind === "requests") return overviewWorkflowDetail(record, "request");
    return overviewMovementDetail(record);
  }

  function overviewProductDetail(product) {
    const entries = productLocationEntries(product);
    const locations = entries.length ? entries.map(({ balance, location }) => {
      const photoUrl = String(location?.photoUrl || balance && balance.placementPhotoUrl || "").trim();
      const locationName = safeText(location && (location.name || location.title || location.code), "Konum adı kayıtlı değil");
      const legacyPlacement = [balance && balance.cabinet && `Dolap ${balance.cabinet}`, balance && balance.shelf && `Raf ${balance.shelf}`, balance && (balance.bin || balance.compartment) && `Bölme ${balance.bin || balance.compartment}`].filter(Boolean).join(" · ");
      const placement = safeText(balance && balance.placementName, legacyPlacement || "Yeri belirlenmedi");
      return `<article class="personel-overview-location">${photoUrl ? `<img src="${escapeAttribute(photoUrl)}" alt="${escapeAttribute(locationName)} yer fotoğrafı" loading="lazy" decoding="async">` : ""}<span><small>Depo</small><strong>${escapeHTML(locationName)}</strong><p>${escapeHTML(placement)}</p></span></article>`;
    }).join("") : `<p class="personel-overview-detail-note">Konum bilgisi kayıtlı değil.</p>`;
    return `<div class="personel-overview-product-detail"><img src="${escapeAttribute(overviewProductImage(product))}" alt="${escapeAttribute(product.name || "Ürün")} görseli" loading="lazy" decoding="async"><div><dl><div><dt>Malzeme</dt><dd>${escapeHTML(product.name || "Ürün")}</dd></div><div><dt>Ürün kodu</dt><dd>${escapeHTML(safeText(product.productCode || product.barcode, "Kayıtlı değil"))}</dd></div><div><dt>Mevcut miktar</dt><dd>${escapeHTML(accessibleStockLabel(product))}</dd></div><div><dt>Kritik eşik</dt><dd>${escapeHTML(formatNumber(product.criticalThreshold))} ${escapeHTML(productBaseUnit(product))}</dd></div></dl>${locations}</div></div>`;
  }

  function overviewWorkflowDetail(record, type) {
    const items = Array.isArray(record.items) ? record.items : [];
    const itemMarkup = items.length ? items.map((item) => {
      const product = stockProducts().find((candidate) => String(candidate.id) === String(item.productId || item.stockProductId || item.linkedProductId || ""));
      const imageUrl = String(item.imageUrl || product && (product.imageUrl || product.image) || "/assets/images/neutral-placeholder.svg").trim();
      const name = safeText(item.name || item.productName || product && product.name, "Malzeme");
      const unit = safeText(item.unit || item.baseUnit || product && productBaseUnit(product), "adet");
      const quantity = item.quantity ?? item.receivedQuantity ?? item.inputQuantity ?? 0;
      return `<article class="personel-overview-workflow-item"><span><img src="${escapeAttribute(imageUrl)}" alt="" loading="lazy" decoding="async"></span><div><strong>${escapeHTML(name)}</strong>${item.productCode || item.stockProductCode || item.code ? `<small>${escapeHTML(item.productCode || item.stockProductCode || item.code)}</small>` : ""}</div><b>${escapeHTML(formatNumber(quantity))} ${escapeHTML(unit)}</b></article>`;
    }).join("") : overviewEmptyState("Kayıt bulunmuyor", "Bu kayıtta malzeme satırı bulunmuyor.");
    const note = record.note || record.description;
    const adminNote = record.adminNote || record.managerNote || record.rejectionReason;
    return `<div class="personel-overview-workflow-detail"><dl><div><dt>${type === "shipment" ? "Sevkiyat" : "Talep"}</dt><dd>${escapeHTML(record.shipmentNumber || record.requestNumber || "Numara bulunmuyor")}</dd></div><div><dt>Tarih</dt><dd>${escapeHTML(formatDateTimeShort(record.createdAt))}</dd></div><div><dt>Durum</dt><dd>${escapeHTML(overviewStatusLabel(record.status))}</dd></div></dl><div class="personel-overview-workflow-items">${itemMarkup}</div>${note ? `<div class="personel-overview-detail-note"><strong>Not</strong><p>${escapeHTML(note)}</p></div>` : ""}${adminNote ? `<div class="personel-overview-detail-note"><strong>Yönetici açıklaması</strong><p>${escapeHTML(adminNote)}</p></div>` : ""}</div>`;
  }

  function overviewMovementDetail(movement) {
    const product = stockProducts().find((item) => String(item.id) === String(movement.productId || movement.stockProductId || ""));
    const productName = product && product.name || safeText(movement.productName || movement.product && movement.product.name, "Stok ürünü");
    const locationName = safeText(movement.locationName || movement.location && movement.location.name || state.stock.location && state.stock.location.name, "Konum bilgisi yok");
    const actor = safeText(movement.actorName || movement.personName || movement.userName || movement.createdByName, "Personel");
    const note = safeText(movement.note || movement.description || movement.reason, "");
    return `<dl class="personel-overview-movement-detail"><div><dt>Malzeme</dt><dd>${escapeHTML(productName)}</dd></div><div><dt>İşlem türü</dt><dd>${escapeHTML(stockMovementLabel(movement.type))}</dd></div><div><dt>Miktar</dt><dd>${escapeHTML(formatMovementQuantity(movement))}</dd></div><div><dt>Tarih</dt><dd>${escapeHTML(formatDateTimeShort(movement.createdAt))}</dd></div><div><dt>Konum</dt><dd>${escapeHTML(locationName)}</dd></div><div><dt>İşlemi yapan</dt><dd>${escapeHTML(actor)}</dd></div>${note ? `<div><dt>Açıklama</dt><dd>${escapeHTML(note)}</dd></div>` : ""}</dl>`;
  }

  function overviewProductImage(product) {
    return String(product && (product.imageUrl || product.image) || "/assets/images/neutral-placeholder.svg").trim();
  }

  function overviewStatusLabel(status) {
    const normalized = normalizeText(status).replace(/\s+/g, "_");
    const labels = { pending: "Bekliyor", bekliyor: "Bekliyor", taslak: "Taslak", draft: "Taslak", submitted: "Gönderildi", gonderildi: "Gönderildi", onay_bekliyor: "Onay bekliyor", onaylandi: "Onaylandı", approved: "Onaylandı", reddedildi: "Reddedildi", rejected: "Reddedildi", iptal_edildi: "İptal edildi", cancelled: "İptal edildi" };
    return labels[normalized] || safeText(status, "Bekliyor");
  }

  function overviewTruckIcon() {
    return '<svg viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
  }

  function overviewClipboardIcon() {
    return '<svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M8 10h8M8 14h5M8 18h4"/></svg>';
  }

  function scheduleOverviewRefresh(kinds = []) {
    kinds.forEach((kind) => state.overviewRefreshKinds.add(kind));
    if (state.overviewLoadPromise) {
      state.overviewRefreshPending = true;
      return;
    }
    window.clearTimeout(state.overviewRefreshTimer);
    state.overviewRefreshTimer = window.setTimeout(() => {
      state.overviewRefreshTimer = null;
      const pending = new Set(state.overviewRefreshKinds);
      state.overviewRefreshKinds.clear();
      void loadOverview({
        forceStock: pending.has("stock"),
        forceMovements: pending.has("movements"),
        forceWorkforce: pending.has("workforce")
      }).catch(() => {});
    }, 140);
  }

  function setSection(section, options) {
    const resolved = LEGACY_SECTION_REDIRECTS[section] || section;
    const requested = sectionMeta[resolved] ? resolved : firstAllowedPersonelSection();
    const next = requested === "profile" || personelSectionAllowed(requested) ? requested : firstAllowedPersonelSection();
    if (next !== "materialLocation") closeBarcodeScanner({ restoreFocus: false });
    if (next !== "home" && isOverviewDialogOpen()) closeOverviewDialog({ restoreFocus: false });
    if (next !== "stock" && els.stockDetailModal && !els.stockDetailModal.hidden) closeStockDetail({ restoreFocus: false });
    if (els.materialLocationModal && !els.materialLocationModal.hidden) closeMaterialLocation({ restoreFocus: false });
    state.section = next;
    if (!options || options.persist !== false) {
      localStorage.setItem(LAST_SECTION_KEY, next);
    }
    if (els.personelDashboard) els.personelDashboard.dataset.activeSection = next;
    Object.entries({
      home: els.sectionHome,
      barcode: els.sectionBarcode,
      materialLocation: els.sectionMaterialLocation,
      stock: els.sectionStock,
      profile: els.sectionProfile,
      materialRequest: els.sectionMaterialRequest,
      shipment: els.sectionShipment,
      shift: els.sectionShift,
      tasks: els.sectionTasks
    }).forEach(([key, panel]) => {
      if (panel) panel.hidden = key !== next;
    });

    document.querySelectorAll(".personel-nav [data-section]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.section === next);
    });

    const meta = sectionMeta[next];
    const overview = next === "home";
    if (els.sectionKicker) {
      els.sectionKicker.textContent = meta.kicker;
      els.sectionKicker.hidden = overview;
    }
    if (els.sectionTitle) els.sectionTitle.textContent = meta.title;
    if (els.sectionDescription) {
      els.sectionDescription.textContent = meta.description;
      els.sectionDescription.hidden = overview;
    }

    if (options && options.collapseSidebar && els.personelDashboard) {
      setSidebarCollapsed(true);
    }
    if (options && options.updateHash) history.replaceState(null, "", "/personel/");
    if (next === "home") void loadOverview().catch(() => {});
    if (next === "stock") void loadStock().then(renderStock).catch(() => {});
    if (next === "barcode") void loadStock().then(refreshLookupSurfaces).catch(() => {});
    if (next === "materialLocation") void loadStock().then(() => {
      renderMaterialFinder();
      window.requestAnimationFrame(() => els.materialSearchInput?.focus({ preventScroll: true }));
    }).catch((error) => setMaterialMessage(error.message || "Malzemeler yüklenemedi.", true));
    if (WORKFORCE_SECTIONS.has(next)) {
      void ensureWorkforceModule().catch(() => {
        const panel = document.querySelector(`[data-section-panel="${next}"]`);
        if (panel) panel.dataset.moduleState = "error";
      });
    }
    if (next === "profile") {
      setProfileWorkspace(state.profileWorkspace);
      void Promise.all([
        ensureAccountSecurityModule(),
        ensureNotificationsModule()
      ]).catch(() => {});
    }
    document.dispatchEvent(new CustomEvent("personel:section-change", { detail: { section: next } }));
  }

  function readLastSection() {
    const saved = localStorage.getItem(LAST_SECTION_KEY);
    const resolved = LEGACY_SECTION_REDIRECTS[saved] || saved;
    return resolved && sectionMeta[resolved] && (resolved === "profile" || personelSectionAllowed(resolved)) ? resolved : firstAllowedPersonelSection();
  }

  function normalizedPersonelSectionAccess() {
    const source = state.user && state.user.personelSectionAccess;
    const permissionKey = { barcode: "stock", materialLocation: "stock" };
    return PERSONEL_SECTION_KEYS.reduce((result, key) => {
      const sourceKey = permissionKey[key] || key;
      result[key] = !source || typeof source !== "object" || source[sourceKey] !== false;
      return result;
    }, {});
  }

  let taskBadgeSequence = 0;
  let taskBadgeRevision = -1;
  let taskBadgeTimer = null;
  function applyTaskBadge(tasks, revision) {
    if (!state.sessionActive || !personelSectionAllowed("tasks")) return clearTaskBadge();
    if (Number.isFinite(revision) && revision < taskBadgeRevision) return;
    if (Number.isFinite(revision)) taskBadgeRevision = revision;
    const count = window.MenuSuiteTaskState.count(tasks, state.user?.id);
    const nav = document.querySelector('.personel-nav [data-section="tasks"]');
    const badge = document.getElementById("personelTaskBadge");
    nav?.classList.toggle("has-active-tasks", count > 0);
    nav?.setAttribute("aria-label", count ? `Görevlerim, ${count} aktif görev` : "Görevlerim");
    if (badge) { badge.hidden = count === 0; badge.textContent = String(count); }
  }
  function clearTaskBadge() {
    const nav = document.querySelector('.personel-nav [data-section="tasks"]');
    nav?.classList.remove("has-active-tasks");
    nav?.setAttribute("aria-label", "Görevlerim");
    document.getElementById("personelTaskBadge")?.setAttribute("hidden", "");
  }
  async function refreshTaskBadge() {
    const sequence = ++taskBadgeSequence;
    const owner = state.user?.id;
    if (!state.sessionActive || !personelSectionAllowed("tasks")) return clearTaskBadge();
    try {
      const result = await readPersonelData("/api/workforce/me?scope=tasks");
      if (sequence !== taskBadgeSequence || owner !== state.user?.id) return;
      applyTaskBadge(result.tasks || [], Number(result.revision || 0));
    } catch (_error) { /* A connection error must not falsely clear active tasks. */ }
  }
  function scheduleTaskBadgeRefresh() {
    window.clearTimeout(taskBadgeTimer);
    taskBadgeTimer = window.setTimeout(() => void refreshTaskBadge(), 180);
  }
  document.addEventListener("personel:tasks-updated", event => {
    if (event.detail?.userId !== state.user?.id) return;
    applyTaskBadge(event.detail.tasks, Number(event.detail.revision));
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.sessionActive) scheduleTaskBadgeRefresh();
  });

  function personelSectionAllowed(section) {
    return section === "profile" || normalizedPersonelSectionAccess()[section] === true;
  }

  function firstAllowedPersonelSection() {
    return PERSONEL_SECTION_KEYS.find((key) => personelSectionAllowed(key)) || "profile";
  }

  function reconcilePersonelSectionAccess(options = {}) {
    const access = normalizedPersonelSectionAccess();
    if (!access.tasks) clearTaskBadge();
    document.querySelectorAll(".personel-nav [data-section]").forEach((button) => {
      const allowed = access[button.dataset.section] !== false;
      button.hidden = !allowed;
      button.disabled = !allowed;
      button.setAttribute("aria-hidden", allowed ? "false" : "true");
    });
    if (!access.stock) {
      state.stockLoaded = false;
      stopBarcodeCamera();
      closeMaterialLocation({ restoreFocus: false });
      if (els.stockDetailModal && !els.stockDetailModal.hidden) closeStockDetail({ restoreFocus: false, force: true });
      else resetStockActionState();
    }
    if (options.redirect !== false && !personelSectionAllowed(state.section)) {
      setSection(firstAllowedPersonelSection(), { updateHash: false, persist: true });
    }
  }

  async function refreshPersonelSectionAccess() {
    if (!state.sessionActive || state.sessionPreview) return;
    try {
      const response = await fetch("/api/recipe/me", { credentials: "include", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.user) return;
      state.user = mergeProfile({ ...state.user, ...payload.user });
      reconcilePersonelSectionAccess();
      renderUser();
    } catch (_error) {}
  }

  function compactRecipeFrame() {
    if (!els.recipeFrame) return;
    els.recipeFrame.style.height = "100%";
  }

  function loadRecipeFrame() {
    if (!els.recipeFrame) {
      if (!els.sectionRecipe || !state.sessionActive) return;
      const frame = document.createElement("iframe");
      frame.id = "recipeFrame";
      frame.title = `${activeBrandName} Reçete`;
      frame.loading = "eager";
      frame.setAttribute("src", "about:blank");
      frame.dataset.src = els.sectionRecipe.dataset.recipeSrc || "/personel/recete-embed/";
      frame.addEventListener("load", () => {
        sendRecipeAppearance();
        compactRecipeFrame();
        forwardRecipePreviewDraft();
      });
      els.sectionRecipe.append(frame);
      els.recipeFrame = frame;
    }
    const source = els.recipeFrame.dataset.src || els.sectionRecipe?.dataset.recipeSrc || "/personel/recete-embed/";
    const target = appendPreviewToken(source);
    if (els.recipeFrame.getAttribute("src") !== target) {
      els.recipeFrame.setAttribute("src", target);
    }
  }

  function unloadRecipeFrame() {
    if (!els.recipeFrame) return;
    els.recipeFrame.setAttribute("src", "about:blank");
    els.recipeFrame.remove();
    els.recipeFrame = null;
  }

  function setupGatewayEvents() {
    if (PREVIEW_TOKEN || state.gatewayEventSource || !window.EventSource) return;
    const source = new EventSource("/api/events?appId=personel", { withCredentials: true });
    source.addEventListener("open", () => {
      document.dispatchEvent(new CustomEvent("personel:gateway-status", { detail: { connected: true } }));
    });
    source.addEventListener("error", () => {
      document.dispatchEvent(new CustomEvent("personel:gateway-status", { detail: { connected: false } }));
    });
    const handleGatewayEvent = (event) => {
      let payload;
      try { payload = JSON.parse(event.data || "{}"); } catch (_error) { return; }
      const eventId = String(payload.eventId || event.lastEventId || "");
      if (eventId && state.gatewayEventIds.has(eventId)) return;
      if (eventId) {
        state.gatewayEventIds.add(eventId);
        if (state.gatewayEventIds.size > 300) state.gatewayEventIds.delete(state.gatewayEventIds.values().next().value);
      }
      const topic = String(payload.topic || "system");
      const revision = Math.max(0, Number(payload.revision || 0));
      const previous = Math.max(0, Number(state.gatewayTopicRevisions[topic] || 0));
      if (revision && revision <= previous) return;
      if (revision) state.gatewayTopicRevisions[topic] = revision;
      if (topic === "catalog" || topic === "recipe") void refreshPanelTheme();
      document.dispatchEvent(new CustomEvent("personel:gateway-event", { detail: payload }));
      if (topic === "workforce" && payload.type === "personel.section-access.updated"
        && (!payload.entityId || String(payload.entityId) === String(state.user && state.user.id || ""))) {
        void refreshPersonelSectionAccess();
      }
      if (topic === "inventory" || topic === "catalog") {
        state.stockLoaded = false;
        state.overviewMovementsLoaded = false;
        if (["stock", "barcode", "materialLocation"].includes(state.section)) scheduleStockRefresh();
        if (state.section === "home") scheduleOverviewRefresh(["stock", "movements"]);
      }
      if (topic === "workforce") scheduleTaskBadgeRefresh();
      if (topic === "workforce" || topic === "shipment") {
        state.overviewWorkforceLoaded = false;
        if (state.section === "home") scheduleOverviewRefresh(["workforce"]);
      }
    };
    source.addEventListener("event", handleGatewayEvent);
    source.addEventListener("message", handleGatewayEvent);
    state.gatewayEventSource = source;
  }

  function closeGatewayEvents() {
    if (state.gatewayEventSource) state.gatewayEventSource.close();
    state.gatewayEventSource = null;
    document.dispatchEvent(new CustomEvent("personel:gateway-status", { detail: { connected: false } }));
  }

  async function loadStock(options = {}) {
    if (!options.force && state.stockLoaded) return state.stock;
    if (state.stockLoadPromise) return state.stockLoadPromise;
    state.stockLoadPromise = readPersonelData("/api/workforce/stock")
      .then((result) => {
        state.stock = normalizeStock(result);
        state.stockRevision = responseRevision(result, state.stockRevision);
        state.stockLoaded = true;
        if (state.section === "stock") renderStock();
        refreshLookupSurfaces();
        return state.stock;
      })
      .catch((error) => {
        if (error.code === "STOCK_LOCATION_HIDDEN") {
          state.stock = emptyStockState();
          state.stockLoaded = false;
          closeStockDetail({ restoreFocus: false, force: true });
          if (state.section === "stock") renderStock();
        }
        showStockMessage(error.message || "Stok verisi alınamadı.", true);
        throw error;
      })
      .finally(() => {
        state.stockLoadPromise = null;
        if (state.stockRefreshPending && ["stock", "barcode", "materialLocation"].includes(state.section)) {
          state.stockRefreshPending = false;
          scheduleStockRefresh();
        }
      });
    return state.stockLoadPromise;
  }

  function setupStockEvents() {
    // Stok ve workforce olayları tek authenticated gateway üzerinden gelir.
    setupGatewayEvents();
  }

  function scheduleStockRefresh() {
    if (state.stockLoadPromise) {
      state.stockRefreshPending = true;
      return;
    }
    window.clearTimeout(state.stockRefreshTimer);
    state.stockRefreshTimer = window.setTimeout(() => {
      state.stockRefreshTimer = null;
      loadStock({ force: true }).catch(() => {});
    }, 120);
  }

  function responseRevision(value, fallback = 0) {
    const source = value && typeof value === "object" ? value : {};
    const revisions = source.revisions && typeof source.revisions === "object" ? source.revisions : {};
    const revision = Number(source.revision ?? source.stockRevision ?? revisions.stock);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : Math.max(0, Number(fallback || 0));
  }

  function closeStockEvents() {
    window.clearTimeout(state.stockRefreshTimer);
    state.stockRefreshTimer = null;
    state.stockRefreshPending = false;
  }

  function renderStock() {
    renderCategories();
    renderProducts();
  }

  function showStockMessage(message, error = false) {
    if (!els.stockMessage) return;
    els.stockMessage.textContent = String(message || "");
    els.stockMessage.hidden = !message;
    els.stockMessage.classList.toggle("is-error", Boolean(error));
    els.stockMessage.classList.toggle("is-success", Boolean(message) && !error);
  }

  function stockLookupApi() {
    return window.MenuSuiteStockLookup || null;
  }

  function getBarcodeReader() {
    if (state.barcodeReader) return state.barcodeReader;
    if (!window.ZXingBrowser || typeof window.ZXingBrowser.BrowserMultiFormatReader !== "function") {
      throw new Error("Barkod okuma bileşeni yüklenemedi. Kodu elle yazarak sorgulayabilirsiniz.");
    }
    state.barcodeReader = new window.ZXingBrowser.BrowserMultiFormatReader(undefined, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 600
    });
    return state.barcodeReader;
  }

  async function startBarcodeCamera() {
    if (state.barcodeCameraStarting || state.barcodeCameraControls) return;
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      setBarcodeMessage("Bu cihazda kamera erişimi desteklenmiyor. Barkodu elle yazabilir veya fotoğraf seçebilirsiniz.", true);
      return;
    }
    const session = ++state.barcodeCameraSession;
    state.barcodeCameraStarting = true;
    if (els.barcodeCameraOpen) {
      els.barcodeCameraOpen.disabled = true;
      els.barcodeCameraOpen.setAttribute("aria-busy", "true");
    }
    if (els.barcodeCameraPanel) els.barcodeCameraPanel.hidden = false;
    setBarcodeMessage("Kamera hazırlanıyor…");
    try {
      const reader = getBarcodeReader();
      const controls = await reader.decodeFromConstraints({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      }, els.barcodeCameraVideo, (result, error, activeControls) => {
        if (session !== state.barcodeCameraSession || state.section !== "materialLocation" || els.barcodeScannerModal.hidden) return;
        if (result) {
          const value = typeof result.getText === "function" ? result.getText() : String(result.text || result || "");
          activeControls?.stop?.();
          receiveScannedBarcode(value, "Kamera barkodu okudu.");
          stopBarcodeCamera({ preserveMessage: true });
          return;
        }
        const name = String(error && error.name || "");
        if (error && !["NotFoundException", "ChecksumException", "FormatException"].includes(name)) {
          setBarcodeMessage("Kamera görüntüsü okunamadı. Kamerayı yeniden açabilir veya kodu elle yazabilirsiniz.", true);
        }
      });
      if (session !== state.barcodeCameraSession || state.section !== "materialLocation" || els.barcodeScannerModal.hidden) {
        controls?.stop?.();
        releaseBarcodeVideo();
        return;
      }
      state.barcodeCameraControls = controls;
      setBarcodeMessage("Barkodu çerçevenin içine getirin.");
    } catch (error) {
      if (session !== state.barcodeCameraSession) return;
      stopBarcodeCamera({ preserveMessage: true });
      const name = String(error && error.name || "");
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? "Kamera izni verilmedi. Tarayıcı izinlerinden kamerayı açabilir veya kodu elle yazabilirsiniz."
        : name === "NotFoundError" || name === "DevicesNotFoundError"
          ? "Bu cihazda kullanılabilir kamera bulunamadı. Barkodu elle yazabilir veya fotoğraf seçebilirsiniz."
          : name === "NotReadableError" || name === "TrackStartError"
            ? "Kamera başka bir uygulama tarafından kullanılıyor. Kamerayı kapatıp yeniden deneyin."
            : error && error.message || "Kamera açılamadı. Barkodu elle yazarak sorgulayabilirsiniz.";
      setBarcodeMessage(message, true);
    } finally {
      if (session === state.barcodeCameraSession) state.barcodeCameraStarting = false;
      if (els.barcodeCameraOpen) {
        els.barcodeCameraOpen.disabled = false;
        els.barcodeCameraOpen.removeAttribute("aria-busy");
      }
    }
  }

  function releaseBarcodeVideo() {
    const stream = els.barcodeCameraVideo && els.barcodeCameraVideo.srcObject;
    if (stream && typeof stream.getTracks === "function") stream.getTracks().forEach((track) => track.stop());
    if (els.barcodeCameraVideo) {
      els.barcodeCameraVideo.pause?.();
      els.barcodeCameraVideo.srcObject = null;
      els.barcodeCameraVideo.removeAttribute("src");
    }
  }

  function stopBarcodeCamera(options = {}) {
    state.barcodeCameraSession += 1;
    try { state.barcodeCameraControls?.stop?.(); } catch (_error) {}
    state.barcodeCameraControls = null;
    state.barcodeCameraStarting = false;
    releaseBarcodeVideo();
    if (els.barcodeCameraPanel) els.barcodeCameraPanel.hidden = false;
    if (els.barcodeCameraOpen) {
      els.barcodeCameraOpen.disabled = false;
      els.barcodeCameraOpen.removeAttribute("aria-busy");
    }
    if (!options.preserveMessage && state.section === "barcode") setBarcodeMessage("");
  }

  async function decodeBarcodePhoto() {
    const file = els.barcodePhotoInput && els.barcodePhotoInput.files && els.barcodePhotoInput.files[0];
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setBarcodeMessage("Barkod okumak için bir fotoğraf dosyası seçin.", true);
      els.barcodePhotoInput.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setBarcodeMessage("Fotoğraf en fazla 20 MB olabilir.", true);
      els.barcodePhotoInput.value = "";
      return;
    }
    if (els.barcodePhotoOpen) {
      els.barcodePhotoOpen.disabled = true;
      els.barcodePhotoOpen.setAttribute("aria-busy", "true");
    }
    setBarcodeMessage("Fotoğraftaki barkod okunuyor…");
    const objectUrl = URL.createObjectURL(file);
    stopBarcodeCamera({ preserveMessage: true });
    const session = state.barcodeCameraSession;
    try {
      const reader = getBarcodeReader();
      const result = await reader.decodeFromImageUrl(objectUrl);
      if (session !== state.barcodeCameraSession || els.barcodeScannerModal.hidden || state.section !== "materialLocation") return;
      const value = typeof result.getText === "function" ? result.getText() : String(result.text || result || "");
      if (!value) throw new Error("Fotoğrafta okunabilir barkod bulunamadı.");
      receiveScannedBarcode(value, "Fotoğraftaki barkod okundu.");
    } catch (error) {
      if (session !== state.barcodeCameraSession || els.barcodeScannerModal.hidden) return;
      const name = String(error && error.name || "");
      const detail = String(error && error.message || "");
      const unreadable = ["NotFoundException", "ChecksumException", "FormatException"].includes(name)
        || /not\s*found|no multi\s*format readers|detect the code|checksum|format exception/i.test(detail);
      const message = unreadable
        ? "Fotoğrafta okunabilir barkod bulunamadı. Daha net bir fotoğraf seçebilir veya kodu elle yazabilirsiniz."
        : detail || "Fotoğraf okunamadı. Başka bir fotoğraf seçebilir veya kodu elle yazabilirsiniz.";
      setBarcodeMessage(message, true);
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (els.barcodePhotoInput) els.barcodePhotoInput.value = "";
      if (els.barcodePhotoOpen) {
        els.barcodePhotoOpen.disabled = false;
        els.barcodePhotoOpen.removeAttribute("aria-busy");
      }
    }
  }

  function receiveScannedBarcode(value, message) {
    const api = stockLookupApi();
    const barcode = api ? api.scannerValue(value) : String(value || "").trim();
    if (!barcode) {
      setBarcodeMessage("Barkod okunamadı. Kodu elle yazabilirsiniz.", true);
      return;
    }
    if (els.materialSearchInput) els.materialSearchInput.value = barcode;
    clearBarcodeDraftResult();
    if (els.materialCategoryFilter) els.materialCategoryFilter.value = "all";
    if (els.materialInStockFilter) els.materialInStockFilter.checked = false;
    closeBarcodeScanner();
    void submitMaterialSearch().then(() => setMaterialMessage(message));
  }

  function openBarcodeScanner() {
    if (!els.barcodeScannerModal || state.section !== "materialLocation") return;
    state.barcodeScannerTrigger = document.activeElement;
    els.barcodeScannerModal.hidden = false;
    document.body.classList.add("has-barcode-scanner-modal");
    els.barcodeCameraClose?.focus({ preventScroll: true });
    void startBarcodeCamera();
  }

  function closeBarcodeScanner(options = {}) {
    if (!els.barcodeScannerModal || els.barcodeScannerModal.hidden) return;
    stopBarcodeCamera();
    els.barcodeScannerModal.hidden = true;
    document.body.classList.remove("has-barcode-scanner-modal");
    if (options.restoreFocus !== false) (state.barcodeScannerTrigger || els.materialSearchInput)?.focus({ preventScroll: true });
    state.barcodeScannerTrigger = null;
  }

  function clearBarcodeDraftResult() {
    const helper = stockLookupApi();
    const query = helper ? helper.scannerValue(els.barcodeLookupInput?.value) : String(els.barcodeLookupInput?.value || "").trim();
    if (query === state.barcodeLastQuery) return;
    state.barcodeQuerySequence += 1;
    state.barcodeLastQuery = "";
    state.barcodeLastProductId = "";
    if (els.barcodeLookupResult) els.barcodeLookupResult.innerHTML = "";
    setBarcodePending(false);
  }

  function setBarcodeMessage(message, error = false) {
    if (!els.barcodeReaderMessage) return;
    els.barcodeReaderMessage.textContent = String(message || "");
    els.barcodeReaderMessage.hidden = !message;
    els.barcodeReaderMessage.classList.toggle("is-error", Boolean(error));
  }

  function setBarcodePending(pending) {
    if (!els.barcodeLookupSubmit) return;
    els.barcodeLookupSubmit.disabled = pending;
    els.barcodeLookupSubmit.setAttribute("aria-busy", pending ? "true" : "false");
    els.barcodeLookupSubmit.textContent = pending ? "Sorgulanıyor…" : "Sorgula";
  }

  function submitBarcodeLookup(event, options = {}) {
    event?.preventDefault?.();
    const helper = stockLookupApi();
    const query = helper ? helper.scannerValue(els.barcodeLookupInput?.value) : String(els.barcodeLookupInput?.value || "").trim();
    if (!query) {
      setBarcodeMessage("Barkod veya ürün kodu girin.", true);
      els.barcodeLookupInput?.focus();
      return Promise.resolve();
    }
    if (state.barcodeQueryPromise && state.barcodeQueryPromise.query === query) return state.barcodeQueryPromise.promise;
    const sequence = ++state.barcodeQuerySequence;
    state.barcodeLastQuery = query;
    setBarcodeMessage("");
    setBarcodePending(true);
    if (els.barcodeLookupResult) {
      els.barcodeLookupResult.innerHTML = '<div class="lookup-empty-state"><strong>Stok bilgisi kontrol ediliyor…</strong><p>Lütfen kısa bir an bekleyin.</p></div>';
    }
    const request = (async () => {
      try {
        await loadStock({ force: options.force === true });
        if (sequence !== state.barcodeQuerySequence || query !== (helper ? helper.scannerValue(els.barcodeLookupInput?.value) : String(els.barcodeLookupInput?.value || "").trim())) return;
        if (!helper) throw new Error("Barkod eşleştirme bileşeni yüklenemedi.");
        renderBarcodeLookupResult(helper.lookupProduct(stockProducts(), query, state.stock.locations));
      } catch (error) {
        if (sequence !== state.barcodeQuerySequence) return;
        renderBarcodeConnectionError(error && error.message);
      }
    })();
    const pending = { query, promise: request };
    state.barcodeQueryPromise = pending;
    request.finally(() => {
      if (state.barcodeQueryPromise === pending) state.barcodeQueryPromise = null;
      setBarcodePending(false);
    });
    return request;
  }

  function renderBarcodeConnectionError(message) {
    state.barcodeLastProductId = "";
    if (!els.barcodeLookupResult) return;
    els.barcodeLookupResult.innerHTML = `
      <div class="lookup-empty-state">
        <strong>Stok bilgisine ulaşılamadı</strong>
        <p>${escapeHTML(message || "Bağlantıyı kontrol edip yeniden deneyin.")}</p>
        <button class="ui-button ui-button--secondary" type="button" data-barcode-action="retry">Yeniden Dene</button>
      </div>`;
  }

  function renderBarcodeLookupResult(result) {
    if (!els.barcodeLookupResult) return;
    state.barcodeLastProductId = "";
    if (!result || result.kind === "notFound" || result.kind === "empty") {
      els.barcodeLookupResult.innerHTML = `
        <div class="lookup-empty-state">
          <strong>Bu barkodla eşleşen kayıt bulunamadı</strong>
          <p>Kod farklı bir etikete ait olabilir; ürünün adıyla da arayabilirsiniz.</p>
          <button class="ui-button ui-button--secondary" type="button" data-barcode-action="material">Malzeme adıyla ara</button>
        </div>`;
      return;
    }
    if (result.kind === "location") {
      els.barcodeLookupResult.innerHTML = `
        <div class="lookup-empty-state">
          <strong>Bu kod bir konum barkodu</strong>
          <p>Ürün barkodu veya ürün kodu girin; konum barkodu ürün olarak eşleştirilmedi.</p>
          <button class="ui-button ui-button--secondary" type="button" data-barcode-action="material">Malzeme adıyla ara</button>
        </div>`;
      return;
    }
    if (result.kind === "ambiguous") {
      els.barcodeLookupResult.innerHTML = `
        <div class="lookup-empty-state">
          <strong>Barkod çakışması bulundu</strong>
          <p>Bu kod birden fazla kayıtla eşleşiyor; yanlış ürün seçilmedi. Yöneticinize bildirin.</p>
        </div>`;
      return;
    }
    const product = result.product;
    const quantity = accessibleStockQuantity(product);
    const hasStock = quantity > 0;
    const status = hasStock ? "Stokta mevcut" : "Ürün kayıtlı, stok yok";
    const productImage = String(product.imageUrl || product.image || "").trim() || "/assets/images/neutral-placeholder.svg";
    state.barcodeLastProductId = String(product.id || "");
    els.barcodeLookupResult.innerHTML = `
      <article class="barcode-product-card" data-stock-state="${hasStock ? "available" : "empty"}">
        <div class="barcode-product-media"><img src="${escapeAttribute(productImage)}" alt="${escapeAttribute(product.name || "Ürün")} görseli" loading="lazy" decoding="async"></div>
        <div class="barcode-product-copy">
          <div class="barcode-product-title"><h3>${escapeHTML(product.name || product.productName || "Ürün")}</h3><p>${escapeHTML(product.productCode || "Ürün kodu kayıtlı değil")}</p></div>
          <span class="lookup-stock-status">${status}</span>
          <p class="barcode-stock-line"><span>Güncel stok</span><strong>${escapeHTML(accessibleStockLabel(product))}</strong></p>
          <button class="ui-button ui-button--primary lookup-result-action" type="button" data-barcode-action="location" data-product-id="${escapeAttribute(product.id)}">Yerini Göster</button>
        </div>
      </article>`;
  }

  function openMaterialSearch() {
    setSection("materialLocation", { updateHash: false });
    if (els.materialSearchInput) els.materialSearchInput.value = "";
    state.materialQuery = "";
    window.requestAnimationFrame(() => els.materialSearchInput?.focus({ preventScroll: true }));
  }

  function submitMaterialSearch(event) {
    event?.preventDefault?.();
    state.materialQuery = String(els.materialSearchInput?.value || "").trim();
    state.materialCategory = String(els.materialCategoryFilter?.value || "all");
    state.materialInStock = Boolean(els.materialInStockFilter?.checked);
    setMaterialMessage("");
    return loadStock().then(renderMaterialFinder).catch((error) => {
      setMaterialMessage(error.message || "Malzeme listesi alınamadı.", true);
    });
  }

  function setMaterialMessage(message, error = false) {
    if (!els.materialSearchMessage) return;
    els.materialSearchMessage.textContent = String(message || "");
    els.materialSearchMessage.hidden = !message;
    els.materialSearchMessage.classList.toggle("is-error", Boolean(error));
  }

  function renderMaterialFinder() {
    renderMaterialCategories();
    renderMaterialResults();
  }

  function renderMaterialCategories() {
    if (!els.materialCategoryFilter) return;
    const selected = state.materialCategory || "all";
    els.materialCategoryFilter.innerHTML = [
      '<option value="all">Tüm kategoriler</option>',
      ...stockCategories().map((category) => `<option value="${escapeAttribute(category.id)}">${escapeHTML(category.name)}</option>`)
    ].join("");
    els.materialCategoryFilter.value = [...els.materialCategoryFilter.options].some((option) => option.value === selected) ? selected : "all";
    state.materialCategory = els.materialCategoryFilter.value;
  }

  function materialProducts() {
    const helper = stockLookupApi();
    const seen = new Set();
    return stockProducts().filter((product) => {
      const id = String(product.id || product.productCode || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      if (state.materialCategory !== "all" && String(product.categoryId) !== state.materialCategory) return false;
      if (state.materialInStock && accessibleStockQuantity(product) <= 0) return false;
      return helper ? helper.productMatchesSearch(product, state.materialQuery) : normalizeText(`${product.name || ""} ${product.productCode || ""} ${product.manufacturerCode || ""} ${product.brand || product.supplier || ""}`).includes(normalizeText(state.materialQuery));
    });
  }

  function renderMaterialResults() {
    if (!els.materialSearchResults) return;
    const products = materialProducts();
    if (!products.length) {
      els.materialSearchResults.innerHTML = `
        <div class="lookup-empty-state">
          <strong>Aramanıza uygun malzeme bulunamadı</strong>
          <p>Adı, modeli veya ürün kodunu kontrol edip yeniden arayın.</p>
        </div>`;
      return;
    }
    els.materialSearchResults.innerHTML = `
      <p class="material-results-summary">${products.length} malzeme gösteriliyor</p>
      ${products.map((product) => {
        const image = String(product.imageUrl || product.image || "").trim() || "/assets/images/neutral-placeholder.svg";
        return `
          <article class="material-result-row">
            <div class="material-result-media"><img src="${escapeAttribute(image)}" alt="${escapeAttribute(product.name || "Ürün")} görseli" loading="lazy" decoding="async"></div>
            <div class="material-result-copy"><strong>${escapeHTML(product.name || product.productName || "Ürün")}</strong><p>${escapeHTML(product.productCode || "Ürün kodu kayıtlı değil")}</p></div>
            <span class="material-result-stock">${escapeHTML(accessibleStockLabel(product))}</span>
            <button class="ui-button ui-button--secondary material-result-action" type="button" data-material-location-product="${escapeAttribute(product.id)}">Yerini Göster</button>
          </article>`;
      }).join("")}`;
  }

  function accessibleStockQuantity(product) {
    const quantity = Number(product && product.accessibleQuantity);
    return Number.isFinite(quantity) ? Math.max(0, quantity) : Math.max(0, numberValue(product && product.stockQuantity));
  }

  function accessibleStockLabel(product) {
    return `${formatNumber(accessibleStockQuantity(product))} ${productBaseUnit(product)}`;
  }

  function productLocationEntries(product) {
    const productId = String(product && product.id || "");
    const locations = new Map((state.stock.locations || []).map((location) => [String(location.id), location]));
    const balances = (state.stock.locationBalances || [])
      .filter((balance) => String(balance.productId || "") === productId)
      .map((balance) => ({ balance, location: locations.get(String(balance.locationId)) || null }));
    const stocked = balances.filter((entry) => numberValue(entry.balance.quantity) > 0);
    if (stocked.length) return stocked;
    const ownId = String(state.stock.location && state.stock.location.id || "");
    const own = balances.find((entry) => String(entry.balance.locationId || "") === ownId) || balances[0];
    if (own) return [own];
    if (state.stock.location) return [{
      location: state.stock.location,
      balance: { productId, locationId: state.stock.location.id, quantity: product && product.stockQuantity, quantityDisplay: currentStockLabel(product) }
    }];
    return [];
  }

  function openMaterialLocation(productId, trigger) {
    const product = stockProducts().find((item) => String(item.id) === String(productId));
    if (!product || !els.materialLocationModal) return;
    state.materialLocationProductId = String(product.id);
    state.materialLocationTrigger = trigger || document.activeElement;
    renderMaterialLocation(product);
    els.materialLocationModal.hidden = false;
    document.body.classList.add("has-material-location-modal");
    window.requestAnimationFrame(() => els.materialLocationClose?.focus({ preventScroll: true }));
  }

  function renderMaterialLocation(product) {
    if (!product || !els.materialLocationContent) return;
    if (els.materialLocationTitle) els.materialLocationTitle.textContent = product.name || product.productName || "Malzeme konumu";
    if (els.materialLocationCode) els.materialLocationCode.textContent = product.productCode || "Ürün kodu kayıtlı değil";
    const entries = productLocationEntries(product);
    if (!entries.length) {
      els.materialLocationContent.innerHTML = `
        <div class="lookup-empty-state"><strong>Konum bilgisi kayıtlı değil</strong><p>Bu ürün için erişebildiğiniz bir depo veya raf kaydı bulunmuyor.</p></div>`;
      return;
    }
    els.materialLocationContent.innerHTML = entries.map(({ balance, location }) => {
      const photoUrl = String(location?.photoUrl || balance && balance.placementPhotoUrl || "").trim();
      const hasPoint = balance.placementX != null && balance.placementY != null;
      const legacyPlacement = [
        balance.cabinet ? `Dolap: ${balance.cabinet}` : "",
        balance.shelf ? `Raf: ${balance.shelf}` : "",
        balance.bin || balance.compartment ? `Bölme: ${balance.bin || balance.compartment}` : ""
      ].filter(Boolean).join(" · ");
      const placementName = safeText(balance.placementName, legacyPlacement || "Yeri belirlenmedi");
      const stockLabel = `${formatNumber(balance.quantity)} ${productBaseUnit(product)}`;
      return `
        <section class="material-location-entry">
          <div class="material-location-photo${location?.photoUrl ? " is-plan" : ""}">${photoUrl
            ? `<div class="material-location-plan"><img src="${escapeAttribute(photoUrl)}" alt="${escapeAttribute(location && location.name || "Konum")} fotoğrafı" loading="eager" decoding="async">${hasPoint ? `<span class="stock-plan-marker" style="left:${Number(balance.placementX)}%;top:${Number(balance.placementY)}%" aria-label="Malzeme konumu">●</span>` : ""}</div>`
            : "<span>Konum fotoğrafı kayıtlı değil</span>"}</div>
          <div class="material-location-fields">
            <div class="material-location-field"><span>Depo</span><strong>${escapeHTML(location && location.name || "Depo bilgisi kayıtlı değil")}</strong></div>
            <div class="material-location-field"><span>Yer / raf</span><strong>${escapeHTML(placementName)}</strong></div>
            <div class="material-location-field"><span>Bu konumdaki stok</span><strong>${escapeHTML(stockLabel)}</strong></div>
          </div>
        </section>`;
    }).join("");
    els.materialLocationContent.querySelectorAll(".material-location-photo img").forEach((image) => {
      image.addEventListener("error", () => {
        const parent = image.closest(".material-location-photo");
        if (parent) parent.innerHTML = "<span>Konum fotoğrafı yüklenemedi</span>";
      }, { once: true });
    });
  }

  function closeMaterialLocation(options = {}) {
    if (!els.materialLocationModal || els.materialLocationModal.hidden) return;
    els.materialLocationModal.hidden = true;
    document.body.classList.remove("has-material-location-modal");
    const trigger = state.materialLocationTrigger;
    state.materialLocationProductId = "";
    state.materialLocationTrigger = null;
    if (options.restoreFocus !== false && trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
  }

  function refreshLookupSurfaces() {
    if (state.section === "barcode" && state.barcodeLastQuery && stockLookupApi()) {
      renderBarcodeLookupResult(stockLookupApi().lookupProduct(stockProducts(), state.barcodeLastQuery, state.stock.locations));
    }
    if (state.section === "materialLocation") renderMaterialFinder();
    if (els.materialLocationModal && !els.materialLocationModal.hidden && state.materialLocationProductId) {
      const product = stockProducts().find((item) => String(item.id) === state.materialLocationProductId);
      if (product) renderMaterialLocation(product);
      else closeMaterialLocation({ restoreFocus: false });
    }
  }

  function renderCategories() {
    if (!els.stockCategoryPills) return;
    const categories = stockCategories();
    const criticalCount = stockProducts().filter(isCriticalProduct).length;
    els.stockCategoryPills.innerHTML = [
      `<button class="${state.category === "all" ? "is-active" : ""}" type="button" data-category="all"><span>Tümü</span><b>${stockProducts().length}</b></button>`,
      `<button class="${state.category === "critical" ? "is-active" : ""}" type="button" data-category="critical"><span>Kritik</span><b>${criticalCount}</b></button>`,
      ...categories.map((category) => `
        <button class="${state.category === category.id ? "is-active" : ""}" type="button" data-category="${escapeAttribute(category.id)}"><span>${escapeHTML(category.name)}</span><b>${stockProducts().filter((product) => product.categoryId === category.id).length}</b></button>
      `)
    ].join("");
  }

  function renderProducts() {
    if (!els.stockGrid) return;
    const categories = new Map(stockCategories().map((category) => [category.id, category]));
    const products = filteredProducts();
    els.stockGrid.innerHTML = products.length ? products.map((product) => {
      const category = categories.get(product.categoryId);
      const status = stockStatus(product);
      const productImage = String(product.imageUrl || product.image || "").trim();
      const imageUrl = productImage || "/assets/images/neutral-placeholder.svg";
      return `
        <article class="stock-card" data-stock-product-id="${escapeAttribute(product.id)}" role="button" tabindex="0" aria-label="${escapeAttribute(product.name)} detayını aç">
          <div class="stock-card-media${productImage ? "" : " is-placeholder"}"><img src="${escapeAttribute(imageUrl)}" alt="${productImage ? escapeAttribute(product.name) : ""}" loading="lazy" decoding="async"></div>
          <div class="stock-card-head">
            <div class="stock-card-meta-row">
              <p>${escapeHTML((category && category.name) || product.category || "Stok")}</p>
              <em class="badge ${escapeAttribute(status.key)}">${escapeHTML(status.label)}</em>
            </div>
            <h2>${escapeHTML(product.name)}</h2>
          </div>
          <div class="stock-card-quantity">
            <small>Mevcut stok</small>
            <strong class="stock-card-quantity__combined">${escapeHTML(currentStockLabel(product))}</strong>
          </div>
        </article>
      `;
    }).join("") : `<div class="stock-empty">${stockProducts().length ? "Aradığınız stok ürünü bulunamadı." : "Gösterilecek aktif stok ürünü bulunmuyor."}</div>`;
  }

  function openStockDetail(productId) {
    const product = stockProducts().find((item) => item.id === productId);
    if (!product || !els.stockDetailModal) return;
    if (els.stockDetailModal.hidden) {
      state.detailTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    state.detailProductId = productId;
    if (els.stockDetailTitle) els.stockDetailTitle.textContent = product.name || "Ürün detayı";
    const productImage = String(product.imageUrl || product.image || "").trim();
    const imageUrl = productImage || "/assets/images/neutral-placeholder.svg";
    if (els.stockDetailMedia) {
      els.stockDetailMedia.classList.toggle("is-placeholder", !productImage);
      els.stockDetailMedia.disabled = !productImage;
      els.stockDetailMedia.setAttribute("aria-label", productImage ? `${product.name || "Ürün"} görselini büyüt` : "Ürün görseli bulunmuyor");
      els.stockDetailMedia.title = productImage ? "Görseli büyüt" : "Ürün görseli bulunmuyor";
    }
    if (els.stockDetailImage) {
      els.stockDetailImage.src = imageUrl;
      els.stockDetailImage.alt = productImage ? product.name || "Ürün görseli" : "";
    }
    if (els.stockDetailQuantity) els.stockDetailQuantity.textContent = currentStockLabel(product);
    if (els.stockDetailMessage) {
      els.stockDetailMessage.textContent = "";
      els.stockDetailMessage.hidden = true;
    }
    prepareStockAction(product);
    els.stockDetailModal.hidden = false;
    syncPanelModalLock();
    window.setTimeout(() => {
      if (els.stockActionQuantity && !els.stockActionQuantity.disabled) {
        els.stockActionQuantity.focus();
        els.stockActionQuantity.select();
        return;
      }
      els.stockDetailClose?.focus();
    }, 0);
  }

  function isStockImageViewerOpen() {
    return Boolean(els.stockImageViewer && !els.stockImageViewer.hidden);
  }

  function openStockImageViewer() {
    const product = stockProducts().find((item) => String(item.id) === String(state.detailProductId));
    const imageUrl = String(product && (product.imageUrl || product.image) || "").trim();
    if (!imageUrl || !els.stockImageViewer || !els.stockImageViewerImage) return;
    state.stockImageViewerTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : els.stockDetailMedia;
    state.stockImageZoom = 1;
    state.stockImagePanX = 0;
    state.stockImagePanY = 0;
    state.stockImageDrag = null;
    if (els.stockImageViewerTitle) els.stockImageViewerTitle.textContent = product.name || "Ürün görseli";
    els.stockImageViewerImage.src = els.stockDetailImage?.currentSrc || imageUrl;
    els.stockImageViewerImage.alt = `${product.name || "Ürün"} görseli`;
    els.stockImageViewer.hidden = false;
    if (els.stockDetailModal) {
      els.stockDetailModal.inert = true;
      els.stockDetailModal.setAttribute("aria-hidden", "true");
    }
    syncPanelModalLock();
    window.requestAnimationFrame(() => {
      applyStockImageTransform();
      els.stockImageViewerClose?.focus();
    });
  }

  function closeStockImageViewer(options = {}) {
    if (!els.stockImageViewer || els.stockImageViewer.hidden) return;
    const restoreTarget = state.stockImageViewerTrigger;
    state.stockImageViewerTrigger = null;
    state.stockImageDrag = null;
    els.stockImageViewer.hidden = true;
    els.stockImageViewerStage?.classList.remove("is-zoomed", "is-dragging");
    if (els.stockDetailModal) {
      els.stockDetailModal.inert = false;
      els.stockDetailModal.removeAttribute("aria-hidden");
    }
    syncPanelModalLock();
    if (options.restoreFocus !== false && restoreTarget && restoreTarget.isConnected) {
      window.setTimeout(() => restoreTarget.focus(), 0);
    }
  }

  function setStockImageZoom(value) {
    const next = Math.min(4, Math.max(1, Number(value) || 1));
    state.stockImageZoom = Math.round(next * 100) / 100;
    if (state.stockImageZoom === 1) {
      state.stockImagePanX = 0;
      state.stockImagePanY = 0;
    }
    applyStockImageTransform();
  }

  function applyStockImageTransform() {
    const stage = els.stockImageViewerStage;
    const image = els.stockImageViewerImage;
    if (!stage || !image) return;
    const scale = state.stockImageZoom;
    const maxX = Math.max(0, ((image.offsetWidth * scale) - stage.clientWidth) / 2);
    const maxY = Math.max(0, ((image.offsetHeight * scale) - stage.clientHeight) / 2);
    state.stockImagePanX = Math.min(maxX, Math.max(-maxX, state.stockImagePanX));
    state.stockImagePanY = Math.min(maxY, Math.max(-maxY, state.stockImagePanY));
    image.style.transform = `translate3d(${state.stockImagePanX}px, ${state.stockImagePanY}px, 0) scale(${scale})`;
    stage.classList.toggle("is-zoomed", scale > 1);
    if (els.stockImageZoomOut) els.stockImageZoomOut.disabled = scale <= 1;
    if (els.stockImageZoomIn) els.stockImageZoomIn.disabled = scale >= 4;
    if (els.stockImageZoomReset) els.stockImageZoomReset.textContent = `${Math.round(scale * 100)}%`;
  }

  function handleStockImageWheel(event) {
    if (!isStockImageViewerOpen()) return;
    event.preventDefault();
    setStockImageZoom(state.stockImageZoom + (event.deltaY < 0 ? 0.25 : -0.25));
  }

  function startStockImageDrag(event) {
    if (state.stockImageZoom <= 1 || (event.pointerType === "mouse" && event.button !== 0)) return;
    state.stockImageDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: state.stockImagePanX,
      panY: state.stockImagePanY
    };
    els.stockImageViewerStage?.setPointerCapture(event.pointerId);
    els.stockImageViewerStage?.classList.add("is-dragging");
    event.preventDefault();
  }

  function moveStockImageDrag(event) {
    const drag = state.stockImageDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.stockImagePanX = drag.panX + event.clientX - drag.startX;
    state.stockImagePanY = drag.panY + event.clientY - drag.startY;
    applyStockImageTransform();
  }

  function endStockImageDrag(event) {
    const drag = state.stockImageDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const stage = els.stockImageViewerStage;
    if (stage?.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    state.stockImageDrag = null;
    stage?.classList.remove("is-dragging");
  }

  function closeStockDetail(options = {}) {
    if (state.stockActionSubmitting && options.force !== true) return;
    if (isStockImageViewerOpen()) closeStockImageViewer({ restoreFocus: false });
    resetStockActionState();
    const restoreTarget = state.detailTrigger;
    state.detailProductId = null;
    state.detailTrigger = null;
    if (els.stockDetailModal) els.stockDetailModal.hidden = true;
    syncPanelModalLock();
    if (options.restoreFocus !== false && restoreTarget && restoreTarget.isConnected) {
      window.setTimeout(() => restoreTarget.focus(), 0);
    }
  }

  function syncPanelModalLock() {
    const hasOpenModal = Boolean(isOverviewDialogOpen() || (els.stockDetailModal && !els.stockDetailModal.hidden) || isStockImageViewerOpen());
    document.documentElement.classList.toggle("is-panel-modal-open", hasOpenModal);
    document.body.classList.toggle("is-panel-modal-open", hasOpenModal);
  }

  function canUsePersonnelStockActions() {
    if (PREVIEW_TOKEN || !state.sessionActive) return false;
    const location = state.stock.location;
    if (!location || location.active === false) return false;
    return String(location.type || "workshop") === "workshop";
  }

  async function toggleStockHistory(button) {
    if (!els.stockDetailHistory) return;
    const open = els.stockDetailHistory.hidden;
    els.stockDetailHistory.hidden = !open;
    if (button) button.setAttribute("aria-expanded", String(open));
    if (open) {
      const heading = document.getElementById("stockDetailHistoryTitle");
      heading && heading.focus && heading.focus();
      await loadStockDetailHistory().catch(() => {});
    }
  }

  async function loadStockDetailHistory(options = {}) {
    const productId = String(state.detailProductId || "");
    if (!productId || !els.stockDetailHistoryList) return [];
    if (state.stockHistoryLoadPromise && state.stockHistoryLoadProductId === productId && options.force !== true) return state.stockHistoryLoadPromise;
    if (!stockMovements().some((movement) => String(movement.productId || movement.stockProductId || "") === productId) || options.force === true) {
      els.stockDetailHistoryList.innerHTML = '<p class="stock-history-empty">Hareketler yükleniyor…</p>';
    }
    const locationId = String(state.stock.location && state.stock.location.id || "");
    const query = new URLSearchParams({ productId, limit: "30" });
    if (locationId) query.set("locationId", locationId);
    const loadPromise = readPersonelData(`/api/workforce/stock/movements?${query.toString()}`)
      .then((result) => {
        const merged = new Map(stockMovements().map((movement) => [String(movement.id || ""), movement]));
        (Array.isArray(result.movements) ? result.movements : []).forEach((movement) => {
          if (movement && movement.id) merged.set(String(movement.id), movement);
        });
        state.stock.movements = Array.from(merged.values());
        state.stockRevision = responseRevision(result, state.stockRevision);
        const product = stockProducts().find((item) => String(item.id) === productId);
        if (product && String(state.detailProductId || "") === productId) renderStockDetailHistory(product);
        return result.movements || [];
      })
      .catch((error) => {
        if (String(state.detailProductId || "") === productId) {
          els.stockDetailHistoryList.innerHTML = `<p class="stock-history-empty is-error">${escapeHTML(error.message || "Hareket geçmişi alınamadı.")}</p>`;
        }
        throw error;
      })
      .finally(() => {
        if (state.stockHistoryLoadPromise === loadPromise) {
          state.stockHistoryLoadPromise = null;
          state.stockHistoryLoadProductId = "";
        }
      });
    state.stockHistoryLoadProductId = productId;
    state.stockHistoryLoadPromise = loadPromise;
    return loadPromise;
  }

  function renderStockDetailHistory(product) {
    if (!els.stockDetailHistoryList || !product) return;
    const locationId = String(state.stock.location && state.stock.location.id || "");
    const movements = stockMovements().filter((movement) => {
      const productId = String(movement.productId || movement.stockProductId || "");
      const movementLocationId = String(movement.locationId || movement.fromLocationId || movement.toLocationId || "");
      return productId === String(product.id) && (!locationId || !movementLocationId || movementLocationId === locationId);
    }).slice(0, 8);
    if (els.stockDetailHistoryCount) els.stockDetailHistoryCount.textContent = `${movements.length} kayıt`;
    els.stockDetailHistoryList.innerHTML = movements.length ? movements.map((movement) => `
      <article class="stock-history-item">
        <span class="stock-history-item__icon" aria-hidden="true">${movementDirectionIcon(movement)}</span>
        <div>
          <strong>${escapeHTML(stockMovementLabel(movement.type))}</strong>
          <small>${escapeHTML(formatDateTimeShort(movement.createdAt))} · ${escapeHTML(safeText(movement.actor || movement.actorName || movement.personName, "Personel"))}</small>
        </div>
        <div class="stock-history-item__actions">
          <b>${escapeHTML(formatMovementQuantity(movement))}</b>
          ${canReversePersonnelMovement(movement) ? `<button type="button" data-stock-reverse-movement="${escapeAttribute(movement.id)}">Geri al</button>` : ""}
        </div>
      </article>
    `).join("") : '<p class="stock-history-empty">Bu ürün için henüz hareket kaydı bulunmuyor.</p>';
  }

  function canReversePersonnelMovement(movement) {
    if (!canUsePersonnelStockActions() || !movement || !movement.id) return false;
    if (movement.type === "reversal" || movement.reversedMovementId || movement.reversedAt || movement.status === "reversed") return false;
    if (!["waste", "manual_out", "stock_out"].includes(String(movement.type || ""))) return false;
    const actorId = String(movement.personnelId || movement.actorId || "");
    return Boolean(actorId && actorId === String(state.user && state.user.id || ""));
  }

  async function reversePersonnelStockMovement(movementId, button) {
    const id = String(movementId || "");
    if (!id || state.stockReversePendingId) return;
    const movement = stockMovements().find((item) => String(item.id) === id);
    if (!canReversePersonnelMovement(movement)) return;
    if (button && button.dataset.confirmReverse !== "true") {
      button.dataset.confirmReverse = "true";
      button.dataset.defaultLabel = button.textContent || "Geri al";
      button.textContent = "Tekrar tıklayın";
      showStockDetailMessage("Geçmiş hareket silinmeden ters kayıt oluşturmak için düğmeye tekrar tıklayın.", false);
      window.setTimeout(() => {
        if (!button.isConnected || button.dataset.confirmReverse !== "true") return;
        delete button.dataset.confirmReverse;
        button.textContent = button.dataset.defaultLabel || "Geri al";
      }, 4000);
      return;
    }
    if (button) {
      delete button.dataset.confirmReverse;
      button.textContent = button.dataset.defaultLabel || "Geri al";
    }
    const requestId = newStockRequestId("personel-stock-reversal");
    state.stockReversePendingId = id;
    const oldText = button && (button.dataset.defaultLabel || button.textContent);
    if (button) {
      button.disabled = true;
      button.textContent = "Geri alınıyor…";
    }
    try {
      const result = await api(`/api/workforce/stock/movements/${encodeURIComponent(id)}/reverse`, {
        method: "POST",
        headers: stockMutationHeaders(requestId),
        body: JSON.stringify({ requestId, expectedRevision: state.stockRevision, note: "Personel arayüzünden ters kayıt" })
      });
      state.stockRevision = responseRevision(result, state.stockRevision + (result.idempotent ? 0 : 1));
      state.stockLoaded = false;
      state.overviewMovementsLoaded = false;
      await loadStock({ force: true });
      await loadStockDetailHistory({ force: true });
      const refreshed = stockProducts().find((item) => String(item.id) === String(state.detailProductId));
      if (refreshed) openStockDetail(refreshed.id);
      showStockDetailMessage("Ters kayıt oluşturuldu; geçmiş hareket silinmedi.", false);
    } catch (error) {
      showStockDetailMessage(error.message || "Ters kayıt oluşturulamadı.", true);
      throw error;
    } finally {
      state.stockReversePendingId = "";
      if (button && button.isConnected) {
        button.disabled = false;
        button.textContent = oldText || "Geri al";
      }
    }
  }

  function showStockDetailMessage(message, isError = false) {
    if (!els.stockDetailMessage) return;
    els.stockDetailMessage.textContent = String(message || "");
    els.stockDetailMessage.hidden = !message;
    els.stockDetailMessage.classList.toggle("is-success", Boolean(message) && !isError);
  }

  function movementDirectionIcon(movement) {
    return ["manual_in", "stock_in", "receipt_in", "shipment_in", "inbound_shipment", "transfer_in"].includes(String(movement && movement.type || "")) ? "+" : "−";
  }

  function stockMovementLabel(type) {
    const labels = {
      waste: "Sarf",
      consumption: "Sarf",
      manual_out: "Eksiltme",
      adjustment_out: "Eksiltme",
      stock_out: "Stok çıkışı",
      manual_in: "Stok ekleme",
      stock_in: "Stok ekleme",
      receipt_in: "Stok ekleme",
      transfer_in: "Transfer girişi",
      transfer_out: "Transfer çıkışı",
      reversal: "Ters hareket"
    };
    return labels[String(type || "")] || "Stok hareketi";
  }

  function formatMovementQuantity(movement) {
    const quantity = numberValue(movement && (movement.inputQuantity ?? movement.sourceQuantity ?? movement.quantity));
    const unit = safeText(movement && (movement.inputUnit || movement.sourceUnit || movement.baseUnit || movement.unit), "adet");
    return `${movementDirectionIcon(movement)}${formatNumber(quantity)} ${unit}`;
  }

  function prepareStockAction(product) {
    if (!product) return;
    const canMutate = canUsePersonnelStockActions();
    state.stockActionSubmitting = false;
    state.stockAction = canMutate
      ? { type: "manual_out", productId: product.id, requestId: newStockRequestId("personel-stock-out") }
      : null;
    if (els.stockActionPanel) els.stockActionPanel.hidden = !canMutate;
    if (els.stockActionQuantity) {
      els.stockActionQuantity.value = "1";
      els.stockActionQuantity.step = "1";
      els.stockActionQuantity.min = "1";
      els.stockActionQuantity.max = String(Math.max(0, Math.floor(numberValue(product.stockQuantity))));
      els.stockActionQuantity.disabled = !canMutate;
    }
    if (els.stockActionSubmit) {
      els.stockActionSubmit.textContent = "Eksilt";
      els.stockActionSubmit.dataset.defaultLabel = "Eksilt";
      els.stockActionSubmit.disabled = !canMutate || numberValue(product.stockQuantity) < 1;
    }
    if (els.stockDetailClose) els.stockDetailClose.disabled = false;
    if (els.stockActionMessage) {
      els.stockActionMessage.textContent = "";
      els.stockActionMessage.hidden = true;
    }
    syncStockActionState();
  }

  function resetStockActionState() {
    state.stockAction = null;
    state.stockActionSubmitting = false;
    if (els.stockActionForm) els.stockActionForm.reset();
    if (els.stockActionMessage) {
      els.stockActionMessage.textContent = "";
      els.stockActionMessage.hidden = true;
    }
  }

  function syncStockActionState() {
    const product = stockProducts().find((item) => String(item.id) === String(state.stockAction && state.stockAction.productId));
    if (!product || !els.stockActionQuantity) return;
    const quantity = Number(els.stockActionQuantity.value || 0);
    const current = numberValue(product.stockQuantity);
    const valid = Number.isInteger(quantity) && quantity > 0 && quantity <= current;
    if (els.stockActionSubmit) els.stockActionSubmit.disabled = state.stockActionSubmitting || !valid;
    if (!state.stockActionSubmitting) setStockActionMessage(valid ? "" : quantity > numberValue(product.stockQuantity)
      ? "Seçili depoda yeterli stok yok. Daha küçük bir miktar girin."
      : "Miktar 1 veya daha büyük bir tam sayı olmalı.");
  }

  async function submitStockAction(event) {
    event.preventDefault();
    if (!state.stockAction || state.stockActionSubmitting) return;
    const product = stockProducts().find((item) => String(item.id) === String(state.stockAction.productId));
    if (!product || !canUsePersonnelStockActions() || state.stockAction.type !== "manual_out") return;
    const quantity = Number(els.stockActionQuantity && els.stockActionQuantity.value || 0);
    const unit = productBaseUnit(product);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setStockActionMessage("Miktar 1 veya daha büyük bir tam sayı olmalı.");
      return;
    }
    if (quantity > numberValue(product.stockQuantity)) {
      setStockActionMessage("Seçili depoda bu işlem için yeterli stok yok.");
      return;
    }
    const action = { ...state.stockAction };
    setStockActionPending(true);
    try {
      const movement = {
        productId: product.id,
        stockProductId: product.id,
        productCode: String(product.productCode || ""),
        stockProductCode: String(product.productCode || ""),
        locationId: String(state.stock.location && state.stock.location.id || ""),
        type: "manual_out",
        quantity,
        unit,
        reason: "Personel stok eksiltme",
        note: "",
        expectedRevision: state.stockRevision,
        expectedBalanceRevision: Math.max(0, Number(product.balanceRevision || 0)),
        requestId: action.requestId,
        idempotencyKey: action.requestId
      };
      const result = await api("/api/stock/movements", {
        method: "POST",
        headers: stockMutationHeaders(action.requestId),
        body: JSON.stringify({ movement, expectedRevision: state.stockRevision })
      });
      if (result && result.stockState) {
        state.stock = normalizeStock(result.stockState);
        state.stockRevision = responseRevision(result, state.stockRevision + (result.idempotent ? 0 : 1));
      }
      state.stockLoaded = false;
      state.overviewMovementsLoaded = false;
      await loadStock({ force: true });
      const refreshed = stockProducts().find((item) => String(item.id) === String(product.id));
      if (refreshed && els.stockDetailModal && !els.stockDetailModal.hidden) openStockDetail(refreshed.id);
      // Require a new explicit quantity after success; never leave another decrement armed.
      if (els.stockActionQuantity) els.stockActionQuantity.value = "";
      if (els.stockActionSubmit) els.stockActionSubmit.disabled = true;
      const successMessage = result && result.idempotent
        ? "Bu istek daha önce kaydedilmişti; stok ikinci kez düşürülmedi."
        : "Stok eksiltme hareketi kaydedildi.";
      showStockDetailMessage(successMessage, false);
      showStockMessage(successMessage);
    } catch (error) {
      setStockActionMessage(error.message || "Stok işlemi kaydedilemedi.");
      setStockActionPending(false);
    }
  }

  function setStockActionPending(pending) {
    state.stockActionSubmitting = pending;
    [els.stockActionQuantity, els.stockDetailClose].forEach((element) => {
      if (element) element.disabled = pending;
    });
    if (els.stockActionSubmit) {
      els.stockActionSubmit.disabled = pending;
      els.stockActionSubmit.textContent = pending ? "Kaydediliyor…" : els.stockActionSubmit.dataset.defaultLabel || "İşlemi Uygula";
    }
    if (!pending) syncStockActionState();
  }

  function setStockActionMessage(message) {
    if (!els.stockActionMessage) return;
    els.stockActionMessage.textContent = String(message || "");
    els.stockActionMessage.hidden = !message;
  }

  function trapStockModalFocus(event) {
    const modal = els.barcodeScannerModal && !els.barcodeScannerModal.hidden
      ? els.barcodeScannerModal.querySelector(".barcode-scanner-dialog")
      : els.materialLocationModal && !els.materialLocationModal.hidden
      ? els.materialLocationModal
      : isStockImageViewerOpen()
      ? els.stockImageViewer
      : els.stockDetailModal && !els.stockDetailModal.hidden ? els.stockDetailModal : null;
    if (!modal) return false;
    const focusable = Array.from(modal.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.closest("[hidden]"));
    if (!focusable.length) return false;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return true;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
      return true;
    }
    return false;
  }

  async function saveProfile(event) {
    event.preventDefault();
    const selectedFile = els.profilePhotoInput && els.profilePhotoInput.files && els.profilePhotoInput.files[0];
    let avatarUrl = els.profileAvatarUrl ? els.profileAvatarUrl.value.trim() : "";
    try {
      if (selectedFile) {
        const upload = await uploadProfilePhoto(selectedFile);
        avatarUrl = upload && upload.avatarUrl || avatarUrl;
        if (els.profileAvatarUrl) els.profileAvatarUrl.value = avatarUrl;
      }
      const profile = {
        name: els.profileName ? els.profileName.value.trim() : "",
        avatarUrl,
        bio: els.profileBio ? els.profileBio.value.trim() : "",
        appearance: window.MenuSuitePanelTheme.normalizeAppearance(state.appearanceDraft || state.user.appearance)
      };
      const result = await api("/api/recipe/profile", {
        method: "PUT",
        body: JSON.stringify(profile)
      });
      state.user = mergeProfile(result.user || profile);
      state.appearanceDraft = null;
      applyAppearance(state.user.appearance);
      setProfileMessage("Profil kaydedildi.");
      state.pendingProfileAvatar = "";
      if (els.profilePhotoInput) els.profilePhotoInput.value = "";
      renderUser();
      fillProfileForm();
    } catch (error) {
      state.appearanceDraft = null;
      applyAppearance(state.user && state.user.appearance);
      state.pendingProfileAvatar = "";
      renderUser();
      fillProfileForm();
      setProfileMessage(error.message || "Profil kaydedilemedi. Lütfen tekrar deneyin.");
    }
  }

  async function previewProfilePhoto() {
    const file = els.profilePhotoInput && els.profilePhotoInput.files && els.profilePhotoInput.files[0];
    if (!file) return;
    const error = validateProfilePhoto(file);
    if (error) {
      if (els.profilePhotoInput) els.profilePhotoInput.value = "";
      setProfileMessage(error);
      return;
    }
    let previewUrl = "";
    try {
      previewUrl = await fileToProfileDataUrl(file);
    } catch (_error) {
      setProfileMessage("Profil fotoğrafı okunamadı.");
      return;
    }
    state.pendingProfileAvatar = previewUrl;
    renderAvatar(state.user && (state.user.name || state.user.username) || "Personel", previewUrl);
    if (els.sidebarUser) {
      const name = state.user && (state.user.name || state.user.username) || "Personel";
      const role = state.user && (state.user.role || state.user.title) || "Personel";
      els.sidebarUser.innerHTML = `
        <span class="sidebar-user-avatar">${avatarContent(name, previewUrl)}</span>
        <span class="sidebar-user-text"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(role)}</small></span>
      `;
      els.sidebarUser.setAttribute("aria-label", `${name} profil menüsü`);
    }
    if (els.profileMenuAvatar) els.profileMenuAvatar.innerHTML = avatarContent(state.user && (state.user.name || state.user.username) || "Personel", previewUrl);
    setProfileMessage("Fotoğraf seçildi. Kaydetmek için Profili Kaydet'e basın.");
  }

  function fileToProfileDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Profil fotoğrafı okunamadı."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Profil fotoğrafı işlenemedi."));
        image.onload = () => {
          const imageWidth = image.naturalWidth || image.width;
          const imageHeight = image.naturalHeight || image.height;
          const sourceSize = Math.min(imageWidth, imageHeight);
          const canvas = document.createElement("canvas");
          canvas.width = 512;
          canvas.height = 512;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Profil fotoğrafı işlenemedi."));
            return;
          }
          context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--panel-surface").trim() || "white";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(
            image,
            Math.max(0, (imageWidth - sourceSize) / 2),
            Math.max(0, (imageHeight - sourceSize) / 2),
            sourceSize,
            sourceSize,
            0,
            0,
            canvas.width,
            canvas.height
          );
          resolve(canvas.toDataURL("image/jpeg", 0.84));
        };
        image.src = String(reader.result || "");
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadProfilePhoto(file) {
    const error = validateProfilePhoto(file);
    if (error) throw new Error(error);
    return api("/api/recipe/profile/avatar", {
      method: "POST",
      headers: {
        "Content-Type": file.type,
        "X-File-Name": encodeURIComponent(file.name)
      },
      body: file
    });
  }

  function validateProfilePhoto(file) {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) return "JPG, PNG veya WEBP profil fotoğrafı seçin.";
    if (file.size > 10 * 1024 * 1024) return "Profil fotoğrafı en fazla 10 MB olabilir.";
    return "";
  }

  function mergeProfile(user) {
    return Object.assign({ name: "Personel", username: "personel" }, user || {});
  }

  function renderUser() {
    const user = state.user || {};
    const name = user.name || user.username || "Personel";
    const role = user.role || user.title || "Personel";
    if (els.sidebarUser) {
      els.sidebarUser.innerHTML = `
        <span class="sidebar-user-avatar">${avatarContent(name, user.avatarUrl)}</span>
        <span class="sidebar-user-text"><strong>${escapeHTML(name)}</strong><small>${escapeHTML(role)}</small></span>
      `;
      els.sidebarUser.setAttribute("aria-label", `${name} profil menüsü`);
    }
    if (els.profileMenuAvatar) els.profileMenuAvatar.innerHTML = avatarContent(name, user.avatarUrl);
    if (els.profileMenuName) els.profileMenuName.textContent = name;
    if (els.profileMenuRole) els.profileMenuRole.textContent = role;
    setProfileMenuMessage("");
    renderAvatar(name, user.avatarUrl);
  }

  function fillProfileForm() {
    const user = state.user || {};
    if (els.profileName) els.profileName.value = user.name || "";
    if (els.profileAvatarUrl) els.profileAvatarUrl.value = user.avatarUrl || "";
    if (els.profileBio) els.profileBio.value = user.bio || "";
    renderAvatar(user.name || user.username || "Personel", user.avatarUrl);
    renderAppearance();
  }

  function renderAppearance() {
    if (!els.profileAppearance) return;
    const theme = window.MenuSuitePanelTheme;
    const appearance = theme.normalizeAppearance(state.appearanceDraft || state.user && state.user.appearance);
    els.profileAppearance.innerHTML = `
      <h4>Görünüm Modu</h4><div class="appearance-mode-picker" role="group" aria-label="Görünüm modu">
        ${[ ["light", "☀ Aydınlık"], ["dark", "☾ Karanlık"] ].map(([mode, label]) => `<button type="button" data-appearance-mode="${mode}" aria-pressed="${appearance.mode === mode}">${label}</button>`).join("")}
      </div><h4>Hazır Renk Temaları</h4><div class="appearance-preset-grid">
        ${theme.PRESETS.map((preset) => `<button type="button" class="appearance-preset-card" data-appearance-preset="${preset.id}" aria-pressed="${appearance.presetId === preset.id}"><span class="appearance-swatches" aria-hidden="true">${preset.swatches.map((color) => `<i style="background:${color}"></i>`).join("")}</span><strong>${escapeHTML(preset.name)}</strong><small>${appearance.mode === "dark" ? "Karanlık" : "Aydınlık"}</small></button>`).join("")}
      </div>`;
  }

  function applyAppearance(value) {
    const theme = window.MenuSuitePanelTheme;
    if (!theme) return;
    const appearance = theme.normalizeAppearance(value);
    theme.apply(appearance.presetId, appearance.mode);
    (window.BrandIdentity)?.apply(activeBrand, { logoSelector: ".login-logo, .brand-block img", appId: "personel", kind: "personel", fallbackName: "Personel" });
    sendRecipeAppearance(appearance);
  }

  function sendRecipeAppearance(value) {
    const appearance = window.MenuSuitePanelTheme.normalizeAppearance(value || state.appearanceDraft || state.user && state.user.appearance);
    els.recipeFrame?.contentWindow?.postMessage({ type: "panel:appearance", appearance, brand: activeBrand }, window.location.origin);
  }

  function renderAvatar(name, avatarUrl) {
    if (!els.profileAvatar) return;
    els.profileAvatar.innerHTML = avatarContent(name, avatarUrl);
  }

  function avatarContent(name, avatarUrl) {
    if (avatarUrl) return `<img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(name)}">`;
    return escapeHTML(String(name || "P").trim().slice(0, 1).toUpperCase() || "P");
  }

  function setLoginMessage(message) {
    if (els.loginMessage) els.loginMessage.textContent = message;
  }

  function setProfileMessage(message) {
    if (!els.profileMessage) return;
    els.profileMessage.textContent = message;
    setTimeout(() => { if (els.profileMessage) els.profileMessage.textContent = ""; }, 2200);
  }

  function personelShellContext() {
    return Object.freeze({
      active: state.sessionActive,
      preview: state.sessionPreview,
      userId: String(state.user && state.user.id || ""),
      section: state.section,
      brandName: activeBrandName
    });
  }

  function navigatePersonelSection(section) {
    setSection(section, { updateHash: false });
    return state.section;
  }

  function loadLazyStyle(key, href) {
    const resourceKey = `style:${key}`;
    if (lazyResources.has(resourceKey)) return lazyResources.get(resourceKey);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`link[data-personel-lazy-style="${key}"]`);
      if (isLoadedStyleSheet(existing)) return resolve(existing);
      if (existing) existing.remove();
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.personelLazyStyle = key;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error) { link.remove(); reject(error); }
        else resolve(link);
      };
      const timer = window.setTimeout(() => finish(new Error("Bildirim stili zamanında yüklenemedi.")), LAZY_RESOURCE_TIMEOUT_MS);
      link.addEventListener("load", () => finish(isLoadedStyleSheet(link) ? null : new Error("Bildirim stili hazır değil.")), { once: true });
      link.addEventListener("error", () => finish(new Error("Bildirim stili yüklenemedi.")), { once: true });
      document.head.append(link);
    }).catch((error) => {
      lazyResources.delete(resourceKey);
      throw error;
    });
    lazyResources.set(resourceKey, promise);
    return promise;
  }

  function isLoadedStyleSheet(link) {
    if (!link) return false;
    if (link.dataset.loaded === "true") return true;
    if (link.sheet) {
      // cssRules, CSP veya tarayıcı izolasyonu nedeniyle okunamasa da sheet'in
      // bağlanmış olması stilin kullanılabilir olduğuna yeterli kanıttır.
      link.dataset.loaded = "true";
      return true;
    }
    try {
      const absolute = new URL(link.href, window.location.href).href;
      const loaded = performance.getEntriesByName(absolute).some((entry) => Number(entry.responseEnd || 0) > 0);
      if (loaded) link.dataset.loaded = "true";
      return loaded;
    } catch (_error) {
      return false;
    }
  }

  function loadLazyScript(key, source) {
    const resourceKey = `script:${key}`;
    if (lazyResources.has(resourceKey)) return lazyResources.get(resourceKey);
    const promise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-personel-lazy-script="${key}"]`);
      if (existing && existing.dataset.loaded === "true") return resolve(existing);
      if (existing) existing.remove();
      const script = document.createElement("script");
      script.src = source;
      script.defer = true;
      script.dataset.personelLazyScript = key;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (error) { script.remove(); reject(error); }
        else { script.dataset.loaded = "true"; resolve(script); }
      };
      const timer = window.setTimeout(() => finish(new Error("Bildirim modülü zamanında yüklenemedi.")), LAZY_RESOURCE_TIMEOUT_MS);
      script.addEventListener("load", () => finish(null), { once: true });
      script.addEventListener("error", () => finish(new Error("Bildirim modülü yüklenemedi.")), { once: true });
      document.head.append(script);
    }).catch((error) => {
      lazyResources.delete(resourceKey);
      throw error;
    });
    lazyResources.set(resourceKey, promise);
    return promise;
  }

  async function ensureWorkforceModule() {
    if (window.__MENU_SUITE_PERSONEL_WORKFORCE_MOUNTED__) return true;
    await loadLazyScript("workforce", "/personel/workforce.js?v=20261004-shipment-receipt-v3&batch=20261008-v1&approved=20261008-v2&tasks=20261008-v2&fixes=20261011-v2");
    if (state.sessionActive) {
      document.dispatchEvent(new CustomEvent("personel:session-started", {
        detail: { userId: state.user && state.user.id, preview: state.sessionPreview, replay: true }
      }));
      document.dispatchEvent(new CustomEvent("personel:section-change", {
        detail: { section: state.section, replay: true }
      }));
    }
    return true;
  }

  function ensureNotificationsModule() {
    const style = document.querySelector('link[data-personel-lazy-style="notifications"]');
    if (window.MenuSuitePersonelNotifications && isLoadedStyleSheet(style)) return Promise.resolve(window.MenuSuitePersonelNotifications);
    if (notificationsModulePromise) return notificationsModulePromise;
    notificationsModulePromise = (async () => {
      // Do not mount the drawer script against a missing stylesheet: it would
      // overwrite the shell's visible load error with a false empty state.
      await loadLazyStyle("notifications", "/personel/notifications.css?v=20261004-simple-modal-v3");
      if (!window.MenuSuitePersonelNotifications) {
        await loadLazyScript("notifications", "/personel/notifications.js?v=20261004-simple-modal-v3&fixes=20261011-v2");
      }
      const module = window.MenuSuitePersonelNotifications;
      if (!module || typeof module.open !== "function") {
        lazyResources.delete("script:notifications");
        document.querySelector('script[data-personel-lazy-script="notifications"]')?.remove();
        throw new Error("Bildirim modülü hazır değil. Yeniden deneyin.");
      }
      const preferencesForm = document.getElementById("personelNotificationPreferencesForm");
      if (preferencesForm) preferencesForm.dataset.moduleReady = "true";
      if (state.sessionActive) document.dispatchEvent(new CustomEvent("personel:session-started", {
        detail: { userId: state.user && state.user.id, preview: state.sessionPreview, replay: true }
      }));
      return module;
    })().finally(() => { notificationsModulePromise = null; });
    return notificationsModulePromise;
  }

  async function openNotificationsFromShell() {
    if (notificationLoadWanted && els.personelNotificationTrigger?.getAttribute("aria-busy") === "true") return;
    notificationLoadWanted = true;
    const drawer = els.personelNotificationDrawer;
    if (drawer && !window.MenuSuitePersonelNotifications) {
      drawer.hidden = false;
      if (els.personelNotificationBackdrop) els.personelNotificationBackdrop.hidden = false;
      document.body.classList.add("is-personel-notification-open");
      els.personelNotificationTrigger?.setAttribute("aria-expanded", "true");
      renderNotificationModuleState("loading");
    }
    els.personelNotificationTrigger?.setAttribute("aria-busy", "true");
    try {
      const module = await ensureNotificationsModule();
      if (notificationLoadWanted && state.sessionActive) await module.open();
    } catch (error) {
      if (notificationLoadWanted) renderNotificationModuleState("error", error.message);
    } finally {
      els.personelNotificationTrigger?.removeAttribute("aria-busy");
      notificationLoadWanted = false;
    }
  }

  function renderNotificationModuleState(kind, message) {
    const list = els.personelNotificationList;
    if (!list) return;
    list.replaceChildren();
    const node = document.createElement("div");
    node.className = "personel-notification-loading";
    const title = document.createElement("strong");
    title.textContent = kind === "error" ? "Bildirimler yüklenemedi" : "Bildirimler yükleniyor";
    const detail = document.createElement("span");
    detail.textContent = kind === "error" ? message || "Bağlantıyı kontrol edip yeniden deneyin." : "Bildirim merkezi hazırlanıyor.";
    node.append(title, detail);
    if (kind === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ui-button ui-button--secondary ui-button--sm";
      retry.dataset.notificationModuleRetry = "true";
      retry.textContent = "Yeniden dene";
      node.append(retry);
    }
    list.append(node);
    list.setAttribute("aria-busy", kind === "loading" ? "true" : "false");
  }

  function closeNotificationModuleShell() {
    notificationLoadWanted = false;
    if (els.personelNotificationDrawer) els.personelNotificationDrawer.hidden = true;
    if (els.personelNotificationBackdrop) els.personelNotificationBackdrop.hidden = true;
    els.personelNotificationTrigger?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("is-personel-notification-open");
  }

  async function ensureAccountSecurityModule() {
    if (window.MenuSuiteAccountSecurity) return window.MenuSuiteAccountSecurity;
    await Promise.all([
      loadLazyStyle("account-security", "/shared/styles/account-security.css?v=20260831-personal-email"),
      loadLazyScript("account-security", "/shared/scripts/account-security.js?v=20260831-personal-email")
    ]);
    const securityCard = document.querySelector('[data-account-security][data-account-scope="personel"]');
    if (securityCard) securityCard.dataset.moduleReady = "true";
    if (state.sessionActive) {
      document.dispatchEvent(new CustomEvent("personel:session-started", {
        detail: { userId: state.user && state.user.id, preview: state.sessionPreview, replay: true }
      }));
    }
    return window.MenuSuiteAccountSecurity;
  }

  function renderNotificationUnreadBadge(value) {
    const count = Math.max(0, Number(value || 0));
    if (els.personelNotificationBadge) {
      els.personelNotificationBadge.textContent = count > 99 ? "99+" : String(count);
      els.personelNotificationBadge.hidden = count < 1;
      els.personelNotificationBadge.setAttribute("aria-label", `${count} okunmamış bildirim`);
    }
    if (els.personelNotificationUnreadText) {
      els.personelNotificationUnreadText.textContent = count ? `${count} okunmamış` : "Yeni bildirim yok";
    }
  }

  function loadNotificationUnreadBadge(options = {}) {
    if (state.sessionPreview || !state.sessionActive) return Promise.resolve(0);
    if (!options.force && state.notificationUnreadLoaded && Date.now() - state.notificationUnreadLoadedAt < 30000) {
      return Promise.resolve(state.notificationUnreadCount);
    }
    if (state.notificationBadgePromise) return state.notificationBadgePromise;
    const promise = api("/api/notifications/unread-count")
      .then((result) => {
        state.notificationUnreadCount = Math.max(0, Number(result.unreadCount ?? result.count ?? 0));
        state.notificationUnreadLoaded = true;
        state.notificationUnreadLoadedAt = Date.now();
        renderNotificationUnreadBadge(state.notificationUnreadCount);
        return state.notificationUnreadCount;
      })
      .catch(() => state.notificationUnreadCount)
      .finally(() => {
        if (state.notificationBadgePromise === promise) state.notificationBadgePromise = null;
      });
    state.notificationBadgePromise = promise;
    return promise;
  }

  function readPersonelData(path) {
    const key = String(path || "");
    if (state.readPromises.has(key)) return state.readPromises.get(key);
    const promise = api(key, { method: "GET" }).finally(() => {
      if (state.readPromises.get(key) === promise) state.readPromises.delete(key);
    });
    state.readPromises.set(key, promise);
    return promise;
  }

  async function api(path, options) {
    const method = String(options && options.method || "GET").toUpperCase();
    if (PREVIEW_TOKEN && method !== "GET") throw new Error("Önizleme modu salt okunurdur.");
    const headers = Object.assign({
      "Content-Type": "application/json",
      "X-Menu-Suite-App-Id": "personel",
      "X-Menu-Suite-App-Target": "personel"
    }, options && options.headers || {});
    const target = PREVIEW_TOKEN && isPreviewReadPath(path) ? appendPreviewToken(path) : path;
    const response = await fetch(target, Object.assign({}, options || {}, {
      credentials: "include",
      headers
    }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İstek başarısız.");
      error.status = response.status;
      error.code = result.code || "";
      if ((response.status === 401 || (response.status === 403 && error.code !== "PERSONEL_SECTION_FORBIDDEN")) && state.sessionActive) {
        document.dispatchEvent(new CustomEvent("personel:session-ended", {
          detail: { source: "personel-shell", status: response.status, message: error.message }
        }));
      }
      throw error;
    }
    return result;
  }

  function readPreviewToken() {
    try {
      return new URLSearchParams(window.location.search).get("previewToken") || "";
    } catch (_error) {
      return "";
    }
  }

  function readPreviewSection() {
    try {
      const section = new URLSearchParams(window.location.search).get("section") || "";
      const resolved = LEGACY_SECTION_REDIRECTS[section] || section;
      return PERSONEL_SECTION_KEYS.includes(resolved) || resolved === "profile" ? resolved : "";
    } catch (_error) {
      return "";
    }
  }

  function appendPreviewToken(path) {
    if (!PREVIEW_TOKEN) return path;
    const url = new URL(path, window.location.origin);
    url.searchParams.set("previewToken", PREVIEW_TOKEN);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function isPreviewReadPath(path) {
    return ["/api/recipe/me", "/api/stock", "/api/workforce/me", "/api/workforce/stock"].some((prefix) => String(path || "").startsWith(prefix));
  }

  function emptyStockState() {
    return {
      location: null,
      locations: [],
      locationBalances: [],
      balances: [],
      categories: [],
      products: [],
      movements: [],
      transfers: [],
      summary: {},
      revision: 0,
      updatedAt: null
    };
  }

  function normalizeStock(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const legacyState = source.stockState && typeof source.stockState === "object" ? source.stockState : {};
    const balances = Array.isArray(source.balances) ? source.balances : Array.isArray(legacyState.balances) ? legacyState.balances : [];
    const publicBalances = balances.map((balance) => {
      if (!balance || typeof balance !== "object") return balance;
      const { generalQuantity: _generalQuantity, otherLocationQuantity: _otherLocationQuantity, suggestedTransfer: _suggestedTransfer, ...publicBalance } = balance;
      return publicBalance;
    });
    const locationBalances = Array.isArray(source.locationBalances)
      ? source.locationBalances.filter((balance) => balance && typeof balance === "object")
      : [];
    const accessibleTotals = locationBalances.reduce((totals, balance) => {
      const productId = String(balance.productId || "");
      if (productId) totals.set(productId, numberValue(totals.get(productId)) + numberValue(balance.quantity));
      return totals;
    }, new Map());
    const productSource = Array.isArray(source.products)
      ? source.products
      : balances.map((balance) => balance && balance.product).filter(Boolean).length
        ? balances.map((balance) => balance && balance.product).filter(Boolean)
        : Array.isArray(legacyState.products) ? legacyState.products : [];
    const balanceMap = new Map(balances.map((balance) => [String(balance && balance.productId || balance && balance.product && balance.product.id || ""), balance || {}]));
    const seenProducts = new Set();
    const products = productSource.reduce((result, product) => {
      const id = String(product && product.id || "");
      if (!id || seenProducts.has(id)) return result;
      seenProducts.add(id);
      const balance = balanceMap.get(id) || {};
      const recommendation = balance.recommendation && typeof balance.recommendation === "object"
        ? balance.recommendation
        : product.recommendation && typeof product.recommendation === "object" ? product.recommendation : null;
      result.push({
        ...product,
        stockQuantity: numberValue(balance.quantity ?? product.stockQuantity),
        criticalThreshold: numberValue(balance.criticalThreshold ?? product.criticalThreshold),
        orderThreshold: numberValue(balance.orderThreshold ?? product.orderThreshold),
        targetLevel: numberValue(balance.targetLevel ?? product.targetLevel),
        totalQuantity: numberValue(balance.totalQuantity ?? product.totalQuantity ?? product.stockQuantity),
        quantityDisplay: quantityDisplayText(balance.quantityDisplay || product.quantityDisplay),
        recommendation,
        transferAvailable: recommendation && recommendation.type === "transfer"
          || numberValue(balance.suggestedTransfer ?? product.suggestedTransfer) > 0,
        balanceRevision: Math.max(0, Number(balance.revision || 0)),
        locationStatus: String(balance.status || product.locationStatus || ""),
        balanceUpdatedAt: balance.updatedAt || product.updatedAt || null,
        accessibleQuantity: accessibleTotals.has(id) ? numberValue(accessibleTotals.get(id)) : numberValue(balance.quantity ?? product.stockQuantity)
      });
      return result;
    }, []);
    const categorySource = Array.isArray(source.categories)
      ? source.categories
      : Array.isArray(legacyState.categories) ? legacyState.categories : [];
    const categories = categorySource.length ? categorySource : Array.from(products.reduce((map, product) => {
      const id = String(product.categoryId || product.category || "stock-category-general");
      if (!map.has(id)) map.set(id, { id, name: String(product.category || "Genel"), active: true, order: map.size });
      return map;
    }, new Map()).values());
    return {
      location: source.location && typeof source.location === "object" ? source.location : null,
      locations: Array.isArray(source.locations) ? source.locations.filter((location) => location && typeof location === "object") : [],
      locationBalances,
      balances: publicBalances,
      categories,
      products,
      movements: Array.isArray(source.movements) ? source.movements : Array.isArray(legacyState.movements) ? legacyState.movements : [],
      transfers: Array.isArray(source.transfers) ? source.transfers : Array.isArray(source.requests) ? source.requests : [],
      summary: source.summary && typeof source.summary === "object" ? source.summary : {},
      revision: responseRevision(source, 0),
      updatedAt: source.updatedAt || source.summary && source.summary.lastUpdatedAt || null
    };
  }

  function filteredProducts() {
    const query = normalizeText(state.query);
    const categories = new Map(stockCategories().map((category) => [String(category.id), category.name]));
    return stockProducts().filter((product) => {
      if (state.category === "critical" && !isCriticalProduct(product)) return false;
      if (state.category !== "all" && state.category !== "critical" && product.categoryId !== state.category) return false;
      if (!query) return true;
      return normalizeText(`${product.name} ${product.productCode || ""} ${product.barcode || ""} ${product.supplier || ""} ${categories.get(String(product.categoryId)) || product.category || ""}`).includes(query);
    }).sort((left, right) => {
      if (!query) return Number(left.order || 0) - Number(right.order || 0);
      const leftStarts = stockSearchFields(left, categories).some((field) => field.startsWith(query)) ? 0 : 1;
      const rightStarts = stockSearchFields(right, categories).some((field) => field.startsWith(query)) ? 0 : 1;
      return leftStarts - rightStarts
        || normalizeText(left.name).localeCompare(normalizeText(right.name), "tr");
    });
  }

  function stockSearchFields(product, categories) {
    return [
      product && product.name,
      product && product.productCode,
      product && product.barcode,
      product && product.supplier,
      categories && categories.get(String(product && product.categoryId)) || product && product.category
    ].map(normalizeText).filter(Boolean);
  }

  function stockCategories() {
    return state.stock.categories.slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockProducts() {
    return state.stock.products
      .filter((product) => product.active !== false)
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function stockMovements() {
    return state.stock.movements.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function stockTransfers() {
    return (Array.isArray(state.stock.transfers) ? state.stock.transfers : [])
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }

  function pendingTransferCount() {
    return stockTransfers().filter((transfer) => String(transfer.status || "pending") === "pending").length;
  }

  function stockStatus(product) {
    const source = normalizeText(product && product.locationStatus);
    if (source.includes("tukendi")) return { key: "empty", label: "Tükendi" };
    if (source.includes("kritik")) return { key: "critical", label: "Kritik" };
    const current = numberValue(product.stockQuantity);
    const critical = numberValue(product.criticalThreshold);
    if (current <= 0) return { key: "empty", label: "Tükendi" };
    if (critical > 0 && current <= critical) return { key: "critical", label: "Kritik" };
    return { key: "ok", label: "Yeterli" };
  }

  function stockRecommendation(product) {
    const recommendation = product && product.recommendation;
    if (recommendation && recommendation.type === "transfer" || product && product.transferAvailable) {
      return { key: "available", label: "Transfer uygun" };
    }
    if (recommendation && recommendation.type === "purchase") {
      return { key: "purchase", label: "Satın alma gerekli" };
    }
    return { key: "unavailable", label: "Transfer gerekmiyor" };
  }

  function numberValue(value) {
    if (value && typeof value === "object") {
      const nested = value.quantity ?? value.value ?? value.amount ?? value.baseQuantity ?? value.total;
      if (nested !== undefined && nested !== value) return numberValue(nested);
    }
    const parsed = Number(String(value ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function safeText(value, fallback = "") {
    if (value && typeof value === "object") {
      const nested = value.label ?? value.name ?? value.unit ?? value.code ?? value.display ?? value.value;
      return nested === undefined || nested === null ? fallback : String(nested).trim() || fallback;
    }
    return value === undefined || value === null ? fallback : String(value).trim() || fallback;
  }

  function quantityDisplayText(value) {
    return safeText(value && typeof value === "object" ? value.display ?? value.label ?? "" : value, "");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(numberValue(value));
  }

  function currentStockLabel(product) {
    const baseQuantity = numberValue(product && product.stockQuantity);
    const baseUnit = productBaseUnit(product);
    return `${formatNumber(baseQuantity)} ${baseUnit}`;
  }

  function stockDisplay(product) {
    const baseQuantity = numberValue(product && product.stockQuantity);
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const factor = productUnitsPerBulk(product);
    if (bulkUnit && bulkUnit !== baseUnit && factor > 0 && baseQuantity >= factor && Math.abs(baseQuantity % factor) < 0.000001) {
      return { value: baseQuantity / factor, unit: bulkUnit };
    }
    return { value: baseQuantity, unit: baseUnit };
  }

  function transferStatus(value) {
    const status = String(value || "pending");
    if (status === "approved") return { key: "approved", label: "Onaylandı" };
    if (status === "rejected") return { key: "rejected", label: "Reddedildi" };
    if (status === "cancelled") return { key: "cancelled", label: "İptal edildi" };
    return { key: "pending", label: "Onay bekliyor" };
  }

  function urgencyLabel(value) {
    if (value === "urgent") return "Acil";
    if (value === "high") return "Yüksek";
    return "Normal";
  }

  function formatStockUpdatedAt(value) {
    if (!value) return "Henüz yok";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Henüz yok";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDateTimeShort(value) {
    if (!value) return "Tarih yok";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Tarih yok";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function stockLocationIcon() {
    return `<svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/></svg>`;
  }

  function stockSupportedUnits(product) {
    const baseUnit = productBaseUnit(product);
    const bulkUnit = productBulkUnit(product);
    const units = [baseUnit];
    if (bulkUnit && bulkUnit !== baseUnit && productUnitsPerBulk(product) > 0) units.push(bulkUnit);
    return Array.from(new Set(units));
  }

  function productAllowsDecimal(product) {
    if (typeof (product && product.allowDecimal) === "boolean") return product.allowDecimal;
    return ["kg", "gr", "litre", "ml"].includes(productBaseUnit(product));
  }

  function productBaseUnit(product) {
    return safeText(product && (product.baseUnit || product.unit), "adet").toLocaleLowerCase("tr-TR");
  }

  function productBulkUnit(product) {
    return safeText(product && (product.bulkUnit || product.caseUnit), "").toLocaleLowerCase("tr-TR");
  }

  function productUnitsPerBulk(product) {
    return numberValue(product && (product.unitsPerBulkUnit ?? product.unitsPerCase ?? product.packageSize ?? product.packSize ?? product.piecesPerBox ?? product.koliIci));
  }

  function stockQuantityToBase(product, quantity, unit) {
    const normalizedUnit = String(unit || productBaseUnit(product)).trim().toLocaleLowerCase("tr-TR");
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) return NaN;
    if (normalizedUnit === productBaseUnit(product)) return amount;
    if (normalizedUnit === productBulkUnit(product)) {
      const factor = productUnitsPerBulk(product);
      return factor > 0 ? amount * factor : NaN;
    }
    if (productBaseUnit(product) === "gr" && normalizedUnit === "kg") return amount * 1000;
    if (productBaseUnit(product) === "kg" && normalizedUnit === "gr") return amount / 1000;
    if (productBaseUnit(product) === "ml" && ["litre", "lt", "l"].includes(normalizedUnit)) return amount * 1000;
    if (["litre", "lt", "l"].includes(productBaseUnit(product)) && normalizedUnit === "ml") return amount / 1000;
    return NaN;
  }

  function newStockRequestId(prefix) {
    const value = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function stockMutationHeaders(requestId) {
    return { "Idempotency-Key": requestId, "X-Request-ID": requestId };
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/İ/g, "I")
      .toLowerCase();
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
})();
