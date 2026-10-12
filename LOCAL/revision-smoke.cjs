"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const runtime = path.join(root, "ORTAK");
const bcrypt = require(path.join(runtime, "node_modules", "bcryptjs"));
const panelTheme = require(path.join(runtime, "JS", "panel-theme"));
const fixtureRoot = path.join(__dirname, "REVISION-TEST-DATA");
const fixtureFile = path.join(fixtureRoot, "store.json");
const testPort = Number(process.env.REVISION_TEST_PORT || 6061);
const origin = `http://localhost:${testPort}`;
const results = [];

if (path.dirname(fixtureRoot) !== __dirname || path.basename(fixtureRoot) !== "REVISION-TEST-DATA") {
  throw new Error("Unsafe revision fixture path.");
}
fs.rmSync(fixtureRoot, { recursive: true, force: true });
fs.mkdirSync(fixtureRoot, { recursive: true });
for (const directory of ["MEDIA", "PROCUREMENT-DOCUMENTS", "DATA-IMPORT-COLD", "BACKUPS", "LOGS"])
  fs.mkdirSync(path.join(fixtureRoot, directory), { recursive: true });
const baseline = JSON.parse(fs.readFileSync(path.join(runtime, "VERİ", "STORE", "store.json"), "utf8"));
baseline.admin = { ...baseline.admin, passwordHash: bcrypt.hashSync("P2Revision!2026", 10) };
for (const key of [
  "recipeUsers", "deletedRecipeUsers", "recipeActivity", "recipeAssignments", "authSessions",
  "notifications", "notificationPreferences", "notificationOutbox", "pushSubscriptions", "securityAudit",
  "passwordResetChallenges", "emailVerificationChallenges", "workforceTasks", "workforceAssignments",
  "workforceShipments", "workforceShiftRequests", "workforceShiftPlans", "workforceShiftPlanRevisions",
  "idempotencyRequests"
]) baseline[key] = [];
fs.writeFileSync(fixtureFile, JSON.stringify(baseline, null, 2));

Object.assign(process.env, {
  NODE_ENV: "test",
  PORT: String(testPort),
  DATA_FILE: fixtureFile,
  MEDIA_DIR: path.join(fixtureRoot, "MEDIA"),
  PROCUREMENT_DOCUMENTS_DIR: path.join(fixtureRoot, "PROCUREMENT-DOCUMENTS"),
  DATA_IMPORT_COLD_DIR: path.join(fixtureRoot, "DATA-IMPORT-COLD"),
  BACKUP_DIR: path.join(fixtureRoot, "BACKUPS"),
  LOG_DIR: path.join(fixtureRoot, "LOGS"),
  ADMIN_COOKIE_NAME: "paket3_revision_admin",
  RECIPE_COOKIE_NAME: "paket3_revision_personnel",
  JWT_ISSUER: "paket-3-revision-test",
  JWT_AUDIENCE: "paket-3-revision-clients",
  JWT_SECRET: `p2-revision-${crypto.randomBytes(32).toString("hex")}`,
  NOTIFICATION_WORKERS_ENABLED: "false",
  PASSWORD_RESET_TEST_CODE: "123456"
});

const backend = require(path.join(runtime, "API", "src", "app"));
let adminCookie = "";
let personelCookie = "";
let personelId = "";
let protectedBaseline = null;

