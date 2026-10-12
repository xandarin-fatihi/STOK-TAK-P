"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// A lock belongs to a canonical DATA_FILE, not to an HTTP port. A completed
// candidate directory is renamed into place so readers never see half-written
// ownership metadata. An unknown owner is never removed merely because it is old.
async function acquireSingleWriterLock(filePath) {
  const directory = path.dirname(path.resolve(filePath));
  await fs.mkdir(directory, { recursive: true });
  const canonicalDirectory = await fs.realpath(directory);
  const canonicalFile = await fs.realpath(filePath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return path.join(canonicalDirectory, path.basename(filePath));
  });
  const lockPath = `${canonicalFile}.writer.lock`;
  const token = crypto.randomBytes(24).toString("hex");
  const owner = { pid: process.pid, token, canonicalFile, createdAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = await fs.mkdtemp(`${lockPath}.candidate-`);
    try {
      await fs.writeFile(path.join(candidate, "owner.json"), JSON.stringify(owner), { flag: "wx" });
      await fs.rename(candidate, lockPath);
      return { lockPath, owner, release: () => releaseLock(lockPath, owner) };
    } catch (error) {
      await removeOwnedDirectory(candidate).catch(() => {});
      if (!["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].includes(error.code)) throw error;
      const current = await readOwner(lockPath);
      if (!current || current.canonicalFile !== canonicalFile || !Number.isInteger(current.pid)
        || current.pid < 1 || !/^[a-f0-9]{48}$/.test(String(current.token || ""))) {
        throw new Error(`DATA_FILE yazıcı kilidi doğrulanamadı: ${lockPath}. Elle inceleyin; canlı kilit otomatik silinmez.`);
      }
      if (processIsAlive(current.pid)) {
        const conflict = new Error(`DATA_FILE zaten PID ${current.pid} tarafından kullanılıyor: ${canonicalFile}. İkinci yazıcı başlatılmadı.`);
        conflict.code = "DATA_FILE_WRITER_ACTIVE";
        throw conflict;
      }
      const stale = `${lockPath}.stale-${crypto.randomBytes(8).toString("hex")}`;
      try {
        await fs.rename(lockPath, stale);
      } catch (renameError) {
        if (["ENOENT", "EEXIST", "EPERM", "EACCES"].includes(renameError.code)) continue;
        throw renameError;
      }
      const movedOwner = await readOwner(stale);
      if (!movedOwner || movedOwner.token !== current.token || movedOwner.pid !== current.pid) {
        throw new Error(`Taşınan eski kilidin sahipliği değişti: ${stale}. Elle inceleyin.`);
      }
      await removeOwnedDirectory(stale);
    }
  }
  throw new Error(`DATA_FILE yazıcı kilidi edinilemedi: ${lockPath}`);
}

async function releaseLock(lockPath, owner) {
  const current = await readOwner(lockPath);
  if (!current) return;
  if (current.token !== owner.token || current.pid !== owner.pid) {
    throw new Error(`DATA_FILE yazıcı kilidi başka sürece ait; bırakılmadı: ${lockPath}`);
  }
  const released = `${lockPath}.released-${owner.token.slice(0, 12)}`;
  await fs.rename(lockPath, released);
  await removeOwnedDirectory(released);
}

async function readOwner(directory) {
  try {
    const content = await fs.readFile(path.join(directory, "owner.json"), "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function removeOwnedDirectory(directory) {
  try { await fs.unlink(path.join(directory, "owner.json")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await fs.rmdir(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

module.exports = { acquireSingleWriterLock };
