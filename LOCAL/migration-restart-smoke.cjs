"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(packageRoot, "ORTAK");
const testRoot = path.join(__dirname, "RESTART-TEST-DATA");
const dataFile = path.join(testRoot, "store.json");
const evidenceFile = path.join(packageRoot, "DENETIM", "migration-restart-results.json");
const bcrypt = require(path.join(runtimeRoot, "node_modules", "bcryptjs"));
const password = "Paket3Restart!2026";

async function main() {
  resetTestRoot();
  for (const name of ["MEDIA", "DOCUMENTS", "COLD", "BACKUPS", "LOGS"])
    fs.mkdirSync(path.join(testRoot, name), { recursive: true });

  const sourceFile = path.join(runtimeRoot, "VERİ", "STORE", "store.json");
  fs.copyFileSync(sourceFile, dataFile);
  const source = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const sourceSummary = stableSummary(source);
  source.admin = { ...(source.admin || {}), passwordHash: bcrypt.hashSync(password, 10) };
  source.authSessions = [];
  fs.writeFileSync(dataFile, JSON.stringify(source, null, 2));

  const port = await freePort();
  const origin = `http://localhost:${port}`;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    DATA_FILE: dataFile,
    MEDIA_DIR: path.join(testRoot, "MEDIA"),
    PROCUREMENT_DOCUMENTS_DIR: path.join(testRoot, "DOCUMENTS"),
    DATA_IMPORT_COLD_DIR: path.join(testRoot, "COLD"),
    BACKUP_DIR: path.join(testRoot, "BACKUPS"),
    LOG_DIR: path.join(testRoot, "LOGS"),
    ADMIN_COOKIE_NAME: "paket3_restart_admin",
    RECIPE_COOKIE_NAME: "paket3_restart_personnel",
    JWT_SECRET: crypto.randomBytes(48).toString("base64url"),
    JWT_ISSUER: "paket-3-restart-test",
    JWT_AUDIENCE: "paket-3-restart-clients",
    NOTIFICATION_WORKERS_ENABLED: "false"
  };
  const evidence = {
    generatedAt: new Date().toISOString(),
    sourceSchemaVersion: Number(sourceSummary.schemaVersion || 0),
    sourceSummary,
    port,
    starts: [],
    assertions: {}
  };

  let child = await startServer(env, origin);
  evidence.starts.push({ number: 1, pid: child.pid, health: await health(origin) });
  const adminCookie = await login(origin);
  const created = await jsonRequest(origin, "/api/admin/recipe-users", {
    method: "POST", cookie: adminCookie,
    body: {
      name: "Restart Kalıcılık Personeli",
      username: "restart-persistence",
      email: "restart-persistence@example.invalid",
      password: "RestartPersonel!2026",
      active: true,
      personelSectionAccess: { recipe: true, tasks: true, stock: true, shipment: true, shift: true }
    }
  }, 201);
  const userId = created.user && created.user.id;
  assert.ok(userId);
  await stopServer(child);

  const afterFirst = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.ok(Number(afterFirst.schemaVersion) >= 26);
  assertStableData(sourceSummary, afterFirst);
  assert.equal(afterFirst.recipeUsers.filter((item) => item.id === userId).length, 1);

  child = await startServer(env, origin);
  evidence.starts.push({ number: 2, pid: child.pid, health: await health(origin) });
  const secondCookie = await login(origin);
  const users = await jsonRequest(origin, "/api/admin/recipe-users", { cookie: secondCookie });
  const persisted = users.users.find((item) => item.id === userId);
  assert.ok(persisted, "restart sonrasında oluşturulan personel bulunmalı");
  assert.deepEqual(persisted.personelSectionAccess, { recipe: true, tasks: true, stock: true, shipment: true, shift: true });
  await stopServer(child);
  child = null;

  const afterSecond = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assertStableData(sourceSummary, afterSecond);
  assert.equal(afterSecond.recipeUsers.filter((item) => item.id === userId).length, 1, "ikinci migration aynı kullanıcıyı çoğaltmamalı");
  assert.equal(Number(afterSecond.schemaVersion), Number(afterFirst.schemaVersion));
  evidence.finalSchemaVersion = Number(afterSecond.schemaVersion);
  evidence.finalSummary = stableSummary(afterSecond);
  evidence.assertions = {
    sourceMenuPreserved: true,
    sourceRecipesPreserved: true,
    sourceStockPreserved: true,
    migrationRepeatedWithoutDuplicateUser: true,
    restartPreservedUserAndFiveSectionPermissions: true,
    testServerStopped: true
  };
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`PASS migration-restart schema=${evidence.finalSchemaVersion} user=${userId}`);
  resetTestRoot();
}

function stableSummary(data) {
  const categories = Array.isArray(data.menuState && data.menuState.categories) ? data.menuState.categories : [];
  return {
    schemaVersion: Number(data.schemaVersion || 0),
    menuCategoryCount: categories.length,
    menuProductIds: categories.flatMap((category) => (category.products || []).map((product) => String(product.id || ""))).filter(Boolean).sort(),
    recipeLeafCount: recipeLeafCount(data.recipeState),
    stockProductIds: (data.stockState && data.stockState.products || []).map((item) => String(item.id || "")).filter(Boolean).sort(),
    stockBalanceKeys: (data.stockState && data.stockState.balances || []).map((item) => `${item.locationId || ""}|${item.productId || ""}|${Number(item.quantity || 0)}`).sort()
  };
}

function assertStableData(before, afterData) {
  const after = stableSummary(afterData);
  assert.equal(after.menuCategoryCount, before.menuCategoryCount);
  assert.deepEqual(after.menuProductIds, before.menuProductIds);
  assert.equal(after.recipeLeafCount, before.recipeLeafCount);
  assert.deepEqual(after.stockProductIds, before.stockProductIds);
  if (before.stockBalanceKeys.length) assert.deepEqual(after.stockBalanceKeys, before.stockBalanceKeys);
}

function recipeLeafCount(value) {
  let count = 0;
  for (const products of Object.values(value && typeof value === "object" ? value : {}))
    for (const sizes of Object.values(products && typeof products === "object" ? products : {}))
      count += Object.keys(sizes && typeof sizes === "object" ? sizes : {}).length;
  return count;
}

function resetTestRoot() {
  const expected = path.resolve(__dirname, "RESTART-TEST-DATA");
  assert.equal(path.resolve(testRoot), expected);
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(testRoot, { recursive: true });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startServer(env, origin) {
  const child = spawn(process.execPath, [path.join(runtimeRoot, "API", "src", "server.js")], {
    cwd: runtimeRoot,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  child.once("exit", (code) => { child.exitCodeObserved = code; });
  try {
    await waitForHealth(origin, child);
    return child;
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${output.join("").slice(-2000)}`);
  }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("İzole sunucu kapanmadı.")), 5_000))
  ]);
}

async function waitForHealth(origin, child) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`İzole sunucu erken kapandı (${child.exitCode}).`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok && (await response.json()).service === "PAKET 3") return;
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("İzole sunucu health zaman aşımı.");
}

async function health(origin) {
  return jsonRequest(origin, "/api/health");
}

async function login(origin) {
  const response = await fetch(`${origin}/api/admin/login`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

async function jsonRequest(origin, url, options = {}, expected = 200) {
  const headers = { Origin: origin, ...(options.body === undefined ? {} : { "content-type": "application/json" }) };
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await fetch(origin + url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${options.method || "GET"} ${url}: ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
