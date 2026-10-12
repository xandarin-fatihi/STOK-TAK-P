const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const identity = require(path.join(ROOT, "ORTAK/JS/brand-identity.js"));

test("rol panelleri benzersiz kalıcı logoları varsayılan olarak kullanır", () => {
  assert.equal(identity.logo({}, "light", "admin", "yonetici"), "/assets/app-icons/yonetici/master.svg");
  assert.equal(identity.logo({}, "dark", "personel", "personel"), "/assets/app-icons/personel/master.svg");
  assert.equal(identity.logo({}, "light", "accounting", "muhasebe"), "/assets/app-icons/yonetici/master.svg");
  assert.equal(identity.logo({ adminLogoUrl: "/uploads/custom.svg" }, "light", "admin", "yonetici"), "/uploads/custom.svg");
  assert.equal(identity.favicon({}, "accounting", "muhasebe"), "/assets/app-icons/yonetici/favicon-32.png");
  assert.equal(identity.favicon({}, "accounting", "muhasebe", 48), "/assets/app-icons/yonetici/favicon-48.png");
});

test("Yönetici ve Personel kabukları ayrıdır; entegre modül Yönetici kimliğini kullanır", () => {
  assert.match(read("YÖNETİCİ PANELİ/HTML/index.html"), /\/assets\/app-icons\/yonetici\/master\.svg/);
  assert.match(read("PERSONEL/index.html"), /\/assets\/app-icons\/personel\/master\.svg/);
  assert.match(read("YÖNETİCİ PANELİ/MODULLER/TEDARIK-MUHASEBE/index.html"), /\/assets\/app-icons\/yonetici\/master\.svg/);
  assert.match(read("PERSONEL/sw.js"), /personel-role-icons-v2/);
  assert.match(read("YÖNETİCİ PANELİ/PWA/sw.js"), /yonetici-role-icons-v2/);
  assert.equal(fs.existsSync(path.join(ROOT, "MUHASEBE")), false);
});

test("küçük faviconlar rol bazında birbirinden ayırt edilebilir", () => {
  const hashes = ["yonetici", "personel"].map((role) => {
    const bytes = fs.readFileSync(path.join(ROOT, "ORTAK/ASSETS/APP-ICONS", role, "favicon-32.png"));
    return crypto.createHash("sha256").update(bytes).digest("hex");
  });
  assert.equal(new Set(hashes).size, 2);
});
