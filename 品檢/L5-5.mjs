// L5-5 一寫一審的工程自檢（Q5-5-01～Q5-5-04）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-5）。
// 用假 Telegram／假 Gemini 啟動副本；審核標準用 審核範本/報價回覆.json，假審核者照文件內容回答是／否與引用。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");
const SOURCE = "2026-10-08 與 B 公司林副理電話：CV-30 報價 NT$1,260,000 未稅，林副理希望降到 1,200,000；我方回覆需老闆核價。交機時間客戶希望 12 月中，我方說訂單確認後 45 個工作天。客戶下週三（10/15）前回覆是否下單。";

function prepare(dir) {
  mkdirSync(join(dir, "審核"), { recursive: true });
  copyFileSync(join(dir, "審核範本", "報價回覆.json"), join(dir, "審核", "報價回覆.json"));
  mkdirSync(join(dir, "文件"), { recursive: true });
  writeFileSync(join(dir, "文件", "原文.md"), SOURCE);
  writeFileSync(join(dir, "文件", "摘要.md"), "B 公司林副理：CV-30 報價 NT$1,200,000（未稅），需老闆核價；交期為訂單確認後 45 個工作天；客戶 10/15 前回覆是否下單。");
  mkdirSync(join(dir, "角色", "業務", "資料"), { recursive: true });
  writeFileSync(join(dir, "角色", "業務", "角色.json"), JSON.stringify({ 負責: "客戶、報價", 外掛: [], 分派規則: ["客戶、報價的問題"] }));
  writeFileSync(join(dir, "角色", "業務", "資料", "通話.md"), SOURCE);
}

const lines = (t, out, prefix) => t.scriptLines(out).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
const start = (t, fake, setup = prepare) => t.startBridge({ module: t.module, fake, env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare: setup });

