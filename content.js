// =============================================================================
// Don't! Paint it black — Content Script
// Three-mode architecture: Native Switch → CSS Filter → DOM Remap
//
// Author: Marcin Kleczek <marcin.kleczek@gmail.com>
// License: MIT
// =============================================================================

// --- Solarized Light palette ---

const SOL = {
  base03:  [0, 43, 54],   base02: [7, 54, 66],
  base01:  [88, 110, 117], base00: [101, 123, 131],
  base0:   [131, 148, 150], base1: [147, 161, 161],
  base2:   [238, 232, 213], base3: [253, 246, 227],
  yellow:  [181, 137, 0],  orange: [203, 75, 22],
  red:     [220, 50, 47],  magenta:[211, 54, 130],
  violet:  [108, 113, 196], blue:  [38, 139, 210],
  cyan:    [42, 161, 152],  green: [133, 153, 0],
};
const ACCENTS = [
  { name: "yellow",  hue: 45,  rgb: SOL.yellow },
  { name: "orange",  hue: 18,  rgb: SOL.orange },
  { name: "red",     hue: 1,   rgb: SOL.red },
  { name: "magenta", hue: 331, rgb: SOL.magenta },
  { name: "violet",  hue: 237, rgb: SOL.violet },
  { name: "blue",    hue: 205, rgb: SOL.blue },
  { name: "cyan",    hue: 175, rgb: SOL.cyan },
  { name: "green",   hue: 68,  rgb: SOL.green },
];
const ACCENT_TEXT = {
  yellow:[140,105,0], orange:[170,63,18], red:[185,42,39], magenta:[175,45,108],
  violet:[85,90,165], blue:[30,110,170], cyan:[28,120,113], green:[100,115,0],
};

// --- State ---

let state = {
  isDark: false,
  isApplied: false,
  activeMode: null,       // "native" | "filter" | "remap"
  nativeSignals: [],
  recommendedMode: null,  // "native" | "filter"
};
let observer = null;
const OBSERVER_CONFIG = {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ["class", "style", "src", "srcset"],
};
const SOLARIZE_FILTER = "invert(93%) hue-rotate(180deg) sepia(18%) saturate(140%) brightness(97%)";

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

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function toCSS([r, g, b]) { return `rgb(${r}, ${g}, ${b})`; }
function isDark(rgb) { return luminance(rgb) < 0.2; }
function luminanceQuick(r, g, b) { return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }
function contrastRatio(l1, l2) { return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }

function nearestAccent(hue) {
  let best = ACCENTS[0], bd = 360;
  for (const a of ACCENTS) { const d = Math.min(Math.abs(hue - a.hue), 360 - Math.abs(hue - a.hue)); if (d < bd) { bd = d; best = a; } }
  return best.rgb;
}
function nearestAccentForText(hue) {
  let best = ACCENTS[0], bd = 360;
  for (const a of ACCENTS) { const d = Math.min(Math.abs(hue - a.hue), 360 - Math.abs(hue - a.hue)); if (d < bd) { bd = d; best = a; } }
  return ACCENT_TEXT[best.name];
}

// =============================================================================
// DARK PAGE DETECTION
// =============================================================================

