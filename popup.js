// Don't! Paint it black — Popup
// Author: Marcin Kleczek <marcin.kleczek@gmail.com>
// License: MIT

const statusBadge = document.getElementById("statusBadge");
const modeSelector = document.getElementById("modeSelector");
const modeNative = document.getElementById("modeNative");
const modeFilter = document.getElementById("modeFilter");
const modeRemap = document.getElementById("modeRemap");
const actionBtn = document.getElementById("actionBtn");
const validation = document.getElementById("validation");
const valSummary = document.getElementById("valSummary");
const valList = document.getElementById("valList");
const info = document.getElementById("info");

const modeBtns = [modeNative, modeFilter, modeRemap];
let currentTab = null;
let selectedMode = null;

const MODE_LABELS = {
  native: "Switch to Native Light",
  filter: "Apply Quick Filter",
  remap: "Apply Precise Solarized",
};
const MODE_PROGRESS = {
  native: "Switching...",
  filter: "Filtering...",
  remap: "Remapping...",
};

function sendToTab(action, extra) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(currentTab.id, { action, ...extra }, (response) => {
      if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

function selectMode(mode) {
  selectedMode = mode;
  for (const btn of modeBtns) btn.classList.toggle("selected", btn.dataset.mode === mode);
  actionBtn.textContent = MODE_LABELS[mode] || "Apply";
  actionBtn.disabled = false;
}

function renderStatus(status) {
  if (status.error) {
    statusBadge.textContent = "Cannot access page";
    statusBadge.className = "status light";
    actionBtn.disabled = true;
    info.textContent = "Can't run on this page (chrome://, extensions, etc.)";
    return;
  }

  if (status.isApplied) {
    const modeNames = { native: "Native Light", filter: "Quick Filter", remap: "Precise Solarized" };
    statusBadge.textContent = modeNames[status.activeMode] || "Applied";
    statusBadge.className = "status applied";
    modeSelector.style.display = "none";
    actionBtn.textContent = "Undo & Reload";
    actionBtn.className = "btn btn-remove";
    actionBtn.disabled = false;
    actionBtn.onclick = handleRemove;
    if (status.activeMode === "remap") runValidation();
    return;
  }

  if (status.isDark) {
    statusBadge.textContent = "Dark page detected";
    statusBadge.className = "status dark";
    info.textContent = "";
  } else {
    statusBadge.textContent = "Light page";
    statusBadge.className = "status light";
    info.textContent = "Page doesn't appear dark, but you can force it";
  }

  // Show mode selector
  modeSelector.style.display = "flex";

  if (status.hasNative) {
    modeNative.style.display = "flex";
    selectMode("native");
  } else {
    modeNative.style.display = "none";
    selectMode("filter");
  }

  // Wire mode buttons
  for (const btn of modeBtns) {
    btn.onclick = () => selectMode(btn.dataset.mode);
  }

  actionBtn.className = "btn btn-apply";
  actionBtn.onclick = handleApply;
}

async function handleApply() {
  actionBtn.disabled = true;
  actionBtn.textContent = MODE_PROGRESS[selectedMode] || "Applying...";

  await sendToTab("apply", { mode: selectedMode });

  const modeNames = { native: "Native Light", filter: "Quick Filter", remap: "Precise Solarized" };
  statusBadge.textContent = modeNames[selectedMode] || "Applied";
  statusBadge.className = "status applied";
  modeSelector.style.display = "none";
  actionBtn.textContent = "Undo & Reload";
  actionBtn.className = "btn btn-remove";
  actionBtn.disabled = false;
  actionBtn.onclick = handleRemove;
  info.textContent = "";

  if (selectedMode === "remap") runValidation();
}

async function handleRemove() {
  await sendToTab("remove");
}

async function runValidation() {
  validation.style.display = "block";
  valSummary.textContent = "Scanning...";
  valList.innerHTML = "";

  const result = await sendToTab("validate");
  if (result.error) { valSummary.textContent = "Validation failed"; return; }

  const critCount = result.issues.filter((i) => i.level === "critical").length;
  const warnCount = result.issues.filter((i) => i.level === "warning").length;

  if (result.issues.length === 0) {
    valSummary.innerHTML = `<span class="val-ok">All ${result.checked} elements pass WCAG AA</span>`;
  } else {
    const parts = [`${result.passed}/${result.checked} pass`];
    if (critCount > 0) parts.push(`<span class="val-crit">${critCount} critical (&lt;3:1)</span>`);
    if (warnCount > 0) parts.push(`<span class="val-warn">${warnCount} warning (&lt;4.5:1)</span>`);
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
chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
  currentTab = tab;
  const status = await sendToTab("getStatus");
  renderStatus(status);
});
