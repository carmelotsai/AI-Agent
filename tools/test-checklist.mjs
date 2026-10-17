// 從學員手冊抽出各課的考核段落，做成一份可以勾選的實機測試清單（單檔 HTML）。
// 用法：node tools/test-checklist.mjs <輸出.html> [L0 L1 L2 L3 …]（沒給就是 L0～L3）
// 勾選結果存在瀏覽器（localStorage）；「匯出結果」下載 Markdown，可以交給 coding agent 整理問題。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const [out, ...levels] = process.argv.slice(2);
if (!out) {
  console.error("用法：node tools/test-checklist.mjs <輸出.html> [L0 L1 L2 L3 …]");
  process.exit(1);
}
const wanted = levels.length ? levels : ["L0", "L1", "L2", "L3"];
const order = (name) => name.replace(/_.*/, "").split(/[-]/).map((part, index) => (index === 0 ? part : part.padStart(2, "0"))).join("-");
const files = readdirSync("docs")
  .filter((name) => name.endsWith("學員手冊.md") && wanted.some((level) => name.startsWith(`${level}-`) || name.startsWith(`${level}_`)))
  .sort((a, b) => order(a).localeCompare(order(b), "en"));

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** 手冊裡的考核段落：從「## …考核…」到下一個 ---。 */
function assessment(markdown) {
  const start = markdown.search(/^## .*考核.*$/m);
  if (start < 0) return null;
  const end = markdown.indexOf("\n---\n", start);
  return markdown.slice(start, end < 0 ? undefined : end).replace(/^## .*\n/, "").trim();
}

marked.use({
  gfm: true,
  renderer: {
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      return /^https?:/i.test(href ?? "") ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${text}</a>` : text;
    },
  },
});

const lessons = [];
for (const file of files) {
  const markdown = readFileSync(join("docs", file), "utf8");
  const section = assessment(markdown);
  if (!section) continue;
  const id = file.replace(/_.*/, "");
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? id).replace(/｜學員手冊$/, "").replace(/[`*]/g, "");
  lessons.push({ id, level: id.replace(/[-_].*/, ""), title, html: marked.parse(section) });
}

const LEVEL_NAMES = { L0: "L0・招聘準備", L1: "L1・到職", L2: "L2・在職訓練", L3: "L3・授權配發" };
const nav = wanted.map((level) => {
  const items = lessons.filter((lesson) => lesson.level === level);
  if (!items.length) return "";
  return `<div class="nav-group"><b>${LEVEL_NAMES[level] ?? level}</b>${items.map((lesson) => `<a href="#${lesson.id}" data-lesson="${lesson.id}">${escapeHtml(lesson.title)}<span class="count"></span></a>`).join("")}</div>`;
}).join("");
const body = lessons.map((lesson) => `<section class="lesson" id="${lesson.id}" data-lesson="${lesson.id}" data-title="${escapeHtml(lesson.title)}">
<h2>${escapeHtml(lesson.title)}<span class="count"></span></h2>
${lesson.html}
</section>`).join("\n");

const CSS = `
:root{--bg:#f7f6f2;--fg:#1f2328;--muted:#5d6570;--line:#dcd8cf;--card:#fff;--head:#f0ede6;--accent:#2f6fb3;--ok:#1f8a4c;--ok-bg:#e3f4ea;--bad:#c0392b;--bad-bg:#fbe5e2;--skip:#8a6d1f;--skip-bg:#f6efd9;--code:#f1efe9}
@media (prefers-color-scheme:dark){:root{--bg:#1b1c1e;--fg:#e6e6e3;--muted:#a3a7ad;--line:#393b3f;--card:#232427;--head:#2c2e32;--accent:#7fb0e8;--ok:#5fcf8f;--ok-bg:#1f3a2a;--bad:#f08a7c;--bad-bg:#43241f;--skip:#e0c46a;--skip-bg:#3b331c;--code:#2b2c30}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 "Microsoft JhengHei UI","Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif}
header.top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:10px 16px}
.top-inner{max-width:1280px;margin:0 auto;display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center}
.top h1{font-size:18px;margin:0 12px 0 0}
.stat{font-size:14px;color:var(--muted)}.stat b{color:var(--fg)}
.bar{flex:1 1 220px;height:8px;background:var(--line);border-radius:4px;overflow:hidden;display:flex;min-width:160px}
.bar i{display:block;height:100%}.bar .ok{background:var(--ok)}.bar .bad{background:var(--bad)}.bar .skip{background:var(--skip)}
.btn{font:inherit;font-size:14px;padding:5px 12px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg);cursor:pointer}
.btn:hover{border-color:var(--accent);color:var(--accent)}
.layout{max-width:1280px;margin:0 auto;padding:20px 16px 80px;display:grid;grid-template-columns:minmax(0,1fr);gap:32px}
@media (min-width:1080px){.layout{grid-template-columns:250px minmax(0,1fr)}}
nav.side{display:none}
@media (min-width:1080px){nav.side{display:block;position:sticky;top:76px;align-self:start;max-height:calc(100vh - 96px);overflow:auto;font-size:14px}}
.nav-group{margin-bottom:14px}.nav-group b{display:block;color:var(--muted);margin-bottom:4px}
.nav-group a{display:flex;justify-content:space-between;gap:6px;color:var(--fg);text-decoration:none;padding:3px 0 3px 10px;border-left:2px solid var(--line)}
.nav-group a:hover{color:var(--accent);border-left-color:var(--accent)}
.count{font-size:12px;color:var(--muted);white-space:nowrap}.count.done{color:var(--ok)}.count.has-bad{color:var(--bad)}
main{min-width:0}
.intro{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin-bottom:24px}
.intro h2{margin-top:0;font-size:20px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-top:12px}
.meta label{font-size:13px;color:var(--muted);display:block}
.meta input{width:100%;font:inherit;font-size:15px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
section.lesson{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 20px 16px;margin-bottom:22px;scroll-margin-top:80px}
section.lesson h2{font-size:21px;display:flex;justify-content:space-between;gap:10px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:6px}
section.lesson h3{font-size:17px;margin:20px 0 8px}
p,ul,ol{margin:8px 0}
code{font-family:Consolas,"Cascadia Mono",monospace;font-size:.9em;background:var(--code);padding:.1em .35em;border-radius:4px}
pre{background:var(--code);padding:10px 12px;border-radius:6px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:12px 0;padding:8px 14px;border-left:4px solid var(--muted);background:var(--bg);border-radius:0 6px 6px 0}
a{color:var(--accent)}
.table{overflow-x:auto;margin:10px 0;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:14.5px}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--head);white-space:nowrap}tr:last-child td{border-bottom:0}
td:first-child{white-space:nowrap}
td.result{white-space:nowrap;min-width:196px}
.choice{display:inline-flex;gap:4px}
.choice button{font:inherit;font-size:13px;padding:3px 8px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--muted);cursor:pointer}
.choice button[aria-pressed=true][data-v=ok]{background:var(--ok-bg);color:var(--ok);border-color:var(--ok)}
.choice button[aria-pressed=true][data-v=bad]{background:var(--bad-bg);color:var(--bad);border-color:var(--bad)}
.choice button[aria-pressed=true][data-v=skip]{background:var(--skip-bg);color:var(--skip);border-color:var(--skip)}
td.result textarea{display:block;width:100%;margin-top:6px;font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);resize:vertical;min-height:32px}
tr.r-ok td{background:color-mix(in srgb,var(--ok-bg) 45%,transparent)}
tr.r-bad td{background:color-mix(in srgb,var(--bad-bg) 60%,transparent)}
tr.r-skip td{background:color-mix(in srgb,var(--skip-bg) 45%,transparent)}
@media (max-width:700px){th,td{padding:6px 7px}td.result{min-width:0}}
@media print{header.top,nav.side,.btn{display:none}.layout{display:block}section.lesson{break-inside:auto}}
`;

const SCRIPT = `
const KEY = "ai-secretary-test-checklist-v1";
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
const rows = [];
document.querySelectorAll("table").forEach((table) => {
  const wrap = document.createElement("div"); wrap.className = "table"; table.replaceWith(wrap); wrap.appendChild(table);
  const lesson = table.closest("section.lesson"); if (!lesson) return;
  const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  const testable = ["#", "步驟", "來自"].includes(heads[0]);
  if (!testable) return;
  const th = document.createElement("th"); th.textContent = "結果／備註"; table.querySelector("thead tr").appendChild(th);
  const tableIndex = [...lesson.querySelectorAll("table")].indexOf(table);
  table.querySelectorAll("tbody tr").forEach((tr, index) => {
    const cells = [...tr.children].map((td) => td.textContent.trim());
    const label = heads[0] === "#" ? cells[0] : heads[0] === "步驟" ? "步驟 " + cells[0] : cells[0] + "：" + cells[1];
    const key = lesson.dataset.lesson + "|" + tableIndex + "|" + index + "|" + label;
    const item = { key, lesson: lesson.dataset.lesson, title: lesson.dataset.title, label, text: cells.slice(1).join("｜"), tr };
    rows.push(item);
    const td = document.createElement("td"); td.className = "result";
    td.innerHTML = '<span class="choice"><button type="button" data-v="ok">✅ 通過</button><button type="button" data-v="bad">❌ 不通過</button><button type="button" data-v="skip">⏭ 略過</button></span><textarea rows="1" placeholder="備註（選填）"></textarea>';
    tr.appendChild(td);
    const saved = state[key] || {};
    const note = td.querySelector("textarea"); note.value = saved.note || "";
    const paint = () => {
      const value = (state[key] || {}).v;
      td.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === value)));
      tr.className = value ? "r-" + value : "";
    };
    td.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const current = state[key] || {};
      state[key] = { ...current, v: current.v === b.dataset.v ? undefined : b.dataset.v, at: new Date().toISOString() };
      save(); paint(); summarize();
    }));
    note.addEventListener("input", () => { state[key] = { ...(state[key] || {}), note: note.value }; save(); });
    paint();
  });
});
const meta = document.querySelectorAll(".meta input");
meta.forEach((input) => {
  input.value = (state.__meta || {})[input.name] || "";
  input.addEventListener("input", () => { state.__meta = { ...(state.__meta || {}), [input.name]: input.value }; save(); });
});
function summarize() {
  const count = (list, v) => list.filter((row) => (state[row.key] || {}).v === v).length;
  const all = rows.length, ok = count(rows, "ok"), bad = count(rows, "bad"), skip = count(rows, "skip");
  document.getElementById("s-all").textContent = all;
  document.getElementById("s-ok").textContent = ok;
  document.getElementById("s-bad").textContent = bad;
  document.getElementById("s-skip").textContent = skip;
  document.getElementById("s-todo").textContent = all - ok - bad - skip;
  const pct = (n) => all ? (n / all * 100) + "%" : "0";
  document.querySelector(".bar .ok").style.width = pct(ok);
  document.querySelector(".bar .bad").style.width = pct(bad);
  document.querySelector(".bar .skip").style.width = pct(skip);
  document.querySelectorAll("[data-lesson]").forEach((el) => {
    const list = rows.filter((row) => row.lesson === el.dataset.lesson);
    const span = el.querySelector(".count"); if (!span || !list.length) return;
    const done = list.filter((row) => (state[row.key] || {}).v).length, bads = count(list, "bad");
    span.textContent = done + "/" + list.length + (bads ? "・❌" + bads : "");
    span.className = "count" + (bads ? " has-bad" : done === list.length ? " done" : "");
  });
}
summarize();
function report() {
  const m = state.__meta || {};
  const mark = { ok: "✅", bad: "❌", skip: "⏭" };
  const lines = ["# AI 秘書 L0～L3 實機測試結果", "", "- 測試日期：" + (m.date || ""), "- 測試者：" + (m.tester || ""), "- 環境：" + (m.env || ""), "- 秘書版本：" + (m.version || ""), ""];
  const count = (v) => rows.filter((row) => (state[row.key] || {}).v === v).length;
  lines.push("通過 " + count("ok") + "、不通過 " + count("bad") + "、略過 " + count("skip") + "、未測 " + (rows.length - count("ok") - count("bad") - count("skip")) + "（共 " + rows.length + " 項）", "");
  const bads = rows.filter((row) => (state[row.key] || {}).v === "bad");
  if (bads.length) {
    lines.push("## 不通過的項目", "");
    for (const row of bads) lines.push("- **" + row.title + " " + row.label + "**：" + row.text + ((state[row.key] || {}).note ? "\\n  - 備註：" + state[row.key].note : ""));
    lines.push("");
  }
  let last = "";
  for (const row of rows) {
    if (row.lesson !== last) { lines.push("", "## " + row.title, ""); last = row.lesson; }
    const s = state[row.key] || {};
    lines.push("- " + (mark[s.v] || "⬜") + " " + row.label + "：" + row.text + (s.note ? "（備註：" + s.note + "）" : ""));
  }
  return lines.join("\\n") + "\\n";
}
document.getElementById("export").addEventListener("click", () => {
  const blob = new Blob([report()], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "AI秘書_L0-L3_測試結果_" + new Date().toISOString().slice(0, 10) + ".md"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
document.getElementById("copy").addEventListener("click", async (event) => {
  try { await navigator.clipboard.writeText(report()); event.target.textContent = "已複製"; } catch { event.target.textContent = "複製失敗，請用匯出"; }
  setTimeout(() => (event.target.textContent = "複製結果"), 1500);
});
document.getElementById("reset").addEventListener("click", () => {
  if (!confirm("清除這份清單的所有勾選和備註？（清掉就回不來）")) return;
  state = {}; save(); location.reload();
});
`;

const today = new Date().toLocaleDateString("sv-SE");
const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 秘書 L0～L3 實機測試清單</title>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="top-inner">
<h1>L0～L3 實機測試清單</h1>
<span class="stat">共 <b id="s-all">0</b> 項｜✅ <b id="s-ok">0</b>｜❌ <b id="s-bad">0</b>｜⏭ <b id="s-skip">0</b>｜未測 <b id="s-todo">0</b></span>
<span class="bar"><i class="ok"></i><i class="bad"></i><i class="skip"></i></span>
<button class="btn" id="export" type="button">匯出結果</button>
<button class="btn" id="copy" type="button">複製結果</button>
<button class="btn" id="reset" type="button">清除</button>
</div></header>
<div class="layout">
<nav class="side">${nav}</nav>
<main>
<div class="intro">
<h2>怎麼用這份清單</h2>
<ul>
<li>內容直接取自各課《學員手冊》的考核段落（產生日期 ${today}）。<b>每一課都要在那一課升級完成、關掉舊黑視窗、重新啟動、傳 <code>/new</code> 之後再測。</b></li>
<li>每一列按 ✅ 通過／❌ 不通過／⏭ 略過（再按一次可取消），有狀況寫在備註：看到什麼、截圖檔名都可以。</li>
<li>勾選和備註會自動存在<b>這台電腦的這個瀏覽器</b>，關掉再開還在；換電腦、換瀏覽器或用無痕視窗就看不到。</li>
<li>測完按上方「<b>匯出結果</b>」下載 Markdown 檔，交給 coding agent 或傳給課程作者整理問題。不通過的項目會排在最前面。</li>
<li>有「照這個順序，一次測完」的課，照那張表的順序做最快；兩張表都可以勾。</li>
</ul>
<div class="meta">
<div><label>測試日期</label><input name="date" placeholder="${today}"></div>
<div><label>測試者</label><input name="tester" placeholder="你的名字"></div>
<div><label>環境（coding agent、Windows 版本）</label><input name="env" placeholder="例如 agy、Windows 11"></div>
<div><label>秘書版本（tag 或 commit）</label><input name="version" placeholder="例如 L3-7"></div>
</div>
</div>
${body}
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
writeFileSync(out, html);
console.log(`✅ ${out}（${lessons.length} 課：${lessons.map((lesson) => lesson.id).join("、")}）`);
