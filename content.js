// =============================================================================
// Light or Night / 颠倒黑白 — Content Script（派生自 Marcin Kleczek 的 Don't! Paint it black，MIT）
// Three-mode architecture: Native Switch → CSS Filter → DOM Remap
//
// Author: Marcin Kleczek <marcin.kleczek@gmail.com>
// License: MIT
// =============================================================================

// --- 配色 ---
//
// 基准是两条通用标准，不是某个人的偏好：
//   1. WCAG AA —— 正文压在任何一个底上都要 >= 4.5:1；
//   2. 浅色主题的惯例 —— 色块取主流设计系统里 100/200 那一档的浓淡，文字取「同色相的深色」，
//      也就是浅蓝底配深蓝字那种 chip。
// 实测落在这两条线之上（色块对页面底 1.41:1，正好夹在 Tailwind blue-100 的 1.22 和 blue-200 的 1.42 之间）。
//
// 个人耐受规则（L* < 31 避开、C* >= 44 且 S >= 0.70 避开）只当**复核**：先按上面两条立住，
// 再确认没顺手踩到那条线——不是拿它当设计依据。
//
// Solarized 只剩中性底色在用（base3 奶油底是主角）；它自带的 8 个强调色整个弃用：按第 2 条
// 本就不该有固定强调色板（换个色相就等于改掉站点的品牌色），何况那 8 个里多数本身就踩耐受线。
const SOL = {
  base03:  [0, 43, 54],   base02: [7, 54, 66],
  base01:  [88, 110, 117], base00: [101, 123, 131],
  base0:   [131, 148, 150], base1: [147, 161, 161],
  base2:   [238, 232, 213], base3: [253, 246, 227],
};

// 三档目标定在 CIELAB。定 L* 而不是 HSL 的 L 是有原因的：L* 只由相对亮度决定，所以任何色相
// 落点都一样深浅——用 HSL 时黄色系会被留到跟奶油底几乎同深，色块直接糊掉。
// 三档都满足 L* >= 31、C* < 44，与原始色相无关。
//
// 三档都必须**幂等**：MutationObserver 会对自己写过的 style 再跑一遍 processElement
// （见「已知边界」的 MutationObserver 一条），所以输出值再喂回这套函数必须原样返回 null，
// 否则颜色会被二次映射（旧版 base2 边框就会被二次映射成 base1）。
const TINT = {
  // 色块/按钮底：L* 84 比奶油底低 13，是「浅色底」而不是另一种饱和块。
  // 彩度上限 25 是实测的折中：浅色底能承载的彩度受 sRGB 色域限制，红/橙/蓝/靛/粉到 25 就封顶，
  // 放到 35 也不会变；但黄/绿/青/紫/金还能再彩一档——那几个恰好是最容易显吵的色相，所以不再往上放。
  surface: { L: 84, C: 25 },
  // 文字/图标：奶油底上 7.52:1、浅色块上 5.31:1，两处都过 AA（L* 定了，对比度就定了，跟彩度无关）
  text:    { L: 34, C: 30 },
  // 边框：在奶油底和浅色块上都看得见（对比 2.13:1 / 1.51:1）
  border:  { L: 70, C: 18 },
};
// 感知彩度低于此值就当「无彩」。这一条是配色的分水岭：
// 底无彩时正文只要满足明暗差就够了；到了 20 以上底色算「带彩」，正文就必须跟底色同色相，
// 否则色相对冲——见 remapText 的第一个分支。
// 常见深色主题底（#0c0c0c、slate-900、github dark 这些）都在 20 以下，所以它们走奶油梯级。
const CHROMA_NEUTRAL = 20;

// 中性底（没有色相可言的深色面）不一律压成同一个奶油色——深色主题就是靠那点亮度差
// 区分页面 / 卡片 / 面板 / 代码块的，全压成同一个颜色这些层次就没了
// （实测：10 个常见主题底里有 9 个会变得和页面底色一模一样）。
// 所以按原来的暗度分档，压成一条奶油梯级：越暗的档越接近奶油底。
// 档位都落在 L* 83~97，浅到压在里面的正文稳过 AA（最深的 83 上仍有余量）。
// 超过 0.2 的中性色已经算浅色，不动。
const BASE_HUE = hueOf(SOL.base3), BASE_CHROMA = chromaOf(SOL.base3);
const NEUTRAL_STEPS = [[0.004, 97], [0.006, 94], [0.009, 91], [0.013, 88], [0.02, 85], [0.2, 83]];
// 无彩底（奶油底）上的正文色。基准是 WCAG：压在奶油底上 7.52:1、压在浅色块上 5.31:1，两处都过 AA。
// 底带彩时不用它——那时正文要跟底色同色相，见 remapText。
const INK = [62, 83, 90];

// --- State ---

let state = {
  isDark: false,
  isApplied: false,
  activeMode: null,       // "native" | "filter" | "remap"
  nativeSignals: [],
  lsSwitch: null,         // 站点把主题存在 localStorage 时的浅色值（最后手段那一档）
  appliedMode: null,      // 本次生效用的是哪个「翻转模式」（设置一变要判断是否重来）
  autoApplied: false,     // 当前这次应用是自动生效的，还是用户手点的
  applying: false,        // native 的切换+验证是异步的，用它挡住并发重入
};
let observer = null;
const OBSERVER_CONFIG = {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ["class", "style", "src", "srcset"],
};
// 整页滤镜 + 图片反向滤镜用的是同一个值，所以它**必须是对合的**（F(F(x)) = x）。
// invert(100%) 与 hue-rotate(180deg) 各自对合、且可交换，所以这个组合是；
// 而 sepia/saturate/brightness 任何一项都会破坏对合（这正是缺陷 ②）。
// 注意它并非像素级精确：中间结果超出色域时会被钳制，钳制不可逆，所以全饱和原色仍有偏差。
// 灰阶（页面的大头）偏差为 0，实测图像还原得和原图几乎一样。
const SOLARIZE_FILTER = "invert(100%) hue-rotate(180deg)";

// =============================================================================
// COLOR UTILITIES
// =============================================================================

