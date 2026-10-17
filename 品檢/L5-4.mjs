// L5-4 交辦與回報的工程自檢（Q5-4-01～Q5-4-04）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-4）。
// 用假 Telegram／假 Gemini 啟動副本；副本裡建業務助理（有分派規則），假 Gemini 從 system prompt 分辨是秘書還是助理。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

function team(dir) {
  mkdirSync(join(dir, "角色", "業務", "資料"), { recursive: true });
  writeFileSync(join(dir, "角色", "業務", "角色.json"), JSON.stringify({ 負責: "客戶、報價、訂單", 外掛: ["Office", "傳檔案"], 分派規則: ["客戶、報價、訂單、付款條件的問題"] }));
  writeFileSync(join(dir, "角色", "業務", "資料", "報價紀錄.md"), "| 日期 | 客戶 | 品項 | 單價（未稅） |\n|---|---|---|---|\n| 2026-08-12 | A 公司 | RA-200 | 485000 |\n");
}

const lines = (t, out, prefix) => t.scriptLines(out).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
const start = (t, fake, prepare = team) => t.startBridge({ module: t.module, fake, env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare });

export const checks = [
  {
    id: "Q5-4-01",
    name: "交辦與回報：交辦單有編號、要回報、老闆原話；回報格式不對退回一次；【依據】由程式填；回覆附 📨 #編號；交辦紀錄由程式寫",
    async run(t) {
      const { out } = await start(t, "flow");
      const sheet = lines(t, out, "交辦單")[0] ?? "";
      const back = lines(t, out, "回給秘書")[0] ?? "";
      const reply = lines(t, out, "送出").find((line) => line.includes("A 公司上次")) ?? "";
      const records = lines(t, out, "紀錄").map((line) => JSON.parse(line));
      const problems = [
        !sheet.includes("【交辦單 #1】交辦者：秘書｜依據：業務-1") && `交辦單要有編號：${sheet || tail(out)}`,
        !sheet.includes("要回報：金額與日期") && "交辦單要寫要回報什麼",
        !sheet.includes("老闆這則訊息的原話") && !sheet.includes("A 公司上次報價多少") && "交辦單要附老闆原話",
        !sheet.includes("【結果】") && "交辦單要寫回報格式",
        !out.includes("退回格式") && "回報格式不對要退回一次",
        !back.includes("【結果】") && `退回後的回報沒交給秘書：${back}`,
        !back.includes("【依據】（系統記錄）他查了 read 報價紀錄.md") && `【依據】要由程式寫：${back}`,
        !back.includes("（交辦紀錄 #1）") && "回報要附交辦紀錄編號",
        !reply.includes("📨 交辦 #1：業務助理（業務-1），已回報；他查了 read 報價紀錄.md") && `回覆最後要附 📨 #1：${reply || tail(out)}`,
        !(records[0]?.事件 === "開始" && records[0]?.編號 === 1 && records[0]?.要回報 === "金額與日期" && records[0]?.來源 === "使用者") && `交辦紀錄（開始）不對：${JSON.stringify(records[0])}`,
        !(records[1]?.事件 === "結束" && records[1]?.狀態 === "已回報" && records[1]?.格式退回 === true && records[1]?.用了?.includes("read 報價紀錄.md")) && `交辦紀錄（結束）不對：${JSON.stringify(records[1])}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply.slice(0, 200)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-4-02",
    name: "上限：一則訊息第 4 次交辦被擋；一次交辦助理用到第 16 次工具被擋",
    async run(t) {
      const { out } = await start(t, "limits");
      const results = lines(t, out, "工具結果");
      const fourth = results.find((line) => line.includes("已經交辦 3 次")) ?? "";
      const tool = lines(t, out, "助理工具上限")[0] ?? "";
      const problems = [
        !fourth && `第 4 次交辦要被擋：${results.join(" / ").slice(0, 400) || tail(out)}`,
        !tool.includes("到上限了") && `第 16 次工具要被擋：${tool || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${fourth.slice(0, 120)}\n${tool.slice(0, 120)}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-4-03",
    name: "秘書沒交辦卻說「業務說…」→ 附「（這一輪沒有交辦給任何助理）」；例行工作的回覆提到業務不附",
    async run(t) {
      const { out } = await start(t, "claim", (dir) => {
        team(dir);
        writeFileSync(join(dir, "排程.json"), JSON.stringify({ 例行工作: [{ 名稱: "晨報測試", 時間: "每天 23:59", 要他做的事: "寫晨報" }] }));
      });
      const sent = lines(t, out, "送出");
      const claim = sent.find((line) => line.includes("業務說沒問題")) ?? "";
      const brief = sent.find((line) => line.includes("業務信箱今天沒有新信")) ?? "";
      const intro = sent.find((line) => line.includes("你的團隊有業務助理")) ?? "";
      if (intro.includes("（這一輪沒有交辦給任何助理）")) return fail(`只是介紹團隊、沒有聲稱業務說了什麼，不應該附：${intro}`);
      const problems = [
        !claim.includes("（這一輪沒有交辦給任何助理）") && `沒交辦卻說業務說，要附一句：${claim || tail(out)}`,
        !brief && `例行工作沒有回覆：\n${tail(out)}`,
        brief.includes("（這一輪沒有交辦給任何助理）") && "例行工作（晨報）不應該附這句",
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${claim}\n${brief.slice(0, 120)}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-4-04",
    name: "交辦紀錄在 data/（秘書、助理都讀不到）；/status 列出今天交辦幾次",
    async run(t) {
      const { out } = await start(t, "status");
      const status = lines(t, out, "送出").find((line) => line.includes("秘書狀態")) ?? "";
      const read = lines(t, out, "工具結果")[0] ?? "";
      const problems = [
        !read.includes("沒有權限讀 data/交辦紀錄.jsonl") && `秘書不應該讀得到交辦紀錄：${read || tail(out)}`,
        !status.includes("今天交辦 1 次") && `/status 要列出今天交辦幾次：${status.slice(0, 400) || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(status.match(/👤[^⏎]*/)?.[0] ?? "") : fail(problems.join("\n"));
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
const REPORT = "【結果】\nA 公司 2026-08-12 報價 RA-200 485,000（未稅）\n【沒做到的】\n（無）\n【要老闆確認的】\n（無）";
function parse(options) {
  const body = JSON.parse(options.body);
  const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
  const who = system.includes("你是團隊裡的業務助理") ? "業務" : "秘書";
  const last = body.contents?.at(-1);
  const lastText = (last?.parts ?? []).map((part) => part.text ?? (part.functionResponse ? JSON.stringify(part.functionResponse.response) : "")).join("");
  const allText = (body.contents ?? []).map((item) => (item.parts ?? []).map((part) => part.text ?? "").join("")).join("\n");
  return { who, system, lastText, allText, isResult: (last?.parts ?? []).some((part) => part.functionResponse) };
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
      for (const line of readFileSync("data/交辦紀錄.jsonl", "utf8").trim().split("\n")) console.log(`[0s] 紀錄 ${line}`);
    } catch {}
  }
  console.log("[0s] 品檢結束");
  process.exit(0);
}, 300);

export const fakes = {
  /** 交辦 → 業務 read → 第一次回報沒照格式 → 退回 → 照格式 → 秘書回覆。 */
  async flow() {
    const state = { queue: [null, "A 公司上次報價多少？"], id: 0 };
    let salesStep = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") {
          if (!req.isResult) return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: "查 A 公司上次報價", 要回報: "金額與日期" });
          console.log(`[0s] 回給秘書 ${flat(req.lastText)}`);
          return text("A 公司上次（8/12）報價 485,000 元（未稅）。");
        }
        salesStep++;
        if (salesStep === 1) {
          console.log(`[0s] 交辦單 ${flat(req.lastText).replace(/^【現在時間：[^】]*】 ⏎ /, "")}`);
          return call("read", { path: "角色/業務/資料/報價紀錄.md" });
        }
        if (salesStep === 2) return text("A 公司報價 485000");
        console.log(`[0s] 退回格式 ${flat(req.lastText).slice(0, 40)}`);
        return text(REPORT);
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("A 公司上次")) finish(true); });
    };
  },

  /** 秘書一則訊息交辦 4 次（第 4 次被擋）；第一次交辦時業務連用 16 次 read（第 16 次被擋）。 */
  async limits() {
    const state = { queue: [null, "A 公司上次報價多少？"], id: 0 };
    let genCalls = 0, salesCalls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") {
          if (req.isResult) console.log(`[0s] 工具結果 ${flat(req.lastText).slice(0, 200)}`);
          genCalls++;
          if (genCalls <= 4) return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: `第 ${genCalls} 次`, 要回報: "結果" });
          return text("交辦完了。");
        }
        if (req.isResult && req.lastText.includes("到上限了")) {
          console.log(`[0s] 助理工具上限 ${flat(req.lastText).slice(0, 160)}`);
          return text(REPORT);
        }
        salesCalls++;
        if (salesCalls <= 16 && !req.allText.includes("第 2 次") && !req.allText.includes("第 3 次")) return call("read", { path: "角色/業務/資料/報價紀錄.md" });
        return text(REPORT);
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("交辦完了")) finish(); });
    };
  },

  /** 秘書沒交辦就說「業務說沒問題」；接著 /run 晨報測試，晨報提到業務信箱。 */
  async claim() {
    const state = { queue: [null, "那件事可以嗎？", "團隊有誰？", "/run 晨報測試"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.allText.includes("【例行工作：晨報測試】")) return text("☀️ 早安！業務信箱今天沒有新信。");
        if (req.lastText.includes("團隊有誰")) return text("你的團隊有業務助理（負責客戶、報價）。");
        return text("業務說沒問題。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("業務信箱今天沒有新信")) finish(); });
    };
  },

  /** 交辦一次 → 秘書試著讀交辦紀錄 → /status。 */
  async status() {
    const state = { queue: [null, "A 公司上次報價多少？"], id: 0 };
    let genStep = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "業務") return text(REPORT);
        genStep++;
        if (genStep === 1) return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: "查 A 公司報價", 要回報: "金額" });
        if (genStep === 2) return call("read", { path: "data/交辦紀錄.jsonl" });
        console.log(`[0s] 工具結果 ${flat(req.lastText)}`);
        return text("查好了。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => {
        if (sent.includes("查好了")) state.queue.push("/status");
        if (sent.includes("秘書狀態")) finish();
      });
    };
  },
};