export const checks = [
  {
    id: "Q5-5-01",
    name: "review：獨立審核者逐項回答；程式檢查引用真的在原文（引用不到算「沒附原文證據」）；結果由程式判斷、附 🔎、寫審核紀錄",
    async run(t) {
      const { out } = await start(t, "review");
      const result = lines(t, out, "審核結果")[0] ?? "";
      const reply = lines(t, out, "送出").find((line) => line.includes("摘要")) ?? "";
      const records = lines(t, out, "紀錄");
      const problems = [
        !result.includes("審核 #1（標準：報價回覆）：不通過") && `審核結果要由程式判斷不通過：${result || tail(out)}`,
        !result.includes("❌ 1. 摘要裡的每個金額都跟原文一致：不通過") && "金額那項要是不通過",
        !result.includes("⚠️ 4. 客戶與窗口正確：沒附原文證據") && "引用不在原文的那項要算「沒附原文證據」",
        !result.includes("✅ 2. 沒有漏掉交期：通過") && "有正確引用的「是」要算通過",
        !reply.includes("🔎 審核 #1（報價回覆）：不通過（5 項中 2 項沒過）") && `回覆最後要附 🔎：${reply || tail(out)}`,
        !records.some((line) => line.includes('"種類":"審核"') && line.includes('"通過":false')) && `要寫審核紀錄：${records.join(" / ")}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply.slice(-80)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-5-02",
    name: "review 照秘書的讀取權限：原文在助理的資料夾 → 讀不到、不審",
    async run(t) {
      const { out } = await start(t, "forbidden");
      const result = lines(t, out, "審核結果")[0] ?? "";
      const problems = [
        !result.includes("沒有權限讀 角色/業務/資料/通話.md") && `秘書讀不到的原文不應該拿去審：${result || tail(out)}`,
        out.includes("[0s] 審核者被叫到") && "權限擋下時不應該叫審核者",
      ].filter(Boolean);
      return problems.length === 0 ? pass(result.slice(0, 160)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-5-03",
    name: "/考審核：用考題測審核者，算抓錯率（放錯 3 份抓到 3、正確 2 份誤判 0），寫紀錄",
    async run(t) {
      const { out } = await start(t, "exam");
      const reply = lines(t, out, "送出").find((line) => line.includes("考審核")) ?? "";
      const problems = [
        !reply.includes("故意放錯的 3 份抓到 3 份；正確的 2 份誤判 0 份") && `抓錯率算錯：${reply || tail(out)}`,
        !reply.includes("2. ✅ 抓到了（金額錯）") && "要逐題列出結果",
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply.slice(0, 200)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-5-05",
    name: "審核者沒有回應（額度、網路）：算「沒審成」，不算不通過，也不算進抓錯率",
    async run(t) {
      const { out } = await start(t, "silent");
      const reply = lines(t, out, "送出").find((line) => line.includes("考審核")) ?? "";
      const problems = [
        !reply.includes("2 份沒審成（不算進去）") && `沒審成的要另外算：${reply || tail(out)}`,
        !reply.includes("1. ⏭️ 沒審成") && "要逐題標出沒審成",
        !reply.includes("正確的 1 份誤判 0 份") && `沒審成的不能算成誤判：${reply}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply.slice(0, 160)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-5-04",
    name: "沒有 審核/ 時：秘書沒有 review 工具；/考審核 說還沒有標準",
    async run(t) {
      const { out } = await start(t, "none", null);
      const tools = lines(t, out, "秘書工具")[0] ?? "";
      const reply = lines(t, out, "送出").find((line) => line.includes("審核")) ?? "";
      const problems = [
        !tools && `秘書沒被呼叫：\n${tail(out)}`,
        tools.includes("review") && "沒有 審核/ 時不應該有 review",
        !reply.includes("還沒有任何審核標準") && `/考審核 要說還沒有標準：${reply || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply) : fail(problems.join("\n"));
    },
  },
];

// ── 假 Telegram＋假 Gemini ─────────────────────────────────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (part) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const call = (name, args) => sse({ functionCall: { name, args } });
const text = (value) => sse({ text: value });
const flat = (value) => String(value).replace(/\n/g, " ⏎ ");
function parse(options) {
  const body = JSON.parse(options.body);
  const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
  const last = body.contents?.at(-1);
  const lastText = (last?.parts ?? []).map((part) => part.text ?? (part.functionResponse ? JSON.stringify(part.functionResponse.response) : "")).join("");
  const tools = (body.tools ?? []).flatMap((tool) => (tool.functionDeclarations ?? []).map((item) => item.name));
  return { system, lastText, tools, isResult: (last?.parts ?? []).some((part) => part.functionResponse), reviewer: system.startsWith("你是審核者") };
}
/** 假審核者：照「要審的文件」內容判斷；第 4 項故意引用一段原文沒有的字。 */
function reviewer(prompt, fakeQuote) {
  const doc = prompt.split("<<<文件開始>>>")[1]?.split("<<<文件結束>>>")[0] ?? "";
  const quote = "CV-30 報價 NT$1,260,000 未稅";
  return JSON.stringify([
    { 項目: 1, 答案: doc.includes("NT$1,200,000") ? "否" : "是", 原文引用: quote },
    { 項目: 2, 答案: doc.includes("45 個工作天") ? "是" : "否", 原文引用: "我方說訂單確認後 45 個工作天" },
    { 項目: 3, 答案: doc.includes("我方同意") ? "否" : "是", 原文引用: "我方回覆需老闆核價" },
    { 項目: 4, 答案: "是", 原文引用: fakeQuote ? "B 公司王經理來電" : "與 B 公司林副理電話" },
    { 項目: 5, 答案: "是", 原文引用: "客戶下週三（10/15）前回覆是否下單" },
  ]);
}
function telegram(target, options, state, onSend) {
  const body = JSON.parse(options.body ?? "{}");
  if (target.endsWith("/sendMessage")) {
    console.log(`[0s] 送出 ${flat(body.text)}`);
    onSend?.(body.text);
    return ok({ message_id: 1 });
  }
  if (target.endsWith("/sendChatAction") || target.endsWith("/editMessageText") || target.endsWith("/answerCallbackQuery")) return ok(true);
  return new Promise((resolve) => setTimeout(resolve, 200)).then(() => {
    const next = state.queue.shift();
    return next ? ok([{ update_id: ++state.id, message: { text: next, from: { id: 7 }, chat: { id: 7 } } }]) : ok([]);
  });
}
const finish = (records = false) => setTimeout(() => {
  if (records) {
    try {
      for (const line of readFileSync("data/審核紀錄.jsonl", "utf8").trim().split("\n")) console.log(`[0s] 紀錄 ${line}`);
    } catch {}
  }
  console.log("[0s] 品檢結束");
  process.exit(0);
}, 300);

export const fakes = {
  /** 「幫我審這份摘要」→ 秘書 review → 假審核者（金額錯、第 4 項假引用）→ 秘書轉告。 */
  async review() {
    const state = { queue: [null, "幫我審一下 文件/摘要.md，原文是 文件/原文.md"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.reviewer) return text(reviewer(req.lastText, true));
        if (!req.isResult) return call("review", { 標準: "報價回覆", 文件: "文件/摘要.md", 原文: "文件/原文.md" });
        console.log(`[0s] 審核結果 ${flat(req.lastText)}`);
        return text("這份摘要沒通過審核：金額跟原文不一致。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("摘要沒通過")) finish(true); });
    };
  },

  /** 秘書拿助理資料夾裡的檔案當原文 → 讀不到。 */
  async forbidden() {
    const state = { queue: [null, "幫我審一下 文件/摘要.md"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.reviewer) { console.log("[0s] 審核者被叫到"); return text("[]"); }
        if (!req.isResult) return call("review", { 標準: "報價回覆", 文件: "文件/摘要.md", 原文: "角色/業務/資料/通話.md" });
        console.log(`[0s] 審核結果 ${flat(req.lastText)}`);
        return text("那份原文我讀不到。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("讀不到")) finish(); });
    };
  },

  /** /考審核 報價回覆：5 份考題（3 份放錯、2 份正確）。 */
  async exam() {
    const state = { queue: [null, "/考審核 報價回覆"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.reviewer) return text(reviewer(req.lastText, false));
        return text("好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("考審核")) finish(); });
    };
  },

  /** /考審核：審核者前兩份沒有回應（空白），後三份正常 → 沒審成的不算進抓錯率。 */
  async silent() {
    const state = { queue: [null, "/考審核 報價回覆"], id: 0 };
    let count = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.reviewer) return text(++count <= 2 ? "" : reviewer(req.lastText, false));
        return text("好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("考審核")) finish(); });
    };
  },

  /** 沒有 審核/：看秘書的工具、/考審核 的回答。 */
  async none() {
    const state = { queue: [null, "你好", "/考審核 報價回覆"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        console.log(`[0s] 秘書工具 ${parse(options).tools.join(",")}`);
        return text("你好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("審核")) finish(); });
    };
  },
};