function parseColor(str) {
  if (!str || str === "transparent" || str === "rgba(0, 0, 0, 0)") return null;
  let m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  m = str.match(/hsla?\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%/);
  if (m) return hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
  m = str.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    const h = m[1];
    if (h.length === 3) return [parseInt(h[0]+h[0],16), parseInt(h[1]+h[1],16), parseInt(h[2]+h[2],16)];
    if (h.length >= 6) return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  return null;
}

function hslToRgb(h, s, l) {
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function luminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function toCSS([r, g, b]) { return `rgb(${r}, ${g}, ${b})`; }
function isDark(rgb) { return luminance(rgb) < 0.2; }
function luminanceQuick(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function contrastRatio(l1, l2) { return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }

// CIELAB（D65）。选这个空间有两个理由：L* 只由相对亮度决定（WCAG 的对比度也是按相对亮度算的），
// 而且定在同一 L* 上，任何色相落点都一样深浅——用 HSL 就不行。
function labOf([r, g, b]) {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750;
  const Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function chromaOf(rgb) { const [, a, b] = labOf(rgb); return Math.hypot(a, b); }
function hueOf(rgb) { const [, a, b] = labOf(rgb); return Math.atan2(b, a); }

// 已经落在目标档位附近（±2 个色阶）就返回 null 表示「不用改」，用来吞 LAB↔sRGB 的 8bit 取整噪声。
// 这个门是必须的：MutationObserver 会对扩展自己写过的 style 再跑一遍 processElement，
// 没有它每次重跑都会把颜色推几个色阶——看不出来，但样式一直在变，等于每次重跑都白写一遍。
function settle(rgb, target) {
  return rgb.every((v, i) => Math.abs(v - target[i]) <= 2) ? null : target;
}

// 调档 + 落到稳定值：输出再喂回一次不会变，这是上面那个门要求的性质
function tintStable(rgb, targetL, maxC) { return settle(rgb, tintTo(rgb, targetL, maxC)); }

// LAB 的 (L*, C*, 色相角) 转成**未钳制**的线性 sRGB——可能出界，由调用方决定怎么收
function lchToLinear(L, c, hue) {
  const fy = (L + 16) / 116, fx = fy + (c * Math.cos(hue)) / 500, fz = fy - (c * Math.sin(hue)) / 200;
  const inv = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  return [
    X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314,
    X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560,
    X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252,
  ];
}

// (L*, C*, 色相角) → sRGB。
function lchToCSS(L, c, hue) {
  let lin = lchToLinear(L, c, hue);
  // 落在色域外先**降彩度**收回来：光靠钳制会把明度和色相一起带偏，而且往返一次不可逆，
  // 同一个值回炉会得到另一个值，颜色就一直漂。降彩度是连续的，收得住。
  for (let i = 0; i < 10 && lin.some((v) => v < -0.002 || v > 1.002); i++) {
    c *= 0.85;
    lin = lchToLinear(L, c, hue);
  }
  // 最后那道钳制只是兜底：本代码用到三档目标时降彩度总会先收敛，实际碰不到
  return lin.map((v) => { const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(s * 255))); });
}

// 保留色相角，把明度定到 targetL、彩度压到 maxC（只压不抬）
function tintTo(rgb, targetL, maxC) {
  const [, a, b] = labOf(rgb);
  return lchToCSS(targetL, Math.min(Math.hypot(a, b), maxC), Math.atan2(b, a));
}

// =============================================================================
// DARK PAGE DETECTION
// =============================================================================

function isTransparentColor(cssColor) {
  if (!cssColor || cssColor === "transparent") return true;
  const m = cssColor.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
  return !!m && parseFloat(m[1]) === 0;
}

// 从 el 向上找第一个真正画了背景的元素（alpha 为 0 视为没画）
function firstPaintedBackground(el) {
  for (let c = el; c; c = c.parentElement) {
    const raw = getComputedStyle(c).backgroundColor;
    if (isTransparentColor(raw)) continue;
    const rgb = parseColor(raw);
    if (rgb) return rgb;
  }
  return null;
}

function detectDarkPage() {
  // 以 body 的有效背景为准：body 是内容容器，html 只是兜底。
  // 反过来（html 深色就当整页深色）会把 meshy.ai 那种 body/main 全浅、
  // 只在 html 上挂深色兜底的站点误判。
  const pageBg = firstPaintedBackground(document.body);
  if (pageBg) return isDark(pageBg);

  // 不采信 meta[theme-color]：那是站点给浏览器 UI 配的品牌色，
  // 浅色页配一个深色品牌色很常见。
  // body 和 html 都没画背景时（底色画在别的容器上），才退回这个启发式。
  let darkCount = 0;
  const samples = document.querySelectorAll("header, nav, main, [class*='dark'], [class*='Dark']");
  for (const el of Array.from(samples).slice(0, 5)) {
    const bg = parseColor(getComputedStyle(el).backgroundColor);
    if (bg && isDark(bg)) darkCount++;
  }
  return darkCount >= 2;
}

// =============================================================================
// MODE 1: NATIVE THEME DETECTION & SWITCH
// =============================================================================

const DARK_WORD_RE = /dark|night|dim|black/i;
const DARK_LIGHT_WORDS = [["dark", "light"], ["night", "day"], ["dim", "bright"], ["black", "white"]];
const THEME_LS_KEYS = ["theme", "color-theme", "colorMode", "color-mode", "darkMode",
  "dark-mode", "data-theme", "night-mode", "appearance", "colorScheme", "color-scheme"];

// ---------- 站点浅色开关的发现 ----------
// 不硬写 "light"：去站点自己的样式表里找它真正定义过的浅色值。
// 找不到就宁可不动——写一个站点不认识的 "light" 会把它切进无样式状态。

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 保大小写：dark→light、DARK→LIGHT、Dark→Light
function matchCase(sample, word) {
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  if (sample.charAt(0) === sample.charAt(0).toUpperCase()) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

// "nv-dark" → ["nv-light"]；"night" → ["day"]
function lightCounterparts(value) {
  const out = [];
  for (const [dark, light] of DARK_LIGHT_WORDS) {
    if (!new RegExp(dark, "i").test(value)) continue;
    out.push(value.replace(new RegExp(dark, "gi"), (m) => matchCase(m, light)));
  }
  return out;
}

// 站点全部选择器文本（含 @media / @supports 里嵌的）
function collectSelectorText() {
  let acc = "";
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText) acc += rule.selectorText + "\n";
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch (e) { /* 跨域样式表读不到 */ }
  }
  return acc;
}

