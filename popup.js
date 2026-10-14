// Light or Night / 颠倒黑白 — Popup（派生自 Marcin Kleczek 的 Don't! Paint it black，MIT）
// Author: Marcin Kleczek <marcin.kleczek@gmail.com>
// License: MIT

function t(key, subs) {
  return chrome.i18n.getMessage(key, subs);
}

const statusBadge = document.getElementById("statusBadge");
const appliedMethod = document.getElementById("appliedMethod");
const modeSettings = document.getElementById("modeSettings");
const globalSwitch = document.getElementById("globalSwitch");
const globalOptions = document.getElementById("globalOptions");
const globalMethods = document.getElementById("globalMethods");
const globalPreferNative = document.getElementById("globalPreferNative");
const siteSettings = document.getElementById("siteSettings");
const siteSwitch = document.getElementById("siteSwitch");
const siteHost = document.getElementById("siteHost");
const siteOptions = document.getElementById("siteOptions");
const siteMethods = document.getElementById("siteMethods");
const sitePreferNative = document.getElementById("sitePreferNative");
const sitePreferNativeRow = document.getElementById("sitePreferNativeRow");
const info = document.getElementById("info");

// 「已用」那一行只报页面实际用了哪个方法（native / filter / remap）
const METHOD_NAME_KEYS = {
  native: "methodNative",
  filter: "methodFilter",
  remap: "methodRemap",
};
// 本站手段里「跟随全局」这一档：含义是删掉 sites[host]，不是某个取值
const SITE_FOLLOW = "follow";
let currentTab = null;
let currentHost = "";
let currentGlobal = MODEL.DEFAULT_GLOBAL;
let currentSite = null;   // null = 跟随全局

function methodName(method) {
  const key = METHOD_NAME_KEYS[method];
  return key ? t(key) : "";
}

// 静态文案由 data-i18n 标注，这里统一填充
function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  }
}

