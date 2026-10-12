(function () {
  "use strict";
  let loading = null;
  const byId = (id) => document.getElementById(id);
  function render(profile) {
    const name = profile.name || profile.username || "Yönetici";
    document.querySelectorAll("[data-admin-profile-name]").forEach((node) => { node.textContent = name; });
    document.querySelectorAll("[data-admin-profile-account]").forEach((node) => { node.textContent = profile.email || profile.username; });
    document.querySelectorAll("[data-admin-profile-avatar]").forEach((node) => {
      node.replaceChildren();
      if (profile.avatarUrl) { const image = new Image(); image.src = profile.avatarUrl; image.alt = name; node.append(image); }
      else node.textContent = name.slice(0, 1).toLocaleUpperCase("tr-TR");
    });
    byId("adminProfileName").value = profile.name || "";
    byId("adminProfileUsername").value = profile.username;
    byId("adminProfileAvatarUrl").value = profile.avatarUrl;
    byId("adminProfileEmailSummary").textContent = profile.email || "Henüz eklenmedi";
  }
  async function load() {
    if (loading) return loading;
    loading = window.MenuSuiteAdminBridge.backendRequest("/api/admin/profile").then((result) => render(result.profile)).catch((error) => { byId("adminProfileMessage").textContent = error.message; }).finally(() => { loading = null; });
    return loading;
  }
  document.addEventListener("DOMContentLoaded", () => {
    const form = byId("adminProfileForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true;
      try {
        let avatarUrl = byId("adminProfileAvatarUrl").value.trim(); const file = byId("adminProfilePhoto").files[0];
        if (file) {
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("En fazla 10 MB JPG, PNG veya WEBP seçin.");
          const upload = await window.MenuSuiteAdminBridge.backendRequest("/api/media", { method: "POST", rawBody: file, headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name), "X-Media-Kind": "image" } });
          avatarUrl = upload.media.src || upload.media.url;
        }
        const result = await window.MenuSuiteAdminBridge.backendRequest("/api/admin/profile", { method: "PUT", body: { name: byId("adminProfileName").value.trim(), avatarUrl } });
        render(result.profile); byId("adminProfilePhoto").value = ""; byId("adminProfileMessage").textContent = "Profil kaydedildi.";
      } catch (error) { byId("adminProfileMessage").textContent = error.message; }
      finally { button.disabled = false; }
    });
    byId("adminProfileLogout").addEventListener("click", () => window.MenuSuiteAdminBridge.logout());
  });
  document.addEventListener("menu-suite:admin-session-started", load);
  document.addEventListener("menu-suite:admin-section-change", (event) => { if (event.detail.section === "profile") { load(); window.MenuSuiteAccountSecurity?.refresh("admin"); } });
  document.addEventListener("menu-suite:account-security-updated", (event) => { if (event.detail.scope === "admin") load(); });
})();