function selectorMentionsClass(selectorText, cls) {
  return new RegExp("\\." + escapeRegExp(cls) + "(?![\\w-])").test(selectorText);
}

// [data-theme="dark"] 与 [data-theme=dark] 两写都要认
function selectorAttrValues(selectorText, attr) {
  const re = new RegExp("\\[" + escapeRegExp(attr) + "\\s*=\\s*[\"']?([^\"'\\]\\s]+)", "g");
  const found = new Set();
  let m;
  while ((m = re.exec(selectorText))) found.add(m[1]);
  return Array.from(found);
}

// 先按词形对应找（night 该配 day，而不是随便一个 light），找不到再退到该属性定义过的其它非深色值。
// 顺序不能反：「站点自己那套命名」比「通用词 light」更可信——站点可能给别的组件另定义了一份 light。
function resolveLightValue(darkValue, definedValues) {
  for (const alt of lightCounterparts(darkValue)) {
    if (definedValues.indexOf(alt) !== -1) return alt;
  }
  const others = definedValues.filter((v) => v !== darkValue && !DARK_WORD_RE.test(v) && !/^auto$/i.test(v));
  return others.find((v) => /^light$/i.test(v)) || others.find((v) => /^day$/i.test(v)) || others[0] || null;
}

// 返回的开关按「站点自己定义过的浅色值」来定，不写死字符串。
// 不扫 @media (prefers-color-scheme)：那种站点没有可切的东西，插 <meta name="color-scheme">
// 对媒体查询毫无作用（实测：color-scheme 影响不了 prefers-color-scheme 的匹配）。
function detectNativeThemeSupport() {
  const signals = [];
  const html = document.documentElement;
  const body = document.body;
  const selectorText = collectSelectorText();
  const taken = new Set();   // "tag|attr" 去重：GitHub 那条和下面的通用循环会撞

  // A. GitHub 式：data-color-mode 是开关，data-light-theme 存的就是站点自己的浅色主题名
  const colorMode = html.getAttribute("data-color-mode");
  const lightTheme = html.getAttribute("data-light-theme");
  if (colorMode && lightTheme && (DARK_WORD_RE.test(colorMode) || /^auto$/i.test(colorMode))) {
    signals.push({ type: "data-attr", el: "html", attr: "data-color-mode", from: colorMode, to: lightTheme });
    taken.add("html|data-color-mode");
  }

  for (const [tag, el] of [["html", html], ["body", body]]) {
    if (!el) continue;

    // B. 类名：html/body 上任何带深色词的类，去找站点定义过的浅色对应类
    //    （nv-dark → nv-light 走这条；类名正好是 dark 且站点没定义对应类时，退回「摘掉」）
    for (const cls of Array.from(el.classList)) {
      if (!DARK_WORD_RE.test(cls)) continue;
      const alt = lightCounterparts(cls).find((v) => selectorMentionsClass(selectorText, v));
      if (alt) signals.push({ type: "class-replace", el: tag, from: cls, to: alt });
      else if (/^dark$/i.test(cls)) signals.push({ type: "class-remove", el: tag, className: cls });
    }

    // C. data-* 属性：属性名得像主题开关，值得含深色词
    for (const attr of Array.from(el.attributes)) {
      if (!/^data-/.test(attr.name)) continue;
      if (!/theme|mode|color|scheme|appearance/i.test(attr.name)) continue;
      if (!DARK_WORD_RE.test(attr.value)) continue;
      if (taken.has(tag + "|" + attr.name)) continue;
      const to = resolveLightValue(attr.value, selectorAttrValues(selectorText, attr.name));
      if (!to) continue;
      signals.push({ type: "data-attr", el: tag, attr: attr.name, from: attr.value, to });
      taken.add(tag + "|" + attr.name);
    }
  }

  return signals;
}

let nativeOriginals = [];

function elementFor(sig) {
  return sig.el === "html" ? document.documentElement : document.body;
}

function applyNativeSwitch(signals) {
  nativeOriginals = [];
  for (const sig of signals) {
    const el = elementFor(sig);
    switch (sig.type) {
      case "data-attr":
        nativeOriginals.push({ ...sig, originalValue: el.getAttribute(sig.attr) });
        el.setAttribute(sig.attr, sig.to);
        break;
      case "class-replace":
        if (!el.classList.contains(sig.from)) break;
        nativeOriginals.push(sig);
        el.classList.replace(sig.from, sig.to);
        break;
      case "class-remove":
        if (!el.classList.contains(sig.className)) break;
        nativeOriginals.push(sig);
        el.classList.remove(sig.className);
        break;
    }
  }
}

// 只把 DOM 改回去，不 reload
function revertNativeSwitch() {
  for (const sig of nativeOriginals) {
    const el = elementFor(sig);
    switch (sig.type) {
      case "data-attr":
        if (sig.originalValue != null) el.setAttribute(sig.attr, sig.originalValue);
        else el.removeAttribute(sig.attr);
        break;
      case "class-replace":
        el.classList.replace(sig.to, sig.from);
        break;
      case "class-remove":
        el.classList.add(sig.className);
        break;
    }
  }
  nativeOriginals = [];
}

function removeNativeSwitch() {
  revertNativeSwitch();
  location.reload();
}

// ---------- 切换后的验证 ----------

const VERIFY_DELAYS = [0, 120, 400, 900];

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// 站点重渲染要时间，所以分几次采样：只要有一次不再算深色就算切成功。
async function verifyBecameLight() {
  let waited = 0;
  for (const at of VERIFY_DELAYS) {
    if (at > waited) { await delay(at - waited); waited = at; }
    if (!detectDarkPage()) return true;
  }
  return false;
}

