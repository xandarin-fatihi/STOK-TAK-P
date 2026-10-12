"use strict";
// Read-only staged-file check. Never print secret values.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const git = (...args) => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const files = git("diff", "--cached", "--name-only", "--diff-filter=ACM", "-z")
  .toString("utf8").split("\0").filter(Boolean);
if (!files.length) throw new Error("No staged files to verify.");
const forbidden = /(?:^|\/)(?:node_modules|backups|test-artifacts|DENETIM|VERİ|VERÄ°)(?:\/|$)|(?:^|\/)(?:\.local\.env|writer\.lock)$|\.(?:log|pem|key)$/i;
const credentials = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/;
const localEnv = path.join(root, "LOCAL", ".local.env");
const secrets = fs.existsSync(localEnv) ? fs.readFileSync(localEnv, "utf8")
  .split(/\r?\n/).map(line => line.match(/^\s*([A-Z_]+)=(.*)$/))
  .filter(match => match && /SECRET|PASSWORD|SMTP_PASS|PRIVATE_KEY|TOKEN/.test(match[1]))
  .map(match => match[2].trim()).filter(value => value.length >= 8) : [];
const failures = [];
for (const file of files) {
  if (forbidden.test(file) || (/\.env(?:\.|$)|\.env$/.test(file) && file !== "LOCAL/.env.example")) {
    failures.push(`${file}: forbidden runtime/secret path`);
    continue;
  }
  const bytes = git("show", `:${file}`);
  if (bytes.length >= 100 * 1024 * 1024) failures.push(`${file}: GitHub file-size limit`);
  if (!bytes.includes(0)) {
    const body = bytes.toString("utf8");
    if (credentials.test(body) || secrets.some(secret => body.includes(secret))) {
      failures.push(`${file}: possible private credential`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`PASS: ${files.length} staged files; no runtime paths, local credentials or oversized files.`);
}
