"use strict";

function permissionsPolicyForPath(pathname) {
  const adminDocument = /^\/yonetici(?:\/|\/index\.html)?$/.test(pathname)
    || /^\/yonetici\/modules\/tedarik-muhasebe(?:\/|\/index\.html)?$/.test(pathname);
  return `camera=${adminDocument ? "(self)" : "()"}, microphone=(), geolocation=(), payment=(), usb=()`;
}

module.exports = { permissionsPolicyForPath };