// ---------- localStorage 这一档（最后手段） ----------
// 它是唯一会永久写进站点自己存储的一档，而且必须 reload 才能生效，
// 所以：只在 DOM 层一点可切的都没有时才走；先记原值；下次加载时若页面仍未变浅就写回去。

const LS_TRIAL_KEY = "dpib-ls-trial";
const LS_FAILED_KEY = "dpib-ls-failed";

function sessionGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
function sessionSet(key, val) { try { sessionStorage.setItem(key, val); } catch (e) {} }
function sessionDel(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

function discoverLocalStorageSwitch() {
  for (const key of THEME_LS_KEYS) {
    let value = null;
    try { value = localStorage.getItem(key); } catch (e) { continue; }
    if (!value || !DARK_WORD_RE.test(value)) continue;
    const to = lightCounterparts(value).find((v) => v !== value);
    if (to) return { key, from: value, to };
  }
  return null;
}

async function readUndoMap() {
  try { const s = await chrome.storage.sync.get({ lsUndo: {} }); return s.lsUndo || {}; } catch (e) { return {}; }
}

// 结算上一次的试验：页面变浅了算成功，把原值记进 lsUndo，好让「撤销」还的回去；
// 没变浅就把原值写回、记下本站已失败（本标签页不再重试）。
async function settleLocalStorageTrial() {
  const raw = sessionGet(LS_TRIAL_KEY);
  if (!raw) return;
  sessionDel(LS_TRIAL_KEY);
  let trial = null;
  try { trial = JSON.parse(raw); } catch (e) { return; }
  if (trial.host !== hostKey()) return;

  if (!detectDarkPage()) {
    try {
      const map = await readUndoMap();
      map[trial.host] = { key: trial.key, original: trial.original, auto: !!trial.auto };
      await chrome.storage.sync.set({ lsUndo: map });
    } catch (e) {}
    return;
  }

  try { localStorage.setItem(trial.key, trial.original); } catch (e) {}
  sessionSet(LS_FAILED_KEY, trial.host);
  location.reload();
}

// 撤销时把站点自己的主题值还回去
async function restoreLocalStorageUndo() {
  const host = hostKey();
  try {
    const map = await readUndoMap();
    const undo = map[host];
    if (!undo) return;
    try { localStorage.setItem(undo.key, undo.original); } catch (e) {}
    delete map[host];
    await chrome.storage.sync.set({ lsUndo: map });
  } catch (e) {}
}

async function tryLocalStorageSwitch(isAuto) {
  const host = hostKey();
  if (sessionGet(LS_FAILED_KEY) === host) return false;
  const map = await readUndoMap();
  if (map[host]) return false;                    // 本站已经改过一次并生效了，别反复写
  const sw = discoverLocalStorageSwitch();
  if (!sw) return false;
  sessionSet(LS_TRIAL_KEY, JSON.stringify({ host, key: sw.key, original: sw.from, auto: !!isAuto }));
  try { localStorage.setItem(sw.key, sw.to); } catch (e) { sessionDel(LS_TRIAL_KEY); return false; }
  location.reload();
  return true;
}

// 切换 + 验证：没真的变浅就当没切过，把 DOM 改回去，别把站点留在坏状态
async function applyNative(isAuto) {
  if (state.nativeSignals.length) {
    applyNativeSwitch(state.nativeSignals);
    if (await verifyBecameLight()) return true;
    revertNativeSwitch();
  }
  return tryLocalStorageSwitch(isAuto);
}

// =============================================================================
// MODE 2: CSS FILTER
// =============================================================================

function applyFilterMode() {
  if (document.getElementById("dpib-filter")) return;
  const style = document.createElement("style");
  style.id = "dpib-filter";
  style.textContent = `
    html {
      filter: ${SOLARIZE_FILTER} !important;
    }
    /* Counter-filter: restore original appearance for media */
    img:not([data-dpib-dark]),
    video,
    canvas,
    picture:not([data-dpib-dark]) {
      filter: ${SOLARIZE_FILTER} !important;
    }
    /* Dark images stay inverted (no counter-filter) */
    img[data-dpib-dark],
    picture[data-dpib-dark] {
      filter: none !important;
    }
  `;
  document.head.appendChild(style);
  classifyImagesForFilter();
}

function classifyImagesForFilter() {
  for (const img of document.querySelectorAll("img")) {
    classifySingleImage(img);
  }
  // Lazy-load observer
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const img = e.target;
        if (img.complete && img.naturalWidth) classifySingleImage(img);
        else img.addEventListener("load", () => classifySingleImage(img), { once: true });
      }
    });
    for (const img of document.querySelectorAll("img")) {
      if (!img.complete) io.observe(img);
    }
  }
}

function classifySingleImage(img) {
  if (img.dataset.dpibClassified) return;
  img.dataset.dpibClassified = "1";
  if (!img.complete || !img.naturalWidth) {
    img.addEventListener("load", () => { img.dataset.dpibClassified = ""; classifySingleImage(img); }, { once: true });
    return;
  }
  if (img.naturalWidth < 100 && img.naturalHeight < 100) return;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    const a = analyzeEdges(ctx, canvas.width, canvas.height);
    if (a.avgLum < 0.2 && a.opaqueCount > 0) {
      img.setAttribute("data-dpib-dark", "1");
    }
  } catch (e) { /* CORS */ }
}

function removeFilterMode() {
  const el = document.getElementById("dpib-filter");
  if (el) el.remove();
  for (const img of document.querySelectorAll("[data-dpib-dark]")) img.removeAttribute("data-dpib-dark");
  for (const img of document.querySelectorAll("[data-dpib-classified]")) img.removeAttribute("data-dpib-classified");
}

// =============================================================================
// MODE 3: DOM REMAP (Precise Solarized)
// =============================================================================

// --- Remap functions ---

function remapBackground(rgb) {
  // 有色相的底一律收成同色相的浅色块。不能按亮度放行——浅色不等于不刺眼，
  // 亮黄这种高饱和的照样很吵，放行等于留了个口子。
  if (chromaOf(rgb) >= CHROMA_NEUTRAL) return tintStable(rgb, TINT.surface.L, TINT.surface.C);
  // 中性底：按原来的暗度落到奶油梯级上
  const lum = luminance(rgb);
  for (const [edge, L] of NEUTRAL_STEPS) if (lum <= edge) return settle(rgb, lchToCSS(L, BASE_CHROMA, BASE_HUE));
  return null;
}

