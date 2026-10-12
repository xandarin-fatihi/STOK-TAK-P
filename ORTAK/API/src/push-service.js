"use strict";

function createPushService(config = {}, options = {}) {
  let webPush = options.webPush || null;
  if (!webPush) {
    try { webPush = require("web-push"); } catch (_error) { webPush = null; }
  }
  let configurationError = null;
  let configured = Boolean(webPush && config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject);
  if (configured) {
    try {
      webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
    } catch (error) {
      configured = false;
      configurationError = error;
    }
  }

  async function sendNotificationPush(notification, subscription) {
    if (!configured) {
      const error = new Error(configurationError
        ? "Web Push yapılandırması geçersiz."
        : "Web Push kanalı yapılandırılmamış.");
      error.code = "PUSH_NOT_CONFIGURED";
      error.permanent = true;
      throw error;
    }
    const role = String(notification && notification.recipientRole || "").toLowerCase() === "personnel"
      ? "personnel"
      : "manager";
    const fallbackLink = role === "personnel" ? "/personel/" : "/yonetici/";
    const deepLink = safeDeepLink(notification && notification.deepLink, fallbackLink);
    const iconRoot = role === "personnel" ? "/assets/app-icons/personel" : "/assets/app-icons/yonetici";
    const defaultBrandName = role === "personnel" ? "Personel" : "Yönetici";
    const brandName = String(notification && notification.brandName || defaultBrandName).replace(/[\r\n]+/g, " ").trim().slice(0, 120) || defaultBrandName;
    const brandIcon = safeIcon(notification && notification.brandIcon) || `${iconRoot}/icon-192.png`;
    const notificationId = String(notification && notification.id || "").replace(/[\r\n\u0000-\u001f\u007f]+/g, "").slice(0, 180);
    const payload = JSON.stringify({
      title: String(notification && notification.title || `${brandName} bildirimi`).replace(/[\r\n]+/g, " ").slice(0, 180),
      body: String(notification && notification.body || "").replace(/[\r\n]+/g, " ").slice(0, 500),
      icon: brandIcon,
      badge: brandIcon,
      tag: `paket3-${role}-${notificationId || "notification"}`.slice(0, 240),
      renotify: false,
      data: {
        notificationId,
        deepLink,
        category: String(notification && notification.category || "system").slice(0, 40),
        recipientRole: role
      }
    });
    return webPush.sendNotification(subscription, payload, { TTL: 60 * 60, urgency: notification && notification.severity === "critical" ? "high" : "normal" });
  }

  return {
    isConfigured: () => configured,
    publicKey: configured ? config.vapidPublicKey : "",
    sendNotificationPush
  };
}

function safeIcon(value) {
  const icon = String(value || "").trim().slice(0, 500);
  if (/^\/(?:media|assets)\/[a-z0-9/._-]+$/i.test(icon)) return icon;
  try {
    const url = new URL(icon);
    return url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function safeDeepLink(value, fallback = "/yonetici/") {
  const link = String(value || "").trim().slice(0, 500);
  if (!link.startsWith("/") || link.startsWith("//") || /[\r\n]/.test(link)) return fallback;
  try {
    const url = new URL(link, "https://menu-suite.invalid/");
    const root = String(fallback).startsWith("/personel") ? "/personel" : "/yonetici";
    if (url.origin !== "https://menu-suite.invalid" || (url.pathname !== root && !url.pathname.startsWith(`${root}/`))) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch (_error) {
    return fallback;
  }
}

module.exports = { createPushService, safeDeepLink };