function detectDarkPage() {
  const bodyBg = parseColor(getComputedStyle(document.body).backgroundColor);
  const htmlBg = parseColor(getComputedStyle(document.documentElement).backgroundColor);
  const meta = document.querySelector('meta[name="theme-color"]');
  const metaColor = meta ? parseColor(meta.content) : null;
  for (const bg of [bodyBg, htmlBg, metaColor]) {
    if (bg && isDark(bg)) return true;
  }
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

const DARK_RE = /dark|night|dim/i;
const THEME_LS_KEYS = ["theme", "color-theme", "colorMode", "color-mode", "darkMode",
  "dark-mode", "data-theme", "night-mode", "appearance", "colorScheme", "color-scheme"];

function detectNativeThemeSupport() {
  const signals = [];
  const html = document.documentElement;
  const body = document.body;

  // A. data-color-mode (GitHub pattern)
  // "dark" → explicit dark. "auto" → follows system; if page is visually dark, we can override to "light".
  const colorMode = html.getAttribute("data-color-mode");
  if (colorMode && (DARK_RE.test(colorMode) || colorMode === "auto")) {
    // For "auto", only signal if page is actually dark AND a light theme name exists
    const hasLightTheme = html.getAttribute("data-light-theme");
    if (DARK_RE.test(colorMode) || hasLightTheme) {
      signals.push({ type: "data-attr", el: "html", attr: "data-color-mode", from: colorMode, to: "light" });
    }
  }

  // B. data-theme (DaisyUI, Radix, many libs)
  for (const el of [html, body]) {
    const tag = el === html ? "html" : "body";
    const dt = el.getAttribute("data-theme");
    if (dt && DARK_RE.test(dt)) {
      signals.push({ type: "data-attr", el: tag, attr: "data-theme", from: dt, to: "light" });
    }
    // data-mode, data-color-scheme variants
    for (const attr of ["data-mode", "data-color-scheme", "data-bs-theme"]) {
      const val = el.getAttribute(attr);
      if (val && DARK_RE.test(val)) {
        signals.push({ type: "data-attr", el: tag, attr, from: val, to: "light" });
      }
    }
  }

  // C. Class-based dark mode (Tailwind: class="dark" on html)
  if (html.classList.contains("dark")) {
    signals.push({ type: "class-remove", el: "html", className: "dark" });
  }
  for (const cls of body.classList) {
    if (/^dark[-_]?(mode|theme)?$/i.test(cls)) {
      signals.push({ type: "class-remove", el: "body", className: cls });
    }
  }

  // D. localStorage theme keys
  for (const key of THEME_LS_KEYS) {
    try {
      const val = localStorage.getItem(key);
      if (val && DARK_RE.test(val)) {
        signals.push({ type: "localStorage", key, from: val, to: "light" });
      }
    } catch (e) { /* storage access denied */ }
  }

  // E. CSS prefers-color-scheme rules
  let hasLightCSS = false;
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.media && rule.media.mediaText && rule.media.mediaText.includes("prefers-color-scheme")) {
            hasLightCSS = true;
            break;
          }
        }
      } catch (e) { /* cross-origin */ }
      if (hasLightCSS) break;
    }
  } catch (e) {}
  if (hasLightCSS) {
    signals.push({ type: "color-scheme-meta" });
  }

  return signals;
}

let nativeOriginals = [];

function applyNativeSwitch(signals) {
  nativeOriginals = [];
  let needsReload = false;

  for (const sig of signals) {
    switch (sig.type) {
      case "data-attr": {
        const el = sig.el === "html" ? document.documentElement : document.body;
        nativeOriginals.push({ ...sig, originalValue: el.getAttribute(sig.attr) });
        el.setAttribute(sig.attr, sig.to);
        break;
      }
      case "class-remove": {
        const el = sig.el === "html" ? document.documentElement : document.body;
        nativeOriginals.push(sig);
        el.classList.remove(sig.className);
        break;
      }
      case "localStorage":
        nativeOriginals.push(sig);
        try { localStorage.setItem(sig.key, sig.to); } catch (e) {}
        needsReload = true;
        break;
      case "color-scheme-meta": {
        nativeOriginals.push(sig);
        const meta = document.createElement("meta");
        meta.name = "color-scheme";
        meta.content = "light";
        meta.id = "dpib-color-scheme";
        document.head.appendChild(meta);
        break;
      }
    }
  }

  if (needsReload) {
    setTimeout(() => location.reload(), 50);
  }
}

function removeNativeSwitch() {
  for (const sig of nativeOriginals) {
    switch (sig.type) {
      case "data-attr": {
        const el = sig.el === "html" ? document.documentElement : document.body;
        if (sig.originalValue != null) el.setAttribute(sig.attr, sig.originalValue);
        else el.removeAttribute(sig.attr);
        break;
      }
      case "class-remove": {
        const el = sig.el === "html" ? document.documentElement : document.body;
        el.classList.add(sig.className);
        break;
      }
      case "localStorage":
        try { localStorage.setItem(sig.key, sig.from); } catch (e) {}
        break;
      case "color-scheme-meta": {
        const meta = document.getElementById("dpib-color-scheme");
        if (meta) meta.remove();
        break;
      }
    }
  }
  nativeOriginals = [];
  location.reload();
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
  const lum = luminance(rgb), [h, s] = rgbToHsl(rgb);
  if (s > 0.4 && lum > 0.05 && lum < 0.4) return nearestAccent(h);
  if (lum < 0.05) return SOL.base3;
  if (lum < 0.1)  return SOL.base2;
  if (lum < 0.2)  return SOL.base3;
  return null;
}

function remapText(rgb) {
  const [h, s, l] = rgbToHsl(rgb);
  if (s > 0.3 && l > 0.3 && l < 0.85) return nearestAccentForText(h);
  const lum = luminance(rgb);
  if (lum > 0.3) return SOL.base01;
  return null;
}

