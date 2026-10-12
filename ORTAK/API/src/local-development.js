"use strict";

const path = require("path");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const localDataRoot = path.join(projectRoot, "ORTAK", "VERİ");

const LOCAL_DEFAULTS = Object.freeze({
  adminPassword: "Paket1-Local-Admin-2026!",
  jwtSecret: "paket-1-local-development-jwt-secret-2026-never-production",
  managerKey: "paket-1-local-development-manager-key-2026-never-production"
});

function getLocalPaths() {
  return {
    dataFile: path.join(localDataRoot, "STORE", "store.json"),
    mediaDir: path.join(localDataRoot, "MEDIA")
  };
}

function isKnownLocalDataPath(value) {
  if (!value) return false;
  const resolved = path.resolve(value);
  const paths = getLocalPaths();
  return resolved === path.resolve(paths.dataFile) || resolved === path.resolve(paths.mediaDir);
}

function isKnownLocalCredential(value) {
  return Object.values(LOCAL_DEFAULTS).includes(String(value || ""));
}

module.exports = {
  LOCAL_DEFAULTS,
  getLocalPaths,
  isKnownLocalCredential,
  isKnownLocalDataPath,
  localDataRoot
};
