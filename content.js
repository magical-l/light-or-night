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

// --- 深色方向的目标色 ---
// 与上面那套完全同构，锚点换成 Solarized 的深色底 base03（上面那套锚的是浅色底 base3）。
// 不是把上面那套取反算出来的：相对亮度在暗端不线性，纯 L* 镜像出来的几档过不了 WCAG AA，
// 所以每个值都单独复算过，理由写在各自下面。
const BASE_HUE_DARK = hueOf(SOL.base03), BASE_CHROMA_DARK = chromaOf(SOL.base03);
// 中性亮底落到一条深色梯级：最亮的输入（白画布）翻到 base03 那一带，越亮的输入翻得越深。
// 和浅色那条一样按**亮度**分档，但门槛全挤在高位——浅色页的背景都落在 L* 90~100（相对亮度 0.78~1）。
// 最后那档 0.17 是兜底：比它亮的都算「浅色页上的中性面」，位置对应浅色那条的 0.2。
const NEUTRAL_STEPS_DARK = [[0.98, 16], [0.94, 19], [0.90, 22], [0.85, 25], [0.78, 28], [0.17, 30]];

const TINT_DARK = {
  // 色块：浅色那档 L*84 比奶油底低 13。深色页上色块要比页面底**亮**，所以是 28（比 base03 高 13）。
  surface: { L: 28, C: 25 },
  // 文字：L*34 的纯 L* 镜像是 66，但 L*66 压在 L*30 的中性面上只有 3.6:1、过不了 AA——
  // 镜像不保对比度。抬到 74 之后，中性梯级最浅那档上 4.59:1、色块上 4.93:1，两处都过。
  text:    { L: 74, C: 30 },
  // 边框：浅色那档 L*70 在奶油底上 2.13:1、在色块上 1.51:1。这一档按**对比度**镜像（不是按 L*），
  // 同样两个比值定出 L*38~40，取 40。
  border:  { L: 40, C: 18 },
};
// 深色中性底上的正文色。同 INK 的色相、明度取 L*74（与 TINT_DARK.text 同一个理由）。
// 压在中性梯级最浅那档（L*30）上 4.59:1、最深那档（L*16）上 7.31:1。
const INK_DARK = [163, 186, 194];

// --- State ---

