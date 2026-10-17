// L5-1 什麼時候需要第二位：拆分量測的工程自檢（Q5-1-01～Q5-1-04）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-1）。
// 量測工具用假 Gemini 跑（假劇本：研發的規則在「① 全部擠在一起」時會搞混、拆開就對），看報告與結論對不對。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");
const leftovers = () => readdirSync(tmpdir()).filter((name) => name.startsWith("拆分量測-"));

/** 在副本裡跑量測工具；fake = 這個檔案 fakes 裡的劇本名稱。 */
async function measure(t, { fake, args = ["2", "--yes", "--rpm=600"], prepare } = {}) {
  const dir = t.makeCopy();
  try {
    if (prepare) prepare(dir);
    const command = ["--import", pathToFileURL(join(dir, "_量測假劇本.mjs")).href, join(dir, "tools", "拆分量測.mjs"), ...args];
    writeFileSync(join(dir, "_量測假劇本.mjs"), `import { fakes } from ${JSON.stringify(pathToFileURL(join(dir, "品檢", t.module)).href)};\nawait fakes[${JSON.stringify(fake)}]();\n`);
    const result = await t.run(process.execPath, command, { cwd: dir, env: t.fakeEnv(), timeoutMs: 240_000 });
    const reportDir = join(dir, "文件", "拆分量測");
    const reports = existsSync(reportDir) ? readdirSync(reportDir).filter((name) => name.endsWith(".md")) : [];
    const report = reports.length > 0 ? readFileSync(join(reportDir, reports[0]), "utf8") : "";
    return { ...result, report };
  } finally {
    t.removeCopy(dir);
  }
}

let full;
const fullOnce = (t) => (full ??= (async () => {
  const before = new Set(leftovers());
  const result = await measure(t, { fake: "exam" });
  return { ...result, newLeftovers: leftovers().filter((name) => !before.has(name)) };
})());

