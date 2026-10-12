"use strict";
const { isSafeMediaResource } = require("./validators");
const { publicAccountSecurity } = require("./account-security-routes");
function registerAdminProfileRoutes({ app, store, auth, requireRequestOrigin, config }) {
  function publicProfile(admin = {}) {
    const security = publicAccountSecurity(admin);
    return { name: String(admin.name || ""), username: String(admin.username || config.adminUsername || "admin"), avatarUrl: String(admin.avatarUrl || ""), email: security.email, pendingEmail: security.pendingEmail, emailVerifiedAt: security.emailVerifiedAt, security };
  }
  app.get("/api/admin/profile", requireRequestOrigin, auth.requireAdmin, async (_req, res, next) => {
    try { res.json({ ok: true, profile: publicProfile((await store.read()).admin) }); } catch (error) { next(error); }
  });
  app.put("/api/admin/profile", requireRequestOrigin, auth.requireAdmin, async (req, res, next) => {
    try {
      const name = String(req.body && req.body.name || "").trim(), avatarUrl = String(req.body && req.body.avatarUrl || "").trim();
      if (name.length > 80 || avatarUrl.length > 500 || (avatarUrl && !isSafeMediaResource(avatarUrl))) return res.status(400).json({ ok: false, message: "Geçerli bir ad ve güvenli bir avatar adresi girin." });
      const data = await store.update((nextData) => { nextData.admin.name = name; nextData.admin.avatarUrl = avatarUrl; nextData.admin.updatedAt = new Date().toISOString(); return nextData; });
      res.json({ ok: true, profile: publicProfile(data.admin) });
    } catch (error) { next(error); }
  });
}
module.exports = { registerAdminProfileRoutes };
