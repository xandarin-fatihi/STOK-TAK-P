"use strict";

const DEFAULT_PWA_RELEASE_NOTES = Object.freeze([
  "Sevkiyat kataloğu tam genişlikte, kart içi miktar kontrollü yeni düzene geçirildi.",
  "Kamyonet düğmesiyle açılan son kontrol paneli masaüstü ve mobil için yenilendi.",
  "Stok ve Sevkiyat ekranları bütün açık ve koyu panel temalarıyla uyumlu hale getirildi."
]);

function normalizePwaReleaseNotes(value) {
  const candidates = releaseNoteCandidates(value);
  const notes = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const note = normalizeReleaseSentence(candidate);
    if (!note || seen.has(note)) continue;
    seen.add(note);
    notes.push(note);
    if (notes.length >= 5) break;
  }
  return notes.length ? notes : [...DEFAULT_PWA_RELEASE_NOTES];
}

function releaseNoteCandidates(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch (_error) {}
  }
  return text.split(/\r?\n|\s*\|\s*/g);
}

function normalizeReleaseSentence(value) {
  let text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const sentenceEnd = text.search(/[.!?](?:\s|$)/);
  if (sentenceEnd >= 0 && sentenceEnd < text.length - 1) text = text.slice(0, sentenceEnd + 1);
  text = text.slice(0, 180).trim();
  if (text && !/[.!?]$/.test(text)) text = `${text.replace(/[,:;\-\s]+$/g, "")}.`;
  return text;
}

function normalizePwaReleaseMetadata(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const id = String(source.id || "paket-3-static-fallback")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .slice(0, 96) || "paket-3-static-fallback";
  return Object.freeze({
    id,
    notes: Object.freeze(normalizePwaReleaseNotes(source.notes))
  });
}

function serializePwaReleaseMetadata(value) {
  return JSON.stringify(normalizePwaReleaseMetadata(value)).replace(/[<>&\u2028\u2029]/g, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  ));
}

module.exports = {
  DEFAULT_PWA_RELEASE_NOTES,
  normalizePwaReleaseMetadata,
  normalizePwaReleaseNotes,
  serializePwaReleaseMetadata
};
