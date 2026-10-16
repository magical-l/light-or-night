# Privacy Policy — Light or Night / 颠倒黑白

**Last updated:** October 16, 2026 · 最后更新：2026 年 10 月 16 日

## The short version

This extension does not collect, store, or transmit any personal data. Period. Everything it does
happens inside your own browser, on your own device.

## 一句话

这个扩展不收集、不存储、不传输你的任何个人数据。它做的所有事都发生在你自己的浏览器里、你自己的设备上。

## What it does / 它做什么

Converts web pages to the light or dark tone you prefer — using the site's own light/dark theme when
it has one, and otherwise a color filter or a per-element color remap.

把网页翻成你偏好的明暗——站点自带浅色/深色主题就用它，没有就上滤镜或颜色映射。

## What it reads / 它读什么

- The current page's own styling: background and foreground colors, class names, `data-*`
  attributes, and the site's own stylesheets. Used to tell whether the page is light or dark, and to
  find the site's own theme switch.
- 当前页面的样式与属性：背景色和文字色、类名、`data-*` 属性，以及站点自己的样式表。用来判断这页是深
  是浅，以及找出这个站点自己的主题开关长什么样。

## What it writes / 它写什么

- Style and attribute changes in the current page's own DOM (in filter mode, a single `style`
  element). Turning the extension off for a site reverses them.
- Your settings, in the browser's own `chrome.storage.sync`: one global setting (on/off, light/dark/
  follow system, whether to try the site's own theme switch first, and which method) plus per-site
  exceptions. `sync` is the browser's own account-sync mechanism — the data never comes to us, and
  uninstalling the extension removes it.
- In one narrow case, the extension writes to the site's own `localStorage`: when a site keeps its
  theme there and offers nothing switchable in the DOM. It records the previous value first, writes
  it back if the change did not take effect, and also returns it when you turn the extension off for
  that site. Nothing else in `localStorage` is read or touched.
- 在当前页自己的 DOM 里改样式和属性（滤镜模式下加一个 `style` 元素）。把某个站点关掉时，这些改动会被
  撤销。
- 你的设置存在浏览器自己的 `chrome.storage.sync` 里：一份全局设置（开关、偏好方向、要不要优先尝试站点
  自带的主题切换、用哪个手段），加上每个站点的例外。`sync` 是浏览器自己的账号同步机制，数据不经过我
  们；卸载扩展即删除。
- 有一种很窄的情况会写进站点自己的 `localStorage`：站点把它的主题存在那里，而 DOM 层一点可切的都没有。
  写之前先记下原值，如果没生效就写回原值；把该站点关掉时也会把原值还回去。`localStorage` 里的其它内容
  一概不读、不动。

## What it does NOT do / 它不做什么

- No collection and no upload: no server, no analytics, no telemetry, no account.
- No network requests at all — there is not a single external URL in the shipped code.
- No remote code: no `eval`, no `new Function`, no dynamically injected scripts. All logic lives in
  the packaged files.
- No access to, or modification of, forms, passwords, cookies or browsing history.
- No third-party scripts, ads or tracking pixels.
- 不收集、不上传任何数据：没有服务器、没有统计、没有遥测、没有账号。
- 一个网络请求都不发——打包的代码里没有任何外部 URL。
- 不含远程代码：没有 `eval`、没有 `new Function`、不动态插入脚本，全部逻辑都在打包文件里。
- 不读也不改表单、密码、cookie、浏览历史。
- 不注入第三方脚本、广告或追踪像素。

## Permissions / 权限

- **storage** — stores the settings described above. / 存上面那些设置。
- **Access to all websites** — this is the extension's core function: it has to decide when the page
  loads, not after the user clicks something on every site. The content script only reads the page's
  styles, class names and attributes, and its changes live in that page's own DOM.
- **所有网站的访问权限** — 这就是这个扩展的主功能：它必须在页面加载时就决定要不要处理，做不到"每到一个
  站先点一下才生效"。内容脚本只读页面的样式、类名和属性，改动只写在该页自己的 DOM 里。

## Changes / 变更

If this policy ever changes, the updated version will be published here. / 政策有任何变化都会更新这个
页面。

## Contact / 联系

Open an issue in the project repository:
https://github.com/magical-l/light-or-night/issues
