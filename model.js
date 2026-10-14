// 翻转模型：取值 + 决定这一页该怎么办。
// content.js（内容脚本）与 popup.js（弹窗页）共用这一份，谁都不许再抄一份。
// 末尾的 module.exports 只是为了能在 Node 里 require 它跑单测——扩展侧不加载任何模块系统。
//
// 模型只有三件事：
//   1. 翻成什么 —— 「偏好」，只全局一个：跟随系统 / 浅色 / 深色
//   2. 要不要处理这一页 —— 全局是「自动」（检测说了算），站点是「断言」（你说了算，不检测）
//   3. 怎么处理 —— 〔优先尝试站点自带的主题切换〕×〔滤镜反转 ｜ 颜色映射〕

const METHODS = ["filter", "remap"];
const PREFERENCES = ["system", "light", "dark"];

// 读不到存储时的开箱默认：启用 × 优先原生 × 滤镜反转 × 跟随系统。
const DEFAULT_GLOBAL = { enabled: true, preferNative: true, method: "filter", preference: "system" };

function isMethod(v) {
  return METHODS.indexOf(v) !== -1;
}

function isPreference(v) {
  return PREFERENCES.indexOf(v) !== -1;
}

// 把存储里的任意值洗成合法形状。认不出的一律返回 null，等于「没设过」——
// 存储里遗留的字符串取值会因此落到默认，不需要迁移代码。
// 站点级没有「偏好」这一项：偏好是全局的，站点只管「这一页是处理还是不处理、用哪个手段」。
function normalizeSetting(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.enabled !== "boolean") return null;
  if (!isMethod(raw.method)) return null;
  return { enabled: raw.enabled, preferNative: !!raw.preferNative, method: raw.method };
}

// 全局 = 站点那三项 + 偏好。偏好是后加进来的字段，早先存下的 global 里没有它——
// 「少一个字段」不等于「这条设置是坏的」，所以这一项缺了就按默认补，不是把整条扔掉。
function normalizeGlobal(raw) {
  const base = normalizeSetting(raw);
  if (!base) return null;
  return { ...base, preference: isPreference(raw.preference) ? raw.preference : DEFAULT_GLOBAL.preference };
}

// 「跟随系统」要问系统，systemIsDark 由调用方给（浏览器里就是 prefers-color-scheme 的匹配结果）。
// 问不到时按浅色算——没有依据时猜错的方向是把页面翻黑。
function resolvePreference(preference, systemIsDark) {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemIsDark ? "dark" : "light";
}

// 决定这一页该怎么办。纯函数。preferDark = 这一页最终要翻成深色。
function resolveSetting(global, site, systemIsDark) {
  const preferDark = resolvePreference(global.preference, systemIsDark) === "dark";
  // 站点有自己的设置（不是「跟随全局」）时，站点说了算，且不检测
  if (site) {
    if (!site.enabled) return { action: "none", preferDark };
    return { action: "force", preferNative: site.preferNative, method: site.method, preferDark };
  }
  // 「跟随全局」＝ 存储里该站的键不存在
  if (!global.enabled) return { action: "none", preferDark };
  return { action: "auto", preferNative: global.preferNative, method: global.method, preferDark };
}

const MODEL = {
  METHODS, PREFERENCES, DEFAULT_GLOBAL,
  isMethod, isPreference, normalizeSetting, normalizeGlobal, resolvePreference, resolveSetting,
};
if (typeof module !== "undefined") module.exports = MODEL;
