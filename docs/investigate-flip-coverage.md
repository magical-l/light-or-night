# 调研：让扩展能多翻一些站（2026-10-14）

起因是 `docs/todo.txt` 的「优化1」——**尝试点击页面上自带的「浅色/深色」按钮**。这轮把几条候选路都拿到真实站点上量了一遍，结论是**只值得做其中一条**（现代色彩语法），其余全部否掉。

本文记的是**结论和依据**。每条都注明是怎么测的，测不出结论的地方直接写"没验"。

**怎么测的**：Playwright MCP 驱动一个**独立 Chrome**（`localhost:9222`，没装扩展）。样本 12 个站：bing / github / youtube / zhihu / wikipedia / stackoverflow / mdn / reddit / bilibili / csdn / vercel / tailwindcss。探针脚本留在 `tmp/`（gitignored）。

---

## 一、点击站点自带的明暗控件 —— 否掉

### 机制本身可行

Playwright 的真鼠标事件（CDP）驱得动站点 JS。实测 tailwindcss.com：点「Dark theme」之后 `documentElement.className` 从 `…system` 变成 `…dark`，页面真的翻过去了。

### 匹配规则严不严，差一个数量级

| 规则 | 误报 | 命中真开关 |
|---|---|---|
| 「可访问名含主题词 + 可点」 | **9 个，全是 `<a>` 导航链接**（tailwind 的 `white-space`、`appearance` 两个文档页链接；wiki 的两个 Portal 链接；36kr 三个文章标题） | tailwind、wikipedia |
| 「不收 `<a>` + 标签本身是控件 + 名字**整个**等于主题词」 | **0 个** | tailwind、wikipedia |

「含主题词」那条里最毒的是 `white` 命中 `white-space`、`appearance` 命中 CSS 属性页 `appearance`——**越像主题词的词越危险**，而这两个词本来就在项目现有的 `DARK_LIGHT_WORDS` 里。

### 但覆盖很薄

12 个站里只有 2 个（tailwind / wikipedia）有"直接可见、名字是主题词"的控件。**真开关大多藏在菜单里**：bing 是齿轮→外观、youtube 是设置→外观、github 在头像菜单——第一步的可访问名是「设置」「更多」，不含主题词，裸名字匹配连门都找不到。

**而两步那条路要可见地展开菜单**（视觉上打开又关掉，失败还得补一次关闭）——这是可见的残留状态，已排除。

> 样本都是未登录的大站；长尾小站/文档站把开关直接放页头的比例会高不少。**这条没验。**

---

## 二、从 CSS 里找「哪些类决定明暗」直接用 —— 否掉

### 读不到 CSS **不是**障碍

跨域样式表的 `cssRules` 一读就抛 `SecurityError`（bing 10 张里 6 张、youtube 16 张里 3 张、csdn 8 张里 6 张）。但用 `fetch` 拿文本能绕过——实测取回 272KB 那张，`b_dark` 出现 56 次。拿回来用 `CSSStyleSheet.replaceSync(text)` 解析，选择器和声明都读得到（`@import` 要先剥掉，`replaceSync` 不接受它）。

### 但钩子本身不管用

NOTES 里记着「bing 用的是 `b_dark`」。核实并实测：

- **`b_dark` 是挂在 `body` 上的，不是 `html`**（CSS 里全是 `body.b_dark …`、`body:not(.b_dark) …`、`.b_dark #sb_form …`）
- **挂上去，画面纹丝不动**。`html`/`body` 底色、字体色、面积最大的 6 个元素的底色前后**完全一致**，前后截图也看不出差别（只有底部一个轮播自己换了内容）

原因：`b_dark` 在 bing 的 CSS 里是个**碎片钩子**——引用它的规则改的是搜索框、`.scopes` 文字颜色这些小件，**没有任何一条用它换页面背景**。

**而且 bing 首屏本来就是一张全屏背景照片 + 白色模块**，"翻 bing 首页"这件事本身就没有意义。

### bing 真正的问题不是「切不动」，是「判定错」

它声明 `body` 是 `rgba(34, 34, 34, 0.9)`（判**深**），实见却是照片 + 白模块。这是 NOTES「已知边界」里已记录的**「声明被盖住的站」**，出口是站点级设置（bing 关闭 / xiutaku 断言成颜色映射）。**跟"能不能切换"无关。**

---

## 三、跨域 CSS 读不到（作为一项独立修复）—— 否掉

### 普遍度实测

| 站 | 样式表 | 被跨域挡 | 能读到的选择器 | html/body 上的主题钩子 |
|---|---|---|---|---|
| github | 35 | 0 | 37125 | `data-color-mode` 等 ✅ |
| mdn | 20 | 0 | 336 | `data-theme` ✅ |
| vercel | 7 | 0 | 10759 | `.light-theme` ✅ |
| wikipedia / stackoverflow / reddit / tailwind / zhihu | — | **0** | — | 都有钩子 ✅ |
| bing | 8 | 2 | 1169 | **无** |
| youtube | 16 | 3 | 19474 | **无** |
| csdn | 8 | 6 | **13** | **无** |
| bilibili | 2 | 1 | **3** | **无** |

**有主题钩子的 8 个站，CSS 全是可读的**（github / mdn 的 CDN 带了 CORS 头）。**CSS 读不到的 4 个站，html/body 上一个钩子都没有。**

→ 这条修复要补的证据，**恰好只在用不上它的站上缺**。收益 0/12。

