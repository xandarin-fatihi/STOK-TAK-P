(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const icon = (name) => {
    const paths = {
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
      user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
      package: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5Z"/><path d="M12 13v8"/>',
      sparkles: '<path d="m12 3-1.3 3.7L7 8l3.7 1.3L12 13l1.3-3.7L17 8l-3.7-1.3L12 3ZM5 15l-.8 2.2L2 18l2.2.8L5 21l.8-2.2L8 18l-2.2-.8L5 15ZM19 14l-.6 1.4L17 16l1.4.6L19 18l.6-1.4L21 16l-1.4-.6L19 14Z"/>',
      chevronLeft: '<path d="m15 18-6-6 6-6"/>',
      chevronRight: '<path d="m9 18 6-6-6-6"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/>'
    };
    return `<svg class="wf-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
  };

  const state = {
    data: { users: [], tasks: [], materialRequests: [], materialRequestCatalog: { products: [], categories: [], units: { base: [], bulk: [] } }, shiftRequests: [], shiftPlans: [] },
    selectedTaskId: "",
    weekStart: mondayOf(new Date()),
    draftPlans: null,
    shiftEdits: new Map(),
    shiftEditor: null,
    autoDraftProposal: null,
    selectedUsers: new Set(),
    targetType: "selected",
    taskView: "all",
    taskItems: ["", ""],
    taskDraft: { title: "", description: "", priority: "normal", dueDate: "", dueTime: "", managerNote: "" },
    workforceRevision: 0,
    shiftRevision: 0,
    loaded: false,
    stale: true,
    loadPromise: null,
    gatewayBound: false,
    mounted: false,
    clientId: requestId("admin-workforce-events"),
    taskFormDirty: false,
    materialCreateItemKey: "",
    materialMatchItemKey: "",
    materialRejectRequestId: "",
    selectedRequest: null,
    busy: false,
    templates: {
      morning: { startTime: "08:00", endTime: "16:00" },
      evening: { startTime: "16:00", endTime: "00:00" },
      custom: { startTime: "12:00", endTime: "20:00" }
    }
  };
  const refreshTokens = new Map();
  let activePreviewSection = "staffAccess";

  function requestId(prefix) {
    const suffix = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${suffix}`;
  }

  function mutationOptions(method, body, prefix) {
    const id = requestId(prefix);
    return {
      method,
      headers: { "Idempotency-Key": id, "X-Request-ID": id },
      body: JSON.stringify({ ...body, requestId: id, expectedRevision: state.workforceRevision })
    };
  }

  function acceptMutationResult(result) {
    const revision = Number(result && (result.revision ?? result.workforceRevision));
    if (Number.isInteger(revision) && revision >= 0) state.workforceRevision = revision;
    // Mutasyon sonrası sayaçlar yalnız backend'in güncel cevabından yeniden okunur.
    state.stale = true;
    return result;
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
      : coordinator.run(`admin-workforce:${key}`, operation, {
        button,
        classification: window.MenuSuiteOperationClasses && window.MenuSuiteOperationClasses.IMMEDIATE || "immediate-operation"
      });
    return promise.catch(() => undefined);
  }

  async function api(url, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const configuredBase = String(window.MENU_SUITE_BACKEND_URL || localStorage.getItem("menu-suite.backend.url") || "").replace(/\/+$/, "");
    const target = /^https?:\/\//i.test(url) ? url : `${configuredBase}${url}`;
    const response = await fetch(target, {
      credentials: "include",
      ...options,
      headers
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.");
      error.status = response.status;
      error.code = body.code || "";
      error.payload = body;
      throw error;
    }
    return body;
  }

  function dateValue(value) {
    if (!value) return "Tarih yok";
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit", month: "long", year: "numeric"
    }).format(parsed);
  }

  function dateTime(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(parsed);
  }

  function isoDate(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function mondayOf(value) {
    const date = new Date(value);
    date.setHours(12, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return isoDate(date);
  }

  function addDays(value, amount) {
    const date = new Date(`${value}T12:00:00`);
    date.setDate(date.getDate() + amount);
    return isoDate(date);
  }

  function statusLabel(status) {
    return ({
      onay_bekliyor: "Onay Bekliyor", "onaylandı": "Onaylandı", reddedildi: "Reddedildi",
      iptal_edildi: "İptal Edildi",
      pending: "Bekliyor", in_progress: "Devam ediyor", completed: "Tamamlandı",
      atandi: "Atandı", devam_ediyor: "Devam Ediyor", tamamlandi: "Tamamlandı", gecikti: "Gecikti",
      active: "Aktif", archived: "Arşivde", published: "Yayınlandı", draft: "Taslak", cancelled: "İptal Edildi"
    })[status] || status || "Bekliyor";
  }

  function typeLabel(type) {
    return ({ morning: "Sabah", evening: "Akşam", leave: "İzinli", custom: "Belirli Saatler" })[type] || type || "Sabah";
  }

  function userName(id) {
    const user = (state.data.users || []).find((item) => String(item.id) === String(id));
    return user ? (user.name || user.username || "Personel") : "Personel";
  }

  function initials(name) {
    return String(name || "P").split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]).join("").toLocaleUpperCase("tr-TR");
  }

  function showMessage(message, kind = "success") {
    let node = $("#workforceToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "workforceToast";
      node.className = "workforce-toast";
      node.setAttribute("role", "status");
      document.body.append(node);
    }
    node.className = `workforce-toast is-visible is-${kind}`;
    node.textContent = message;
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => node.classList.remove("is-visible"), 3600);
  }

  function setBusy(busy) {
    state.busy = busy;
    if ($("#workforceWeekInput")) $("#workforceWeekInput").disabled = busy;
    const activeAction = busy && document.activeElement instanceof Element
      ? document.activeElement.closest("[data-workforce-action]")
      : null;
    $$("[data-workforce-action]").forEach((button) => {
      button.disabled = busy;
      const isActiveAction = Boolean(busy && activeAction === button);
      button.classList.toggle("is-busy", isActiveAction);
      if (isActiveAction) button.setAttribute("aria-busy", "true");
      else button.removeAttribute("aria-busy");
    });
    $$('[data-material-match-form]').forEach(updateMaterialMatchSelection);
  }

  async function load(options = {}) {
    if (!options.force && state.loaded && !state.stale) return state.data;
    if (state.loadPromise) return state.loadPromise;
    state.loadPromise = loadFromBackend().finally(() => { state.loadPromise = null; });
    return state.loadPromise;
  }

  async function loadFromBackend() {
    const workforce = await api("/api/admin/workforce");
    const incomingRevision = Number(workforce.revision ?? workforce.workforceRevision ?? 0);
    if (incomingRevision < state.workforceRevision) {
      state.stale = true;
      return state.data;
    }
    state.data = {
      users: workforce.users || [],
      tasks: workforce.tasks || [],
      materialRequests: workforce.materialRequests || [],
      materialRequestCatalog: workforce.materialRequestCatalog || { products: [], categories: [], units: { base: [], bulk: [] } },
      shiftRequests: workforce.shiftRequests || [],
      shiftPlans: workforce.shiftPlans || [],
      shiftPlanRevisions: workforce.shiftPlanRevisions || [],
      stats: workforce.stats || null,
      taskActivity: workforce.taskActivity || []
    };
    state.workforceRevision = Number(workforce.revision ?? workforce.workforceRevision ?? state.workforceRevision ?? 0);
    state.shiftRevision = Number(workforce.shiftRevision ?? workforce.publishRevision ?? state.shiftRevision ?? 0);
    if (workforce.shiftSettings) {
      state.templates.morning = { ...state.templates.morning, ...(workforce.shiftSettings.morning || {}) };
      state.templates.evening = { ...state.templates.evening, ...(workforce.shiftSettings.evening || {}) };
    }
    const persistedDrafts = state.data.shiftPlans.filter((plan) =>
      plan.weekStart === state.weekStart && plan.status === "draft"
    );
    state.draftPlans = persistedDrafts.length ? persistedDrafts : null;
    state.loaded = true;
    state.stale = false;
    return state.data;
  }

  function renderOverview() {
    const host = $("#staffOverviewGrid");
    if (!host) return;
    const users = state.data.users || [];
    const today = isoDate(new Date());
    const publishedToday = new Set((state.data.shiftPlans || [])
      .filter((item) => item.date === today && item.status === "published" && item.type !== "leave")
      .map((item) => item.personId));
    const pendingShiftRequests = (state.data.shiftRequests || []).filter((item) => item.status === "onay_bekliyor").length;
    const pendingMaterialRequests = (state.data.materialRequests || []).filter((item) => item.status === "onay_bekliyor").length;
    const stats = state.data.stats || {};
    const cards = [
      ["users", "Toplam Personel", stats.totalPersonnel ?? users.length, "Kayıtlı personel"],
      ["user", "Aktif Personel", stats.activePersonnel ?? users.filter((item) => item.active !== false).length, "Çalışan personel"],
      ["calendar", "Bugünkü Vardiya", stats.todayShift ?? publishedToday.size, "Yayınlanmış vardiya"],
      ["package", "Malzeme Talebi", stats.pendingMaterialRequests ?? pendingMaterialRequests, "Yönetici kararı bekliyor"],
      ["clock", "İzin Talebi", stats.pendingShiftRequests ?? pendingShiftRequests, "Vardiya ve izin talepleri"]
    ];
    host.innerHTML = cards.map(([name, label, value, note]) => `
      <article class="workforce-stat-card">
        <span class="workforce-stat-icon">${icon(name)}</span>
        <div><p>${esc(label)}</p><strong>${esc(value)}</strong><small>${esc(note)}</small></div>
      </article>
    `).join("");
    window.__MENU_SUITE_WORKFORCE_OVERVIEW__ = host.innerHTML;
  }

  // The staff ledger mutation already returns the full canonical user list.
  // Keep the workforce summary on that same revision without a second request.
  window.__MENU_SUITE_WORKFORCE_SYNC_STAFF__ = (users, revision) => {
    const value = Number(revision);
    if (!Array.isArray(users) || !Number.isSafeInteger(value) || value < state.workforceRevision) return;
    state.workforceRevision = value;
    state.data.users = users.filter((user) => user.active !== false);
    state.data.stats = {
      ...(state.data.stats || {}),
      totalPersonnel: users.length,
      activePersonnel: state.data.users.length
    };
    renderOverview();
  };

  function taskAssignmentPercent(task) {
    const assignments = task.assignments || [];
    if (!assignments.length) return 0;
    return Math.round(assignments.reduce((sum, item) => sum + Number(item.percent || 0), 0) / assignments.length);
  }

  function taskStatus(task) {
    if (["iptal_edildi", "cancelled", "archived"].includes(task.status)) return "iptal_edildi";
    if (["tamamlandi", "completed"].includes(task.status)) return "tamamlandi";
    const assignments = task.assignments || [];
    if (assignments.length && assignments.every((item) => ["tamamlandi", "completed"].includes(item.status) || Number(item.percent) === 100)) return "tamamlandi";
    const due = task.dueAt || (task.dueDate ? `${task.dueDate}T${task.dueTime || "23:59"}:00` : "");
    if (due && Date.parse(due) < Date.now()) return "gecikti";
    if (assignments.some((item) => ["devam_ediyor", "in_progress"].includes(item.status) || Number(item.percent) > 0)) return "devam_ediyor";
    return "atandi";
  }

  function taskDueText(task) {
    const date = task.dueAt || task.dueDate;
    if (!date) return "Tarih yok";
    const label = dateValue(date);
    const time = task.dueTime || (/T(\d{2}:\d{2})/.exec(String(task.dueAt || "")) || [])[1];
    return time ? `${label} · ${time}` : label;
  }

  function renderTaskItems() {
    const host = $("#workforceTaskItems");
    if (!host) return;
    host.innerHTML = state.taskItems.map((value, index) => `
      <label class="workforce-task-item">
        <span>${index + 1}</span>
        <input type="text" maxlength="300" value="${esc(value)}" data-task-item="${index}" placeholder="Yapılacak maddeyi yazın">
        <button type="button" data-move-task-item="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""} aria-label="Maddeyi yukarı taşı">${icon("chevronLeft")}</button>
        <button type="button" data-move-task-item="${index}" data-direction="1" ${index === state.taskItems.length - 1 ? "disabled" : ""} aria-label="Maddeyi aşağı taşı">${icon("chevronRight")}</button>
        <button type="button" data-remove-task-item="${index}" aria-label="Maddeyi sil">${icon("close")}</button>
      </label>
    `).join("");
  }

  function activeTaskUsers() {
    return (state.data.users || []).filter(user => user.active !== false);
  }

  function taskRecipients() {
    return activeTaskUsers().filter(user => state.targetType === "all" || state.selectedUsers.has(String(user.id)));
  }

  function renderTargetPicker() {
    const host = $("#workforceTargetPicker");
    if (!host) return;
    const users = activeTaskUsers();
    const selected = state.pickerUsers || new Set(taskRecipients().map(user => String(user.id)));
    const count = users.filter(user => selected.has(String(user.id))).length;
    host.innerHTML = `
      <label class="workforce-select-all"><input type="checkbox" data-select-all ${users.length && count === users.length ? "checked" : ""} ${users.length ? "" : "disabled"}><span>Tümünü Seç</span></label>
        <div class="workforce-person-options">
          ${users.map(user => `<label class="workforce-person-row"><input type="checkbox" data-select-user="${esc(user.id)}" ${selected.has(String(user.id)) ? "checked" : ""}><strong>${esc(user.name || user.username)}</strong><span>${esc(user.jobTitle || "Belirtilmedi")}</span></label>`).join("") || "<p>Aktif personel bulunmuyor.</p>"}
        </div>
        ${users.some(user => user.personelSectionAccess?.tasks === false) ? '<p role="note">Görevlerim erişimi kapalı olan personel seçilirse görev kaydedilmez. Yetkiler otomatik değiştirilmez.</p>' : ""}`;
    const all = $("[data-select-all]", host);
    if (all) all.indeterminate = count > 0 && count < users.length;
    const summary = $("#workforcePickerCount");
    if (summary) summary.textContent = count + " personel seçildi";
    const next = $("[data-finish-task-picker]");
    if (next) next.disabled = !count;
  }

  function changeTaskRecipients(event) {
    if (!state.pickerUsers) return;
    const all = event.target.closest("[data-select-all]");
    const input = event.target.closest("[data-select-user]");
    const users = activeTaskUsers();
    if (all) state.pickerUsers = new Set(all.checked ? users.map(user => String(user.id)) : []);
    else if (input && users.some(user => String(user.id) === input.dataset.selectUser)) {
      if (input.checked) state.pickerUsers.add(input.dataset.selectUser);
      else state.pickerUsers.delete(input.dataset.selectUser);
    } else return;
    // Update in place so the focused checkbox is not replaced.
    $$("[data-select-user]", $("#workforceTargetPicker")).forEach(node => {
      node.checked = state.pickerUsers.has(node.dataset.selectUser);
    });
    const count = users.filter(user => state.pickerUsers.has(String(user.id))).length;
    const checkbox = $("[data-select-all]", $("#workforceTargetPicker"));
    if (checkbox) {
      checkbox.checked = users.length > 0 && count === users.length;
      checkbox.indeterminate = count > 0 && count < users.length;
    }
    $("#workforcePickerCount").textContent = count + " personel seçildi";
    const next = $("[data-finish-task-picker]");
    if (next) next.disabled = !count;
  }

  function finishTaskRecipients() {
    const users = activeTaskUsers();
    const selected = new Set(users.filter(user => state.pickerUsers?.has(String(user.id))).map(user => String(user.id)));
    if (!selected.size) return;
    state.selectedUsers = selected;
    state.targetType = users.length && state.selectedUsers.size === users.length ? "all" : "selected";
    state.taskFormDirty = true;
    $("#workforcePersonDialog")?.close();
    updateTaskAssignmentSummary();
    const composer = $("#workforceComposerDialog");
    // Open before the queued picker close event: keep the form and its draft intact.
    if (composer && !composer.open) composer.showModal();
    $("#workforceTaskForm input[name='title']")?.focus();
  }

  function openTaskPicker() {
    state.pickerFromComposer = Boolean($("#workforceComposerDialog")?.open);
    state.pickerUsers = new Set(taskRecipients().map(user => String(user.id)));
    renderTargetPicker();
    $("#workforcePersonDialog")?.showModal();
  }

  function bindTaskDialogs() {
    const composer = $("#workforceComposerDialog"), picker = $("#workforcePersonDialog");
    const finishClose = () => {
      if (!composer?.open && !picker?.open) {
        renderTasks();
        $(state.taskReturnFocus || "[data-open-task-picker]")?.focus();
      }
    };
    composer?.addEventListener("cancel", event => { if (state.busy) event.preventDefault(); });
    composer?.addEventListener("close", finishClose);
    picker?.addEventListener("close", () => {
      state.pickerUsers = null;
      if (composer?.open) {
        const focusTarget = state.pickerFromComposer ? "[data-open-task-picker]" : "input[name='title']";
        $(focusTarget, composer)?.focus();
      }
      finishClose();
    });
    $$("[data-close-task-composer]").forEach(button => button.addEventListener("click", () => {
      if (!state.busy) composer.close();
    }));
    $$("[data-close-task-picker]").forEach(button => button.addEventListener("click", () => picker.close()));
    $("[data-finish-task-picker]")?.addEventListener("click", finishTaskRecipients);
    $$("[data-open-task-picker]").forEach(button => button.addEventListener("click", () => {
      if (!composer?.open) state.taskReturnFocus = "[data-open-task-picker]";
      openTaskPicker();
    }));
    // Native modal dialogs supply focus trapping, an inert background and Escape handling.
    [composer, picker].forEach(dialog => dialog?.addEventListener("click", event => {
      if (event.target !== dialog || state.busy) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }));
  }

  function renderTasks() {
    const host = $("#workforceTasksPanel");
    if (!host || $("#workforceComposerDialog")?.open || $("#workforcePersonDialog")?.open) return;
    const activities = state.data.taskActivity || [];
    const tasks = (state.data.tasks || []).map((task) => ({
      ...task,
      activity: activities.filter((entry) => String(entry.workforceTaskId || entry.taskId || "") === String(task.id))
    }));
    const visibleTasks = tasks.filter((task) => {
      const status = taskStatus(task);
      if (state.taskView === "all") return true;
      return status === state.taskView;
    });
    const targetCount = taskRecipients().length;
    const filledItemCount = state.taskItems.filter((item) => item.trim()).length;

    host.innerHTML = `
      <div class="workforce-task-layout">
        <section class="workforce-active-tasks">
          <div class="workforce-list-heading"><h3>Atanan Görevler</h3></div>
          <div class="workforce-task-view-tabs" aria-label="Görev görünümü">${[["all","Tümü"],["atandi","Atandı"],["devam_ediyor","Devam ediyor"],["tamamlandi","Tamamlandı"],["gecikti","Gecikti"],["iptal_edildi","İptal edildi"]].map(([v,l]) => `<button class="${state.taskView === v ? "is-active" : ""}" type="button" data-task-view="${v}">${l}</button>`).join("")}</div>
          <div class="workforce-task-ledger"><div class="workforce-task-ledger-head"><span>Görev</span><span>Personel</span><span>Son Tarih</span><span>Durum</span></div>
            ${visibleTasks.map(task => `<button class="workforce-task-ledger-row workforce-task-card" type="button" data-task-detail="${esc(task.id)}"><strong>${esc(task.title)}</strong><span>${esc((task.assignments || []).map(a => a.name || userName(a.userId)).join(", "))}</span><time>${esc(taskDueText(task))}</time><em class="workforce-status is-${esc(taskStatus(task))}">${esc(statusLabel(taskStatus(task)))}</em></button>`).join("") || '<p class="workforce-empty">Bu görünümde görev yok.</p>'}
          </div><div id="workforceTaskDetail"></div>
          <footer class="workforce-task-footer"><span data-task-recipient-count>${targetCount} personel seçildi</span><button type="button" class="ui-button ui-button--primary" data-open-task-picker>${icon("users")} Personel Seç</button></footer>
        </section>
      </div>
      <dialog id="workforceComposerDialog" class="workforce-modal" aria-labelledby="workforceComposerTitle"><header><h3 id="workforceComposerTitle">Görev Bilgileri</h3><button type="button" class="ui-button ui-button--secondary" data-close-task-composer aria-label="Görev formunu kapat">${icon("close")}</button></header>
        <form class="workforce-task-builder" id="workforceTaskForm"><div class="workforce-modal-body">
          <div class="workforce-composer-recipients"><span data-task-recipient-count>${targetCount} personel seçildi</span><button type="button" class="ui-button ui-button--secondary" data-open-task-picker>Personel Seç</button></div>
          <label class="workforce-field"><span>Görev başlığı</span><input name="title" maxlength="160" required value="${esc(state.taskDraft.title)}" placeholder="Örn. Rulmanları kontrol et"></label>
          <label class="workforce-field"><span>Açıklama <small>(isteğe bağlı)</small></span><textarea name="description" maxlength="1000" rows="3">${esc(state.taskDraft.description)}</textarea></label>
          <label class="workforce-field"><span>Son tarih</span><input name="dueDate" type="date" value="${esc(state.taskDraft.dueDate)}"></label>
          <details class="workforce-extra-options"><summary>Ek seçenekler</summary>
            <fieldset class="workforce-fieldset"><legend>Görev maddeleri (isteğe bağlı)</legend><div id="workforceTaskItems"></div><button class="workforce-add-item" type="button" data-add-task-item>${icon("plus")} Madde ekle</button></fieldset>
            <div class="workforce-form-row"><label class="workforce-field"><span>Öncelik</span><select name="priority">${[["low","Düşük"],["normal","Normal"],["high","Yüksek"],["urgent","Acil"]].map(([v,l]) => `<option value="${v}" ${state.taskDraft.priority === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label class="workforce-field"><span>Teslim saati</span><input name="dueTime" type="time" value="${esc(state.taskDraft.dueTime)}"></label></div>
            <label class="workforce-field"><span>Yönetici notu</span><textarea name="managerNote" maxlength="500" rows="2">${esc(state.taskDraft.managerNote)}</textarea></label>
            <div class="workforce-assignment-summary" aria-live="polite"><b>Atama özeti</b><span>${targetCount} personel</span><span>${filledItemCount} madde</span><span>${esc(state.taskDraft.priority)}</span><span>${state.taskDraft.dueDate ? esc(dateValue(state.taskDraft.dueDate)) : "Son tarih yok"}</span></div>
          </details>
          </div><footer><button type="button" class="ui-button ui-button--secondary" data-close-task-composer>Vazgeç</button><button class="ui-button ui-button--primary" type="submit" data-workforce-action data-operation-class="immediate-operation">Görevi Ata</button></footer>
        </form>
      </dialog>
      <dialog id="workforcePersonDialog" class="workforce-modal" aria-labelledby="workforcePersonTitle"><header><h3 id="workforcePersonTitle">Personel Seç</h3><button type="button" class="ui-button ui-button--secondary" data-close-task-picker aria-label="Personel seçimini kapat">${icon("close")}</button></header><div class="workforce-modal-body" id="workforceTargetPicker"></div><footer><span id="workforcePickerCount" aria-live="polite">0 personel seçildi</span><div><button type="button" class="ui-button ui-button--secondary" data-close-task-picker>Vazgeç</button><button type="button" class="ui-button ui-button--primary" data-finish-task-picker>Devam Et</button></div></footer></dialog>`;
    renderTaskItems();
    renderTargetPicker();
    if (state.selectedTaskId) renderTaskDetail(state.selectedTaskId);
    bindTasks();
  }

  function renderTaskDetail(taskId) {
    const host = $("#workforceTaskDetail");
    const task = (state.data.tasks || []).find((item) => String(item.id) === String(taskId));
    if (!host || !task) return;
    host.innerHTML = `
      <div class="workforce-detail-card">
        <div class="workforce-detail-head">
          <div><p class="eyebrow">Görev Ayrıntısı</p><h4>${esc(task.title)}</h4></div>
          <div class="workforce-detail-actions">
            ${taskStatus(task) === "iptal_edildi" ? "" : `<button class="ui-button ui-button--danger ui-button--sm" type="button" data-task-status="iptal_edildi" data-workforce-action>Görevi İptal Et</button>`}
            <button type="button" data-close-task-detail aria-label="Detayı kapat">${icon("close")}</button>
          </div>
        </div>
        ${task.description ? `<p>${esc(task.description)}</p>` : ""}
        <div class="workforce-detail-meta"><span><b>Öncelik:</b> ${esc(task.priority || "normal")}</span><span><b>Teslim:</b> ${esc(taskDueText(task))}</span><span><b>Durum:</b> ${esc(statusLabel(taskStatus(task)))}</span></div>
        ${task.managerNote ? `<div class="workforce-manager-note"><b>Yönetici notu</b><p>${esc(task.managerNote)}</p></div>` : ""}
        <ol class="workforce-detail-items">${(task.items || []).map((item) => `<li>${esc(item.text || item)}</li>`).join("")}</ol>
        <div class="workforce-assignment-detail">
          ${(task.assignments || []).map((assignment) => {
            const percent = Number(assignment.percent || 0);
            const completed = new Set(assignment.completedItemIds || []);
            const completedLabels = (task.items || []).filter((item) => completed.has(item.id)).map((item) => item.text || item.title);
            return `<article><span class="workforce-avatar">${esc(initials(assignment.name || userName(assignment.userId)))}</span><div><strong>${esc(assignment.name || userName(assignment.userId))}</strong><small>${completed.size}/${(task.items || []).length} madde · ${esc(statusLabel(assignment.status))}</small>${completedLabels.length ? `<small class="workforce-completed-items">Tamamlanan: ${esc(completedLabels.join(", "))}</small>` : `<small class="workforce-completed-items">Henüz tamamlanan madde yok.</small>`}<small>Son aktivite: ${esc(dateTime(assignment.updatedAt || assignment.completedAt || task.updatedAt))}</small><span class="workforce-progress"><i style="width:${percent}%"></i></span></div><b>%${percent}</b></article>`;
          }).join("") || "<p>Atama kaydı bulunmuyor.</p>"}
        </div>
        ${(task.activity || task.activities || []).length ? `<div class="workforce-task-activity"><b>Aktivite geçmişi</b>${(task.activity || task.activities).slice(-8).reverse().map((entry) => `<p><span>${esc(entry.label || statusLabel(entry.type || entry.status))}</span><time>${esc(dateTime(entry.createdAt || entry.at))}</time></p>`).join("")}</div>` : ""}
      </div>
    `;
    $("[data-close-task-detail]", host)?.addEventListener("click", () => {
      state.selectedTaskId = "";
      host.innerHTML = "";
      $$(".workforce-task-card").forEach((card) => card.classList.remove("is-selected"));
    });
    $("[data-task-status]", host)?.addEventListener("click", (event) => updateTaskStatus(task.id, event.currentTarget.dataset.taskStatus));
  }

  async function updateTaskStatus(taskId, status) {
    try {
      setBusy(true);
      acceptMutationResult(await api(`/api/admin/workforce/tasks/${encodeURIComponent(taskId)}`, mutationOptions("PATCH", { status }, `task-status-${taskId}`)));
      state.selectedTaskId = "";
      state.taskView = status === "iptal_edildi" ? "iptal_edildi" : "all";
      await refresh("tasks");
      showMessage(status === "iptal_edildi" ? "Görev iptal edildi; personel atamaları salt okunur hale geldi." : "Görev durumu güncellendi.");
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function bindTasks() {
    $("#workforceTaskForm")?.addEventListener("input", (event) => {
      if (event.target.name && Object.prototype.hasOwnProperty.call(state.taskDraft, event.target.name)) {
        state.taskDraft[event.target.name] = event.target.value;
      }
      state.taskFormDirty = true;
      updateTaskAssignmentSummary();
    });
    $("#workforceTaskForm")?.addEventListener("change", (event) => {
      if (event.target.name && Object.prototype.hasOwnProperty.call(state.taskDraft, event.target.name)) {
        state.taskDraft[event.target.name] = event.target.value;
      }
      state.taskFormDirty = true;
      updateTaskAssignmentSummary();
    });
    $("#workforceTaskItems")?.addEventListener("input", (event) => {
      const input = event.target.closest("[data-task-item]");
      if (input) {
        state.taskItems[Number(input.dataset.taskItem)] = input.value;
        state.taskFormDirty = true;
        updateTaskAssignmentSummary();
      }
    });
    $("#workforceTaskItems")?.addEventListener("click", (event) => {
      const mover = event.target.closest("[data-move-task-item]");
      if (mover) {
        const from = Number(mover.dataset.moveTaskItem);
        const to = from + Number(mover.dataset.direction);
        if (to >= 0 && to < state.taskItems.length) {
          [state.taskItems[from], state.taskItems[to]] = [state.taskItems[to], state.taskItems[from]];
          state.taskFormDirty = true;
          renderTaskItems();
          updateTaskAssignmentSummary();
        }
        return;
      }
      const button = event.target.closest("[data-remove-task-item]");
      if (!button) return;
      if (state.taskItems.length === 1) state.taskItems[0] = "";
      else state.taskItems.splice(Number(button.dataset.removeTaskItem), 1);
      state.taskFormDirty = true;
      renderTaskItems();
      updateTaskAssignmentSummary();
    });
    $("[data-add-task-item]")?.addEventListener("click", () => {
      state.taskItems.push("");
      state.taskFormDirty = true;
      renderTaskItems();
      $("#workforceTaskItems input:last-of-type")?.focus();
    });
    $("#workforceTargetPicker")?.addEventListener("change", changeTaskRecipients);
    bindTaskDialogs();
    $("#workforceTaskForm")?.addEventListener("submit", createTask);
    $$("[data-task-view]").forEach((button) => button.addEventListener("click", () => {
      state.taskView = button.dataset.taskView;
      state.selectedTaskId = "";
      renderTasks();
    }));
    $$("[data-task-detail]").forEach((button) => button.addEventListener("click", () => {
      state.selectedTaskId = button.dataset.taskDetail;
      $$(".workforce-task-card").forEach((card) => card.classList.toggle("is-selected", card.dataset.taskDetail === state.selectedTaskId));
      renderTaskDetail(state.selectedTaskId);
    }));
  }

  function updateTaskAssignmentSummary() {
    $$("[data-task-recipient-count]").forEach(node => { node.textContent = taskRecipients().length + " personel seçildi"; });
    const host = $(".workforce-assignment-summary");
    if (!host) return;
    const targetCount = taskRecipients().length;
    const labels = host.querySelectorAll("span");
    if (labels[0]) labels[0].textContent = `${targetCount} personel`;
    if (labels[1]) labels[1].textContent = `${state.taskItems.filter((item) => item.trim()).length} madde`;
    if (labels[2]) labels[2].textContent = state.taskDraft.priority === "urgent" ? "Acil" : state.taskDraft.priority === "high" ? "Yüksek" : state.taskDraft.priority === "low" ? "Düşük" : "Normal";
    if (labels[3]) labels[3].textContent = state.taskDraft.dueDate ? dateValue(state.taskDraft.dueDate) : "Teslim tarihi yok";
  }

  function createTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    return runImmediateOperation("task-assign", form.querySelector("[type='submit']"), () => executeCreateTask(event));
  }

  async function executeCreateTask(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const items = state.taskItems.map((text, index) => ({ id: `item-${index + 1}`, text: text.trim() })).filter((item) => item.text);
    if (!items.length) items.push({ id: "item-1", text: String(formData.get("title") || "").trim() });
    if (state.targetType === "selected" && !state.selectedUsers.size) {
      showMessage("En az bir aktif personel seçin.", "error");
      return operationSkipped("validation");
    }
    try {
      setBusy(true);
      acceptMutationResult(await api("/api/admin/workforce/tasks", mutationOptions("POST", {
          title: String(formData.get("title") || "").trim(),
          description: String(formData.get("description") || "").trim(),
          items,
          priority: formData.get("priority"),
          dueDate: formData.get("dueDate"),
          dueTime: formData.get("dueTime"),
          dueAt: formData.get("dueDate") ? `${formData.get("dueDate")}T${formData.get("dueTime") || "23:59"}:00` : null,
          managerNote: String(formData.get("managerNote") || "").trim(),
          targetType: state.targetType,
          assignedUserIds: Array.from(state.selectedUsers)
        }, "task-create")));
      state.taskItems = ["", ""];
      state.taskDraft = { title: "", description: "", priority: "normal", dueDate: "", dueTime: "", managerNote: "" };
      state.taskFormDirty = false;
      state.selectedUsers.clear();
      state.targetType = "selected";
      $("#workforcePersonDialog")?.close();
      $("#workforceComposerDialog")?.close();
      await refresh("tasks");
      showMessage("Görevler personellere atandı.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function materialIdentity(value) {
    return String(value || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/\s+/g, " ");
  }

  function materialRequestStatus(request) {
    return statusLabel(request && request.status || "onay_bekliyor");
  }

  function catalogProduct(productId) {
    return (state.data.materialRequestCatalog?.products || []).find((product) => String(product.id) === String(productId)) || null;
  }

  function exactMaterialMatches(item) {
    const code = String(item.code || "").trim().toLocaleUpperCase("tr-TR");
    const name = materialIdentity(item.name);
    return (state.data.materialRequestCatalog?.products || []).filter((product) => (
      code && String(product.productCode || "").trim().toLocaleUpperCase("tr-TR") === code
    ) || (name && materialIdentity(product.name) === name));
  }

  function renderMaterialRequests() {
    const host = operationHost("materialRequests");
    if (!host) return;
    const requests = [...(state.data.materialRequests || [])].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const pending = requests.filter((request) => request.status === "onay_bekliyor").length;
    host.innerHTML = `
      <div class="material-requests-toolbar"><button class="ui-button ui-button--primary" type="button" data-material-excel>Excel Çıktısı Al</button></div>
      <div class="requests-list">${requests.length ? requestListHeading("Talep") + requests.map((request) => requestListRow(request, "material", materialRequestSummary(request))).join("") : `<div class="workforce-empty">${icon("package")}<h4>Malzeme talebi yok</h4><p>Personelin gönderdiği talepler burada görünecek.</p></div>`}</div>`;
    $("[data-material-excel]", host)?.addEventListener("click", () => window.STSMaterialBatch?.open());
    if ($("#materialRequestsPendingCount")) $("#materialRequestsPendingCount").textContent = `${pending} bekleyen`;
    bindRequestList(host);
  }

  function materialRequestSummary(request) {
    const items = request.items || [];
    const first = items[0];
    return first ? `${first.name} · ${formatQuantity(first.quantity)} ${first.unit || "adet"}${items.length > 1 ? ` · +${items.length - 1} kalem` : ""}` : "Malzeme talebi";
  }

  function requestListHeading(label) {
    return `<div class="requests-row requests-row-heading" aria-hidden="true"><span>${esc(label)}</span><span>Personel</span><span class="requests-date">Tarih</span><span>Durum</span><span></span></div>`;
  }

  function requestListRow(request, kind, description) {
    const title = kind === "material" ? request.requestNumber || "Malzeme talebi" : typeLabel(request.type);
    const status = request.status === "onay_bekliyor" ? "Bekliyor" : statusLabel(request.status);
    return `<article class="requests-row"><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span class="requests-person"><strong>${esc(request.personName || userName(request.personId))}</strong><small>${esc(dateValue(request.createdAt))}</small></span><span class="requests-date">${esc(dateValue(request.createdAt))}</span><em class="workforce-status is-${esc(request.status)}">${esc(status)}</em><button class="ui-button ui-button--secondary ui-button--sm" type="button" data-request-inspect="${esc(request.id)}" data-request-kind="${kind}" aria-label="${esc(title)} talebini incele">İncele</button></article>`;
  }

  function renderLeaveRequests() {
    const host = $("#workforceLeaveRequestsPanel");
    if (!host) return;
    // Eski vardiya tercihleri de erişilebilir kalır; hiçbir talep kaydı filtreyle kaybolmaz.
    const requests = [...(state.data.shiftRequests || [])].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    const pending = requests.filter((request) => request.status === "onay_bekliyor").length;
    if ($("#leaveRequestsPendingCount")) $("#leaveRequestsPendingCount").textContent = `${pending} bekleyen`;
    host.innerHTML = `<div class="requests-list">${requests.length ? requestListHeading("Talep") + requests.map((request) => requestListRow(request, "leave", `${leaveDateLabel(request)}${request.startTime ? ` · ${request.startTime} – ${request.endTime}` : ""}${request.dayCount != null ? ` (${request.dayCount} gün · Pazar hariç)` : ""}`)).join("") : `<div class="workforce-empty">${icon("calendar")}<h4>İzin talebi yok</h4><p>Personelin gönderdiği talepler burada görünecek.</p></div>`}</div>`;
    bindRequestList(host);
  }

  function bindRequestList(host) {
    $$("[data-request-inspect]", host).forEach((button) => button.addEventListener("click", () => openRequestDetail(button.dataset.requestKind, button.dataset.requestInspect)));
  }

  function openRequestDetail(kind, id) {
    const list = kind === "material" ? state.data.materialRequests : state.data.shiftRequests;
    if (!list.some((request) => String(request.id) === String(id))) return;
    state.selectedRequest = { kind, id: String(id) };
    renderRequestDetail();
    const dialog = $("#adminRequestDialog");
    if (dialog && !dialog.open) dialog.showModal();
  }

  function renderRequestDetail() {
    const selected = state.selectedRequest;
    const host = $("#adminRequestDialogContent");
    if (!selected || !host) return;
    const list = selected.kind === "material" ? state.data.materialRequests : state.data.shiftRequests;
    const request = list.find((item) => String(item.id) === selected.id);
    if (!request) return;
    const title = $("#adminRequestDialogTitle");
    if (selected.kind === "material") title.innerHTML = `${esc(request.requestNumber || "Malzeme Talebi")} <span class="requests-requester">(${esc(request.personName || userName(request.personId))})</span>`;
    else title.textContent = "İzin Talebi";
    host.innerHTML = selected.kind === "material" ? renderAdminMaterialRequest(request, true) : renderLeaveRequestDetail(request);
    if (selected.kind === "material") bindMaterialRequests(host);
    else bindShiftRequestDecisions(host);
  }

  function renderLeaveRequestDetail(request) {
    return `<article class="workforce-request-card"><div><span class="workforce-avatar">${esc(initials(request.personName || userName(request.personId)))}</span><div><strong>${esc(request.personName || userName(request.personId))}</strong><em class="workforce-status is-${esc(request.status)}">${esc(statusLabel(request.status))}</em></div></div><h4>${esc(typeLabel(request.type))}</h4><p>${esc(leaveDateLabel(request))}${request.startTime ? ` · ${esc(request.startTime)} – ${esc(request.endTime)}` : ""}${request.dayCount != null ? ` (${esc(request.dayCount)} gün · Pazar hariç)` : ""}</p>${request.description ? `<small>${esc(request.description)}</small>` : ""}${request.status === "onay_bekliyor" ? `<textarea maxlength="250" data-request-note="${esc(request.id)}" aria-label="Yönetici notu" placeholder="Yönetici notu"></textarea><div><button class="ui-button ui-button--danger ui-button--sm" type="button" data-request-id="${esc(request.id)}" data-request-decision="reject" data-workforce-action>Reddet</button><button class="ui-button ui-button--primary ui-button--sm" type="button" data-request-id="${esc(request.id)}" data-request-decision="approve" data-workforce-action>Onayla</button></div>` : `<small>${request.adminNote ? `Yönetici notu: ${esc(request.adminNote)} · ` : ""}${esc(dateTime(request.decidedAt))}</small>`}</article>`;
  }

  function leaveDateLabel(request) {
    const start = request.startDate || request.date;
    const end = request.endDate || start;
    return end !== start ? `${dateValue(start)} – ${dateValue(end)}` : dateValue(start);
  }

  function bindShiftRequestDecisions(host) {
    $$("[data-request-decision]", host).forEach((button) => button.addEventListener("click", () => runImmediateOperation(`shift-request-${button.dataset.requestDecision}:${button.dataset.requestId}`, button, () => decideRequest(button.dataset.requestId, button.dataset.requestDecision))));
  }

  function setupRequestDialog() {
    const dialog = $("#adminRequestDialog");
    if (!dialog || dialog.dataset.bound === "true") return;
    dialog.dataset.bound = "true";
    const close = () => { if (!state.busy) dialog.close(); };
    $("#adminRequestDialogClose")?.addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } });
    dialog.addEventListener("cancel", (event) => { if (state.busy) event.preventDefault(); });
    dialog.addEventListener("close", () => {
      const id = state.selectedRequest?.id;
      state.selectedRequest = null;
      state.materialCreateItemKey = "";
      state.materialMatchItemKey = "";
      state.materialRejectRequestId = "";
      if (id) $(`[data-request-inspect="${CSS.escape(id)}"]`)?.focus();
      if (state.stale && isWorkforceOwnerSection(window.MenuSuiteAdminBridge?.activeSection())) refresh("approvals", { force: true }).catch((error) => showMessage(error.message, "error"));
    });
  }

  function renderAdminMaterialRequest(request, forceOpen) {
    const open = forceOpen || request.status === "onay_bekliyor";
    return `<details class="amr-card" data-material-request-id="${esc(request.id)}" ${open ? "open" : ""}>
      <summary data-request-id="${esc(request.id)}"><span><strong>${esc(request.requestNumber || "Malzeme talebi")}</strong><small>${esc(request.personName || userName(request.personId))} · ${esc(request.department || "Bölüm belirtilmedi")}</small></span><span><b>${(request.items || []).length} kalem</b><small>${esc(dateTime(request.createdAt))}</small></span><em class="workforce-status is-${esc(request.status)}">${esc(materialRequestStatus(request))}</em>${icon("chevronRight")}</summary>
      <div class="amr-detail">
        <p class="amr-request-date">${esc(dateTime(request.createdAt))}</p>
        ${request.approvedAt || request.receivedAt ? `<div class="amr-audit">${request.approvedAt ? `<span><small>Onaylayan</small><b>Yönetici</b><em>${esc(dateTime(request.approvedAt))}</em></span>` : ""}${request.receivedAt ? `<span><small>Teslim alan</small><b>${esc(request.receivedBy || "Personel")}</b><em>${esc(dateTime(request.receivedAt))}</em></span>` : ""}</div>` : ""}
        <div class="amr-items">${(request.items || []).map((item) => renderAdminMaterialItem(request, item)).join("")}</div>
        <div class="amr-decision">${request.status === "onay_bekliyor" ? `${state.materialRejectRequestId === request.id ? `<form class="amr-reject-form" data-material-reject-form="${esc(request.id)}"><label><span>Reddetme nedeni *</span><input data-material-note="${esc(request.id)}" maxlength="500" required placeholder="Personele iletilecek gerekçe"></label><div class="amr-form-footer"><button class="ui-button ui-button--secondary" type="button" data-material-reject-cancel>Vazgeç</button><button class="ui-button ui-button--danger" type="submit" data-workforce-action>Reddetmeyi Onayla</button></div></form>` : `<div><button class="ui-button ui-button--danger" type="button" data-material-reject-toggle="${esc(request.id)}">Reddet</button><button class="ui-button ui-button--primary" type="button" data-material-decision="approve" data-material-request="${esc(request.id)}" data-workforce-action>Talebi Onayla</button></div>`}` : `<p><b>${esc(materialRequestStatus(request))}</b>${request.adminNote ? ` · ${esc(request.adminNote)}` : ""}</p>`}</div>
      </div>
    </details>`;
  }

  function renderAdminMaterialItem(request, item) {
    const product = item.linkedProductId ? catalogProduct(item.linkedProductId) : null;
    const exact = exactMaterialMatches(item);
    const products = state.data.materialRequestCatalog?.products || [];
    const createKey = `${request.id}:${item.id}`;
    const showCreate = state.materialCreateItemKey === createKey;
    const showMatch = state.materialMatchItemKey === createKey;
    const ordered = [...exact, ...products.filter((productItem) => !exact.some((candidate) => candidate.id === productItem.id))];
    const decision = item.decisionStatus || request.status;
    const approvedInfo = decision === "onaylandı" ? `<p class="amr-item-decision">Onaylanan: <strong>${esc(formatQuantity(item.approvedQuantity ?? item.quantity))} adet</strong> · İstenen: ${esc(formatQuantity(item.quantity))}</p>` : decision === "reddedildi" ? `<p class="amr-item-decision">Bu kalem reddedildi.</p>` : "";
    return `<article class="amr-item" data-material-item="${esc(item.id)}">
      <div class="amr-item-main">${item.imageUrl ? `<a class="amr-image" href="${esc(item.imageUrl)}" target="_blank" rel="noopener" title="Görseli aç"><img src="${esc(item.imageUrl)}" alt="${esc(item.name)}"></a>` : `<span class="amr-image is-empty">${icon("package")}</span>`}<div><h4>${esc(item.name)}</h4><p>${item.code ? `Kod: ${esc(item.code)}` : "Kod belirtilmedi"}</p><strong>${esc(formatQuantity(item.quantity))} ${esc(item.unit)}</strong>${item.supplier ? `<small>Tedarikçi: ${esc(item.supplier)}</small>` : ""}${item.usageLocation ? `<small>Kullanım yeri: ${esc(item.usageLocation)}</small>` : ""}${item.neededDate ? `<small>Termin: ${esc(dateValue(item.neededDate))}</small>` : ""}${item.description ? `<small>${esc(item.description)}</small>` : ""}</div></div>
      ${product ? `<div class="amr-linked"><span>${icon("check")}<b>${esc(product.name)}</b><small>${esc(product.productCode || "Ürün kodu yok")}</small></span><button class="ui-button ui-button--secondary" type="button" data-open-stock-product="${esc(product.id)}">Ürün Kartını Aç</button></div>` : `<div class="amr-actions"><button class="ui-button ui-button--primary" type="button" data-material-create-toggle="${esc(createKey)}" aria-expanded="${showCreate}">${icon("plus")}Yeni Ürün Olarak Ekle</button><button class="ui-button ui-button--secondary" type="button" data-material-match-toggle="${esc(createKey)}" aria-expanded="${showMatch}">Mevcut Ürün ile Eşleştir</button></div>`}
      ${approvedInfo}
      ${showCreate && !product ? renderMaterialProductForm(request, item) : ""}
      ${showMatch && !product ? renderMaterialMatchForm(createKey, ordered) : ""}
    </article>`;
  }

  function renderMaterialProductForm(request, item) {
    const catalog = state.data.materialRequestCatalog || { categories: [] };
    return `<form class="amr-product-form" data-material-product-form="${esc(request.id)}:${esc(item.id)}">
      <header><div><strong>Yeni Stok Kartı</strong><small>Stok miktarı eklenmez; yalnız ürün kartı oluşturulur.</small></div><button type="button" data-material-create-cancel aria-label="Formu kapat">${icon("close")}</button></header>
      <div class="amr-product-grid"><label><span>Ürün adı *</span><input name="name" maxlength="180" value="${esc(item.name)}" required></label><label><span>Talepteki kod</span><input name="productCode" maxlength="120" value="${esc(item.code || "")}"><small>Stok kodu kurala uymuyorsa sistem güvenli bir kod üretir.</small></label><label class="amr-wide"><span>Kategori *</span><select name="categoryId" required><option value="">Kategori seçin</option>${(catalog.categories || []).map((category) => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join("")}</select><small>Depo içindeki ürün kategorisidir; depo seçimi değildir.</small></label><label class="amr-wide"><span>Not</span><textarea name="note" maxlength="1000" rows="2">${esc(item.description || "")}</textarea></label></div>
      <div class="amr-form-footer"><button class="ui-button ui-button--secondary" type="button" data-material-create-cancel>Vazgeç</button><button class="ui-button ui-button--primary" type="submit" data-workforce-action>Stok Kartını Oluştur</button></div>
    </form>`;
  }

  function renderMaterialMatchForm(key, products) {
    return `<form class="amr-match-form" data-material-match-form="${esc(key)}">
      <header><strong>Mevcut Ürün ile Eşleştir</strong><button type="button" data-material-match-cancel aria-label="Eşleştirmeyi kapat">${icon("close")}</button></header>
      <label><span>Ürün ara</span><input type="search" data-material-match-search placeholder="Ürün adı veya koduyla ara" autocomplete="off"></label>
      <p class="amr-match-message" data-material-match-hint>Arama yapınca sonuçlar burada görünür.</p>
      <div class="amr-match-results" data-material-match-results hidden>
        <div class="amr-match-head"><span>Görsel</span><span>Ürün adı</span><span>Mevcut stok</span></div>
        ${products.map((product) => `<label class="amr-match-option" data-material-match-option data-search="${esc(`${product.name} ${product.productCode || ""}`)}" hidden>
          <input type="radio" name="materialMatchProduct" value="${esc(product.id)}" required disabled>
          <span class="amr-match-image">${product.imageUrl ? `<img src="${esc(product.imageUrl)}" alt="" loading="lazy">` : icon("package")}</span>
          <b class="amr-match-name">${esc(product.name)}</b>
          <strong class="amr-match-stock">${product.quantity != null && Number.isFinite(Number(product.quantity)) ? `${esc(formatQuantity(product.quantity))} adet` : "—"}</strong>
        </label>`).join("")}
      </div>
      <p class="amr-match-message" data-material-match-empty role="status" hidden>Eşleşen ürün bulunamadı.</p>
      <div class="amr-form-footer" data-material-match-footer hidden><button class="ui-button ui-button--secondary" type="button" data-material-match-cancel>Vazgeç</button><button class="ui-button ui-button--primary" type="submit" data-workforce-action disabled>Eşleştir</button></div>
    </form>`;
  }

  function bindMaterialRequests(host) {
    $$('[data-material-create-toggle]', host).forEach((button) => button.addEventListener("click", () => {
      state.materialCreateItemKey = button.dataset.materialCreateToggle;
      state.materialMatchItemKey = "";
      renderRequestDetail();
      $(`[data-material-product-form="${CSS.escape(state.materialCreateItemKey)}"] input[name=name]`, host)?.focus();
    }));
    $$('[data-material-create-cancel]', host).forEach((button) => button.addEventListener("click", () => { state.materialCreateItemKey = ""; renderRequestDetail(); }));
    $$('[data-material-match-toggle]', host).forEach((button) => button.addEventListener("click", () => {
      state.materialMatchItemKey = button.dataset.materialMatchToggle;
      state.materialCreateItemKey = "";
      renderRequestDetail();
      $('[data-material-match-search]', host)?.focus();
    }));
    $$('[data-material-match-cancel]', host).forEach((button) => button.addEventListener("click", () => { state.materialMatchItemKey = ""; renderRequestDetail(); }));
    $$('[data-material-match-search]', host).forEach((input) => input.addEventListener("input", () => filterMaterialMatches(input.closest('form'), input.value)));
    $$('[data-material-match-form]', host).forEach((form) => form.addEventListener("change", () => updateMaterialMatchSelection(form)));
    $$('[data-material-match-form]', host).forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (form.reportValidity()) matchMaterialItem(form.dataset.materialMatchForm, form.querySelector('[type=submit]'));
    }));
    $$('[data-material-reject-toggle]', host).forEach((button) => button.addEventListener("click", () => {
      state.materialRejectRequestId = button.dataset.materialRejectToggle;
      renderRequestDetail();
      $('[data-material-note]', host)?.focus();
    }));
    $$('[data-material-reject-cancel]', host).forEach((button) => button.addEventListener("click", () => { state.materialRejectRequestId = ""; renderRequestDetail(); }));
    $$('[data-material-reject-form]', host).forEach((form) => form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (form.reportValidity()) decideMaterialRequest(form.dataset.materialRejectForm, "reject", form.querySelector('[type=submit]'));
    }));
    $$('[data-material-product-form]', host).forEach((form) => form.addEventListener("submit", createMaterialProduct));
    $$('[data-material-decision]', host).forEach((button) => button.addEventListener("click", () => decideMaterialRequest(button.dataset.materialRequest, button.dataset.materialDecision, button)));
    $$('[data-open-stock-product]', host).forEach((button) => button.addEventListener("click", () => document.dispatchEvent(new CustomEvent("menu-suite:open-stock-product", { detail: { productId: button.dataset.openStockProduct } }))));
  }

  function filterMaterialMatches(form, value) {
    const search = String(value || "").trim().toLocaleLowerCase("tr-TR");
    const options = $$('[data-material-match-option]', form);
    options.forEach((option) => {
      option.hidden = !search || !option.dataset.search.toLocaleLowerCase("tr-TR").includes(search);
      const radio = $('input', option);
      radio.disabled = option.hidden;
      if (option.hidden) radio.checked = false;
    });
    const hasResults = options.some((option) => !option.hidden);
    const hint = $('[data-material-match-hint]', form);
    if (hint) hint.hidden = Boolean(search);
    const results = $('[data-material-match-results]', form);
    if (results) results.hidden = !hasResults;
    const empty = $('[data-material-match-empty]', form);
    if (empty) empty.hidden = !search || hasResults;
    const footer = $('[data-material-match-footer]', form);
    if (footer) footer.hidden = !hasResults;
    updateMaterialMatchSelection(form);
  }

  function updateMaterialMatchSelection(form) {
    const selected = $$('[data-material-match-option]', form).some((option) => {
      const radio = $('input', option);
      return !option.hidden && radio.checked && !radio.disabled;
    });
    const submit = $('[type=submit]', form);
    if (submit) submit.disabled = !selected || state.busy;
  }

  async function matchMaterialItem(key, button) {
    const [requestIdValue, itemId] = String(key || "").split(":");
    const form = $(`[data-material-match-form="${CSS.escape(key)}"]`);
    const productId = form?.querySelector('input[name=materialMatchProduct]:checked:not(:disabled)')?.value || "";
    if (!productId) { showMessage("Eşleştirilecek stok ürününü seçin.", "error"); form?.querySelector('[data-material-match-search]')?.focus(); return operationSkipped("validation"); }
    return runImmediateOperation(`material-match:${key}`, button, async () => {
      try {
        setBusy(true);
        acceptMutationResult(await api(`/api/admin/workforce/material-requests/${encodeURIComponent(requestIdValue)}/items/${encodeURIComponent(itemId)}/match`, mutationOptions("POST", { productId }, `material-match-${itemId}`)));
        state.materialMatchItemKey = "";
        await refresh("materialRequests", { force: true });
        showMessage("Talep kalemi stok ürünüyle eşleştirildi.");
      } catch (error) { showMessage(error.message, "error"); throw error; }
      finally { setBusy(false); }
    });
  }

  async function createMaterialProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return operationSkipped("validation");
    const [requestIdValue, itemId] = String(form.dataset.materialProductForm || "").split(":");
    const values = Object.fromEntries(new FormData(form).entries());
    Object.assign(values, { baseUnit: "adet", bulkUnit: "", unitsPerBulkUnit: 0, allowDecimal: false });
    return runImmediateOperation(`material-product:${itemId}`, form.querySelector("[type=submit]"), async () => {
      try {
        setBusy(true);
        const result = acceptMutationResult(await api(`/api/admin/workforce/material-requests/${encodeURIComponent(requestIdValue)}/items/${encodeURIComponent(itemId)}/product`, mutationOptions("POST", values, `material-product-${itemId}`)));
        state.materialCreateItemKey = "";
        await refresh("materialRequests", { force: true });
        showMessage(`${result.product?.name || "Ürün"} stok kartı oluşturuldu; stok miktarı değiştirilmedi.`);
      } catch (error) { showMessage(error.message, "error"); throw error; }
      finally { setBusy(false); }
    });
  }

  async function decideMaterialRequest(id, decision, button) {
    const note = $(`[data-material-note="${CSS.escape(id)}"]`)?.value.trim() || "";
    if (decision === "reject" && !note) { showMessage("Talebi reddetmek için açıklama yazın.", "error"); $(`[data-material-note="${CSS.escape(id)}"]`)?.focus(); return operationSkipped("validation"); }
    return runImmediateOperation(`material-decision:${decision}:${id}`, button, async () => {
      try {
        setBusy(true);
        acceptMutationResult(await api(`/api/admin/workforce/material-requests/${encodeURIComponent(id)}/${decision}`, mutationOptions("POST", { note }, `material-request-${decision}-${id}`)));
        state.materialRejectRequestId = "";
        await refresh("materialRequests", { force: true });
        showMessage(decision === "approve" ? "Malzeme talebi onaylandı." : "Malzeme talebi reddedildi.");
      } catch (error) { showMessage(error.message, "error"); throw error; }
      finally { setBusy(false); }
    });
  }

  function formatQuantity(value) {
    return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value) || 0);
  }

  function operationHost(kind) {
    if (kind === "materialRequests") return $("#workforceMaterialRequestsPanel");
    return kind === "shifts" ? $("#workforceShiftsPanel") : null;
  }

  function weekDates() {
    return Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));
  }

  function currentPlans() {
    const persisted = (state.data.shiftPlans || []).filter((item) => item.weekStart === state.weekStart || weekDates().includes(item.date));
    if (!Array.isArray(state.draftPlans) || !state.draftPlans.length) return persisted;
    return persisted.filter((item) => item.status !== "draft").concat(state.draftPlans);
  }

  function planFor(personId, date) {
    const edited = state.shiftEdits.get(shiftEditKey(personId, date));
    if (edited) return edited;
    const matches = currentPlans().filter((item) => String(item.personId) === String(personId) && item.date === date);
    return matches.find((item) => item.status === "draft")
      || matches.find((item) => item.status === "published")
      || {
      personId, date, weekStart: state.weekStart, type: "unassigned",
      startTime: null, endTime: null,
      source: "manual", status: "draft"
    };
  }

  function shiftEditKey(personId, date) {
    return JSON.stringify([String(personId), date]);
  }

  function clearShiftEdits(weekStart = state.weekStart) {
    const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    for (const [key, plan] of state.shiftEdits) {
      if (dates.includes(plan.date)) state.shiftEdits.delete(key);
    }
  }

  function shiftLabel(type) {
    return ({ morning: "Sabah", evening: "Akşam", leave: "İzinli", custom: "Özel Saat", unassigned: "Boş" })[type] || "Boş";
  }

  function shiftHours(plan) {
    if (["leave", "unassigned"].includes(plan.type)) return "—";
    const template = state.templates[plan.type] || {};
    return `${plan.startTime || template.startTime || ""} – ${plan.endTime || template.endTime || ""}`;
  }

  function renderShiftGrid() {
    const host = $("#workforceShiftGrid");
    if (!host) return;
    const dates = weekDates();
    const dayNames = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
    const users = (state.data.users || []).filter((item) => item.active !== false);
    host.innerHTML = `
      <div class="workforce-shift-grid-head"><span>Personel</span>${dates.map((date, index) => `<span class="${date === isoDate(new Date()) ? "is-today" : ""}"><b>${dayNames[index]}</b><small>${dateValue(date).replace(/\s+\d{4}$/, "")}</small></span>`).join("")}</div>
      ${users.map((user) => `<div class="workforce-shift-grid-row">
        <span class="workforce-shift-person"><b>${esc(user.name || user.username)}</b><small>${esc(user.jobTitle || "—")}</small></span>
        ${dates.map((date) => {
          const plan = planFor(user.id, date);
          return `<button type="button" class="workforce-shift-cell is-${esc(plan.type)}${date === isoDate(new Date()) ? " is-today" : ""}" data-shift-person="${esc(user.id)}" data-shift-date="${esc(date)}" data-workforce-action aria-haspopup="dialog" aria-label="${esc(user.name || user.username)} · ${esc(dateValue(date))} · ${esc(shiftLabel(plan.type))} · ${esc(shiftHours(plan))}" ${state.busy ? "disabled" : ""}>
            <span class="workforce-shift-label">${shiftLabel(plan.type)}</span>
            <small>${esc(shiftHours(plan))}</small>
          </button>`;
        }).join("")}
      </div>`).join("") || `<div class="workforce-empty"><h4>Aktif personel yok</h4><p>Vardiya planı için aktif personel gereklidir.</p></div>`}
    `;
    $$("[data-shift-person]", host).forEach((button) => button.addEventListener("click", () => openShiftEditor(button.dataset.shiftPerson, button.dataset.shiftDate)));
  }

  function openShiftEditor(personId, date) {
    if (state.busy || !weekDates().includes(date)) return;
    const user = (state.data.users || []).find(item => String(item.id) === String(personId) && item.active !== false);
    const dialog = $("#workforceShiftEditor");
    if (!user || !dialog) return;
    const plan = planFor(personId, date);
    state.shiftEditor = { personId: String(personId), date };
    $("#workforceShiftEditorPerson").textContent = `${user.name || user.username} · ${dateValue(date)}`;
    $("#workforceShiftType").value = plan.type;
    $("#workforceShiftStart").value = plan.startTime || state.templates.custom.startTime;
    $("#workforceShiftEnd").value = plan.endTime || state.templates.custom.endTime;
    syncShiftEditorHours();
    dialog.showModal();
  }

  function syncShiftEditorHours() {
    const custom = $("#workforceShiftType").value === "custom";
    $("#workforceShiftEditorHours").hidden = !custom;
    $("#workforceShiftStart").disabled = !custom;
    $("#workforceShiftEnd").disabled = !custom;
    $("#workforceShiftEditorError").textContent = "";
  }

  function applyShiftEditor(event) {
    event.preventDefault();
    if (state.busy || !state.shiftEditor) return;
    const type = $("#workforceShiftType").value;
    if (!["morning", "evening", "leave", "custom", "unassigned"].includes(type)) return;
    const template = state.templates[type] || {};
    const noHours = ["leave", "unassigned"].includes(type);
    const startTime = noHours ? null : type === "custom" ? $("#workforceShiftStart").value : template.startTime;
    const endTime = noHours ? null : type === "custom" ? $("#workforceShiftEnd").value : template.endTime;
    if (type === "custom" && (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime)) {
      $("#workforceShiftEditorError").textContent = "Başlangıç saati bitiş saatinden önce olmalıdır.";
      $("#workforceShiftStart").focus();
      return;
    }
    const { personId, date } = state.shiftEditor;
    state.shiftEdits.set(shiftEditKey(personId, date), {
      personId, date, weekStart: state.weekStart, type, startTime, endTime, source: "manual", status: "draft"
    });
    // Applying a cell only stages an edit; saving/publishing remain explicit.
    $("#workforceShiftEditor").close();
  }

  function bindShiftEditor() {
    const dialog = $("#workforceShiftEditor");
    $("#workforceShiftEditorForm")?.addEventListener("submit", applyShiftEditor);
    $("#workforceShiftType")?.addEventListener("change", syncShiftEditorHours);
    $$("[data-close-shift-editor]", dialog).forEach(button => button.addEventListener("click", () => dialog.close()));
    dialog?.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
    dialog?.addEventListener("close", () => {
      const previous = state.shiftEditor;
      state.shiftEditor = null;
      renderShiftGrid();
      if (previous) $$("[data-shift-person]", $("#workforceShiftGrid")).find(button => button.dataset.shiftPerson === previous.personId && button.dataset.shiftDate === previous.date)?.focus();
    });
  }

  function renderShifts() {
    const host = operationHost("shifts");
    if (!host) return;
    if ($("#workforceShiftEditor")?.open) return;
    const weekEnd = addDays(state.weekStart, 6);
    const hasDraft = Boolean(state.draftPlans) || currentPlans().some((item) => item.status === "draft");
    const isFutureWeek = state.weekStart > mondayOf(new Date());
    host.innerHTML = `
      <div class="workforce-shift-toolbar">
        <div class="workforce-week-picker">
          <button type="button" data-week-step="-7" data-workforce-action aria-label="Önceki hafta">${icon("chevronLeft")}</button>
          <label><span>${icon("calendar")}</span><input id="workforceWeekInput" type="date" value="${esc(state.weekStart)}"><strong>${esc(dateValue(state.weekStart))} – ${esc(dateValue(weekEnd))}</strong></label>
          <button type="button" data-week-step="7" data-workforce-action aria-label="Sonraki hafta">${icon("chevronRight")}</button>
        </div>
        <div class="workforce-shift-actions">
          <button class="workforce-line-button ui-button ui-button--secondary" type="button" data-save-draft data-workforce-action>Taslak Kaydet</button>
          <button class="workforce-primary-button ui-button ui-button--primary" type="button" data-publish-shifts data-workforce-action data-operation-class="immediate-operation">${icon("send")} Vardiyaları Yayınla</button>
        </div>
      </div>
      <div class="workforce-shift-layout is-planning-only">

        <section class="workforce-shift-schedule">
          <div class="workforce-draft-note">${icon("calendar")} Düzenlemek için bir güne tıklayın.</div>
          ${state.autoDraftProposal ? `<div class="workforce-auto-proposal">
            <b>Öneri açıklaması</b>
            <p>${esc((state.autoDraftProposal.appliedRules || []).join(" · ") || "Temel sabah/akşam dönüşümü uygulandı.")}</p>
            ${(state.autoDraftProposal.limitations || []).length ? `<small>Otomatik doğrulanmayanlar: ${esc(state.autoDraftProposal.limitations.join(" · "))}</small>` : ""}
            ${(state.autoDraftProposal.conflicts || []).length ? `<em>${state.autoDraftProposal.conflicts.length} çakışma yönetici kontrolü bekliyor.</em>` : ""}
          </div>` : ""}
          <div class="workforce-shift-grid" id="workforceShiftGrid"></div>
          <div class="workforce-shift-legend" aria-label="Vardiya türleri">${["morning", "evening", "custom", "leave", "unassigned"].map(type => `<span class="is-${type}"><i aria-hidden="true"></i>${shiftLabel(type)}</span>`).join("")}</div>
        </section>
      </div>
      <details class="workforce-extra-options"><summary>Şablonlar ve mevcut planlama seçenekleri</summary>        <aside class="workforce-shift-templates">
          <div class="workforce-list-heading"><div><p class="eyebrow">Planlama</p><h3>Vardiya Şablonları</h3></div></div>
          <label class="is-morning"><span><i></i><b>Sabah</b></span><span><input type="time" data-template="morning.startTime" value="${esc(state.templates.morning.startTime)}"><span aria-hidden="true">–</span><input type="time" data-template="morning.endTime" value="${esc(state.templates.morning.endTime)}"></span></label>
          <label class="is-evening"><span><i></i><b>Akşam</b></span><span><input type="time" data-template="evening.startTime" value="${esc(state.templates.evening.startTime)}"><span aria-hidden="true">–</span><input type="time" data-template="evening.endTime" value="${esc(state.templates.evening.endTime)}"></span></label>
          <div class="is-leave"><span><i></i><b>İzinli</b></span><small>Tüm gün</small></div>
          <label class="is-custom"><span><i></i><b>Belirli Saatler</b></span><span><input type="time" data-template="custom.startTime" value="${esc(state.templates.custom.startTime)}"><span aria-hidden="true">–</span><input type="time" data-template="custom.endTime" value="${esc(state.templates.custom.endTime)}"></span></label>
        </aside><div class="workforce-shift-actions">          <button class="workforce-line-button ui-button ui-button--secondary" type="button" data-auto-draft data-workforce-action ${isFutureWeek ? "" : "disabled"} title="${isFutureWeek ? "Seçili gelecek hafta için temel vardiya taslağı öner" : "Otomatik taslak yalnızca gelecek haftalar için oluşturulabilir"}">${icon("sparkles")} Temel Vardiya Taslağı Öner</button>
          <button class="workforce-line-button ui-button ui-button--secondary" type="button" data-apply-draft data-workforce-action ${hasDraft ? "" : "disabled"}>${icon("check")} Taslağı Uygula</button>
</div></details>
      <dialog id="workforceShiftEditor" class="workforce-modal workforce-shift-editor" aria-labelledby="workforceShiftEditorTitle" aria-describedby="workforceShiftEditorPerson">
        <header><div><h3 id="workforceShiftEditorTitle">Vardiyayı Düzenle</h3><p id="workforceShiftEditorPerson"></p></div><button type="button" class="ui-button ui-button--secondary" data-close-shift-editor aria-label="Vardiya kartını kapat">${icon("close")}</button></header>
        <form id="workforceShiftEditorForm">
          <div class="workforce-modal-body">
            <label><span>Vardiya</span><select id="workforceShiftType"><option value="morning">Sabah</option><option value="evening">Akşam</option><option value="leave">İzinli</option><option value="custom">Özel Saat</option><option value="unassigned">Boş</option></select></label>
            <div class="workforce-shift-editor-hours" id="workforceShiftEditorHours" hidden><label><span>Başlangıç</span><input id="workforceShiftStart" type="time" required></label><label><span>Bitiş</span><input id="workforceShiftEnd" type="time" required></label></div>
            <p id="workforceShiftEditorError" role="alert"></p>
          </div>
          <footer><button type="button" class="ui-button ui-button--secondary" data-close-shift-editor>Vazgeç</button><button type="submit" class="ui-button ui-button--primary">Uygula</button></footer>
        </form>
      </dialog>
    `;
    renderShiftGrid();
    bindShifts();
    bindShiftEditor();
  }

  function bindShifts() {
    $$("[data-week-step]").forEach((button) => button.addEventListener("click", () => {
      state.weekStart = addDays(state.weekStart, Number(button.dataset.weekStep));
      state.autoDraftProposal = null;
      const drafts = (state.data.shiftPlans || []).filter((plan) => plan.weekStart === state.weekStart && plan.status === "draft");
      state.draftPlans = drafts.length ? drafts : null;
      renderShifts();
    }));
    $("#workforceWeekInput")?.addEventListener("change", (event) => {
      if (state.busy) { event.target.value = state.weekStart; return; }
      state.weekStart = mondayOf(`${event.target.value}T12:00:00`);
      state.autoDraftProposal = null;
      const drafts = (state.data.shiftPlans || []).filter((plan) => plan.weekStart === state.weekStart && plan.status === "draft");
      state.draftPlans = drafts.length ? drafts : null;
      renderShifts();
    });
    $$("[data-template]").forEach((input) => input.addEventListener("change", () => {
      const [type, key] = input.dataset.template.split(".");
      state.templates[type][key] = input.value;
      if (type === "custom" && state.templates.custom.startTime >= state.templates.custom.endTime) {
        showMessage("Belirli saatler başlangıcı bitişten önce olmalıdır.", "error");
        return;
      }
      if (type === "morning" || type === "evening") {
        (state.data.users || []).filter(user => user.active !== false).forEach(user => weekDates().forEach(date => {
          const plan = planFor(user.id, date);
          if (plan.type === type) state.shiftEdits.set(shiftEditKey(user.id, date), { ...plan, ...state.templates[type] });
        }));
        renderShiftGrid();
      }
      if (type === "morning" || type === "evening") {
        void runImmediateOperation("shift-settings", input, async () => {
          try {
            setBusy(true);
            await persistShiftSettings();
            showMessage("Vardiya şablonu güncellendi.");
          } catch (error) {
            showMessage(error.message, "error");
            throw error;
          } finally {
            setBusy(false);
          }
        });
      }
    }));
    $("[data-save-draft]")?.addEventListener("click", () => saveShifts(false));
    $("[data-publish-shifts]")?.addEventListener("click", () => saveShifts(true));
    const autoButton = $("[data-auto-draft]");
    autoButton?.addEventListener("click", () => runImmediateOperation(`shift-auto:${state.weekStart}`, autoButton, autoDraft));
    const applyButton = $("[data-apply-draft]");
    applyButton?.addEventListener("click", () => runImmediateOperation(`shift-apply:${state.weekStart}`, applyButton, applyDraft));
  }

  async function persistShiftSettings() {
    const result = acceptMutationResult(await api("/api/admin/workforce/shift-settings", mutationOptions("PUT", {
      morning: state.templates.morning,
      evening: state.templates.evening
    }, "shift-settings")));
    if (result.shiftSettings) {
      state.templates.morning = { ...state.templates.morning, ...(result.shiftSettings.morning || {}) };
      state.templates.evening = { ...state.templates.evening, ...(result.shiftSettings.evening || {}) };
    }
    return result;
  }

  async function applyDraft() {
    try {
      setBusy(true);
      const result = acceptMutationResult(await api(`/api/admin/workforce/shifts/${encodeURIComponent(state.weekStart)}/apply-draft`, mutationOptions("POST", {}, `shift-apply-${state.weekStart}`)));
      state.data.shiftPlans = (state.data.shiftPlans || []).filter((item) => item.weekStart !== state.weekStart).concat(result.plans || []);
      state.draftPlans = null;
      clearShiftEdits();
      renderShifts();
      showMessage("Otomatik taslak düzenleme alanına uygulandı.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function collectPlans() {
    return (state.data.users || []).filter(user => user.active !== false).flatMap(user => weekDates().map(date => {
      const plan = planFor(user.id, date);
      const type = plan.type;
      const template = state.templates[type] || {};
      if (type === "custom" && (!plan.startTime || !plan.endTime || plan.startTime >= plan.endTime)) throw new Error("Özel saat aralığını düzeltin.");
      return {
        personId: String(user.id),
        date,
        type,
        startTime: ["leave", "unassigned"].includes(type) ? null : plan.startTime || template.startTime,
        endTime: ["leave", "unassigned"].includes(type) ? null : plan.endTime || template.endTime,
        source: "manual"
      };
    }));
  }

  function saveShifts(publish) {
    const button = publish ? $("[data-publish-shifts]") : $("[data-save-draft]");
    return runImmediateOperation(publish ? `shift-publish:${state.weekStart}` : `shift-draft:${state.weekStart}`, button, () => executeSaveShifts(publish));
  }

  async function executeSaveShifts(publish) {
    try {
      const plans = collectPlans();
      setBusy(true);
      const result = acceptMutationResult(await api(`/api/admin/workforce/shifts/${encodeURIComponent(state.weekStart)}`, mutationOptions("PUT", {
        plans,
        publish,
        templates: state.templates
      }, `${publish ? "shift-publish" : "shift-draft"}-${state.weekStart}`)));
      state.data.shiftPlans = (state.data.shiftPlans || []).filter((item) => item.weekStart !== state.weekStart).concat(result.plans || []);
      clearShiftEdits();
      await refresh("shifts");
      showMessage(publish ? "Vardiyalar yayınlandı ve personel paneline aktarıldı." : "Vardiya taslağı kaydedildi.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function autoDraft() {
    if (currentPlans().some((plan) => plan.status === "draft") && !await window.MenuSuiteAdminDialogs.confirm("Mevcut taslağın yerine yeni bir temel vardiya önerisi oluşturulacak.", { title: "Vardiya taslağını yenile", confirmLabel: "Yeni öneri oluştur" })) {
      return operationSkipped("cancelled");
    }
    try {
      setBusy(true);
      const result = acceptMutationResult(await api(`/api/admin/workforce/shifts/${encodeURIComponent(state.weekStart)}/auto-draft`, mutationOptions("POST", {
        templates: state.templates
      }, `shift-auto-${state.weekStart}`)));
      state.draftPlans = result.plans || [];
      clearShiftEdits();
      state.autoDraftProposal = result.proposal || null;
      state.data.shiftPlans = (state.data.shiftPlans || []).filter((item) => item.weekStart !== state.weekStart || item.status !== "draft").concat(result.plans || []);
      renderShifts();
      const considered = Number(result.proposal && result.proposal.consideredRequestCount || 0);
      const conflicts = Array.isArray(result.proposal && result.proposal.conflicts) ? result.proposal.conflicts.length : 0;
      showMessage(`Temel vardiya taslağı oluşturuldu. ${considered} onaylı talep dikkate alındı${conflicts ? `, ${conflicts} çakışma işaretlendi` : ""}.`);
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function decideRequest(id, decision) {
    const note = $(`[data-request-note="${CSS.escape(id)}"]`)?.value.trim() || "";
    if (decision === "reject" && !note) {
      showMessage("Talebi reddetmek için neden yazın.", "error");
      $(`[data-request-note="${CSS.escape(id)}"]`)?.focus();
      return operationSkipped("validation");
    }
    try {
      setBusy(true);
      acceptMutationResult(await api(`/api/admin/workforce/shift-requests/${encodeURIComponent(id)}/${decision}`, mutationOptions("POST", {
        note,
        rejectionReason: decision === "reject" ? note : ""
      }, `shift-request-${decision}-${id}`)));
      await refresh("shifts");
      showMessage(decision === "approve" ? "Talep onaylandı." : "Talep reddedildi.");
    } catch (error) {
      showMessage(error.message, "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function refresh(section, options = {}) {
    const refreshKey = section || "all";
    const refreshToken = (refreshTokens.get(refreshKey) || 0) + 1;
    refreshTokens.set(refreshKey, refreshToken);
    try {
      await load(options);
    } catch (error) {
      if (refreshTokens.get(refreshKey) !== refreshToken) return;
      throw error;
    }
    if (refreshTokens.get(refreshKey) !== refreshToken) return;
    renderOverview();
    renderLeaveRequests();
    if (["approvals", "materialRequests", "leaverequests"].includes(section)) renderMaterialRequests();
    else if (section === "tasks") renderTasks();
    else if (section === "shifts") {
      renderShifts();
    } else if (section === "staffAccess") {
      renderMaterialRequests();
      renderTasks();
      renderShifts();
    } else {
      renderMaterialRequests();
      renderTasks();
      renderShifts();
    }
    renderRequestDetail();
  }

  function syncLivePreview(section) {
    const previewSection = { materialRequests: "materialRequest", shifts: "shift", tasks: "tasks" }[section] || "staffAccess";
    activePreviewSection = previewSection;
    if (!window.MenuSuiteLivePreview || typeof window.MenuSuiteLivePreview.updateSection !== "function") return;
    window.MenuSuiteLivePreview.updateSection(previewSection);
  }

  window.__MENU_SUITE_WORKFORCE_PREVIEW_SECTION__ = () => activePreviewSection;

  function activeWorkforceSection(section) {
    if (section === "approvals") return "approvals";
    if (section !== "staffAccess") return "";
    if ($("#workforceTasksAccordion")?.open) return "tasks";
    if ($("#workforceShiftsAccordion")?.open) return "shifts";
    return "staffAccess";
  }

  function isWorkforceOwnerSection(section) {
    return ["staffAccess", "approvals"].includes(section);
  }

  function setupAccordions() {
    $$(".requests-page > .requests-accordion").forEach((details) => {
      if (details.dataset.workforceToggleBound === "true") return;
      details.dataset.workforceToggleBound = "true";
      details.addEventListener("toggle", () => {
        if (details.open) refresh("approvals", { force: state.stale }).catch((error) => showMessage(error.message, "error"));
      });
    });
    let openFound = false;
    $$(".staff-layout > .staff-accordion").forEach((details) => {
      if (details.open && openFound) details.open = false;
      else if (details.open) openFound = true;
      if (details.dataset.workforceToggleBound === "true") return;
      details.dataset.workforceToggleBound = "true";
      details.addEventListener("toggle", () => {
        if (!details.open) return;
        $$(".staff-layout > .staff-accordion").forEach((other) => {
          if (other !== details) other.open = false;
        });
        if (details.id === "workforceMaterialRequestsAccordion") {
          syncLivePreview("materialRequests");
          refresh("materialRequests").catch((error) => showMessage(error.message, "error"));
        } else if (details.id === "workforceTasksAccordion") {
          syncLivePreview("tasks");
          refresh("tasks").catch((error) => showMessage(error.message, "error"));
        } else if (details.id === "workforceShiftsAccordion") {
          syncLivePreview("shifts");
          refresh("shifts").catch((error) => showMessage(error.message, "error"));
        } else {
          syncLivePreview("staffAccess");
        }
        if (details.id === "staffRecordsAccordion" && typeof window.__MENU_SUITE_REFRESH_STAFF_LEDGER__ === "function") {
          window.__MENU_SUITE_REFRESH_STAFF_LEDGER__();
        }
      });
    });

  }

  async function mount(section) {
    const activeSection = section || (window.MenuSuiteAdminBridge && window.MenuSuiteAdminBridge.activeSection());
    if (!isWorkforceOwnerSection(activeSection)) return;
    if (!operationHost("materialRequests") && !$("#workforceTasksPanel") && !operationHost("shifts")) return;
    if (state.mounted) {
      connectWorkforceEvents();
      return refresh(activeWorkforceSection(activeSection), { force: state.stale });
    }
    state.mounted = true;
    window.__MENU_SUITE_WORKFORCE_MOUNTED__ = true;
    setupAccordions();
    setupRequestDialog();
    connectWorkforceEvents();
    try {
      await refresh(activeWorkforceSection(activeSection), { force: true });
    } catch (error) {
      const activeModule = activeWorkforceSection(activeSection);
      const target = activeModule === "materialRequests"
        ? operationHost("materialRequests")
        : activeModule === "approvals" ? operationHost("materialRequests") : activeModule === "shifts" ? operationHost("shifts") : $("#workforceTasksPanel");
      if (target) target.innerHTML = `<div class="workforce-empty"><h4>Veriler yüklenemedi</h4><p>${esc(error.message)}</p><button class="workforce-line-button ui-button ui-button--secondary" type="button" data-retry-workforce>Tekrar Dene</button></div>`;
      $("[data-retry-workforce]", target || document)?.addEventListener("click", () => refresh(activeModule, { force: true }).catch(() => {}), { once: true });
    }
  }

  function connectWorkforceEvents() {
    if (state.gatewayBound) return;
    state.gatewayBound = true;
    document.addEventListener("menu-suite:gateway-event", handleWorkforceGatewayEvent);
  }

  function handleWorkforceGatewayEvent(event) {
    const payload = event && event.detail || {};
    if (payload.topic !== "workforce") return;
    const revision = Number(payload.revision || 0);
    if (revision && revision <= state.workforceRevision) return;
    state.workforceRevision = Math.max(state.workforceRevision, revision);
    state.stale = true;
    const section = window.MenuSuiteAdminBridge && window.MenuSuiteAdminBridge.activeSection();
    if (!isWorkforceOwnerSection(section) || state.busy || $("#adminRequestDialog")?.open || document.activeElement?.matches(".workforce-panel input, .workforce-panel textarea, .workforce-panel select")) return;
    refresh(activeWorkforceSection(section), { force: true }).catch(() => {});
  }

  function disconnectWorkforceEvents() {
    state.stale = true;
  }

  function handleAdminSectionChange(event) {
    const section = event.detail && event.detail.section;
    if (section !== "staffAccess") {
      $("#workforcePersonDialog")?.close();
      $("#workforceComposerDialog")?.close();
    }
    if ($("#adminRequestDialog")?.open && !state.busy) $("#adminRequestDialog").close();
    if (isWorkforceOwnerSection(section)) mount(section).catch(() => {});
    else disconnectWorkforceEvents();
  }

  document.addEventListener("menu-suite:admin-section-change", handleAdminSectionChange);
  document.addEventListener("sts:material-batch-approved", () => {
    state.stale = true;
    refresh("approvals", { force: true }).catch(error => showMessage(error.message, "error"));
  });
  const startWhenActive = () => {
    const section = window.MenuSuiteAdminBridge && window.MenuSuiteAdminBridge.activeSection();
    if (isWorkforceOwnerSection(section)) mount(section).catch(() => {});
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startWhenActive, { once: true });
  else startWhenActive();
})();