// surfaceHue：本元素的底色被重映射成彩色块时，那块底的色相角；不是彩色块就传 null。
// 压在彩色块上的**浅色中性字**要跟底色同色相，否则色相对冲——就是浅蓝底配深蓝字那种 chip 的做法。
// （本身带色相的字不走这条，见下。）
function remapText(rgb, surfaceHue) {
  // 压在彩色块上的字，一律跟那块底同色相。这条必须排在最前：
  //   · 排在后面的话，输入可能先被别的分支认领，两次处理按不同色相走，颜色就会漂；
  //   · 彩色块里的字色常常是从祖先继承的，而祖先的字色早被本扩展压成墨色了，
  //     那时先判「够深了就别动」会把这类字永远留在墨色上，跟底色对不上。
  if (surfaceHue !== null) return settle(rgb, lchToCSS(TINT.text.L, TINT.text.C, surfaceHue));
  // 无彩底上：带色相的字重画成同色相的深色，不按亮度放行——相对亮度不是「够不够深」的可靠代理：
  // #a855f7 / #3b82f6 / #ef4444 这些最常见的强调色亮度只有 0.21~0.24，看着像「已经够深」，
  // 其实都在中调（L* 50 上下），压在奶油底上只有 2.5~3.7:1。按亮度放行等于把站点的品牌色留在浅底上读不清。
  if (chromaOf(rgb) >= CHROMA_NEUTRAL) return tintStable(rgb, TINT.text.L, TINT.text.C);
  // 已经是深灰的留着（浅色页面上本来就是合格的正文），浅的压成墨色
  return luminance(rgb) < 0.25 ? null : INK;
}

function remapBorder(rgb) {
  const lum = luminance(rgb);
  // 已经是「中性 + 中调」的线，浅色页面上本来就合适，不动——本函数的输出正好落在这里，所以这也让它幂等
  if (lum >= 0.3 && lum <= 0.7 && chromaOf(rgb) < CHROMA_NEUTRAL) return null;
  // 其余（太深、太亮、或带色相）都重画成同色相的一条线：深色主题的暗边框留成暗色会在浅底上看不见，
  // 而 #22c55e 那种中调高饱和的绿边框放行下来，在浅底上依然很吵
  return tintStable(rgb, TINT.border.L, TINT.border.C);
}

// 底色和文字常常不写在同一个元素上：`<div style="background:…"><span>文字</span></div>`、
// `.badge { background }` 配 `.badge span { color }` 都是这个形态。所以自己没实底时要往上找
// 最近的彩色块，里面的字才能跟着那个底色走。
// processTree 按文档顺序走，父级一定先算过，所以这里基本只是查表，不用再读一次样式。
const SURFACE_HUE = new WeakMap();

function surfaceHueFrom(el) {
  if (SURFACE_HUE.has(el)) return SURFACE_HUE.get(el);
  // 兜底：祖先还没进过表（正常流程碰不到）
  const bg = parseColor(getComputedStyle(el).backgroundColor);
  const hue = bg && chromaOf(bg) >= CHROMA_NEUTRAL
    ? hueOf(bg)
    : (el.parentElement ? surfaceHueFrom(el.parentElement) : null);
  SURFACE_HUE.set(el, hue);
  return hue;
}

function cssProp(camel) { return camel.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()); }

const BG_PROPS = ["backgroundColor"];
const TEXT_PROPS = ["color"];
const BORDER_PROPS = ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor"];
const PROCESSED = new WeakSet();

function processElement(el) {
  if (PROCESSED.has(el)) return;
  PROCESSED.add(el);
  const style = getComputedStyle(el);

  // Gradient text
  const bgClip = style.webkitBackgroundClip || style.backgroundClip;
  const isGradientText = bgClip === "text" && style.backgroundImage.includes("gradient");
  if (isGradientText) {
    const colorMatches = style.backgroundImage.match(/rgba?\([^)]+\)/g);
    let ink = INK;
    if (colorMatches) { const fc = parseColor(colorMatches[0]); if (fc && chromaOf(fc) >= CHROMA_NEUTRAL) ink = tintTo(fc, TINT.text.L, TINT.text.C); }
    el.style.setProperty("background-image", "none", "important");
    el.style.setProperty("-webkit-background-clip", "unset", "important");
    el.style.setProperty("background-clip", "unset", "important");
    el.style.setProperty("-webkit-text-fill-color", toCSS(ink), "important");
    el.style.setProperty("color", toCSS(ink), "important");
  }

  // Backgrounds
  let ownBg = false, surfaceHue = null;
  for (const prop of BG_PROPS) {
    const rgb = parseColor(style[prop]); if (!rgb) continue;
    ownBg = true;   // 自己有实底（哪怕是奶油色），就不该再继承祖先的底色色相
    const mapped = remapBackground(rgb);
    if (mapped) el.style.setProperty(cssProp(prop), toCSS(mapped), "important");
    // 注意用「生效色」判色相而不是用 mapped：mapped 为 null 表示「已经到位、不用改」，
    // 那时生效的是原值——第二遍处理时底色正是这种情况，用 mapped 会把色相丢掉。
    const effective = mapped || rgb;
    if (chromaOf(effective) >= CHROMA_NEUTRAL) surfaceHue = hueOf(effective);
  }
  // 自己没有实底（透明）才往上找最近的彩色块——记进表里给子元素用
  if (!ownBg && el.parentElement) surfaceHue = surfaceHueFrom(el.parentElement);
  SURFACE_HUE.set(el, surfaceHue);

  // Text
  if (!isGradientText) {
    for (const prop of TEXT_PROPS) {
      const rgb = parseColor(style[prop]); if (!rgb) continue;
      const mapped = remapText(rgb, surfaceHue);
      if (mapped) el.style.setProperty(cssProp(prop), toCSS(mapped), "important");
    }
  }

  // Borders
  for (const prop of BORDER_PROPS) {
    const rgb = parseColor(style[prop]); if (!rgb) continue;
    const mapped = remapBorder(rgb);
    if (mapped) el.style.setProperty(cssProp(prop), toCSS(mapped), "important");
  }

  // SVG fill/stroke
  if (el instanceof SVGElement) {
    const fill = parseColor(style.fill);
    if (fill && isDark(fill)) {
      const mapped = chromaOf(fill) >= CHROMA_NEUTRAL ? tintStable(fill, TINT.text.L, TINT.text.C) : SOL.base00;
      if (mapped) el.style.setProperty("fill", toCSS(mapped), "important");
    }
    const stroke = parseColor(style.stroke);
    if (stroke && isDark(stroke)) el.style.setProperty("stroke", toCSS(SOL.base1), "important");
  }

  // Gradient backgrounds (non-text)
  if (!isGradientText) {
    const bgImage = style.backgroundImage;
    if (bgImage && bgImage !== "none") {
      if (bgImage.includes("gradient")) {
        el.style.setProperty("background-image", "none", "important");
        const bg = parseColor(style.backgroundColor);
        if (!bg || luminance(bg) < 0.2) {
          // 渐变被抹平后拿第一个色停当代表：带色相就留色相，否则退回奶油底
          const first = bgImage.match(/rgba?\([^)]+\)/);
          const fc = first && parseColor(first[0]);
          el.style.setProperty("background-color", toCSS(fc && chromaOf(fc) >= CHROMA_NEUTRAL ? tintTo(fc, TINT.surface.L, TINT.surface.C) : SOL.base3), "important");
        }
      } else if (bgImage.includes("url(")) {
        // Background image URL — analyze and solarize if dark
        solarizeBackgroundImage(el, bgImage);
      }
    }
  }

  // Box shadows
  const shadow = style.boxShadow;
  if (shadow && shadow !== "none") {
    el.style.setProperty("box-shadow", shadow.replace(/rgba?\([^)]+\)/g, (match) => {
      const rgb = parseColor(match); if (rgb && isDark(rgb)) return "rgba(101, 123, 131, 0.15)"; return match;
    }), "important");
  }
}

