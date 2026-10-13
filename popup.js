// Light or Night / 颠倒黑白 — Popup（派生自 Marcin Kleczek 的 Don't! Paint it black，MIT）
// Author: Marcin Kleczek <marcin.kleczek@gmail.com>
// License: MIT

function t(key, subs) {
  return chrome.i18n.getMessage(key, subs);
}

const statusBadge = document.getElementById("statusBadge");
const appliedMethod = document.getElementById("appliedMethod");
const modeSettings = document.getElementById("modeSettings");
const settingsDivider = document.getElementById("settingsDivider");
const globalModes = document.getElementById("globalModes");
const siteSettings = document.getElementById("siteSettings");
const siteCurrentLine = document.getElementById("siteCurrentLine");
const siteHost = document.getElementById("siteHost");
const siteExpandBtn = document.getElementById("siteExpandBtn");
const siteModes = document.getElementById("siteModes");
const actionBtn = document.getElementById("actionBtn");
const validation = document.getElementById("validation");
const valSummary = document.getElementById("valSummary");
const valList = document.getElementById("valList");
const info = document.getElementById("info");

// 「翻转模式」是唯一的设置概念，取值域全局与本站共用（6 选 1）。
// 本站多一个「跟随全局」，它不是取值之一，而是「不写进 sites」。
const MODE_LABEL_KEYS = {
  off: "modeOff",
  native: "modeNativeOnly",
  filter: "modeFilterOnly",
  remap: "modeRemapOnly",
  "native-filter": "modeNativeFilter",
  "native-remap": "modeNativeRemap",
};
// 「已用」那一行只报页面实际用了哪个方法（native / filter / remap）
const METHOD_NAME_KEYS = {
  native: "modeNativeName",
  filter: "modeFilterName",
  remap: "modeRemapName",
};
const SITE_FOLLOW = "follow-global";

let currentTab = null;
let siteExpanded = false;

function isMode(value) {
  return Object.prototype.hasOwnProperty.call(MODE_LABEL_KEYS, value);
}

