// 翻转模型：取值 + 决定这一页该怎么办。
// content.js（内容脚本）与 popup.js（弹窗页）共用这一份，谁都不许再抄一份。
// 末尾的 module.exports 只是为了能在 Node 里 require 它跑单测——扩展侧不加载任何模块系统。
//
// 模型只有两件事：
//   1. 要不要处理这一页 —— 全局是「自动」（检测说了算），站点是「断言」（你说了算，不检测）
//   2. 怎么处理 —— 〔优先尝试站点自带的浅色模式〕×〔滤镜反转 ｜ 颜色映射〕

const METHODS = ["filter", "remap"];

// 读不到存储时的开箱默认：启用 × 优先原生 × 滤镜反转。
const DEFAULT_GLOBAL = { enabled: true, preferNative: true, method: "filter" };

function isMethod(v) {
  return METHODS.indexOf(v) !== -1;
}

// 把存储里的任意值洗成合法形状。认不出的一律返回 null，等于「没设过」——
// 存储里遗留的字符串取值会因此落到默认，不需要迁移代码。
function normalizeSetting(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.enabled !== "boolean") return null;
  if (!isMethod(raw.method)) return null;
  return { enabled: raw.enabled, preferNative: !!raw.preferNative, method: raw.method };
}

// 决定这一页该怎么办。纯函数。
function resolveSetting(global, site) {
  // 站点有自己的设置（不是「跟随全局」）时，站点说了算，且不检测
  if (site) {
    if (!site.enabled) return { action: "none" };
    return { action: "force", preferNative: site.preferNative, method: site.method };
  }
  // 「跟随全局」＝ 存储里该站的键不存在
  if (!global.enabled) return { action: "none" };
  return { action: "auto", preferNative: global.preferNative, method: global.method };
}

const MODEL = { METHODS, DEFAULT_GLOBAL, isMethod, normalizeSetting, resolveSetting };
if (typeof module !== "undefined") module.exports = MODEL;
