# 深色/浅色判定 与「无法访问页面」

记录两件事：① 深色/浅色判定的语义与样本（`https://xiutaku.com/`）；② 同一站点上 popup 有时显示「无法访问页面」的成因。

## 判定逻辑（现状）

都在 `content.js`：

| 符号 | 作用 |
|---|---|
| `detectPageTone()` | 主判定：取画布底色再 `isDark`，返回 `dark` / `light` / `unknown`（本文写于改名之前） |
| `firstPaintedBackground(el)` | **画布信号**：从 `el` 沿 `parentElement` 向上找第一个真画了背景的元素 |
| `isTransparentColor(cssColor)` | 判透明 |
| `isDark(rgb)` | 阈值：**相对亮度 < 0.2**（≈ L\*51.6） |

判定函数现在是 `detectPageTone()`（本文写于加偏好方向之前，当时叫 `detectDarkPage()`），就两条：

1. **看画布**：`firstPaintedBackground(document.body)`——body 沿祖先向上第一个给盒子画了背景色的元素，它的底色就是站点底色。不采信 `meta[theme-color]`（那是浏览器 UI 的品牌色）。
2. **画布没信号**（body 和 html 都没画底）→ 返回 `"unknown"`，**两个方向都不动手**。

**为什么只看声明、不看实见**：不是因为声明更准，而是**"实见"那条线原则上画不出来**——一个深色底色的页面盖一块大面积白色 div，和"一个白色页面带一圈黑色边框"，渲染结果可以完全一样，没有阈值能切开。所以判定不碰屏幕内容。（早先版本"body/html 都没画底时抓 5 个元素数深色"、以及后来讨论过的"按坐标点采样看实见"都是想绕开这一点，最后都删了/否了。）

## `xiutaku.com` 实测（2026-10-13，Kimi WebBridge 驱动真实浏览器，视口 1433×829）

| 元素 | `backgroundColor` | 相对亮度 (WCAG) |
|---|---|---|
| `html` | `rgb(255,255,255)` | 1.0 |
| `body` | `rgba(0,0,0,0)` | 透明 |
| `div.is-full.main-container`（body 的直接子元素） | `rgb(0,0,0)` | 0.0 |
| `nav.navbar.main-menu` | `rgb(255,237,185)` | 0.853 |
| `div.footer.is-full` | `rgb(255,237,185)` | 0.853 |

`div.main-container` 矩形 `x=0 y=52 1418×4296`，铺满 52px 顶栏以下的整个正文区；视口 10×10 网格采样 **90 格深 / 10 格浅**（浅的就是那条顶栏）。

**定性**：这是个「**浅色外壳 + 深色内容区**」的站——`html` 明确设了白、顶栏和页脚是浅黄 `rgb(255,237,185)`，只有图墙那块是黑的。按现在的判定它**判浅**，扩展不动它。

页面上没有 `meta[theme-color]`、没有 `meta[color-scheme]`、`prefers-color-scheme: dark` 为 false、`color-scheme: normal`。

## 验证

把落盘的 `content.js` 里的判定函数原样抽出来、在真实页面上跑：

| 场景 | 结果 |
|---|---|
| `xiutaku.com`（画布有信号：`html` 白） | **浅**、不动 |
| `xiutaku.com`，把画布用内联 `!important` 强设透明 → 画布无信号 | **浅**、不动 |
| `en.wikipedia.org` | **浅**、不动 |
| `en.wikipedia.org`，把画布强设黑 | **深** |

## 判浅页面的手动出口：站点级「断言」

判浅的页面自动路径永远不动它，需要一个**持久**的手动入口来翻。这个入口就是站点级的「断言」：

- 站点级选一个具体手段（滤镜反转／颜色映射）＝断言：不检测，一律按选定的手段处理——`resolveSetting()` 返回 `action: "force"`，`autoApply` 不走 `isDark` 那一关。
- 站点级「关闭」＝该站键存在且 `enabled: false`，挡住自动路径。
- 「跟随全局」＝该站键不存在，落回全局的自动判断。

xiutaku 这类「画布在骗人」的站（声明浅色、实际大片深色）就靠这个出口翻。

## 「无法访问页面」

代码路径（读码即定）：

- `popup.js` 的 `sendToTab` 把**任何** `chrome.runtime.lastError` 都 resolve 成 `{error}`；`renderStatus` 见 `status.error` 就把徽章设成「无法访问页面」，且不区分「浏览器页面」与「连不上内容脚本」。
- `content.js` 的消息监听器：iframe 里 `return;` 不回包 ⇒ **只有顶层帧会应答**。所以「无法访问页面」= **顶层帧的内容脚本没应答**。
- 顶层应答链是 `ready.then(getStatus).then(sendResponse)`；内容脚本不在顶层帧、或 `ready` 从未 settle / reject，`sendResponse` 就永不调用 → 端口无响应关闭 → `lastError`。

成因：① 刚在扩展管理页点过「重新加载」而页面没刷新——已注入的脚本 `chrome.runtime` 失效（用户已确认「有时」就是这个）；② popup 开在 `document_idle` 之前；③ 标签页是浏览器页面（`edge://`、PDF、扩展页）。

**状态：已定性**——重新加载扩展后旧页面里没刷新的内容脚本失效；刷新页面即可。

## 本机怎么验

- **两个浏览器别混**：Kimi WebBridge（`curl http://127.0.0.1:10086`）驱动的是用户的 **Edge**，**扩展在里面**，端到端验它；Playwright MCP（`browser_connect` → `localhost:9222`）连的是**另一个 Chrome**，**没装扩展**。判扩展在不在，只看 WebBridge 通道上的页面证据（`#dpib-remap-global` / `data-dpib-*` / `documentElement.style.colorScheme`）。
- 改完 `content.js` 要在扩展管理页点一次「**重新加载**」才生效。
- Windows 下 WebBridge 的**请求体写成文件**再 `curl.exe` 发（中文经 shell 会被破坏）。
- **判定是数值判断**：读 `getComputedStyle(...).backgroundColor` 和相对亮度，把**数字**贴出来，别靠肉眼看截图。
- **商店域名对扩展封死**：chrome / edge 商店的 `navigate` / `find_tab` / `evaluate` / `cdp` 全被拒，只有 `Target.createTarget` 能开。查商店别走脚本，人肉看最快。