async function request(url, options = {}, expected = 200) {
  const headers = { Origin: origin, ...(options.headers || {}) };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(origin + url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  assert.equal(response.status, expected, `${options.method || "GET"} ${url}: ${response.status} ${text.slice(0, 400)}`);
  return { response, data };
}

function requestId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function mutation(url, body, cookie = adminCookie, method = "POST", expected = 200) {
  const id = requestId("rev");
  return request(url, {
    method,
    cookie,
    headers: { "Idempotency-Key": id, "X-Request-ID": id },
    body: { ...body, requestId: id }
  }, expected);
}

async function test(name, callback) {
  await callback();
  results.push({ name, passed: true });
  console.log("PASS", name);
}

async function eventStream(url, cookie) {
  const controller = new AbortController();
  const response = await fetch(origin + url, {
    headers: { Origin: origin, Cookie: cookie },
    signal: controller.signal
  });
  assert.equal(response.status, 200, url);
  assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
  let content = "";
  const reader = response.body.getReader();
  const readerTask = (async () => {
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        content += Buffer.from(item.value).toString("utf8");
      }
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    }
  })();
  return {
    text: () => content,
    wait: async (pattern) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (pattern.test(content)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.match(content, pattern, url);
    },
    close: async () => { controller.abort(); await readerTask; }
  };
}

function source(name) {
  return fs.readFileSync(path.join(root, ...name), "utf8");
}

function exactEntry(directory, entry) {
  return fs.readdirSync(path.join(root, ...directory)).includes(entry);
}