function processTree(root) {
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  processElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) processElement(walker.currentNode);
}

// --- Background image solarization ---

function solarizeBackgroundImage(el, bgImage) {
  const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
  if (!urlMatch) return;
  const url = urlMatch[1];
  // Skip data URIs that are tiny (likely 1px spacers)
  if (url.startsWith("data:") && url.length < 200) return;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    if (img.naturalWidth < 100 && img.naturalHeight < 100) return;
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      const a = analyzeEdges(ctx, canvas.width, canvas.height);
      if (a.avgLum < 0.2 && a.opaqueCount > 0) {
        el.style.setProperty("filter", SOLARIZE_FILTER, "important");
      }
    } catch (e) { /* CORS / tainted */ }
  };
  img.onerror = () => {}; // silent fail
  img.src = url;
}

// --- Remap mode global CSS ---

// 这里只放逐元素重映射够不着的东西——伪元素（滚动条、选区、placeholder）。
// 输入框、链接、代码块一律交给 processElement：那些元素有真实样式，硬编码颜色只会跟站点品牌色打架，
// 而且逐元素那套能把站点的色相留住。
function injectRemapStyles() {
  if (document.getElementById("dpib-remap-global")) return;
  const style = document.createElement("style");
  style.id = "dpib-remap-global";
  style.textContent = `
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: #eee8d5 !important; }
    ::-webkit-scrollbar-thumb { background: #93a1a1 !important; border-radius: 5px; }
    ::-webkit-scrollbar-thumb:hover { background: #657b83 !important; }
    ::selection { background: #eee8d5 !important; color: #586e75 !important; }
    input::placeholder, textarea::placeholder { color: #93a1a1 !important; }
  `;
  document.head.appendChild(style);
}

function removeRemapStyles() {
  const el = document.getElementById("dpib-remap-global");
  if (el) el.remove();
}

// =============================================================================
// IMAGE ANALYSIS (shared by filter + remap modes)
// =============================================================================

function analyzeEdges(ctx, w, h) {
  const edge = Math.max(1, Math.round(Math.min(w, h) * 0.1));
  const regions = [
    ctx.getImageData(0, 0, w, edge),
    ctx.getImageData(0, h - edge, w, edge),
    ctx.getImageData(0, edge, edge, h - 2 * edge),
    ctx.getImageData(w - edge, edge, edge, h - 2 * edge),
  ];
  let totalLum = 0, opaqueCount = 0, transparentCount = 0;
  for (const region of regions) {
    const d = region.data;
    for (let i = 0; i < d.length; i += 16) {
      if (d[i + 3] < 128) { transparentCount++; continue; }
      totalLum += luminanceQuick(d[i], d[i + 1], d[i + 2]);
      opaqueCount++;
    }
  }
  const total = opaqueCount + transparentCount;
  return {
    avgLum: opaqueCount > 0 ? totalLum / opaqueCount : 1,
    transparentRatio: total > 0 ? transparentCount / total : 0,
    opaqueCount,
  };
}

function shouldSolarizeImage(a) {
  if (a.avgLum < 0.2 && a.opaqueCount > 0) return true;
  if (a.transparentRatio > 0.5 && a.avgLum > 0.7 && a.opaqueCount > 10) return true;
  return false;
}

function solarizeImage(img) {
  if (img.dataset.solarizeChecked) return;
  img.dataset.solarizeChecked = "1";
  if (!img.complete || !img.naturalWidth) {
    img.addEventListener("load", () => { img.dataset.solarizeChecked = ""; solarizeImage(img); }, { once: true });
    return;
  }
  if (img.naturalWidth < 100 && img.naturalHeight < 100) return;
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    if (shouldSolarizeImage(analyzeEdges(ctx, canvas.width, canvas.height))) {
      img.style.setProperty("filter", SOLARIZE_FILTER, "important");
    }
  } catch (e) { /* CORS */ }
}