function remapBorder(rgb) {
  const lum = luminance(rgb), [, s] = rgbToHsl(rgb);
  if (s > 0.3) return nearestAccent(rgbToHsl(rgb)[0]);
  if (lum < 0.3) return SOL.base2;
  if (lum > 0.7) return SOL.base1;
  return null;
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
    let acc = ACCENT_TEXT.blue;
    if (colorMatches) { const fc = parseColor(colorMatches[0]); if (fc) { const [h, s] = rgbToHsl(fc); if (s > 0.2) acc = nearestAccentForText(h); } }
    el.style.setProperty("background-image", "none", "important");
    el.style.setProperty("-webkit-background-clip", "unset", "important");
    el.style.setProperty("background-clip", "unset", "important");
    el.style.setProperty("-webkit-text-fill-color", toCSS(acc), "important");
    el.style.setProperty("color", toCSS(acc), "important");
  }

  // Backgrounds
  let bgIsAccent = false;
  for (const prop of BG_PROPS) {
    const rgb = parseColor(style[prop]); if (!rgb) continue;
    const mapped = remapBackground(rgb);
    if (mapped) { el.style.setProperty(cssProp(prop), toCSS(mapped), "important"); if (luminance(mapped) < 0.3 && luminance(mapped) > 0.01) bgIsAccent = true; }
  }

  // Text
  if (!isGradientText) {
    if (bgIsAccent) {
      el.style.setProperty("color", toCSS(SOL.base3), "important");
      el.style.setProperty("-webkit-text-fill-color", toCSS(SOL.base3), "important");
    } else {
      for (const prop of TEXT_PROPS) {
        const rgb = parseColor(style[prop]); if (!rgb) continue;
        const mapped = remapText(rgb);
        if (mapped) el.style.setProperty(cssProp(prop), toCSS(mapped), "important");
      }
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
    if (fill && isDark(fill)) { const [, s] = rgbToHsl(fill); el.style.setProperty("fill", toCSS(s > 0.3 ? nearestAccent(rgbToHsl(fill)[0]) : SOL.base00), "important"); }
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
        if (!bg || luminance(bg) < 0.2) el.style.setProperty("background-color", toCSS(SOL.base3), "important");
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
    input, textarea, select { background-color: #fdf6e3 !important; color: #586e75 !important; border-color: #eee8d5 !important; }
    input::placeholder, textarea::placeholder { color: #93a1a1 !important; }
    a { color: #1e6eaa !important; }
    a:visited { color: #555a99 !important; }
    pre, code, .highlight, [class*="code"] { background-color: #eee8d5 !important; color: #586e75 !important; }
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
// APPLY / REMOVE ORCHESTRATORS
// =============================================================================

function apply(mode) {
  if (state.isApplied) return;
  state.activeMode = mode || state.recommendedMode || "filter";
  state.isApplied = true;

  switch (state.activeMode) {
    case "native":
      applyNativeSwitch(state.nativeSignals);
      break;
    case "filter":
      applyFilterMode();
      startObserving();
      break;
    case "remap":
      injectRemapStyles();
      stopObserving();
      processTree(document.documentElement);
      processImages();
      startObserving();
      break;
  }
}

function remove() {
  switch (state.activeMode) {
    case "native":  removeNativeSwitch(); break;
    case "filter":  stopObserving(); removeFilterMode(); break;
    case "remap":   stopObserving(); removeRemapStyles(); location.reload(); break;
    default:        location.reload(); break;
  }
  state.isApplied = false;
  state.activeMode = null;
}

// =============================================================================
// MESSAGE API
// =============================================================================

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {
    case "getStatus":
      sendResponse({
        isDark: state.isDark,
        isApplied: state.isApplied,
        activeMode: state.activeMode,
        recommendedMode: state.recommendedMode,
        hasNative: state.nativeSignals.length > 0,
        nativeSignals: state.nativeSignals.map(s => s.type),
      });
      break;
    case "apply":
      apply(msg.mode);
      sendResponse({ ok: true, mode: state.activeMode });
      break;
    case "remove":
      remove();
      sendResponse({ ok: true });
      break;
    case "validate":
      sendResponse(validateContrast());
      break;
    default:
      sendResponse({ error: "unknown action" });
  }
  return true;
});

// =============================================================================
// INIT — detect only, do NOT apply
// =============================================================================

state.isDark = detectDarkPage();
if (state.isDark) {
  state.nativeSignals = detectNativeThemeSupport();
  state.recommendedMode = state.nativeSignals.length > 0 ? "native" : "filter";
}