### 代价还很高

MV3 里**内容脚本的跨域 fetch 受宿主页的 CORS 限制，`host_permissions` 也解不开**（Chrome 85 起）。要绕过去只能：

1. 新加一个 **background service worker** 承载 fetch（这个扩展现在根本没有 SW）
2. 配 `host_permissions: ["<all_urls>"]`
3. 加一条内容脚本 ↔ SW 的消息通道

为了一个收益 0/12 的能力，加一整个后台进程 + 权限扩张，还撞上 NOTES 的「**权限最小化 ✓**」上架硬门槛。

---

## 四、现代色彩语法（`lab()` / `oklch()`）—— **唯一采纳的一条**

Chrome 对**色域外**的计算色会保留原色彩空间。Tailwind v4 那类站上 `getComputedStyle` 给出的就是 `lab(1.90334 0.278696 -5.48866)`。

而 `parseColor()` 只认 `rgb()` / `hsl()` / `#hex`，认不出就返回 `null`。三处连锁失效：

| 位置 | 后果 |
|---|---|
| `detectPageTone()` = `unknown` | 自动路径**整站不动** |
| `verifyBecamePreference()` 恒判失败 | 原生切换**永远回滚** |
| `processElement()` 里 `if (!rgb) continue` | 颜色映射**静默跳过**该属性 |

**影响面**（抽样页面上最多 2000 个元素，看 `backgroundColor` / `color` / `borderTopColor` / `outlineColor`）：

| 站 | 含现代语法的元素占比 |
|---|---|
| tailwindcss.com | **50%（498/996）** — `lab()` 969 处、`oklab()` 123 处 |
| vercel.com | 0.1%（1/989） |
| mdn / github / bing / zhihu | 0 |

**窄，但命中时 remap 废一半、判定恒 `unknown`。**

**修法已验证**（细节见 `2026-10-14-parsecolor-modern-color.md`）：

- 用 1×1 canvas 画一格再 `getImageData` 读像素，浏览器自己做色彩空间转换。实测 `lab(1.90334 …)`→`rgb(3, 7, 18)`、`color(srgb 0.1 0.2 0.3)`→`rgb(26, 51, 77)`（精确）
- **不能用 `fillStyle` 的读值归一**——`lab(...)` 进、`lab(...)` 出，只有 `rgb()`/`hsl()` 会被归成 hex
- 成本可忽略：tailwind 一页 3984 次 `parseColor` 调用，**只有 22 个不同的现代色字符串**，全量转换 16ms

---

## 五、改站点的 CSS 变量 token —— 否掉

想法是：不逐元素改色，直接覆盖站点定义的颜色变量，让浏览器自己重算。三个缺口：

1. **拿不到 token 清单。** 没有 API 能枚举一个页面定义了哪些 CSS 变量；要拿就得解析样式表 → 撞回第三条那条死路（跨域读不到）。
2. **token 不带角色。** 这是更要命的：remap 的核心判断是**这个颜色扮演什么角色**——同一个 `#0c0c0c`，当底色要翻成奶油 L\*97、当文字要翻成墨色 L\*34、当边框要翻成 L\*70。角色只能从元素的**计算样式**（`style.backgroundColor` / `style.color` / `style.borderTopColor`）读出来，而 `--color-gray-950` 这个名字只说了"灰 950"，没说它是底还是字。
3. **同一个 token 可能同时当底又当字**，那就需要两个不同的覆盖值，一个 `:root {...}` 表达不了。

---

## 六、顺带查明的既有行为：remap 会顶掉颜色动画

实测（`@keyframes` 动画 `background-color`）：

```
动画正在跑              → rgb(255, 0, 0)
加上内联 !important     → rgb(0, 255, 0)   ← 我们的值赢，动画被顶掉
改回内联（不带 important）→ rgb(255, 0, 0)   ← 动画又活了
```

CSS 层叠规定 **important author 高于 animation**。而 remap 必须用 `!important` 才能盖过站点的样式表（`setProperty(prop, val, "important")`）——**能盖住站点的，就一定能盖住动画**。

要"既改色、又不杀动画"，只能去掉动画元素上的 `!important`（代价：动画期间那个元素不受 remap 管，显示站点原色），或者去改站点的 keyframes / CSS 变量（见第五条，不通）。

**"跳过动画元素"曾被我当成缓存表的增长来源，这条不成立**：remap 把 `!important` 写上去之后动画不再生效，那个元素之后每次贡献**同一个固定色**，自己就收敛了。缓存的真实增长来源只剩"无限滚动 / 持续生成新颜色"。

**本轮不改，只记账。**

---

## 附：性能对照（用于判断要不要动 remap 的遍历架构）

复刻 `processTree` 的主要开销（TreeWalker 走一遍 + 每元素 `getComputedStyle` + 读 7 个颜色属性），取三遍最好值：

| 站 | 元素数 | 耗时 |
|---|---|---|
| zhihu | 239 | 0.8ms |
| bing | 515 | 2.4ms |
| csdn | 1563 | 6.4ms |
| github | 1814 | 6.9ms |
| tailwind | 1110 | 6.9ms |
| youtube | 2282 | 21ms（首遍冷启动 80ms） |

**最重的一页 21ms，不是性能隐患。** 逐元素遍历只有 remap 有（滤镜只插一个 `<style>`、原生切换只改几个属性），但它的代价小到可以忽略，**不值得为它改架构**。
