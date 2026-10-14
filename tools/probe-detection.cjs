// 用法: node tools/probe-detection.cjs '<尾部JS表达式>' > /tmp/req.json
// 尾部可用的东西: detectDarkPage() / firstPaintedBackground(el) / getComputedStyle 等
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").split(/\r?\n/);

const a = src.findIndex((l) => l.startsWith("function parseColor("));
const b = src.findIndex((l) => l.startsWith("function detectDarkPage("));
if (a < 0 || b < 0) throw new Error("锚点没找到：parseColor / detectDarkPage");
let end = -1;
for (let i = b + 1; i < src.length; i++) if (src[i] === "}") { end = i; break; }
if (end < 0) throw new Error("detectDarkPage 收尾没找到");

const tail = process.argv[2];
if (!tail) throw new Error("缺少尾部表达式");
const code = "(()=>{" + src.slice(a, end + 1).join("\n") + "\n" + tail + "})()";

process.stdout.write(JSON.stringify({
  action: "evaluate",
  args: { code },
  session: "dpib-detect",
}));