function processImages() {
  for (const img of document.querySelectorAll("img")) solarizeImage(img);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        e.target.dataset.solarizeChecked = "";
        if (e.target.complete && e.target.naturalWidth) solarizeImage(e.target);
        else e.target.addEventListener("load", () => { e.target.dataset.solarizeChecked = ""; solarizeImage(e.target); }, { once: true });
      }
    });
    for (const img of document.querySelectorAll("img")) { if (!img.complete) io.observe(img); }
  }
}

// =============================================================================
// MUTATION OBSERVER (infinite loop safe)
// =============================================================================

function createObserver() {
  observer = new MutationObserver((mutations) => {
    observer.disconnect();
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (state.activeMode === "remap") processTree(node);
        // Images for both remap and filter modes
        if (state.activeMode === "remap") {
          if (node.tagName === "IMG") solarizeImage(node);
          for (const img of node.querySelectorAll("img")) solarizeImage(img);
        } else if (state.activeMode === "filter") {
          if (node.tagName === "IMG") classifySingleImage(node);
          for (const img of node.querySelectorAll("img")) classifySingleImage(img);
        }
      }
      if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) {
        if (state.activeMode === "remap") { PROCESSED.delete(m.target); processElement(m.target); }
        if (m.target.tagName === "IMG" && (m.attributeName === "src" || m.attributeName === "srcset")) {
          if (state.activeMode === "remap") { m.target.dataset.solarizeChecked = ""; solarizeImage(m.target); }
          if (state.activeMode === "filter") { m.target.dataset.dpibClassified = ""; classifySingleImage(m.target); }
        }
      }
    }
    observer.observe(document.body, OBSERVER_CONFIG);
  });
}

function startObserving() { if (!observer) createObserver(); observer.observe(document.body, OBSERVER_CONFIG); }
function stopObserving() { if (observer) { observer.disconnect(); observer = null; } }

// =============================================================================
// CONTRAST VALIDATION
// =============================================================================

function getEffectiveBackground(el) {
  let c = el;
  while (c && c !== document.documentElement) {
    const bg = parseColor(getComputedStyle(c).backgroundColor);
    if (bg && luminance(bg) > 0.001) return bg;
    c = c.parentElement;
  }
  return parseColor(getComputedStyle(document.documentElement).backgroundColor) || [255, 255, 255];
}

function validateContrast() {
  const issues = []; let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode;
    // hasDirectText
    let hasText = false;
    for (const ch of el.childNodes) { if (ch.nodeType === Node.TEXT_NODE && ch.textContent.trim()) { hasText = true; break; } }
    if (!hasText) continue;
    // isVisible
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    checked++;
    const tc = parseColor(st.color) || parseColor(st.webkitTextFillColor); if (!tc) continue;
    const bg = getEffectiveBackground(el);
    const ratio = contrastRatio(luminance(tc), luminance(bg));
    if (ratio < 4.5) {
      issues.push({ tag: el.tagName.toLowerCase(), text: el.textContent.trim().slice(0, 50),
        ratio: Math.round(ratio * 100) / 100, textColor: toCSS(tc), bgColor: toCSS(bg),
        level: ratio < 3 ? "critical" : "warning" });
    }
  }
  return { checked, passed: checked - issues.length, issues: issues.slice(0, 30) };
}

// =============================================================================
// COLOR SCHEME
// =============================================================================

// 站点声明了 color-scheme: dark 时，即使页面被翻浅，滚动条和表单控件仍按深色渲染。
// 用 inline + important 压过站点样式表；移除时还原站点原本的 inline 值。
let savedColorScheme = null;

function applyLightColorScheme() {
  const style = document.documentElement.style;
  if (savedColorScheme === null) savedColorScheme = style.getPropertyValue("color-scheme");
  style.setProperty("color-scheme", "light", "important");
}

function removeLightColorScheme() {
  if (savedColorScheme === null) return;
  const style = document.documentElement.style;
  if (savedColorScheme) style.setProperty("color-scheme", savedColorScheme);
  else style.removeProperty("color-scheme");
  savedColorScheme = null;
}

// =============================================================================
// APPLY / REMOVE ORCHESTRATORS
// =============================================================================

function startFilterMode() {
  applyFilterMode();
  startObserving();
}

function startRemapMode() {
  injectRemapStyles();
  stopObserving();
  processTree(document.documentElement);
  processImages();
  startObserving();
}

// 按模式跑一遍，返回**实际生效的方法**（"native" | "filter" | "remap"）；关闭或全都失败则 null。
// 「优先 X」的两档失败后会落到兜底，所以返回值不一定是模式本身。
async function runMode(mode, isAuto) {
  switch (mode) {
    case "native":
      return (await applyNative(isAuto)) ? "native" : null;
    case "filter":
      startFilterMode();
      return "filter";
    case "remap":
      startRemapMode();
      return "remap";
    case MODE_NATIVE_FILTER:
      if (await applyNative(isAuto)) return "native";
      startFilterMode();
      return "filter";
    case MODE_NATIVE_REMAP:
      if (await applyNative(isAuto)) return "native";
      startRemapMode();
      return "remap";
    default:   // "off"
      return null;
  }
}

async function apply(mode, isAuto) {
  if (state.isApplied || state.applying) return;
  state.applying = true;
  try {
    const method = await runMode(mode, isAuto);
    if (!method) return;                       // 关闭 / 切不动 → 就当没切过，不谎报成功
    applyLightColorScheme();
    state.activeMode = method;
    state.appliedMode = mode;                  // 记住用的是哪个模式，设置一变好判断要不要重来
    state.isApplied = true;
  } finally {
    state.applying = false;
  }
}

async function remove() {
  const host = hostKey();
  const undo = (await readUndoMap())[host];

  // 「撤销」= 把本站设成「关闭」，否则重载后又会被自动翻回去。
  // localStorage 那一档是同道理：它若是自动改的，也要一并关掉，不然撤销完又会被改回来。
  if (state.autoApplied || (undo && undo.auto)) await writeSiteMode(host, "off");
  state.autoApplied = false;
  removeLightColorScheme();
  if (undo) await restoreLocalStorageUndo();   // 站点的主题值若是扩展改的，还回去

  switch (state.activeMode) {
    case "native":  removeNativeSwitch(); break;
    case "filter":  stopObserving(); removeFilterMode(); break;
    case "remap":   stopObserving(); removeRemapStyles(); location.reload(); break;
    default:        location.reload(); break;
  }
  state.isApplied = false;
  state.activeMode = null;
  state.appliedMode = null;
}