function sendToTab(action, extra) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(currentTab.id, { action, ...extra }, (response) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

// 全局设置跟当前页无关：连不上内容脚本时直接从 storage 兜底读
async function readGlobalSetting() {
  try {
    const s = await chrome.storage.sync.get({ global: null });
    return MODEL.normalizeSetting(s.global) || MODEL.DEFAULT_GLOBAL;
  } catch (e) {
    return MODEL.DEFAULT_GLOBAL;
  }
}

async function writeGlobalSetting(next) {
  try {
    await chrome.storage.sync.set({ global: next });
  } catch (e) {}
  await notifySettingsChanged();
}

// 写本站覆盖：null = 跟随全局（删掉这个键），对象 = 本站自己的断言
async function writeSiteSetting(next) {
  try {
    const s = await chrome.storage.sync.get({ sites: {} });
    const sites = { ...(s.sites || {}) };
    if (next === null) delete sites[currentHost];
    else sites[currentHost] = next;
    await chrome.storage.sync.set({ sites });
  } catch (e) {}
  await notifySettingsChanged();
}

function setRadioGroup(container, value) {
  for (const row of container.querySelectorAll(".radio-row")) {
    const on = row.dataset.value === value;
    row.classList.toggle("checked", on);
    const input = row.querySelector("input");
    if (input) input.checked = on;
  }
}

async function renderStatus(status) {
  modeSettings.style.display = "block";

  // 全局设置与当前页无关；读不到状态时用 storage 兜底，两组照常渲染
  currentGlobal = (status.error || !status.global)
    ? await readGlobalSetting()
    : status.global;
  currentHost = status.error ? "" : (status.host || "");
  currentSite = status.error ? null : (status.site || null);

  renderGlobal(currentGlobal);
  renderSite();

  // 徽章常驻描述页面明暗（扩展动手前采到的 isDark），与是否已应用无关；
  // 「用了什么方法」另起一行，不替代徽章。
  appliedMethod.style.display = "none";
  appliedMethod.textContent = "";

  // 不可访问时整页信息不可信
  if (status.error) {
    statusBadge.textContent = t("cannotAccessPage");
    statusBadge.className = "status light";
    info.textContent = t("cannotRunHere");
    return;
  }

  if (status.isDark) {
    statusBadge.textContent = t("darkPageDetected");
    statusBadge.className = "status dark";
  } else {
    statusBadge.textContent = t("lightPage");
    statusBadge.className = "status light";
  }
  info.textContent = "";

  if (status.isApplied) {
    appliedMethod.textContent = t("appliedMethod", [methodName(status.activeMode)]);
    appliedMethod.style.display = "block";
  }
}

// 全局组：开关 = global.enabled，关掉时收起下面的选项
function renderGlobal(global) {
  globalSwitch.classList.toggle("on", global.enabled);
  globalSwitch.setAttribute("aria-label", global.enabled ? t("switchOn") : t("switchOff"));
  globalSwitch.setAttribute("aria-pressed", String(global.enabled));
  globalOptions.style.display = global.enabled ? "block" : "none";
  setRadioGroup(globalMethods, global.method);
  globalPreferNative.checked = global.preferNative;
}

// 本站组：开关表示"这一站按不按扩展的处置走"，取「跟随全局」时是开的
function renderSite() {
  if (!currentHost) {
    siteSettings.style.display = "none";
    return;
  }
  siteSettings.style.display = "block";
  siteHost.textContent = currentHost;

  const following = currentSite === null;             // 「跟随全局」＝存储里没这个键
  const siteOn = following ? true : currentSite.enabled;

  siteSwitch.classList.toggle("on", siteOn);
  siteSwitch.setAttribute("aria-label", siteOn ? t("switchOn") : t("switchOff"));
  siteSwitch.setAttribute("aria-pressed", String(siteOn));
  siteOptions.style.display = siteOn ? "block" : "none";

  setRadioGroup(siteMethods, following ? SITE_FOLLOW : currentSite.method);

  // 跟随全局时只把「优先尝试原生」置灰（显示全局的值）；两个手段 radio 始终可点，
  // 点任一档即写死本站手段——这是用户从「跟随全局」走出来的唯一出口。
  sitePreferNativeRow.classList.toggle("disabled", following);
  sitePreferNative.disabled = following;
  sitePreferNative.checked = following ? currentGlobal.preferNative : currentSite.preferNative;
}

// 全局开关：关掉只把 global.enabled 置 false，其余字段原样保留
async function handleGlobalSwitch() {
  await writeGlobalSetting({ ...currentGlobal, enabled: !currentGlobal.enabled });
}

async function handleGlobalMethod(e) {
  const value = e.target.value;
  if (!MODEL.isMethod(value)) return;
  await writeGlobalSetting({ ...currentGlobal, method: value });
}

async function handleGlobalPreferNative() {
  await writeGlobalSetting({ ...currentGlobal, preferNative: globalPreferNative.checked });
}

// 本站开关：关掉 = 断言「本站别动」，写 enabled:false；手段与原生以本站已存值
// 为准（没设过本站才拿全局兜底），再通知内容脚本还原本站 localStorage 并重载。
// 从关闭再打开 = 沿用本站已存的手段与原生偏好。
async function handleSiteSwitch() {
  const following = currentSite === null;
  const siteOn = following ? true : currentSite.enabled;
  if (siteOn) {
    const base = currentSite || { preferNative: currentGlobal.preferNative, method: currentGlobal.method };
    await writeSiteSetting({ ...base, enabled: false });
    await sendToTab("stopSite");
    return;
  }
  await writeSiteSetting({ ...currentSite, enabled: true });
}

// 本站手段：「跟随全局」= 删掉这个键，其余 = 本站写死一个方法
async function handleSiteMethod(e) {
  const value = e.target.value;
  if (value === SITE_FOLLOW) {
    await writeSiteSetting(null);
    return;
  }
  if (!MODEL.isMethod(value)) return;
  const preferNative = currentSite ? currentSite.preferNative : currentGlobal.preferNative;
  await writeSiteSetting({ enabled: true, preferNative, method: value });
}

async function handleSitePreferNative() {
  if (currentSite === null) return;   // 跟随全局时这一项只读
  await writeSiteSetting({ ...currentSite, preferNative: sitePreferNative.checked });
}

// 写完设置后通知当前页重新决策，再拉一次真实状态重绘
async function notifySettingsChanged() {
  await sendToTab("settingsChanged");
  const status = await sendToTab("getStatus");
  await renderStatus(status);
}

// --- Init ---
applyI18n();

globalSwitch.addEventListener("click", handleGlobalSwitch);
globalMethods.addEventListener("change", handleGlobalMethod);
globalPreferNative.addEventListener("change", handleGlobalPreferNative);
siteSwitch.addEventListener("click", handleSiteSwitch);
siteMethods.addEventListener("change", handleSiteMethod);
sitePreferNative.addEventListener("change", handleSitePreferNative);

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  currentTab = tab;
  const status = await sendToTab("getStatus");
  await renderStatus(status);
});
