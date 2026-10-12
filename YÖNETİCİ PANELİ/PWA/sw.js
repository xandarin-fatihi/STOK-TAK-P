/* Yönetici PWA — scope: /yonetici/ */
importScripts("/shared/scripts/pwa-release.js");
self.MENU_SUITE_PWA_CONFIG = Object.freeze({
  appId: "yonetici",
version: `${self.MENU_SUITE_PWA_RELEASE.id}-yonetici-role-icons-v2-integrated-v3-product-catalog-v2-storage-placement-v5-depot-history-v1-nav-slim-v1-admin-notifications-v3-settings-save-v1-requests-v6-catalog-barcode-v3-live-preview-off-v1-material-batch-v2-embedded-responsive-v1-csp-v1-approved-ui-20261008-v1-personnel-v10-nav-flat-v2-documents-v5-nav-receipts-archive-off-v1-document-history-v1-settings-profile-only-v1-document-scan-v2-pwa-layer-v1-fixes-20261011-v2`,
  scopePath: "/yonetici/",
  offlineUrl: "/yonetici/offline.html",
  offlineAssets: [
    "/shared/styles/pwa-ui.css",
    "/shared/styles/brand-identity.css",
    "/shared/scripts/brand-identity.js?v=20260929-role-brand-v1",
    "/assets/app-icons/yonetici/icon-192.png",
    "/assets/app-icons/yonetici/notification-badge-96.png",
    "/assets/app-icons/yonetici/master.svg"
  ],
  precache: [
    "/yonetici/styles/admin.css",
    "/yonetici/styles/personnel-revision.css?v=20261008-v10",
    "/yonetici/styles/admin-compact.css?v=20260927-layout-polish-v1",
    "/yonetici/styles/admin-components.css",
    "/yonetici/styles/stock-management.css?v=20260930-stock-tabs-v2",
    "/yonetici/styles/notifications.css?v=20261007-admin-notifications-v3",
    "/yonetici/styles/admin-chrome.css?v=20261007-settings-save-v1",
    "/yonetici/scripts/theme-bootstrap.js?v=20261005-csp-v1",
    "/yonetici/scripts/app.js?v=20261007-catalog-barcode-v3&batch=20261008-v1&approved=20261008-v1&personnel=20261008-v10&nav=20261008-flat-v2&documents=20261008-v5&history=20261009-v1&fixes=20261011-v2",
    "/yonetici/scripts/material-request-batch.js?v=20261008-v1",
    "/yonetici/styles/material-request-batch.css?v=20261008-v2",
    "/yonetici/modules/tedarik-muhasebe/scripts/catalog-barcode.js?v=20261007-catalog-barcode-v3",
    "/shared/scripts/zxing-browser.min.js?v=0.2.1",
    "/yonetici/scripts/workforce.js?v=20261007-requests-v6&batch=20261008-v1&approved=20261008-v1&personnel=20261008-v10&fixes=20261011-v2",
    "/yonetici/styles/requests.css?v=20261007-requests-v6",
    "/yonetici/scripts/pricing.js",
    "/shared/styles/panel-foundation.css",
    "/shared/styles/brand-identity.css",
    "/shared/styles/account-security.css",
    "/shared/scripts/save-coordinator.js",
    "/shared/scripts/menu-design-schema.js",
    "/shared/scripts/account-security.js",
    "/shared/scripts/pwa-client.js",
    "/shared/scripts/brand-identity.js?v=20260929-role-brand-v1",
    "/assets/fonts/poppins-regular.ttf",
    "/assets/fonts/poppins-semibold.ttf",
    "/assets/fonts/poppins-bold.ttf",
    "/assets/app-icons/yonetici/master.svg"
  ],
  staticPrefixes: ["/yonetici/", "/shared/", "/assets/"],
  neverCachePrefixes: ["/api/"],
  excludedNavigationPrefixes: [],
  excludedClientPrefixes: []
});
importScripts("/shared/scripts/pwa-sw-runtime.js");

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (_error) {
      payload = { body: event.data ? event.data.text() : "" };
    }
    const source = payload.notification && typeof payload.notification === "object" ? payload.notification : payload;
    const title = String(source.title || "Yönetici bildirimi").slice(0, 120);
    const deepLink = safeAdminDeepLink(source.deepLink || source.data && source.data.deepLink);
    const icon = safeNotificationAsset(source.icon, "/assets/app-icons/yonetici/icon-192.png");
    const badge = safeNotificationAsset(source.badge, "/assets/app-icons/yonetici/notification-badge-96.png");
    await self.registration.showNotification(title, {
      body: String(source.body || "Yeni bir bildiriminiz var.").slice(0, 240),
      icon,
      badge,
      tag: String(source.tag || source.id && `menu-suite-yonetici-${String(source.id).slice(0, 100)}` || "").slice(0, 240) || undefined,
      renotify: false,
      data: { deepLink, notificationId: String(source.data && source.data.notificationId || source.id || "").slice(0, 180) }
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeAdminDeepLink(event.notification.data && event.notification.data.deepLink);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => {
      try { return new URL(client.url).pathname.startsWith("/yonetici"); } catch (_error) { return false; }
    });
    if (existing) {
      if ("navigate" in existing) await existing.navigate(target).catch(() => null);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});

function safeNotificationAsset(value, fallback) {
  try {
    const url = new URL(String(value || fallback), self.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : fallback;
  } catch (_error) {
    return fallback;
  }
}

function safeAdminDeepLink(value) {
  try {
    const url = new URL(String(value || "/yonetici/"), self.location.origin);
    if (url.origin !== self.location.origin || !(url.pathname === "/yonetici" || url.pathname.startsWith("/yonetici/"))) return "/yonetici/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return "/yonetici/";
  }
}
