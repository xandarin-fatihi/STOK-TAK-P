"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const packageRoot = path.resolve(__dirname, "..");
const auditRoot = path.join(packageRoot, "DENETIM");
const baselinePath = path.join(auditRoot, "KAYNAK_BUTUNLUK_BASLANGIC.json");
const outputPath = path.join(auditRoot, "KAYNAK_BUTUNLUK.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const extensionSet = new Set(baseline.files.map((item) => path.extname(item.relativePath).toLowerCase()));
const baselineKeys = new Set(baseline.files.map((item) => `${item.source}\0${normalize(item.relativePath)}`));
const sourceRoots = new Map(baseline.sources.map((item) => [item.name || item.Name, path.resolve(item.path || item.Path)]));
const createdAtMs = parseLocalTimestamp(baseline.createdAt);

const verifiedFiles = [];
const modified = [];
const missing = [];
const metadataChangedButHashStable = [];

for (const expected of baseline.files) {
  const sourceRoot = sourceRoots.get(expected.source);
  if (!sourceRoot) throw new Error(`Baseline source is missing: ${expected.source}`);
  const fullPath = path.resolve(sourceRoot, ...normalize(expected.relativePath).split("/"));
  assertInside(sourceRoot, fullPath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    missing.push({ source: expected.source, relativePath: normalize(expected.relativePath) });
    continue;
  }
  const stat = fs.statSync(fullPath);
  const sha256 = hashFile(fullPath);
  const hashMatches = sha256 === expected.sha256;
  const sizeMatches = stat.size === expected.size;
  const expectedMtimeMs = Date.parse(expected.lastWriteUtc);
  const metadataMatches = Number.isFinite(expectedMtimeMs) && Math.abs(stat.mtimeMs - expectedMtimeMs) < 2;
  const result = {
    source: expected.source,
    relativePath: normalize(expected.relativePath),
    size: stat.size,
    sha256,
    hashMatches,
    sizeMatches
  };
  verifiedFiles.push(result);
  if (!hashMatches || !sizeMatches) {
    modified.push({
      source: expected.source,
      relativePath: normalize(expected.relativePath),
      expectedSize: expected.size,
      actualSize: stat.size,
      expectedSha256: expected.sha256,
      actualSha256: sha256
    });
  } else if (!metadataMatches) {
    metadataChangedButHashStable.push({
      source: expected.source,
      relativePath: normalize(expected.relativePath),
      expectedLastWriteUtc: expected.lastWriteUtc,
      actualLastWriteUtc: stat.mtime.toISOString()
    });
  }
}

const addedSinceBaseline = [];
for (const [sourceName, sourceRoot] of sourceRoots) {
  walk(sourceRoot, (fullPath, stat) => {
    const relativePath = normalize(path.relative(sourceRoot, fullPath));
    const key = `${sourceName}\0${relativePath}`;
    if (baselineKeys.has(key)) return;
    if (!extensionSet.has(path.extname(relativePath).toLowerCase())) return;
    if (stat.mtimeMs + 1000 < createdAtMs) return;
    addedSinceBaseline.push({
      source: sourceName,
      relativePath,
      size: stat.size,
      lastWriteUtc: stat.mtime.toISOString(),
      sha256: hashFile(fullPath)
    });
  });
}

modified.sort(compareEntries);
missing.sort(compareEntries);
metadataChangedButHashStable.sort(compareEntries);
addedSinceBaseline.sort(compareEntries);
verifiedFiles.sort(compareEntries);

const perSource = [...sourceRoots.keys()].map((source) => ({
  source,
  baselineFileCount: baseline.files.filter((item) => item.source === source).length,
  verifiedFileCount: verifiedFiles.filter((item) => item.source === source && item.hashMatches && item.sizeMatches).length,
  modifiedCount: modified.filter((item) => item.source === source).length,
  missingCount: missing.filter((item) => item.source === source).length,
  addedSinceBaselineCount: addedSinceBaseline.filter((item) => item.source === source).length
}));

const report = {
  generatedAt: new Date().toISOString(),
  status: modified.length || missing.length || addedSinceBaseline.length ? "fail" : "pass",
  hashAlgorithm: "sha256",
  baseline: {
    path: baselinePath,
    createdAt: baseline.createdAt,
    fileCount: baseline.fileCount,
    digest: crypto.createHash("sha256").update(fs.readFileSync(baselinePath)).digest("hex")
  },
  method: {
    baselineFiles: "Every baseline file was re-read and SHA-256 compared.",
    additions: "Files with a baseline-observed extension and a write time at or after the baseline timestamp were checked outside node_modules and .git.",
    skippedDirectories: ["node_modules", ".git"]
  },
  summary: {
    baselineFileCount: baseline.files.length,
    verifiedUnchangedCount: verifiedFiles.filter((item) => item.hashMatches && item.sizeMatches).length,
    modifiedCount: modified.length,
    missingCount: missing.length,
    addedSinceBaselineCount: addedSinceBaseline.length,
    metadataChangedButHashStableCount: metadataChangedButHashStable.length
  },
  perSource,
  modified,
  missing,
  addedSinceBaseline,
  metadataChangedButHashStable,
  verifiedFiles
};

fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, status: report.status, summary: report.summary, perSource }, null, 2));
if (report.status !== "pass") process.exitCode = 1;

function walk(directory, onFile) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === "node_modules" || entry.name === ".git")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, onFile);
    else if (entry.isFile()) onFile(fullPath, fs.statSync(fullPath));
  }
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function normalize(value) {
  return String(value).split(path.sep).join("/").replaceAll("\\", "/");
}

function assertInside(root, candidate) {
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!path.resolve(candidate).startsWith(prefix)) throw new Error(`Path escaped source root: ${candidate}`);
}

function parseLocalTimestamp(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) {
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
    throw new Error(`Unsupported baseline timestamp: ${value}`);
  }
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])).getTime();
}

function compareEntries(left, right) {
  return `${left.source}/${left.relativePath}`.localeCompare(`${right.source}/${right.relativePath}`, "tr");
}
