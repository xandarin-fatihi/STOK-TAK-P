"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..", "..");
const moduleRoot = path.join(root, "YÖNETİCİ PANELİ", "MODULLER", "TEDARIK-MUHASEBE");
const html = fs.readFileSync(path.join(moduleRoot, "index.html"), "utf8");
const script = fs.readFileSync(path.join(moduleRoot, "scripts", "app.js"), "utf8");
const styles = fs.readFileSync(path.join(moduleRoot, "styles", "muhasebe.css"), "utf8");

test("entegre tedarik/muhasebe modülü bildirim veri davranışını korur", () => {
  assert.match(html, /id="notificationDrawer"[\s\S]*role="dialog"[\s\S]*aria-modal="true"[\s\S]*inert/);
  assert.match(html, /data-notification-status="inbox"/);
  assert.match(html, /data-notification-status="unread"/);
  assert.match(html, /data-notification-status="archived"/);
  assert.match(html, /id="deleteReadNotifications"/);
  assert.match(script, /notificationCenter\.status === "unread"[\s\S]*query\.set\("unread", "true"\)/);
  assert.match(script, /payload\.updatedCount/);
  assert.match(script, /\/archive-read/);
  assert.match(script, /\/read`?,?\s*\{\s*method:\s*"DELETE"/);
  assert.match(script, /handleNotificationDrawerKeydown/);
  assert.match(script, /notificationLastFocus/);
  assert.match(script, /archived[\s\S]*data-notification-action="delete"/);
  assert.doesNotMatch(script, /:\s*`<button[^`]*data-notification-action="delete"[^`]*`\s*;\s*return/);
  assert.match(styles, /\.notification-load-more\[hidden\]\{display:none!important\}/);
});