let state = {
  pageTone: "unknown",    // 这一页画布的深浅："dark" | "light" | "unknown"（还没测时是 unknown）
  preferDark: false,      // 这一页最终要翻成深色吗（偏好 + 系统偏好的解析结果）
  isApplied: false,
  activeMode: null,       // "native" | "filter" | "remap"
  nativeSignals: [],
  lsSwitch: null,         // 站点把主题存在 localStorage 时的目标值（最后手段那一档）
  appliedMode: null,      // 本次生效的那次处置（设置一变要判断是否重来）
  autoApplied: false,     // 当前这次应用是自动生效的，还是用户手点的
  applying: false,        // native 的切换+验证是异步的，用它挡住并发重入
};
let observer = null;
const OBSERVER_CONFIG = {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ["class", "style"],
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

// 计算色不一定归成 rgb()：Chrome 对色域外的值会保留原色彩空间，Tailwind v4 那类站的
// backgroundColor 就是 lab(...) / oklab(...)——只认 rgb() / hsl() / #hex 会整片解析失败
// （实测 tailwind 官网一半元素的颜色属性落在这条路上：页面判定恒 unknown、颜色映射被静默跳过）。
// 转换交给浏览器自己做：填一个 1×1 像素再读回来。
// 不能用 ctx.fillStyle 的读值归一——它把 lab(...) / oklch() / color() 原样吐回来，只归 rgb() / hsl()。
const MODERN_COLOR_RE = /^(lab|lch|oklab|oklch|color)\(/i;
const COLOR_CACHE_MAX = 2000;
const colorCache = new Map();
let colorCtx = null;

function modernColorToRgb(str) {
  if (!colorCtx) {
    const cv = document.createElement("canvas");
    cv.width = 1; cv.height = 1;
    colorCtx = cv.getContext("2d", { willReadFrequently: true });
  }
  // 每次先擦成「全透明黑」再填。fillRect 默认是 source-over 合成：填一个带透明度的颜色时
  // 底下的旧像素会透出来，不擦的话 alpha 为 0 的输入会读回上一次的颜色。
  // 擦干净之后，「alpha 为 0」和「fillStyle 没接受这个值」两种情况读到的都是 a === 0，一律返回 null。
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = str;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  // alpha 为 0 视为没画底（与 isTransparentColor 同语义）：返回 null
  return d[3] === 0 ? null : [d[0], d[1], d[2]];
}

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
  // 现代色彩语法。两道闸各挡一类，缺一不可：
  //   白名单挡「canvas 会解错的值」——currentColor 会被它解成 #000000（静默给一个假的黑），
  //     var() / inherit / AccentColor 它直接忽略；
  //   CSS.supports 挡「名字对、参数残」的写法（lab(1 2)）。
  // 两道都不挡的话，函数会读成「全透明」返回 null——语义退化成"这个属性没有颜色"，
  // 不致命，但会静默漏掉一个本该处理的颜色。
  if (colorCache.has(str)) return colorCache.get(str);
  if (!MODERN_COLOR_RE.test(str) || !CSS.supports("color", str)) return null;
  const modern = modernColorToRgb(str);
  // 结果表只进不出，给个上限：真实增长只来自「无限滚动 / 持续生成新颜色」的页面
  if (colorCache.size >= COLOR_CACHE_MAX) colorCache.clear();
  colorCache.set(str, modern);
  return modern;
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

// 这一页的深浅：深 / 浅 / **判不出**。只回答「画布是什么」，不回答「该不该动手」——那是 resolveSetting 的事。
// 「判不出」是一个**独立的答案**，不是「浅色」：body 和 html 都没画底时，样式里查不到屏幕上到底是什么
// （可能是浏览器默认的白，也可能是一张铺满的背景图），没有依据就不该报结论。
// 早先这里返回布尔值，判不出被压成「浅色」——popup 于是会对着一个毫无依据的页面说「浅色页面」；
// 而「切完复测」那道闸也会把判不出当成「已经变浅了」而假成功。
const TONE_DARK = "dark", TONE_LIGHT = "light", TONE_UNKNOWN = "unknown";

function detectPageTone() {
  // 整站深浅以画布为准：body 沿祖先向上第一个画了底的元素，其底色就是站点底色。
  const pageBg = firstPaintedBackground(document.body);
  if (!pageBg) return TONE_UNKNOWN;
  return isDark(pageBg) ? TONE_DARK : TONE_LIGHT;
}

// 偏好落到「这一页该是什么色调」
function toneFor(preferDark) { return preferDark ? TONE_DARK : TONE_LIGHT; }

// =============================================================================
// MODE 1: NATIVE THEME DETECTION & SWITCH
// =============================================================================

const DARK_WORD_RE = /dark|night|dim|black/i;
const LIGHT_WORD_RE = /light|day|bright|white/i;
const DARK_LIGHT_WORDS = [["dark", "light"], ["night", "day"], ["dim", "bright"], ["black", "white"]];
const THEME_LS_KEYS = ["theme", "color-theme", "colorMode", "color-mode", "darkMode",
  "dark-mode", "data-theme", "night-mode", "appearance", "colorScheme", "color-scheme"];

// ---------- 站点主题开关的发现 ----------
// 不硬写 "light" / "dark"：去站点自己的样式表里找它真正定义过的那个值。
// 找不到就宁可不动——写一个站点不认识的值会把它切进无样式状态。
// 两个方向的差别只有一处：站点**当前**那一端是深色词还是浅色词（翻深时站点是浅色）。

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 保大小写：dark→light、DARK→LIGHT、Dark→Light
function matchCase(sample, word) {
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  if (sample.charAt(0) === sample.charAt(0).toUpperCase()) return word.charAt(0).toUpperCase() + word.slice(1);
  return word;
}

// 词形表是**成对**的，往哪个方向翻就取哪一端。
// toDark=false（翻浅）："nv-dark" → ["nv-light"]、"night" → ["day"]
// toDark=true （翻深）："nv-light" → ["nv-dark"]、"day" → ["night"]
function counterparts(value, toDark) {
  const out = [];
  for (const [dark, light] of DARK_LIGHT_WORDS) {
    const from = toDark ? light : dark;
    const to = toDark ? dark : light;
    if (!new RegExp(from, "i").test(value)) continue;
    out.push(value.replace(new RegExp(from, "gi"), (m) => matchCase(m, to)));
  }
  return out;
}

// 这个词在类名里是不是一个**独立的词**：b_dark / theme-dark / darkMode ✓，lightbox / highlight / darkened ✗。
// 类名里随手出现 dark/light 的其它词很多（lightbox 库就往 body 上挂 lightbox-open），
// 不卡这一层，兜底那条「摘掉这个类」会把不相干的类删掉。
// 边界：前面是串首或非字母数字；后面是串尾或非小写字母数字（大写算边界，好让 camelCase 也认）。
function hasThemeWordToken(s, toDark) {
  const lower = s.toLowerCase();
  for (const [dark, light] of DARK_LIGHT_WORDS) {
    const w = escapeRegExp(toDark ? light : dark);
    if (new RegExp("(?:^|[^A-Za-z0-9])" + w + "(?=$|[^a-z0-9])").test(s)) return true;
    if (new RegExp("(?:^|[^A-Za-z0-9])" + w + "(?=$|[^A-Za-z0-9])").test(lower)) return true;
  }
  return false;
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

// 先按词形对应找（night 该配 day，而不是随便一个 light），找不到再退到该属性定义过的其它「目标端」值。
// 顺序不能反：「站点自己那套命名」比「通用词 light」更可信——站点可能给别的组件另定义了一份 light。
function resolveCounterpartValue(value, definedValues, toDark) {
  for (const alt of counterparts(value, toDark)) {
    if (definedValues.indexOf(alt) !== -1) return alt;
  }
  const curRe = toDark ? LIGHT_WORD_RE : DARK_WORD_RE;   // 要排除的是「站点当前那一端」的词
  const others = definedValues.filter((v) => v !== value && !curRe.test(v) && !/^auto$/i.test(v));
  const preferred = toDark ? [/^dark$/i, /^night$/i] : [/^light$/i, /^day$/i];
  return others.find((v) => preferred[0].test(v)) || others.find((v) => preferred[1].test(v)) || others[0] || null;
}

// 返回的开关按「站点自己定义过的目标端取值」来定，不写死字符串。
// 不扫 @media (prefers-color-scheme)：那种站点没有可切的东西，插 <meta name="color-scheme">
// 对媒体查询毫无作用（实测：color-scheme 影响不了 prefers-color-scheme 的匹配）。
function detectNativeThemeSupport(preferDark) {
  const signals = [];
  const html = document.documentElement;
  const body = document.body;
  const selectorText = collectSelectorText();
  const taken = new Set();   // "tag|attr" 去重：GitHub 那条和下面的通用循环会撞
  // 站点当前那一端：翻深时它是浅色、翻浅时它是深色。所有「认出站点主题」的判断都按这一端来。
  const curRe = preferDark ? LIGHT_WORD_RE : DARK_WORD_RE;

  // A. GitHub 式：data-color-mode 是开关，data-light-theme / data-dark-theme 存的是站点自己的主题名
  const colorMode = html.getAttribute("data-color-mode");
  const themeName = html.getAttribute(preferDark ? "data-dark-theme" : "data-light-theme");
  if (colorMode && themeName && (curRe.test(colorMode) || /^auto$/i.test(colorMode))) {
    signals.push({ type: "data-attr", el: "html", attr: "data-color-mode", from: colorMode, to: themeName });
    taken.add("html|data-color-mode");
  }

  for (const [tag, el] of [["html", html], ["body", body]]) {
    if (!el) continue;

    // B. 类名：html/body 上任何带「站点当前那一端」词的类，去找站点定义过的对应类
    //    （翻浅时 nv-dark → nv-light 走这条）
    for (const cls of Array.from(el.classList)) {
      if (!hasThemeWordToken(cls, preferDark)) continue;
      const alt = counterparts(cls, preferDark).find((v) => selectorMentionsClass(selectorText, v));
      if (alt) { signals.push({ type: "class-replace", el: tag, from: cls, to: alt }); continue; }
      // 找不到对应类时退到「摘掉」：站点靠「挂上这个类」表示当前这一端，摘掉就回到另一端
      // —— 但只有**站点自己给这个类写过样式**才认，那是「它是主题钩子」的证据，不是随手挂的工具类。
      // 判据不能只看类名（别写死 dark / night / black）：bing 用的是 b_dark，而它压根没定义 .b_light，
      // 按名字写死的话这条兜底永远不触发，整条原生路径静默失效。
      if (selectorMentionsClass(selectorText, cls)) signals.push({ type: "class-remove", el: tag, className: cls });
    }

    // C. data-* 属性：属性名得像主题开关，值要带「站点当前那一端」的词
    for (const attr of Array.from(el.attributes)) {
      if (!/^data-/.test(attr.name)) continue;
      if (!/theme|mode|color|scheme|appearance/i.test(attr.name)) continue;
      if (!curRe.test(attr.value)) continue;
      if (taken.has(tag + "|" + attr.name)) continue;
      const to = resolveCounterpartValue(attr.value, selectorAttrValues(selectorText, attr.name), preferDark);
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

// ---------- 切换后的验证 ----------

const VERIFY_DELAYS = [0, 120, 400, 900];

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// 站点重渲染要时间，所以分几次采样：只要有一次页面已经变成了偏好色就算切成功。
// preferDark 由调用方传，不读 state——「切完变成什么」是这一次切换的目标，不是全局状态。
async function verifyBecamePreference(preferDark) {
  let waited = 0;
  for (const at of VERIFY_DELAYS) {
    if (at > waited) { await delay(at - waited); waited = at; }
    // 判不出（unknown）不算成功：这一轮采样继续等，四轮都等不到就认失败、把 DOM 改回去
    if (detectPageTone() === toneFor(preferDark)) return true;
  }
  return false;
}

// ---------- localStorage 这一档（最后手段） ----------
// 它是唯一会永久写进站点自己存储的一档，而且必须 reload 才能生效，
// 所以：只在 DOM 层一点可切的都没有时才走；先记原值；下次加载时若页面仍未变成偏好色就写回去。

const LS_TRIAL_KEY = "dpib-ls-trial";
const LS_FAILED_KEY = "dpib-ls-failed";

function sessionGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
function sessionSet(key, val) { try { sessionStorage.setItem(key, val); } catch (e) {} }
function sessionDel(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

function discoverLocalStorageSwitch(preferDark) {
  const curRe = preferDark ? LIGHT_WORD_RE : DARK_WORD_RE;
  for (const key of THEME_LS_KEYS) {
    let value = null;
    try { value = localStorage.getItem(key); } catch (e) { continue; }
    if (!value || !curRe.test(value)) continue;
    const to = counterparts(value, preferDark).find((v) => v !== value);
    if (to) return { key, from: value, to };
  }
  return null;
}

async function readUndoMap() {
  try { const s = await chrome.storage.sync.get({ lsUndo: {} }); return s.lsUndo || {}; } catch (e) { return {}; }
}

// 结算上一次的试验：页面变成偏好色了算成功，把原值记进 lsUndo，关掉本站时好把站点自己的主题值还回去；
// 没变成就把原值写回、记下本站已失败（本标签页不再重试）。
// 比的是 trial 里记下的那一端（state.preferDark 这时还没算出来，这次加载的检测在后面）。
async function settleLocalStorageTrial() {
  const raw = sessionGet(LS_TRIAL_KEY);
  if (!raw) return;
  sessionDel(LS_TRIAL_KEY);
  let trial = null;
  try { trial = JSON.parse(raw); } catch (e) { return; }
  if (trial.host !== hostKey()) return;

  if (detectPageTone() === toneFor(!!trial.preferDark)) {
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

// 关闭本站时把站点自己的主题值还回去
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
  const sw = discoverLocalStorageSwitch(state.preferDark);
  if (!sw) return false;
  sessionSet(LS_TRIAL_KEY, JSON.stringify({ host, key: sw.key, original: sw.from, preferDark: state.preferDark, auto: !!isAuto }));
  try { localStorage.setItem(sw.key, sw.to); } catch (e) { sessionDel(LS_TRIAL_KEY); return false; }
  location.reload();
  return true;
}

// 切换 + 验证：没真的变成偏好色就当没切过，把 DOM 改回去，别把站点留在坏状态
async function applyNative(isAuto) {
  if (state.nativeSignals.length) {
    applyNativeSwitch(state.nativeSignals);
    if (await verifyBecamePreference(state.preferDark)) return true;
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
    /* 媒体一律用反向滤镜还原成本来的样子：整页滤镜 + 这一层是恒等，照片/视频/canvas 永远不动。
       没有例外——「深色图也翻过来」那条例外会把照片做成负片，那是这条规则唯一不能接受的输出。
       不列 <picture>：它自己不生成盒子、里面的 <img> 已经被这一条覆盖，列上反而多一层二次过滤的风险。 */
    img,
    video,
    canvas {
      filter: ${SOLARIZE_FILTER} !important;
    }
  `;
  document.head.appendChild(style);
}

// =============================================================================
// MODE 3: DOM REMAP (Precise Solarized)
// =============================================================================

// --- Remap functions ---

function remapBackground(rgb, preferDark) {
  const tint = preferDark ? TINT_DARK : TINT;
  // 有色相的底一律收成同色相的浅色块。不能按亮度放行——浅色不等于不刺眼，
  // 亮黄这种高饱和的照样很吵，放行等于留了个口子。
  if (chromaOf(rgb) >= CHROMA_NEUTRAL) return tintStable(rgb, tint.surface.L, tint.surface.C);
  const lum = luminance(rgb);
  // 中性底：按原来的明暗落到对应的梯级上。两条梯级的门槛方向相反——浅色那条是
  // 「越暗的输入翻得越浅」，深色那条是「越亮的输入翻得越深」，超出门槛那端的原样不动。
  if (preferDark) {
    for (const [edge, L] of NEUTRAL_STEPS_DARK) if (lum >= edge) return settle(rgb, lchToCSS(L, BASE_CHROMA_DARK, BASE_HUE_DARK));
    return null;
  }
  for (const [edge, L] of NEUTRAL_STEPS) if (lum <= edge) return settle(rgb, lchToCSS(L, BASE_CHROMA, BASE_HUE));
  return null;
}

// surfaceHue：本元素的底色被重映射成彩色块时，那块底的色相角；不是彩色块就传 null。
// 压在彩色块上的**浅色中性字**要跟底色同色相，否则色相对冲——就是浅蓝底配深蓝字那种 chip 的做法。
// （本身带色相的字不走这条，见下。）
function remapText(rgb, surfaceHue, preferDark) {
  const tint = preferDark ? TINT_DARK : TINT;
  // 压在彩色块上的字，一律跟那块底同色相。这条必须排在最前：
  //   · 排在后面的话，输入可能先被别的分支认领，两次处理按不同色相走，颜色就会漂；
  //   · 彩色块里的字色常常是从祖先继承的，而祖先的字色早被本扩展压成墨色了，
  //     那时先判「够深了就别动」会把这类字永远留在墨色上，跟底色对不上。
  if (surfaceHue !== null) return settle(rgb, lchToCSS(tint.text.L, tint.text.C, surfaceHue));
  // 无彩底上：带色相的字重画成同色相的目标色。放行看的是 **L\*** 而不是相对亮度——亮度不是
  // 「够不够深」的可靠代理：#a855f7 / #3b82f6 / #ef4444 这些最常见的强调色亮度只有 0.21~0.24，
  // 看着像「已经够深」，其实都在中调（L* 50 上下），压在奶油底上只有 2.5~3.7:1。
  // 只在字落在**错误那一侧**时才拉：浅色方向上比目标更深、深色方向上比目标更浅的字，
  // 本来就是合格正文，再往目标拉只会把它推向底色（实测：浅色页上 #94a3b8 那种中调面上的
  // #172554 字、深色页上 #475569 那种暗块上的 #a7f3d0 字，都会被这一拉从 5:1 以上掉到 3:1 出头）。
  if (chromaOf(rgb) >= CHROMA_NEUTRAL) {
    const L = labOf(rgb)[0];
    if (preferDark ? L >= tint.text.L : L <= tint.text.L) return null;
    return tintStable(rgb, tint.text.L, tint.text.C);
  }
  // 中性字：浅色方向把「不够深」的压成墨色，深色方向把「不够浅」的提亮。
  // 门槛也各按各的：浅色页的正文是深灰（lum < 0.25 算合格），深色页的正文是浅灰（lum >= 0.2 算合格）。
  if (preferDark) return luminance(rgb) >= 0.2 ? null : INK_DARK;
  return luminance(rgb) < 0.25 ? null : INK;
}

function remapBorder(rgb, preferDark) {
  const lum = luminance(rgb);
  const tint = preferDark ? TINT_DARK : TINT;
  // 已经是「中性 + 中调」的线，在它要落到的那个页面上本来就合适，不动——本函数的输出正好落在这条带里，
  // 所以这也让它幂等。深色页上的带比浅色页低一截，而且两头都要收：比 0.02 还暗的近黑线在深色页上
  // 看不见，比 0.32 还亮的近白线在深色页上太扎眼，两端都得重画。
  if (preferDark) {
    if (lum > 0.02 && lum < 0.32 && chromaOf(rgb) < CHROMA_NEUTRAL) return null;
  } else if (lum >= 0.3 && lum <= 0.7 && chromaOf(rgb) < CHROMA_NEUTRAL) return null;
  // 其余（太深、太亮、或带色相）都重画成同色相的一条线：深色主题的暗边框留成暗色会在浅底上看不见，
  // 而 #22c55e 那种中调高饱和的绿边框放行下来，在浅底上依然很吵
  return tintStable(rgb, tint.border.L, tint.border.C);
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
  // 方向只在这里取一次，往下全部由这个局部量决定——Observer 那条路径没有 plan 可传。
  const preferDark = state.preferDark;
  const tint = preferDark ? TINT_DARK : TINT;

  // Gradient text
  const bgClip = style.webkitBackgroundClip || style.backgroundClip;
  const isGradientText = bgClip === "text" && style.backgroundImage.includes("gradient");
  if (isGradientText) {
    const colorMatches = style.backgroundImage.match(/rgba?\([^)]+\)/g);
    let ink = preferDark ? INK_DARK : INK;
    if (colorMatches) { const fc = parseColor(colorMatches[0]); if (fc && chromaOf(fc) >= CHROMA_NEUTRAL) ink = tintTo(fc, tint.text.L, tint.text.C); }
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
    const mapped = remapBackground(rgb, preferDark);
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
      const mapped = remapText(rgb, surfaceHue, preferDark);
      if (mapped) el.style.setProperty(cssProp(prop), toCSS(mapped), "important");
    }
  }

  // Borders
  for (const prop of BORDER_PROPS) {
    const rgb = parseColor(style[prop]); if (!rgb) continue;
    const mapped = remapBorder(rgb, preferDark);
    if (mapped) el.style.setProperty(cssProp(prop), toCSS(mapped), "important");
  }

  // SVG fill/stroke。这一支不分方向：判据是「fill 本身是暗的」（暗图标在哪个方向的页面上都容易糊），
  // 落点取 SOL 的中性灰——那几个灰在两个方向上都看得见，所以换方向不用换值。
  if (el instanceof SVGElement) {
    const fill = parseColor(style.fill);
    if (fill && isDark(fill)) {
      const mapped = chromaOf(fill) >= CHROMA_NEUTRAL ? tintStable(fill, tint.text.L, tint.text.C) : SOL.base00;
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
        // 只在「自己没画底，或者画的那个底跟要翻到的方向是反的」时才补一个底色
        if (!bg || (preferDark ? luminance(bg) >= 0.2 : luminance(bg) < 0.2)) {
          // 渐变被抹平后拿第一个色停当代表：带色相就留色相，否则退回锚点底
          const first = bgImage.match(/rgba?\([^)]+\)/);
          const fc = first && parseColor(first[0]);
          el.style.setProperty("background-color", toCSS(fc && chromaOf(fc) >= CHROMA_NEUTRAL ? tintTo(fc, tint.surface.L, tint.surface.C) : (preferDark ? SOL.base03 : SOL.base3)), "important");
        }
      }
      // 背景图（url(...)）不处理：媒体一律保持原样。滤镜模式下它避免不了跟着整页翻
      // （反向滤镜加不到单张背景图上），这是整页滤镜这条路线本身的代价，不是这里漏了。
    }
  }

  // Box shadows：把「跟目标页面对不上」的阴影色换掉。浅色页上换掉暗阴影（深色页上的暗阴影本来就不显形），
  // 深色页上换掉亮阴影——亮阴影压上去是刺眼的。
  const shadow = style.boxShadow;
  if (shadow && shadow !== "none") {
    const replacement = preferDark ? "rgba(0, 0, 0, 0.4)" : "rgba(101, 123, 131, 0.15)";
    el.style.setProperty("box-shadow", shadow.replace(/rgba?\([^)]+\)/g, (match) => {
      const rgb = parseColor(match);
      if (rgb && (preferDark ? !isDark(rgb) : isDark(rgb))) return replacement;
      return match;
    }), "important");
  }
}

function processTree(root) {
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  processElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) processElement(walker.currentNode);
}

// --- Remap mode global CSS ---

// 这里只放逐元素重映射够不着的东西——伪元素（滚动条、选区、placeholder）。
// 输入框、链接、代码块一律交给 processElement：那些元素有真实样式，硬编码颜色只会跟站点品牌色打架，
// 而且逐元素那套能把站点的色相留住。
// 深色那一套取的是中性梯级的落点：轨道用页面那档（L*16）、滑块和 placeholder 用中间那档（L*28）、
// 选区底用一档更亮的面（L*25）、选区文字用深色方向的正文色。
const REMAP_CHROME_LIGHT = `
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: #eee8d5 !important; }
    ::-webkit-scrollbar-thumb { background: #93a1a1 !important; border-radius: 5px; }
    ::-webkit-scrollbar-thumb:hover { background: #657b83 !important; }
    ::selection { background: #eee8d5 !important; color: #586e75 !important; }
    input::placeholder, textarea::placeholder { color: #93a1a1 !important; }
  `;
const REMAP_CHROME_DARK = `
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: #012c37 !important; }
    ::-webkit-scrollbar-thumb { background: #224753 !important; border-radius: 5px; }
    ::-webkit-scrollbar-thumb:hover { background: #354247 !important; }
    ::selection { background: #1a404c !important; color: #a3bac2 !important; }
    input::placeholder, textarea::placeholder { color: #224753 !important; }
  `;

function injectRemapStyles(preferDark) {
  if (document.getElementById("dpib-remap-global")) return;
  const style = document.createElement("style");
  style.id = "dpib-remap-global";
  style.textContent = preferDark ? REMAP_CHROME_DARK : REMAP_CHROME_LIGHT;
  document.head.appendChild(style);
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
      }
      if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE) {
        if (state.activeMode === "remap") { PROCESSED.delete(m.target); processElement(m.target); }
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

// 站点声明了 color-scheme: dark 时，即使页面被翻浅，滚动条和表单控件仍按深色渲染（翻深时反过来）。
// 用 inline + important 压过站点样式表；只负责设置，不做移除或回退。

function applyColorScheme(preferDark) {
  const style = document.documentElement.style;
  style.setProperty("color-scheme", preferDark ? "dark" : "light", "important");
}

// =============================================================================
// APPLY ORCHESTRATORS
// =============================================================================

function startFilterMode() {
  applyFilterMode();
  startObserving();
}

function startRemapMode() {
  injectRemapStyles(state.preferDark);
  stopObserving();
  processTree(document.documentElement);
  startObserving();
}

// 「优先原生」能不能试，由检测决定 —— 站点那个开关是用来把页面切到另一端的，
// 页面已经是偏好色时它无事可做；而且复测函数在本来就是偏好色的页上会假成功、把整条链提前结束。
// 所以候选（state.nativeSignals）在 detect() 里就按「这一页要不要翻」门控好了，这里只读不算。
// 返回**实际生效的方法**："native" | "filter" | "remap"。
function runMethod({ preferNative, method }, isAuto) {
  if (!preferNative || !state.nativeSignals.length) return Promise.resolve(method);
  return applyNative(isAuto).then((ok) => (ok ? "native" : method));
}

async function apply(plan, isAuto) {
  if (state.isApplied || state.applying) return;
  state.applying = true;
  try {
    // 这一次处置的方向以 plan 为准落进 state：Observer 那条路径（processElement）
    // 没有 plan 可传，只能读 state。
    state.preferDark = plan.preferDark;
    const method = await runMethod(plan, isAuto);
    if (!method) return;                       // 切不动 → 就当没切过，不谎报成功
    // runMethod 只**返回**方法名，而且 native 那条它已经在内部跑完了；
    // filter / remap 的注入必须在这里做，漏了这两行就等于那两档完全不生效。
    if (method === "filter") startFilterMode();
    else if (method === "remap") {
      startRemapMode();
      // 对比度校验只对「颜色映射」有意义（它是唯一逐元素改色的手段）。
      // 这是开发期诊断，打一条到控制台就够，不进 UI。
      const v = validateContrast();
      console.log(`[颠倒黑白] 对比度校验：${v.checked} 个含文字元素，${v.passed} 通过，${v.issues.length} 未达 AA`);
      for (const it of v.issues) {
        console.log(`  ${it.level === "critical" ? "严重" : "警告"} ${it.ratio}:1 — <${it.tag}> "${it.text}"  文字 ${it.textColor} / 底色 ${it.bgColor}`);
      }
    }
    applyColorScheme(plan.preferDark);
    state.activeMode = method;
    state.appliedMode = planKey(plan);         // 记住用的是哪次处置，设置一变好判断要不要重来
    state.isApplied = true;
    state.autoApplied = isAuto;                // 记下这次是自动生效的还是用户手点的
  } finally {
    state.applying = false;
  }
}

// 「关闭本站」：设置由 popup 负责写；这里做两件事——把扩展写进站点 localStorage
// 的主题值还回去，再重载页面把注入过的样式（滤镜 / 映射）撤干净。
// 重载判据带上 undo：那一档页面是扩展改的、却没走应用路径，只认 state.isApplied 会漏掉它。
async function stopSite() {
  const host = hostKey();
  const undo = (await readUndoMap())[host];
  if (undo) await restoreLocalStorageUndo();
  if (state.isApplied || undo) location.reload();
}

// =============================================================================
// MESSAGE API
// =============================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // all_frames 下每个 iframe 都会收到 popup 的广播消息，谁先回谁算。
  // 让 iframe 也回，popup 会把 iframe 那边的状态当成整页的（看起来像"扩展没生效"），
  // 而点「关闭本站」会把每个 iframe 都重载一遍。所以只让顶层文档应答。
  if (window !== window.top) return;
  switch (msg.action) {
    case "getStatus":
      // 等 INIT 的 settle + detect 落定，免得在这个窗口里报出初始值
      ready.then(getStatus).then(sendResponse);
      break;
    case "stopSite":
      ready.then(stopSite).then(() => sendResponse({ ok: true }));
      break;
    case "settingsChanged":
      ready.then(onSettingsChanged).then(() => sendResponse({ ok: true }));
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
// 设置分两级：全局是「自动」（检测说了算），本站覆盖是「断言」（你说了算，不检测）。
// 全局存 global，本站覆盖存 sites[host]；本站不设键 = 跟随全局。
// 开箱默认（读不到存储时的兜底）由共享模型 MODEL.DEFAULT_GLOBAL 给出。

// 用 host 而不是 hostname：hostname 不带端口，localhost:8000 和 localhost:3000 会共用一条设置。
// 不含路径——「本站」= 这个域名的整个站。
function hostKey() {
  try { return location.host || ""; } catch (e) { return ""; }
}

async function readSettings() {
  try {
    const raw = await chrome.storage.sync.get({ global: null, sites: {} });
    const sites = {};
    for (const host of Object.keys(raw.sites || {})) {
      const s = MODEL.normalizeSetting(raw.sites[host]);   // 坏值当没设过
      if (s) sites[host] = s;
    }
    return { global: MODEL.normalizeGlobal(raw.global) || MODEL.DEFAULT_GLOBAL, sites };
  } catch (e) {
    // 读不到设置时保守：不动页面
    return { global: { ...MODEL.DEFAULT_GLOBAL, enabled: false }, sites: {} };
  }
}

// 系统/浏览器当前的深浅偏好。问不到时按浅色算——没有依据时猜错的方向是把页面翻黑。
function systemPrefersDark() {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
}

// 这一页该怎么办（含方向）。读一次设置的唯一入口，自动路径与消息路径都走它。
async function currentPlan() {
  const settings = await readSettings();
  return MODEL.resolveSetting(settings.global, settings.sites[hostKey()], systemPrefersDark());
}

// 一次处置的可比较标识：设置变了要靠它判断这一页要不要整页重来。
// 方向必须算进去——只改了偏好（浅↔深）时 action/preferNative/method 都不变，少这一项就不会重来。
function planKey(plan) {
  return plan.action + "|" + !!plan.preferNative + "|" + plan.method + "|" + (plan.preferDark ? "dark" : "light");
}

// 检测这一页 + 定方向。要读设置是因为「要不要翻」得先知道偏好是什么。
async function detect() {
  const plan = await currentPlan();
  state.preferDark = plan.preferDark;
  state.pageTone = detectPageTone();
  // 只有「这一页明确和偏好相反」时才去找原生开关：站点那个开关是用来把页面切到另一端的，
  // 页面本来就是偏好色时它无事可做，而复测函数在那种页面上会假成功、把整条处理链提前结束。
  // 判不出时也不找——没有依据就别猜，猜错任一方向都是把页面弄得更糟。
  const needsFlip = state.pageTone !== TONE_UNKNOWN && state.pageTone !== toneFor(plan.preferDark);
  state.nativeSignals = needsFlip ? detectNativeThemeSupport(plan.preferDark) : [];
  state.lsSwitch = needsFlip ? discoverLocalStorageSwitch(plan.preferDark) : null;
}

async function getStatus() {
  const settings = await readSettings();
  const host = hostKey();
  // localStorage 那一档切成功后会 reload，本次加载里没有任何 DOM 改动，
  // 但页面确实是扩展翻过来的，用户也能用「关闭本站」还原，所以照「已应用」报给 popup——
  // 这样 popup 会显示本站已生效，并给出「关闭本站」这个还原入口。
  const plan = MODEL.resolveSetting(settings.global, settings.sites[host], systemPrefersDark());
  const undo = (await readUndoMap())[host];
  const undoActive = !!undo && state.pageTone === toneFor(plan.preferDark);
  return {
    pageTone: state.pageTone,
    isApplied: state.isApplied || undoActive,
    activeMode: state.isApplied ? state.activeMode : (undoActive ? "native" : null),
    host,
    global: settings.global,
    site: settings.sites[host] || null,        // null = 跟随全局
    plan,                                      // 这一页该怎么办
    hasNative: state.nativeSignals.length > 0 || !!state.lsSwitch,
    autoApplied: state.isApplied ? state.autoApplied : !!(undo && undo.auto),
  };
}

async function applyResolved(isAuto) {
  const plan = await currentPlan();
  if (plan.action === "none") return;
  // 自动路径下，这一页已经是偏好色、或者根本判不出深浅，都不动它。
  // action === "force" 时不看检测结果：站点级是「断言」，你说了算。
  if (plan.action === "auto" && (state.pageTone === TONE_UNKNOWN || state.pageTone === toneFor(plan.preferDark))) return;
  await apply(plan, isAuto);
}

async function autoApply() {
  if (window !== window.top) return;   // all_frames 会让每个 iframe 各跑一份，逐帧套滤镜只会套重
  if (state.isApplied) return;
  await applyResolved(true);
}

async function onSettingsChanged() {
  const plan = await currentPlan();

  if (state.isApplied) {
    // 已翻转的页面：这一页的处置变了自己换不回来，整页重来；没变就保持现状
    if (planKey(plan) !== state.appliedMode) location.reload();
    return;
  }
  if (plan.action === "none") return;
  await detect();
  await applyResolved(true);
}

// 系统偏好变了 = 一次设置变更：已翻转的页面整页重来，没翻的重新判定。
// 偏好不是「跟随系统」时这条通知无事可做（planKey 不会变，onSettingsChanged 自己会早退）。
async function onSystemPreferenceChanged() {
  if (window !== window.top) return;      // 只有顶层维护 state，iframe 不掺和
  const settings = await readSettings();
  if (settings.global.preference !== "system") return;
  await onSettingsChanged();
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
  await detect();
})();

ready.then(() => autoApply());

// 挂系统偏好的监听：默认就是「跟随系统」，所以这条在大多数安装上是常开的。
try {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { ready.then(onSystemPreferenceChanged); });
} catch (e) { /* 老浏览器没有 addEventListener 形式，静态的偏好值照样能用 */ }
