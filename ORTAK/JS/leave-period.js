(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MenuSuiteLeavePeriod = Object.freeze(api);
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const DAY = 86400000;
  function timestamp(value) {
    const key = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
    const time = Date.parse(`${key}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === key ? time : NaN;
  }
  function countDays(startDate, endDate) {
    const start = timestamp(startDate), end = timestamp(endDate);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    const total = Math.round((end - start) / DAY) + 1;
    const firstSunday = (7 - new Date(start).getUTCDay()) % 7;
    const sundays = firstSunday < total ? 1 + Math.floor((total - firstSunday - 1) / 7) : 0;
    return total - sundays;
  }
  function normalize(input) {
    const startDate = String(input.startDate || input.date || "");
    const endDate = String(input.endDate || startDate);
    const dayCount = countDays(startDate, endDate);
    if (dayCount === null) return { error: "Geçerli bir başlangıç ve bitiş tarihi seçin; bitiş başlangıçtan önce olamaz." };
    if (dayCount === 0) return { error: "Pazar hariç en az bir izin günü seçin." };
    return { date: startDate, startDate, endDate, dayCount };
  }
  function label(request, formatDate) {
    const start = request.startDate || request.date;
    const end = request.endDate || start;
    return end && end !== start ? `${formatDate(start)} – ${formatDate(end)}` : formatDate(start);
  }
  return { timestamp, countDays, normalize, label };
});
