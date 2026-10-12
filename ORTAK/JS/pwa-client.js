(function initialiseMenuSuitePwaClient() {
  "use strict";
  if (document.documentElement.dataset.pwaApp === "personel") return;

  const root = document.documentElement;
  const appId = String(root.dataset.pwaApp || "").trim();
  const workerUrl = String(root.dataset.pwaWorker || "").trim();
  const workerScope = String(root.dataset.pwaScope || "").trim();
  const isBackOffice = appId === "yonetici";
  const updateCheckKey = `menu-suite:pwa-update-check:${appId}`;
  const installDismissKey = `menu-suite:pwa-install-dismissed:${appId}:v1`;
  const notificationIntroKey = `menu-suite:pwa-notification-intro:${appId}:v1`;
  const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
  const installSnoozeMs = 30 * 24 * 60 * 60 * 1000;
  const dirtyForms = new WeakSet();
  let waitingWorker = null;
  let controllerChangeHandled = false;
  let updateRequested = false;
  let previouslyFocused = null;
  let updateNotice = null;
  let offlineNotice = null;
  let installNotice = null;
  let notificationIntroNotice = null;
  let notificationPromptConfig = null;
  let notificationPromptCheckPending = false;
  let deferredInstallPrompt = null;

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  document.addEventListener("menu-suite:admin-session-started", scheduleNotificationIntro);
  document.addEventListener("menu-suite:admin-session-ended", dismissNotificationIntro);

  document.addEventListener("DOMContentLoaded", () => {
    bindConnectivityState();
    bindDirtyFormTracking();
    if (deferredInstallPrompt) showInstallReady();
    void registerServiceWorker();
  });

  window.MenuSuitePWA = Object.freeze({
    checkForUpdate: () => navigator.serviceWorker && navigator.serviceWorker.getRegistration(workerScope).then((registration) => registration && registration.update()),
    canInstall: () => Boolean(deferredInstallPrompt && !isStandalone()),
    promptInstall: requestInstall,
    registerNotificationPrompt(config) {
      if (!isBackOffice || !config || typeof config.onEnable !== "function") return false;
      notificationPromptConfig = config;
      scheduleNotificationIntro();
      return true;
    },
    showNotificationPrompt: scheduleNotificationIntro,
    hasUnsavedChanges,
    markFormClean(form) {
      if (form instanceof HTMLFormElement) dirtyForms.delete(form);
    }
  });

  function handleBeforeInstallPrompt(event) {
    event.preventDefault();
    if (isStandalone()) return;
    deferredInstallPrompt = event;
    if (document.body) showInstallReady();
  }

  function showInstallReady() {
    if (!deferredInstallPrompt || installNotice || isStandalone() || hasActiveInstallSnooze()) return;
    installNotice = createNotice({
      kind: "install",
      title: "Uygulama olarak yükleyin",
      message: `${currentBrandName()} uygulamasını ana ekranınızdan hızlı ve güvenli biçimde açabilirsiniz.`,
      actionLabel: "Uygulamayı Yükle",
      onAction: requestInstall,
      dismissible: true
    });
  }

  function currentBrandName() {
    const explicit = String(document.documentElement.dataset.brandName || "").trim();
    if (explicit) return explicit;
    return isBackOffice ? "Yönetici paneli" : "Dijital menü";
  }

  function requestInstall(button) {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent || isStandalone()) return Promise.resolve(false);
    if (button) {
      button.disabled = true;
      button.textContent = "Yükleme açılıyor…";
    }

    // prompt() doğrudan tıklama çağrı zincirinde çalışır; izin diyaloğu otomatik başlatılmaz.
    const promptResult = promptEvent.prompt();
    return Promise.resolve(promptResult)
      .then(() => promptEvent.userChoice)
      .then((choice) => {
        const accepted = Boolean(choice && choice.outcome === "accepted");
        deferredInstallPrompt = null;
        if (!accepted) snoozeInstallPrompt("prompt-dismissed");
        if (installNotice) installNotice.remove();
        installNotice = null;
        return accepted;
      })
      .catch(() => {
        if (button) {
          button.disabled = false;
          button.textContent = "Uygulamayı Yükle";
        }
        return false;
      });
  }

  function handleAppInstalled() {
    deferredInstallPrompt = null;
    if (installNotice) installNotice.remove();
    installNotice = null;
  }

  function hasActiveInstallSnooze() {
    try {
      const rawValue = window.localStorage.getItem(installDismissKey);
      if (!rawValue) return false;
      const record = JSON.parse(rawValue);
      if (Number(record && record.nextEligibleAt || 0) > Date.now()) return true;
      window.localStorage.removeItem(installDismissKey);
    } catch (_error) {
      try { window.localStorage.removeItem(installDismissKey); } catch (_storageError) {}
    }
    return false;
  }

  function snoozeInstallPrompt(reason) {
    try {
      const dismissedAt = Date.now();
      window.localStorage.setItem(installDismissKey, JSON.stringify({
        dismissedAt,
        nextEligibleAt: dismissedAt + installSnoozeMs,
        reason: String(reason || "dismissed")
      }));
    } catch (_error) {}
  }

  function scheduleNotificationIntro() {
    if (notificationPromptCheckPending) return;
    notificationPromptCheckPending = true;
    window.setTimeout(() => {
      notificationPromptCheckPending = false;
      void showNotificationIntroIfEligible();
    }, 250);
  }

  async function showNotificationIntroIfEligible() {
    if (!document.body || notificationIntroNotice || !notificationPromptConfig || !isBackOffice || !isStandalone()) return;
    if (!("Notification" in window) || window.Notification.permission !== "default") return;
    try {
      if (window.localStorage.getItem(notificationIntroKey)) return;
    } catch (_error) {}
    if (typeof notificationPromptConfig.canShow === "function"
      && !(await Promise.resolve(notificationPromptConfig.canShow()).catch(() => false))) return;

    notificationIntroNotice = createNotice({
      kind: "push-intro",
      title: "Telefon bildirimleri",
      message: "Yönetici bildirimlerini telefonundan al.",
      actionLabel: "Bildirimleri Aç",
      onAction: enableNotificationsFromIntro,
      secondaryActionLabel: "Şimdi Değil",
      onSecondaryAction: postponeNotificationIntro,
      dismissible: false
    });
    focusNoticeAction(notificationIntroNotice);
  }

  async function enableNotificationsFromIntro(button) {
    if (!notificationPromptConfig || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Açılıyor…";
    try {
      const enabled = await notificationPromptConfig.onEnable();
      if (enabled === false) throw new Error("Bildirim izni etkinleştirilemedi.");
      rememberNotificationIntroChoice("enabled");
      dismissNotificationIntro();
    } catch (error) {
      if ("Notification" in window && window.Notification.permission === "denied") {
        rememberNotificationIntroChoice("denied");
        dismissNotificationIntro();
        return;
      }
      button.disabled = false;
      button.textContent = original;
      const message = notificationIntroNotice && notificationIntroNotice.querySelector(".pwa-notice__copy span");
      if (message) message.textContent = error && error.message || "Bildirim izni etkinleştirilemedi. Ayarlardan yeniden deneyebilirsiniz.";
    }
  }

  function postponeNotificationIntro() {
    rememberNotificationIntroChoice("later");
    dismissNotificationIntro();
  }

  function rememberNotificationIntroChoice(value) {
    try { window.localStorage.setItem(notificationIntroKey, String(value || "seen")); } catch (_error) {}
  }

  function dismissNotificationIntro() {
    if (notificationIntroNotice) notificationIntroNotice.remove();
    notificationIntroNotice = null;
  }

  function isStandalone() {
    return Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true;
  }

  async function registerServiceWorker() {
    if (!appId || !workerUrl || !workerScope || !("serviceWorker" in navigator) || !isSafeRegistrationOrigin()) return;
    const hadController = Boolean(navigator.serviceWorker.controller);

    try {
      const registration = await navigator.serviceWorker.register(workerUrl, {
        scope: workerScope,
        updateViaCache: "none"
      });

      watchRegistration(registration, hadController);
      navigator.serviceWorker.addEventListener("controllerchange", () => handleControllerChange(hadController));
      scheduleAutomaticUpdateCheck(registration);
    } catch (error) {
      console.warn("PWA çevrimdışı desteği başlatılamadı; web uygulaması normal çalışmaya devam ediyor.", error);
    }
  }

  function scheduleAutomaticUpdateCheck(registration) {
    let lastCheckedAt = 0;
    try { lastCheckedAt = Number(window.localStorage.getItem(updateCheckKey) || 0); } catch (_error) {}
    if (Date.now() - lastCheckedAt < updateCheckIntervalMs) return;
    const check = () => {
      try { window.localStorage.setItem(updateCheckKey, String(Date.now())); } catch (_error) {}
      registration.update().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(check, { timeout: 15000 });
    } else {
      window.setTimeout(check, 15000);
    }
  }

  function watchRegistration(registration, hadController) {
    if (registration.waiting && hadController) void showUpdateReady(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          void showUpdateReady(registration.waiting || installing);
        }
      });
    });
  }

  async function showUpdateReady(worker) {
    waitingWorker = worker;
    if (updateNotice) updateNotice.remove();
    updateNotice = null;
    const release = await requestWorkerReleaseMetadata(worker);
    if (waitingWorker !== worker) return;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updateNotice = createNotice({
      kind: "update",
      title: "Yeni sürüm hazır.",
      message: "Güncelleme sizin onayınızla uygulanacak.",
      notes: release.notes,
      actionLabel: "Şimdi Güncelle",
      onAction: requestUpdate,
      dismissible: true
    });
    focusNoticeAction(updateNotice);
  }

  function requestWorkerReleaseMetadata(worker) {
    const fallback = normalizeWorkerReleaseMetadata(null);
    if (!worker || typeof worker.postMessage !== "function" || typeof window.MessageChannel !== "function") {
      return Promise.resolve(fallback);
    }

    return new Promise((resolve) => {
      const channel = new window.MessageChannel();
      let settled = false;
      let timeoutId = 0;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        try { channel.port1.close(); } catch (_error) {}
        resolve(normalizeWorkerReleaseMetadata(value));
      };
      channel.port1.onmessage = (event) => finish(event && event.data);
      timeoutId = window.setTimeout(() => finish(null), 1200);
      try {
        worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      } catch (_error) {
        finish(null);
      }
    });
  }

  function normalizeWorkerReleaseMetadata(value) {
    const envelope = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const source = envelope.release && typeof envelope.release === "object" && !Array.isArray(envelope.release)
      ? envelope.release
      : envelope;
    const id = String(source.id || "static-fallback")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "static-fallback";
    const notes = [];
    for (const rawNote of Array.isArray(source.notes) ? source.notes : []) {
      let note = String(rawNote || "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!note) continue;
      const sentenceEnd = note.search(/[.!?](?:\s|$)/);
      if (sentenceEnd >= 0) note = note.slice(0, sentenceEnd + 1);
      note = note.slice(0, 180).trim();
      if (!/[.!?]$/.test(note)) note += ".";
      if (!notes.includes(note)) notes.push(note);
      if (notes.length === 5) break;
    }
    return {
      id,
      notes: notes.length ? notes : ["Kararlılık ve çevrimdışı kullanım iyileştirmeleri içerir."]
    };
  }

  function requestUpdate(button) {
    if (!waitingWorker) return;
    if (hasUnsavedChanges()) {
      const approved = window.confirm("Kaydedilmemiş değişiklikleriniz var. Güncelleme sayfayı yenileyecek. Yine de devam edilsin mi?");
      if (!approved) return;
    }

    updateRequested = true;
    button.disabled = true;
    button.textContent = "Güncelleniyor…";
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  function handleControllerChange(hadController) {
    if (controllerChangeHandled || (!hadController && !updateRequested)) return;
    controllerChangeHandled = true;

    if (!updateRequested && hasUnsavedChanges()) {
      if (updateNotice) updateNotice.remove();
      updateNotice = createNotice({
        kind: "update",
        title: "Yeni sürüm uygulandı.",
        message: "Kaydedilmemiş değişiklikleriniz korundu. Hazır olduğunuzda sayfayı yenileyin.",
        actionLabel: "Sayfayı Yenile",
        onAction(button) {
          if (hasUnsavedChanges() && !window.confirm("Kaydedilmemiş değişiklikler kaybolabilir. Sayfa yenilensin mi?")) return;
          button.disabled = true;
          window.location.reload();
        },
        dismissible: true
      });
      focusNoticeAction(updateNotice);
      return;
    }

    window.location.reload();
  }

  function bindConnectivityState() {
    const update = () => setOnlineState(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  function setOnlineState(isOnline) {
    document.body.classList.toggle("is-pwa-offline", !isOnline);
    document.body.dataset.connectivity = isOnline ? "online" : "offline";

    if (isOnline) {
      if (offlineNotice) offlineNotice.remove();
      offlineNotice = null;
    } else if (!offlineNotice) {
      offlineNotice = createNotice({
        kind: "offline",
        title: "Bağlantı yok",
        message: isBackOffice
          ? "Bağlantı yok, veriler güncellenemiyor. Yazma işlemleri tamamlanmış sayılmaz."
          : "Menü bilgileri çevrimdışıyken güncel olmayabilir.",
        dismissible: false
      });
    }

    window.dispatchEvent(new CustomEvent("menu-suite:connectivity-change", { detail: { online: isOnline } }));
  }

  function bindDirtyFormTracking() {
    const mark = (event) => {
      if (!event.isTrusted) return;
      const form = event.target && event.target.closest ? event.target.closest("form") : null;
      if (form) dirtyForms.add(form);
    };
    document.addEventListener("input", mark, true);
    document.addEventListener("change", mark, true);
    document.addEventListener("reset", (event) => {
      if (event.target instanceof HTMLFormElement) dirtyForms.delete(event.target);
    }, true);
    document.addEventListener("menu-suite:pwa-form-clean", (event) => {
      if (event.detail && event.detail.form instanceof HTMLFormElement) dirtyForms.delete(event.detail.form);
    });
  }

  function hasUnsavedChanges() {
    try {
      if (window.MenuSuiteAdminBridge && typeof window.MenuSuiteAdminBridge.hasPendingChanges === "function") {
        return Boolean(window.MenuSuiteAdminBridge.hasPendingChanges());
      }
    } catch (_error) {
      return true;
    }

    if (document.querySelector('[data-save-status="dirty"], [data-pwa-dirty="true"], .save-state[data-save-status="dirty"]')) return true;
    return Array.from(document.forms).some((form) => dirtyForms.has(form));
  }

  function createNotice(options) {
    const notice = document.createElement("section");
    notice.className = `pwa-notice pwa-notice--${options.kind}`;
    notice.dataset.pwaNotice = options.kind;
    notice.setAttribute("role", options.kind === "update" ? "region" : "status");
    notice.setAttribute("aria-live", options.kind === "update" ? "polite" : "assertive");
    notice.setAttribute("aria-label", options.title);

    const copy = document.createElement("div");
    copy.className = "pwa-notice__copy";
    const title = document.createElement("strong");
    title.textContent = options.title;
    const message = document.createElement("span");
    message.textContent = options.message;
    copy.append(title, message);
    if (Array.isArray(options.notes) && options.notes.length) {
      const notes = document.createElement("ul");
      notes.className = "pwa-notice__notes";
      for (const note of options.notes) {
        const item = document.createElement("li");
        item.textContent = note;
        notes.append(item);
      }
      copy.append(notes);
    }
    notice.append(copy);

    if (options.actionLabel && typeof options.onAction === "function") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "pwa-notice__action";
      action.textContent = options.actionLabel;
      action.addEventListener("click", () => options.onAction(action));
      notice.append(action);
    }

    if (options.secondaryActionLabel && typeof options.onSecondaryAction === "function") {
      const secondary = document.createElement("button");
      secondary.type = "button";
      secondary.className = "pwa-notice__secondary";
      secondary.textContent = options.secondaryActionLabel;
      secondary.addEventListener("click", () => options.onSecondaryAction(secondary));
      notice.append(secondary);
    }

    if (options.dismissible) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "pwa-notice__close";
      close.setAttribute("aria-label", "Bildirimi kapat");
      close.title = "Bildirimi kapat";
      close.textContent = "×";
      close.addEventListener("click", () => dismissNotice(notice));
      notice.append(close);
      notice.addEventListener("keydown", (event) => {
        if (event.key === "Escape") dismissNotice(notice);
      });
    }

    document.body.append(notice);
    return notice;
  }

  function dismissNotice(notice) {
    notice.remove();
    if (notice === updateNotice) updateNotice = null;
    if (notice === installNotice) {
      snoozeInstallPrompt("notice-dismissed");
      installNotice = null;
    }
    if (notice === notificationIntroNotice) notificationIntroNotice = null;
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  }

  function focusNoticeAction(notice) {
    const target = notice && notice.querySelector(".pwa-notice__action, .pwa-notice__close");
    if (!target) return;
    window.requestAnimationFrame(() => {
      if (document.contains(target)) target.focus({ preventScroll: true });
    });
  }

  function isSafeRegistrationOrigin() {
    if (window.isSecureContext || location.protocol === "https:") return true;
    const hostname = location.hostname.toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]";
  }
})();


