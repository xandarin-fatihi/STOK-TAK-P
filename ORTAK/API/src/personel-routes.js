"use strict";
function registerPersonelRoutes(deps) {
const {
  app, store, auth, config, bcrypt, recipeLoginLimiter, uploadLimiter,
  notificationService, notificationDeliveryWorker, requireRequestOrigin,
  broadcastMenuUpdate: baseBroadcastMenuUpdate,
  normalizeStockState, broadcastStockUpdate, queueStockThresholdNotifications,
  notifyProcurementChange
} = deps;
const requireAdminRequestOrigin = requireRequestOrigin;
const requireAdminOrMainRequestOrigin = requireRequestOrigin;
const broadcastMenuUpdate = () => void store.read().then(data => baseBroadcastMenuUpdate(data));
const broadcastPublicUpdate = () => {};
const catalogEntityTag = (scope, payload) => `"${scope}-${require("crypto").createHash("sha256").update(JSON.stringify(payload)).digest("base64url").slice(0,27)}"`;
const requestEntityTagMatches = (req, tag) => String(req.headers["if-none-match"] || "").split(",").some(value => value.trim().replace(/^W\//, "") === tag);
let workforceRuntime;
const path = require("path");

const crypto = require("crypto");

const fs = require("fs/promises");

const express = require("express");

const { reconcileRecipeCatalog } = require("./store/migrations");

const { normalizeProductCode } = require("./store/product-code-registry");



const { hasPersonelSectionAccess, normalizePersonelSectionAccess } = require("./personel-section-access");
const panelTheme = require("../../JS/panel-theme");

const {
  appendSecurityAudit,
  assignUnverifiedAccountEmail,
  normalizeAccountEmail,
  publicAccountSecurity,
  registerAccountSecurityRoutes
} = require("./account-security-routes");

const {
  validateMenuProductCodes,
  validateRecipeProductCodes
} = require("./store/product-code-registry");

const { validateRecipeCatalog, validateRecipeState, validatePassword } = require("./validators");

const recipeSseClients = new Set();



const authenticatedEventClients = new Set();

const SSE_RETRY_MS = 5000;

const SSE_HEARTBEAT_MS = 25000;

const SSE_HISTORY_LIMIT = 64;

const sseStreamState = new Map();

const RECIPE_ACTIVITY_LIMIT = 5000;

app.post("/api/recipe/logout", requireAdminOrMainRequestOrigin, async (req, res, next) => {
  try {
    await auth.revokeRequestSession(req, ["personel"]);
    auth.clearRecipeCookie(res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/login", requireAdminOrMainRequestOrigin, recipeLoginLimiter, async (req, res, next) => {
  try {
    const username = normalizeRecipeUsername(req.body && req.body.username);
    const password = String(req.body && req.body.password || "");
    if (!password || password.length > 72) {
      return res.status(401).json({ ok: false, message: "Recete sifresi hatali." });
    }

    const data = await store.read();
    const users = Array.isArray(data.recipeUsers) ? data.recipeUsers : [];

    if (users.length) {
      if (!username) {
        return res.status(401).json({ ok: false, message: "Kullanici adi ve sifre gerekli." });
      }

      const user = users.find((item) => item.username === username);
      const validUser = Boolean(user && user.active !== false && user.passwordHash)
        && await bcrypt.compare(password, user.passwordHash);

      if (!validUser) {
        await recordRecipeActivity({
          type: "login_failed",
          username,
          req
        });
        return res.status(401).json({ ok: false, message: "Kullanici adi veya sifre hatali." });
      }

      const now = new Date().toISOString();
      await store.update((nextData) => {
        const storedUser = (nextData.recipeUsers || []).find((item) => item.id === user.id);
        if (storedUser) {
          storedUser.lastLoginAt = now;
          storedUser.updatedAt = storedUser.updatedAt || now;
        }
        appendRecipeActivity(nextData, makeRecipeActivity({
          type: "login",
          user: storedUser || user,
          req,
          createdAt: now
        }));
        return nextData;
      });

      const session = await auth.createRecipeSession(user);
      const token = session.token;
      auth.attachRecipeCookie(res, token);
      return res.json({
        ok: true,
        token,
        tokenType: "Bearer",
        expiresIn: null,
        ...auth.sessionInfoFromPayload(session.payload),
        user: publicRecipeUser(user)
      });
    }

    const passwordHash = data && data.admin && data.admin.recipePasswordHash;
    const valid = Boolean(passwordHash) && await bcrypt.compare(password, passwordHash);

    if (!valid) {
      return res.status(401).json({ ok: false, message: "Recete sifresi hatali." });
    }

    const session = await auth.createRecipeSession(null);
    const token = session.token;
    auth.attachRecipeCookie(res, token);
    res.json({
      ok: true,
      token,
      tokenType: "Bearer",
      expiresIn: null,
      ...auth.sessionInfoFromPayload(session.payload),
      user: null
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recipe/me", requireAdminOrMainRequestOrigin, auth.requirePersonelOrPreview, (req, res) => {
  const payload = req.recipe || {};
  const user = req.recipeUser || {};
  const hasNamedRecipeUser = Boolean(req.recipeUser && req.recipeUser.id);
  if (req.authToken) auth.attachRecipeCookie(res, req.authToken);
  res.json({
    ok: true,
    role: payload.role || "recipe",
    userId: hasNamedRecipeUser ? String(req.recipeUser.id) : null,
    ...auth.sessionInfoFromPayload(payload),
    user: hasNamedRecipeUser ? publicRecipeUser(user) : null
  });
});

app.put("/api/recipe/profile", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
  try {
    if (!req.recipeUser) {
      return res.status(400).json({ ok: false, message: "Profil icin personel kullanici oturumu gerekli." });
    }

    const userId = String(req.recipeUser.id || "").trim();
    const name = String(req.body && req.body.name || "").trim().slice(0, 80);
    const avatarUrl = String(req.body && req.body.avatarUrl || "").trim().slice(0, 500);
    const bio = String(req.body && req.body.bio || "").trim().slice(0, 240);
    const appearanceSupplied = Object.prototype.hasOwnProperty.call(req.body || {}, "appearance");
    const appearance = req.body && req.body.appearance;
    if (appearanceSupplied && (!appearance || typeof appearance !== "object" || Array.isArray(appearance)
      || !panelTheme.PRESETS.some((preset) => preset.id === appearance.presetId)
      || !["light", "dark"].includes(appearance.mode))) {
      return res.status(400).json({ ok: false, code: "INVALID_APPEARANCE", message: "Geçerli bir tema ve görünüm modu seçin." });
    }
    const now = new Date().toISOString();
    let updatedUser = null;

    const nextStore = await store.update((data) => {
      const user = (data.recipeUsers || []).find((item) => item.id === userId);
      if (!user) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      user.name = name || user.name || user.username;
      user.avatarUrl = avatarUrl;
      user.bio = bio;
      if (appearanceSupplied) user.appearance = panelTheme.normalizeAppearance(appearance);
      user.updatedAt = now;
      updatedUser = user;
      syncRecipeUserReferences(data, user);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_profile_updated",
        user,
        req,
        createdAt: now
      }));
      return data;
    });

    res.json({
      ok: true,
      user: publicRecipeUser(updatedUser),
      // Kişisel profil yanıtı yalnız oturum sahibinin verisini içerir.
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/profile/avatar", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, uploadLimiter, express.raw({
  type: () => true,
  limit: "10mb"
}), async (req, res, next) => {
  try {
    if (!req.recipeUser) {
      return res.status(400).json({ ok: false, message: "Profil fotoğrafı için personel kullanıcı oturumu gerekli." });
    }

    const file = validateProfileAvatarUpload(req);
    const avatarPath = `/media/${file.fileName}`;
    const now = new Date().toISOString();
    let oldAvatarPath = "";
    let updatedUser = null;

    await fs.mkdir(config.mediaDir, { recursive: true });
    await fs.writeFile(path.join(config.mediaDir, file.fileName), req.body);

    await store.update((data) => {
      const user = (data.recipeUsers || []).find((item) => item.id === req.recipeUser.id);
      if (!user) {
        const error = new Error("Personel kullanıcısı bulunamadı.");
        error.status = 404;
        throw error;
      }
      oldAvatarPath = String(user.avatarUrl || "");
      user.avatarUrl = avatarPath;
      user.updatedAt = now;
      updatedUser = user;
      syncRecipeUserReferences(data, user);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_avatar_updated",
        user,
        req,
        createdAt: now
      }));
      return data;
    });

    await removeOldProfileAvatar(oldAvatarPath, avatarPath);
    res.status(201).json({
      ok: true,
      avatarUrl: avatarPath,
      avatar: {
        src: avatarPath,
        url: absoluteUrl(req, avatarPath),
        type: file.contentType,
        size: req.body.length
      },
      user: publicRecipeUser(updatedUser)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/workforce/material-request-media", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, auth.requirePersonelSection("materialRequest"), uploadLimiter, express.raw({
  type: () => true,
  limit: "10mb"
}), async (req, res, next) => {
  try {
    if (!req.recipeUser) return res.status(400).json({ ok: false, message: "Malzeme görseli için personel oturumu gerekli." });
    const file = validateMaterialRequestImageUpload(req);
    const mediaPath = `/media/${file.fileName}`;
    await fs.mkdir(config.mediaDir, { recursive: true });
    await fs.writeFile(path.join(config.mediaDir, file.fileName), req.body);
    return res.status(201).json({
      ok: true,
      imageUrl: mediaPath,
      media: { src: mediaPath, url: absoluteUrl(req, mediaPath), type: file.contentType, size: req.body.length }
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/recipe/session/refresh", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, async (req, res, next) => {
  const payload = req.recipe || {};
  try {
    const user = req.recipeUser;
    const session = await auth.createRecipeSession(user);
    await auth.revokeRequestSession(req, ["personel"]);
    auth.attachRecipeCookie(res, session.token);
    return res.json({
      ok: true,
      role: "recipe",
      token: session.token,
      tokenType: "Bearer",
      expiresIn: null,
      ...auth.sessionInfoFromPayload(session.payload),
      user: publicRecipeUser(user)
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/admin/recipe-access", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const data = req.storeSnapshot;
    res.json({
      ok: true,
      revision: Math.max(0, Number(data.revisions && data.revisions.workforce || 0)),
      users: (data.recipeUsers || []).map(publicRecipeUser),
      activity: publicRecipeActivity(data.recipeActivity || []),
      assignments: publicRecipeAssignments(data.recipeAssignments || [], true)
    });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/admin/recipe-users/:id/section-access", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const access = normalizePersonelSectionAccess(req.body && req.body.personelSectionAccess);
    const now = new Date().toISOString();
    let updatedUser = null;
    let revision = 0;
    const nextStore = await store.update((data) => {
      updatedUser = (data.recipeUsers || []).find((item) => String(item.id || "") === id) || null;
      if (!updatedUser) throw Object.assign(new Error("Personel bulunamadı."), { status: 404 });
      updatedUser.personelSectionAccess = access;
      updatedUser.updatedAt = now;
      appendRecipeActivity(data, makeRecipeActivity({ type: "personel_section_access_updated", user: updatedUser, req, createdAt: now }));
      revision = touchWorkforceRevision(data);
      return data;
    });
    publishAuthenticatedEvent({
      topic: "workforce",
      type: "personel.section-access.updated",
      entityType: "personel",
      entityId: id,
      revision,
      actorId: "admin",
      targets: ["personel", "yonetici"]
    });
    res.json({
      ok: true,
      revision,
      user: publicRecipeUser(updatedUser),
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/recipe-users", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const requestId = workforceLifecycleRequestId(req);
    const name = String(req.body && req.body.name || "").trim().slice(0, 80);
    const username = normalizeRecipeUsername(req.body && req.body.username);
    const password = String(req.body && req.body.password || "");
    const rawEmail = String(req.body && req.body.email || "").trim();
    const email = normalizeAccountEmail(rawEmail);

    const userError = validateRecipeUserInput({ name, username, password, requirePassword: true });
    if (userError) return res.status(400).json({ ok: false, message: userError });
    if (rawEmail && (rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).json({ ok: false, message: "Geçerli bir e-posta adresi girin." });
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const now = new Date().toISOString();
    const user = {
      id: `barista-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`,
      name: name || username,
      jobTitle: String(req.body && req.body.jobTitle || "").trim().slice(0, 120),
      username,
      passwordHash,
      active: true,
      email: "",
      emailNormalized: "",
      pendingEmail: "",
      emailVerifiedAt: null,
      emailVerificationRequired: true,
      emailVerificationVersion: 0,
      lastPasswordResetAt: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
      personelSectionAccess: normalizePersonelSectionAccess(req.body && req.body.personelSectionAccess)
    };
    let response = null;
    let replayed = false;

    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_create", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      if ((data.recipeUsers || []).some((item) => item.username === username)) {
        const error = new Error("Bu kullanici adi zaten kayitli.");
        error.status = 409;
        throw error;
      }
      if (email) {
        assignUnverifiedAccountEmail(data, "personel", user, email, now);
        appendSecurityAudit(data, req, {
          action: "personnel_email_assigned",
          scope: "personel",
          accountId: user.id,
          result: "pending_verification",
          createdAt: now
        }, config);
      }
      data.recipeUsers = (data.recipeUsers || []).concat(user);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_created",
        user,
        req,
        createdAt: now
      }));
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        user: publicRecipeUser(user),
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_create", requestId, response, now);
      return data;
    });

    res.status(replayed ? 200 : 201).json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      user: publicRecipeUser(user),
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/recipe-users/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const requestId = workforceLifecycleRequestId(req);
    const name = String(req.body && req.body.name || "").trim().slice(0, 80);
    const username = normalizeRecipeUsername(req.body && req.body.username);
    const password = String(req.body && req.body.password || "");
    const active = req.body && req.body.active !== false;
    const emailSupplied = Boolean(req.body && Object.prototype.hasOwnProperty.call(req.body, "email"));
    const rawEmail = emailSupplied ? String(req.body.email || "").trim() : "";
    const email = normalizeAccountEmail(rawEmail);
    const sectionAccessSupplied = Boolean(req.body && Object.prototype.hasOwnProperty.call(req.body, "personelSectionAccess"));

    const userError = validateRecipeUserInput({ name, username, password, requirePassword: false });
    if (userError) return res.status(400).json({ ok: false, message: userError });
    if (rawEmail && (rawEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return res.status(400).json({ ok: false, message: "Geçerli bir e-posta adresi girin." });
    }

    const passwordHash = password ? await bcrypt.hash(password, config.bcryptRounds) : "";
    const now = new Date().toISOString();
    let updatedUser = null;
    let response = null;
    let replayed = false;

    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_update", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      const users = data.recipeUsers || [];
      const user = users.find((item) => item.id === id);
      if (!user) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      if (users.some((item) => item.id !== id && item.username === username)) {
        const error = new Error("Bu kullanici adi zaten kayitli.");
        error.status = 409;
        throw error;
      }

      const wasActive = user.active !== false;
      user.name = name || username;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "jobTitle")) user.jobTitle = String(req.body.jobTitle || "").trim().slice(0, 120);
      user.username = username;
      user.active = active;
      user.updatedAt = now;
      if (sectionAccessSupplied) user.personelSectionAccess = normalizePersonelSectionAccess(req.body.personelSectionAccess);
      if (emailSupplied) {
        const security = assignUnverifiedAccountEmail(data, "personel", user, email, now);
        appendSecurityAudit(data, req, {
          action: email ? "personnel_email_assigned" : "personnel_email_cleared",
          scope: "personel",
          accountId: user.id,
          result: email ? (security.emailVerifiedAt && !security.pendingEmail ? "verified_unchanged" : "pending_verification") : "cleared",
          createdAt: now
        }, config);
      }
      if (passwordHash) user.passwordHash = passwordHash;
      if (passwordHash || active === false) {
        revokeStoredSessions(data, (session) => session.role === "personel" && session.userId === id, now);
      }
      if (active === false) suspendPersonnelNotificationDelivery(data, id, now);
      syncRecipeUserReferences(data, user);
      if (wasActive !== active) {
        appendRecipeActivity(data, makeRecipeActivity({
          type: active ? "recipe_user_reactivated" : "recipe_user_deactivated",
          user,
          req,
          createdAt: now
        }));
      }
      updatedUser = user;
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        user: publicRecipeUser(updatedUser),
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_update", requestId, response, now);
      return data;
    });

    if (!replayed && updatedUser && updatedUser.active === false) {
      closeRecipeClientsForUser(updatedUser.id);
    }

    res.json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      user: publicRecipeUser(updatedUser),
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/recipe-users/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const requestId = workforceLifecycleRequestId(req);
    const now = new Date().toISOString();
    let response = null;
    let replayed = false;
    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_deactivate", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      const user = (data.recipeUsers || []).find((item) => item.id === id);
      if (!user) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      const wasActive = user.active !== false;
      user.active = false;
      user.updatedAt = now;
      revokeStoredSessions(data, (session) => session.role === "personel" && session.userId === id, now);
      suspendPersonnelNotificationDelivery(data, id, now);
      if (wasActive) {
        appendRecipeActivity(data, makeRecipeActivity({
          type: "recipe_user_deactivated",
          user,
          req,
          createdAt: now
        }));
      }
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        user: publicRecipeUser(user),
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_deactivate", requestId, response, now);
      return data;
    });

    if (!replayed) closeRecipeClientsForUser(id);

    res.json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/recipe-users/:id/permanent", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const requestId = workforceLifecycleRequestId(req);
    const now = new Date().toISOString();
    let removedUser = null;
    let response = null;
    let replayed = false;
    const nextStore = await store.update((data) => {
      const previous = lifecycleReplay(data, "personnel_permanent_delete", requestId);
      if (previous) {
        response = { ...previous, idempotent: true };
        replayed = true;
        return data;
      }
      assertLifecycleExpectedRevision(data, req.body);
      const users = data.recipeUsers || [];
      removedUser = users.find((item) => item.id === id) || null;
      if (!removedUser) {
        const error = new Error("Kullanici bulunamadi.");
        error.status = 404;
        throw error;
      }
      data.recipeUsers = users.filter((item) => item.id !== id);
      revokeStoredSessions(data, (session) => session.role === "personel" && session.userId === id, now);
      suspendPersonnelNotificationDelivery(data, id, now);
      preserveDeletedPersonnelReferences(data, removedUser, now);
      data.deletedRecipeUsers = (Array.isArray(data.deletedRecipeUsers) ? data.deletedRecipeUsers : [])
        .filter((item) => String(item.id || item.userId || "") !== id)
        .concat({
          id,
          userId: id,
          name: removedUser.name || removedUser.username || "Silinmiş personel",
          username: removedUser.username || "",
          deletedAt: now,
          deletedBy: "admin",
          usernameReusable: true
        })
        .slice(-1000);
      appendRecipeActivity(data, makeRecipeActivity({
        type: "recipe_user_permanently_deleted",
        user: removedUser,
        req,
        createdAt: now
      }));
      const revision = touchWorkforceRevision(data);
      response = {
        ok: true,
        requestId,
        revision,
        deletedUser: {
          id,
          name: removedUser.name || removedUser.username || "Silinmiş personel",
          username: removedUser.username || "",
          usernameReusable: true
        },
        users: (data.recipeUsers || []).map(publicRecipeUser),
        assignments: publicRecipeAssignments(data.recipeAssignments || [], true),
        activity: publicRecipeActivity(data.recipeActivity || [])
      };
      rememberLifecycleResponse(data, "personnel_permanent_delete", requestId, response, now);
      return data;
    });

    if (!replayed) closeRecipeClientsForUser(id);

    res.json(response || {
      ok: true,
      revision: nextStore.revisions && nextStore.revisions.workforce || 0,
      users: (nextStore.recipeUsers || []).map(publicRecipeUser),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/recipe-assignments", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.body && req.body.userId || "").trim();
    const category = String(req.body && req.body.category || "").trim();
    const product = String(req.body && req.body.product || "").trim();
    const size = String(req.body && req.body.size || "").trim();
    const assignmentKind = normalizeAssignmentKind(req.body && (req.body.assignmentKind || req.body.assignmentType));
    const assignmentType = normalizeAssignmentType(req.body && req.body.assignmentType);
    const scopeType = normalizeScopeType(req.body && req.body.scopeType);
    const questionCount = normalizeQuestionCount(req.body && req.body.questionCount, assignmentKind === "quick_quiz" ? 3 : 8);
    const difficulty = normalizeDifficulty(req.body && req.body.difficulty);
    const passingScore = normalizePassingScore(req.body && req.body.passingScore);
    const adminNote = String(req.body && req.body.adminNote || "").trim().slice(0, 1000);
    const now = new Date().toISOString();
    let assignment = null;

    const nextStore = await store.update((data) => {
      const user = (data.recipeUsers || []).find((item) => item.id === userId);
      if (!user || user.active === false) {
        const error = new Error("Aktif barista kullanicisi secin.");
        error.status = 400;
        throw error;
      }

      const targets = resolveAssignmentTargets(data, {
        userId,
        scopeType,
        category,
        product,
        size,
        selectedProducts: req.body && req.body.selectedProducts
      });
      if (!targets.length) {
        const error = new Error("Gecerli recete, urun ve olcu secin.");
        error.status = 400;
        throw error;
      }
      const primary = targets[0];
      const title = assignmentTitleFor({ assignmentKind, scopeType, category, product: primary.product, size: primary.size, count: targets.length });
      const needsQuestions = ["quick_quiz", "exam", "retraining"].includes(assignmentKind);
      const questions = needsQuestions
        ? buildRecipeAssignmentQuestions(data.recipeState, {
          targets,
          questionCount,
          difficulty
        })
        : [];
      if (needsQuestions && !questions.length) {
        const error = new Error("Bu kapsam icin yeterli soru uretilemedi.");
        error.status = 400;
        throw error;
      }

      assignment = {
        id: `odev-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`,
        userId: user.id,
        username: user.username,
        name: user.name,
        title,
        category: primary.category,
        product: primary.product,
        size: primary.size,
        assignmentKind,
        assignmentType,
        scopeType,
        recipeItems: targets.map(publicRecipeItem),
        questionCount,
        difficulty,
        passingScore,
        trainingContent: buildAssignmentTrainingContent(data.recipeState, targets, { adminNote }),
        adminNote,
        questions,
        status: "pending",
        score: 0,
        total: questions.length,
        answers: [],
        viewedItems: [],
        completedItems: [],
        failedItems: [],
        percent: 0,
        passed: null,
        startedAt: null,
        completedAt: null,
        reviewedAt: null,
        retryCount: 0,
        createdAt: now,
        updatedAt: now
      };
      data.recipeAssignments = (data.recipeAssignments || []).concat(assignment);
      appendRecipeActivity(data, makeRecipeActivity({
        type: assignmentAssignedEvent(assignmentKind),
        user,
        category: assignment.category,
        product: assignment.product,
        size: assignment.size,
        assignment,
        status: assignment.status,
        req,
        createdAt: now
      }));
      return data;
    });

    res.status(201).json({
      ok: true,
      assignment: publicRecipeAssignment(assignment, true),
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true),
      activity: publicRecipeActivity(nextStore.recipeActivity || [])
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/recipe-assignments/:id", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    const nextStore = await store.update((data) => {
      data.recipeAssignments = (data.recipeAssignments || []).filter((item) => item.id !== id);
      return data;
    });

    res.json({
      ok: true,
      assignments: publicRecipeAssignments(nextStore.recipeAssignments || [], true)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recipe/assignments", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.json({ ok: true, assignments: [] });
    }

    const data = req.storeSnapshot;
    const assignments = (data.recipeAssignments || [])
      .filter((item) => item.userId === payload.userId);
    res.json({
      ok: true,
      assignments: publicRecipeAssignments(assignments, false)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/assignments/:id/start", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.status(403).json({ ok: false, message: "Barista oturumu gerekli." });
    }

    const id = String(req.params.id || "").trim();
    const now = new Date().toISOString();
    let updatedAssignment = null;

    const nextStore = await store.update((data) => {
      const assignment = (data.recipeAssignments || []).find((item) => item.id === id && item.userId === payload.userId);
      if (!assignment) {
        const error = new Error("Odev bulunamadi.");
        error.status = 404;
        throw error;
      }

      if (assignment.status !== "completed") {
        assignment.status = "in_progress";
        assignment.startedAt = assignment.startedAt || now;
        assignment.updatedAt = now;
      }
      updatedAssignment = assignment;

      appendRecipeActivity(data, makeRecipeActivity({
        type: assignmentStartedEvent(assignment.assignmentKind || assignment.assignmentType),
        user: {
          id: payload.userId,
          username: payload.username,
          name: payload.name
        },
        assignment,
        status: assignment.status,
        category: assignment.category,
        product: assignment.product,
        size: assignment.size,
        req,
        createdAt: now
      }));
      return data;
    });

    res.json({
      ok: true,
      assignment: publicRecipeAssignment(updatedAssignment, false),
      assignments: publicRecipeAssignments((nextStore.recipeAssignments || []).filter((item) => item.userId === payload.userId), false)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/assignments/:id/submit", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.status(403).json({ ok: false, message: "Barista oturumu gerekli." });
    }

    const id = String(req.params.id || "").trim();
    const answers = Array.isArray(req.body && req.body.answers)
      ? req.body.answers.map((answer) => Number(answer))
      : [];
    const now = new Date().toISOString();
    let updatedAssignment = null;

    const nextStore = await store.update((data) => {
      const assignment = (data.recipeAssignments || []).find((item) => item.id === id && item.userId === payload.userId);
      if (!assignment) {
        const error = new Error("Odev bulunamadi.");
        error.status = 404;
        throw error;
      }
      if (assignment.status === "completed") {
        const error = new Error("Bu odev zaten tamamlandi.");
        error.status = 400;
        throw error;
      }

      const kind = normalizeAssignmentKind(assignment.assignmentKind || assignment.assignmentType);
      const itemKeys = (assignment.recipeItems || []).map((item) => item.key).filter(Boolean);
      if (kind === "training") {
        assignment.status = "completed";
        assignment.viewedItems = itemKeys;
        assignment.completedItems = itemKeys;
        assignment.percent = 100;
        assignment.passed = true;
        assignment.completedAt = now;
        assignment.updatedAt = now;
        updatedAssignment = assignment;

        appendRecipeActivity(data, makeRecipeActivity({
          type: "training_completed",
          user: {
            id: payload.userId,
            username: payload.username,
            name: payload.name
          },
          assignment,
          status: assignment.status,
          category: assignment.category,
          product: assignment.product,
          size: assignment.size,
          req,
          createdAt: now
        }));
        return data;
      }

      if (kind === "homework") {
        const requestedCompleted = Array.isArray(req.body && req.body.completedItems)
          ? req.body.completedItems.map((item) => String(item || "").trim()).filter(Boolean)
          : itemKeys;
        const allowed = new Set(itemKeys);
        const completedItems = [...new Set(requestedCompleted.filter((item) => allowed.has(item)))];
        assignment.viewedItems = [...new Set((assignment.viewedItems || []).concat(completedItems))];
        assignment.completedItems = completedItems;
        assignment.percent = itemKeys.length ? Math.round((completedItems.length / itemKeys.length) * 100) : 100;
        assignment.status = assignment.percent >= 100 ? "completed" : "in_progress";
        assignment.completedAt = assignment.status === "completed" ? now : null;
        assignment.updatedAt = now;
        updatedAssignment = assignment;

        appendRecipeActivity(data, makeRecipeActivity({
          type: assignment.status === "completed" ? "homework_completed" : "homework_started",
          user: {
            id: payload.userId,
            username: payload.username,
            name: payload.name
          },
          assignment,
          status: assignment.status,
          category: assignment.category,
          product: assignment.product,
          size: assignment.size,
          req,
          createdAt: now
        }));
        return data;
      }

      const normalizedAnswers = assignment.questions.map((_question, index) => {
        const answer = Number(answers[index]);
        return Number.isInteger(answer) ? answer : -1;
      });
      const score = assignment.questions.reduce((total, question, index) => (
        total + (question.correctIndex === normalizedAnswers[index] ? 1 : 0)
      ), 0);
      const total = assignment.questions.length;
      const passingScore = normalizePassingScore(assignment.passingScore);
      const scorePercent = total ? Math.round((score / total) * 100) : 0;
      const passed = scorePercent >= passingScore;
      const failedItems = assignment.questions
        .map((question, index) => question.correctIndex === normalizedAnswers[index] ? null : failedItemFromQuestion(question, normalizedAnswers[index]))
        .filter(Boolean);

      assignment.status = passed ? "completed" : "retry_required";
      assignment.score = score;
      assignment.total = total;
      assignment.passingScore = passingScore;
      assignment.answers = normalizedAnswers;
      assignment.percent = scorePercent;
      assignment.passed = passed;
      assignment.failedItems = failedItems;
      assignment.completedAt = now;
      assignment.updatedAt = now;
      assignment.retryCount = passed ? (assignment.retryCount || 0) : (Number(assignment.retryCount || 0) + 1);
      updatedAssignment = assignment;

      appendRecipeActivity(data, makeRecipeActivity({
        type: assignmentCompletedEvent(kind, passed),
        user: {
          id: payload.userId,
          username: payload.username,
          name: payload.name
        },
        assignment,
        status: assignment.status,
        score,
        total,
        category: assignment.category,
        product: assignment.product,
        size: assignment.size,
        req,
        createdAt: now
      }));
      return data;
    });

    res.json({
      ok: true,
      assignment: publicRecipeAssignment(updatedAssignment, false),
      assignments: publicRecipeAssignments((nextStore.recipeAssignments || []).filter((item) => item.userId === payload.userId), false)
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recipe/activity", requireAdminOrMainRequestOrigin, auth.requireActivePersonel, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const payload = req.recipe || {};
    if (payload.role !== "recipe" || !payload.userId) {
      return res.json({ ok: true });
    }

    await recordRecipeActivity({
      type: String(req.body && req.body.type || "view_recipe").trim().slice(0, 60),
      user: {
        id: payload.userId,
        username: payload.username,
        name: payload.name
      },
      category: req.body && req.body.category,
      product: req.body && req.body.product,
      size: req.body && req.body.size,
      panel: req.body && req.body.panel,
      req
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recipes", requireAdminOrMainRequestOrigin, auth.requireRecipe, requireActiveRecipeUser, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const data = req.storeSnapshot || await store.read();
    res.json({
      ok: true,
      recipeState: data.recipeState,
      recipeCatalog: data.recipeCatalog || [],
      recipeLinkReview: data.recipeLinkReview || [],
      revision: resolveScopeRevision(data, "recipes"),
      publishRevision: data.revisions && data.revisions.publish || 0,
      updatedAt: data.recipeUpdatedAt || null
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/recipes", requireAdminRequestOrigin, auth.requireAdmin, async (req, res, next) => {
  try {
    const recipeState = req.body && req.body.recipeState;
    const requestedCatalog = req.body && req.body.recipeCatalog;
    const validationError = validateRecipeState(recipeState);
    const productCodeError = validateRecipeProductCodes(recipeState);

    if (validationError || productCodeError) {
      return res.status(400).json({ ok: false, message: validationError || productCodeError });
    }

    const recipeCatalog = reconcileRecipeCatalog(recipeState, requestedCatalog);
    const catalogError = validateRecipeCatalog(recipeCatalog, recipeState);
    if (catalogError) {
      return res.status(400).json({ ok: false, message: catalogError });
    }

    const updatedAt = new Date().toISOString();
    const nextStore = await store.update((data) => {
      markManualRecipeStatusChanges(data.recipeState, recipeState);
      data.recipeState = recipeState;
      data.recipeCatalog = recipeCatalog;
      data.revisions.catalog = Math.max(0, Number(data.revisions.catalog || 0)) + 1;
      incrementPublishRevision(data);
      data.recipeUpdatedAt = updatedAt;
      return data;
    });

    broadcastRecipeUpdate(nextStore.recipeState, updatedAt, nextStore.recipeCatalog, nextStore.revisions.catalog);
    broadcastPublicUpdate(nextStore, "recipes");
    res.json({
      ok: true,
      recipeState: nextStore.recipeState,
      recipeCatalog: nextStore.recipeCatalog,
      recipeLinkReview: nextStore.recipeLinkReview,
      catalogRevision: nextStore.revisions.catalog,
      publishRevision: nextStore.revisions.publish,
      updatedAt
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/recipes/events", requireAdminOrMainRequestOrigin, auth.requireRecipe, requireActiveRecipeUser, requirePersonelSection("recipe"), async (req, res, next) => {
  try {
    const data = req.storeSnapshot || await store.read();
    openRevisionStream(req, res, recipeSseClients, "recipes", data, {
      userId: req.recipe && req.recipe.userId || ""
    });
  } catch (error) {
    next(error);
  }
});







function logRuntimeError(error, context = "Backend runtime error") {
  if (!config.isProduction) {
    console.error(context, error);
    return;
  }
  const safe = {
    name: String(error && error.name || "Error").slice(0, 80),
    code: String(error && error.code || "").slice(0, 80),
    status: Number(error && error.status || 500),
    message: sanitizeLogLine(String(error && error.message || "Beklenmeyen hata")).slice(0, 500)
  };
  console.error(context, safe);
}

async function requireActiveRecipeUser(req, res, next) {
  try {
    const payload = req.recipe || {};
    if (payload.role === "admin" || payload.role === "preview") return next();

    const userId = String(payload.userId || payload.sub || "").trim();
    const data = req.storeSnapshot || await store.read();
    const users = Array.isArray(data.recipeUsers) ? data.recipeUsers : [];

    if (!users.length && userId === "recipe") return next();

    const user = users.find((item) => item.id === userId);
    if (!user || user.active === false) {
      await auth.revokeRequestSession(req, ["personel"]);
      auth.clearRecipeCookie(res);
      return res.status(403).json({
        ok: false,
        message: "Recete erisimi pasif. Lutfen yonetici ile gorusun."
      });
    }

    req.recipeUser = user;
    req.recipe = Object.assign({}, payload, {
      userId: user.id,
      username: user.username,
      name: user.name
    });
    return next();
  } catch (error) {
    return next(error);
  }
}

function requirePersonelSection(section) {
  return (req, res, next) => {
    const payload = req.recipe || req.admin || {};
    if (payload.role === "admin" || payload.role === "preview") return next();
    if (!req.recipeUser && payload.role === "recipe" && String(payload.userId || payload.sub || "") === "recipe") return next();
    if (req.recipeUser && hasPersonelSectionAccess(req.recipeUser, section)) return next();
    return res.status(403).json({
      ok: false,
      code: "PERSONEL_SECTION_FORBIDDEN",
      section,
      message: "Bu Personel bölümü için erişim yetkiniz bulunmuyor."
    });
  };
}

function requireAuthenticatedEventSession(req, res, next) {
  const appId = String(req.query && (req.query.appId || req.query.appTarget) || "")
    .trim()
    .toLocaleLowerCase("tr-TR");
  if (!new Set(["yonetici", "personel"]).has(appId)) {
    return res.status(400).json({ ok: false, message: "Geçerli uygulama hedefi gerekli." });
  }
  req.requestedEventAppId = appId;
  if (appId === "yonetici") return auth.requireAdmin(req, res, next);
  if (appId === "personel") return auth.requireActivePersonel(req, res, next);
  return res.status(400).json({ ok: false, message: "Geçerli uygulama hedefi gerekli." });
}

function sanitizeLogLine(value) {
  return String(value || "")
    .replace(/([?&](?:previewToken|token|access_token|session|password|code|secret)=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s",;]+/gi, "$1[REDACTED]")
    .replace(/((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, "$1[REDACTED]");
}







function markManualRecipeStatusChanges(previousState, nextState) {
  for (const [category, products] of Object.entries(nextState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, item] of Object.entries(sizes || {})) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const oldItem = previousState && previousState[category] && previousState[category][product] && previousState[category][product][size];
        if (!oldItem) {
          item.sourceType = "manual";
          item.sourceWorkbook = "";
          item.sourcePresent = true;
          item.statusSource = "manual";
          item.manualActive = item.active !== false;
        } else if (typeof oldItem === "object" && oldItem.active !== item.active) {
          item.statusSource = "manual";
          item.manualActive = item.active !== false;
          if (!item.sourceType) item.sourceType = "manual";
        }
      }
    }
  }
}

function incrementPublishRevision(data) {
  if (!data.revisions || typeof data.revisions !== "object" || Array.isArray(data.revisions)) {
    data.revisions = { publish: 0, pricing: 0 };
  }
  data.revisions.publish = Number(data.revisions.publish || 0) + 1;
  return data.revisions.publish;
}

function broadcastRecipeUpdate(_recipeState, updatedAt, _recipeCatalog = [], revision = 0) {
  broadcastScopeInvalidation(recipeSseClients, "recipes", "recipes", { updatedAt });
  publishAuthenticatedEvent({ topic: "catalog", type: "recipe.updated", entityType: "recipe", revision, timestamp: updatedAt, targets: ["personel", "yonetici"] });
}

function closeRecipeClientsForUser(userId) {
  const targetId = String(userId || "").trim();
  if (!targetId) return;

  for (const client of Array.from(recipeSseClients)) {
    if (client.userId !== targetId) continue;
    try {
      const revision = nextScopeRevision("recipes", Date.now());
      sendSse(client.res, "recipes", {
        revision,
        scope: "recipes",
        action: "revoked",
        requiresRefetch: false,
        revoked: true,
        updatedAt: new Date().toISOString()
      }, { id: revision });
    } catch (_error) {}
    closeRevisionClient(client, recipeSseClients);
  }
}



function queueAppNotification(data, pending, input) {
  try {
    const notification = notificationService.createNotificationInStore(data, input);
    const created = typeof notificationService.notificationsFromResult === "function"
      ? notificationService.notificationsFromResult(notification) : notification ? [notification] : [];
    for (const item of created) if (!pending.includes(item)) pending.push(item);
    return notification;
  } catch (error) {
    logRuntimeError(error, "Bildirim kaydı oluşturulamadı");
    return null;
  }
}

function publishAppNotifications(pending) {
  for (const notification of pending) {
    try {
      notificationService.publishNotificationEvent(notification);
    } catch (error) {
      logRuntimeError(error, "Bildirim SSE olayı yayınlanamadı");
    }
  }
}





function suspendPersonnelNotificationDelivery(data, userId, updatedAt) {
  const recipientId = String(userId || "").trim();
  if (!recipientId) return;
  data.pushSubscriptions = (Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [])
    .filter((item) => !(item && item.ownerRole === "personnel" && String(item.ownerId) === recipientId));
  data.notificationOutbox = (Array.isArray(data.notificationOutbox) ? data.notificationOutbox : []).map((item) => {
    if (!item
      || item.recipientRole !== "personnel"
      || String(item.recipientId) !== recipientId
      || item.status === "sent"
      || item.status === "cancelled") return item;
    return {
      ...item,
      status: "cancelled",
      lockedAt: null,
      nextAttemptAt: null,
      lastError: "Personel hesabı aktif olmadığı için teslim durduruldu.",
      updatedAt
    };
  });
}

function sendSse(res, event, payload, options = {}) {
  if (options.id !== undefined && options.id !== null && String(options.id)) {
    res.write(`id: ${String(options.id).replace(/[\r\n]/g, "")}\n`);
  }
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function openAuthenticatedEventStream(req, res) {
  const payload = req.recipe || req.admin || {};
  const role = String(payload.role || payload.sessionRole || "personel").toLocaleLowerCase("tr-TR");
  const appId = String(req.requestedEventAppId || "personel");
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity"
  });
  if (res.socket) res.socket.setTimeout(0);
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);
  const ready = canonicalEventEnvelope({ topic: "system", type: "system.ready", entityType: "session", targets: [appId] });
  sendSse(res, "event", ready, { id: ready.eventId });
  const client = {
    res,
    appId,
    actorId: String(payload.userId || payload.sub || role),
    heartbeat: setInterval(() => {
      if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS)
  };
  if (typeof client.heartbeat.unref === "function") client.heartbeat.unref();
  authenticatedEventClients.add(client);
  req.once("close", () => closeRevisionClient(client, authenticatedEventClients, false));
}

function canonicalEventEnvelope(input = {}) {
  const targets = Array.from(new Set((Array.isArray(input.targets) ? input.targets : [])
    .map((item) => String(item || "").trim().toLocaleLowerCase("tr-TR"))
    .filter((item) => ["yonetici", "personel", "public"].includes(item))));
  const revision = Math.max(0, Math.trunc(Number(input.revision || 0)));
  return {
    eventId: String(input.eventId || `evt-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`),
    topic: String(input.topic || "system").slice(0, 60),
    type: String(input.type || "system.updated").slice(0, 120),
    entityType: String(input.entityType || "").slice(0, 100),
    entityId: String(input.entityId || "").slice(0, 180),
    revision,
    actorId: String(input.actorId || "").slice(0, 180),
    timestamp: input.timestamp || new Date().toISOString(),
    targets
  };
}

function publishAuthenticatedEvent(input = {}) {
  const envelope = canonicalEventEnvelope(input);
  for (const client of authenticatedEventClients) {
    if (!client || !client.res || client.res.writableEnded) continue;
    if (envelope.targets.length && !envelope.targets.includes(client.appId)) continue;
    sendSse(client.res, "event", envelope, { id: envelope.eventId });
  }
  return envelope;
}

function openRevisionStream(req, res, clients, scope, data, clientData = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity"
  });
  if (res.socket) res.socket.setTimeout(0);
  res.write(`retry: ${SSE_RETRY_MS}\n\n`);

  const revision = seedScopeRevision(scope, resolveScopeRevision(data, scope));
  const lastEventId = parseLastEventId(req);
  sendSse(res, "ready", {
    eventId: `${scope}:${revision}`,
    topic: scope === "public" ? "site" : scope === "menu" || scope === "recipes" ? "catalog" : scope,
    type: `${scope}.ready`,
    entityType: scope,
    entityId: "",
    revision,
    actorId: "",
    timestamp: new Date().toISOString(),
    targets: scope === "public" ? ["public"] : [],
    scope,
    action: "ready",
    requiresRefetch: lastEventId > 0 && lastEventId < revision
  }, { id: revision });

  const clientId = cleanSseClientId(req.query && req.query.clientId);
  if (clientId) {
    for (const existing of Array.from(clients)) {
      if (existing.clientId !== clientId) continue;
      closeRevisionClient(existing, clients);
    }
  }

  const client = {
    ...clientData,
    res,
    clientId,
    heartbeat: setInterval(() => {
      if (!res.writableEnded) res.write(`: heartbeat ${Date.now()}\n\n`);
    }, SSE_HEARTBEAT_MS)
  };
  if (typeof client.heartbeat.unref === "function") client.heartbeat.unref();
  clients.add(client);
  req.once("close", () => closeRevisionClient(client, clients, false));
  return client;
}

function broadcastScopeInvalidation(clients, scope, event, options = {}) {
  const revision = nextScopeRevision(scope, options.revision || Date.parse(options.updatedAt || ""));
  const payload = {
    eventId: `${scope}:${revision}`,
    topic: scope === "public" ? "site" : scope === "menu" || scope === "recipes" ? "catalog" : scope,
    type: `${scope}.${options.action || "invalidate"}`,
    entityType: scope,
    entityId: "",
    revision,
    actorId: String(options.actorId || ""),
    timestamp: options.updatedAt || new Date().toISOString(),
    targets: scope === "public" ? ["public"] : [],
    scope,
    action: options.action || "invalidate",
    changedIds: Array.isArray(options.changedIds) ? options.changedIds.slice(0, 50).map((id) => String(id).slice(0, 120)) : [],
    requiresRefetch: options.requiresRefetch !== false,
    updatedAt: options.updatedAt || new Date().toISOString()
  };
  rememberScopeEvent(scope, event, payload);
  for (const client of clients) {
    if (!client || !client.res || client.res.writableEnded) continue;
    sendSse(client.res, event, payload, { id: revision });
  }
  return payload;
}

function resolveScopeRevision(data, scope) {
  const updatedAt = {
    menu: data && data.menuUpdatedAt,
    recipes: data && data.recipeUpdatedAt,
    public: data && (data.siteUpdatedAt || data.menuUpdatedAt),
    feedback: data && data.feedbackUpdatedAt
  }[scope];
  const timestamp = Date.parse(updatedAt || "");
  if (Number.isSafeInteger(timestamp) && timestamp > 0) return timestamp;
  const revisions = data && data.revisions || {};
  if (scope === "workforce") return Math.max(0, Number(revisions.workforce || 0));
  if (scope === "menu") return Math.max(0, Number(revisions.publish || 0), Number(revisions.pricing || 0));
  return Math.max(0, Number(revisions.publish || 0));
}





function currentCatalogRevision(data) {
  const revisions = data && data.revisions || {};
  return Math.max(0, Number(revisions.catalog || 0));
}

function seedScopeRevision(scope, revision) {
  const state = scopeStreamState(scope);
  const numeric = Number(revision || 0);
  if (Number.isSafeInteger(numeric) && numeric > state.revision) state.revision = numeric;
  return state.revision;
}

function nextScopeRevision(scope, hint) {
  const state = scopeStreamState(scope);
  const numericHint = Number(hint || 0);
  state.revision = Number.isSafeInteger(numericHint) && numericHint > state.revision
    ? numericHint
    : state.revision + 1;
  return state.revision;
}

function rememberScopeEvent(scope, event, payload) {
  const state = scopeStreamState(scope);
  state.history.push({ event, payload });
  if (state.history.length > SSE_HISTORY_LIMIT) state.history.splice(0, state.history.length - SSE_HISTORY_LIMIT);
}

function scopeStreamState(scope) {
  if (!sseStreamState.has(scope)) sseStreamState.set(scope, { revision: 0, history: [] });
  return sseStreamState.get(scope);
}

function parseLastEventId(req) {
  const value = String(req.get && req.get("last-event-id") || "").split(":").pop();
  const revision = Number(value || 0);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function cleanSseClientId(value) {
  const id = String(value || "").trim();
  return /^[a-z0-9._:-]{8,128}$/i.test(id) ? id : "";
}

function closeRevisionClient(client, clients, end = true) {
  if (!client) return;
  if (client.heartbeat) clearInterval(client.heartbeat);
  clients.delete(client);
  if (end) {
    try { if (client.res && !client.res.writableEnded) client.res.end(); } catch (_error) {}
  }
}

function validateRecipeUserInput({ name, username, password, requirePassword }) {
  if (!name || name.length < 2) return "Ad soyad en az 2 karakter olmali.";
  if (!username || username.length < 3) return "Kullanici adi en az 3 karakter olmali.";
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return "Kullanici adi sadece kucuk harf, rakam, nokta, tire veya alt tire icermeli.";
  }
  if (requirePassword || password) {
    return validatePassword(password);
  }
  return "";
}

function normalizeRecipeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);
}

function publicRecipeUser(user) {
  if (!user) return null;
  const security = publicAccountSecurity(user);
  return {
    id: user.id,
    name: user.name || user.username,
    jobTitle: String(user.jobTitle || ""),
    username: user.username,
    avatarUrl: user.avatarUrl || "",
    bio: user.bio || "",
    appearance: panelTheme.normalizeAppearance(user.appearance),
    active: user.active !== false,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    email: security.email,
    pendingEmail: security.pendingEmail,
    emailVerifiedAt: security.emailVerifiedAt,
    emailVerificationRequired: security.emailVerificationRequired,
    lastPasswordResetAt: security.lastPasswordResetAt,
    personelSectionAccess: normalizePersonelSectionAccess(user.personelSectionAccess),
    security
  };
}

function publicRecipeActivity(items) {
  return (items || []).slice(-300).reverse().map((item) => ({
    id: item.id,
    type: item.type,
    userId: item.userId || "",
    username: item.username || "",
    name: item.name || "",
    category: item.category || "",
    product: item.product || "",
    size: item.size || "",
    panel: item.panel || "",
    assignmentId: item.assignmentId || "",
    assignmentTitle: item.assignmentTitle || "",
    assignmentKind: item.assignmentKind || "",
    status: item.status || "",
    score: Number(item.score || 0) || 0,
    total: Number(item.total || 0) || 0,
    createdAt: item.createdAt || null
  }));
}

function publicRecipeAssignments(items, includeAnswers) {
  return (items || []).slice().reverse().map((item) => publicRecipeAssignment(item, includeAnswers));
}

function publicRecipeAssignment(item, includeAnswers) {
  if (!item) return null;
  return {
    id: item.id,
    userId: item.userId,
    username: item.username || "",
    name: item.name || "",
    title: item.title || `${item.product || "Recete"} / ${item.size || ""}`,
    category: item.category || "",
    product: item.product || "",
    size: item.size || "",
    assignmentKind: normalizeAssignmentKind(item.assignmentKind || item.assignmentType),
    assignmentType: normalizeAssignmentType(item.assignmentType),
    scopeType: normalizeScopeType(item.scopeType),
    recipeItems: normalizeRecipeItemsForPublic(item.recipeItems, item),
    questionCount: normalizeQuestionCount(item.questionCount, (item.questions || []).length || 3),
    difficulty: normalizeDifficulty(item.difficulty),
    passingScore: normalizePassingScore(item.passingScore),
    trainingContent: normalizeTrainingContent(item.trainingContent),
    adminNote: item.adminNote || "",
    status: normalizeAssignmentStatus(item.status),
    score: Number(item.score || 0) || 0,
    total: Number(item.total || (item.questions || []).length) || 0,
    answers: includeAnswers ? (item.answers || []) : undefined,
    viewedItems: item.viewedItems || [],
    completedItems: item.completedItems || [],
    failedItems: item.failedItems || [],
    percent: Number(item.percent || 0) || 0,
    passed: typeof item.passed === "boolean" ? item.passed : null,
    startedAt: item.startedAt || null,
    completedAt: item.completedAt || null,
    reviewedAt: item.reviewedAt || null,
    retryCount: Number(item.retryCount || 0) || 0,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    questions: (item.questions || []).map((question) => ({
      text: question.text,
      options: question.options,
      category: question.category || "",
      product: question.product || "",
      size: question.size || "",
      key: question.key || "",
      questionType: question.questionType || "",
      correctIndex: includeAnswers ? question.correctIndex : undefined
    }))
  };
}

async function recordRecipeActivity({ type, user, username, category, product, size, panel, assignment, status, score, total, req, createdAt }) {
  await store.update((data) => {
    appendRecipeActivity(data, makeRecipeActivity({
      type,
      user,
      username,
      category,
      product,
      size,
      panel,
      assignment,
      status,
      score,
      total,
      req,
      createdAt
    }));
    return data;
  });
}

function appendRecipeActivity(data, item) {
  data.recipeActivity = (data.recipeActivity || []).concat(item).slice(-RECIPE_ACTIVITY_LIMIT);
}

function makeRecipeActivity({ type, user, username, category, product, size, panel, assignment, status, score, total, req, createdAt }) {
  const source = user && typeof user === "object" ? user : {};
  const assignmentSource = assignment && typeof assignment === "object" ? assignment : {};
  return {
    id: `activity-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    type: String(type || "activity").trim().slice(0, 60),
    userId: String(source.id || source.userId || "").trim(),
    username: normalizeRecipeUsername(source.username || username),
    name: String(source.name || "").trim().slice(0, 80),
    category: String(category || "").trim().slice(0, 160),
    product: String(product || "").trim().slice(0, 160),
    size: String(size || "").trim().slice(0, 80),
    panel: String(panel || "").trim().slice(0, 40),
    assignmentId: String(assignmentSource.id || "").trim().slice(0, 80),
    assignmentTitle: String(assignmentSource.title || assignmentSource.product || "").trim().slice(0, 160),
    assignmentKind: assignmentSource.assignmentKind ? normalizeAssignmentKind(assignmentSource.assignmentKind || assignmentSource.assignmentType) : "",
    status: status || assignmentSource.status ? normalizeAssignmentStatus(status || assignmentSource.status) : "",
    score: Math.max(0, Number(score || assignmentSource.score || 0) || 0),
    total: Math.max(0, Number(total || assignmentSource.total || 0) || 0),
    ip: req ? String(req.ip || "").slice(0, 80) : "",
    userAgent: req ? String(req.get("User-Agent") || "").slice(0, 220) : "",
    createdAt: createdAt || new Date().toISOString()
  };
}

function syncRecipeUserReferences(data, user) {
  (data.recipeAssignments || []).forEach((item) => {
    if (item.userId !== user.id) return;
    item.username = user.username;
    item.name = user.name;
  });
  (data.recipeActivity || []).forEach((item) => {
    if (item.userId !== user.id) return;
    item.username = user.username;
    item.name = user.name;
  });
}

function normalizeAssignmentType(value) {
  const type = String(value || "").trim();
  if (type === "training_quiz" || type === "retraining") return type;
  return "quiz";
}

function normalizeAssignmentKind(value) {
  const kind = String(value || "").trim();
  if (["quick_quiz", "training", "homework", "exam", "retraining"].includes(kind)) return kind;
  if (kind === "training_quiz") return "retraining";
  return "quick_quiz";
}

function normalizeScopeType(value) {
  const scopeType = String(value || "").trim();
  if (["all", "category", "products", "failed_items"].includes(scopeType)) return scopeType;
  return "products";
}

function normalizeQuestionCount(value, fallback) {
  const count = Number(value);
  if (!Number.isFinite(count)) return Math.max(1, Math.min(30, Number(fallback || 3) || 3));
  return Math.max(1, Math.min(30, Math.round(count)));
}

function normalizeDifficulty(value) {
  const difficulty = String(value || "").trim();
  if (["easy", "normal", "hard"].includes(difficulty)) return difficulty;
  return "normal";
}

function normalizeAssignmentStatus(value) {
  const status = String(value || "").trim();
  if (["pending", "in_progress", "completed", "failed", "retry_required"].includes(status)) {
    return status;
  }
  return "pending";
}

function normalizePassingScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 70;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function normalizeTrainingContent(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    generatedFromRecipe: source.generatedFromRecipe !== false,
    productName: String(source.productName || "").trim().slice(0, 160),
    category: String(source.category || "").trim().slice(0, 160),
    size: String(source.size || "").trim().slice(0, 80),
    shortDescription: String(source.shortDescription || "").trim().slice(0, 600),
    criticalMeasures: normalizeTextList(source.criticalMeasures, 8, 180),
    preparationSteps: normalizeTextList(source.preparationSteps, 12, 220),
    cautions: normalizeTextList(source.cautions, 8, 220),
    commonMistakes: normalizeTextList(source.commonMistakes, 8, 220),
    adminNote: String(source.adminNote || "").trim().slice(0, 1000),
    items: normalizeTrainingItems(source.items)
  };
}

function normalizeTextList(value, limit, itemLimit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim().slice(0, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeTrainingItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const category = String(source.category || "").trim().slice(0, 160);
      const product = String(source.product || "").trim().slice(0, 160);
      const size = String(source.size || "").trim().slice(0, 80);
      if (!category || !product || !size) return null;
      return {
        key: source.key || recipeItemKey({ category, product, size }),
        category,
        product,
        size,
        content: normalizeTextList(source.content, 12, 220),
        preparation: normalizeTextList(source.preparation, 12, 220)
      };
    })
    .filter(Boolean)
    .slice(0, 120);
}

function splitTrainingText(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  return text
    .split(/\n+|;\s+|\s+-\s+|\s+\+\s+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function resolveAssignmentTargets(data, options) {
  const recipeState = data.recipeState || {};
  const allEntries = recipeEntries(recipeState);
  const scopeType = normalizeScopeType(options.scopeType);
  let targets = [];

  if (scopeType === "all") {
    targets = allEntries;
  } else if (scopeType === "category") {
    targets = allEntries.filter((item) => item.category === options.category);
  } else if (scopeType === "failed_items") {
    const failedKeys = new Set();
    (data.recipeAssignments || []).forEach((assignment) => {
      if (assignment.userId !== options.userId) return;
      (assignment.failedItems || []).forEach((item) => {
        if (item && item.key) failedKeys.add(item.key);
        else if (item) failedKeys.add(recipeItemKey(item));
      });
    });
    targets = allEntries.filter((item) => failedKeys.has(item.key));
  } else {
    const selected = normalizeSelectedProducts(options.selectedProducts);
    if (!selected.length && options.category && options.product && options.size) {
      selected.push({
        category: options.category,
        product: options.product,
        size: options.size
      });
    }
    const selectedKeys = new Set(selected.map(recipeItemKey));
    targets = allEntries.filter((item) => selectedKeys.has(item.key));
  }

  return uniqueRecipeEntries(targets);
}

function recipeEntries(recipeState) {
  const entries = [];
  for (const [category, products] of Object.entries(recipeState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, recipe] of Object.entries(sizes || {})) {
        if (!category || !product || !size) continue;
        entries.push({
          key: recipeItemKey({ category, product, size }),
          category,
          product,
          size,
          recipe
        });
      }
    }
  }
  return entries;
}

function normalizeSelectedProducts(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const source = item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const category = String(source.category || "").trim();
      const product = String(source.product || "").trim();
      const size = String(source.size || "").trim();
      return category && product && size ? { category, product, size } : null;
    })
    .filter(Boolean)
    .slice(0, 120);
}

function uniqueRecipeEntries(entries) {
  const seen = new Set();
  return (entries || []).filter((item) => {
    if (!item || !item.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

function publicRecipeItem(item) {
  return {
    key: item.key || recipeItemKey(item),
    category: item.category || "",
    product: item.product || "",
    size: item.size || ""
  };
}

function recipeItemKey(item) {
  return [item.category, item.product, item.size].map((part) => String(part || "").trim()).join("::");
}

function normalizeRecipeItemsForPublic(items, fallback) {
  const normalized = Array.isArray(items)
    ? items.map((item) => {
      const source = item && typeof item === "object" ? item : {};
      const category = String(source.category || "").trim();
      const product = String(source.product || "").trim();
      const size = String(source.size || "").trim();
      return category && product && size ? publicRecipeItem({ category, product, size }) : null;
    }).filter(Boolean)
    : [];
  if (normalized.length) return normalized;
  if (fallback && fallback.category && fallback.product && fallback.size) {
    return [publicRecipeItem(fallback)];
  }
  return [];
}

function assignmentTitleFor({ assignmentKind, scopeType, category, product, size, count }) {
  const kindLabel = {
    quick_quiz: "Hizli Quiz",
    training: "Egitim Paketi",
    homework: "Calisma Odevi",
    exam: "Hakimiyet Sinavi",
    retraining: "Tekrar Egitimi"
  }[assignmentKind] || "Gorev";
  if (scopeType === "all") return `${kindLabel} / Tum receteler`;
  if (scopeType === "category") return `${kindLabel} / ${category || "Kategori"}`;
  if (count > 1) return `${kindLabel} / ${count} recete`;
  return `${kindLabel} / ${product || "Recete"} / ${size || ""}`.trim();
}

function buildAssignmentTrainingContent(recipeState, targets, options = {}) {
  return {
    generatedFromRecipe: true,
    productName: targets.length === 1 ? targets[0].product : `${targets.length} recete`,
    category: targets.length === 1 ? targets[0].category : "Karma",
    size: targets.length === 1 ? targets[0].size : "Coklu",
    shortDescription: "Bu egitim icerigi recete verisinden otomatik olusturuldu.",
    criticalMeasures: targets.map((item) => `${item.product} / ${item.size}`).slice(0, 12),
    preparationSteps: targets.flatMap((item) => {
      const recipe = normalizeRecipeForQuestion(item.recipe);
      return splitTrainingText(recipe.preparation).map((step) => `${item.product}: ${step}`);
    }).slice(0, 18),
    cautions: ["Belirsiz / Yönetici tarafından tamamlanmalı"],
    commonMistakes: ["Belirsiz / Yönetici tarafından tamamlanmalı"],
    adminNote: String(options.adminNote || "").trim().slice(0, 1000),
    items: targets.map((item) => {
      const recipe = normalizeRecipeForQuestion(recipeState[item.category][item.product][item.size]);
      return {
        key: item.key,
        category: item.category,
        product: item.product,
        size: item.size,
        content: splitTrainingText(recipe.content),
        preparation: splitTrainingText(recipe.preparation),
        note: splitTrainingText(recipe.note)
      };
    })
  };
}

function assignmentAssignedEvent(kind) {
  return {
    quick_quiz: "assignment_created",
    training: "training_assigned",
    homework: "homework_assigned",
    exam: "exam_assigned",
    retraining: "retry_training_suggested"
  }[normalizeAssignmentKind(kind)] || "assignment_created";
}

function assignmentStartedEvent(kind) {
  return {
    quick_quiz: "assignment_started",
    training: "training_started",
    homework: "homework_started",
    exam: "exam_started",
    retraining: "training_started"
  }[normalizeAssignmentKind(kind)] || "assignment_started";
}

function assignmentCompletedEvent(kind, passed) {
  if (normalizeAssignmentKind(kind) === "exam") return passed ? "exam_completed" : "exam_failed";
  if (normalizeAssignmentKind(kind) === "retraining") return passed ? "training_completed" : "exam_failed";
  return passed ? "assignment_completed" : "assignment_retry_required";
}

function buildRecipeAssignmentQuestions(recipeState, target) {
  const targets = uniqueRecipeEntries((target.targets || []).length ? target.targets : recipeEntries(recipeState).slice(0, 1));
  const allEntries = recipeEntries(recipeState);
  const questionCount = normalizeQuestionCount(target.questionCount, 3);
  const questionPool = [];

  targets.forEach((entry) => {
    const recipe = normalizeRecipeForQuestion(entry.recipe);
    const contentTerms = extractQuestionTerms(recipe.content);
    const preparationTerms = extractQuestionTerms(recipe.preparation);
    const otherTerms = collectRecipeQuestionTerms(recipeState, entry);
    const otherProducts = collectRecipeProducts(recipeState, entry);

    if (contentTerms.length) {
      questionPool.push(makeQuestion(
        `${entry.product} / ${entry.size} icin dogru icerik hangisidir?`,
        contentTerms[0],
        otherTerms,
        entry,
        "content"
      ));
      questionPool.push(makeQuestion(
        `${entry.product} / ${entry.size} recetesinde eksik kalan icerik hangisidir?`,
        contentTerms[contentTerms.length > 1 ? 1 : 0],
        otherTerms,
        entry,
        "missing_content"
      ));
      const wrongTerm = otherTerms.find((term) => !contentTerms.some((item) => normalizeComparable(item) === normalizeComparable(term)));
      if (wrongTerm) {
        questionPool.push(makeQuestion(
          `${entry.product} / ${entry.size} icin yanlis icerik hangisidir?`,
          wrongTerm,
          contentTerms,
          entry,
          "wrong_content"
        ));
      }
      questionPool.push(makeQuestion(
        `"${contentTerms[0]}" icerigi hangi urune aittir?`,
        entry.product,
        otherProducts,
        entry,
        "content_to_product"
      ));
      questionPool.push(makeTrueFalseQuestion(
        `${entry.product} / ${entry.size} recetesinde "${contentTerms[0]}" bilgisi dogrudur.`,
        true,
        entry,
        "true_false_recipe"
      ));
    }

    if (preparationTerms.length) {
      questionPool.push(makeQuestion(
        `${entry.product} / ${entry.size} hazirlanisinda dogru adim hangisidir?`,
        preparationTerms[0],
        otherTerms.concat(contentTerms),
        entry,
        "preparation"
      ));
      questionPool.push(makeQuestion(
        `"${preparationTerms[0]}" hazirlanis adimi hangi urune aittir?`,
        entry.product,
        otherProducts,
        entry,
        "preparation_to_product"
      ));
    }
  });

  while (questionPool.filter(Boolean).length < questionCount && allEntries.length) {
    const entry = allEntries[questionPool.length % allEntries.length];
    questionPool.push(makeQuestion(
      `${entry.product} / ${entry.size} icin dogru recete bilgisi hangisidir?`,
      entry.product,
      collectRecipeProducts(recipeState, entry),
      entry,
      "recipe_product"
    ));
  }

  return orderQuestionsForDifficulty(questionPool.filter(Boolean), target.difficulty).slice(0, questionCount);
}

function orderQuestionsForDifficulty(questions, difficulty) {
  const level = normalizeDifficulty(difficulty);
  if (level === "normal") return shuffle(questions);
  const priority = level === "easy"
    ? ["content", "preparation", "true_false_recipe", "missing_content"]
    : ["wrong_content", "content_to_product", "preparation_to_product", "missing_content"];
  const rank = (question) => {
    const index = priority.indexOf(question.questionType);
    return index === -1 ? priority.length : index;
  };
  return shuffle(questions).sort((a, b) => rank(a) - rank(b));
}

function makeQuestion(text, correct, candidates, target, questionType) {
  const correctText = String(correct || "").trim();
  if (!correctText) return null;

  const fallback = [
    "Double shot espresso",
    "Soguk sut",
    "Buz",
    "3 dakika",
    "Krema",
    "Filtre kahve",
    "Kakao"
  ];
  const options = uniqueStrings([correctText].concat(candidates || [], fallback))
    .filter((item) => normalizeComparable(item) !== normalizeComparable(correctText))
    .slice(0, 2);

  while (options.length < 2) {
    options.push(`Secenek ${options.length + 2}`);
  }

  const allOptions = shuffle([correctText].concat(options)).slice(0, 3);
  return {
    text,
    options: allOptions,
    correctIndex: allOptions.findIndex((item) => normalizeComparable(item) === normalizeComparable(correctText)),
    category: target && target.category || "",
    product: target && target.product || "",
    size: target && target.size || "",
    key: target && target.key || "",
    questionType: questionType || ""
  };
}

function makeTrueFalseQuestion(text, correct, target, questionType) {
  return {
    text,
    options: ["Dogru", "Yanlis", "Belirsiz"],
    correctIndex: correct ? 0 : 1,
    category: target && target.category || "",
    product: target && target.product || "",
    size: target && target.size || "",
    key: target && target.key || "",
    questionType: questionType || "true_false_recipe"
  };
}

function failedItemFromQuestion(question, selectedIndex) {
  if (!question || !question.category || !question.product || !question.size) return null;
  const options = Array.isArray(question.options) ? question.options : [];
  return {
    key: question.key || recipeItemKey(question),
    category: question.category,
    product: question.product,
    size: question.size,
    question: question.text || "",
    selected: options[Number(selectedIndex)] || "",
    correct: options[Number(question.correctIndex)] || ""
  };
}

function normalizeRecipeForQuestion(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const preparation = String(value.preparation || value.method || value.steps || value.description || "").trim();
    return {
      content: String(value.content || value.recipe || value.ingredients || "").trim(),
      preparation,
      note: String(value.note || value.productNote || "").trim()
    };
  }
  return {
    content: String(value || "").trim(),
    preparation: "",
    note: ""
  };
}

function collectRecipeQuestionTerms(recipeState, target) {
  const terms = [];
  for (const [category, products] of Object.entries(recipeState || {})) {
    for (const [product, sizes] of Object.entries(products || {})) {
      for (const [size, recipe] of Object.entries(sizes || {})) {
        if (category === target.category && product === target.product && size === target.size) continue;
        const item = normalizeRecipeForQuestion(recipe);
        terms.push(...extractQuestionTerms(item.content), ...extractQuestionTerms(item.preparation));
      }
    }
  }
  return terms;
}

function collectRecipeProducts(recipeState, target) {
  const products = [];
  for (const categoryProducts of Object.values(recipeState || {})) {
    products.push(...Object.keys(categoryProducts || {}));
  }
  return products.filter((product) => product !== target.product);
}

function extractQuestionTerms(text) {
  return uniqueStrings(String(text || "")
    .split(/\n+|;|\+|\s+-\s+|,|\//g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 80)
    .filter((part) => !/kaynakta yok|hen.?z girilmedi/i.test(part)))
    .slice(0, 8);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  (values || []).forEach((value) => {
    const text = String(value || "").trim();
    const key = normalizeComparable(text);
    if (!text || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function normalizeComparable(value) {
  return String(value || "").trim().toLocaleLowerCase("tr-TR");
}

function shuffle(values) {
  const list = values.slice();
  for (let index = list.length - 1; index > 0; index -= 1) {
    const next = crypto.randomInt(0, index + 1);
    [list[index], list[next]] = [list[next], list[index]];
  }
  return list;
}

function validateProfileAvatarUpload(req) {
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) {
    const error = new Error("Profil fotoğrafı gerekli.");
    error.status = 400;
    throw error;
  }
  if (body.length > 10 * 1024 * 1024) {
    const error = new Error("Profil fotoğrafı en fazla 10 MB olabilir.");
    error.status = 413;
    throw error;
  }

  const contentType = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const originalName = decodeHeaderValue(req.header("X-File-Name")) || "profile";
  const extByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
  };
  const extByName = path.extname(originalName).toLowerCase() === ".jpeg"
    ? ".jpg"
    : path.extname(originalName).toLowerCase();
  const ext = extByMime[contentType] || extByName;

  if (![".jpg", ".png", ".webp"].includes(ext) || !extByMime[contentType]) {
    const error = new Error("JPG, PNG veya WEBP profil fotoğrafı yükleyin.");
    error.status = 400;
    throw error;
  }
  if (!extByName || extByName !== ext) {
    const error = new Error("Dosya uzantısı ile MIME türü uyuşmuyor.");
    error.status = 400;
    throw error;
  }
  if (!matchesMediaSignature(body, ext)) {
    const error = new Error("Dosya içeriği profil fotoğrafı formatıyla uyuşmuyor.");
    error.status = 400;
    throw error;
  }

  return {
    contentType,
    fileName: `profile-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`
  };
}

function validateMaterialRequestImageUpload(req) {
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) {
    const error = new Error("Malzeme görseli gerekli.");
    error.status = 400;
    throw error;
  }
  if (body.length > 10 * 1024 * 1024) {
    const error = new Error("Malzeme görseli en fazla 10 MB olabilir.");
    error.status = 413;
    throw error;
  }
  const contentType = String(req.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const originalName = decodeHeaderValue(req.header("X-File-Name")) || "malzeme";
  const extByMime = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
  const extByName = path.extname(originalName).toLowerCase() === ".jpeg" ? ".jpg" : path.extname(originalName).toLowerCase();
  const ext = extByMime[contentType] || extByName;
  if (!extByMime[contentType] || ![".jpg", ".png", ".webp"].includes(ext) || extByName !== ext || !matchesMediaSignature(body, ext)) {
    const error = new Error("JPG, PNG veya WEBP malzeme görseli yükleyin.");
    error.status = 400;
    throw error;
  }
  return {
    contentType,
    fileName: `material-request-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`
  };
}

async function removeOldProfileAvatar(oldAvatarPath, nextAvatarPath) {
  const oldName = path.basename(String(oldAvatarPath || ""));
  if (!oldName || oldAvatarPath === nextAvatarPath || !oldAvatarPath.startsWith("/media/profile-") || !isSafeMediaFileName(oldName)) return;
  try {
    await fs.unlink(path.join(config.mediaDir, oldName));
  } catch (_error) {}
}

function matchesMediaSignature(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (extension === ".jpg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === ".gif") return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  if (extension === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (extension === ".mp4") return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  if (extension === ".webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

function isSafeMediaFileName(value) {
  const name = String(value || "");
  return /^[a-z0-9][a-z0-9._-]{2,180}$/i.test(name)
    && path.basename(name) === name
    && new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm"]).has(path.extname(name).toLowerCase());
}

function decodeHeaderValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (_error) {
    return text;
  }
}

function absoluteUrl(req, pathname) {
  const origin = req.header("Origin");
  if (origin) {
    try {
      return new URL(pathname, origin).toString();
    } catch (_error) {}
  }

  return `${req.protocol}://${req.get("host")}${pathname}`;
}

function revokeStoredSessions(data, predicate, revokedAt = new Date().toISOString()) {
  data.authSessions = (Array.isArray(data.authSessions) ? data.authSessions : []).map((session) => {
    if (!session || session.revokedAt || !predicate(session)) return session;
    return { ...session, revokedAt };
  });
}

function workforceLifecycleRequestId(req) {
  const value = String(
    req.header("Idempotency-Key")
    || req.header("X-Request-ID")
    || req.body && req.body.requestId
    || ""
  ).trim().slice(0, 160);
  if (value && !/^[a-zA-Z0-9._:-]{8,160}$/.test(value)) {
    const error = new Error("Geçerli bir requestId veya Idempotency-Key gerekli.");
    error.status = 400;
    throw error;
  }
  return value;
}

function lifecycleReplay(data, operation, requestId) {
  if (!requestId) return null;
  const entries = Array.isArray(data.idempotencyRequests) ? data.idempotencyRequests : [];
  const match = entries.find((item) => item && item.scope === "personnel_lifecycle" && item.operation === operation && item.requestId === requestId);
  if (match) return match.response || null;
  if (entries.some((item) => item && item.scope === "personnel_lifecycle" && item.requestId === requestId)) {
    const error = new Error("Bu requestId daha önce farklı bir personel işlemi için kullanıldı.");
    error.status = 409;
    throw error;
  }
  return null;
}

function assertLifecycleExpectedRevision(data, body) {
  if (!body || body.expectedRevision === undefined || body.expectedRevision === null || body.expectedRevision === "") return;
  const expected = Number(body.expectedRevision);
  const current = Math.max(0, Number(data.revisions && data.revisions.workforce || 0));
  if (!Number.isInteger(expected) || expected < 0) {
    const error = new Error("Geçerli bir expectedRevision gerekli.");
    error.status = 400;
    throw error;
  }
  if (expected !== current) {
    const error = new Error("Personel verisi başka bir işlem tarafından güncellendi. Verileri yenileyip tekrar deneyin.");
    error.status = 409;
    error.code = "WORKFORCE_REVISION_CONFLICT";
    error.currentRevision = current;
    throw error;
  }
}

function rememberLifecycleResponse(data, operation, requestId, response, createdAt) {
  if (!requestId) return;
  data.idempotencyRequests = (Array.isArray(data.idempotencyRequests) ? data.idempotencyRequests : []).concat({
    scope: "personnel_lifecycle",
    operation,
    requestId,
    response: structuredClone(response),
    createdAt
  }).slice(-500);
}

function touchWorkforceRevision(data) {
  if (!data.revisions || typeof data.revisions !== "object" || Array.isArray(data.revisions)) data.revisions = {};
  data.revisions.workforce = Math.max(0, Number(data.revisions.workforce || 0)) + 1;
  return data.revisions.workforce;
}

function preserveDeletedPersonnelReferences(data, user, deletedAt) {
  const userId = String(user && user.id || "");
  const snapshot = {
    personDeleted: true,
    personNameSnapshot: String(user && (user.name || user.username) || "Silinmiş personel"),
    personUsernameSnapshot: String(user && user.username || ""),
    personDeletedAt: deletedAt
  };
  for (const assignment of data.workforceAssignments || []) {
    if (String(assignment.userId || assignment.personnelId || "") !== userId) continue;
    assignment.userName = assignment.userName || snapshot.personNameSnapshot;
    assignment.username = assignment.username || snapshot.personUsernameSnapshot;
    Object.assign(assignment, snapshot);
  }
  for (const shipment of data.workforceShipments || []) {
    if (String(shipment.userId || shipment.personnelId || "") !== userId) continue;
    shipment.userName = shipment.userName || snapshot.personNameSnapshot;
    Object.assign(shipment, snapshot);
  }
  for (const request of data.workforceMaterialRequests || []) {
    if (String(request.personId || request.personnelId || "") !== userId) continue;
    request.personName = request.personName || snapshot.personNameSnapshot;
    Object.assign(request, snapshot);
  }
  for (const request of data.workforceShiftRequests || []) {
    if (String(request.personId || request.personnelId || "") !== userId) continue;
    request.personName = request.personName || snapshot.personNameSnapshot;
    Object.assign(request, snapshot);
  }
  for (const plan of data.workforceShiftPlans || []) {
    if (String(plan.personId || plan.personnelId || "") !== userId) continue;
    plan.personName = plan.personName || snapshot.personNameSnapshot;
    Object.assign(plan, snapshot);
  }
  for (const revision of data.workforceShiftPlanRevisions || []) {
    for (const plan of revision.plans || []) {
      if (String(plan.personId || plan.personnelId || "") !== userId) continue;
      plan.personName = plan.personName || snapshot.personNameSnapshot;
      Object.assign(plan, snapshot);
    }
  }
  const stockState = data.stockState && typeof data.stockState === "object" ? data.stockState : {};
  for (const movement of stockState.movements || []) {
    if (String(movement.personnelId || movement.userId || "") !== userId) continue;
    Object.assign(movement, snapshot);
  }
}
app.get("/api/events", requireRequestOrigin, requireAuthenticatedEventSession, (req,res,next) => { try { openAuthenticatedEventStream(req,res); } catch(error) { next(error); } });
app.get("/api/admin/recipe-users", requireRequestOrigin, auth.requireAdmin, async (_req,res,next) => { try { const data=await store.read(); res.json({ok:true,users:publicRecipeUsers(data.recipeUsers),recipeUsers:publicRecipeUsers(data.recipeUsers),revision:Number(data.revisions.workforce||0)}); } catch(error) {next(error);} });
app.get("/api/admin/recipe-assignments", requireRequestOrigin, auth.requireAdmin, async (_req,res,next) => { try { const data=await store.read(); res.json({ok:true,assignments:publicRecipeAssignments(data.recipeAssignments),revision:Number(data.revisions.workforce||0)}); } catch(error) {next(error);} });
function publicRecipeUsers(users) { return (users||[]).map(publicRecipeUser); }
workforceRuntime = require("./workforce-routes").registerWorkforceRoutes({
  app, store, auth, crypto, normalizeStockState,
  excelOptions: { mediaDir: config.mediaDir, projectRoot: config.projectRoot },
  requireAdminRequestOrigin, requireAdminOrMainRequestOrigin,
  notificationService, publishGatewayEvent: publishAuthenticatedEvent,
  broadcastStockUpdate, queueStockThresholdNotifications, notifyProcurementChange
});
const unsubscribeNotifications = notificationService.subscribeNotificationEvents(notification => publishAuthenticatedEvent({ topic:"notification", type:"notification.updated", entityType:notification.entityType||"notification", entityId:notification.entityId||notification.id||"", revision:notification.revision||0, timestamp:notification.updatedAt||notification.createdAt, targets:[notification.appTarget||(notification.recipientRole==="manager"?"yonetici":"personel")] }));
return {
  workforceRuntime,
  broadcastRecipeUpdate,
  publishAuthenticatedEvent,
  getSseClientCounts() { return { recipe: recipeSseClients.size, authenticatedEvents: authenticatedEventClients.size }; },
  close() { if(typeof unsubscribeNotifications === "function") unsubscribeNotifications(); for(const clients of [recipeSseClients,authenticatedEventClients]) for(const client of [...clients]) closeRevisionClient(client,clients); }
};
}
module.exports = { registerPersonelRoutes };
