// 把 icons/icon.svg 栅格化成 icons/icon{16,48,128}.png。
// 改图标只改那个 SVG，然后跑：node tools/make-icons.cjs
//
// 依赖 Playwright（本机装在全局，路径写死在这里；换机器改 PW 即可）。
// 为什么不用图形软件：SVG 是矢量源、可 review、可 diff；栅格化用浏览器引擎，
// 出来的就是 Chrome 真实渲染的样子，而且三个尺寸一定同源。
const PW = "C:/Users/lwj/AppData/Roaming/npm/node_modules/playwright";
const { chromium } = require(PW);
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "icons", "icon.svg");

(async () => {
	const svg = fs.readFileSync(SRC, "utf8");
	const browser = await chromium.launch({ channel: "chromium", headless: true });
	const page = await browser.newPage();
	await page.setContent("<body></body>");
	const rendered = await page.evaluate(async (markup) => {
		const out = [];
		for (const size of [16, 48, 128]) {
			const cv = document.createElement("canvas");
			cv.width = size; cv.height = size;
			const ctx = cv.getContext("2d");
			const img = new Image();
			img.src = "data:image/svg+xml," + encodeURIComponent(markup);
			await img.decode();
			ctx.drawImage(img, 0, 0, size, size);
			out.push({ size, data: cv.toDataURL("image/png").split(",")[1] });
		}
		return out;
	}, svg);
	for (const r of rendered) {
		const file = path.join(ROOT, "icons", `icon${r.size}.png`);
		fs.writeFileSync(file, Buffer.from(r.data, "base64"));
		console.log(`  icons/icon${r.size}.png`);
	}
	await browser.close();
})();