(function initialiseMenuSuitePwaClient() {
  "use strict";
  if (document.documentElement.dataset.pwaApp !== "personel") return;

  // Ortak istemci yanlışlıkla ikinci kez yüklense bile worker kaydı ve yaşam
  // döngüsü dinleyicileri yalnızca bir kez bağlanır.
  if (window.__MENU_SUITE_PWA_CLIENT_INITIALIZED__ === true) return;
  Object.defineProperty(window, "__MENU_SUITE_PWA_CLIENT_INITIALIZED__", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const root = document.documentElement;
  const appId = String(root.dataset.pwaApp || "").trim();
  const workerUrl = String(root.dataset.pwaWorker || "").trim();
  const workerScope = String(root.dataset.pwaScope || "").trim();
  const isBackOffice = appId === "personel" || appId === "yonetici" || appId === "fatura";
  const supportsNotificationIntro = isBackOffice || appId === "mudavim";
  const updateCheckKey = `menu-suite:pwa-update-check:${appId}`;
  const installDismissKey = `menu-suite:pwa-install-dismissed:${appId}:v1`;
  const notificationIntroKey = `menu-suite:pwa-notification-intro:${appId}:v1`;
  const updateCheckIntervalMs = 60 * 1000;
  const installSnoozeMs = 30 * 24 * 60 * 60 * 1000;
  const isLocalhostDevelopment = isLocalHostname(location.hostname);
  const hadControllerAtLoad = Boolean("serviceWorker" in navigator && navigator.serviceWorker.controller);
  const dirtyForms = new WeakSet();
  let registrationPromise = null;
  let watchedRegistration = null;
  let controllerChangeBound = false;
  let waitingWorker = null;
  let controllerChangeHandled = false;
  let updateRequested = false;
  let previouslyFocused = null;
  let updateNotice = null;
  let offlineNotice = null;
  let installNotice = null;
  let notificationIntroNotice = null;
  let notificationPromptConfig = null;
  let notificationPromptCheckPending = false;
  let deferredInstallPrompt = null;

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  window.addEventListener("focus", () => { void checkForPwaUpdate(); });
  window.addEventListener("online", () => { void checkForPwaUpdate(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForPwaUpdate();
  });
  document.addEventListener("personel:session-started", scheduleNotificationIntro);
  document.addEventListener("menu-suite:admin-session-started", scheduleNotificationIntro);

  document.addEventListener("personel:session-ended", dismissNotificationIntro);
  document.addEventListener("menu-suite:admin-session-ended", dismissNotificationIntro);

  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);

  document.addEventListener("DOMContentLoaded", () => {
    bindConnectivityState();
    bindDirtyFormTracking();
    if (deferredInstallPrompt) showInstallReady();
    void registerServiceWorker();
  });

  window.MenuSuitePWA = Object.freeze({
    checkForUpdate: () => checkForPwaUpdate({ force: true }),
    ensureServiceWorker: ensureServiceWorkerRegistration,
    getRegistration: () => ensureServiceWorkerRegistration(),
    canInstall: () => Boolean(deferredInstallPrompt && !isStandalone()),
    promptInstall: requestInstall,
    registerNotificationPrompt(config) {
      if (!supportsNotificationIntro || !config || typeof config.onEnable !== "function") return false;
      notificationPromptConfig = config;
      scheduleNotificationIntro();
      return true;
    },
    showNotificationPrompt: scheduleNotificationIntro,
    updateBadge: updateAppBadge,
    hasUnsavedChanges,
    markFormClean(form) {
      if (form instanceof HTMLFormElement) dirtyForms.delete(form);
    }
  });

  function handleServiceWorkerMessage(event) {
    const data = event && event.data;
    if (!data || data.type !== "MENU_SUITE_PUSH_VIBRATE") return;
    const responsePort = event.ports && event.ports[0];
    let handled = false;
    if (document.visibilityState === "visible" && typeof navigator.vibrate === "function") {
      const pattern = normalizeClientVibration(data.pattern);
      if (pattern.length) {
        try { handled = navigator.vibrate(pattern) !== false; } catch (_error) {}
      }
    }
    try { responsePort?.postMessage({ handled }); } catch (_error) {}
  }

  function normalizeClientVibration(value) {
    if (!Array.isArray(value) || !value.length || value.length > 12) return [];
    const pattern = [];
    let total = 0;
    for (const item of value) {
      const duration = Number(item);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 2000) return [];
      const rounded = Math.round(duration);
      total += rounded;
      if (total > 8000) return [];
      pattern.push(rounded);
    }
    return pattern;
  }

  async function updateAppBadge(value) {
    const count = Math.max(0, Math.trunc(Number(value || 0)));
    try {
      if (count > 0 && typeof navigator.setAppBadge === "function") await navigator.setAppBadge(count);
      else if (count === 0 && typeof navigator.clearAppBadge === "function") await navigator.clearAppBadge();
    } catch (_error) {
      // App Badge API desteklenmeyen/izin verilmeyen tarayıcılarda sessizce atlanır.
    }
  }

  function handleBeforeInstallPrompt(event) {
    event.preventDefault();
    if (isStandalone()) return;
    deferredInstallPrompt = event;
    if (document.body) showInstallReady();
  }

  function showInstallReady() {
    if (!deferredInstallPrompt || installNotice || isStandalone() || hasActiveInstallSnooze()) return;
    installNotice = createNotice({
      kind: "install",
      title: "Uygulama olarak yükleyin",
      message: `${currentBrandName()} uygulamasını ana ekranınızdan hızlı ve güvenli biçimde açabilirsiniz.`,
      actionLabel: "Uygulamayı Yükle",
      onAction: requestInstall,
      dismissible: true
    });
  }

  function currentBrandName() {
    const explicit = String(document.documentElement.dataset.brandName || "").trim();
    if (explicit) return explicit;
    if (appId === "personel") return "Personel";
    if (appId === "yonetici") return "Yönetici paneli";
    return "Dijital menü";
  }

  function requestInstall(button) {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent || isStandalone()) return Promise.resolve(false);
    if (button) {
      button.disabled = true;
      button.textContent = "Yükleme açılıyor…";
    }

    // prompt() doğrudan tıklama çağrı zincirinde çalışır; izin diyaloğu otomatik başlatılmaz.
    const promptResult = promptEvent.prompt();
    return Promise.resolve(promptResult)
      .then(() => promptEvent.userChoice)
      .then((choice) => {
        const accepted = Boolean(choice && choice.outcome === "accepted");
        deferredInstallPrompt = null;
        if (!accepted) snoozeInstallPrompt("prompt-dismissed");
        if (installNotice) installNotice.remove();
        installNotice = null;
        return accepted;
      })
      .catch(() => {
        if (button) {
          button.disabled = false;
          button.textContent = "Uygulamayı Yükle";
        }
        return false;
      });
  }

  function handleAppInstalled() {
    deferredInstallPrompt = null;
    if (installNotice) installNotice.remove();
    installNotice = null;
  }

  function hasActiveInstallSnooze() {
    try {
      const rawValue = window.localStorage.getItem(installDismissKey);
      if (!rawValue) return false;
      const record = JSON.parse(rawValue);
      if (Number(record && record.nextEligibleAt || 0) > Date.now()) return true;
      window.localStorage.removeItem(installDismissKey);
    } catch (_error) {
      try { window.localStorage.removeItem(installDismissKey); } catch (_storageError) {}
    }
    return false;
  }

  function snoozeInstallPrompt(reason) {
    try {
      const dismissedAt = Date.now();
      window.localStorage.setItem(installDismissKey, JSON.stringify({
        dismissedAt,
        nextEligibleAt: dismissedAt + installSnoozeMs,
        reason: String(reason || "dismissed")
      }));
    } catch (_error) {}
  }

  function scheduleNotificationIntro() {
    if (notificationPromptCheckPending) return;
    notificationPromptCheckPending = true;
    window.setTimeout(() => {
      notificationPromptCheckPending = false;
      void showNotificationIntroIfEligible();
    }, 250);
  }

  async function showNotificationIntroIfEligible() {
    if (!document.body || notificationIntroNotice || !notificationPromptConfig || !supportsNotificationIntro || !isStandalone()) return;
    if (!("Notification" in window) || window.Notification.permission !== "default") return;
    try {
      if (window.localStorage.getItem(notificationIntroKey)) return;
    } catch (_error) {}
    if (typeof notificationPromptConfig.canShow === "function"
      && !(await Promise.resolve(notificationPromptConfig.canShow()).catch(() => false))) return;

    notificationIntroNotice = createNotice({
      kind: "push-intro",
      title: "Telefon bildirimleri",
      message: appId === "mudavim"
        ? "Hesap duyurularını ve bildirimlerini telefonundan al."
        : "Görev, sevkiyat ve vardiya bildirimlerini telefonundan al.",
      actionLabel: "Bildirimleri Aç",
      onAction: enableNotificationsFromIntro,
      secondaryActionLabel: "Şimdi Değil",
      onSecondaryAction: postponeNotificationIntro,
      dismissible: false
    });
    focusNoticeAction(notificationIntroNotice);
  }

  async function enableNotificationsFromIntro(button) {
    if (!notificationPromptConfig || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Açılıyor…";
    try {
      const enabled = await notificationPromptConfig.onEnable();
      if (enabled === false) throw new Error("Bildirim izni etkinleştirilemedi.");
      rememberNotificationIntroChoice("enabled");
      dismissNotificationIntro();
    } catch (error) {
      if ("Notification" in window && window.Notification.permission === "denied") {
        rememberNotificationIntroChoice("denied");
        dismissNotificationIntro();
        return;
      }
      button.disabled = false;
      button.textContent = original;
      const message = notificationIntroNotice && notificationIntroNotice.querySelector(".pwa-notice__copy span");
      if (message) message.textContent = error && error.message || "Bildirim izni etkinleştirilemedi. Ayarlardan yeniden deneyebilirsiniz.";
    }
  }

  function postponeNotificationIntro() {
    rememberNotificationIntroChoice("later");
    dismissNotificationIntro();
  }

  function rememberNotificationIntroChoice(value) {
    try { window.localStorage.setItem(notificationIntroKey, String(value || "seen")); } catch (_error) {}
  }

  function dismissNotificationIntro() {
    if (notificationIntroNotice) notificationIntroNotice.remove();
    notificationIntroNotice = null;
  }

  function isStandalone() {
    return Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || window.navigator.standalone === true;
  }

  async function registerServiceWorker() {
    if (!appId || !workerUrl || !workerScope || !("serviceWorker" in navigator) || !isSafeRegistrationOrigin()) return;
    try {
      await ensureServiceWorkerRegistration();
    } catch (error) {
      console.warn("PWA çevrimdışı desteği başlatılamadı; web uygulaması normal çalışmaya devam ediyor.", error);
    }
  }

  function ensureServiceWorkerRegistration() {
    if (!appId || !workerUrl || !workerScope || !("serviceWorker" in navigator) || !isSafeRegistrationOrigin()) {
      return Promise.resolve(null);
    }
    if (registrationPromise) return registrationPromise;

    registrationPromise = navigator.serviceWorker.getRegistration(workerScope)
      .then((existing) => existing || navigator.serviceWorker.register(workerUrl, {
        scope: workerScope,
        updateViaCache: "none"
      }))
      .then((registration) => {
        if (!registration) return null;
        bindRegistrationLifecycle(registration);
        return registration;
      })
      .catch((error) => {
        registrationPromise = null;
        throw error;
      });
    return registrationPromise;
  }

  function bindRegistrationLifecycle(registration) {
    if (watchedRegistration !== registration) {
      watchedRegistration = registration;
      watchRegistration(registration);
      scheduleAutomaticUpdateCheck(registration);
    }
    if (!controllerChangeBound) {
      controllerChangeBound = true;
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    }
  }

  function scheduleAutomaticUpdateCheck(registration) {
    if (isLocalhostDevelopment) {
      registration.update().catch(() => {});
      return;
    }
    let lastCheckedAt = 0;
    try { lastCheckedAt = Number(window.localStorage.getItem(updateCheckKey) || 0); } catch (_error) {}
    if (Date.now() - lastCheckedAt < updateCheckIntervalMs) return;
    const check = () => {
      try { window.localStorage.setItem(updateCheckKey, String(Date.now())); } catch (_error) {}
      registration.update().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(check, { timeout: 15000 });
    } else {
      window.setTimeout(check, 15000);
    }
  }

  async function checkForPwaUpdate(options = {}) {
    if (isLocalhostDevelopment) {
      const registration = await ensureServiceWorkerRegistration();
      return registration && registration.update();
    }
    let lastCheckedAt = 0;
    try { lastCheckedAt = Number(window.localStorage.getItem(updateCheckKey) || 0); } catch (_error) {}
    if (!options.force && Date.now() - lastCheckedAt < updateCheckIntervalMs) return null;
    const registration = await ensureServiceWorkerRegistration();
    if (!registration) return null;
    try { window.localStorage.setItem(updateCheckKey, String(Date.now())); } catch (_error) {}
    return registration.update().catch(() => null);
  }

  function watchRegistration(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) void showUpdateReady(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          void showUpdateReady(registration.waiting || installing);
        }
      });
    });
  }

  async function showUpdateReady(worker) {
    waitingWorker = worker;
    if (updateNotice) updateNotice.remove();
    updateNotice = null;
    const release = await requestWorkerReleaseMetadata(worker);
    if (waitingWorker !== worker) return;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updateNotice = createNotice({
      kind: "update",
      title: "Yeni sürüm hazır.",
      message: "Güncelleme sizin onayınızla uygulanacak.",
      notes: release.notes,
      actionLabel: "Şimdi Güncelle",
      onAction: requestUpdate,
      dismissible: true
    });
    focusNoticeAction(updateNotice);
  }

  function requestWorkerReleaseMetadata(worker) {
    const fallback = normalizeWorkerReleaseMetadata(null);
    if (!worker || typeof worker.postMessage !== "function" || typeof window.MessageChannel !== "function") {
      return Promise.resolve(fallback);
    }

    return new Promise((resolve) => {
      const channel = new window.MessageChannel();
      let settled = false;
      let timeoutId = 0;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        try { channel.port1.close(); } catch (_error) {}
        resolve(normalizeWorkerReleaseMetadata(value));
      };
      channel.port1.onmessage = (event) => finish(event && event.data);
      timeoutId = window.setTimeout(() => finish(null), 1200);
      try {
        worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      } catch (_error) {
        finish(null);
      }
    });
  }

  function normalizeWorkerReleaseMetadata(value) {
    const envelope = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const source = envelope.release && typeof envelope.release === "object" && !Array.isArray(envelope.release)
      ? envelope.release
      : envelope;
    const id = String(source.id || "static-fallback")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "static-fallback";
    const notes = [];
    for (const rawNote of Array.isArray(source.notes) ? source.notes : []) {
      let note = String(rawNote || "")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!note) continue;
      const sentenceEnd = note.search(/[.!?](?:\s|$)/);
      if (sentenceEnd >= 0) note = note.slice(0, sentenceEnd + 1);
      note = note.slice(0, 180).trim();
      if (!/[.!?]$/.test(note)) note += ".";
      if (!notes.includes(note)) notes.push(note);
      if (notes.length === 5) break;
    }
    return {
      id,
      notes: notes.length ? notes : ["Kararlılık ve çevrimdışı kullanım iyileştirmeleri içerir."]
    };
  }

  function requestUpdate(button) {
    if (!waitingWorker) return;
    if (hasUnsavedChanges()) {
      if (button.dataset.confirmDirtyUpdate !== "true") {
        button.dataset.confirmDirtyUpdate = "true";
        button.textContent = "Yine de Güncelle";
        const message = updateNotice && updateNotice.querySelector(".pwa-notice__copy span");
        if (message) message.textContent = "Kaydedilmemiş değişiklikler var. Devam etmek için düğmeye tekrar basın.";
        window.setTimeout(() => {
          if (!button.isConnected || button.disabled) return;
          delete button.dataset.confirmDirtyUpdate;
          button.textContent = "Şimdi Güncelle";
        }, 5000);
        return;
      }
      delete button.dataset.confirmDirtyUpdate;
    }

    updateRequested = true;
    button.disabled = true;
    button.textContent = "Güncelleniyor…";
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  function handleControllerChange() {
    if (controllerChangeHandled || (!hadControllerAtLoad && !updateRequested)) return;
    controllerChangeHandled = true;

    if (!updateRequested && hasUnsavedChanges()) {
      if (updateNotice) updateNotice.remove();
      updateNotice = createNotice({
        kind: "update",
        title: "Yeni sürüm uygulandı.",
        message: "Kaydedilmemiş değişiklikleriniz korundu. Hazır olduğunuzda sayfayı yenileyin.",
        actionLabel: "Sayfayı Yenile",
        onAction(button) {
          if (hasUnsavedChanges() && button.dataset.confirmDirtyReload !== "true") {
            button.dataset.confirmDirtyReload = "true";
            button.textContent = "Yine de Yenile";
            return;
          }
          button.disabled = true;
          window.location.reload();
        },
        dismissible: true
      });
      focusNoticeAction(updateNotice);
      return;
    }

    window.location.reload();
  }

  function bindConnectivityState() {
    const update = () => setOnlineState(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  function setOnlineState(isOnline) {
    document.body.classList.toggle("is-pwa-offline", !isOnline);
    document.body.dataset.connectivity = isOnline ? "online" : "offline";

    if (isOnline) {
      if (offlineNotice) offlineNotice.remove();
      offlineNotice = null;
    } else if (!offlineNotice) {
      offlineNotice = createNotice({
        kind: "offline",
        title: "Bağlantı yok",
        message: isBackOffice
          ? "Bağlantı yok, veriler güncellenemiyor. Yazma işlemleri tamamlanmış sayılmaz."
          : appId === "mudavim"
            ? "Bağlantı gerekli. Hesap işlemleri çevrimdışıyken yapılamaz."
            : "Menü bilgileri çevrimdışıyken güncel olmayabilir.",
        dismissible: false
      });
    }

    window.dispatchEvent(new CustomEvent("menu-suite:connectivity-change", { detail: { online: isOnline } }));
  }

  function bindDirtyFormTracking() {
    const mark = (event) => {
      if (!event.isTrusted) return;
      const form = event.target && event.target.closest ? event.target.closest("form") : null;
      if (form) dirtyForms.add(form);
    };
    document.addEventListener("input", mark, true);
    document.addEventListener("change", mark, true);
    document.addEventListener("reset", (event) => {
      if (event.target instanceof HTMLFormElement) dirtyForms.delete(event.target);
    }, true);
    document.addEventListener("menu-suite:pwa-form-clean", (event) => {
      if (event.detail && event.detail.form instanceof HTMLFormElement) dirtyForms.delete(event.detail.form);
    });
  }

  function hasUnsavedChanges() {
    try {
      if (window.MenuSuiteAdminBridge && typeof window.MenuSuiteAdminBridge.hasPendingChanges === "function") {
        return Boolean(window.MenuSuiteAdminBridge.hasPendingChanges());
      }
    } catch (_error) {
      return true;
    }

    if (document.querySelector('[data-save-status="dirty"], [data-pwa-dirty="true"], .save-state[data-save-status="dirty"]')) return true;
    return Array.from(document.forms).some((form) => dirtyForms.has(form));
  }

  function createNotice(options) {
    const notice = document.createElement("section");
    notice.className = `pwa-notice pwa-notice--${options.kind}`;
    notice.dataset.pwaNotice = options.kind;
    notice.setAttribute("role", options.kind === "update" ? "region" : "status");
    notice.setAttribute("aria-live", options.kind === "update" ? "polite" : "assertive");
    notice.setAttribute("aria-label", options.title);

    const copy = document.createElement("div");
    copy.className = "pwa-notice__copy";
    const title = document.createElement("strong");
    title.textContent = options.title;
    const message = document.createElement("span");
    message.textContent = options.message;
    copy.append(title, message);
    if (Array.isArray(options.notes) && options.notes.length) {
      const notes = document.createElement("ul");
      notes.className = "pwa-notice__notes";
      for (const note of options.notes) {
        const item = document.createElement("li");
        item.textContent = note;
        notes.append(item);
      }
      copy.append(notes);
    }
    notice.append(copy);

    if (options.actionLabel && typeof options.onAction === "function") {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "pwa-notice__action";
      action.textContent = options.actionLabel;
      action.addEventListener("click", () => options.onAction(action));
      notice.append(action);
    }

    if (options.secondaryActionLabel && typeof options.onSecondaryAction === "function") {
      const secondary = document.createElement("button");
      secondary.type = "button";
      secondary.className = "pwa-notice__secondary";
      secondary.textContent = options.secondaryActionLabel;
      secondary.addEventListener("click", () => options.onSecondaryAction(secondary));
      notice.append(secondary);
    }

    if (options.dismissible) {
      const close = document.createElement("button");
      close.type = "button";
      close.className = "pwa-notice__close";
      close.setAttribute("aria-label", "Bildirimi kapat");
      close.title = "Bildirimi kapat";
      close.textContent = "×";
      close.addEventListener("click", () => dismissNotice(notice));
      notice.append(close);
      notice.addEventListener("keydown", (event) => {
        if (event.key === "Escape") dismissNotice(notice);
      });
    }

    document.body.append(notice);
    return notice;
  }

  function dismissNotice(notice) {
    notice.remove();
    if (notice === updateNotice) updateNotice = null;
    if (notice === installNotice) {
      snoozeInstallPrompt("notice-dismissed");
      installNotice = null;
    }
    if (notice === notificationIntroNotice) notificationIntroNotice = null;
    if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
  }

  function focusNoticeAction(notice) {
    const target = notice && notice.querySelector(".pwa-notice__action, .pwa-notice__close");
    if (!target) return;
    window.requestAnimationFrame(() => {
      if (document.contains(target)) target.focus({ preventScroll: true });
    });
  }

  function isSafeRegistrationOrigin() {
    if (window.isSecureContext || location.protocol === "https:") return true;
    return isLocalHostname(location.hostname);
  }

  function isLocalHostname(value) {
    const hostname = String(value || "").toLowerCase();
    return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  }
})();
