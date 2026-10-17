// 把學員手冊（Markdown）轉成排版好的單檔 HTML，學員用瀏覽器雙擊就能看。
// 用法：node tools/handbook-html.mjs <輸出資料夾> [--pdf] [手冊.md ...]
//   沒給手冊時，轉 docs/ 底下所有「*學員手冊.md」。
//   加 --pdf 會再用 Microsoft Edge（Windows 內建）把每份 HTML 印成 A4 PDF，放在同一個資料夾。
// 產出的 HTML 不需要網路：CSS、腳本都內嵌；手冊之間的 .md 連結會改指向 .html。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { marked } from "marked";

const args = process.argv.slice(2);
const wantPdf = args.includes("--pdf");
const [outDir, ...inputs] = args.filter((arg) => arg !== "--pdf");
if (!outDir) {
  console.error("用法：node tools/handbook-html.mjs <輸出資料夾> [--pdf] [手冊.md ...]");
  process.exit(1);
}
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (wantPdf && !EDGE) {
  console.error("找不到 Microsoft Edge，沒辦法轉 PDF（只支援 Windows）。可以先轉 HTML，再用瀏覽器「列印 → 另存為 PDF」。");
  process.exit(1);
}

/** 用 Edge 在背景把 HTML 印成 PDF（獨立的暫存設定檔，不影響平常開著的瀏覽器）。 */
function printPdf(htmlFile, pdfFile) {
  const profile = mkdtempSync(join(tmpdir(), "handbook-pdf-"));
  try {
    execFileSync(EDGE, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${profile}`,
      `--print-to-pdf=${resolve(pdfFile)}`, pathToFileURL(resolve(htmlFile)).href], { stdio: "ignore", timeout: 60_000 });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
const files = inputs.length
  ? inputs
  : readdirSync("docs").filter((name) => name.endsWith("學員手冊.md")).sort().map((name) => join("docs", name));

const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slug = (text) => text.replace(/<[^>]+>/g, "").trim().replace(/[\s　]+/g, "-").replace(/[^\p{L}\p{N}\-_・]/gu, "");

function render(markdown) {
  const toc = [];
  const used = new Map();
  marked.use({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        let id = slug(html) || "section";
        const count = used.get(id) ?? 0;
        used.set(id, count + 1);
        if (count) id += `-${count}`;
        if (depth === 2) toc.push({ id, html });
        return `<h${depth} id="${id}">${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const local = href && !/^[a-z]+:/i.test(href) && /\.md(#.*)?$/.test(href);
        const target = local ? href.replace(/^(?:\.\/)?(?:docs\/)?/, "").replace(/\.md(#.*)?$/, ".html$1") : href;
        const external = /^https?:/i.test(target ?? "") ? ' target="_blank" rel="noopener"' : "";
        return `<a href="${escapeHtml(target ?? "")}"${title ? ` title="${escapeHtml(title)}"` : ""}${external}>${text}</a>`;
      },
    },
  });
  const body = marked.parse(markdown);
  // 緊接在大標題後面的 ## 是副標題，不放進目錄
  if (/^#\s.+\n+##\s/.test(markdown.trimStart())) toc.shift();
  return { body, toc };
}

const CSS = `
:root{--bg:#fbfaf7;--fg:#1f2328;--muted:#5d6570;--line:#dcd8cf;--card:#ffffff;--head:#f1eee7;--accent:#2f6fb3;--code-bg:#f3f1ec;--quote:#8a7f6a;--quote-bg:#f6f3ec}
@media (prefers-color-scheme:dark){:root{--bg:#1c1d1f;--fg:#e6e6e3;--muted:#a3a7ad;--line:#3a3c40;--card:#242528;--head:#2c2e32;--accent:#7fb0e8;--code-bg:#2a2b2f;--quote:#b3a98f;--quote-bg:#26262a}}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.8 "Microsoft JhengHei UI","Microsoft JhengHei","PingFang TC","Noto Sans TC",system-ui,sans-serif;-webkit-text-size-adjust:100%}
.layout{max-width:1180px;margin:0 auto;padding:32px 20px 80px;display:grid;grid-template-columns:minmax(0,1fr);gap:40px}
@media (min-width:1080px){.layout{grid-template-columns:230px minmax(0,1fr)}}
nav.toc{display:none}
@media (min-width:1080px){nav.toc{display:block;position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;font-size:14px;line-height:1.6}}
nav.toc b{display:block;color:var(--muted);font-weight:600;margin-bottom:8px}
nav.toc a{display:block;color:var(--muted);text-decoration:none;padding:4px 0 4px 10px;border-left:2px solid var(--line)}
nav.toc a:hover,nav.toc a.on{color:var(--accent);border-left-color:var(--accent)}
main{min-width:0;max-width:820px}
h1{font-size:30px;line-height:1.35;margin:0 0 6px}
h2{font-size:23px;margin:48px 0 14px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h1+h2{border:0;margin-top:0;font-size:18px;color:var(--muted);font-weight:500}
h3{font-size:19px;margin:32px 0 10px}
p,ul,ol{margin:10px 0}
li{margin:4px 0}
a{color:var(--accent)}
hr{border:0;border-top:1px solid var(--line);margin:36px 0}
strong{font-weight:700}
code{font-family:Consolas,"Cascadia Mono","Microsoft JhengHei",monospace;font-size:.9em;background:var(--code-bg);padding:.12em .4em;border-radius:4px}
pre{position:relative;background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow:auto;line-height:1.55}
pre code{background:none;padding:0;font-size:14.5px;white-space:pre}
pre button{position:absolute;top:8px;right:8px;font:13px system-ui,sans-serif;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:3px 10px;cursor:pointer}
pre button:hover{color:var(--accent);border-color:var(--accent)}
blockquote{margin:16px 0;padding:10px 16px;background:var(--quote-bg);border-left:4px solid var(--quote);border-radius:0 6px 6px 0}
blockquote p{margin:6px 0}
.table{overflow-x:auto;margin:14px 0;border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:15.5px;background:var(--card)}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--head);font-weight:600;white-space:nowrap}
tr:last-child td{border-bottom:0}
footer{margin-top:60px;color:var(--muted);font-size:13px}
@page{size:A4;margin:14mm 13mm}
@media print{:root{--bg:#fff;--fg:#1f2328;--muted:#555;--line:#ccc;--card:#fff;--head:#f1eee7;--code-bg:#f5f5f5;--quote-bg:#f7f5f0}
nav.toc,pre button,footer{display:none}.layout{display:block;padding:0;max-width:none}main{max-width:none}
body{background:#fff;color:#000;font-size:10.5pt;line-height:1.65}h1{font-size:20pt}h2{font-size:14pt;margin:22px 0 8px;break-after:avoid}h3{font-size:12pt;break-after:avoid}
pre{white-space:pre-wrap;word-break:break-all;break-inside:avoid}pre code{white-space:pre-wrap;font-size:9pt}
.table{overflow:visible;border:0}table{font-size:9pt}th{white-space:normal}tr{break-inside:avoid}blockquote{break-inside:avoid}
a{color:inherit;text-decoration:underline}}
`;

const SCRIPT = `
document.querySelectorAll("table").forEach(t=>{const w=document.createElement("div");w.className="table";t.replaceWith(w);w.appendChild(t)});
document.querySelectorAll("pre").forEach(p=>{const b=document.createElement("button");b.type="button";b.textContent="複製";b.onclick=()=>{const t=p.querySelector("code").innerText;const done=()=>{b.textContent="已複製";setTimeout(()=>b.textContent="複製",1500)};if(navigator.clipboard)navigator.clipboard.writeText(t).then(done,()=>{});else{const a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove();done()}};p.appendChild(b)});
const links=[...document.querySelectorAll("nav.toc a")];
if(links.length&&"IntersectionObserver"in window){const io=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){links.forEach(a=>a.classList.toggle("on",a.getAttribute("href")==="#"+e.target.id))}})},{rootMargin:"0px 0px -70% 0px"});document.querySelectorAll("main h2[id]").forEach(h=>io.observe(h))}
`;

mkdirSync(outDir, { recursive: true });
for (const file of files) {
  const markdown = readFileSync(file, "utf8");
  const { body, toc } = render(markdown);
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? basename(file, ".md")).replace(/[`*]/g, "");
  const nav = toc.length
    ? `<nav class="toc"><b>目錄</b>${toc.map((item) => `<a href="#${item.id}">${item.html.replace(/<[^>]+>/g, "")}</a>`).join("")}</nav>`
    : "";
  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="layout">
${nav}
<main>
${body}
<footer>由 ${escapeHtml(basename(file))} 轉出</footer>
</main>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`;
  const out = join(outDir, basename(file).replace(/\.md$/, ".html"));
  writeFileSync(out, html);
  console.log(`✅ ${out}`);
  if (wantPdf) {
    const pdf = out.replace(/.html$/, ".pdf");
    printPdf(out, pdf);
    console.log(`✅ ${pdf}`);
  }
}
