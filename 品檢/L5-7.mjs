// L5-7 團隊控制與日報的工程自檢（Q5-7-01～Q5-7-03）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-7）。
// 用假 Telegram／假 Gemini 啟動副本。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

function team(dir) {
  mkdirSync(join(dir, "角色", "業務", "資料"), { recursive: true });
  writeFileSync(join(dir, "角色", "業務", "角色.json"), JSON.stringify({ 負責: "客戶、報價", 外掛: [], 分派規則: ["客戶、報價的問題"] }));
}

const lines = (t, out, prefix) => t.scriptLines(out).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
const start = (t, fake, prepare = team) => t.startBridge({ module: t.module, fake, env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare });

export const checks = [
  {
    id: "Q5-7-01",
    name: "/wait：手上這件做完就停，排隊中的等 /go 才做；暫停中傳訊息會說一聲；/status 顯示暫停",
    async run(t) {
      const { out } = await start(t, "wait");
      const order = t.scriptLines(out).filter((line) => /^(送出|秘書收到)/.test(line));
      const index = (needle) => order.findIndex((line) => line.includes(needle));
      const problems = [
        index("⏸ 好") < 0 && `/wait 要回暫停：\n${order.join("\n") || tail(out)}`,
        index("第一則做完") < 0 && "手上那件要做完",
        index("秘書收到 第二則") < index("▶️ 繼續") && `第二則要等 /go 才做：\n${order.join("\n")}`,
        index("現在是暫停中") < 0 && "暫停中傳訊息要說一聲",
        index("已用 /wait 暫停") < 0 && "/status 要顯示暫停",
        index("第二則做完") < 0 && "/go 之後第二則要做完",
      ].filter(Boolean);
      return problems.length === 0 ? pass(order.map((line) => line.slice(0, 40)).join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-7-02",
    name: "/btw：秘書在忙時插問，不排隊先回答；只能用查閱級工具（沒有交辦、寫檔、執行）；不寫進今天的對話",
    async run(t) {
      const { out } = await start(t, "btw");
      const order = t.scriptLines(out).filter((line) => line.startsWith("送出"));
      const quick = order.findIndex((line) => line.includes("💬 插問：下午 3 點"));
      const long = order.findIndex((line) => line.includes("報價整理好了"));
      const tools = lines(t, out, "插問工具")[0] ?? "";
      const problems = [
        quick < 0 && `插問要回答：\n${order.join("\n") || tail(out)}`,
        long >= 0 && quick > long && "插問要在手上的事做完之前就回答",
        !tools.includes("read") && `插問要能查資料：${tools}`,
        /delegate|write|edit|powershell|bash/.test(tools) && `插問不能交辦、寫檔、執行：${tools}`,
        out.includes("[0s] 對話裡有插問") && "插問不應該寫進今天的對話",
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${order[quick]?.slice(0, 60)}\n工具：${tools}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-7-03",
    name: "團隊日報：例行工作「團隊日報」由程式先附上今天的交辦紀錄（含要老闆確認的事）",
    async run(t) {
      const { out } = await start(t, "report", (dir) => {
        team(dir);
        const now = new Date().toISOString();
        mkdirSync(join(dir, "data"), { recursive: true });
        writeFileSync(join(dir, "data", "交辦紀錄.jsonl"), [
          { 時間: now, 編號: 1, 事件: "開始", 對象: "業務", 規則: "業務-1", 交辦: "擬 C 公司報價回覆", 來源: "使用者" },
          { 時間: now, 編號: 1, 事件: "結束", 狀態: "已回報", 要老闆確認: "C 公司 490,000 低於底價 495,000，是否同意" },
          { 時間: now, 編號: 2, 事件: "開始", 對象: "業務", 規則: "業務-1", 交辦: "整理報價表", 來源: "使用者" },
          { 時間: now, 編號: 2, 事件: "結束", 狀態: "被叫停" },
        ].map((row) => JSON.stringify(row)).join("\n") + "\n");
        writeFileSync(join(dir, "排程.json"), JSON.stringify({ 例行工作: [{ 名稱: "團隊日報", 時間: "每天 23:59", 要他做的事: "照 team-report 技能寫今天的團隊日報" }] }));
      });
      const data = lines(t, out, "日報資料")[0] ?? "";
      const problems = [
        !data.includes("【今日交辦】今天共 2 次") && `要附上今天的交辦紀錄：${data.slice(0, 300) || tail(out)}`,
        !data.includes("#1") || !data.includes("業務助理（業務-1）：擬 C 公司報價回覆｜已回報") ? "每筆交辦要有編號、對象、內容、結果" : "",
        !data.includes("要老闆確認：C 公司 490,000 低於底價 495,000，是否同意") && "要附上要老闆確認的事",
        !data.includes("#2") || !data.includes("被叫停") ? "被叫停的也要列" : "",
        !data.includes("team-report") && "要附上 team-report 技能的內容",
      ].filter(Boolean);
      return problems.length === 0 ? pass(data.slice(data.indexOf("【今日交辦】"), data.indexOf("【今日交辦】") + 200)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-7-04",
    name: "使用者直接傳「團隊日報」也附上今天的交辦紀錄；紀錄裡的字不會被當成關鍵字要求交辦",
    async run(t) {
      const { out } = await start(t, "direct", (dir) => {
        mkdirSync(join(dir, "角色", "業務", "資料"), { recursive: true });
        writeFileSync(join(dir, "角色", "業務", "角色.json"), JSON.stringify({ 負責: "客戶、報價", 外掛: [], 分派規則: ["客戶、報價的問題"], 關鍵字: ["報價"] }));
        mkdirSync(join(dir, "data"), { recursive: true });
        const now = new Date().toISOString();
        writeFileSync(join(dir, "data", "交辦紀錄.jsonl"), [
          { 時間: now, 編號: 1, 事件: "開始", 對象: "業務", 規則: "業務-1", 交辦: "查 A 公司報價", 來源: "使用者" },
          { 時間: now, 編號: 1, 事件: "結束", 狀態: "已回報" },
        ].map((row) => JSON.stringify(row)).join("\n") + "\n");
      });
      const data = lines(t, out, "直接日報")[0] ?? "";
      const problems = [
        !data.includes("【今日交辦】今天共 1 次") && `直接要團隊日報也要附交辦紀錄：${data.slice(0, 300) || tail(out)}`,
        data.includes("是業務助理負責的事") && "交辦紀錄裡的「報價」不應該觸發關鍵字提醒",
        out.includes("你沒有交辦就回答了") && "團隊日報不應該被退回要求交辦",
      ].filter(Boolean);
      return problems.length === 0 ? pass(data.slice(data.indexOf("【今日交辦】"), data.indexOf("【今日交辦】") + 120)) : fail(problems.join("\n"));
    },
  },
];

// ── 假 Telegram＋假 Gemini ─────────────────────────────────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (part) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const text = (value) => sse({ text: value });
const flat = (value) => String(value).replace(/\n/g, " ⏎ ");
const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
function parse(options) {
  const body = JSON.parse(options.body);
  const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
  const lastText = (body.contents?.at(-1)?.parts ?? []).map((part) => part.text ?? "").join("");
  const allText = (body.contents ?? []).map((item) => (item.parts ?? []).map((part) => part.text ?? "").join("")).join("\n");
  const tools = (body.tools ?? []).flatMap((tool) => (tool.functionDeclarations ?? []).map((item) => item.name));
  return { system, lastText, allText, tools };
}
/** 假 Telegram：script = [[等幾毫秒, 訊息]…]，依序送進來。 */
function telegram(target, options, script, onSend) {
  const body = JSON.parse(options.body ?? "{}");
  if (target.endsWith("/sendMessage")) {
    console.log(`[0s] 送出 ${flat(body.text)}`);
    onSend?.(body.text);
    return ok({ message_id: 1 });
  }
  if (target.endsWith("/sendChatAction") || target.endsWith("/editMessageText") || target.endsWith("/answerCallbackQuery")) return ok(true);
  return later(200).then(() => {
    const next = script.queue.shift();
    return next ? ok([{ update_id: ++script.id, message: { text: next, from: { id: 7 }, chat: { id: 7 } } }]) : ok([]);
  });
}
const finish = () => setTimeout(() => { console.log("[0s] 品檢結束"); process.exit(0); }, 300);

export const fakes = {
  /** 第一則（做 1.5 秒）→ 做的時候 /wait → 第二則（暫停中）→ /status → /go → 第二則才做。 */
  async wait() {
    const script = { queue: [null, "第一則"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        const which = req.lastText.includes("第二則") ? "第二則" : "第一則";
        console.log(`[0s] 秘書收到 ${which}`);
        if (which === "第一則") {
          script.queue.push("/wait", "第二則", "/status");
          return later(1500, text("第一則做完了"));
        }
        return text("第二則做完了");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, script, (sent) => {
        if (sent.includes("秘書狀態")) setTimeout(() => script.queue.push("/go"), 1500);
        if (sent.includes("第二則做完")) finish();
      });
    };
  },

  /** 「整理報價」做 3 秒 → 中間 /btw 下午幾點開會 → 插問先回答；之後再傳一則，看對話裡有沒有插問。 */
  async btw() {
    const script = { queue: [null, "幫我整理報價"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.system.includes("插問的一句")) {
          console.log(`[0s] 插問工具 ${req.tools.join(",")}`);
          return text("下午 3 點");
        }
        if (req.lastText.includes("幫我整理報價")) {
          script.queue.push("/btw 下午幾點開會");
          return later(3000, text("報價整理好了"));
        }
        if (req.allText.includes("下午幾點開會")) console.log("[0s] 對話裡有插問");
        return text("最後一則好了");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, script, (sent) => {
        if (sent.includes("報價整理好了")) script.queue.push("再一則");
        if (sent.includes("最後一則好了")) finish();
      });
    };
  },

  /** 使用者直接傳「團隊日報」：看秘書收到的訊息有沒有附上交辦紀錄、有沒有被當成關鍵字要求交辦。 */
  async direct() {
    const script = { queue: [null, "團隊日報"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        console.log(`[0s] 直接日報 ${flat(req.lastText)}`);
        return text("👥 團隊日報（直接）");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, script, (sent) => { if (sent.includes("團隊日報（直接）")) finish(); });
    };
  },

  /** /run 團隊日報：把秘書收到的指令印出來。 */
  async report() {
    const script = { queue: [null, "/run 團隊日報"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.lastText.includes("【例行工作：團隊日報】")) console.log(`[0s] 日報資料 ${flat(req.lastText)}`);
        return text("👥 團隊日報");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, script, (sent) => { if (sent.includes("🕗")) finish(); });
    };
  },
};