// =============================================================================
// MESSAGE API
// =============================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // all_frames 下每个 iframe 都会收到 popup 的广播消息，谁先回谁算。
  // 让 iframe 也回，popup 会把 iframe 那边的状态当成整页的（看起来像"扩展没生效"），
  // 而点「撤销」会把每个 iframe 都重载一遍。所以只让顶层文档应答。
  if (window !== window.top) return;
  switch (msg.action) {
    case "getStatus":
      // 等 INIT 的 settle + detect 落定，免得在这个窗口里报出初始值
      ready.then(getStatus).then(sendResponse);
      break;
    case "remove":
      ready.then(remove).then(() => sendResponse({ ok: true }));
      break;
    case "settingsChanged":
      ready.then(onSettingsChanged).then(() => sendResponse({ ok: true }));
      break;
    case "validate":
      ready.then(() => sendResponse(validateContrast()));
      break;
    default:
      sendResponse({ error: "unknown action" });
  }
  return true;
});

// =============================================================================
// AUTO APPLY
// =============================================================================

// ---------- 设置 ----------
// 「翻转模式」是唯一的设置概念，取值域全局与本站共用；本站多一个「跟随全局」（= 不写进 sites）。
// 全局存 globalMode，本站覆盖存 sites[host]；不加「不启用」之外的第二个开关——
// 「本站是否生效」和「本站用什么模式」本来就是同一个问题。
const MODES = ["off", "native", "filter", "remap", "native-filter", "native-remap"];
const MODE_NATIVE_FILTER = "native-filter";
const MODE_NATIVE_REMAP = "native-remap";
// 默认：优先用站点自己的浅色主题（零破坏），没有就落滤镜兜底
const DEFAULT_MODE = "native-filter";

// 用 host 而不是 hostname：hostname 不带端口，localhost:8000 和 localhost:3000 会共用一条设置。
// 不含路径——「本站」= 这个域名的整个站。
function hostKey() {
  try { return location.host || ""; } catch (e) { return ""; }
}

function isMode(v) { return MODES.indexOf(v) !== -1; }

async function readSettings() {
  try {
    const raw = await chrome.storage.sync.get({ globalMode: DEFAULT_MODE, sites: {} });
    const sites = {};
    for (const host of Object.keys(raw.sites || {})) {
      if (isMode(raw.sites[host])) sites[host] = raw.sites[host];   // 认不出的值当没设过
    }
    return { globalMode: isMode(raw.globalMode) ? raw.globalMode : DEFAULT_MODE, sites };
  } catch (e) {
    return { globalMode: "off", sites: {} };   // 读不到设置时保守：不动页面
  }
}

// 本站生效的模式 = 本站覆盖值，没设过就跟随全局
function resolveMode(settings, host) {
  const own = settings.sites[host];
  return isMode(own) ? own : settings.globalMode;
}

async function writeSiteMode(host, mode) {
  try {
    const s = await chrome.storage.sync.get({ sites: {} });
    const sites = { ...(s.sites || {}) };
    if (mode === null) delete sites[host];   // null = 跟随全局
    else sites[host] = mode;
    await chrome.storage.sync.set({ sites });
  } catch (e) {}
}

function detect() {
  state.isDark = detectDarkPage();
  state.nativeSignals = state.isDark ? detectNativeThemeSupport() : [];
  state.lsSwitch = state.isDark ? discoverLocalStorageSwitch() : null;
}

async function getStatus() {
  const settings = await readSettings();
  const host = hostKey();
  // localStorage 那一档切成功后会 reload，本次加载里没有任何 DOM 改动，
  // 但页面确实是扩展翻浅的、也能撤销，所以照「已应用」报给 popup——
  // 这样复用现成的「撤销」按钮，不用为它单独加控件。
  const undo = (await readUndoMap())[host];
  const undoActive = !!undo && !state.isDark;
  return {
    isDark: state.isDark,
    isApplied: state.isApplied || undoActive,
    activeMode: state.isApplied ? state.activeMode : (undoActive ? "native" : null),
    host,
    globalMode: settings.globalMode,
    siteMode: isMode(settings.sites[host]) ? settings.sites[host] : null,   // null = 跟随全局
    mode: resolveMode(settings, host),                                      // 本站实际生效的模式
    hasNative: state.nativeSignals.length > 0 || !!state.lsSwitch,
    autoApplied: state.isApplied ? state.autoApplied : !!(undo && undo.auto),
  };
}

async function applyResolved(isAuto) {
  const settings = await readSettings();
  const mode = resolveMode(settings, hostKey());
  if (mode === "off") return;
  await apply(mode, isAuto);
  if (state.isApplied) state.autoApplied = isAuto;
}

async function autoApply() {
  if (window !== window.top) return;   // all_frames 会让每个 iframe 各跑一份，逐帧套滤镜只会套重
  if (state.isApplied || !state.isDark) return;
  await applyResolved(true);
}

async function onSettingsChanged() {
  const settings = await readSettings();
  const mode = resolveMode(settings, hostKey());

  if (state.isApplied) {
    // 已翻转的页面：模式变了就地改不了，整页重来；没变就保持现状
    if (mode !== state.appliedMode) location.reload();
    return;
  }
  if (mode === "off") return;
  detect();
  await applyResolved(true);
}

// =============================================================================
// INIT
// =============================================================================

// 先结算上一次留下的 localStorage 试验，再检测（它若判定失败会自己 reload）。
// ready 供消息监听等待；autoApply 不并进来——它的验证采样最长要 ~1s，不该拖住 popup。
const ready = (async () => {
  // all_frames 下每个 iframe 也会跑这段。但这些状态是整页的、消息也只由顶层应答，
  // 所以只在顶层维护——否则 iframe 会拿着和顶层共享的 sessionStorage 误判那档试验、
  // 甚至自己 reload。
  if (window !== window.top) return;
  await settleLocalStorageTrial();
  detect();
})();

ready.then(() => autoApply());
