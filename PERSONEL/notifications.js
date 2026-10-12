(function initialisePersonelNotifications() {
  "use strict";
  if (window.MenuSuitePersonelNotifications) return;

  const API_ROOT = "/api/notifications";
  const DEVICE_STORAGE_KEY = "menu-suite.notifications.personel.device.v1";
  const SOUND_CLAIMS_STORAGE_KEY = "menu-suite.notifications.personel.sound-claims.v1";
  const PAGE_SIZE = 30;
  const FALLBACK_POLL_MS = 15000;
  const BOOLEAN_PREFERENCES = [
    "inAppEnabled", "emailEnabled", "taskNotifications",
    "shiftNotifications", "shipmentNotifications", "stockNotifications", "systemNotifications", "taskReminder24h", "taskReminder2h",
    "overdueReminder", "shiftReminder12h", "shiftReminder2h", "quietHoursEnabled",
    "pushVibrationEnabled"
  ];
  const DEFAULT_PREFERENCES = Object.freeze({
    inAppEnabled: true,
    pushEnabled: false,
    pushVibrationEnabled: true,
    emailEnabled: false,
    emailAddress: "",
    taskNotifications: true,
    shiftNotifications: true,
    shipmentNotifications: true,
    stockNotifications: true,
    systemNotifications: true,
    taskReminder24h: false,
    taskReminder2h: false,
    overdueReminder: false,
    shiftReminder12h: false,
    shiftReminder2h: false,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    timezone: "Europe/Istanbul"
  });
  const CATEGORY_SECTIONS = Object.freeze({
    task: "tasks",
    materialRequest: "materialRequest",
    shift: "shift",
    shipment: "shipment",
    stock: "stock",
    system: "profile"
  });
  const INITIAL_DEEP_LINK = window.location.href;

  const state = {
    active: false,
    preview: false,
    sessionEndNotified: false,
    modalOpen: false,
    notifications: [],
    unreadCount: 0,
    nextCursor: "",
    preferences: { ...DEFAULT_PREFERENCES },
    capabilities: {},
    pushIssue: null,
    devices: [],
    devicesLoaded: false,
    devicesLoading: false,
    loading: false,
    pending: new Set(),
    gatewayBound: false,
    gatewayConnected: false,
    pollTimer: null,
    pollDelayMs: FALLBACK_POLL_MS,
    previousFocus: null,
    lastLoadedAt: 0,
    initialDeepLinkConsumed: false,
    preferencesLoaded: false,
    soundUnlocked: false,
    expandedIds: new Set(),
    suppressedIds: new Set(),
    undoItems: new Map()
  };
  const soundOwner = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const elements = {};

  let initialised = false;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
  else initialise();

  function initialise() {
    if (initialised) return;
    initialised = true;
    [
      "personelNotificationTrigger", "personelNotificationBadge", "personelNotificationDrawer",
      "personelNotificationBackdrop", "personelNotificationClose",
      "personelNotificationMessage", "personelNotificationList", "personelNotificationLoadMore", "personelNotificationUndoRegion",
      "personelNotificationPreferencesForm", "personelNotificationPreferencesState",
      "personelNotificationEmail", "personelNotificationEmailSummary", "personelNotificationQuietTimes",
      "personelPushStatus", "personelPushToggle", "personelPushTest", "recipeFrame",
      "personelNotificationManageEmail", "personelNotificationDevices", "personelNotificationDevicesRefresh",
      "personelNotificationDevicesPanel", "personelNotificationDevicesCount"
    ].forEach((id) => { elements[id] = document.getElementById(id); });

    bindEvents();
    registerPwaNotificationIntro();
    updateUnreadUi();
    renderNotificationList();
    renderPushState();
  }

  function bindEvents() {
    document.addEventListener("personel:session-started", handleSessionStarted);
    document.addEventListener("personel:session-ended", handleSessionEnded);
    document.addEventListener("personel:section-change", handleSectionChange);
    document.addEventListener("personel:gateway-status", handleGatewayStatus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeunload", stopRealtime);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // The shell owns the trigger so a lazy-loaded copy cannot add a second click handler.
    elements.personelNotificationClose?.addEventListener("click", closeDialog);
    elements.personelNotificationBackdrop?.addEventListener("click", closeDialog);
    elements.personelNotificationList?.addEventListener("click", handleListClick);
    elements.personelNotificationUndoRegion?.addEventListener("click", handleUndoClick);
    elements.personelNotificationLoadMore?.addEventListener("click", () => loadNotifications({ append: true }));
    elements.personelNotificationPreferencesForm?.addEventListener("submit", savePreferences);
    elements.personelPushToggle?.addEventListener("click", togglePushSubscription);
    elements.personelPushTest?.addEventListener("click", sendPushTest);
    elements.personelNotificationManageEmail?.addEventListener("click", openAccountSecurity);
    elements.personelNotificationDevicesRefresh?.addEventListener("click", () => loadDevices(true));
    elements.personelNotificationDevices?.addEventListener("click", handleDeviceClick);
    elements.personelNotificationDevicesPanel?.addEventListener("toggle", () => {
      if (elements.personelNotificationDevicesPanel.open) void loadDevices();
    });
    document.addEventListener("menu-suite:account-security-updated", (event) => {
      if (event.detail && event.detail.scope === "personel") void loadPreferences();
    });
    document.addEventListener("keydown", handleDocumentKeydown);
    document.addEventListener("pointerdown", unlockPanelSound, { once: true, capture: true });
    document.addEventListener("keydown", unlockPanelSound, { once: true, capture: true });
  }

  function registerPwaNotificationIntro() {
    if (!window.MenuSuitePWA || typeof window.MenuSuitePWA.registerNotificationPrompt !== "function") return;
    window.MenuSuitePWA.registerNotificationPrompt({
      canShow: () => state.active && !state.preview && state.preferencesLoaded
        && state.capabilities.pushSupported === true && Boolean(vapidPublicKey())
        && supportsPush() && Notification.permission === "default",
      onEnable: async () => {
        try {
          if (!state.preferencesLoaded) await loadPreferences();
          await enablePush();
          await renderPushState();
          return true;
        } catch (error) {
          state.pushIssue = normalizePushIssue(error);
          await renderPushState();
          throw error;
        }
      }
    });
  }

  function handleSessionStarted(event) {
    const detail = event && event.detail || {};
    resetSessionState();
    state.active = true;
    state.preview = Boolean(detail.preview);
    if (state.preview) {
      if (elements.personelNotificationTrigger) elements.personelNotificationTrigger.hidden = true;
      return;
    }
    if (elements.personelNotificationTrigger) elements.personelNotificationTrigger.hidden = false;
    void refreshUnreadCount();
    void loadPreferences();
    connectEvents();
  }

  function handleSessionEnded() {
    resetSessionState();
    closeDialog();
    if (elements.personelNotificationTrigger) elements.personelNotificationTrigger.hidden = true;
    renderNotificationList();
    fillPreferencesForm();
  }

  function handleInitialDeepLink() {
    if (!state.active || state.preview || state.initialDeepLinkConsumed) return;
    state.initialDeepLinkConsumed = true;
    let url;
    try { url = new URL(INITIAL_DEEP_LINK); } catch (_error) { return; }
    const section = url.searchParams.get("section");
    if (!section) return;
    window.setTimeout(() => navigateToNotification({
      category: "system",
      deepLink: INITIAL_DEEP_LINK,
      entityId: url.searchParams.get("taskId") || url.searchParams.get("assignmentId") || ""
    }), 0);
  }

  function resetSessionState() {
    stopRealtime();
    state.gatewayConnected = false;
    state.pollDelayMs = FALLBACK_POLL_MS;
    state.active = false;
    state.preview = false;
    state.modalOpen = false;
    state.sessionEndNotified = false;
    state.notifications = [];
    state.unreadCount = 0;
    state.nextCursor = "";
    state.preferences = { ...DEFAULT_PREFERENCES };
    state.capabilities = {};
    state.pushIssue = null;
    state.devices = [];
    state.devicesLoaded = false;
    state.devicesLoading = false;
    state.loading = false;
    state.pending.clear();
    state.lastLoadedAt = 0;
    state.initialDeepLinkConsumed = false;
    state.preferencesLoaded = false;
    state.expandedIds.clear();
    state.suppressedIds.clear();
    clearUndoItems();
    if (elements.personelNotificationDevicesCount) elements.personelNotificationDevicesCount.textContent = "(…)";
    if (elements.personelNotificationDevicesPanel) elements.personelNotificationDevicesPanel.open = false;
    updateUnreadUi();
  }

  function handleSectionChange(event) {
    handleInitialDeepLink();
    if (event && event.detail && event.detail.section === "profile") {
      if (!state.preferencesLoaded) void loadPreferences();
    }
  }

  async function openDialog() {
    if (!state.active || state.preview || !elements.personelNotificationDrawer) return;
    if (state.modalOpen) return;
    state.modalOpen = true;
    state.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.personelNotificationDrawer.hidden = false;
    if (elements.personelNotificationBackdrop) elements.personelNotificationBackdrop.hidden = false;
    elements.personelNotificationTrigger?.setAttribute("aria-expanded", "true");
    elements.personelNotificationTrigger?.setAttribute("aria-label", "Bildirimleri kapat");
    document.body.classList.add("is-personel-notification-open");
    window.requestAnimationFrame(() => elements.personelNotificationClose?.focus({ preventScroll: true }));
    const pending = [];
    if (!state.lastLoadedAt || Date.now() - state.lastLoadedAt > 10000) pending.push(loadNotifications());
    if (!state.preferencesLoaded) pending.push(loadPreferences());
    if (pending.length) await Promise.allSettled(pending);
  }

  function closeDialog() {
    if (!state.modalOpen && elements.personelNotificationDrawer?.hidden) return;
    state.modalOpen = false;
    if (elements.personelNotificationDrawer) elements.personelNotificationDrawer.hidden = true;
    if (elements.personelNotificationBackdrop) elements.personelNotificationBackdrop.hidden = true;
    elements.personelNotificationTrigger?.setAttribute("aria-expanded", "false");
    elements.personelNotificationTrigger?.setAttribute("aria-label", "Bildirimleri aç");
    document.body.classList.remove("is-personel-notification-open");
    if (state.previousFocus && document.contains(state.previousFocus)) state.previousFocus.focus({ preventScroll: true });
    state.previousFocus = null;
  }

  function handleDocumentKeydown(event) {
    if (!state.modalOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab" || !elements.personelNotificationDrawer) return;
    const controls = Array.from(elements.personelNotificationDrawer.querySelectorAll("button:not(:disabled), input:not(:disabled), [href]"))
      .filter((node) => !node.hidden && node.offsetParent !== null);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function loadNotifications(options = {}) {
    if (!state.active || state.preview || state.loading) return;
    const append = Boolean(options.append && state.nextCursor);
    state.loading = true;
    setListBusy(true, append);
    showMessage("");
    try {
      const parameters = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (append) parameters.set("cursor", state.nextCursor);
      const result = await request(`${API_ROOT}?${parameters.toString()}`);
      const incoming = notificationArray(result).map(normalizeNotification)
        .filter((item) => item.id && !item.archivedAt && !state.suppressedIds.has(item.id));
      state.notifications = sortNotifications(append ? mergeUnique(state.notifications, incoming) : incoming);
      state.nextCursor = String(result.nextCursor || result.cursor && result.cursor.next || "");
      applyUnreadCount(result);
      state.lastLoadedAt = Date.now();
      renderNotificationList();
    } catch (error) {
      if (state.notifications.length) {
        showLoadError();
      } else {
        showMessage("");
        renderNotificationList("error");
      }
    } finally {
      state.loading = false;
      setListBusy(false);
    }
  }

  async function refreshUnreadCount() {
    if (!state.active || state.preview) return false;
    try {
      const result = await request(`${API_ROOT}/unread-count`);
      applyUnreadCount(result);
      return true;
    } catch (_error) {
      // SSE veya bir sonraki başarılı liste isteği sayacı tekrar eşitler.
      return false;
    }
  }

  function notificationArray(result) {
    if (Array.isArray(result && result.notifications)) return result.notifications;
    if (Array.isArray(result && result.items)) return result.items;
    if (Array.isArray(result && result.data)) return result.data;
    return [];
  }

  function normalizeNotification(value) {
    const source = value && typeof value === "object" ? value : {};
    const title = String(source.title || "Bildirim");
    const body = String(source.body || "");
    const severity = semanticSeverity(source.severity, `${title} ${body}`);
    const category = normalizeCategory(source.category);
    return {
      id: String(source.id || ""),
      category,
      severity,
      title,
      body,
      createdAt: String(source.createdAt || ""),
      updatedAt: String(source.updatedAt || source.createdAt || ""),
      readAt: source.readAt ? String(source.readAt) : "",
      archivedAt: source.archivedAt ? String(source.archivedAt) : "",
      entityType: String(source.entityType || ""),
      entityId: String(source.entityId || ""),
      deepLink: String(source.deepLink || ""),
      metadata: source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata) ? source.metadata : {}
    };
  }

  function semanticSeverity(value, text) {
    const current = ["info", "success", "warning", "critical"].includes(value) ? value : "info";
    const meaning = String(text || "").toLocaleLowerCase("tr-TR");
    if (/redded|iptal|başarısız|hata/.test(meaning)) return current === "critical" ? "critical" : "warning";
    if (current === "info" && /onaylandı|tamamlandı|başarılı/.test(meaning)) return "success";
    return current;
  }

  function normalizeCategory(value) {
    const text = String(value || "system").toLocaleLowerCase("tr-TR");
    if (/task|görev|todo|assignment/.test(text)) return "task";
    if (/material.?request|malzeme.?talep/.test(text)) return "materialRequest";
    if (/shift|vardiya|izin/.test(text)) return "shift";
    if (/shipment|sevkiyat|teslimat/.test(text)) return "shipment";
    if (/stock|stok|envanter/.test(text)) return "stock";
    return "system";
  }

  function mergeUnique(current, incoming) {
    const map = new Map(current.map((item) => [item.id, item]));
    incoming.forEach((item) => map.set(item.id, item));
    return Array.from(map.values());
  }

  function sortNotifications(items) {
    return [...items].sort((left, right) => {
      const dateOrder = String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
      return dateOrder || String(right.id || "").localeCompare(String(left.id || ""));
    });
  }

  function applyUnreadCount(result) {
    const value = Number(result && (result.unreadCount ?? result.count));
    if (Number.isSafeInteger(value) && value >= 0) state.unreadCount = value;
    else state.unreadCount = state.notifications.filter((item) => !item.readAt && !item.archivedAt).length;
    updateUnreadUi();
  }

  function updateUnreadUi() {
    const count = Math.max(0, Number(state.unreadCount || 0));
    void window.MenuSuitePWA?.updateBadge?.(count);
    if (elements.personelNotificationBadge) {
      elements.personelNotificationBadge.textContent = count > 99 ? "99+" : String(count);
      elements.personelNotificationBadge.hidden = count === 0;
      elements.personelNotificationBadge.setAttribute("aria-label", `${count} okunmamış bildirim`);
    }
    if (elements.personelNotificationTrigger) {
      elements.personelNotificationTrigger.setAttribute("aria-label", state.modalOpen
        ? "Bildirimleri kapat"
        : count ? `Bildirimleri aç, ${count} okunmamış bildirim` : "Bildirimleri aç");
    }
    const brandName = String(window.MenuSuitePersonelShell?.getContext?.().brandName || "Personel").trim() || "Personel";
    document.title = count ? `(${count > 99 ? "99+" : count}) ${brandName} Personel` : `${brandName} Personel`;
  }

  function setListBusy(busy, appending) {
    if (elements.personelNotificationList) elements.personelNotificationList.setAttribute("aria-busy", busy ? "true" : "false");
    if (elements.personelNotificationLoadMore) elements.personelNotificationLoadMore.disabled = busy;
    if (busy && !appending && !state.notifications.length && elements.personelNotificationList) {
      elements.personelNotificationList.replaceChildren(createStateNode("loading"));
    }
  }

  function renderNotificationList(forceState) {
    const root = elements.personelNotificationList;
    if (!root) return;
    root.replaceChildren();
    if (forceState === "error") root.append(createStateNode("error"));
    else if (!state.notifications.length) root.append(createStateNode("empty"));
    else state.notifications.forEach((notification) => root.append(createNotificationCard(notification)));
    if (elements.personelNotificationLoadMore) elements.personelNotificationLoadMore.hidden = !state.nextCursor;
  }

  function createStateNode(kind) {
    const node = document.createElement("div");
    node.className = kind === "loading" ? "personel-notification-loading" : "personel-notification-empty";
    node.innerHTML = icon(kind === "error" ? "warning" : kind === "loading" ? "clock" : "bell");
    const title = document.createElement("strong");
    const text = document.createElement("span");
    if (kind === "loading") {
      title.textContent = "Bildirimler yükleniyor";
      text.textContent = "Güncel kayıtlar sunucudan alınıyor.";
    } else if (kind === "error") {
      title.textContent = "Bildirimler alınamadı";
      text.textContent = "Bağlantınızı kontrol edip yeniden deneyin.";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "ui-button ui-button--secondary ui-button--sm";
      retry.textContent = "Yeniden Dene";
      retry.addEventListener("click", () => loadNotifications());
      node.append(title, text, retry);
      return node;
    } else {
      title.textContent = "Henüz bildirim yok";
      text.textContent = "";
    }
    node.append(title, text);
    return node;
  }

  function createNotificationCard(notification) {
    const card = document.createElement("article");
    const expanded = state.expandedIds.has(notification.id);
    card.className = `personel-notification-card is-${notification.severity}${notification.readAt ? "" : " is-unread"}${expanded ? " is-expanded" : ""}`;
    card.dataset.notificationId = notification.id;

    const iconNode = document.createElement("span");
    iconNode.className = "personel-notification-card__icon";
    iconNode.setAttribute("aria-hidden", "true");
    iconNode.innerHTML = icon(categoryIcon(notification.category));

    const open = document.createElement("button");
    open.type = "button";
    open.className = "personel-notification-card__open";
    open.dataset.notificationAction = "open";
    open.setAttribute("aria-expanded", expanded ? "true" : "false");
    open.setAttribute("aria-label", `${notification.title} ayrıntısını ${expanded ? "kapat" : "aç"}`);
    const title = document.createElement("strong");
    title.textContent = notification.title;
    const body = document.createElement("p");
    body.className = "personel-notification-card__summary";
    body.textContent = notification.body;
    const time = document.createElement("time");
    time.dateTime = notification.createdAt;
    time.textContent = relativeTime(notification.createdAt);
    time.title = absoluteTime(notification.createdAt);
    open.append(title, body, time);

    const side = document.createElement("div");
    side.className = "personel-notification-card__side";
    if (!notification.readAt) {
      const unread = document.createElement("span");
      unread.className = "personel-notification-card__unread";
      unread.setAttribute("aria-label", "Okunmamış bildirim");
      side.append(unread);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "personel-notification-card__delete";
    remove.dataset.notificationAction = "delete";
    remove.setAttribute("aria-label", "Bildirimi sil");
    remove.title = "Bildirimi sil";
    remove.innerHTML = icon("delete");
    side.append(remove);

    card.append(iconNode, open, side);
    const detailText = notificationDetailText(notification);
    if (expanded && detailText) {
      const detail = document.createElement("div");
      detail.className = "personel-notification-card__detail";
      const paragraph = document.createElement("p");
      paragraph.textContent = detailText;
      detail.append(paragraph);
      card.append(detail);
    }
    return card;
  }

  function notificationDetailText(notification) {
    const metadata = notification.metadata || {};
    const values = [
      metadata.detail, metadata.details, metadata.description, metadata.note,
      metadata.adminNote, metadata.rejectionReason, metadata.reason
    ].map((value) => String(value || "").trim()).filter(Boolean);
    if (notification.entityId) values.push(`Kayıt: ${notification.entityId}`);
    return [...new Set(values.filter((value) => value !== notification.body))].join(" · ");
  }

  function handleListClick(event) {
    const action = event.target.closest("[data-notification-action]");
    const card = event.target.closest("[data-notification-id]");
    if (!action || !card) return;
    const notification = state.notifications.find((item) => item.id === card.dataset.notificationId);
    if (!notification) return;
    if (action.dataset.notificationAction === "open") void toggleNotification(notification);
    if (action.dataset.notificationAction === "delete") void deleteNotification(notification, action);
  }

  async function toggleNotification(notification) {
    if (!notification.readAt) await setNotificationRead(notification, true, null, { quiet: true });
    await navigateToNotification(notification);
  }

  async function setNotificationRead(notification, read, button, options = {}) {
    const key = `${read ? "read" : "unread"}:${notification.id}`;
    if (state.pending.has(key)) return false;
    state.pending.add(key);
    setButtonBusy(button, true);
    try {
      const result = await request(`${API_ROOT}/${encodeURIComponent(notification.id)}/${read ? "read" : "unread"}`, { method: "PATCH" });
      const updated = result.notification ? normalizeNotification(result.notification) : { ...notification, readAt: read ? new Date().toISOString() : "" };
      state.notifications = state.notifications.map((item) => item.id === notification.id ? updated : item);
      applyUnreadCount(result);
      renderNotificationList();
      if (options.focusId) focusNotificationRow(options.focusId);
      return true;
    } catch (error) {
      if (!options.quiet) showMessage(error.message || "Bildirim durumu kaydedilemedi.", true);
      else showMessage(error.message || "Bildirim açılamadı.", true);
      return false;
    } finally {
      state.pending.delete(key);
      setButtonBusy(button, false);
    }
  }

  async function deleteNotification(notification, button) {
    const key = `delete:${notification.id}`;
    if (state.pending.has(key)) return;
    state.pending.add(key);
    setButtonBusy(button, true);
    try {
      const result = await request(`${API_ROOT}/${encodeURIComponent(notification.id)}`, { method: "DELETE" });
      state.suppressedIds.add(notification.id);
      state.expandedIds.delete(notification.id);
      state.notifications = state.notifications.filter((item) => item.id !== notification.id);
      if (state.nextCursor === notification.id) state.nextCursor = "";
      applyUnreadCount(result);
      renderNotificationList();
      addUndoItem(notification);
    } catch (error) {
      await syncNotificationState();
      showMessage(error.message || "Bildirim silinemedi.", true);
    } finally {
      state.pending.delete(key);
      setButtonBusy(button, false);
    }
  }

  function addUndoItem(notification) {
    removeUndoItem(notification.id);
    const timer = window.setTimeout(() => removeUndoItem(notification.id), 5000);
    state.undoItems.set(notification.id, { notification, timer });
    renderUndoItems();
  }

  function handleUndoClick(event) {
    const button = event.target.closest("[data-notification-undo]");
    if (!button) return;
    void undoNotification(String(button.dataset.notificationUndo || ""), button);
  }

  async function undoNotification(notificationId, button) {
    const item = state.undoItems.get(notificationId);
    const key = `undo:${notificationId}`;
    if (!item || state.pending.has(key)) return;
    state.pending.add(key);
    setButtonBusy(button, true, "Geri alınıyor…");
    try {
      const result = await request(`${API_ROOT}/${encodeURIComponent(notificationId)}/undo-delete`, { method: "POST" });
      const restored = result.notification ? normalizeNotification(result.notification) : item.notification;
      state.suppressedIds.delete(notificationId);
      state.notifications = sortNotifications(mergeUnique(state.notifications, [restored]));
      applyUnreadCount(result);
      removeUndoItem(notificationId);
      renderNotificationList();
      focusNotificationRow(notificationId);
      showMessage("Bildirim geri alındı.");
    } catch (error) {
      await syncNotificationState();
      if (state.notifications.some((notification) => notification.id === notificationId)) removeUndoItem(notificationId);
      showMessage(error.message || "Bildirim geri alınamadı.", true);
    } finally {
      state.pending.delete(key);
      setButtonBusy(button, false);
    }
  }

  function renderUndoItems() {
    const root = elements.personelNotificationUndoRegion;
    if (!root) return;
    root.replaceChildren();
    for (const [notificationId, item] of state.undoItems) {
      const toast = document.createElement("div");
      toast.className = "personel-notification-undo";
      const message = document.createElement("span");
      message.textContent = "Bildirim silindi";
      message.title = item.notification.title;
      const undo = document.createElement("button");
      undo.type = "button";
      undo.dataset.notificationUndo = notificationId;
      undo.textContent = "Geri Al";
      undo.setAttribute("aria-label", `${item.notification.title} bildirimini geri al`);
      toast.append(message, undo);
      root.append(toast);
    }
    root.hidden = state.undoItems.size === 0;
  }

  function removeUndoItem(notificationId) {
    const item = state.undoItems.get(notificationId);
    if (item?.timer) window.clearTimeout(item.timer);
    state.undoItems.delete(notificationId);
    renderUndoItems();
  }

  function clearUndoItems() {
    for (const item of state.undoItems.values()) if (item?.timer) window.clearTimeout(item.timer);
    state.undoItems.clear();
    renderUndoItems();
  }

  function focusNotificationRow(notificationId) {
    window.requestAnimationFrame(() => {
      const card = Array.from(elements.personelNotificationList?.querySelectorAll("[data-notification-id]") || [])
        .find((candidate) => candidate.dataset.notificationId === notificationId);
      card?.querySelector('[data-notification-action="open"]')?.focus({ preventScroll: true });
    });
  }

  async function syncNotificationState() {
    await Promise.allSettled([loadNotifications(), refreshUnreadCount()]);
  }

  function setButtonBusy(button, busy, text) {
    if (!button) return;
    if (!button.dataset.notificationOriginal) button.dataset.notificationOriginal = button.innerHTML;
    button.disabled = busy;
    if (busy) {
      button.setAttribute("aria-busy", "true");
      if (text) button.textContent = text;
    } else {
      button.removeAttribute("aria-busy");
      button.innerHTML = button.dataset.notificationOriginal;
    }
  }

  function showMessage(message, error) {
    if (!elements.personelNotificationMessage) return;
    elements.personelNotificationMessage.textContent = message || "";
    elements.personelNotificationMessage.classList.toggle("is-error", Boolean(message && error));
  }

  function showLoadError() {
    const message = elements.personelNotificationMessage;
    if (!message) return;
    message.replaceChildren();
    const text = document.createElement("span");
    text.textContent = "Bildirimler alınamadı.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "personel-notification-message__retry";
    retry.textContent = "Yeniden Dene";
    retry.addEventListener("click", () => loadNotifications());
    message.append(text, retry);
    message.classList.add("is-error");
  }

  async function loadPreferences() {
    if (!state.active || state.preview) return;
    setPreferencesMessage("Tercihler yükleniyor…");
    try {
      const result = await request(`${API_ROOT}/preferences`);
      state.preferences = { ...DEFAULT_PREFERENCES, ...(result.preferences || result.data || {}) };
      state.capabilities = result.capabilities && typeof result.capabilities === "object" ? { ...result.capabilities } : {};
      if (result.vapidPublicKey && !state.capabilities.vapidPublicKey) state.capabilities.vapidPublicKey = result.vapidPublicKey;
      state.preferencesLoaded = true;
      fillPreferencesForm();
      await renderPushState();
      void loadDevices();
      setPreferencesMessage("");
      window.MenuSuitePWA?.showNotificationPrompt?.();
    } catch (error) {
      setPreferencesMessage(error.message || "Bildirim tercihleri alınamadı.", true);
      renderPushState();
    }
  }

  function fillPreferencesForm() {
    const form = elements.personelNotificationPreferencesForm;
    if (!form) return;
    BOOLEAN_PREFERENCES.forEach((name) => {
      if (form.elements[name]) form.elements[name].checked = Boolean(state.preferences[name]);
    });
    const policyByPreference = {
      taskReminder24h: "task_reminder_24h",
      taskReminder2h: "task_reminder_2h",
      overdueReminder: "task_overdue",
      shiftReminder12h: "shift_reminder_12h",
      shiftReminder2h: "shift_reminder_2h"
    };
    const locks = new Map((Array.isArray(state.preferences.policyLocks) ? state.preferences.policyLocks : [])
      .map((item) => [String(item && item.ruleId || ""), item]));
    Object.entries(policyByPreference).forEach(([name, ruleId]) => {
      const input = form.elements[name];
      const policy = locks.get(ruleId);
      if (!input || !policy) return;
      input.disabled = policy.enabled === false;
      input.title = policy.enabled === false
        ? "Bu zamanlı hatırlatma yönetici tarafından kapalı tutuluyor."
        : "Kişisel tercihiniz, yönetici kuralının izin verdiği kanallarla uygulanır.";
      if (policy.enabled === false) input.checked = false;
    });
    if (form.elements.emailAddress) {
      form.elements.emailAddress.value = state.preferences.emailAddress || "";
    }
    if (elements.personelNotificationEmailSummary) {
      const verifiedEmail = state.preferences.emailVerified && state.preferences.emailAddress
        ? `✓ ${state.preferences.emailAddress}`
        : "Henüz doğrulanmadı";
      elements.personelNotificationEmailSummary.textContent = verifiedEmail;
      elements.personelNotificationEmailSummary.classList.toggle("is-verified", Boolean(state.preferences.emailVerified));
    }
    if (form.elements.emailEnabled) {
      form.elements.emailEnabled.disabled = !state.preferences.emailVerified;
      if (!state.preferences.emailVerified) form.elements.emailEnabled.checked = false;
      form.elements.emailEnabled.title = state.preferences.emailVerified ? "" : "Önce hesap e-postanızı doğrulayın.";
    }
    if (form.elements.quietHoursStart) form.elements.quietHoursStart.value = state.preferences.quietHoursStart || "22:00";
    if (form.elements.quietHoursEnd) form.elements.quietHoursEnd.value = state.preferences.quietHoursEnd || "07:00";
    toggleQuietHourInputs();
    if (form.elements.quietHoursEnabled && !form.elements.quietHoursEnabled.dataset.bound) {
      form.elements.quietHoursEnabled.dataset.bound = "true";
      form.elements.quietHoursEnabled.addEventListener("change", toggleQuietHourInputs);
    }
  }

  function toggleQuietHourInputs() {
    const form = elements.personelNotificationPreferencesForm;
    if (!form) return;
    const enabled = Boolean(form.elements.quietHoursEnabled?.checked);
    if (elements.personelNotificationQuietTimes) elements.personelNotificationQuietTimes.hidden = !enabled;
    [form.elements.quietHoursStart, form.elements.quietHoursEnd].forEach((input) => {
      if (input) input.disabled = !enabled;
    });
  }

  function readPreferencesForm() {
    const form = elements.personelNotificationPreferencesForm;
    const next = { ...state.preferences, timezone: "Europe/Istanbul" };
    BOOLEAN_PREFERENCES.forEach((name) => { next[name] = Boolean(form?.elements[name]?.checked); });
    next.emailAddress = String(form?.elements.emailAddress?.value || "").trim().toLocaleLowerCase("tr-TR");
    next.quietHoursStart = String(form?.elements.quietHoursStart?.value || "22:00");
    next.quietHoursEnd = String(form?.elements.quietHoursEnd?.value || "07:00");
    next.pushEnabled = Boolean(state.preferences.pushEnabled);
    return next;
  }

  async function savePreferences(event) {
    event.preventDefault();
    if (!state.active || state.preview || state.pending.has("preferences")) return;
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const payload = readPreferencesForm();
    if (payload.emailEnabled && (!state.preferences.emailVerified || !isValidEmail(payload.emailAddress))) {
      setPreferencesMessage("E-posta bildirimleri için önce hesap e-postanızı doğrulayın.", true);
      elements.personelNotificationManageEmail?.focus();
      return;
    }
    state.pending.add("preferences");
    setButtonBusy(button, true, "Kaydediliyor…");
    setPreferencesMessage("");
    try {
      const result = await request(`${API_ROOT}/preferences`, { method: "PUT", body: payload });
      state.preferences = { ...DEFAULT_PREFERENCES, ...(result.preferences || payload) };
      state.capabilities = result.capabilities && typeof result.capabilities === "object" ? result.capabilities : state.capabilities;
      fillPreferencesForm();
      await renderPushState();
      setPreferencesMessage("Bildirim tercihleri kaydedildi.");
      document.dispatchEvent(new CustomEvent("menu-suite:pwa-form-clean", { detail: { form } }));
    } catch (error) {
      setPreferencesMessage(error.message || "Bildirim tercihleri kaydedilemedi.", true);
    } finally {
      state.pending.delete("preferences");
      setButtonBusy(button, false);
    }
  }

  function setPreferencesMessage(message, error) {
    if (!elements.personelNotificationPreferencesState) return;
    elements.personelNotificationPreferencesState.textContent = message || "";
    elements.personelNotificationPreferencesState.classList.toggle("is-error", Boolean(message && error));
  }

  function openAccountSecurity() {
    Promise.resolve(window.MenuSuitePersonelShell?.ensureAccountSecurity?.()).then(() => {
      const card = document.querySelector('[data-account-security][data-account-scope="personel"]');
      card?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      card?.querySelector("[data-account-email]")?.focus({ preventScroll: true });
      return window.MenuSuiteAccountSecurity?.refresh("personel");
    }).catch(() => setPreferencesMessage("Hesap güvenliği yüklenemedi.", true));
  }

  function notificationDeviceId() {
    let value = "";
    try { value = window.localStorage.getItem(DEVICE_STORAGE_KEY) || ""; } catch (_error) {}
    if (value) return value;
    value = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    try { window.localStorage.setItem(DEVICE_STORAGE_KEY, value); } catch (_error) {}
    return value;
  }

  function notificationDeviceName() {
    const platform = String(navigator.userAgentData?.platform || navigator.platform || "Tarayıcı").slice(0, 60);
    const standalone = window.matchMedia("(display-mode: standalone)").matches ? "PWA" : "Web";
    return `${platform} · ${standalone}`;
  }

  function notificationDeviceHeaders() {
    return {
      "X-Menu-Suite-Device-Id": notificationDeviceId(),
      "X-Menu-Suite-App-Id": "personel",
      "X-Menu-Suite-App-Target": "personel"
    };
  }

  async function loadDevices(force = false) {
    if (!state.active || state.preview || !elements.personelNotificationDevices || state.devicesLoading || (!force && state.devicesLoaded)) return;
    state.devicesLoading = true;
    if (elements.personelNotificationDevicesCount) elements.personelNotificationDevicesCount.textContent = "(…)";
    elements.personelNotificationDevices.replaceChildren(createDeviceEmpty("Bağlı cihazlar yükleniyor…"));
    if (elements.personelNotificationDevicesRefresh) elements.personelNotificationDevicesRefresh.disabled = true;
    try {
      const result = await request(`${API_ROOT}/push-subscriptions`, { headers: notificationDeviceHeaders() });
      state.devices = Array.isArray(result.devices) ? result.devices : Array.isArray(result.subscriptions) ? result.subscriptions : [];
      state.devicesLoaded = true;
      renderDevices();
      void renderPushState();
    } catch (error) {
      elements.personelNotificationDevices.replaceChildren(createDeviceEmpty(error.message || "Bağlı cihazlar alınamadı."));
    } finally {
      state.devicesLoading = false;
      if (elements.personelNotificationDevicesRefresh) elements.personelNotificationDevicesRefresh.disabled = false;
    }
  }

  function renderDevices() {
    const root = elements.personelNotificationDevices;
    if (!root) return;
    if (elements.personelNotificationDevicesCount) {
      elements.personelNotificationDevicesCount.textContent = `(${state.devices.length})`;
    }
    root.replaceChildren();
    if (!state.devices.length) {
      root.append(createDeviceEmpty("Bu hesaba bağlı bildirim cihazı yok."));
      return;
    }
    const currentId = notificationDeviceId();
    state.devices.forEach((device) => {
      const id = String(device.id || device.subscriptionId || "");
      if (!id) return;
      const current = Boolean(device.current ?? device.isCurrent) || String(device.deviceId || "") === currentId;
      const row = document.createElement("div");
      row.className = `notification-device-row${current ? " is-current" : ""}`;
      const copy = document.createElement("div");
      copy.className = "notification-device-copy";
      const title = document.createElement("strong");
      title.textContent = String(device.deviceName || device.name || "Tarayıcı cihazı");
      if (current) {
        const badge = document.createElement("span");
        badge.className = "notification-device-current";
        badge.textContent = "Bu cihaz";
        title.append(" · ", badge);
      }
      const time = document.createElement("time");
      time.textContent = `Son kullanım: ${absoluteTime(device.lastSeenAt || device.updatedAt || device.createdAt)}`;
      copy.append(title, time);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "ui-button ui-button--ghost ui-button--sm";
      remove.dataset.notificationDeviceRemove = id;
      remove.dataset.currentDevice = current ? "true" : "false";
      remove.textContent = "Kaldır";
      row.append(copy, remove);
      root.append(row);
    });
  }

  function createDeviceEmpty(message) {
    const node = document.createElement("div");
    node.className = "notification-device-empty";
    node.textContent = message;
    return node;
  }

  async function handleDeviceClick(event) {
    const button = event.target.closest("[data-notification-device-remove]");
    if (!button || button.disabled) return;
    const id = String(button.dataset.notificationDeviceRemove || "");
    if (!id) return;
    if (button.dataset.confirmRemove !== "true") {
      button.dataset.confirmRemove = "true";
      button.dataset.defaultLabel = button.textContent || "Kaldır";
      button.textContent = "Tekrar tıklayın";
      setPreferencesMessage("Bu cihazın bildirim bağlantısını kaldırmak için düğmeye tekrar tıklayın.");
      window.setTimeout(() => {
        if (!button.isConnected || button.dataset.confirmRemove !== "true") return;
        delete button.dataset.confirmRemove;
        button.textContent = button.dataset.defaultLabel || "Kaldır";
      }, 4000);
      return;
    }
    delete button.dataset.confirmRemove;
    button.textContent = button.dataset.defaultLabel || "Kaldır";
    button.disabled = true;
    try {
      await request(`${API_ROOT}/push-subscriptions/${encodeURIComponent(id)}`, { method: "DELETE", headers: notificationDeviceHeaders() });
      if (button.dataset.currentDevice === "true") {
        const subscription = await currentSubscription().catch(() => null);
        await subscription?.unsubscribe().catch(() => false);
      }
      state.devices = state.devices.filter((device) => String(device.id || device.subscriptionId || "") !== id);
      renderDevices();
      await renderPushState();
      setPreferencesMessage("Bildirim cihazı kaldırıldı.");
    } catch (error) {
      setPreferencesMessage(error.message || "Bildirim cihazı kaldırılamadı.", true);
      button.disabled = false;
    }
  }

  async function renderPushState() {
    const browserSupported = browserSupportsPush();
    let subscription = null;
    if (!elements.personelPushToggle || !elements.personelPushStatus) return;

    if (elements.personelPushTest) {
      elements.personelPushTest.hidden = true;
      elements.personelPushTest.disabled = true;
    }
    if (!state.active || !state.preferencesLoaded) {
      elements.personelPushStatus.textContent = state.active ? "Durum denetleniyor…" : "Oturum açtıktan sonra bildirim durumu denetlenir.";
      elements.personelPushToggle.textContent = "Bildirimleri Aç";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (isIosDevice() && !isStandaloneMode()) {
      elements.personelPushStatus.textContent = "iPhone/iPad’de bildirimleri kullanmak için siteyi Safari’den Ana Ekran’a ekleyip oradan açın.";
      elements.personelPushToggle.textContent = "Ana Ekran gerekli";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (!browserSupported) {
      elements.personelPushStatus.textContent = "Bu tarayıcı PWA bildirimlerini desteklemiyor. Uygulama içi bildirimler açık kalır.";
      elements.personelPushToggle.textContent = "Desteklenmiyor";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (!window.isSecureContext) {
      elements.personelPushStatus.textContent = "Telefon bildirimleri için güvenli HTTPS bağlantısı gerekir.";
      elements.personelPushToggle.textContent = "Güvenli bağlantı gerekli";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (Notification.permission === "denied") {
      elements.personelPushStatus.textContent = "Tarayıcı bildirim izni kapalı. Site ayarlarından izin verin.";
      elements.personelPushToggle.textContent = "İzin kapalı";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (state.capabilities.pushSupported === false || !vapidPublicKey()) {
      elements.personelPushStatus.textContent = "Telefon bildirimleri sunucuda henüz etkinleştirilmemiş.";
      elements.personelPushToggle.textContent = "Yapılandırılmamış";
      elements.personelPushToggle.disabled = true;
      return;
    }
    if (state.pushIssue) {
      elements.personelPushStatus.textContent = state.pushIssue.message;
      elements.personelPushToggle.textContent = "Tekrar dene";
      elements.personelPushToggle.dataset.pushAction = "enable";
      elements.personelPushToggle.disabled = state.pending.has("push");
      return;
    }
    try {
      subscription = await currentSubscription();
    } catch (_error) {
      elements.personelPushStatus.textContent = "Bildirim hizmeti başlatılamadı. Sayfayı yenileyip tekrar deneyin.";
      elements.personelPushToggle.textContent = "Tekrar dene";
      elements.personelPushToggle.dataset.pushAction = "enable";
      elements.personelPushToggle.disabled = state.pending.has("push");
      return;
    }
    elements.personelPushToggle.disabled = state.pending.has("push");
    if (subscription) {
      const device = currentPushDevice();
      const name = String(device?.deviceName || device?.name || notificationDeviceName());
      const registeredAt = device && (device.lastSeenAt || device.updatedAt || device.createdAt);
      elements.personelPushStatus.textContent = registeredAt
        ? `Bildirimler açık · ${name} · Son kayıt: ${absoluteTime(registeredAt)}`
        : `Bildirimler açık · ${name}`;
      elements.personelPushToggle.textContent = "Tarayıcı bildirimlerini kapat";
      elements.personelPushToggle.dataset.pushAction = "disable";
      if (elements.personelPushTest) {
        elements.personelPushTest.hidden = false;
        elements.personelPushTest.disabled = state.pending.has("push-test");
      }
    } else {
      elements.personelPushStatus.textContent = Notification.permission === "granted"
        ? "İzin verildi; bu cihaz henüz abone değil."
        : "İzin yalnızca Bildirimleri Aç düğmesine bastığınızda istenir.";
      elements.personelPushToggle.textContent = "Bildirimleri Aç";
      elements.personelPushToggle.dataset.pushAction = "enable";
    }
  }

  async function togglePushSubscription() {
    if (!state.active || state.preview || state.pending.has("push") || !supportsPush()) return;
    state.pending.add("push");
    state.pushIssue = null;
    elements.personelPushToggle.disabled = true;
    try {
      const subscription = await currentSubscription();
      if (subscription && elements.personelPushToggle.dataset.pushAction === "disable") await disablePush(subscription);
      else await enablePush();
      await renderPushState();
    } catch (error) {
      state.pushIssue = normalizePushIssue(error);
      setPreferencesMessage(error.message || "Tarayıcı bildirimi ayarlanamadı.", true);
    } finally {
      state.pending.delete("push");
      await renderPushState();
    }
  }

  async function enablePush() {
    const key = vapidPublicKey();
    if (!key || state.capabilities.pushSupported === false) {
      throw pushError("server-config", "Telefon bildirimleri sunucuda henüz etkinleştirilmemiş.");
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      throw pushError("permission-denied", "Tarayıcı bildirim izni kapalı. Site ayarlarından izin verin.");
    }
    let registration;
    try {
      registration = await ensurePersonelServiceWorker();
    } catch (_error) {
      throw pushError("service-worker", "Bildirim hizmeti başlatılamadı. Sayfayı yenileyip tekrar deneyin.");
    }
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeBase64Url(key)
        });
      } catch (_error) {
        throw pushError("browser-subscription", "Tarayıcı bildirim aboneliği oluşturulamadı. Site ayarlarını kontrol edip tekrar deneyin.");
      }
    }
    try {
      await request(`${API_ROOT}/push-subscriptions`, {
        method: "POST",
        body: {
          subscription: subscription.toJSON(),
          deviceId: notificationDeviceId(),
          deviceName: notificationDeviceName()
        },
        headers: notificationDeviceHeaders()
      });
    } catch (_error) {
      throw pushError("backend-subscription", "Bildirim aboneliği sunucuya kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.");
    }
    state.pushIssue = null;
    state.preferences.pushEnabled = true;
    await persistPushPreference(true);
    state.devices = [];
    await loadDevices(true);
    setPreferencesMessage("Tarayıcı bildirimleri bu cihaz için etkinleştirildi.");
  }

  async function sendPushTest() {
    if (!state.active || state.preview || state.pending.has("push-test") || !supportsPush()) return;
    const subscription = await currentSubscription().catch(() => null);
    if (!subscription) {
      setPreferencesMessage("Önce bu cihazda bildirimleri açın.", true);
      await renderPushState();
      return;
    }
    state.pending.add("push-test");
    if (elements.personelPushTest) elements.personelPushTest.disabled = true;
    setPreferencesMessage("Test bildirimi gönderiliyor…");
    try {
      const result = await request(`${API_ROOT}/test`, {
        method: "POST",
        body: { channels: ["push"], deviceId: notificationDeviceId() },
        headers: notificationDeviceHeaders()
      });
      if (result.subscription) {
        const delivered = result.subscription;
        const deliveredId = String(delivered.id || delivered.subscriptionId || "");
        state.devices = state.devices.map((device) => String(device.id || device.subscriptionId || "") === deliveredId
          ? { ...device, ...delivered }
          : device);
        renderDevices();
      }
      setPreferencesMessage(result.message || "Test bildirimi bu cihaza gönderildi.");
    } catch (error) {
      setPreferencesMessage(error.message || "Test bildirimi gönderilemedi.", true);
    } finally {
      state.pending.delete("push-test");
      await renderPushState();
    }
  }

  async function disablePush(existingSubscription) {
    const subscription = existingSubscription || await currentSubscription().catch(() => null);
    if (subscription) {
      await request(`${API_ROOT}/push-subscriptions`, {
        method: "DELETE",
        body: { endpoint: subscription.endpoint },
        headers: notificationDeviceHeaders()
      });
      await subscription.unsubscribe().catch(() => false);
    }
    state.preferences.pushEnabled = false;
    state.pushIssue = null;
    await persistPushPreference(false);
    state.devices = [];
    await loadDevices(true);
    setPreferencesMessage("Tarayıcı bildirimleri bu cihaz için kapatıldı.");
  }

  async function persistPushPreference(enabled) {
    const payload = { ...readPreferencesForm(), pushEnabled: Boolean(enabled) };
    const result = await request(`${API_ROOT}/preferences`, { method: "PUT", body: payload });
    state.preferences = { ...DEFAULT_PREFERENCES, ...(result.preferences || payload) };
    fillPreferencesForm();
  }

  async function beforeLogout() {
    stopRealtime();
    if (!state.active || !supportsPush()) return;
    const subscription = await currentSubscription().catch(() => null);
    if (!subscription) return;
    await request(`${API_ROOT}/push-subscriptions`, {
      method: "DELETE",
      body: { endpoint: subscription.endpoint },
      headers: notificationDeviceHeaders()
    }).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
  }

  function supportsPush() {
    return Boolean(window.isSecureContext && browserSupportsPush());
  }

  function browserSupportsPush() {
    return Boolean("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  }

  function vapidPublicKey() {
    return String(state.capabilities.vapidPublicKey || state.capabilities.publicKey || state.capabilities.vapidKey || "").trim();
  }

  async function ensurePersonelServiceWorker() {
    if (window.MenuSuitePWA && typeof window.MenuSuitePWA.ensureServiceWorker === "function") {
      return window.MenuSuitePWA.ensureServiceWorker();
    }
    const existing = await navigator.serviceWorker.getRegistration("/personel/");
    if (existing) return existing;
    return navigator.serviceWorker.register("/personel/sw.js", { scope: "/personel/", updateViaCache: "none" });
  }

  async function currentSubscription() {
    if (!supportsPush()) return null;
    const registration = await navigator.serviceWorker.getRegistration("/personel/");
    return registration ? registration.pushManager.getSubscription() : null;
  }

  function currentPushDevice() {
    const currentId = notificationDeviceId();
    return state.devices.find((device) => Boolean(device.current ?? device.isCurrent) || String(device.deviceId || "") === currentId) || null;
  }

  function isIosDevice() {
    return /iPad|iPhone|iPod/.test(String(navigator.userAgent || ""))
      || navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1;
  }

  function isStandaloneMode() {
    return Boolean(window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true);
  }

  function pushError(code, message) {
    const error = new Error(message);
    error.pushCode = code;
    return error;
  }

  function normalizePushIssue(error) {
    return {
      code: String(error && error.pushCode || "unknown"),
      message: String(error && error.message || "Tarayıcı bildirimi ayarlanamadı.")
    };
  }

  function decodeBase64Url(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from(raw, (character) => character.charCodeAt(0));
  }

  function connectEvents() {
    if (!state.active || state.preview || !window.EventSource || navigator.onLine === false) {
      if (!window.EventSource) startPolling();
      return;
    }
    stopPolling();
    if (state.gatewayBound) return;
    state.gatewayBound = true;
    document.addEventListener("personel:gateway-event", handleNotificationGatewayEvent);
  }

  function handleNotificationGatewayEvent(event) {
    const payload = event && event.detail || {};
    if (!state.active || payload.topic !== "notification") return;
    void refreshUnreadCount();
    void playRecentPanelNotification(payload.timestamp);
    if (state.modalOpen) void loadNotifications();
  }

  function unlockPanelSound() {
    state.soundUnlocked = true;
  }

  async function playRecentPanelNotification(eventTimestamp) {
    if (!state.soundUnlocked || document.visibilityState !== "visible" || panelSoundQuietNow()) return;
    try {
      const result = await request(`${API_ROOT}?limit=10`);
      const eventTime = Date.parse(eventTimestamp || new Date().toISOString());
      const candidate = notificationArray(result).map(normalizeNotification)
        .filter((item) => item.id && item.metadata?.soundEnabled === true)
        .filter((item) => {
          const updated = Date.parse(item.updatedAt || item.createdAt || "");
          return Number.isFinite(updated) && Math.abs(updated - eventTime) <= 15000;
        })
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
      if (candidate) schedulePersonelNotificationSound(candidate.id);
    } catch (_error) {}
  }

  function schedulePersonelNotificationSound(notificationId) {
    const id = String(notificationId || "");
    if (!id) return;
    const now = Date.now();
    let claims = {};
    try { claims = JSON.parse(window.localStorage.getItem(SOUND_CLAIMS_STORAGE_KEY) || "{}"); } catch (_error) {}
    for (const [key, claim] of Object.entries(claims)) if (!claim || now - Number(claim.at || 0) > 7 * 24 * 60 * 60 * 1000) delete claims[key];
    if (claims[id]) return;
    claims[id] = { owner: soundOwner, at: now };
    try { window.localStorage.setItem(SOUND_CLAIMS_STORAGE_KEY, JSON.stringify(claims)); } catch (_error) { return; }
    window.setTimeout(() => {
      let current = {};
      try { current = JSON.parse(window.localStorage.getItem(SOUND_CLAIMS_STORAGE_KEY) || "{}"); } catch (_error) {}
      if (current[id]?.owner !== soundOwner || panelSoundQuietNow()) return;
      playPersonelNotificationTone();
    }, 50);
  }

  function panelSoundQuietNow() {
    if (state.preferences.quietHoursEnabled !== true) return false;
    const timezone = String(state.preferences.timezone || "Europe/Istanbul");
    let hour = new Date().getHours();
    let minute = new Date().getMinutes();
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
      hour = Number(parts.hour); minute = Number(parts.minute);
    } catch (_error) {}
    const parse = (value, fallback) => {
      const match = /^(\d{2}):(\d{2})$/.exec(String(value || fallback));
      return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
    };
    const current = hour * 60 + minute;
    const start = parse(state.preferences.quietHoursStart, "22:00");
    const end = parse(state.preferences.quietHoursEnd, "08:00");
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  function playPersonelNotificationTone() {
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

  function handleGatewayStatus(event) {
    if (!state.active) return;
    state.gatewayConnected = Boolean(event && event.detail && event.detail.connected);
    if (state.gatewayConnected) {
      state.pollDelayMs = FALLBACK_POLL_MS;
      stopPolling();
    } else if (document.visibilityState !== "hidden" && navigator.onLine !== false) startPolling();
  }

  function startPolling() {
    if (state.pollTimer || !state.active || state.preview || state.gatewayConnected
      || document.visibilityState === "hidden" || navigator.onLine === false) return;
    state.pollTimer = window.setTimeout(async () => {
      state.pollTimer = null;
      if (!state.active || state.gatewayConnected || document.visibilityState === "hidden" || navigator.onLine === false) return;
      const success = await refreshUnreadCount();
      if (state.modalOpen && success && Date.now() - state.lastLoadedAt >= FALLBACK_POLL_MS) await loadNotifications();
      state.pollDelayMs = success ? FALLBACK_POLL_MS : Math.min(120000, Math.max(FALLBACK_POLL_MS, state.pollDelayMs * 2));
      startPolling();
    }, state.pollDelayMs);
  }

  function stopPolling() {
    if (!state.pollTimer) return;
    window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function stopRealtime() {
    stopPolling();
  }

  function handleOnline() {
    if (!state.active) return;
    void refreshUnreadCount();
    connectEvents();
    if (!state.gatewayConnected) startPolling();
  }

  function handleOffline() {
    state.gatewayConnected = false;
    stopRealtime();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") {
      stopPolling();
      return;
    }
    if (!state.active || state.preview) return;
    void refreshUnreadCount();
    if (!state.gatewayConnected && navigator.onLine !== false) startPolling();
  }

  async function navigateToNotification(notification) {
    const destination = resolveDestination(notification);
    if (window.MenuSuitePersonelShell?.openNotificationRecord) {
      try {
        await window.MenuSuitePersonelShell.openNotificationRecord(destination.section, destination.entityId);
        if (destination.section === "shift" && destination.weekStart) alignShiftWeek(destination.weekStart);
        closeDialog();
      } catch (error) { await openDialog(); showMessage(error.message || "İlgili kayıt açılamadı.", true); }
      return;
    }
    const button = document.querySelector(`.personel-nav [data-section="${destination.section}"]`);
    if (!button) {
      window.MenuSuitePersonelShell?.navigate?.(destination.section);
    } else {
      button.click();
    }
    if (destination.section === "tasks" && destination.entityId) {
      waitForElement(`[data-task-toggle="${cssEscape(destination.entityId)}"]`, (target) => {
        if (target.getAttribute("aria-expanded") !== "true") target.click();
        target.closest(".wf-task-card")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
      });
    } else if (destination.section === "materialRequest") {
      Promise.resolve(window.MenuSuitePersonelWorkforce?.openOpenRequests?.()).then(() => {
        if (!destination.entityId) return;
        waitForElement(`[data-material-request-id="${cssEscape(destination.entityId)}"]`, (target) => {
          target.open = true;
          target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
        });
      });
    } else if (destination.section === "shift" && destination.weekStart) {
      waitForElement(".wf-week-controls", () => alignShiftWeek(destination.weekStart));
    } else if (destination.section === "recipe" && destination.entityId) {
      window.setTimeout(() => {
        elements.recipeFrame?.contentWindow?.postMessage({
          type: "menu-suite:open-recipe-assignment",
          entityId: destination.entityId
        }, window.location.origin);
      }, 500);
    }
  }

  function resolveDestination(notification) {
    const fallback = { section: CATEGORY_SECTIONS[notification.category] || "recipe", entityId: notification.entityType === "shift_plan" ? "" : notification.entityId || "", weekStart: "" };
    if (!notification.deepLink) return fallback;
    try {
      const url = new URL(notification.deepLink, window.location.origin);
      if (url.origin !== window.location.origin || !(url.pathname === "/personel" || url.pathname.startsWith("/personel/"))) return fallback;
      const section = normalizePersonelNotificationSection(url.searchParams.get("section"))
        || normalizePersonelNotificationSection(url.hash && decodeURIComponent(url.hash.slice(1)))
        || sectionFromPath(url.pathname)
        || fallback.section;
      if (!Object.values(CATEGORY_SECTIONS).includes(section)) return fallback;
      return {
        section,
        entityId: url.searchParams.get("productId") || url.searchParams.get("taskId") || url.searchParams.get("requestId") || url.searchParams.get("entityId") || url.searchParams.get("assignmentId") || fallback.entityId,
        weekStart: validDateKey(url.searchParams.get("weekStart"))
      };
    } catch (_error) {
      return fallback;
    }
  }

  function sectionFromPath(pathname) {
    if (/yapilacaklar|tasks/i.test(pathname)) return "tasks";
    if (/material.?request|malzeme.?talep/i.test(pathname)) return "materialRequest";
    if (/shift|vardiya/i.test(pathname)) return "shift";
    if (/recete|recipe/i.test(pathname)) return "recipe";
    return "";
  }

  function normalizePersonelNotificationSection(value) {
    const text = String(value || "").trim().toLocaleLowerCase("tr-TR");
    const aliases = {
      task: "tasks", tasks: "tasks", gorev: "tasks", görev: "tasks", yapilacaklar: "tasks", yapılacaklar: "tasks",
      materialrequest: "materialRequest", materialrequests: "materialRequest", "material-request": "materialRequest", malzemetalebi: "materialRequest", "malzeme-talebi": "materialRequest",
      shift: "shift", shifts: "shift", vardiya: "shift",
      stock: "stock", stok: "stock", shipment: "shipment", shipments: "shipment", sevkiyat: "shipment",
      recipe: "recipe", recete: "recipe", reçete: "recipe",
      profile: "profile", profil: "profile"
    };
    return aliases[text] || "";
  }

  function alignShiftWeek(weekStart) {
    const target = startOfWeekDate(new Date(`${weekStart}T12:00:00`));
    const current = startOfWeekDate(new Date());
    if (!Number.isFinite(target.getTime()) || !Number.isFinite(current.getTime())) return;
    const weekDifference = Math.round((target.getTime() - current.getTime()) / 604800000);
    document.querySelector('.wf-week-controls [data-week="today"]')?.click();
    const direction = weekDifference < 0 ? "-1" : "1";
    for (let index = 0; index < Math.min(104, Math.abs(weekDifference)); index += 1) {
      document.querySelector(`.wf-week-controls [data-week="${direction}"]`)?.click();
    }
    document.querySelector(".wf-shift-head")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function waitForElement(selector, callback) {
    const existing = document.querySelector(selector);
    if (existing) {
      callback(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const target = document.querySelector(selector);
      if (!target) return;
      observer.disconnect();
      callback(target);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 5000);
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = {
      Accept: "application/json",
      "X-Menu-Suite-App-Id": "personel",
      "X-Menu-Suite-App-Target": "personel",
      ...(options.headers || {})
    };
    const init = { method, credentials: "include", headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İstek tamamlanamadı.");
      error.status = response.status;
      if ((response.status === 401 || response.status === 403) && state.active && !state.sessionEndNotified) {
        state.sessionEndNotified = true;
        stopRealtime();
        document.dispatchEvent(new CustomEvent("personel:session-ended", {
          detail: { source: "personel-notifications", status: response.status, message: error.message }
        }));
      }
      throw error;
    }
    return result;
  }

  function categoryIcon(category) {
    if (category === "task") return "checklist";
    if (category === "materialRequest") return "box";
    if (category === "shift") return "calendar";
    if (category === "shipment") return "truck";
    if (category === "stock") return "box";
    return "bell";
  }

  function icon(name) {
    const paths = {
      bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
      checklist: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m8 9 1.5 1.5L12 8M14 9h2M8 15l1.5 1.5L12 14M14 15h2"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18"/>',
      truck: '<path d="M3 6h11v11H3zM14 10h4l3 4v3h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>',
      box: '<path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"/>',
      delete: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
      archive: '<path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>',
      restore: '<path d="M4 8h16v12H4zM3 4h18v4H3zM8 14h8M11 11l-3 3 3 3"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      dot: '<circle cx="12" cy="12" r="4"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      warning: '<path d="M12 3 2.5 20h19zM12 9v4M12 17h.01"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.bell}</svg>`;
  }

  function relativeTime(value) {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "Zaman bilgisi yok";
    const difference = time - Date.now();
    const absolute = Math.abs(difference);
    const formatter = new Intl.RelativeTimeFormat("tr-TR", { numeric: "auto" });
    if (absolute < 60000) return "şimdi";
    if (absolute < 3600000) return formatter.format(Math.round(difference / 60000), "minute");
    if (absolute < 86400000) return formatter.format(Math.round(difference / 3600000), "hour");
    if (absolute < 604800000) return formatter.format(Math.round(difference / 86400000), "day");
    return absoluteTime(value);
  }

  function absoluteTime(value) {
    const date = new Date(value || "");
    if (!Number.isFinite(date.getTime())) return "Zaman bilgisi yok";
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(date);
  }

  function validDateKey(value) {
    const text = String(value || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function startOfWeekDate(value) {
    const date = new Date(value);
    const day = date.getDay() || 7;
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - day + 1);
    return date;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")) && String(value).length <= 254;
  }

  function cssEscape(value) {
    return window.CSS && typeof window.CSS.escape === "function"
      ? window.CSS.escape(String(value))
      : String(value).replace(/["\\]/g, "\\$&");
  }

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  window.MenuSuitePersonelNotifications = Object.freeze({
    beforeLogout,
    refresh: () => Promise.allSettled([loadNotifications(), loadPreferences()]),
    open: openDialog,
    close: closeDialog
  });
})();
