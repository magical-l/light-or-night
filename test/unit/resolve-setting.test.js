const test = require("node:test");
const assert = require("node:assert");
const MODEL = require("../../model.js");

// 站点级设置：没有 preference 这一项，偏好是全局的
const S = (enabled, preferNative, method) => ({ enabled, preferNative, method });
// 全局设置：站点那三项 + 偏好
const G = (enabled, preferNative, method, preference) => ({ enabled, preferNative, method, preference });

// 默认（system）在浅色系统上解析成浅色，plan 里就带 preferDark: false
const NO_DARK = { preferDark: false };

// --- resolveSetting ---

test("全局关闭 → 什么都不做", () => {
  assert.deepEqual(MODEL.resolveSetting(G(false, true, "filter", "system"), undefined, false), { action: "none", preferDark: false });
});

test("跟随全局（site 为 undefined）→ 走全局，得到 auto", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(true, true, "filter", "system"), undefined, false),
    { action: "auto", preferNative: true, method: "filter", preferDark: false }
  );
});

test("全局关闭，但站点有自己的设置 → 站点说了算", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(false, true, "filter", "system"), S(true, false, "remap"), false),
    { action: "force", preferNative: false, method: "remap", preferDark: false }
  );
});

test("站点关闭 → 什么都不做，哪怕全局开着", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(true, true, "filter", "system"), S(false, false, "remap"), false),
    { action: "none", preferDark: false }
  );
});

test("站点关闭、且没自己的手段（关之前跟随全局）→ 同样什么都不做", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(true, true, "filter", "system"), S(false, false, null), false),
    { action: "none", preferDark: false }
  );
});

test("站点启用 → force（不检测），原样带上手段", () => {
  assert.deepEqual(
    MODEL.resolveSetting(G(true, true, "filter", "system"), S(true, true, "remap"), false),
    { action: "force", preferNative: true, method: "remap", preferDark: false }
  );
});

test("偏好是全局的：站点有覆盖时也照样跟着全局走", () => {
  assert.equal(MODEL.resolveSetting(G(true, true, "filter", "dark"), S(true, true, "remap"), false).preferDark, true);
  assert.equal(MODEL.resolveSetting(G(true, true, "filter", "light"), S(true, true, "remap"), true).preferDark, false);
});

// --- resolvePreference ---

test("固定浅色 / 固定深色不看系统；跟随系统看系统", () => {
  assert.equal(MODEL.resolvePreference("light", true), "light");
  assert.equal(MODEL.resolvePreference("dark", false), "dark");
  assert.equal(MODEL.resolvePreference("system", true), "dark");
  assert.equal(MODEL.resolvePreference("system", false), "light");
});

test("问不到系统偏好（undefined）时按浅色算——猜错的方向是把页面翻黑", () => {
  assert.equal(MODEL.resolvePreference("system", undefined), "light");
  assert.equal(MODEL.resolveSetting(G(true, true, "filter", "system"), undefined, undefined).preferDark, false);
});

// --- normalizeSetting（站点级） ---

test("normalizeSetting：坏值一律当没设过", () => {
  assert.equal(MODEL.normalizeSetting(null), null);
  assert.equal(MODEL.normalizeSetting({ enabled: "yes" }), null);
  assert.equal(MODEL.normalizeSetting({ enabled: true, method: "nope" }), null);
  assert.deepEqual(
    MODEL.normalizeSetting({ enabled: true, preferNative: false, method: "filter" }),
    S(true, false, "filter")
  );
});

test("normalizeSetting：站点关闭时 method 是「再打开回到哪一档」的备忘，null = 跟随全局", () => {
  assert.deepEqual(MODEL.normalizeSetting({ enabled: false, preferNative: false, method: "remap" }), S(false, false, "remap"));
  // 关掉时记不住手段也无所谓——这一页反正不动，记不住就当没记，再打开即跟随全局
  assert.deepEqual(MODEL.normalizeSetting({ enabled: false, preferNative: false, method: "nope" }), S(false, false, null));
  assert.deepEqual(MODEL.normalizeSetting({ enabled: false }), S(false, false, null));
});

test("normalizeSetting：启用时手段认不出，仍是整条当没设过", () => {
  assert.equal(MODEL.normalizeSetting({ enabled: true, method: "nope" }), null);
  assert.equal(MODEL.normalizeSetting({ enabled: true, method: null }), null);
});

test("normalizeSetting 不管 preference：站点级不该存这一项", () => {
  assert.deepEqual(
    MODEL.normalizeSetting({ enabled: true, preferNative: true, method: "remap", preference: "dark" }),
    S(true, true, "remap")
  );
});

// --- normalizeGlobal ---

test("normalizeGlobal：缺 preference 的老数据补默认，整条不丢", () => {
  assert.deepEqual(
    MODEL.normalizeGlobal({ enabled: false, preferNative: false, method: "remap" }),
    G(false, false, "remap", "system")
  );
});

test("normalizeGlobal：认不出的 preference 也补默认", () => {
  assert.equal(MODEL.normalizeGlobal({ enabled: true, preferNative: true, method: "filter", preference: "sepia" }).preference, "system");
  assert.equal(MODEL.normalizeGlobal({ enabled: true, preferNative: true, method: "filter", preference: null }).preference, "system");
});

test("normalizeGlobal：那三项坏了仍是整条当没设过", () => {
  assert.equal(MODEL.normalizeGlobal(null), null);
  assert.equal(MODEL.normalizeGlobal({ enabled: true, method: "nope", preference: "dark" }), null);
});

test("normalizeGlobal 认得三档取值", () => {
  for (const p of ["system", "light", "dark"]) {
    assert.equal(MODEL.normalizeGlobal(G(true, true, "filter", p)).preference, p);
  }
});

test("DEFAULT_GLOBAL 带偏好且默认跟随系统", () => {
  assert.equal(MODEL.DEFAULT_GLOBAL.preference, "system");
  assert.deepEqual(Object.keys(MODEL.DEFAULT_GLOBAL).sort(), ["enabled", "method", "preferNative", "preference"]);
});