async function main() {
  await backend.prepareRuntime();
  protectedBaseline = structuredClone(await backend.store.read());
  const server = await new Promise((resolve, reject) => {
    const value = backend.app.listen(testPort, () => resolve(value));
    value.once("error", reject);
  });
  try {
    await test("canonical-static-and-health", async () => {
      for (const url of ["/", "/yonetici/", "/personel/", "/api/health", "/yonetici/manifest.webmanifest", "/yonetici/sw.js", "/personel/manifest.webmanifest", "/personel/sw.js"]) {
        await request(url);
      }
      await request("/muhasebe/", {}, 404);
      await request("/fatura/", {}, 404);
      await request("/yonetici/modules/tedarik-muhasebe/", {}, 401);
      assert.equal((await request("/api/health")).data.service, "STOK-TAKIP-SISTEMI");
      assert.equal(exactEntry(["YÖNETİCİ PANELİ", "HTML"], "index.html"), true);
      assert.equal(exactEntry(["YÖNETİCİ PANELİ", "HTML"], "offline.html"), true);
      assert.equal(exactEntry(["YÖNETİCİ PANELİ", "JS"], "app.js"), true);
      assert.equal(exactEntry(["YÖNETİCİ PANELİ", "JS"], "live-preview.js"), true);
      assert.equal(exactEntry(["YÖNETİCİ PANELİ", "CSS"], "admin.css"), true);
      assert.equal(exactEntry(["YÖNETİCİ PANELİ", "PWA"], "sw.js"), true);
    });

    await test("personel-ui-scope", async () => {
      const html = source(["PERSONEL", "index.html"]);
      const app = source(["PERSONEL", "personel.js"]);
      const workforce = source(["PERSONEL", "workforce.js"]);
      const notifications = source(["PERSONEL", "notifications.js"]);
      assert.match(html, /data-section=["']stock["']/i);
      assert.match(html, /data-section-panel=["']stock["']/i);
      assert.match(html, /data-section=["']shipment["']/i);
      assert.match(html, /data-section-panel=["']shipment["']/i);
      assert.match(html, />Vardiya</);
      assert.match(workforce, /["'`]\/api\/workforce\/shipments["'`]/);
      assert.match(workforce, /section === "shipment" \? "shipments,stock"/);
      assert.match(notifications, /stock|shipment/i);
    });

    await test("admin-ui-scope-and-theme", async () => {
      const html = source(["YÖNETİCİ PANELİ", "HTML", "index.html"]);
      const app = source(["YÖNETİCİ PANELİ", "JS", "app.js"]);
      const workforce = source(["YÖNETİCİ PANELİ", "JS", "workforce.js"]);
      const css = source(["YÖNETİCİ PANELİ", "CSS", "admin.css"]);
      assert.match(html, /<symbol\s+id=["']panel-icon-staff["'][^>]*viewBox=["']0 0 24 24["']/);
      assert.match(html, /<use\s+href=["']#panel-icon-staff["']/);
      assert.match(html, /data-personel-section-access=["']stock["']/i);
      assert.match(html, /data-personel-section-access=["']shipment["']/i);
      assert.doesNotMatch(html, /workforceShipmentsAccordion|workforceShipmentsPanel/);
      assert.match(app, /PERSONEL_SECTION_ACCESS_KEYS\s*=\s*\[[^\]]*["']stock["'][^\]]*["']shipment["']/s);
      assert.doesNotMatch(workforce, /wf-admin-shipment|admin\/workforce\/shipments/i);
      for (const color of ["#4a2c1d", "#6b3d24", "#8b5630", "#8d5c34", "#b7773d"]) {
        assert.doesNotMatch(css, new RegExp(color.replace("#", "#"), "i"));
      }
      assert.match(css, /--panel-(?:accent|coffee|sidebar-active|surface|line|focus|on-primary)/);
    });

    await test("admin-personel-login-and-permissions", async () => {
      const login = await request("/api/admin/login", { method: "POST", body: { password: "P2Revision!2026" } });
      adminCookie = login.response.headers.get("set-cookie").split(";")[0];
      const created = await mutation("/api/admin/recipe-users", {
        name: "Revizyon Test Personeli",
        username: "revtest",
        email: "revtest@example.invalid",
        password: "RevPersonel!2026",
        active: true,
        personelSectionAccess: { recipe: true, tasks: true, stock: true, shipment: true, shift: true }
      }, adminCookie, "POST", 201);
      const user = created.data.user || (created.data.users || []).find((item) => item.username === "revtest");
      assert.ok(user && user.id);
      personelId = user.id;
      const access = user.personelSectionAccess || user.sectionAccess || {};
      assert.deepEqual(Object.keys(access).sort(), ["recipe", "shift", "shipment", "stock", "tasks"]);
      assert.equal(access.stock, true);
      assert.equal(access.shipment, true);
      const personelLogin = await request("/api/recipe/login", {
        method: "POST",
        body: { username: "revtest", password: "RevPersonel!2026" }
      });
      personelCookie = personelLogin.response.headers.get("set-cookie").split(";")[0];
      await request("/api/recipe/me", { cookie: personelCookie });
      await request("/personel/recete-embed/", { cookie: personelCookie });
      await request("/api/recipes", { cookie: personelCookie });
      await request("/api/workforce/me?scope=tasks", { cookie: personelCookie });
      await request("/api/workforce/me?scope=shift", { cookie: personelCookie });
      await request("/api/workforce/me?scope=stock", { cookie: personelCookie });
      await request("/api/workforce/me?scope=shipment", { cookie: personelCookie });
    });

    await test("task-notification-sse-and-crud", async () => {
      const stream = await eventStream("/api/events?appId=personel", personelCookie);
      try {
        await stream.wait(/system\.ready/);
        const created = await mutation("/api/admin/workforce/tasks", {
          title: "Revizyon bildirim görevi",
          items: [{ id: "rev-item", text: "Bildirim akışını doğrula" }],
          targetType: "selected",
          assignedUserIds: [personelId]
        }, adminCookie, "POST", 201);
        assert.ok(created.data.task && created.data.task.id);
        await stream.wait(/"topic":"workforce"/);
        await stream.wait(/"topic":"notification"/);
        const me = await request("/api/workforce/me?scope=tasks", { cookie: personelCookie });
        assert.ok(me.data.tasks.some((task) => task.id === created.data.task.id));
        const assigned = me.data.tasks.find((task) => task.id === created.data.task.id);
        await mutation(`/api/workforce/tasks/${assigned.id}/items/${assigned.items[0].id}`, {
          completed: true, expectedRevision: me.data.revision
        }, personelCookie, "PATCH");
        const updated = await request("/api/workforce/me?scope=tasks", { cookie: personelCookie });
        assert.equal(updated.data.tasks.find((task) => task.id === assigned.id).assignments[0].progress, 100);
        const list = await request("/api/notifications", { cookie: personelCookie });
        const notifications = list.data.notifications || list.data.items || [];
        const notification = notifications.find((item) => String(item.category || item.type || "").toLowerCase().includes("task"));
        assert.ok(notification, "Görev bildirimi oluşturulmalı");
        const count = await request("/api/notifications/unread-count", { cookie: personelCookie });
        assert.ok(Number(count.data.count || count.data.unreadCount || 0) >= 1);
        const preferences = await request("/api/notifications/preferences", { cookie: personelCookie });
        assert.equal(Object.prototype.hasOwnProperty.call(preferences.data.preferences || preferences.data, "shipmentNotifications"), true);
        assert.equal(Object.prototype.hasOwnProperty.call(preferences.data.preferences || preferences.data, "stockNotifications"), true);
        await request("/api/notifications/preferences", {
          method: "PUT", cookie: personelCookie,
          body: { inAppEnabled: true, taskNotifications: true, shiftNotifications: true, systemNotifications: true }
        });
        const updatedPreferences = await request("/api/notifications/preferences", { cookie: personelCookie });
        assert.equal(updatedPreferences.data.preferences.systemNotifications, true);
        await request(`/api/notifications/${notification.id}/read`, { method: "PATCH", cookie: personelCookie, body: {} });
        await request(`/api/notifications/${notification.id}/unread`, { method: "PATCH", cookie: personelCookie, body: {} });
        await request("/api/notifications/read-all", { method: "POST", cookie: personelCookie, body: {} });
        await request(`/api/notifications/${notification.id}`, { method: "DELETE", cookie: personelCookie, body: {} });
      } finally {
        await stream.close();
      }
    });

    await test("shift-flow-and-base-data", async () => {
      const date = new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
      const requestResult = await mutation("/api/workforce/shift-requests", {
        type: "leave", date, description: "Revizyon vardiya testi"
      }, personelCookie, "POST", 201);
      assert.ok(requestResult.data.request && requestResult.data.request.id);
      await mutation(`/api/admin/workforce/shift-requests/${requestResult.data.request.id}/approve`, { note: "Onaylandı" });
      const me = await request("/api/workforce/me?scope=shift", { cookie: personelCookie });
      assert.ok(Array.isArray(me.data.shiftRequests));
      const day = new Date(date + "T12:00:00Z");
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      const week = day.toISOString().slice(0, 10);
      await mutation(`/api/admin/workforce/shifts/${week}`, {
        plans: [{ personId: personelId, date, type: "morning", startTime: "08:00", endTime: "16:00" }], publish: false
      }, adminCookie, "PUT");
      await mutation(`/api/admin/workforce/shifts/${week}/apply-draft`, {});
      await mutation(`/api/admin/workforce/shifts/${week}`, { publish: true }, adminCookie, "PUT");
      const plan = await request("/api/workforce/me?scope=shift", { cookie: personelCookie });
      assert.ok(plan.data.shiftPlans.length);
      const data = await backend.store.read();
      for (const key of ["menuState", "pricing", "panelConfig", "dataImportMappings", "dataImportDrafts", "dataImportHistory", "dataImportBackups", "adminDefaults"]) {
        assert.deepEqual(data[key], protectedBaseline[key], key);
      }
    });

    await test("menu-price-recipe-and-live-preview-regression", async () => {
      const menu = (await request("/api/menu")).data;
      const menuState = structuredClone(menu.menuState);
      const category = (menuState.categories || []).find((item) => Array.isArray(item.products) && item.products.length);
      assert.ok(category, "Fiyat testi için menü kategorisi bulunmalı");
      const product = category.products[0];
      const priceKey = Object.keys(product.prices || {})[0] || "standard";
      const currentPrice = Number(product.prices && product.prices[priceKey] || product.variants && product.variants[0] && product.variants[0].price || 0);
      const nextPrice = currentPrice + 1;
      product.prices = { ...(product.prices || {}), [priceKey]: nextPrice };
      if (Array.isArray(product.variants) && product.variants.length) product.variants[0].price = nextPrice;
      if (product.pricing && product.pricing.values && product.pricing.values[priceKey]) product.pricing.values[priceKey].price = nextPrice;
      for (const family of product.pricing && Array.isArray(product.pricing.families) ? product.pricing.families : []) {
        if (family.values && family.values[priceKey]) family.values[priceKey].price = nextPrice;
      }
      const savedMenu = await request("/api/menu", {
        method: "PUT", cookie: adminCookie,
        body: { menuState, pricing: menu.pricing, expectedRevision: menu.publishRevision }
      });
      assert.ok(savedMenu.data.publishRevision > menu.publishRevision);
      const refreshedMenu = (await request("/api/menu")).data.menuState;
      const refreshedProduct = refreshedMenu.categories.find((item) => item.id === category.id).products.find((item) => item.id === product.id);
      assert.equal(Number(refreshedProduct.prices[priceKey]), nextPrice);

      const recipes = (await request("/api/recipes", { cookie: personelCookie })).data;
      const recipeState = structuredClone(recipes.recipeState);
      recipeState["Revizyon Testleri"] = {
        "Kabul İçeceği": {
          "Standart": { content: "10 ml test şurubu", preparation: "Karıştır ve servis et.", note: "İzole regresyon kaydı", active: true, order: 0 }
        }
      };
      const savedRecipe = await request("/api/recipes", {
        method: "PUT", cookie: adminCookie,
        body: { recipeState, recipeCatalog: recipes.recipeCatalog }
      });
      assert.ok(savedRecipe.data.recipeState["Revizyon Testleri"]["Kabul İçeceği"]);
      const personelRecipes = (await request("/api/recipes", { cookie: personelCookie })).data;
      assert.equal(personelRecipes.recipeState["Revizyon Testleri"]["Kabul İçeceği"].Standart.note, "İzole regresyon kaydı");

      for (const mode of ["menu", "recipe"]) {
        const tokenResult = await request("/api/admin/preview-token", { method: "POST", cookie: adminCookie, body: { mode } });
        const previewToken = tokenResult.data.previewToken;
        assert.ok(previewToken);
        const session = await request("/api/public/preview-session", { method: "POST", body: { previewToken } });
        assert.equal(session.data.mode, mode);
        if (mode === "recipe") {
          const previewRecipes = await request(`/api/recipes?previewToken=${encodeURIComponent(previewToken)}`);
          assert.ok(previewRecipes.data.recipeState["Revizyon Testleri"]);
        }
      }
    });

    await test("brand-assets-manifests-and-static-pages", async () => {
      const urls = ["/", "/yonetici/", "/personel/", "/password-reset/?scope=admin", "/password-reset/?scope=personel&returnTo=%2Fpersonel%2F", "/yonetici/manifest.webmanifest", "/personel/manifest.webmanifest", "/shared/scripts/brand-identity.js", "/shared/styles/brand-identity.css", "/assets/brand/neutral-mark.svg", "/assets/images/neutral-placeholder.svg"];
      for (const app of ["yonetici", "personel"]) for (const name of ["favicon-32.png", "favicon-48.png", "apple-touch-icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png", "master-1024.png"]) urls.push(`/assets/app-icons/${app}/${name}`);
      for (const url of urls) {
        const { response, data } = await request(url);
        if (/manifest\.webmanifest/.test(url)) {
          assert.equal(typeof data.name, "string");
          assert.doesNotMatch(JSON.stringify(data), /Tahmis[cç]i/i);
        }
        if (/password-reset/.test(url)) { assert.match(response.headers.get("content-type") || "", /text\/html/); assert.match(data, /Şifre Yenileme/); }
        if (/\.(?:png|jpg)/.test(url)) assert.match(response.headers.get("content-type") || "", /image\//);
      }
      const userHtml = (await request("/personel/", { cookie: personelCookie })).data;
      assert.match(userHtml, /data-admin-theme-preset="purple-gray-stone"/);
      const procurementHtml = (await request("/yonetici/modules/tedarik-muhasebe/", { cookie: adminCookie })).data;
      assert.match(procurementHtml, /class="fatura-page is-embedded"/);
      const embedded = (await request("/personel/recete-embed/", { cookie: personelCookie })).data;
      assert.match(embedded, /data-appearance-mode="light"/);
      await request("/personel/recete-embed/", {}, 401);
    });

    await test("admin-profile-and-personel-appearance-isolation", async () => {
      const profile = await request("/api/admin/profile", { cookie: adminCookie });
      assert.equal(profile.data.profile.username, "admin");
      await request("/api/admin/profile", { cookie: personelCookie }, 401);
      await request("/api/admin/profile", { method: "PUT", cookie: adminCookie, body: { name: "Revizyon Yönetici", avatarUrl: "javascript:alert(1)" } }, 400);
      const saved = await request("/api/admin/profile", { method: "PUT", cookie: adminCookie, body: { name: "Revizyon Yönetici", avatarUrl: "/assets/app-icons/yonetici/icon-192.png" } });
      assert.equal(saved.data.profile.name, "Revizyon Yönetici");
      assert.equal(saved.data.profile.avatarUrl, "/assets/app-icons/yonetici/icon-192.png");
      assert.equal((await request("/api/admin/profile", { cookie: adminCookie })).data.profile.name, "Revizyon Yönetici");
      const defaultAppearance = { presetId: "purple-gray-stone", mode: "light" };
      assert.deepEqual((await request("/api/recipe/me", { cookie: personelCookie })).data.user.appearance, defaultAppearance);
      for (const preset of panelTheme.PRESETS) for (const mode of ["light", "dark"]) {
        const appearance = { presetId: preset.id, mode };
        const response = await request("/api/recipe/profile", { method: "PUT", cookie: personelCookie, body: { appearance } });
        assert.deepEqual(response.data.user.appearance, appearance);
      }
      await request("/api/recipe/profile", { method: "PUT", cookie: personelCookie, body: { appearance: { presetId: "unknown", mode: "dark" } } }, 400);
      await request("/api/recipe/profile", { method: "PUT", cookie: personelCookie, body: { appearance: { presetId: "purple-gray-stone", mode: "auto" } } }, 400);
      const chosen = { presetId: "navy-ice-gray", mode: "dark" };
      await request("/api/recipe/profile", { method: "PUT", cookie: personelCookie, body: { appearance: chosen, userId: "another-user" } });
      const created = await mutation("/api/admin/recipe-users", { name: "İkinci Test Personeli", username: "revsecond", email: "revsecond@example.invalid", password: "SecondPersonel!2026", active: true }, adminCookie, "POST", 201);
      assert.ok(created.data.user?.id);
      const secondLogin = await request("/api/recipe/login", { method: "POST", body: { username: "revsecond", password: "SecondPersonel!2026" } });
      const secondCookie = secondLogin.response.headers.get("set-cookie").split(";")[0];
      assert.deepEqual((await request("/api/recipe/me", { cookie: secondCookie })).data.user.appearance, defaultAppearance);
      assert.deepEqual((await request("/api/recipe/me", { cookie: personelCookie })).data.user.appearance, chosen);
      const publish = (await request("/api/admin/publish-state", { cookie: adminCookie })).data;
      const panelConfig = structuredClone(publish.panelConfig || {});
      panelConfig.appearance = { ...(panelConfig.appearance || {}), adminThemePresetId: "olive-cream" };
      await mutation("/api/admin/publish", { expectedRevision: publish.revision, changes: { panelConfig } });
      assert.equal((await request("/api/public/panel-theme")).data.presetId, "olive-cream");
      assert.deepEqual((await request("/api/recipe/me", { cookie: personelCookie })).data.user.appearance, chosen);
      const personHtml = (await request("/personel/", { cookie: personelCookie })).data;
      assert.match(personHtml, /data-admin-theme-preset="navy-ice-gray" data-appearance-mode="dark"/);
      assert.match((await request("/personel/recete-embed/", { cookie: personelCookie })).data, /data-appearance-mode="dark"/);
      assert.match((await request("/personel/", { cookie: secondCookie })).data, /data-admin-theme-preset="purple-gray-stone" data-appearance-mode="light"/);
      const freshLogin = await request("/api/recipe/login", { method: "POST", body: { username: "revtest", password: "RevPersonel!2026" } });
      personelCookie = freshLogin.response.headers.get("set-cookie").split(";")[0];
      assert.deepEqual((await request("/api/recipe/me", { cookie: personelCookie })).data.user.appearance, chosen);
    });

    await test("admin-and-personel-password-reset-security", async () => {
      const adminEmail = "revision-manager@example.invalid", personelEmail = "revision-personel@example.invalid";
      await request("/api/account/admin/email/change", { method: "POST", cookie: adminCookie, body: { email: adminEmail } });
      const adminVerify = await request("/api/account/admin/email-verification/request", { method: "POST", cookie: adminCookie, body: {} });
      await request("/api/account/admin/email-verification/confirm", { method: "POST", cookie: adminCookie, body: { challengeId: adminVerify.data.challengeId, code: "123456" } });
      assert.equal((await request("/api/account/admin/security", { cookie: adminCookie })).data.security.email, adminEmail);
      const personVerify = await request("/api/account/personel/email-verification/request", { method: "POST", cookie: personelCookie, body: { email: personelEmail } });
      await request("/api/account/personel/email-verification/confirm", { method: "POST", cookie: personelCookie, body: { challengeId: personVerify.data.challengeId, code: "123456" } });
      assert.equal((await request("/api/account/personel/security", { cookie: personelCookie })).data.security.email, personelEmail);
      const adminReset = await request("/api/account/password-reset/admin/request", { method: "POST", body: { identifier: adminEmail } });
      const personReset = await request("/api/account/password-reset/personel/request", { method: "POST", body: { identifier: "revtest" } });
      assert.ok(adminReset.data.challengeId && personReset.data.challengeId);
      await request("/api/account/password-reset/personel/confirm", { method: "POST", body: { challengeId: personReset.data.challengeId, code: "000000", newPassword: "RevPersonelReset!2026" } }, 401);
      await request("/api/account/password-reset/personel/confirm", { method: "POST", body: { challengeId: personReset.data.challengeId, code: "123456", newPassword: "RevPersonelReset!2026" } });
      await request("/api/account/password-reset/admin/confirm", { method: "POST", body: { challengeId: adminReset.data.challengeId, code: "123456", newPassword: "P2RevisionReset!2026" } });
      await request("/api/admin/profile", { cookie: adminCookie }, 401);
      await request("/api/recipe/me", { cookie: personelCookie }, 401);
      const adminLogin = await request("/api/admin/login", { method: "POST", body: { password: "P2RevisionReset!2026" } });
      adminCookie = adminLogin.response.headers.get("set-cookie").split(";")[0];
      const personLogin = await request("/api/recipe/login", { method: "POST", body: { username: "revtest", password: "RevPersonelReset!2026" } });
      personelCookie = personLogin.response.headers.get("set-cookie").split(";")[0];
      assert.deepEqual((await request("/api/recipe/me", { cookie: personelCookie })).data.user.appearance, { presetId: "navy-ice-gray", mode: "dark" });
    });
  } catch (error) {
    results.push({ passed: false, error: error.stack });
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    if (process.env.REVISION_UI_HOLD === "true" && !process.exitCode) {
      console.log(`UI_READY ${origin} (isolated revision test store)`);
      await new Promise((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
      });
    }
    await backend.shutdownRuntime(server);
    fs.writeFileSync(path.join(__dirname, "revision-results.json"), JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
    const fixtureRoot = path.join(__dirname, "REVISION-TEST-DATA");
    if (path.dirname(fixtureRoot) === __dirname && path.basename(fixtureRoot) === "REVISION-TEST-DATA") {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  backend.store.close();
  process.exitCode = 1;
});