function modeLabel(mode) {
  const key = MODE_LABEL_KEYS[mode];
  return key ? t(key) : "";
}

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
async function readGlobalMode() {
  try {
    const s = await chrome.storage.sync.get({ globalMode: "native" });
    return isMode(s.globalMode) ? s.globalMode : "native";
  } catch (e) {
    return "native";
  }
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
  settingsDivider.style.display = "block";

  // 全局模式组与当前页无关，任何分支都显示
  let globalMode = status.error ? null : status.globalMode;
  if (!isMode(globalMode)) globalMode = await readGlobalMode();
  setRadioGroup(globalModes, globalMode);

  renderSite(status);

  // 徽章常驻描述页面明暗（扩展动手前采到的 isDark），与是否已应用无关；
  // 「用了什么方法」另起一行，不替代徽章。
  appliedMethod.style.display = "none";
  appliedMethod.textContent = "";

  // 不可访问时整页信息不可信
  if (status.error) {
    statusBadge.textContent = t("cannotAccessPage");
    statusBadge.className = "status light";
    actionBtn.style.display = "none";
    validation.style.display = "none";
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

  if (status.isApplied) {
    actionBtn.style.display = "block";
    actionBtn.disabled = false;
    actionBtn.onclick = handleRemove;
    appliedMethod.textContent = t("appliedMethod", [methodName(status.activeMode)]);
    appliedMethod.style.display = "block";
    info.textContent = "";
    if (status.activeMode === "remap") runValidation();
    else validation.style.display = "none";
    return;
  }

  actionBtn.style.display = "none";
  validation.style.display = "none";
  info.textContent = status.isDark ? "" : t("lightPageHint");
}

// 本站行：只有拿得到 host 才显示；看不到 host 时只藏这一行，全局那组保留
function renderSite(status) {
  const host = status.error ? "" : (status.host || "");
  if (!host) {
    siteSettings.style.display = "none";
    siteCurrentLine.textContent = "";
    siteHost.textContent = "";
    return;
  }
  siteSettings.style.display = "block";
  siteHost.textContent = host;

  // 本站生效模式 = 本站覆盖值；siteMode === null 表示跟随全局
  if (status.siteMode == null) {
    siteCurrentLine.textContent = t("siteFollowCurrent", [modeLabel(status.mode)]);
  } else {
    siteCurrentLine.textContent = modeLabel(status.siteMode);
  }
  setRadioGroup(siteModes, status.siteMode == null ? SITE_FOLLOW : status.siteMode);

  siteModes.style.display = siteExpanded ? "flex" : "none";
  siteExpandBtn.textContent = siteExpanded ? t("collapse") : t("change");
}

function toggleSiteExpanded() {
  siteExpanded = !siteExpanded;
  siteModes.style.display = siteExpanded ? "flex" : "none";
  siteExpandBtn.textContent = siteExpanded ? t("collapse") : t("change");
}

// 改全局模式 = 写 globalMode
async function handleGlobalChange(e) {
  const value = e.target.value;
  if (!isMode(value)) return;
  try {
    await chrome.storage.sync.set({ globalMode: value });
  } catch (err) {}
  await notifySettingsChanged();
}

// 改本站模式：「跟随全局」= 删掉 sites[host]，其余 6 个值 = 写 sites[host]
async function handleSiteChange(e) {
  const value = e.target.value;
  if (value !== SITE_FOLLOW && !isMode(value)) return;
  const status = await sendToTab("getStatus");
  if (status.error || !status.host) return;
  try {
    const s = await chrome.storage.sync.get({ sites: {} });
    const sites = { ...(s.sites || {}) };
    if (value === SITE_FOLLOW) delete sites[status.host];
    else sites[status.host] = value;
    await chrome.storage.sync.set({ sites });
  } catch (err) {}
  await notifySettingsChanged();
}

// 写完设置后通知当前页重新决策，再拉一次真实状态重绘
async function notifySettingsChanged() {
  await sendToTab("settingsChanged");
  const status = await sendToTab("getStatus");
  await renderStatus(status);
}

// 「撤销，并不再翻转本站」：content.js 的 remove 会把本站设为关闭并恢复本页
async function handleRemove() {
  actionBtn.disabled = true;
  await sendToTab("remove");
  const status = await sendToTab("getStatus");
  await renderStatus(status);
}

async function runValidation() {
  validation.style.display = "block";
  valSummary.textContent = t("scanning");
  valList.innerHTML = "";

  const result = await sendToTab("validate");
  if (result.error) {
    valSummary.textContent = t("validationFailed");
    return;
  }

  const critCount = result.issues.filter((i) => i.level === "critical").length;
  const warnCount = result.issues.filter((i) => i.level === "warning").length;

  if (result.issues.length === 0) {
    valSummary.innerHTML =
      `<span class="val-ok">${t("allPass", [String(result.checked)])}</span>`;
  } else {
    const parts = [t("passCount", [String(result.passed), String(result.checked)])];
    if (critCount > 0) {
      parts.push(
        `<span class="val-crit">${t("criticalCount", [String(critCount)])}</span>`
      );
    }
    if (warnCount > 0) {
      parts.push(
        `<span class="val-warn">${t("warningCount", [String(warnCount)])}</span>`
      );
    }
    valSummary.innerHTML = parts.join(" &middot; ");
  }

  const sorted = result.issues.sort((a, b) => {
    if (a.level !== b.level) return a.level === "critical" ? -1 : 1;
    return a.ratio - b.ratio;
  });

  valList.innerHTML = sorted.map((issue) => `
    <div class="val-item">
      <span class="val-ratio ${issue.level === "critical" ? "val-crit" : "val-warn"}">${issue.ratio}:1</span>
      &lt;${issue.tag}&gt;
      <span class="val-text">"${escapeHtml(issue.text)}"</span>
      <div class="val-colors">text: ${issue.textColor} &middot; bg: ${issue.bgColor}</div>
    </div>
  `).join("");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Init ---
applyI18n();

globalModes.addEventListener("change", handleGlobalChange);
siteModes.addEventListener("change", handleSiteChange);
siteExpandBtn.addEventListener("click", toggleSiteExpanded);

chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  currentTab = tab;
  const status = await sendToTab("getStatus");
  await renderStatus(status);
});
