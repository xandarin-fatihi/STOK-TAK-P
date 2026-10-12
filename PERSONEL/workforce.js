(() => {
  "use strict";

  const PREVIEW_TOKEN = readPreviewToken();
  const UNITS = ["koli", "paket", "adet", "kg", "gr", "litre", "ml", "şişe"];
  const SHIPMENT_DRAFT_STORAGE_PREFIX = "menu-suite.personel.shipment-draft.v1:";
  const MATERIAL_DRAFT_STORAGE_PREFIX = "menu-suite.personel.material-request-draft.v1:";
  const SHIPMENT_DIALOG_TRANSITION_MS = 180;
  const SHIPMENT_HISTORY_PAGE_SIZE = 8;
  let shipmentDialogReturnFocus = null;
  let shipmentDialogHideTimer = 0;
  let shipmentDetailReturnFocus = null;
  let materialDialogReturnFocus = null;
  const state = {
    section: "",
    data: emptyData(),
    cart: [],
    shipmentQuery: "",
    shipmentHistoryQuery: "",
    shipmentHistoryPage: 1,
    taskPriority: "all",
    taskStatus: "active",
    openTaskId: "",
    weekStart: startOfWeek(new Date()),
    shipmentNote: "",
    shipmentRequestId: "",
    shipmentComposerOpen: false,
    shipmentDetailId: "",
    shipmentNoteOpen: false,
    shipmentDraftOwner: "",
    shipmentSubmitting: false,
    shipmentSubmitFocus: null,
    shiftRequestId: "",
    shiftRequestFingerprint: "",
    materialQuery: "",
    materialComposerOpen: false,
    materialDetailId: "",
    materialItems: [],
    materialDepartment: "",
    materialEditItemId: "",
    materialRequestId: "",
    materialRequestFingerprint: "",
    materialDraftOwner: "",
    materialReviewOpen: false,
    materialUploading: false,
    materialDuplicateKey: "",
    materialForm: emptyMaterialForm(),
    shiftRequestDraft: {
      date: "",
      endDate: "",
      specificHours: false,
      type: "leave",
      startTime: "",
      endTime: "",
      description: ""
    },
    revision: 0,
    busy: false,
    loaded: false,
    loadedScopes: new Set(),
    staleScopes: new Set(),
    loadPromises: new Map(),
    overviewLoaded: false,
    overviewLoadPromise: null,
    pollingTimer: null,
    gatewayBound: false,
    clientId: createRequestId("personel-workforce-events"),
    sessionEnded: true,
    sessionEndNotified: false
  };

  window.MenuSuitePersonelWorkforce = Object.freeze({
    loadOverview,
    snapshot: overviewSnapshot,
    openPendingShipments,
    openOpenRequests,
    createMaterialRequestFromStock,
    openNotificationRecord
  });

  async function openNotificationRecord(section, entityId) {
    await loadWorkforceData(section, { force: true });
    if (!entityId) { render(section); return; }
    const records = section === "tasks" ? state.data.tasks : section === "shipment" ? state.data.shipments : section === "shift" ? state.data.shiftRequests : state.data.materialRequests;
    const record = (records || []).find(item => String(item.id) === String(entityId));
    if (!record) throw new Error("Bu bildirimdeki kayıt kaldırılmış veya artık erişilemiyor.");
    if (section === "tasks") { state.openTaskId = String(record.id); state.taskStatus = isCompletedStatus(assignment(record).status) ? "completed" : "active"; }
    if (section === "materialRequest") { state.materialDetailId = String(record.id); state.materialQuery = ""; }
    render(section);
    if (section === "shipment") { openShipmentDetail(record.id); return; }
    const selector = section === "tasks" ? `[data-task-toggle="${cssEscape(record.id)}"]` : section === "shift" ? `[data-shift-request-id="${cssEscape(record.id)}"]` : `[data-material-request-id="${cssEscape(record.id)}"]`;
    const target = document.querySelector(selector);
    if (target && section === "materialRequest") { target.hidden = false; target.open = true; }
    target?.scrollIntoView({ block: "center", behavior: "auto" });
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); }
  }

  function operationSkipped(reason) {
    const factory = window.MenuSuiteOperationResults && window.MenuSuiteOperationResults.skipped;
    return typeof factory === "function"
      ? factory(reason)
      : { operationOutcome: "skipped", reason: String(reason || "") };
  }

  function runImmediateOperation(key, button, operation) {
    const coordinator = window.MenuSuiteOperations;
    const promise = !coordinator || typeof coordinator.run !== "function"
      ? Promise.resolve().then(operation)
      : coordinator.run(`personel-workforce:${key}`, operation, {
        button,
        classification: window.MenuSuiteOperationClasses && window.MenuSuiteOperationClasses.IMMEDIATE || "immediate-operation"
      });
    return promise.catch(() => undefined);
  }

  function mount() {
    if (window.__MENU_SUITE_PERSONEL_WORKFORCE_MOUNTED__) return;
    window.__MENU_SUITE_PERSONEL_WORKFORCE_MOUNTED__ = true;
    document.addEventListener("personel:section-change", (event) => {
      const section = event.detail && event.detail.section;
      if (section !== "shipment") {
        if (state.shipmentComposerOpen) closeShipmentComposer({ restoreFocus: false });
        if (state.shipmentDetailId) closeShipmentDetail({ restoreFocus: false });
      }
      if (section !== "materialRequest" && state.materialComposerOpen) closeMaterialComposer({ restoreFocus: false, render: false });
      if (["tasks", "materialRequest", "shipment", "shift"].includes(section)) {
        connectWorkforceEvents();
        openSection(section);
      } else {
        pauseWorkforceEvents();
      }
    });
    document.addEventListener("personel:session-started", handleSessionStarted);
    document.addEventListener("personel:session-ended", handleSessionEnded);
    document.addEventListener("personel:stock-updated", handleStockUpdated);
    document.addEventListener("personel:gateway-status", handleGatewayStatus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();

  function handleSessionStarted(event) {
    const owner = String(event && event.detail && event.detail.userId || "session");
    if (state.shipmentDraftOwner !== owner) {
      state.cart = [];
      state.shipmentNote = "";
      state.shipmentNoteOpen = false;
      state.shipmentRequestId = "";
      state.shipmentDraftOwner = owner;
      restoreShipmentDraft();
    }
    if (state.materialDraftOwner !== owner) {
      state.materialComposerOpen = false;
      state.materialReviewOpen = false;
      materialDialogReturnFocus = null;
      document.body.classList.remove("is-material-request-dialog-open");
      state.materialItems = [];
      state.materialDepartment = "";
      state.materialEditItemId = "";
      state.materialRequestId = "";
      state.materialRequestFingerprint = "";
      state.materialDraftOwner = owner;
      state.materialForm = emptyMaterialForm();
      restoreMaterialDraft();
    }
    state.sessionEnded = false;
    state.sessionEndNotified = false;
    state.loaded = false;
    state.loadedScopes.clear();
    state.staleScopes.clear();
    state.loadPromises.clear();
    state.overviewLoaded = false;
    state.overviewLoadPromise = null;
  }

  function handleSessionEnded() {
    closeShipmentComposer({ restoreFocus: false });
    closeShipmentDetail({ restoreFocus: false });
    persistMaterialDraft();
    clearShipmentDraft();
    state.cart = [];
    state.shipmentNote = "";
    state.shipmentNoteOpen = false;
    state.shipmentRequestId = "";
    state.shipmentDraftOwner = "";
    state.materialItems = [];
    state.materialDepartment = "";
    state.materialEditItemId = "";
    state.materialRequestId = "";
    state.materialRequestFingerprint = "";
    state.materialDraftOwner = "";
    state.materialComposerOpen = false;
    state.materialReviewOpen = false;
    state.materialDetailId = "";
    state.materialForm = emptyMaterialForm();
    materialDialogReturnFocus = null;
    document.body.classList.remove("is-material-request-dialog-open");
    state.sessionEnded = true;
    state.sessionEndNotified = true;
    state.loaded = false;
    state.loadedScopes.clear();
    state.staleScopes.clear();
    state.loadPromises.clear();
    state.overviewLoaded = false;
    state.overviewLoadPromise = null;
    stopWorkforceEvents();
  }

  function startFallbackPolling() {
    if (state.pollingTimer || state.sessionEnded || document.hidden) return;
    state.pollingTimer = window.setInterval(pollWorkforce, 120000);
  }

  function stopPolling() {
    if (!state.pollingTimer) return;
    window.clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }

  function connectWorkforceEvents() {
    if (state.sessionEnded || PREVIEW_TOKEN || document.hidden || !window.EventSource) {
      if (!window.EventSource) startFallbackPolling();
      return;
    }
    stopPolling();
    if (state.gatewayBound) return;
    state.gatewayBound = true;
    document.addEventListener("personel:gateway-event", handleWorkforceGatewayEvent);
  }

  function handleWorkforceGatewayEvent(event) {
    if (state.sessionEnded) return;
    const payload = event && event.detail || {};
    if (payload.topic !== "workforce" && payload.topic !== "shipment") return;
    const incomingRevision = responseRevision(payload, state.revision);
    if (incomingRevision && incomingRevision <= state.revision) return;
    state.revision = Math.max(state.revision, incomingRevision);
    state.overviewLoaded = false;
    state.loadedScopes.forEach((scope) => state.staleScopes.add(scope));
    const activeScope = scopeForSection(state.section);
    if (["tasks", "materialRequest", "shipment", "shift"].includes(state.section) && !state.busy && !isEditingWorkforce()) {
      state.staleScopes.add(activeScope);
      openSection(state.section, { silent: true }).catch(() => {});
    }
  }

  function stopWorkforceEvents() {
    pauseWorkforceEvents();
  }

  function pauseWorkforceEvents() {
    stopPolling();
    state.loadedScopes.forEach((scope) => state.staleScopes.add(scope));
  }

  async function pollWorkforce() {
    if (state.sessionEnded) return;
    const editing = document.activeElement && document.activeElement.closest(".workforce-section");
    if (!document.hidden && !editing && ["tasks", "materialRequest", "shipment", "shift"].includes(state.section) && !state.busy) {
      try {
        const status = await api("/api/workforce/me?scope=revision");
        const incomingRevision = responseRevision(status, state.revision);
        if (incomingRevision > state.revision) {
          state.revision = incomingRevision;
          state.staleScopes.add(scopeForSection(state.section));
          await openSection(state.section, { silent: true });
        }
      } catch (_error) {}
    }
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      stopPolling();
      return;
    }
    connectWorkforceEvents();
    if (!window.EventSource) startFallbackPolling();
    if (!state.sessionEnded && state.staleScopes.has(scopeForSection(state.section)) && !state.busy) openSection(state.section, { silent: true });
  }

  function handleGatewayStatus(event) {
    if (state.sessionEnded) return;
    if (event && event.detail && event.detail.connected) stopPolling();
    else if (["tasks", "materialRequest", "shipment", "shift"].includes(state.section)) startFallbackPolling();
  }

  function handleStockUpdated(event) {
    const stockState = event && event.detail && event.detail.stockState;
    if (!stockState || state.sessionEnded) return;
    state.data.stockState = normalizeStockState(stockState);
    pruneUnavailableCartLines();
    if (state.section === "shipment" && !isEditingWorkforce()) renderShipment();
  }

  function isEditingWorkforce() {
    return Boolean(document.activeElement && document.activeElement.closest && document.activeElement.closest(".workforce-section"));
  }

  function notifySessionEnded(error) {
    if (state.sessionEndNotified) return;
    closeShipmentComposer({ restoreFocus: false });
    closeShipmentDetail({ restoreFocus: false });
    persistMaterialDraft();
    clearShipmentDraft();
    state.cart = [];
    state.shipmentNote = "";
    state.shipmentNoteOpen = false;
    state.shipmentRequestId = "";
    state.shipmentDraftOwner = "";
    state.sessionEnded = true;
    state.sessionEndNotified = true;
    state.loaded = false;
    stopWorkforceEvents();
    document.dispatchEvent(new CustomEvent("personel:session-ended", {
      detail: {
        source: "workforce",
        status: Number(error && error.status || 0),
        message: error && error.message || "Oturumunuz sona erdi. Lütfen yeniden giriş yapın."
      }
    }));
  }

  async function openSection(section, options = {}) {
    if (state.sessionEnded) return;
    state.section = section;
    const scope = scopeForSection(section);
    const alreadyLoaded = state.loadedScopes.has(scope) && !state.staleScopes.has(scope);
    if (alreadyLoaded) {
      render(section);
      return;
    }
    if (state.loaded) render(section);
    else if (!options.silent) renderLoading(section);
    try {
      await loadWorkforceData(section);
      if (state.section !== section) return;
      render(section);
    } catch (error) {
      if (!state.loaded) renderError(section, error.message);
      else showMessage(section, error.message, "error");
    }
  }

  function scopeForSection(section) {
    return section === "shipment" ? "shipments" : section === "materialRequest" ? "materialrequests" : section === "shift" ? "shift" : "tasks";
  }

  function requestScopesForSection(section) {
    return section === "shipment" ? "shipments,stock" : scopeForSection(section);
  }

  async function loadWorkforceData(section = state.section, options = {}) {
    if (state.sessionEnded) return Promise.reject(Object.assign(new Error("Personel oturumu gerekli."), { status: 401 }));
    const scope = scopeForSection(section);
    if (!options.force && state.loadedScopes.has(scope) && !state.staleScopes.has(scope)) return state.data;
    if (state.loadPromises.has(scope)) return state.loadPromises.get(scope);
    const query = new URLSearchParams({ scope: requestScopesForSection(section) });
    const promise = api(`/api/workforce/me?${query.toString()}`)
      .then((result) => {
        mergeWorkforceData(result);
        state.revision = responseRevision(result, state.revision);
        pruneUnavailableCartLines();
        state.loaded = true;
        state.loadedScopes.add(scope);
        state.staleScopes.delete(scope);
        return state.data;
      })
      .finally(() => {
        state.loadPromises.delete(scope);
      });
    state.loadPromises.set(scope, promise);
    return promise;
  }

  function loadOverview(options = {}) {
    if (state.sessionEnded) return Promise.reject(Object.assign(new Error("Personel oturumu gerekli."), { status: 401 }));
    const scopes = Array.from(new Set((Array.isArray(options.scopes) ? options.scopes : ["shipments", "materialrequests"])
      .filter((scope) => scope === "shipments" || scope === "materialrequests" || scope === "shift")));
    if (!scopes.length) return Promise.resolve(overviewSnapshot());
    if (!options.force && state.overviewLoaded) return Promise.resolve(overviewSnapshot());
    if (state.overviewLoadPromise) return state.overviewLoadPromise;
    const query = new URLSearchParams({ scope: scopes.join(",") });
    const promise = api(`/api/workforce/me?${query.toString()}`)
      .then((result) => {
        mergeWorkforceData(result);
        state.revision = responseRevision(result, state.revision);
        state.loaded = true;
        state.overviewLoaded = true;
        if (scopes.includes("shift")) {
          state.loadedScopes.add("shift");
          state.staleScopes.delete("shift");
        }
        if (scopes.includes("materialrequests")) {
          state.loadedScopes.add("materialrequests");
          state.staleScopes.delete("materialrequests");
        }
        return overviewSnapshot();
      })
      .finally(() => {
        if (state.overviewLoadPromise === promise) state.overviewLoadPromise = null;
      });
    state.overviewLoadPromise = promise;
    return promise;
  }

  function overviewSnapshot() {
    return Object.freeze({
      shipments: (state.data.shipments || []).slice(),
      materialRequests: (state.data.materialRequests || []).slice(),
      shiftRequests: (state.data.shiftRequests || []).slice()
    });
  }

  async function openPendingShipments() {
    await openSection("shipment");
    const root = panel("shipment");
    if (!root) return;
    state.shipmentHistoryQuery = "";
    state.shipmentHistoryPage = 1;
    renderShipment();
    const pending = root.querySelector('[data-workflow-open="true"]');
    window.requestAnimationFrame(() => {
      (pending || root.querySelector(".wf-shipment-history-listing"))?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      pending?.focus({ preventScroll: true });
    });
  }

  async function openOpenRequests() {
    state.materialQuery = "";
    state.materialComposerOpen = false;
    state.materialReviewOpen = false;
    await openSection("materialRequest");
    const root = panel("materialRequest");
    renderMaterialRequest();
    const pending = root && root.querySelector('[data-workflow-open="true"]');
    window.requestAnimationFrame(() => (pending || root?.querySelector(".mr-history"))?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }));
  }

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function emptyData() {
    return {
      tasks: [],
      shipments: [],
      materialRequests: [],
      shiftRequests: [],
      shiftPlans: [],
      shiftSettings: {
        morning: { startTime: "08:00", endTime: "16:00" },
        evening: { startTime: "16:00", endTime: "00:00" }
      },

      stockState: { products: [], categories: [] },
      user: null,
      revision: 0
    };
  }

  function mergeWorkforceData(value) {
    const source = value && typeof value === "object" ? value : {};
    if (Array.isArray(source.tasks)) state.data.tasks = source.tasks;
    if (Array.isArray(source.shipments)) state.data.shipments = source.shipments;
    if (Array.isArray(source.materialRequests)) state.data.materialRequests = source.materialRequests;
    if (Array.isArray(source.shiftRequests)) state.data.shiftRequests = source.shiftRequests;
    if (Array.isArray(source.shiftPlans)) state.data.shiftPlans = source.shiftPlans;
    if (source.shiftSettings && typeof source.shiftSettings === "object") state.data.shiftSettings = source.shiftSettings;
    if (source.stockState && typeof source.stockState === "object") state.data.stockState = normalizeStockState(source.stockState);
    if (source.user && typeof source.user === "object") state.data.user = source.user;

    state.data.revision = responseRevision(source, state.data.revision);
    if (Array.isArray(source.tasks)) document.dispatchEvent(new CustomEvent("personel:tasks-updated", { detail: { userId: state.data.user?.id, tasks: state.data.tasks, revision: state.data.revision } }));
  }

  function normalizeStockState(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      products: Array.isArray(source.products) ? source.products : [],
      categories: Array.isArray(source.categories) ? source.categories : []
    };
  }

  function render(section) {
    if (section === "tasks") renderTasks();
    if (section === "materialRequest") renderMaterialRequest();
    if (section === "shipment") renderShipment();
    if (section === "shift") renderShift();
  }

  function panel(section) {
    return document.getElementById(`section${section.charAt(0).toUpperCase()}${section.slice(1)}`);
  }

  function renderLoading(section) {
    const root = panel(section);
    if (!root) return;
    root.innerHTML = `<div class="wf-loading">${icon("loader")}<span>Veriler yükleniyor…</span></div>`;
  }

  function renderError(section, message) {
    const root = panel(section);
    if (!root) return;
    root.innerHTML = `
      <div class="wf-state wf-state-error">
        ${icon("alert")}
        <h2>Veriler yüklenemedi</h2>
        <p>${escapeHTML(message || "Lütfen yeniden deneyin.")}</p>
        <button class="wf-button wf-button-primary ui-button ui-button--primary" type="button" data-retry>Yeniden Dene</button>
      </div>`;
    root.querySelector("[data-retry]").addEventListener("click", () => openSection(section));
  }

  function renderTasks() {
    const root = panel("tasks");
    if (!root) return;
    const tasks = state.data.tasks.slice().sort((a,b) => dueSort(a)-dueSort(b));
    const visible = tasks.filter(task => task.id === state.openTaskId || (state.taskStatus === "completed" ? isCompletedStatus(assignment(task).status) : isTaskActive(task)));
    root.innerHTML = `<div class="wf-simple-task-tabs"><button type="button" data-simple-task-filter="active" class="${state.taskStatus !== "completed" ? "is-active" : ""}">Aktif</button><button type="button" data-simple-task-filter="completed" class="${state.taskStatus === "completed" ? "is-active" : ""}">Tamamlanan</button></div><div class="wf-task-list">${visible.map(taskCard).join("") || emptyState("clipboard", state.taskStatus === "completed" ? "Tamamlanmış görev yok." : "Aktif göreviniz yok.", "Atanan görevler burada görünür.")}</div>`;
    root.querySelectorAll("[data-simple-task-filter]").forEach(button => button.addEventListener("click", () => { state.taskStatus = button.dataset.simpleTaskFilter; renderTasks(); }));
    root.querySelectorAll("[data-task-toggle]").forEach(button => button.addEventListener("click", () => { state.openTaskId = state.openTaskId === button.dataset.taskToggle ? "" : button.dataset.taskToggle; renderTasks(); }));
    root.querySelectorAll("[data-task-item]").forEach(input => input.addEventListener("change", () => updateTaskItem(input)));
    root.querySelectorAll("[data-task-complete]").forEach(button => button.addEventListener("click", () => runImmediateOperation("task-complete:"+button.dataset.taskComplete, button, () => completeTask(button))));
  }

  function taskCard(task) {
    const a = assignment(task);
    const complete = isCompletedStatus(a.status);
    const cancelled = isCancelledTask(task);
    const isOpen = state.openTaskId === task.id;
    const due = dueMeta(task.dueDate, a.status);
    return `<article class="wf-task-card ${complete ? "is-complete" : ""}">
      <button class="wf-simple-task-summary" type="button" data-task-toggle="${escapeAttribute(task.id)}" aria-expanded="${isOpen}">
        <span class="wf-task-check">${icon(complete ? "check" : "clipboard")}</span><strong>${escapeHTML(task.title || "Görev")}</strong><time>${icon("calendar")}${escapeHTML(due.label)}${task.dueTime ? " · "+escapeHTML(task.dueTime) : ""}</time><span class="wf-simple-task-status">${escapeHTML(statusLabel(a.status))}</span><span class="wf-chevron">${icon("chevron")}</span>
      </button>
      <div class="wf-task-detail" ${isOpen ? "" : "hidden"}>
        ${task.description ? `<p>${escapeHTML(task.description)}</p>` : ""}
        <div class="wf-task-items">${(task.items || []).map(item => `<label><input type="checkbox" data-task-item data-task-id="${escapeAttribute(task.id)}" data-item-id="${escapeAttribute(item.id)}" ${(a.completedItemIds || []).includes(item.id) ? "checked" : ""} ${cancelled || PREVIEW_TOKEN ? "disabled" : ""}><span>${icon("check")}</span><b>${escapeHTML(item.text || item.title || "")}</b></label>`).join("")}</div>
        ${task.managerNote || a.managerNote ? `<p class="wf-admin-note">${escapeHTML(task.managerNote || a.managerNote)}</p>` : ""}
        ${!complete && !cancelled ? `<button class="wf-button wf-button-primary ui-button ui-button--primary" type="button" data-task-complete="${escapeAttribute(task.id)}" ${PREVIEW_TOKEN ? "disabled" : ""}>Tamamla</button>` : ""}
      </div></article>`;
  }

  async function completeTask(button) {
    const task = state.data.tasks.find(t => t.id === button.dataset.taskComplete);
    if (!task || !isTaskActive(task) || state.busy) return;
    const owner = state.data.user?.id;
    const completed = new Set(assignment(task).completedItemIds || []);
    const remaining = (task.items || []).filter(item => !completed.has(item.id));
    state.busy = true;
    button.disabled = true;
    try {
      for (const item of remaining) {
        if (state.sessionEnded || owner !== state.data.user?.id) throw new Error("Personel oturumu değişti.");
        const request = mutationRequest({ completed: true });
        const result = await api(`/api/workforce/tasks/${encodeURIComponent(task.id)}/items/${encodeURIComponent(item.id)}`, { method:"PATCH",headers:request.headers,body:JSON.stringify(request.body) });
        state.revision = responseRevision(result, state.revision);
      }
      await refreshWorkforceData();
      renderTasks();
      showMessage("tasks","Görev tamamlandı.","success");
    } catch (error) {
      await refreshWorkforceData().catch(() => {});
      renderTasks();
      showMutationError("tasks",error);
    } finally { state.busy = false; button.disabled = false; }
  }

  async function updateTaskItem(input) {
    const completed = input.checked;
    input.checked = !completed;
    input.disabled = true;
    clearMessage("tasks");
    try {
      const request = mutationRequest({ completed });
      const result = await api(`/api/workforce/tasks/${encodeURIComponent(input.dataset.taskId)}/items/${encodeURIComponent(input.dataset.itemId)}`, {
        method: "PATCH",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      await refreshWorkforceData();
      renderTasks();
      showMessage("tasks", "Görev ilerlemeniz kaydedildi.", "success");
    } catch (error) {
      input.disabled = false;
      showMutationError("tasks", error);
    }
  }

  function renderShipment() {
    const root = panel("shipment");
    if (!root) return;
    const reopenComposer = state.shipmentComposerOpen;
    const reopenDetailId = state.shipmentDetailId;
    if (reopenComposer) closeShipmentComposer({ restoreFocus: false, immediate: true });
    if (reopenDetailId) closeShipmentDetail({ restoreFocus: false, immediate: true });
    const products = state.data.stockState.products.filter(isAvailableStockProduct).sort(orderSort);
    const shipments = state.data.shipments
      .slice()
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    state.shipmentNoteOpen = state.shipmentNoteOpen || Boolean(state.shipmentNote);

    root.innerHTML = `
      <div class="wf-shipment-home">
        <div class="wf-shipment-toolbar">
          <label class="wf-search wf-shipment-history-search">${icon("search")}<input id="wfShipmentHistorySearch" type="search" placeholder="Sevkiyat veya malzeme ara" autocomplete="off"></label>
          <button class="wf-button wf-button-primary ui-button ui-button--primary" id="wfShipmentComposerTrigger" type="button" aria-haspopup="dialog" aria-controls="wfShipmentComposer">${icon("plus")}Mal Kabul Bildir</button>
        </div>
        <section class="wf-shipment-history-listing" aria-label="Sevkiyat geçmişi">
          <div class="wf-shipment-records" id="wfShipmentHistoryList"></div>
          <nav class="wf-shipment-pagination" id="wfShipmentPagination" aria-label="Sevkiyat geçmişi sayfaları" hidden></nav>
        </section>
      </div>
      <button class="wf-shipment-dialog-backdrop" id="wfShipmentComposerBackdrop" type="button" aria-label="Mal kabul bildirimini kapat" hidden></button>
      <section class="wf-shipment-dialog" id="wfShipmentComposer" role="dialog" aria-modal="true" aria-labelledby="wfShipmentComposerTitle" aria-hidden="true" tabindex="-1" hidden>
        <header class="wf-shipment-dialog__header">
          <h2 id="wfShipmentComposerTitle">Mal Kabul Bildirimi</h2>
          <button class="wf-shipment-dialog-close" id="wfShipmentComposerClose" type="button" aria-label="Mal kabul bildirimini kapat">${icon("close")}</button>
        </header>
        <div class="wf-shipment-dialog__scroll">
          <div class="wf-receipt-grid">
            <section class="wf-receipt-column" aria-labelledby="wfShipmentCatalogTitle">
              <h3 id="wfShipmentCatalogTitle">Ürün Seç</h3>
              <label class="wf-search wf-receipt-search">${icon("search")}<input id="wfShipmentSearch" type="search" placeholder="Malzeme adı veya kodu" autocomplete="off"></label>
              <div class="wf-products" id="wfShipmentProducts"></div>
            </section>
            <section class="wf-receipt-column wf-receipt-cart" aria-labelledby="wfShipmentCartTitle">
              <div class="wf-receipt-column-heading"><h3 id="wfShipmentCartTitle">Gelen Malzemeler</h3><small id="wfShipmentSummary" aria-live="polite"></small></div>
              <div class="wf-cart-list" id="wfShipmentCart"></div>
            </section>
          </div>
          <div class="wf-shipment-note-area">
            <button class="wf-shipment-note-toggle" id="wfShipmentNoteToggle" type="button" aria-expanded="${state.shipmentNoteOpen}" aria-controls="wfShipmentNoteField">${state.shipmentNoteOpen ? "− Notu kapat" : "+ Not ekle"}</button>
            <label class="wf-field wf-shipment-note-field" id="wfShipmentNoteField" ${state.shipmentNoteOpen ? "" : "hidden"}>
              <span>Sevkiyat notu <small>(isteğe bağlı)</small></span>
              <textarea id="wfShipmentNote" maxlength="250" rows="3" placeholder="Yöneticiye kısa bir not ekleyin…"></textarea>
            </label>
          </div>
          <div class="wf-info">${icon("info")}<span>Stok, yönetici onayından sonra güncellenir.</span></div>
        </div>
        <footer class="wf-shipment-dialog__footer">
          <button class="wf-button wf-button-primary wf-button-block ui-button ui-button--primary ui-button--block" id="wfShipmentSend" type="button" data-operation-class="immediate-operation">${icon("send")}Yöneticiye Bildir</button>
        </footer>
      </section>
      <button class="wf-shipment-dialog-backdrop" id="wfShipmentDetailBackdrop" type="button" aria-label="Sevkiyat detayını kapat" hidden></button>
      <section class="wf-shipment-dialog wf-shipment-detail-dialog" id="wfShipmentDetail" role="dialog" aria-modal="true" aria-labelledby="wfShipmentDetailTitle" aria-hidden="true" tabindex="-1" hidden>
        <header class="wf-shipment-dialog__header">
          <h2 id="wfShipmentDetailTitle">Sevkiyat Detayı</h2>
          <button class="wf-shipment-dialog-close" id="wfShipmentDetailClose" type="button" aria-label="Sevkiyat detayını kapat">${icon("close")}</button>
        </header>
        <div class="wf-shipment-dialog__scroll" id="wfShipmentDetailBody"></div>
      </section>
      <p class="sr-only" id="wfShipmentLive" aria-live="polite"></p>`;

    const search = root.querySelector("#wfShipmentSearch");
    const historySearch = root.querySelector("#wfShipmentHistorySearch");
    const shipmentNote = root.querySelector("#wfShipmentNote");
    search.value = state.shipmentQuery;
    historySearch.value = state.shipmentHistoryQuery;
    shipmentNote.value = state.shipmentNote;
    shipmentNote.addEventListener("input", () => {
      state.shipmentNote = shipmentNote.value;
      shipmentDraftChanged();
    });
    const drawProducts = () => {
      const query = normalizeText(state.shipmentQuery);
      const visible = products.filter((product) => !query || normalizeText(`${product.name} ${product.productCode || ""}`).includes(query));
      root.querySelector("#wfShipmentProducts").innerHTML = visible.length
        ? visible.map((product) => productCard(product)).join("")
        : emptyState("search", "Malzeme bulunamadı.", "Aramanızı değiştirin.");
    };
    const productsRoot = root.querySelector("#wfShipmentProducts");
    productsRoot.addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-add-product]");
      if (!addButton) return;
      addToCart(products.find((product) => String(product.id) === addButton.dataset.addProduct));
    });
    search.addEventListener("input", () => {
      state.shipmentQuery = search.value.trim();
      drawProducts();
    });
    historySearch.addEventListener("input", () => {
      state.shipmentHistoryQuery = historySearch.value.trim();
      state.shipmentHistoryPage = 1;
      drawShipmentHistory(root, shipments);
    });
    root.querySelector("#wfShipmentHistoryList").addEventListener("click", (event) => {
      const record = event.target.closest("[data-shipment-detail]");
      if (record) openShipmentDetail(record.dataset.shipmentDetail, record);
    });
    root.querySelector("#wfShipmentPagination").addEventListener("click", (event) => {
      const button = event.target.closest("[data-shipment-page]");
      if (!button) return;
      state.shipmentHistoryPage = Number(button.dataset.shipmentPage) || 1;
      drawShipmentHistory(root, shipments);
      root.querySelector("#wfShipmentHistoryList")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    });
    root.querySelector("#wfShipmentSend").addEventListener("click", submitShipment);
    bindShipmentDialogs(root);
    drawShipmentHistory(root, shipments);
    drawProducts();
    drawCart();
    if (reopenComposer) openShipmentComposer({ trigger: root.querySelector("#wfShipmentComposerTrigger") });
    else if (reopenDetailId) openShipmentDetail(reopenDetailId, root.querySelector(`[data-shipment-detail="${cssEscape(reopenDetailId)}"]`));
    if (state.shipmentSubmitting) {
      setShipmentSubmissionBusy(root, true, { captureFocus: false });
      setBusy(root.querySelector("#wfShipmentSend"), true, "Gönderiliyor…");
    }
    root.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => image.closest(".wf-shipment-image")?.classList.add("is-broken"), { once: true }));
  }

  function drawShipmentHistory(root, shipments = state.data.shipments || []) {
    if (!root) return;
    const query = normalizeText(state.shipmentHistoryQuery);
    const filtered = shipments.filter((shipment) => !query || shipmentSearchText(shipment).includes(query));
    const pageCount = Math.max(1, Math.ceil(filtered.length / SHIPMENT_HISTORY_PAGE_SIZE));
    state.shipmentHistoryPage = Math.min(pageCount, Math.max(1, Number(state.shipmentHistoryPage) || 1));
    const offset = (state.shipmentHistoryPage - 1) * SHIPMENT_HISTORY_PAGE_SIZE;
    const pageItems = filtered.slice(offset, offset + SHIPMENT_HISTORY_PAGE_SIZE);
    const list = root.querySelector("#wfShipmentHistoryList");
    const pagination = root.querySelector("#wfShipmentPagination");
    if (list) {
      list.innerHTML = pageItems.length
        ? pageItems.map(shipmentHistory).join("")
        : emptyState("box", query ? "Eşleşen sevkiyat bulunamadı." : "Henüz sevkiyat bildirimi yok.", query ? "Aramanızı değiştirin." : "Gönderdiğiniz bildirimler burada görünecek.");
    }
    if (!pagination) return;
    pagination.hidden = pageCount <= 1;
    pagination.innerHTML = pageCount <= 1 ? "" : Array.from({ length: pageCount }, (_value, index) => {
      const page = index + 1;
      return `<button type="button" data-shipment-page="${page}" aria-label="${page}. sayfaya git" aria-current="${page === state.shipmentHistoryPage ? "page" : "false"}" class="${page === state.shipmentHistoryPage ? "is-active" : ""}">${page}</button>`;
    }).join("");
  }

  function shipmentSearchText(shipment) {
    return normalizeText([
      shipment && shipment.shipmentNumber,
      ...(shipment && Array.isArray(shipment.items) ? shipment.items.flatMap((item) => [item && item.name, item && (item.productCode || item.stockProductCode)]) : [])
    ].join(" "));
  }

  function shipmentSummary(shipment) {
    const names = [...new Set((shipment && shipment.items || []).map((item) => String(item && item.name || "").trim()).filter(Boolean))];
    if (!names.length) return "Malzeme bilgisi yok";
    const visible = names.slice(0, 2).join(", ");
    return names.length > 2 ? `${visible} +${names.length - 2}` : visible;
  }

  function shipmentHistory(shipment) {
    const status = statusMeta(shipment.status);
    const itemCount = (shipment.items || []).length;
    return `
      <button class="wf-shipment-record" type="button" data-shipment-detail="${escapeAttribute(shipment.id)}" data-workflow-open="${isOpenWorkflowStatus(shipment.status)}">
        <span class="wf-shipment-record__main"><strong>${escapeHTML(shipment.shipmentNumber || "Sevkiyat bildirimi")}</strong><small>${escapeHTML(shipmentSummary(shipment))} · ${itemCount} farklı ürün</small></span>
        <time datetime="${escapeAttribute(shipment.createdAt || "")}">${escapeHTML(formatDateTime(shipment.createdAt))}</time>
        <em class="${status.className}">${status.label}</em>
        ${icon("chevron")}
      </button>`;
  }

  function productCard(product) {
    const selected = findCartLineForProduct(product);
    return `
      <article class="wf-product-card${selected ? " is-selected" : ""}" data-product-card="${escapeAttribute(product.id)}">
        ${shipmentImage(product.imageUrl || product.image || product.photoUrl, product.name)}
        <div class="wf-product-copy"><h3>${escapeHTML(product.name)}</h3>${product.productCode ? `<small>${escapeHTML(product.productCode)}</small>` : ""}</div>
        <div class="wf-product-actions">${productActionMarkup(product, selected)}</div>
      </article>`;
  }

  function productActionMarkup(product, line = findCartLineForProduct(product)) {
    if (line) return `<button class="wf-button wf-product-added" type="button" disabled aria-label="${escapeAttribute(product.name)} eklendi">${icon("check")}Eklendi</button>`;
    return `<button class="wf-button wf-button-primary ui-button ui-button--primary" type="button" data-add-product="${escapeAttribute(product.id)}">${icon("plus")}Ekle</button>`;
  }

  function shipmentImage(url, name, className = "") {
    return url
      ? `<span class="wf-shipment-image ${className}"><img src="${escapeAttribute(url)}" alt="${escapeAttribute(name || "Malzeme görseli")}" loading="lazy" decoding="async"></span>`
      : `<span class="wf-shipment-image is-empty ${className}" aria-label="Görsel yok">${icon("box")}</span>`;
  }

  function addToCart(product) {
    if (!product) return;
    const productCode = String(product.productCode || "").trim().toUpperCase();
    const existing = state.cart.find((line) => (
      productCode && String(line.productCode || "").toUpperCase() === productCode
    ) || String(line.productId) === String(product.id));
    if (existing) return;
    state.cart.push({
      productId: product.id,
      productCode,
      stockProductCode: productCode,
      name: product.name,
      imageUrl: String(product.imageUrl || product.image || product.photoUrl || ""),
      categoryId: product.categoryId,
      category: product.category || (state.data.stockState.categories || []).find((category) => String(category.id) === String(product.categoryId))?.name || "Stok",
      quantity: 1,
      unit: "adet",
      baseUnit: "adet",
      bulkUnit: "",
      caseText: ""
    });
    shipmentDraftChanged();
    updateProductSelection(product.id);
    drawCart();
    announceShipmentChange(`${product.name} gelen malzemelere eklendi.`);
  }

  function drawCart() {
    const root = panel("shipment");
    const cartRoot = root && root.querySelector("#wfShipmentCart");
    if (!cartRoot) return;
    cartRoot.innerHTML = state.cart.length ? state.cart.map((line) => {
      const validation = shipmentLineValidation(line);
      return `
        <article class="wf-cart-line" data-cart-line="${escapeAttribute(line.productId)}">
          ${shipmentImage(line.imageUrl, line.name, "wf-cart-line__image")}
          <div class="wf-cart-line__content">
            <b>${escapeHTML(line.name)}</b>
            <div class="wf-cart-controls">
              <label><span>Miktar</span><input data-line-quantity="${escapeAttribute(line.productId)}" type="number" min="1" step="1" inputmode="numeric" value="${escapeAttribute(line.quantity)}" aria-invalid="${validation ? "true" : "false"}"></label>
            </div>
            <small class="wf-line-error" ${validation ? "" : "hidden"}>${escapeHTML(validation)}</small>
          </div>
          <button class="wf-cart-remove" type="button" data-remove-line="${escapeAttribute(line.productId)}" aria-label="${escapeAttribute(line.name)} ürününü listeden kaldır">${icon("close")}</button>
        </article>`;
    }).join("") : emptyState("box", "Henüz ürün eklenmedi.", "Soldaki listeden gelen malzemeleri ekleyin.");

    cartRoot.querySelectorAll("[data-line-quantity]").forEach((input) => {
      input.addEventListener("input", () => {
        stageCartLineQuantity(input.dataset.lineQuantity, input.value);
        updateShipmentLineFeedback(input.dataset.lineQuantity);
      });
      input.addEventListener("blur", () => updateShipmentLineFeedback(input.dataset.lineQuantity));
    });
    cartRoot.querySelectorAll("[data-remove-line]").forEach((button) => {
      button.addEventListener("click", () => removeCartLine(button.dataset.removeLine, { restoreComposerFocus: true }));
    });
    const summary = root.querySelector("#wfShipmentSummary");
    if (summary) summary.textContent = state.cart.length ? `${state.cart.length} farklı ürün` : "Henüz ürün yok";
  }

  function shipmentLineValidation(line) {
    const quantity = Number(line && line.quantity);
    return Number.isInteger(quantity) && quantity > 0 ? "" : "1 veya daha büyük tam sayı girin.";
  }

  function updateShipmentLineFeedback(productId, options = {}) {
    const root = panel("shipment");
    const line = findCartLineByProductId(productId);
    const row = root?.querySelector(`[data-cart-line="${cssEscape(productId)}"]`);
    if (!line || !row) return "";
    const input = row.querySelector("[data-line-quantity]");
    const error = row.querySelector(".wf-line-error");
    const message = shipmentLineValidation(line);
    input?.setAttribute("aria-invalid", message ? "true" : "false");
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    if (message && options.focusInvalid) input?.focus({ preventScroll: false });
    return message;
  }

  function validateShipmentCart(root, options = {}) {
    let firstInvalid = null;
    state.cart.forEach((line) => {
      const input = root?.querySelector(`[data-line-quantity="${cssEscape(line.productId)}"]`);
      if (input) stageCartLineQuantity(line.productId, input.value);
      const message = updateShipmentLineFeedback(line.productId);
      if (message && !firstInvalid) firstInvalid = line;
    });
    if (firstInvalid && options.focusInvalid !== false) updateShipmentLineFeedback(firstInvalid.productId, { focusInvalid: true });
    return firstInvalid;
  }

  function findCartLineForProduct(product) {
    if (!product) return null;
    const productCode = String(product.productCode || "").trim().toLocaleUpperCase("tr-TR");
    return state.cart.find((line) => (
      productCode && String(line.productCode || line.stockProductCode || "").trim().toLocaleUpperCase("tr-TR") === productCode
    ) || String(line.productId) === String(product.id)) || null;
  }

  function findCartLineByProductId(productId) {
    return state.cart.find((line) => String(line.productId) === String(productId)) || null;
  }

  function refreshCartLineFromProduct(line, product) {
    if (!line || !product) return line;
    const productCode = String(product.productCode || "").trim().toUpperCase();
    line.productId = product.id;
    line.productCode = productCode;
    line.stockProductCode = productCode;
    line.name = product.name;
    line.imageUrl = String(product.imageUrl || product.image || product.photoUrl || "");
    line.categoryId = product.categoryId;
    line.category = product.category || (state.data.stockState.categories || []).find((category) => String(category.id) === String(product.categoryId))?.name || "Stok";
    line.unit = "adet";
    line.baseUnit = "adet";
    line.bulkUnit = "";
    line.caseText = "";
    return line;
  }

  function stageCartLineQuantity(productId, value) {
    const line = findCartLineByProductId(productId);
    if (!line) return false;
    const raw = String(value ?? "").trim();
    const quantity = raw === "" ? "" : Number(raw);
    const next = raw === "" || !Number.isFinite(quantity) ? raw : quantity;
    if (String(line.quantity) === String(next)) return true;
    line.quantity = next;
    shipmentDraftChanged();
    return true;
  }

  function removeCartLine(productId, options = {}) {
    const line = findCartLineByProductId(productId);
    if (!line) return;
    state.cart = state.cart.filter((candidate) => candidate !== line);
    shipmentDraftChanged();
    updateProductSelection(line.productId);
    drawCart();
    announceShipmentChange(`${line.name} gelen malzemelerden çıkarıldı.`);
    if (options.restoreComposerFocus) {
      window.requestAnimationFrame(() => {
        const composer = panel("shipment")?.querySelector("#wfShipmentComposer");
        (composer?.querySelector("[data-remove-line]") || composer?.querySelector("#wfShipmentSearch"))?.focus();
      });
    }
  }

  function updateProductSelection(productId) {
    const root = panel("shipment");
    const product = (state.data.stockState.products || []).find((candidate) => String(candidate.id) === String(productId));
    const card = root?.querySelector(`[data-product-card="${cssEscape(productId)}"]`);
    const actions = card?.querySelector(".wf-product-actions");
    if (!product || !card || !actions) return;
    const line = findCartLineForProduct(product);
    card.classList.toggle("is-selected", Boolean(line));
    actions.innerHTML = productActionMarkup(product, line);
  }

  function announceShipmentChange(message) {
    const live = panel("shipment")?.querySelector("#wfShipmentLive");
    if (!live) return;
    live.textContent = "";
    window.requestAnimationFrame(() => { live.textContent = message; });
  }

  function bindShipmentDialogs(root) {
    root.querySelector("#wfShipmentComposerTrigger")?.addEventListener("click", (event) => openShipmentComposer({ trigger: event.currentTarget }));
    root.querySelector("#wfShipmentComposerClose")?.addEventListener("click", () => closeShipmentComposer());
    root.querySelector("#wfShipmentComposerBackdrop")?.addEventListener("click", () => closeShipmentComposer());
    root.querySelector("#wfShipmentDetailClose")?.addEventListener("click", () => closeShipmentDetail());
    root.querySelector("#wfShipmentDetailBackdrop")?.addEventListener("click", () => closeShipmentDetail());
    root.querySelector("#wfShipmentNoteToggle")?.addEventListener("click", () => {
      state.shipmentNoteOpen = !state.shipmentNoteOpen;
      const field = root.querySelector("#wfShipmentNoteField");
      const toggle = root.querySelector("#wfShipmentNoteToggle");
      if (field) field.hidden = !state.shipmentNoteOpen;
      if (toggle) {
        toggle.setAttribute("aria-expanded", String(state.shipmentNoteOpen));
        toggle.textContent = state.shipmentNoteOpen ? "− Notu kapat" : "+ Not ekle";
      }
      if (state.shipmentNoteOpen) window.requestAnimationFrame(() => root.querySelector("#wfShipmentNote")?.focus());
    });
    root.addEventListener("keydown", (event) => {
      const openDialog = state.shipmentDetailId ? root.querySelector("#wfShipmentDetail") : state.shipmentComposerOpen ? root.querySelector("#wfShipmentComposer") : null;
      if (!openDialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.shipmentDetailId) closeShipmentDetail();
        else closeShipmentComposer();
        return;
      }
      if (event.key === "Tab") trapShipmentDialogFocus(event, openDialog);
    });
  }

  function openShipmentComposer(options = {}) {
    const root = panel("shipment");
    const dialog = root?.querySelector("#wfShipmentComposer");
    const backdrop = root?.querySelector("#wfShipmentComposerBackdrop");
    const trigger = root?.querySelector("#wfShipmentComposerTrigger");
    if (!dialog || !backdrop || !trigger) return;
    if (state.shipmentDetailId) closeShipmentDetail({ restoreFocus: false, immediate: true });
    window.clearTimeout(shipmentDialogHideTimer);
    shipmentDialogReturnFocus = options.trigger || document.activeElement || trigger;
    state.shipmentComposerOpen = true;
    dialog.hidden = false;
    backdrop.hidden = false;
    dialog.setAttribute("aria-hidden", "false");
    syncShipmentDialogLock();
    window.requestAnimationFrame(() => {
      dialog.classList.add("is-open");
      backdrop.classList.add("is-open");
      (dialog.querySelector("#wfShipmentSearch") || dialog.querySelector("#wfShipmentComposerClose"))?.focus({ preventScroll: true });
    });
  }

  function closeShipmentComposer(options = {}) {
    const root = panel("shipment");
    const dialog = root?.querySelector("#wfShipmentComposer");
    const backdrop = root?.querySelector("#wfShipmentComposerBackdrop");
    state.shipmentComposerOpen = false;
    dialog?.setAttribute("aria-hidden", "true");
    dialog?.classList.remove("is-open");
    backdrop?.classList.remove("is-open");
    syncShipmentDialogLock();
    window.clearTimeout(shipmentDialogHideTimer);
    const hide = () => {
      if (state.shipmentComposerOpen) return;
      if (dialog) dialog.hidden = true;
      if (backdrop) backdrop.hidden = true;
    };
    if (options.immediate) hide();
    else shipmentDialogHideTimer = window.setTimeout(hide, SHIPMENT_DIALOG_TRANSITION_MS);
    if (options.restoreFocus !== false && shipmentDialogReturnFocus?.isConnected) shipmentDialogReturnFocus.focus({ preventScroll: true });
    shipmentDialogReturnFocus = null;
  }

  function shipmentDetailMarkup(shipment) {
    const status = statusMeta(shipment.status);
    const items = Array.isArray(shipment.items) ? shipment.items : [];
    return `
      <div class="wf-shipment-detail-meta">
        <div><small>Sevkiyat</small><strong>${escapeHTML(shipment.shipmentNumber || "Numara bulunmuyor")}</strong></div>
        <div><small>Tarih</small><strong>${escapeHTML(formatDateTime(shipment.createdAt))}</strong></div>
        <em class="${status.className}">${status.label}</em>
      </div>
      <div class="wf-shipment-detail-items">
        ${items.length ? items.map((item) => `
          <article>
            ${shipmentImage(item.imageUrl, item.name, "wf-shipment-detail-image")}
            <div><strong>${escapeHTML(item.name || "Malzeme")}</strong>${item.productCode || item.stockProductCode ? `<small>${escapeHTML(item.productCode || item.stockProductCode)}</small>` : ""}<b>${formatNumber(item.quantity)} ${escapeHTML(item.unit || "adet")}</b></div>
          </article>`).join("") : emptyState("box", "Malzeme kaydı yok.", "Bu sevkiyatın satır bilgisi bulunmuyor.")}
      </div>
      ${shipment.note ? `<div class="wf-shipment-detail-note"><small>Personel notu</small><p>${escapeHTML(shipment.note)}</p></div>` : ""}
      ${shipment.adminNote || shipment.rejectionReason ? `<div class="wf-shipment-detail-note"><small>Yönetici açıklaması</small><p>${escapeHTML(shipment.adminNote || shipment.rejectionReason)}</p></div>` : ""}`;
  }

  function openShipmentDetail(shipmentId, trigger) {
    const root = panel("shipment");
    const shipment = (state.data.shipments || []).find((item) => String(item.id) === String(shipmentId));
    const dialog = root?.querySelector("#wfShipmentDetail");
    const backdrop = root?.querySelector("#wfShipmentDetailBackdrop");
    const body = root?.querySelector("#wfShipmentDetailBody");
    if (!shipment || !dialog || !backdrop || !body) return;
    if (state.shipmentComposerOpen) closeShipmentComposer({ restoreFocus: false, immediate: true });
    shipmentDetailReturnFocus = trigger || document.activeElement;
    state.shipmentDetailId = String(shipment.id);
    body.innerHTML = shipmentDetailMarkup(shipment);
    dialog.hidden = false;
    backdrop.hidden = false;
    dialog.setAttribute("aria-hidden", "false");
    syncShipmentDialogLock();
    body.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => image.closest(".wf-shipment-image")?.classList.add("is-broken"), { once: true }));
    window.requestAnimationFrame(() => {
      dialog.classList.add("is-open");
      backdrop.classList.add("is-open");
      dialog.querySelector("#wfShipmentDetailClose")?.focus({ preventScroll: true });
    });
  }

  function closeShipmentDetail(options = {}) {
    const root = panel("shipment");
    const dialog = root?.querySelector("#wfShipmentDetail");
    const backdrop = root?.querySelector("#wfShipmentDetailBackdrop");
    state.shipmentDetailId = "";
    dialog?.setAttribute("aria-hidden", "true");
    dialog?.classList.remove("is-open");
    backdrop?.classList.remove("is-open");
    syncShipmentDialogLock();
    const hide = () => {
      if (state.shipmentDetailId) return;
      if (dialog) dialog.hidden = true;
      if (backdrop) backdrop.hidden = true;
    };
    if (options.immediate) hide();
    else window.setTimeout(hide, SHIPMENT_DIALOG_TRANSITION_MS);
    if (options.restoreFocus !== false && shipmentDetailReturnFocus?.isConnected) shipmentDetailReturnFocus.focus({ preventScroll: true });
    shipmentDetailReturnFocus = null;
  }

  function syncShipmentDialogLock() {
    document.body.classList.toggle("is-shipment-dialog-open", Boolean(state.shipmentComposerOpen || state.shipmentDetailId));
  }

  function trapShipmentDialogFocus(event, dialog) {
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.hidden && element.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  function cssEscape(value) {
    const raw = String(value ?? "");
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(raw);
    return raw.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
  }

  function shipmentDraftStorageKey() {
    return `${SHIPMENT_DRAFT_STORAGE_PREFIX}${state.shipmentDraftOwner || "session"}`;
  }

  function shipmentDraftChanged() {
    state.shipmentRequestId = "";
    persistShipmentDraft();
  }

  function persistShipmentDraft() {
    try {
      const key = shipmentDraftStorageKey();
      if (!state.cart.length && !state.shipmentNote && !state.shipmentRequestId) {
        window.sessionStorage.removeItem(key);
        return;
      }
      window.sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        cart: state.cart.map((line) => ({
          productId: line.productId,
          productCode: String(line.productCode || "").slice(0, 120),
          stockProductCode: String(line.stockProductCode || line.productCode || "").slice(0, 120),
          name: String(line.name || "Ürün").slice(0, 200),
          imageUrl: String(line.imageUrl || "").slice(0, 2048),
          categoryId: line.categoryId,
          category: String(line.category || "Stok").slice(0, 120),
          quantity: line.quantity,
          unit: "adet",
          baseUnit: "adet",
          bulkUnit: "",
          caseText: ""
        })),
        note: String(state.shipmentNote || "").slice(0, 250),
        requestId: String(state.shipmentRequestId || "").slice(0, 200)
      }));
    } catch (_error) {}
  }

  function restoreShipmentDraft() {
    try {
      const raw = window.sessionStorage.getItem(shipmentDraftStorageKey());
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || draft.version !== 1 || !Array.isArray(draft.cart)) {
        clearShipmentDraft();
        return;
      }
      state.cart = draft.cart.slice(0, 200).reduce((lines, candidate) => {
        if (!candidate || typeof candidate !== "object") return lines;
        const productId = candidate.productId;
        if (productId === undefined || productId === null || productId === "") return lines;
        const parsedQuantity = Number(candidate.quantity);
        const quantity = candidate.quantity === "" ? "" : Number.isFinite(parsedQuantity) ? roundNumber(parsedQuantity) : String(candidate.quantity || "").slice(0, 40);
        const productCode = String(candidate.productCode || candidate.stockProductCode || "").trim().slice(0, 120);
        const duplicate = lines.some((line) => (
          productCode && String(line.productCode || "").toLocaleUpperCase("tr-TR") === productCode.toLocaleUpperCase("tr-TR")
        ) || String(line.productId) === String(productId));
        if (duplicate) return lines;
        lines.push({
          productId,
          productCode,
          stockProductCode: String(candidate.stockProductCode || productCode).trim().slice(0, 120),
          name: String(candidate.name || "Ürün").slice(0, 200),
          imageUrl: String(candidate.imageUrl || "").slice(0, 2048),
          categoryId: candidate.categoryId,
          category: String(candidate.category || "Stok").slice(0, 120),
          quantity,
          unit: "adet",
          baseUnit: "adet",
          bulkUnit: "",
          caseText: ""
        });
        return lines;
      }, []);
      state.shipmentNote = String(draft.note || "").slice(0, 250);
      state.shipmentNoteOpen = Boolean(state.shipmentNote);
      state.shipmentRequestId = String(draft.requestId || "").slice(0, 200);
    } catch (_error) {
      clearShipmentDraft();
    }
  }

  function clearShipmentDraft() {
    try {
      window.sessionStorage.removeItem(shipmentDraftStorageKey());
    } catch (_error) {}
  }

  function shipmentDraftFingerprint(source = null) {
    const draft = source || {
      requestId: state.shipmentRequestId,
      note: state.shipmentNote,
      items: state.cart
    };
    return JSON.stringify([
      String(draft.requestId || ""),
      String(draft.note || ""),
      (Array.isArray(draft.items) ? draft.items : []).map((line) => [
        String(line.productId ?? ""),
        String(line.productCode || ""),
        String(line.stockProductCode || line.productCode || ""),
        Number(line.quantity),
        String(line.unit || "")
      ])
    ]);
  }

  function createShipmentDraftSnapshot() {
    const items = Object.freeze(state.cart.map((line) => Object.freeze({
      productId: line.productId,
      productCode: line.productCode || "",
      stockProductCode: line.stockProductCode || line.productCode || "",
      quantity: Number(line.quantity),
      unit: "adet"
    })));
    const snapshot = {
      requestId: String(state.shipmentRequestId || ""),
      note: String(state.shipmentNote || ""),
      items
    };
    return Object.freeze({ ...snapshot, fingerprint: shipmentDraftFingerprint(snapshot) });
  }

  function setShipmentSubmissionBusy(root, busy, options = {}) {
    const currentRoot = root && root.isConnected ? root : panel("shipment");
    if (!currentRoot) {
      if (!busy) state.shipmentSubmitFocus = null;
      return;
    }
    if (busy && options.captureFocus !== false && !state.shipmentSubmitFocus) {
      const activeElement = document.activeElement;
      state.shipmentSubmitFocus = activeElement && currentRoot.contains(activeElement) ? activeElement : null;
    }
    currentRoot.classList.toggle("is-submitting", busy);
    if (busy) currentRoot.setAttribute("aria-busy", "true");
    else currentRoot.removeAttribute("aria-busy");
    const composer = currentRoot.querySelector("#wfShipmentComposer");
    if (composer) {
      if (busy) composer.setAttribute("aria-busy", "true");
      else composer.removeAttribute("aria-busy");
    }
    (composer || currentRoot).querySelectorAll("button, input, select, textarea").forEach((control) => {
      if (busy) {
        if (!("shipmentBusyDisabled" in control.dataset)) {
          control.dataset.shipmentBusyDisabled = control.disabled ? "true" : "false";
          control.dataset.shipmentBusyAriaDisabled = control.hasAttribute("aria-disabled")
            ? control.getAttribute("aria-disabled")
            : "__absent__";
        }
        control.disabled = true;
        control.setAttribute("aria-disabled", "true");
        return;
      }
      if (!("shipmentBusyDisabled" in control.dataset)) return;
      control.disabled = control.dataset.shipmentBusyDisabled === "true";
      const previousAriaDisabled = control.dataset.shipmentBusyAriaDisabled;
      if (previousAriaDisabled === "__absent__") control.removeAttribute("aria-disabled");
      else control.setAttribute("aria-disabled", previousAriaDisabled);
      delete control.dataset.shipmentBusyDisabled;
      delete control.dataset.shipmentBusyAriaDisabled;
    });
    if (busy) {
      if (state.shipmentComposerOpen && composer) composer.focus({ preventScroll: true });
      return;
    }
    const returnFocus = state.shipmentSubmitFocus;
    state.shipmentSubmitFocus = null;
    if (options.restoreFocus === false) return;
    const focusTarget = state.shipmentComposerOpen && returnFocus?.isConnected
      ? returnFocus
      : currentRoot.querySelector(state.shipmentComposerOpen ? "#wfShipmentSend" : "#wfShipmentComposerTrigger");
    if (focusTarget) {
      window.requestAnimationFrame(() => {
        if (focusTarget.isConnected && !focusTarget.disabled) focusTarget.focus({ preventScroll: true });
      });
    }
  }

  function submitShipment() {
    const button = panel("shipment")?.querySelector("#wfShipmentSend");
    return runImmediateOperation("shipment-notify", button, executeShipmentSubmit);
  }

  async function executeShipmentSubmit() {
    if (state.busy) return operationSkipped("busy");
    const root = panel("shipment");
    if (!state.cart.length) {
      showMessage("shipment", "Bildirim göndermek için gelen malzemelere ürün ekleyin.", "error");
      return operationSkipped("validation");
    }
    const invalid = validateShipmentCart(root);
    if (invalid) {
      showMessage("shipment", "Tüm ürünler için geçerli bir miktar girin.", "error");
      return operationSkipped("validation");
    }
    const unavailable = state.cart.find((line) => !findAvailableStockProduct(line));
    if (unavailable) {
      showMessage("shipment", `${unavailable.name || "Seçilen ürün"} artık sevkiyat için kullanılamıyor. Sepeti kontrol edin.`, "error");
      return operationSkipped("validation");
    }
    const button = root.querySelector("#wfShipmentSend");
    const submittedNote = root.querySelector("#wfShipmentNote").value.trim();
    if (submittedNote !== state.shipmentNote) state.shipmentRequestId = "";
    state.shipmentNote = submittedNote;
    if (!state.shipmentRequestId) state.shipmentRequestId = createRequestId("shipment");
    persistShipmentDraft();
    const submittedDraft = createShipmentDraftSnapshot();
    const request = mutationRequest({
      items: submittedDraft.items,
      note: submittedDraft.note
    }, submittedDraft.requestId);
    state.shipmentSubmitting = true;
    setShipmentSubmissionBusy(root, true);
    setBusy(button, true, "Gönderiliyor…");
    let submittedDraftCleared = false;
    let result;
    try {
      result = await api("/api/workforce/shipments", {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      upsertShipment(result && result.shipment);
      if (shipmentDraftFingerprint() === submittedDraft.fingerprint) {
        state.cart = [];
        state.shipmentNote = "";
        state.shipmentRequestId = "";
        clearShipmentDraft();
        submittedDraftCleared = true;
      } else {
        if (state.shipmentRequestId === submittedDraft.requestId) state.shipmentRequestId = "";
        persistShipmentDraft();
      }
    } catch (error) {
      showMutationError("shipment", error);
      throw error;
    } finally {
      const activeRoot = panel("shipment") || root;
      const activeButton = activeRoot && activeRoot.querySelector("#wfShipmentSend") || button;
      setBusy(activeButton, false, "");
      state.shipmentSubmitting = false;
      setShipmentSubmissionBusy(activeRoot, false, { restoreFocus: !submittedDraftCleared });
    }
    if (submittedDraftCleared) {
      closeShipmentComposer({ restoreFocus: false, immediate: true });
      state.shipmentNoteOpen = false;
      renderShipment();
      panel("shipment")?.querySelector("#wfShipmentComposerTrigger")?.focus({ preventScroll: true });
      showMessage("shipment", "Sevkiyat bildiriminiz yönetici onayına gönderildi.", "success");
    } else {
      showMessage("shipment", "Sevkiyat bildiriminiz gönderildi; bu sırada yapılan yeni taslak değişiklikleri korundu.", "success");
    }
    refreshShipmentInBackground();
    return result;
  }

  function upsertShipment(shipment) {
    if (!shipment || !shipment.id) return;
    const shipmentId = String(shipment.id);
    state.data.shipments = [
      shipment,
      ...(state.data.shipments || []).filter((item) => String(item && item.id || "") !== shipmentId)
    ];
    state.data.revision = Math.max(Number(state.data.revision || 0), Number(state.revision || 0));
    state.loaded = true;
    state.loadedScopes.add("shipments");
    state.staleScopes.delete("shipments");
    notifyOverviewStale();
  }

  function refreshShipmentInBackground() {
    state.staleScopes.add("shipments");
    window.setTimeout(() => {
      if (state.sessionEnded) return;
      void loadWorkforceData("shipment", { force: true }).catch(() => null);
    }, 250);
  }

  function emptyMaterialForm() {
    return { name: "", code: "", imageUrl: "", quantity: "", unit: "adet", supplier: "", usageLocation: "", neededDate: "", description: "" };
  }

  function materialDraftKey() {
    return state.materialDraftOwner ? `${MATERIAL_DRAFT_STORAGE_PREFIX}${state.materialDraftOwner}` : "";
  }

  function materialDraftFingerprint() {
    return JSON.stringify({ department: state.materialDepartment, items: state.materialItems.map((item) => ({
      id: item.id, name: item.name, code: item.code, imageUrl: item.imageUrl, quantity: item.quantity, unit: item.unit,
      supplier: item.supplier, usageLocation: item.usageLocation, neededDate: item.neededDate, description: item.description
    })) });
  }

  function persistMaterialDraft() {
    const key = materialDraftKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({
        version: 1,
        department: state.materialDepartment,
        items: state.materialItems,
        form: state.materialForm,
        editItemId: state.materialEditItemId,
        requestId: state.materialRequestId,
        submissionFingerprint: state.materialRequestFingerprint || ""
      }));
    } catch (_error) {}
  }

  function restoreMaterialDraft() {
    const key = materialDraftKey();
    if (!key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (!saved || saved.version !== 1) return;
      state.materialDepartment = String(saved.department || "").slice(0, 120);
      state.materialItems = (Array.isArray(saved.items) ? saved.items : []).map((item) => ({
        id: String(item.id || createRequestId("material-draft")),
        name: String(item.name || "").trim().slice(0, 180),
        code: String(item.code || "").trim().slice(0, 120),
        imageUrl: String(item.imageUrl || "").trim().slice(0, 2048),
        quantity: Math.round(Number(item.quantity || 0) * 1000) / 1000,
        unit: String(item.unit || "").trim().slice(0, 40),
        supplier: String(item.supplier || "").trim().slice(0, 180),
        usageLocation: String(item.usageLocation || "").trim().slice(0, 180),
        neededDate: String(item.neededDate || "").slice(0, 10),
        description: String(item.description || "").trim().slice(0, 1000)
      })).filter((item) => item.name && item.quantity > 0 && item.unit);
      state.materialEditItemId = state.materialItems.some((item) => item.id === saved.editItemId) ? String(saved.editItemId) : "";
      const savedForm = { ...emptyMaterialForm(), ...(saved.form && typeof saved.form === "object" ? saved.form : {}) };
      state.materialForm = state.materialEditItemId ? savedForm : {
        ...emptyMaterialForm(),
        name: String(savedForm.name || "").slice(0, 180),
        imageUrl: String(savedForm.imageUrl || "").slice(0, 2048),
        quantity: String(savedForm.quantity || "").slice(0, 24),
        unit: String(savedForm.unit || "adet").slice(0, 40)
      };
      state.materialRequestId = String(saved.requestId || "");
      state.materialRequestFingerprint = String(saved.submissionFingerprint || "");
    } catch (_error) {}
  }

  function clearMaterialDraft() {
    const key = materialDraftKey();
    if (key) {
      try { localStorage.removeItem(key); } catch (_error) {}
    }
  }

  function captureMaterialForm(form) {
    if (!form) return;
    state.materialForm = {
      ...state.materialForm,
      name: form.elements.name.value,
      quantity: form.elements.quantity.value,
      unit: form.elements.unit.value
    };
    persistMaterialDraft();
  }

  function materialImage(url, name, className = "") {
    return url
      ? `<span class="mr-image ${className}"><img src="${escapeAttribute(url)}" alt="${escapeAttribute(name || "Malzeme görseli")}" loading="lazy" decoding="async"></span>`
      : `<span class="mr-image is-empty ${className}" aria-label="Görsel yok">${icon("box")}</span>`;
  }

  function renderMaterialRequest() {
    const root = panel("materialRequest");
    if (!root) return;
    if (!state.materialDepartment) state.materialDepartment = String(state.data.user && state.data.user.department || "");
    const sentRequests = (state.data.materialRequests || []).slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    root.innerHTML = `
      <div class="mr-shell">
        ${renderMaterialHistory(sentRequests)}
      </div>
      ${state.materialComposerOpen ? renderMaterialComposer() : ""}`;
    document.body.classList.toggle("is-material-request-dialog-open", state.materialComposerOpen);
    bindMaterialRequest(root);
    root.querySelectorAll("img").forEach((image) => image.addEventListener("error", () => image.closest(".mr-image")?.classList.add("is-broken"), { once: true }));
    if (state.materialComposerOpen) {
      window.requestAnimationFrame(() => {
        const dialog = root.querySelector(".mr-composer");
        if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
      });
    }
  }

  function renderMaterialComposer() {
    return `<div class="mr-composer-layer" data-material-dialog-layer>
      <section class="mr-composer" role="dialog" aria-modal="true" aria-labelledby="mrComposerTitle" tabindex="-1">
        <header class="mr-composer-header">
          <h2 id="mrComposerTitle">Yeni Malzeme Talebi</h2>
          <button type="button" id="mrDialogClose" data-material-dialog-close aria-label="Yeni talep kartını kapat">${icon("close")}</button>
        </header>
        ${state.materialReviewOpen ? renderMaterialReviewView() : renderMaterialComposerEditor()}
      </section>
    </div>`;
  }

  function renderMaterialComposerEditor() {
    const form = state.materialForm;
    const legacyUnit = form.unit && form.unit !== "adet" ? form.unit : "";
    return `
      <div class="mr-composer-scroll">
        <div class="mr-editor-layout">
          <form class="mr-entry" id="mrEntryForm" novalidate>
            <header><h3>Malzeme Ekle</h3></header>
            <div class="mr-form-grid">
              <label class="mr-field mr-wide"><span>Malzeme adı</span><input name="name" type="text" maxlength="180" value="${escapeAttribute(form.name)}" autocomplete="off" required></label>
              <div class="mr-quantity-group mr-wide">
                <span>Malzeme miktarı</span>
                <div>
                  <label class="sr-only" for="mrMaterialQuantity">Miktar</label>
                  <input id="mrMaterialQuantity" name="quantity" type="number" min="${legacyUnit ? "0.001" : "1"}" step="${legacyUnit ? "0.001" : "1"}" inputmode="${legacyUnit ? "decimal" : "numeric"}" value="${escapeAttribute(form.quantity)}" required>
                  <input id="mrMaterialUnit" name="unit" type="hidden" value="${escapeAttribute(legacyUnit || "adet")}">
                </div>
                ${legacyUnit ? `<small>Eski taslak: ${escapeHTML(legacyUnit)}. Birim ve miktar otomatik dönüştürülmez.</small>` : ""}
              </div>
            </div>
            <div class="mr-photo-control">
              <strong>Malzeme görseli</strong>
              <div class="mr-photo-field">
                ${materialImage(form.imageUrl, form.name, "mr-photo-preview")}
                <div class="mr-photo-actions"><label class="ui-button ui-button--secondary">${icon("upload")}${state.materialUploading ? "Yükleniyor…" : "Görsel Ekle"}<input data-material-photo-input type="file" accept="image/jpeg,image/png,image/webp" ${state.materialUploading ? "disabled" : ""} hidden></label><label class="ui-button ui-button--secondary">${icon("camera")}Fotoğraf Çek<input data-material-photo-input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" ${state.materialUploading ? "disabled" : ""} hidden></label></div>
              </div>
            </div>
            <button class="wf-button wf-button-primary wf-button-block ui-button ui-button--primary" type="submit">${icon("plus")}Talep Ekle</button>
          </form>
          <aside class="mr-draft">
            <header><h3>Talep Edilen Malzemeler</h3></header>
            <div class="mr-draft-list">${state.materialItems.length ? state.materialItems.map(renderMaterialDraftItem).join("") : `<div class="mr-empty mr-draft-empty">${icon("clipboard")}<strong>Henüz malzeme eklenmedi.</strong></div>`}</div>
          </aside>
        </div>
      </div>
      <footer class="mr-composer-actions mr-composer-actions--single"><button id="mrReviewOpen" class="wf-button wf-button-primary ui-button ui-button--primary" type="button" ${!state.materialItems.length || state.materialUploading ? "disabled" : ""}>${icon("send")}Talebi Gönder</button></footer>`;
  }

  function renderMaterialDraftItem(item) {
    return `<article class="mr-draft-item" data-material-draft-id="${escapeAttribute(item.id)}" tabindex="0" aria-label="${escapeAttribute(item.name)}; düzenlemek veya kaldırmak için odaklayın">
      ${materialImage(item.imageUrl, item.name)}
      <div><strong>${escapeHTML(item.name)}</strong><small>Talep edilen: ${escapeHTML(formatMaterialQuantity(item.quantity))} ${escapeHTML(item.unit)}</small></div>
      <div class="mr-item-actions"><button type="button" data-material-edit="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(item.name)} kalemini düzenle">Düzenle</button><button type="button" data-material-remove="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(item.name)} kalemini kaldır">Kaldır</button></div>
    </article>`;
  }

  function renderMaterialHistory(requests) {
    const focusedId = (() => { try { return new URLSearchParams(location.search).get("requestId") || state.materialDetailId || ""; } catch (_error) { return state.materialDetailId || ""; } })();
    const visibleCount = requests.filter(materialRequestMatchesFilters).length;
    const historyCards = requests.map((request) => {
      const status = statusMeta(request.status);
      const open = String(request.id) === focusedId;
      const visible = materialRequestMatchesFilters(request);
      return `<details class="mr-history-card" data-material-request-id="${escapeAttribute(request.id)}" data-material-search="${escapeAttribute(materialRequestSearchText(request))}" data-workflow-open="${isOpenWorkflowStatus(request.status)}" ${visible ? "" : "hidden"} ${open ? "open" : ""}>
        <summary><span><strong>${escapeHTML(request.requestNumber || "Talep")}</strong><small>${(request.items || []).length} malzeme kalemi</small></span><time datetime="${escapeAttribute(request.createdAt || "")}">${escapeHTML(formatDateTime(request.createdAt))}</time><em class="${status.className}">${status.label}</em>${icon("chevron")}</summary>
        <div class="mr-history-detail"><div class="mr-history-meta"><span><small>Talep eden</small><b>${escapeHTML(request.personName || "Personel")}</b></span><span><small>Bölüm</small><b>${escapeHTML(request.department || "Belirtilmedi")}</b></span><span><small>Gönderim</small><b>${escapeHTML(formatDateTime(request.createdAt))}</b></span>${request.approvedAt ? `<span><small>Onaylayan</small><b>Yönetici · ${escapeHTML(formatDateTime(request.approvedAt))}</b></span>` : ""}</div>${request.adminNote ? `<p class="mr-admin-note"><b>Yönetici açıklaması:</b> ${escapeHTML(request.adminNote)}</p>` : ""}<div class="mr-history-items">${(request.items || []).map(renderMaterialHistoryItem).join("")}</div></div>
      </details>`;
    }).join("");
    return `<section class="mr-history">
      <header class="mr-list-heading"><div><small>TALEPLER</small><h2>Malzeme Talebi</h2><p>Gönderdiğiniz talepleri ve yönetici kararlarını tek ekrandan takip edin.</p></div><button id="mrNewRequest" class="ui-button ui-button--primary" type="button" data-material-new>${icon("plus")}Yeni Talep${state.materialItems.length ? `<b>${state.materialItems.length}</b>` : ""}</button></header>
      <div class="mr-list-tools">
        <label class="mr-search"><span class="sr-only">Talep ara</span>${icon("search")}<input id="mrRequestSearch" type="search" value="${escapeAttribute(state.materialQuery)}" placeholder="Talep numarası veya malzeme adıyla ara"></label>
      </div>
      <div class="mr-history-list">${requests.length ? `${historyCards}<div class="mr-empty mr-filter-empty" ${visibleCount ? "hidden" : ""}>${icon("search")}<strong>Aramanızla eşleşen talep yok</strong><p>Arama metnini değiştirin veya temizleyin.</p></div>` : `<div class="mr-empty mr-history-empty">${icon("document")}<strong>Henüz gönderilmiş malzeme talebi yok</strong><p>Yeni bir talep hazırlamak için “Yeni Talep” butonunu kullanın.</p></div>`}</div>
    </section>`;
  }

  function materialRequestSearchText(request) {
    return [request.requestNumber, request.personName, request.department, ...(request.items || []).flatMap((item) => [item.name, item.code])].filter(Boolean).join(" ");
  }

  function materialRequestMatchesFilters(request) {
    const query = normalizeText(state.materialQuery);
    return !query || normalizeText(materialRequestSearchText(request)).includes(query);
  }

  function renderMaterialHistoryItem(item) {
    const decision = item.decisionStatus === "onaylandı" ? `<p><b>Onaylanan: ${escapeHTML(formatMaterialQuantity(item.approvedQuantity ?? item.quantity))} adet</b></p>`
      : item.decisionStatus === "reddedildi" ? `<p>Bu kalem reddedildi.</p>` : item.decisionStatus === "onay_bekliyor" ? `<p>Onay bekliyor.</p>` : "";
    return `<article>${materialImage(item.imageUrl, item.name)}<div><strong>${escapeHTML(item.name)}</strong><small>${item.code ? escapeHTML(item.code) : "Kod belirtilmedi"}</small><b>İstenen: ${escapeHTML(formatMaterialQuantity(item.quantity))} ${escapeHTML(item.unit)}</b>${decision}${item.supplier ? `<p>Tedarikçi: ${escapeHTML(item.supplier)}</p>` : ""}${item.usageLocation ? `<p>Kullanım yeri: ${escapeHTML(item.usageLocation)}</p>` : ""}${item.neededDate ? `<p>Termin: ${escapeHTML(formatDate(item.neededDate))}</p>` : ""}${item.description ? `<p>${escapeHTML(item.description)}</p>` : ""}${item.linkedProductId ? `<em>Stok kartına bağlandı</em>` : ""}</div></article>`;
  }

  function renderMaterialReviewView() {
    return `<div class="mr-composer-scroll mr-review-content"><div class="mr-review-heading"><h3>Talebi Göndermeden Önce</h3><p>${state.materialItems.length} malzemeyi tek talep olarak gönderiyorsunuz.</p></div><div class="mr-review-items">${state.materialItems.map((item) => `<article>${materialImage(item.imageUrl, item.name)}<div><strong>${escapeHTML(item.name)}</strong><small>Talep edilen: ${escapeHTML(formatMaterialQuantity(item.quantity))} ${escapeHTML(item.unit)}</small>${item.supplier || item.usageLocation || item.neededDate || item.description ? `<details><summary>Önceki ek bilgileri göster</summary>${item.supplier ? `<p><b>Tedarikçi:</b> ${escapeHTML(item.supplier)}</p>` : ""}${item.usageLocation ? `<p><b>Kullanım yeri:</b> ${escapeHTML(item.usageLocation)}</p>` : ""}${item.neededDate ? `<p><b>Termin:</b> ${escapeHTML(formatDate(item.neededDate))}</p>` : ""}${item.description ? `<p><b>Açıklama:</b> ${escapeHTML(item.description)}</p>` : ""}</details>` : ""}</div></article>`).join("")}</div></div><footer class="mr-composer-actions mr-composer-actions--review"><button type="button" class="ui-button ui-button--secondary" data-material-review-back>Düzenlemeye Dön</button><button type="button" class="ui-button ui-button--primary" id="mrConfirmSend">${icon("send")}Onayla ve Gönder</button></footer>`;
  }

  function bindMaterialRequest(root) {
    root.querySelector("[data-material-new]")?.addEventListener("click", openMaterialComposer);
    const search = root.querySelector("#mrRequestSearch");
    search?.addEventListener("input", () => { state.materialQuery = search.value; applyMaterialListFilters(root); });
    root.querySelectorAll(".mr-history-card").forEach((card) => card.addEventListener("toggle", () => {
      if (card.open) state.materialDetailId = card.dataset.materialRequestId || "";
      else if (state.materialDetailId === card.dataset.materialRequestId) state.materialDetailId = "";
    }));
    const form = root.querySelector("#mrEntryForm");
    form?.querySelectorAll("input:not([type=file]), select").forEach((input) => input.addEventListener("input", () => captureMaterialForm(form)));
    form?.addEventListener("submit", addMaterialDraftItem);
    root.querySelectorAll("[data-material-photo-input]").forEach((input) => input.addEventListener("change", uploadMaterialImage));
    root.querySelector("[data-material-image-remove]")?.addEventListener("click", () => { state.materialForm.imageUrl = ""; state.materialRequestId = ""; persistMaterialDraft(); renderMaterialRequest(); });
    root.querySelector("[data-material-edit-cancel]")?.addEventListener("click", () => { state.materialEditItemId = ""; state.materialForm = emptyMaterialForm(); persistMaterialDraft(); renderMaterialRequest(); });
    root.querySelectorAll("[data-material-edit]").forEach((button) => button.addEventListener("click", () => editMaterialDraftItem(button.dataset.materialEdit)));
    root.querySelectorAll("[data-material-remove]").forEach((button) => button.addEventListener("click", () => removeMaterialDraftItem(button.dataset.materialRemove)));
    root.querySelector("#mrReviewOpen")?.addEventListener("click", openMaterialReview);
    root.querySelectorAll("[data-material-review-back]").forEach((button) => button.addEventListener("click", closeMaterialReview));
    root.querySelector("#mrConfirmSend")?.addEventListener("click", submitMaterialRequest);
    root.querySelectorAll("[data-material-dialog-close]").forEach((button) => button.addEventListener("click", closeMaterialComposer));
    const layer = root.querySelector("[data-material-dialog-layer]");
    layer?.addEventListener("click", (event) => { if (event.target === layer) closeMaterialComposer(); });
    const dialog = root.querySelector(".mr-composer");
    if (dialog) {
      dialog.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeMaterialComposer();
        } else if (event.key === "Tab") {
          trapMaterialDialogFocus(event, dialog);
        }
      });
    }
  }

  function applyMaterialListFilters(root) {
    const cards = Array.from(root.querySelectorAll(".mr-history-card"));
    const query = normalizeText(state.materialQuery);
    let visible = 0;
    cards.forEach((card) => {
      const matchesQuery = !query || normalizeText(card.dataset.materialSearch || "").includes(query);
      card.hidden = !matchesQuery;
      if (!card.hidden) visible += 1;
    });
    const empty = root.querySelector(".mr-filter-empty");
    if (empty) empty.hidden = visible > 0;
  }

  function openMaterialComposer(event) {
    if (state.materialComposerOpen) {
      panel("materialRequest")?.querySelector(".mr-composer")?.focus({ preventScroll: true });
      return;
    }
    materialDialogReturnFocus = event && event.currentTarget || document.activeElement;
    state.materialComposerOpen = true;
    state.materialReviewOpen = false;
    renderMaterialRequest();
  }

  function closeMaterialComposer(options = {}) {
    const root = panel("materialRequest");
    captureMaterialForm(root?.querySelector("#mrEntryForm"));
    releaseMaterialMedia(root);
    persistMaterialDraft();
    state.materialComposerOpen = false;
    state.materialReviewOpen = false;
    document.body.classList.remove("is-material-request-dialog-open");
    const returnFocus = materialDialogReturnFocus;
    materialDialogReturnFocus = null;
    if (options.render !== false && root) renderMaterialRequest();
    if (options.restoreFocus !== false) {
      window.requestAnimationFrame(() => {
        const target = returnFocus && returnFocus.isConnected ? returnFocus : panel("materialRequest")?.querySelector("[data-material-new]");
        target?.focus({ preventScroll: true });
      });
    }
  }

  function releaseMaterialMedia(root) {
    root?.querySelectorAll(".mr-composer video").forEach((video) => {
      const stream = video.srcObject;
      if (stream && typeof stream.getTracks === "function") stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    });
  }

  function trapMaterialDialogFocus(event, dialog) {
    const focusable = Array.from(dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), details > summary, [tabindex]:not([tabindex="-1"])'))
      .filter((element) => !element.hidden && element.getClientRects().length);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function addMaterialDraftItem(event) {
    event.preventDefault();
    const form = event.currentTarget;
    captureMaterialForm(form);
    if (!form.reportValidity()) return;
    const quantity = Number(state.materialForm.quantity);
    const unit = String(state.materialForm.unit || "").trim();
    const name = String(state.materialForm.name || "").trim().replace(/\s+/g, " ");
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !unit || (unit === "adet" && !Number.isSafeInteger(quantity))) {
      showMessage("materialRequest", "Malzeme adı, sıfırdan büyük miktar ve birim zorunludur.", "error");
      return;
    }
    const duplicate = state.materialItems.find((item) => item.id !== state.materialEditItemId && normalizeText(item.name) === normalizeText(name)
      && normalizeText(item.code || "") === normalizeText(state.materialForm.code || ""));
    if (duplicate && !window.confirm("Aynı ad ve kodla bir kalem taslakta bulunuyor. Ayrı kalem olarak eklemek istiyor musunuz?")) return;
    const item = {
      id: state.materialEditItemId || createRequestId("material-draft"),
      name,
      code: String(state.materialForm.code || "").trim(),
      imageUrl: String(state.materialForm.imageUrl || ""),
      quantity: Math.round(quantity * 1000) / 1000,
      unit,
      supplier: String(state.materialForm.supplier || "").trim(),
      usageLocation: String(state.materialForm.usageLocation || "").trim(),
      neededDate: String(state.materialForm.neededDate || ""),
      description: String(state.materialForm.description || "").trim()
    };
    const index = state.materialItems.findIndex((entry) => entry.id === item.id);
    if (index >= 0) state.materialItems.splice(index, 1, item);
    else state.materialItems.push(item);
    state.materialEditItemId = "";
    state.materialForm = emptyMaterialForm();
    state.materialRequestId = "";
    state.materialRequestFingerprint = "";
    persistMaterialDraft();
    renderMaterialRequest();
    showMessage("materialRequest", index >= 0 ? "Kalem güncellendi." : "Malzeme taslağa eklendi.", "success");
  }

  function editMaterialDraftItem(id) {
    const item = state.materialItems.find((entry) => entry.id === id);
    if (!item) return;
    state.materialEditItemId = id;
    state.materialForm = { ...emptyMaterialForm(), ...item, quantity: String(item.quantity) };
    state.materialRequestId = "";
    persistMaterialDraft();
    renderMaterialRequest();
    panel("materialRequest")?.querySelector("[name=name]")?.focus({ preventScroll: true });
  }

  function removeMaterialDraftItem(id) {
    state.materialItems = state.materialItems.filter((item) => item.id !== id);
    if (state.materialEditItemId === id) { state.materialEditItemId = ""; state.materialForm = emptyMaterialForm(); }
    state.materialRequestId = "";
    state.materialRequestFingerprint = "";
    persistMaterialDraft();
    renderMaterialRequest();
  }

  async function uploadMaterialImage(event) {
    const file = event.currentTarget.files && event.currentTarget.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      showMessage("materialRequest", "En fazla 10 MB boyutunda JPG, PNG veya WEBP görsel seçin.", "error");
      event.currentTarget.value = "";
      return;
    }
    state.materialUploading = true;
    renderMaterialRequest();
    try {
      const result = await api("/api/workforce/material-request-media", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name) },
        body: file
      });
      state.materialForm.imageUrl = String(result.imageUrl || result.media && result.media.src || "");
      state.materialRequestId = "";
      persistMaterialDraft();
      renderMaterialRequest();
      showMessage("materialRequest", "Görsel kalıcı olarak yüklendi.", "success");
    } catch (error) {
      renderMaterialRequest();
      showMessage("materialRequest", error.message || "Görsel yüklenemedi.", "error");
    } finally {
      state.materialUploading = false;
      if (state.section === "materialRequest") renderMaterialRequest();
    }
  }

  function openMaterialReview() {
    if (!state.materialItems.length) return showMessage("materialRequest", "Önce en az bir malzeme ekleyin.", "error");
    if (!state.materialDepartment) state.materialDepartment = String(state.data.user && state.data.user.department || "");
    persistMaterialDraft();
    state.materialReviewOpen = true;
    renderMaterialRequest();
  }

  function closeMaterialReview() {
    state.materialReviewOpen = false;
    renderMaterialRequest();
    panel("materialRequest")?.querySelector("#mrReviewOpen")?.focus({ preventScroll: true });
  }

  function submitMaterialRequest() {
    const button = panel("materialRequest")?.querySelector("#mrConfirmSend");
    return runImmediateOperation("material-request-send", button, executeMaterialRequestSubmit);
  }

  async function executeMaterialRequestSubmit() {
    if (state.busy || state.materialUploading) return operationSkipped("busy");
    if (!state.materialItems.length) return operationSkipped("validation");
    const button = panel("materialRequest")?.querySelector("#mrConfirmSend");
    const fingerprint = materialDraftFingerprint();
    if (!state.materialRequestId || state.materialRequestFingerprint !== fingerprint) {
      state.materialRequestId = createRequestId("material-request");
      state.materialRequestFingerprint = fingerprint;
      persistMaterialDraft();
    }
    const request = mutationRequest({ department: state.materialDepartment.trim(), items: state.materialItems }, state.materialRequestId);
    setBusy(button, true, "Gönderiliyor…");
    try {
      const result = await api("/api/workforce/material-requests", { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
      state.revision = responseRevision(result, state.revision);
      if (result.materialRequest) {
        state.data.materialRequests = [result.materialRequest, ...(state.data.materialRequests || []).filter((item) => item.id !== result.materialRequest.id)];
      }
      const submittedDraftIsCurrent = materialDraftFingerprint() === fingerprint;
      if (submittedDraftIsCurrent) {
        state.materialItems = [];
        state.materialDepartment = String(state.data.user && state.data.user.department || "");
        state.materialForm = emptyMaterialForm();
        state.materialEditItemId = "";
        state.materialRequestId = "";
        state.materialRequestFingerprint = "";
        clearMaterialDraft();
      }
      state.materialReviewOpen = false;
      if (submittedDraftIsCurrent) {
        state.materialComposerOpen = false;
        state.materialQuery = "";
        state.materialDetailId = String(result.materialRequest && result.materialRequest.id || "");
        materialDialogReturnFocus = null;
        document.body.classList.remove("is-material-request-dialog-open");
      }
      state.loadedScopes.add("materialrequests");
      state.staleScopes.delete("materialrequests");
      notifyOverviewStale();
      setBusy(button, false, "");
      renderMaterialRequest();
      showMessage("materialRequest", `${result.materialRequest && result.materialRequest.requestNumber || "Talep"} yönetici onayına gönderildi.`, "success");
      if (submittedDraftIsCurrent) {
        window.requestAnimationFrame(() => panel("materialRequest")?.querySelector(`[data-material-request-id="${cssEscape(state.materialDetailId)}"] > summary`)?.focus({ preventScroll: true }));
      }
      return result;
    } catch (error) {
      setBusy(button, false, "");
      persistMaterialDraft();
      showMutationError("materialRequest", error);
      throw error;
    }
  }

  async function createMaterialRequestFromStock(items, requestId, department = "") {
    if (!Array.isArray(items) || !items.length || items.some((item) => !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) throw new Error("Geçerli malzeme ve adet girin.");
    const owner = String(window.MenuSuitePersonelShell?.getContext()?.userId || "");
    const sameOwner = () => {
      const context = window.MenuSuitePersonelShell?.getContext();
      return context?.active && String(context.userId || "") === owner;
    };
    await loadWorkforceData("materialRequest", { force: true });
    if (!sameOwner()) throw new Error("Oturum değişti. Talebi yeniden açın.");
    const request = mutationRequest({ items, department: String(department || state.data.user?.department || "") }, requestId);
    const result = await api("/api/workforce/material-requests", { method: "POST", headers: request.headers, body: JSON.stringify(request.body) });
    if (!sameOwner()) throw new Error("Oturum değişti. Talep sonucunu kendi hesabınızdan kontrol edin.");
    state.revision = responseRevision(result, state.revision);
    if (result.materialRequest) state.data.materialRequests = [result.materialRequest, ...(state.data.materialRequests || []).filter((item) => item.id !== result.materialRequest.id)];
    return result;
  }

  function formatMaterialQuantity(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value) || 0);
  }

  function renderShift() {
    const root = panel("shift");
    if (!root) return;
    root.innerHTML = `
      <div class="wf-shift-layout">
        <form class="wf-request-card" id="wfShiftForm">
          <div class="wf-card-title">${icon("calendar")}<h2>Yeni İzin Talebi</h2><small>${new Date().getFullYear()}</small></div>
          <div class="wf-leave-dates">
            <label class="wf-field"><span>Başlangıç Tarihi</span><input name="date" type="date" min="${localDateKey(new Date())}" required></label>
            <label class="wf-field"><span>Bitiş Tarihi</span><input name="endDate" type="date" min="${localDateKey(new Date())}" required></label>
          </div>
          <p class="wf-leave-days" id="wfLeaveDays" aria-live="polite"></p>
          <label class="wf-leave-hours"><input name="specificHours" type="checkbox"><span>Belirli saatler</span></label>
          <div class="wf-custom-times" id="wfCustomTimes" hidden>
            <label class="wf-field"><span>Başlangıç saati</span><input name="startTime" type="time"></label>
            <i>—</i>
            <label class="wf-field"><span>Bitiş saati</span><input name="endTime" type="time"></label>
          </div>
          <label class="wf-field"><span>Not / İzin sebebi <small>(isteğe bağlı)</small></span><textarea name="description" maxlength="250" rows="4" placeholder="İzin sebebini veya eklemek istediğiniz notu yazın…"></textarea><small class="wf-counter"><b>0</b>/250</small></label>
          <button class="wf-button wf-button-primary wf-request-submit ui-button ui-button--primary" type="submit" data-operation-class="immediate-operation">${icon("send")}Talebi Gönder</button>
        </form>
        <aside class="wf-requests-card">
          <div class="wf-card-title">${icon("document")}<h2>Gönderdiğim Talepler</h2></div>
          <div class="wf-request-list">
            ${state.data.shiftRequests.length ? state.data.shiftRequests.slice().sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).map(requestCard).join("") : emptyState("document", "Henüz talebiniz yok.", "Yeni talepleriniz burada görünecek.")}
          </div>
          <div class="wf-info wf-info-plain">${icon("info")}<span>Gönderilen talepler yönetici onayından sonra kesinleşir.</span></div>
        </aside>
      </div>`;

    const form = root.querySelector("#wfShiftForm");
    const customTimes = root.querySelector("#wfCustomTimes");
    const description = form.elements.description;
    const draft = state.shiftRequestDraft;
    form.elements.date.value = draft.date || localDateKey(new Date());
    form.elements.endDate.value = draft.endDate || form.elements.date.value;
    form.elements.specificHours.checked = Boolean(draft.specificHours || draft.type === "custom");
    form.elements.startTime.value = draft.startTime || "";
    form.elements.endTime.value = draft.endTime || "";
    description.value = draft.description || "";
    const setCustomVisibility = () => {
      const custom = form.elements.specificHours.checked;
      customTimes.hidden = !custom;
      form.elements.startTime.required = custom;
      form.elements.endTime.required = custom;
    };
    const captureDraft = () => {
      state.shiftRequestDraft = {
        date: form.elements.date.value,
        endDate: form.elements.endDate.value,
        type: "leave",
        specificHours: form.elements.specificHours.checked,
        startTime: form.elements.startTime.value,
        endTime: form.elements.endTime.value,
        description: description.value
      };
    };
    const updateDays = () => {
      const days = window.MenuSuiteLeavePeriod.countDays(form.elements.date.value, form.elements.endDate.value);
      root.querySelector("#wfLeaveDays").textContent = days === null ? "Bitiş tarihi başlangıçtan önce olamaz." : `(${days} gün · Pazar hariç)`;
      form.elements.endDate.min = form.elements.date.value || localDateKey(new Date());
      form.querySelector("[type=submit]").disabled = days === null || days === 0;
    };
    form.querySelectorAll("input, textarea").forEach((input) => input.addEventListener("input", () => { captureDraft(); setCustomVisibility(); updateDays(); }));
    form.elements.specificHours.addEventListener("change", () => { captureDraft(); setCustomVisibility(); });
    description.addEventListener("input", () => {
      form.querySelector(".wf-counter b").textContent = String(description.value.length);
    });
    form.querySelector(".wf-counter b").textContent = String(description.value.length);
    setCustomVisibility();
    updateDays();
    form.addEventListener("submit", submitShiftRequest);
    root.querySelectorAll("[data-cancel-request]").forEach((button) => {
      button.addEventListener("click", () => cancelShiftRequest(button));
    });
  }

  function shiftDayCard(day, plan) {
    const current = localDateKey(day) === localDateKey(new Date());
    const meta = shiftMeta(plan && plan.type);
    return `
      <article class="wf-day-card ${current ? "is-today" : ""} ${plan ? `is-${meta.key}` : "is-empty"}">
        ${current ? `<em>Bugün</em>` : ""}
        <b>${capitalize(new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(day))}</b>
        <small>${new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(day)}</small>
        <span>${icon(meta.icon)}</span>
        ${plan ? `<strong>${plan.startTime && plan.endTime ? `${escapeHTML(plan.startTime)} – ${escapeHTML(plan.endTime)}` : meta.label}</strong><p>${meta.label}</p>` : `<strong>Plan yok</strong><p>Yayınlanmadı</p>`}
      </article>`;
  }

  function requestTypeChoice(value, iconName, label, checked) {
    return `<label><input type="radio" name="type" value="${value}" ${checked ? "checked" : ""}><span>${icon(iconName)}${label}</span></label>`;
  }

  function requestTimeLabel(request) {
    if (request.startTime && request.endTime) return `${request.startTime} – ${request.endTime}`;
    if (request.type === "leave") return "Tüm gün";
    const template = state.data.shiftSettings && state.data.shiftSettings[request.type];
    return template && template.startTime && template.endTime
      ? `${template.startTime} – ${template.endTime}`
      : "Saat tercihi";
  }

  function requestCard(request) {
    const status = statusMeta(request.status);
    const meta = shiftMeta(request.type);
    return `
      <article class="wf-request-row" data-shift-request-id="${escapeAttribute(request.id)}" data-request-status="${escapeAttribute(request.status || "pending")}" data-workflow-open="${isOpenWorkflowStatus(request.status)}">
        <span class="wf-request-icon is-${meta.key}">${icon(meta.icon)}</span>
        <div>
          <h3>${meta.requestLabel}</h3>
          <p>${window.MenuSuiteLeavePeriod.label(request, formatDate)} · ${escapeHTML(requestTimeLabel(request))}${request.dayCount != null ? ` (${escapeHTML(request.dayCount)} gün · Pazar hariç)` : ""}</p>
          ${request.description ? `<small>${escapeHTML(request.description)}</small>` : ""}
          ${request.adminNote ? `<small class="wf-admin-note">Yönetici notu: ${escapeHTML(request.adminNote)}</small>` : ""}
          <small>Gönderim: ${formatDateTime(request.createdAt)}${request.decidedAt ? ` · Karar: ${formatDateTime(request.decidedAt)}` : ""}</small>
        </div>
        <div class="wf-request-actions">
          <em class="${status.className}">${status.label}</em>
          ${request.status === "onay_bekliyor" ? `<button class="ui-button ui-button--danger ui-button--sm" type="button" data-cancel-request="${escapeAttribute(request.id)}" data-operation-class="immediate-operation">İptal et</button>` : ""}
        </div>
      </article>`;
  }

  function submitShiftRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    return runImmediateOperation("shift-request", form.querySelector("[type='submit']"), () => executeShiftRequestSubmit(event));
  }

  async function executeShiftRequestSubmit(event) {
    event.preventDefault();
    if (state.busy) return operationSkipped("busy");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    payload.type = "leave";
    payload.specificHours = form.elements.specificHours.checked;
    const period = window.MenuSuiteLeavePeriod.normalize(payload);
    if (period.error) { showMessage("shift", period.error, "error"); return operationSkipped("validation"); }
    Object.assign(payload, period);
    if (!payload.date || payload.date < localDateKey(new Date())) {
      showMessage("shift", "Geçmiş tarih için vardiya veya izin talebi oluşturulamaz.", "error");
      return operationSkipped("validation");
    }
    if (payload.specificHours && (!payload.startTime || !payload.endTime || payload.date === payload.endDate && payload.startTime >= payload.endTime)) {
      showMessage("shift", "Belirli saatler için geçerli bir başlangıç ve bitiş saati girin.", "error");
      return operationSkipped("validation");
    }
    if (!payload.specificHours) {
      payload.startTime = "";
      payload.endTime = "";
    }
    payload.description = String(payload.description || "").trim().slice(0, 250);
    const button = form.querySelector("[type=submit]");
    const fingerprint = JSON.stringify(payload);
    if (!state.shiftRequestId || state.shiftRequestFingerprint !== fingerprint) state.shiftRequestId = createRequestId("shift-request");
    state.shiftRequestFingerprint = fingerprint;
    const request = mutationRequest(payload, state.shiftRequestId);
    setBusy(button, true, "Gönderiliyor…");
    try {
      const result = await api("/api/workforce/shift-requests", {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      state.shiftRequestId = "";
      state.shiftRequestFingerprint = "";
      state.shiftRequestDraft = { date: "", endDate: "", type: "leave", specificHours: false, startTime: "", endTime: "", description: "" };
      await refreshWorkforceData();
      state.busy = false;
      renderShift();
      showMessage("shift", "Talebiniz yönetici onayına gönderildi.", "success");
    } catch (error) {
      showMutationError("shift", error);
      setBusy(button, false, "");
      throw error;
    }
  }

  function cancelShiftRequest(button) {
    return runImmediateOperation(`shift-request-cancel:${button.dataset.cancelRequest}`, button, () => executeShiftRequestCancel(button));
  }

  async function executeShiftRequestCancel(button) {
    if (state.busy) return operationSkipped("busy");
    setBusy(button, true, "İptal ediliyor…");
    try {
      const request = mutationRequest({});
      const result = await api(`/api/workforce/shift-requests/${encodeURIComponent(button.dataset.cancelRequest)}`, {
        method: "DELETE",
        headers: request.headers,
        body: JSON.stringify(request.body)
      });
      state.revision = responseRevision(result, state.revision);
      await refreshWorkforceData();
      state.busy = false;
      renderShift();
      showMessage("shift", "Talebiniz iptal edildi.", "success");
    } catch (error) {
      showMutationError("shift", error);
      setBusy(button, false, "");
      throw error;
    }
  }

  function statCard(iconName, label, value, suffix) {
    return `<article><span class="wf-stat-icon">${icon(iconName)}</span><div><p>${label}</p><b>${value}</b><small>${suffix}</small></div></article>`;
  }

  function emptyState(iconName, title, description) {
    return `<div class="workforce-empty">${icon(iconName)}<b>${title}</b><span>${description}</span></div>`;
  }

  function showMessage(section, message, type) {
    const root = panel(section);
    if (!root || !message) return;
    clearMessage(section);
    const node = document.createElement("div");
    node.className = `wf-toast is-${type || "info"}`;
    node.setAttribute("role", type === "error" ? "alert" : "status");
    node.innerHTML = `${icon(type === "error" ? "alert" : "check")}<span>${escapeHTML(message)}</span><button type="button" aria-label="Kapat">${icon("close")}</button>`;
    node.querySelector("button").addEventListener("click", () => node.remove());
    const target = section === "shipment" && state.shipmentComposerOpen
      ? root.querySelector(".wf-shipment-dialog__scroll")
      : section === "materialRequest" && state.materialComposerOpen
        ? root.querySelector(".mr-composer-scroll") || root.querySelector(".mr-composer")
        : root;
    (target || root).prepend(node);
    window.setTimeout(() => node.remove(), 4200);
  }

  function clearMessage(section) {
    panel(section)?.querySelectorAll(".wf-toast").forEach((node) => node.remove());
  }

  function setBusy(button, busy, label) {
    state.busy = busy;
    if (!button) return;
    if (!button.dataset.originalContent) button.dataset.originalContent = button.innerHTML;
    button.disabled = busy;
    if (busy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
    button.innerHTML = busy ? `${icon("loader")}${escapeHTML(label)}` : button.dataset.originalContent;
    if (!busy) state.busy = false;
  }

  function createRequestId(prefix) {
    const value = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function mutationRequest(body = {}, fixedRequestId = "") {
    const requestId = fixedRequestId || createRequestId("workforce");
    return {
      requestId,
      headers: {
        "Idempotency-Key": requestId,
        "X-Request-ID": requestId
      },
      body: {
        ...body,
        requestId,
        expectedRevision: Math.max(0, Number(state.revision || 0))
      }
    };
  }

  function responseRevision(result, fallback = 0) {
    const revision = Number(result && (result.revision ?? result.workforceRevision ?? (result.data && result.data.revision)));
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : Math.max(0, Number(fallback || 0));
  }

  async function refreshWorkforceData() {
    const scope = scopeForSection(state.section);
    state.staleScopes.add(scope);
    const data = await loadWorkforceData(state.section, { force: true });
    if (scope === "shipments" || scope === "materialrequests" || scope === "shift") notifyOverviewStale();
    return data;
  }

  function notifyOverviewStale() {
    state.overviewLoaded = false;
    document.dispatchEvent(new CustomEvent("personel:overview-stale", { detail: { scope: "workforce" } }));
  }

  function showMutationError(section, error) {
    if (Number(error && error.status) === 409) {
      showMessage(section, `${error.message || "Çakışma oluştu."} Güncel veriler yeniden alındı; işlemi tekrar deneyin.`, "error");
      void refreshWorkforceData().then(() => {
        if (state.section === section && !isEditingWorkforce()) render(section);
      }).catch(() => null);
      return;
    }
    showMessage(section, error && error.message || "İşlem gerçekleştirilemedi.", "error");
  }

  function isCompletedStatus(status) {
    return ["completed", "tamamlandi", "tamamlandı"].includes(String(status || "").toLocaleLowerCase("tr-TR"));
  }

  function isCancelledTask(task) {
    const taskStatus = String(task && (task.workflowStatus || task.status) || "").toLocaleLowerCase("tr-TR");
    const assignmentStatus = String(assignment(task).status || "").toLocaleLowerCase("tr-TR");
    return ["cancelled", "iptal_edildi", "iptal edildi"].includes(taskStatus)
      || ["cancelled", "iptal_edildi", "iptal edildi"].includes(assignmentStatus);
  }

  function isTaskActive(task) {
    return !isCancelledTask(task) && !isCompletedStatus(assignment(task).status);
  }

  function isAvailableStockProduct(product) {
    return Boolean(product && product.active !== false && product.sourcePresent !== false && product.archived !== true);
  }

  function findAvailableStockProduct(line) {
    const code = String(line && (line.stockProductCode || line.productCode) || "").trim().toLocaleUpperCase("tr-TR");
    return (state.data.stockState.products || []).find((product) => isAvailableStockProduct(product) && (
      (code && String(product.productCode || "").trim().toLocaleUpperCase("tr-TR") === code)
      || String(product.id) === String(line && line.productId)
    ));
  }

  function pruneUnavailableCartLines() {
    const previousPayload = JSON.stringify(state.cart.map((line) => [line.productId, line.productCode, line.stockProductCode, line.quantity, line.unit]));
    const seen = new Set();
    state.cart = state.cart.reduce((lines, line) => {
      const product = findAvailableStockProduct(line);
      if (!product) return lines;
      const key = String(product.productCode || product.id || "").trim().toLocaleUpperCase("tr-TR");
      if (seen.has(key)) return lines;
      seen.add(key);
      const quantity = Number(line.quantity);
      if (line.quantity !== "" && Number.isFinite(quantity)) line.quantity = roundNumber(quantity);
      refreshCartLineFromProduct(line, product);
      lines.push(line);
      return lines;
    }, []);
    const nextPayload = JSON.stringify(state.cart.map((line) => [line.productId, line.productCode, line.stockProductCode, line.quantity, line.unit]));
    if (previousPayload !== nextPayload) state.shipmentRequestId = "";
    persistShipmentDraft();
  }

  function assignment(task) {
    return Array.isArray(task.assignments) && task.assignments[0] ? task.assignments[0] : { status: "pending", completedItemIds: [], percent: 0 };
  }

  function calculatePercent(task, a) {
    return task.items && task.items.length ? Math.round(((a.completedItemIds || []).length / task.items.length) * 100) : 0;
  }

  function priorityMeta(priority) {
    if (priority === "urgent") return { key: "urgent", label: "Acil" };
    if (priority === "high") return { key: "high", label: "Yüksek öncelik" };
    if (priority === "low") return { key: "low", label: "Düşük öncelik" };
    return { key: "normal", label: "Normal öncelik" };
  }

  function statusMeta(status) {
    if (status === "onaylandı" || status === "completed" || status === "published") return { label: "Onaylandı", className: "wf-status is-approved" };
    if (status === "reddedildi") return { label: "Reddedildi", className: "wf-status is-rejected" };
    if (status === "iptal_edildi") return { label: "İptal Edildi", className: "wf-status is-cancelled" };
    return { label: "Onay Bekliyor", className: "wf-status is-pending" };
  }

  function isOpenWorkflowStatus(value) {
    const status = normalizeText(value).replace(/\s+/g, "_");
    return !["onaylandi", "approved", "completed", "published", "reddedildi", "rejected", "iptal_edildi", "cancelled"].includes(status);
  }

  function statusLabel(status) {
    if (status === "completed") return "Tamamlandı";
    if (status === "in_progress") return "Devam ediyor";
    if (status === "cancelled" || status === "iptal_edildi") return "İptal edildi";
    return "Bekliyor";
  }

  function shiftMeta(type) {
    if (type === "morning") return { key: "morning", label: "Sabah vardiyası", requestLabel: "Sabah tercihi", icon: "sun" };
    if (type === "evening") return { key: "evening", label: "Akşam vardiyası", requestLabel: "Akşam tercihi", icon: "moon" };
    if (type === "leave") return { key: "leave", label: "İzinli", requestLabel: "İzin isteği", icon: "umbrella" };
    if (type === "custom") return { key: "custom", label: "Belirli saatler", requestLabel: "Belirli saatler", icon: "clock" };
    return { key: "empty", label: "Plan yok", requestLabel: "Vardiya talebi", icon: "calendar" };
  }

  function dueMeta(value, status) {
    if (!value) return { label: "Belirtilmedi", className: "" };
    if (status === "completed") return { label: formatDate(value), className: "is-complete" };
    const days = dueDays(value);
    if (days < 0) return { label: "Süresi geçti", className: "is-overdue" };
    if (days === 0) return { label: "Bugün", className: "is-soon" };
    if (days === 1) return { label: "Yarın", className: "is-soon" };
    return { label: formatDate(value), className: "" };
  }

  function dueDays(value) {
    if (!value) return Infinity;
    const target = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    const today = new Date(`${localDateKey(new Date())}T12:00:00`);
    return Math.round((target - today) / 86400000);
  }

  function dueSort(task) {
    return task.dueDate ? Date.parse(task.dueDate) || Infinity : Infinity;
  }

  function caseInfo(product) {
    const metadata = productUnitMetadata(product);
    if (!metadata.bulkUnit || !metadata.baseUnit || !metadata.unitsPerBulkUnit) return "";
    return `1 ${metadata.bulkUnit} = ${formatNumber(metadata.unitsPerBulkUnit)} ${metadata.baseUnit}`;
  }

  function productUnitMetadata(product = {}) {
    const packageInfo = product.packageInfo && typeof product.packageInfo === "object" && !Array.isArray(product.packageInfo)
      ? product.packageInfo
      : {};
    const parsed = parsePackageConversionText([
      product.caseText,
      typeof product.packageInfo === "string" ? product.packageInfo : ""
    ]);
    const unitsPerBulkUnit = firstPositiveNumber([
      product.unitsPerBulkUnit,
      product.unitsPerCase,
      product.caseSize,
      product.packageSize,
      product.packSize,
      product.piecesPerCase,
      product.piecesPerBox,
      product.unitsPerBox,
      product.packagePerCase,
      product.koliIci,
      packageInfo.unitsPerBulkUnit,
      packageInfo.unitsPerCase,
      packageInfo.quantity,
      parsed.unitsPerBulkUnit
    ]);
    const baseUnit = normalizeUnit(
      product.baseUnit
      || product.unit
      || product.contentUnit
      || packageInfo.baseUnit
      || packageInfo.unit
      || packageInfo.contentUnit
      || parsed.baseUnit
      || "adet"
    );
    const bulkUnitSource = product.bulkUnit
      || product.caseUnit
      || product.purchaseUnit
      || packageInfo.bulkUnit
      || packageInfo.caseUnit
      || packageInfo.packageUnit
      || parsed.bulkUnit
      || (unitsPerBulkUnit ? "koli" : "");
    const bulkUnit = bulkUnitSource ? normalizeUnit(bulkUnitSource) : "";
    if (!unitsPerBulkUnit || !bulkUnit || bulkUnit === baseUnit) {
      return { baseUnit, bulkUnit: "", unitsPerBulkUnit: 0 };
    }
    return { baseUnit, bulkUnit, unitsPerBulkUnit };
  }

  function parsePackageConversionText(values) {
    for (const value of values) {
      const text = String(value || "").trim();
      if (!text) continue;
      const equation = text.match(/(?:^|\s)1\s+([\p{L}\p{N}_-]+)\s*=\s*(\d+(?:[.,]\d+)?)\s+([\p{L}\p{N}_-]+)/iu);
      if (equation) {
        return {
          bulkUnit: equation[1],
          unitsPerBulkUnit: Number(equation[2].replace(",", ".")),
          baseUnit: equation[3]
        };
      }
      const legacy = text.match(/([\p{L}\p{N}_-]+)\s+içi\s+(\d+(?:[.,]\d+)?)\s+([\p{L}\p{N}_-]+)/iu);
      if (legacy) {
        return {
          bulkUnit: legacy[1],
          unitsPerBulkUnit: Number(legacy[2].replace(",", ".")),
          baseUnit: legacy[3]
        };
      }
    }
    return { bulkUnit: "", baseUnit: "", unitsPerBulkUnit: 0 };
  }

  function firstPositiveNumber(values) {
    for (const value of values) {
      const match = typeof value === "number"
        ? value
        : String(value || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/)?.[0];
      const number = Number(match);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
  }

  function normalizeUnit(value) {
    const unit = String(value || "").trim().toLocaleLowerCase("tr-TR");
    return {
      l: "litre",
      lt: "litre",
      liter: "litre",
      kilogram: "kg",
      gram: "gr",
      tane: "adet",
      kutu: "paket",
      sise: "şişe"
    }[unit] || (UNITS.includes(unit) ? unit : "adet");
  }

  function packageCount(product) {
    return product ? productUnitMetadata(product).unitsPerBulkUnit : 0;
  }

  function supportedUnits(product) {
    const metadata = productUnitMetadata(product);
    const base = metadata.baseUnit;
    if (["kg", "gr"].includes(base)) return [base, base === "kg" ? "gr" : "kg"];
    if (["litre", "ml"].includes(base)) return [base, base === "litre" ? "ml" : "litre"];
    if (metadata.bulkUnit && metadata.unitsPerBulkUnit) return [base, metadata.bulkUnit];
    return [base];
  }

  function convertLineToBase(line, product) {
    const quantity = Number(line && line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Geçerli miktar gerekli.");
    const requested = normalizeUnit(line && line.unit);
    const metadata = productUnitMetadata(product || { baseUnit: line && line.baseUnit, bulkUnit: line && line.bulkUnit });
    const base = metadata.baseUnit;
    if (requested === base) return { quantity: roundNumber(quantity), unit: base };
    const mass = { kg: 1000, gr: 1 };
    const volume = { litre: 1000, ml: 1 };
    if (mass[requested] && mass[base]) return { quantity: roundNumber(quantity * mass[requested] / mass[base]), unit: base };
    if (volume[requested] && volume[base]) return { quantity: roundNumber(quantity * volume[requested] / volume[base]), unit: base };
    const count = metadata.unitsPerBulkUnit;
    if (requested === metadata.bulkUnit && count) {
      return { quantity: roundNumber(quantity * count), unit: base };
    }
    throw new Error(`“${requested}” birimi “${base}” temel birimine dönüştürülemiyor.`);
  }

  function lineConversion(line, product) {
    try {
      const converted = convertLineToBase(line, product);
      return `${formatNumber(line.quantity)} ${line.unit} = ${formatNumber(converted.quantity)} ${converted.unit}`;
    } catch (error) {
      return error.message;
    }
  }

  function startOfWeek(value) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }

  function addDays(value, amount) {
    const date = new Date(value);
    date.setDate(date.getDate() + amount);
    return date;
  }

  function localDateKey(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDate(value) {
    if (!value) return "Tarih belirtilmedi";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`));
  }

  function formatDateTime(value) {
    if (!value) return "Tarih belirtilmedi";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function formatWeekRange(start) {
    const end = addDays(start, 6);
    const startText = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: start.getMonth() === end.getMonth() ? undefined : "long" }).format(start);
    const endText = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(end);
    return `${startText} – ${endText}`;
  }

  function orderSort(a, b) {
    return Number(a.order || 0) - Number(b.order || 0);
  }

  function roundNumber(value) {
    return Math.round(value * 100) / 100;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function normalizeText(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function capitalize(value) {
    const text = String(value || "");
    return text.charAt(0).toLocaleUpperCase("tr-TR") + text.slice(1);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    if (PREVIEW_TOKEN && method !== "GET") throw new Error("Önizleme modu salt okunurdur.");
    if (method === "GET" && typeof window.MenuSuitePersonelShell?.read === "function") {
      return window.MenuSuitePersonelShell.read(path);
    }
    const headers = Object.assign({
      "Content-Type": "application/json",
      "X-Menu-Suite-App-Id": "personel",
      "X-Menu-Suite-App-Target": "personel"
    }, options.headers || {});
    const target = PREVIEW_TOKEN && String(path || "").startsWith("/api/workforce/me")
      ? appendPreviewToken(path)
      : path;
    const response = await fetch(target, Object.assign({}, options, { credentials: "include", headers }));
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      const error = new Error(result.message || "İşlem gerçekleştirilemedi.");
      error.status = response.status;
      if (response.status === 401 || response.status === 403) notifySessionEnded(error);
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

  function appendPreviewToken(path) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("previewToken", PREVIEW_TOKEN);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
    })[character]);
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#096;");
  }

  function icon(name) {
    const paths = {
      alert: `<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>`,
      "arrow-left": `<path d="m15 18-6-6 6-6"/>`,
      "arrow-right": `<path d="m9 18 6-6-6-6"/>`,
      bell: `<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>`,
      box: `<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4zM12 11v10"/>`,
      camera: `<path d="M4 7h3l1.5-2h7L17 7h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>`,
      calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18"/>`,
      check: `<path d="m5 12 4 4L19 6"/>`,
      chevron: `<path d="m9 6 6 6-6 6"/>`,
      clipboard: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4M9 10h6M9 14h6"/>`,
      clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
      close: `<path d="m6 6 12 12M18 6 6 18"/>`,
      document: `<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>`,
      info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>`,
      loader: `<path d="M20 12a8 8 0 1 1-2.3-5.7"/>`,
      minus: `<path d="M5 12h14"/>`,
      moon: `<path d="M19 15.5A8 8 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5Z"/>`,
      note: `<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>`,
      plus: `<path d="M12 5v14M5 12h14"/>`,
      search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>`,
      send: `<path d="m3 11 18-8-8 18-2-8zM11 13l10-10"/>`,
      sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
      truck: `<path d="M3 6h11v11H3zM14 10h4l3 4v3h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="18" cy="19" r="2"/>`,
      umbrella: `<path d="M4 12a8 8 0 0 1 16 0c-2-1.5-4-1.5-6 0-2-1.5-4-1.5-6 0-1.4-1-2.7-1.3-4 0Z"/><path d="M12 12v6a2 2 0 0 0 4 0"/>`,
      upload: `<path d="M12 16V4M7 9l5-5 5 5M5 15v5h14v-5"/>`
    };
    return `<svg class="wf-icon wf-icon-${name}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  }
})();
