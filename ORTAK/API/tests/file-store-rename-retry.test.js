"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createFileStore, defaultStore } = require("../src/store/file-store");

test("file store geçici Windows/OneDrive rename kilidini sınırlı biçimde yeniden dener", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paket3-store-rename-retry-"));
  const dataFile = path.join(root, "store.json");
  const fixture = defaultStore("$2b$12$renameRetryFixtureHashOnly000000000000000000000000000");
  fixture.storeRevision = 1;
  await fs.writeFile(dataFile, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

  let remainingTransientFailures = 0;
  let renameCalls = 0;
  const flakyFs = {
    ...fs,
    async rename(sourcePath, destinationPath) {
      renameCalls += 1;
      if (remainingTransientFailures > 0) {
        remainingTransientFailures -= 1;
        const error = new Error("OneDrive dosyayı kısa süreliğine kilitledi.");
        error.code = "EPERM";
        throw error;
      }
      return fs.rename(sourcePath, destinationPath);
    }
  };

  const store = createFileStore(dataFile, {
    fsPromises: flakyFs,
    writerLock: false,
    defaultPanelPassword: "unused-test-password",
    renameRetryDelaysMs: [1, 1, 1]
  });
  context.after(async () => {
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await store.ensure();
  renameCalls = 0;
  remainingTransientFailures = 2;

  const updated = await store.update((draft) => {
    draft.revisions = { ...(draft.revisions || {}), publish: 7 };
  });

  assert.equal(renameCalls, 3, "iki geçici EPERM sonrasında üçüncü rename başarılı olmalı");
  assert.equal(updated.revisions.publish, 7);
  const persisted = JSON.parse(await fs.readFile(dataFile, "utf8"));
  assert.equal(persisted.revisions.publish, 7);
  assert.equal((await fs.readdir(root)).some((name) => name.endsWith(".tmp")), false,
    "başarılı yeniden deneme geçici dosya bırakmamalı");
});
