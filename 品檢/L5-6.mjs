// L5-6 議會的工程自檢（Q5-6-01～Q5-6-03）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-6）。
// 用假 Telegram／假 Gemini 啟動副本；副本裡建業務、廠務兩位助理，假 Gemini 從 system prompt 分辨是誰。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

function team(dir, withFactory = true) {
  const role = (name, config) => {
    mkdirSync(join(dir, "角色", name, "資料"), { recursive: true });
    writeFileSync(join(dir, "角色", name, "角色.json"), JSON.stringify(config));
  };
  role("業務", { 負責: "客戶、報價", 外掛: [], 分派規則: ["客戶、報價、客訴的回覆"] });
  if (withFactory) role("廠務", { 負責: "生產、品質", 外掛: [], 分派規則: ["生產排程、品質異常"] });
}

const lines = (t, out, prefix) => t.scriptLines(out).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
const start = (t, fake, prepare = team) => t.startBridge({ module: t.module, fake, env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare });

export const checks = [
  {
    id: "Q5-6-01",
    name: "議會：兩位助理依序表態（固定四個標題，格式不對退回一次）；第 2 輪看得到別人的意見；秘書整理；回覆附 🏛；寫紀錄",
    async run(t) {
      const { out } = await start(t, "council");
      const round2 = lines(t, out, "第2輪");
      const back = lines(t, out, "回給秘書")[0] ?? "";
      const reply = lines(t, out, "送出").find((line) => line.includes("【共識】")) ?? "";
      const records = lines(t, out, "紀錄").map((line) => JSON.parse(line));
      const problems = [
        !out.includes("退回格式") && "表態格式不對要退回一次",
        !round2.some((line) => line.startsWith("業務") && line.includes("〔廠務助理〕")) && `第 2 輪業務要看得到廠務的表態：${round2.join(" / ").slice(0, 300) || tail(out)}`,
        !round2.some((line) => line.startsWith("廠務") && line.includes("〔業務助理〕")) && "第 2 輪廠務要看得到業務的表態",
        !back.includes("〔業務助理〕") || !back.includes("〔廠務助理〕") ? `兩位的表態都要交回秘書：${back.slice(0, 300)}` : "",
        !back.includes("【共識】【分歧】【風險】【建議】") && "要請秘書照四段整理",
        !reply.includes("🏛 議會 #1：業務、廠務助理表態（2 輪），已表態") && `回覆最後要附 🏛：${reply || tail(out)}`,
        !(records[0]?.種類 === "議會" && records[0]?.事件 === "開始" && records[1]?.狀態 === "已表態") && `議會紀錄不對：${JSON.stringify(records)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply.slice(-60)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-6-02",
    name: "議會的限制：至少兩位助理；一則訊息只開一次",
    async run(t) {
      const { out } = await start(t, "limits");
      const results = lines(t, out, "工具結果");
      const problems = [
        !results.some((line) => line.includes("議會至少要兩位助理")) && `只找一位要被擋：${results.join(" / ").slice(0, 300) || tail(out)}`,
        !results.some((line) => line.includes("已經開過一次議會")) && "同一則訊息第二次開議會要被擋",
      ].filter(Boolean);
      return problems.length === 0 ? pass(results.map((line) => line.slice(0, 80)).join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-6-04",
    name: "Gemini 每分鐘上限（429）：程式照 Google 說的秒數等一下再試，不直接回「額度到了」",
    async run(t) {
      const { out } = await start(t, "ratelimit");
      const reply = lines(t, out, "送出").find((line) => line.includes("你好")) ?? "";
      const problems = [
        !out.includes("Gemini 每分鐘的請求上限到了，等 2 秒再試") && `要等一下再試：\n${tail(out)}`,
        !reply.includes("你好，等一下就好了") && `重試後要正常回覆：${reply || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-6-03",
    name: "只有一位有分派規則的助理時，秘書沒有 council 工具",
    async run(t) {
      const { out } = await start(t, "tools", (dir) => team(dir, false));
      const tools = lines(t, out, "秘書工具")[0] ?? "";
      const problems = [
        !tools.includes("delegate") && `秘書要有 delegate：${tools || tail(out)}`,
        tools.includes("council") && "只有一位助理時不應該有 council",
      ].filter(Boolean);
      return problems.length === 0 ? pass(tools.slice(0, 120)) : fail(problems.join("\n"));
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
const stance = (who, keep = "") => `【立場】${keep}${who === "業務" ? "先安撫客戶、派人到場" : "先查這批的最高輸送速度紀錄"}\n【理由】客訴要快\n【風險】客戶流失\n【需要的資料】出貨批號`;
function parse(options) {
  const body = JSON.parse(options.body);
  const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
  const who = system.includes("你是團隊裡的業務助理") ? "業務" : system.includes("你是團隊裡的廠務助理") ? "廠務" : "秘書";
  const last = body.contents?.at(-1);
  const lastText = (last?.parts ?? []).map((part) => part.text ?? (part.functionResponse ? JSON.stringify(part.functionResponse.response) : "")).join("");
  const tools = (body.tools ?? []).flatMap((tool) => (tool.functionDeclarations ?? []).map((item) => item.name));
  return { who, lastText, tools, isResult: (last?.parts ?? []).some((part) => part.functionResponse) };
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
  /** 客訴 → 秘書開議會（業務、廠務，2 輪）→ 業務第一次沒照格式 → 退回 → 第 2 輪兩位都維持 → 秘書整理。 */
  async council() {
    const state = { queue: [null, "客訴：A 公司說機械手臂夾取失誤，大家看怎麼處理"], id: 0 };
    let salesFirst = true;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") {
          if (!req.isResult) return call("council", { 議題: "A 公司反映機械手臂夾取失誤，怎麼處理", 助理: ["業務", "廠務"], 輪數: 2 });
          console.log(`[0s] 回給秘書 ${flat(req.lastText)}`);
          return text("【共識】先派人到場\n【分歧】無\n【風險】客戶流失\n【建議】今天派人");
        }
        if (req.lastText.includes("第 2 輪")) {
          console.log(`[0s] 第2輪 ${req.who} ${flat(req.lastText).slice(0, 400)}`);
          return text(stance(req.who, "維持："));
        }
        if (req.lastText.includes("格式不對")) { console.log("[0s] 退回格式"); return text(stance(req.who)); }
        if (req.who === "業務" && salesFirst) { salesFirst = false; return text("我覺得先安撫客戶。"); }
        return text(stance(req.who));
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("【共識】")) finish(true); });
    };
  },

  /** 只找一位 → 被擋；兩位 → 成功；再開一次 → 被擋。 */
  async limits() {
    const state = { queue: [null, "大家討論一下漏封的事"], id: 0 };
    let step = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who !== "秘書") return text(stance(req.who));
        if (req.isResult) console.log(`[0s] 工具結果 ${flat(req.lastText).slice(0, 200)}`);
        step++;
        if (step === 1) return call("council", { 議題: "漏封", 助理: ["業務"] });
        if (step === 2) return call("council", { 議題: "漏封", 助理: ["業務", "廠務"] });
        if (step === 3) return call("council", { 議題: "漏封再一次", 助理: ["業務", "廠務"] });
        return text("討論完了。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("討論完了")) finish(); });
    };
  },

  /** Gemini 第一次回 429（每分鐘上限、等 1 秒）→ 程式等一下再試 → 成功。 */
  async ratelimit() {
    const state = { queue: [null, "你好"], id: 0 };
    let calls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        calls++;
        console.log(`[0s] Gemini 第 ${calls} 次`);
        if (calls === 1) {
          return new Response(JSON.stringify({ error: { code: 429, message: "You exceeded your current quota", details: [
            { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
            { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" },
          ] } }), { status: 429, headers: { "Content-Type": "application/json" } });
        }
        return text("你好，等一下就好了。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("你好")) finish(); });
    };
  },

  /** 看秘書的工具。 */
  async tools() {
    const state = { queue: [null, "你好"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        console.log(`[0s] 秘書工具 ${parse(options).tools.join(",")}`);
        return text("你好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("你好")) finish(); });
    };
  },
};
