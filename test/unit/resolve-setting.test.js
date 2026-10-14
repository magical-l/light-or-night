const test = require("node:test");
const assert = require("node:assert");
const MODEL = require("../../model.js");

const G = (enabled, preferNative, method) => ({ enabled, preferNative, method });

test("全局关闭 → 什么都不做", () => {
  assert.deepEqual(MODEL.resolveSetting(G(false, true, "filter"), undefined), { action: "none" });
});

test("跟随全局（site 为 undefined）→ 走全局，得到 auto", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(true, true, "filter"), undefined),
    { action: "auto", preferNative: true, method: "filter" }
  );
});

test("全局关闭，但站点有自己的设置 → 站点说了算", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(false, true, "filter"), G(true, false, "remap")),
    { action: "force", preferNative: false, method: "remap" }
  );
});

test("站点关闭 → 什么都不做，哪怕全局开着", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(true, true, "filter"), G(false, false, "remap")),
    { action: "none" }
  );
});

test("站点启用 → force（不检测），原样带上手段", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(true, true, "filter"), G(true, true, "remap")),
    { action: "force", preferNative: true, method: "remap" }
  );
});

test("normalizeSetting：坏值一律当没设过", () => {
  assert.equal(MODEL.normalizeSetting(null), null);
  assert.equal(MODEL.normalizeSetting({ enabled: "yes" }), null);
  assert.equal(MODEL.normalizeSetting({ enabled: true, method: "nope" }), null);
  assert.deepEqual(
    MODEL.normalizeSetting({ enabled: true, preferNative: false, method: "filter" }),
    G(true, false, "filter")
  );
});