export const checks = [
  {
    id: "Q5-1-01",
    name: "拆分量測：兩組都考完、報告寫進 文件/拆分量測/；結論由程式判斷（研發拆了變好 → 建議拆；業務差不多 → 還不用拆）；工具沒有真的執行；暫存副本刪掉",
    async run(t) {
      const { out, report, newLeftovers } = await fullOnce(t);
      const problems = [
        !out.includes("預估") && `開跑前沒有印出預估請求數：\n${tail(out)}`,
        !report && `沒有寫出報告：\n${tail(out)}`,
        !report.includes("**建議拆出「研發」**") && `研發拆了變好（規則 0% → 100%），結論要建議拆：\n${report.slice(0, 600)}`,
        !report.includes("**「業務」還不用拆**") && "業務兩組一樣，結論要寫還不用拆",
        !report.includes("| 工具數 |") && "報告要有工具數",
        !report.includes("每則訊息的輸入 token") && "報告要有輸入 token",
        !report.includes("量出來不用拆很正常") && "報告要寫「量出來不用拆很正常」",
        /品檢：不應該連到/.test(out) && `工具被真的執行了（連到 Gemini 以外的網址）：\n${tail(out)}`,
        newLeftovers.length > 0 && `暫存副本沒刪掉：${newLeftovers.join("、")}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(report.split("\n").filter((line) => line.startsWith("- **")).join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-1-02",
    name: "考試時秘書讀不到題庫（副本裡沒有 量測題庫.json）；① 的工具比 ② 業務多",
    async run(t) {
      const { out, report } = await fullOnce(t);
      const peek = out.split("\n").find((line) => line.includes("[偷看題庫]")) ?? "";
      const row = report.split("\n").find((line) => line.startsWith("| 工具數 |")) ?? "";
      const [, all, sales] = row.match(/\| 工具數 \| (\d+) \| 業務 (\d+)/) ?? [];
      const problems = [
        !peek && `劇本沒有試著讀題庫：\n${tail(out)}`,
        peek && !/not found|ENOENT|找不到|does not exist|No such file/i.test(peek) && `秘書讀得到題庫：${peek}`,
        !(Number(all) > Number(sales)) && `① 的工具應該比 ② 業務多：${row}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${peek.slice(0, 120)}\n${row}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-1-03",
    name: "沒按 Enter 不開跑（印出預估、取消、一次請求都沒送）；題庫寫錯先列出問題",
    async run(t) {
      const cancelled = await measure(t, { fake: "count", args: ["2"] });
      const broken = await measure(t, {
        fake: "count", args: ["--yes"],
        prepare(dir) {
          writeFileSync(join(dir, "量測題庫.json"), JSON.stringify({ 部門: { 業務: { 外掛: ["Gmail"] } }, 題目: [{ 部門: "倉管", 問題: "庫存多少" }] }));
        },
      });
      const problems = [
        !cancelled.out.includes("預估") && `沒印預估：\n${tail(cancelled.out)}`,
        !cancelled.out.includes("已取消，沒有花任何額度") && `沒按 Enter 應該取消：\n${tail(cancelled.out)}`,
        cancelled.out.includes("[Gemini 請求]") && "取消了還送出請求",
        !broken.out.includes("部門「倉管」不在「部門」裡") && `題庫的部門寫錯要說：\n${tail(broken.out)}`,
        !broken.out.includes("要寫「該用的工具」或「必含／不可含」") && "題目沒寫答案要說",
        broken.out.includes("[Gemini 請求]") && "題庫有錯還送出請求",
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${tail(cancelled.out, 2)}\n${tail(broken.out, 3)}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-1-04",
    name: "/status 列出工具數；超過 20 個時提示可以用拆分量測",
    async run(t) {
      const { out } = await t.startBridge({ module: t.module, fake: "status", env: { TELEGRAM_ALLOWED_USERS: "7", SERPAPI_KEY: "fake" }, timeoutMs: 60_000 });
      const text = out.split("\n").find((line) => line.includes("[狀態]")) ?? "";
      const count = Number(text.match(/工具數：共 (\d+) 個/)?.[1] ?? 0);
      const problems = [
        !count && `/status 沒有工具數：${text.slice(0, 300) || tail(out)}`,
        count > 20 && !text.includes("tools/拆分量測.mjs") && "超過 20 個要提示拆分量測",
        count <= 20 && text.includes("tools/拆分量測.mjs") && "沒超過 20 個不用提示",
      ].filter(Boolean);
      return problems.length === 0 ? pass(text.match(/工具數：[^⏎]*/)?.[0] ?? text.slice(0, 160)) : fail(problems.join("\n"));
    },
  },
];

// ── 假 Gemini（量測工具）＋ 假 Telegram（/status）────────────────────────
const sse = (part) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const flat = (value) => String(value).replace(/\n/g, " ⏎ ");
// 示範題庫的工具題 → 假 Gemini 選的工具（兩組都選對：業務、秘書都不該建議拆）
const PICK = [
  ["王經理上週", "gmail_search"], ["寄來的信都要", "add_mail_rule"], ["重要的新信", "important_mail"], ["林副理", "gmail_draft"],
  ["明天下午", "calendar_events"], ["行事曆加一個", "calendar_create"], ["提醒我交週報", "add_reminder"], ["固定會議", "add_fixed_meeting"],
];

export const fakes = {
  /** 量測：第一次先試著讀題庫；工具題照 PICK 選；規則題：研發在 ① 搞混（寫出參數）、② 照規則。 */
  async exam() {
    let peeked = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (!target.includes("generativelanguage.googleapis.com")) throw new TypeError(`品檢：不應該連到 ${target}`);
      const body = JSON.parse(options.body);
      const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
      const question = (body.contents ?? []).filter((item) => item.role === "user").map((item) => (item.parts ?? []).map((part) => part.text ?? "").join("")).join("\n");
      const last = body.contents.at(-1);
      const result = (last.parts ?? []).find((part) => part.functionResponse);
      if (!peeked) {
        peeked = true;
        return sse({ functionCall: { name: "read", args: { path: "量測題庫.json" } } });
      }
      if (result && result.functionResponse.name === "read") {
        console.log(`[偷看題庫] ${flat(JSON.stringify(result.functionResponse.response)).slice(0, 200)}`);
      }
      const pick = PICK.find(([word]) => question.includes(word));
      if (pick && (!result || result.functionResponse.name === "read")) return sse({ functionCall: { name: pick[1], args: {} } });
      if (pick) return sse({ text: "好" });
      const together = system.includes("【業務】") && system.includes("【研發】"); // ① 全部規則擠在一起
      if (question.includes("RA-200 一台 485000")) return sse({ text: "王經理您好，RA-200 報價 NT$485,000（未稅），交期為訂單確認後 45 個工作天。" });
      if (question.includes("1260000")) return sse({ text: "CV-30 一台報價 NT$1,260,000（未稅）。" });
      if (question.includes("最高輸送速度")) return sse({ text: together ? "CV-30 的最高輸送速度是每分鐘 36 公尺。" : "詳細參數待研發確認後提供。" });
      if (question.includes("重複定位精度")) return sse({ text: together ? "RA-200 的重複定位精度是 ±0.02 mm。" : "詳細參數待研發確認後提供。" });
      return sse({ text: "好" });
    };
  },

  /** 只記錄有沒有送出請求（取消、題庫寫錯時應該一次都沒有）。 */
  async count() {
    globalThis.fetch = async (url) => {
      console.log("[Gemini 請求]");
      throw new TypeError(`品檢：不應該連到 ${url}`);
    };
  },

  /** 秘書啟動後傳 /status。 */
  async status() {
    let step = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) return sse({ text: "好" });
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      const body = JSON.parse(options.body ?? "{}");
      if (target.endsWith("/sendMessage")) {
        if (String(body.text).includes("秘書狀態")) {
          console.log(`[狀態] ${flat(body.text)}`);
          setTimeout(() => process.exit(0), 200);
        }
        return ok({ message_id: 1 });
      }
      if (target.endsWith("/sendChatAction")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 200));
      step++;
      return step === 2 ? ok([{ update_id: 1, message: { text: "/status", from: { id: 7 }, chat: { id: 7 } } }]) : ok([]);
    };
  },
};
