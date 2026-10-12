"use strict";

const nodemailer = require("nodemailer");

function createMailService(config, options = {}) {
  let transporter = null;
  const transportFactory = options.transportFactory || nodemailer.createTransport;

  function isConfigured() {
    return Boolean(config.smtpHost && config.smtpPort && config.smtpUser && config.smtpPass && config.smtpFrom);
  }

  function getCapability() {
    return { smtpConfigured: isConfigured() };
  }

  function getTransporter() {
    if (transporter) return transporter;
    if (!isConfigured()) {
      const error = new Error("SMTP bildirim kanalı yapılandırılmamış.");
      error.code = "SMTP_NOT_CONFIGURED";
      throw error;
    }
    transporter = transportFactory({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: { user: config.smtpUser, pass: config.smtpPass },
      disableFileAccess: true,
      disableUrlAccess: true
    });
    return transporter;
  }

  async function sendNotificationEmail(notification, destination) {
    const to = String(destination || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      const error = new Error("Bildirim e-posta adresi geçersiz.");
      error.code = "INVALID_EMAIL_DESTINATION";
      throw error;
    }
    const brandName = String(notification && notification.brandName || "Yönetici").replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Yönetici";
    const title = String(notification && notification.title || `${brandName} bildirimi`).replace(/[\r\n]+/g, " ").slice(0, 180);
    const body = String(notification && notification.body || "").slice(0, 1200);
    const deepLink = absoluteNotificationLink(notification, config);
    return getTransporter().sendMail({
      from: config.smtpFrom || config.smtpUser,
      to,
      disableFileAccess: true,
      disableUrlAccess: true,
      subject: `${brandName} | ${title}`,
      text: [title, "", body, deepLink].filter(Boolean).join("\n"),
      html: [
        "<div style=\"font-family:Arial,sans-serif;line-height:1.55;color:#2d2736\">",
        `<h2>${escapeHtml(title)}</h2>`,
        body ? `<p>${escapeHtml(body)}</p>` : "",
        deepLink ? `<p><a href=\"${escapeHtml(deepLink)}\">${escapeHtml(brandName)} panelinde aç</a></p>` : "",
        "</div>"
      ].join("")
    });
  }

  async function sendAccountSecurityCode(input = {}) {
    const to = String(input.to || "").trim().toLowerCase();
    const code = String(input.code || "").replace(/\D/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !/^\d{6}$/.test(code)) {
      const error = new Error("Hesap güvenliği e-posta bilgileri geçersiz.");
      error.code = "INVALID_ACCOUNT_SECURITY_MAIL";
      throw error;
    }
    const purpose = input.purpose === "email_verification" ? "email_verification" : "password_reset";
    const brandName = String(input.brandName || "Yönetici").replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Yönetici";
    const accountLabel = String(input.accountLabel || `${brandName} hesabı`).replace(/[\r\n]+/g, " ").slice(0, 120);
    const ttlMinutes = Math.max(1, Math.min(60, Number(input.ttlMinutes || 15)));
    const title = purpose === "email_verification" ? "E-posta doğrulama" : "Parola sıfırlama";
    const action = purpose === "email_verification"
      ? "e-posta adresinizi doğrulamak"
      : "parolanızı güvenli biçimde sıfırlamak";
    return getTransporter().sendMail({
      from: config.smtpFrom || config.smtpUser,
      to,
      disableFileAccess: true,
      disableUrlAccess: true,
      subject: `${brandName} | ${title} kodu`,
      text: [
        `${accountLabel} için ${action} üzere tek kullanımlık kodunuz:`,
        "",
        code,
        "",
        `Kod ${ttlMinutes} dakika geçerlidir. Bu isteği siz yapmadıysanız e-postayı yok sayın.`
      ].join("\n"),
      html: [
        "<div style=\"margin:0;background:#f6f4f7;padding:24px;font-family:Arial,sans-serif;color:#2d2736\">",
        "<div style=\"max-width:520px;margin:auto;background:#fffdff;border:1px solid #ddd5e2;border-radius:14px;padding:24px\">",
        `<p style=\"margin:0 0 8px;color:#6f6677;font-size:12px;letter-spacing:.12em\">${escapeHtml(brandName.toLocaleUpperCase("tr-TR"))}</p>`,
        `<h2 style=\"margin:0 0 16px;font-family:Georgia,serif\">${escapeHtml(title)}</h2>`,
        `<p>${escapeHtml(accountLabel)} için ${escapeHtml(action)} üzere tek kullanımlık kodunuz:</p>`,
        `<p style=\"margin:20px 0;padding:14px;text-align:center;background:#ece7ef;border-radius:10px;font-size:30px;font-weight:800;letter-spacing:.2em\">${code}</p>`,
        `<p style=\"color:#6f6677\">Kod ${ttlMinutes} dakika geçerlidir. Bu isteği siz yapmadıysanız hiçbir işlem yapmanız gerekmez.</p>`,
        "</div></div>"
      ].join("")
    });
  }

  async function close() {
    if (transporter && typeof transporter.close === "function") transporter.close();
    transporter = null;
  }

  return { close, getCapability, getTransporter, isConfigured, sendAccountSecurityCode, sendNotificationEmail };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function absoluteNotificationLink(notification, config) {
  const path = String(notification && notification.deepLink || "").trim();
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path)) return "";
  if (!notification || notification.recipientRole !== "manager") return "";
  const candidate = config.adminDomain || config.publicSiteUrl || config.mainDomain;
  const origin = normalizeOrigin(candidate);
  if (!origin) return "";
  try { return new URL(path, `${origin}/`).toString(); } catch (_error) { return ""; }
}

function normalizeOrigin(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch (_error) {
    return "";
  }
}

module.exports = { absoluteNotificationLink, createMailService };
