// L5-8 自己招一位助理＋結訓的工程自檢（Q5-8-01～Q5-8-02）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-8）。
// 用假 Telegram／假 Gemini 啟動副本；學員照範本建的廠務助理要能用，寫錯的角色要在 /status 列出來。
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** 逐檔複製（Node 24 的 cpSync 在 Windows 遇到中文資料夾名稱會當掉，同 self-check.mjs）。 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTree(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name));
  }
}

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

/** 照範本建廠務；另外建三個寫錯的：研發（漏寫一堆）、倉管（JSON 壞掉）、採購（沒有 角色.json）。 */
function prepare(dir) {
  mkdirSync(join(dir, "角色"), { recursive: true });
  copyTree(join(dir, "角色範本", "廠務"), join(dir, "角色", "廠務"));
  mkdirSync(join(dir, "角色", "研發", "資料"), { recursive: true });
  writeFileSync(join(dir, "角色", "研發", "角色.json"), JSON.stringify({ 外掛: ["打錯的外掛"], 可以寫的地方: ["MEMORY.md"] }));
  mkdirSync(join(dir, "角色", "倉管"), { recursive: true });
  writeFileSync(join(dir, "角色", "倉管", "角色.json"), "{ \"負責\": \"庫存\" \"分派規則\": [] }");
  mkdirSync(join(dir, "角色", "採購"), { recursive: true });
}

const lines = (t, out, prefix) => t.scriptLines(out).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
const start = (t, fake) => t.startBridge({ module: t.module, fake, env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare });

export const checks = [
  {
    id: "Q5-8-01",
    name: "角色健檢：/status 列出照範本建好的廠務（沒有 ⚠️），以及寫錯的角色哪裡錯（漏寫、外掛打錯、不能寫的地方、JSON 壞掉、沒有 角色.json）",
    async run(t) {
      const { out } = await start(t, "status");
      const text = lines(t, out, "送出").find((line) => line.includes("秘書狀態")) ?? "";
      const block = (name) => text.split(" ⏎ ").reduce((acc, line) => {
        if (line.startsWith("👤") || line.startsWith("❌")) acc.current = line.includes(`${name}助理`) || line.includes(`「${name}」`);
        if (acc.current) acc.lines.push(line);
        return acc;
      }, { current: false, lines: [] }).lines.join("\n");
      const factory = block("廠務");
      const rd = block("研發");
      const problems = [
        !factory.includes("👤 廠務助理：生產排程、品質異常、出貨") && `照範本建的廠務要列出來：${factory || text.slice(0, 400) || tail(out)}`,
        factory.includes("⚠️") && `照範本建的廠務不應該有警告：${factory}`,
        !rd.includes("「負責」沒寫") && `研發漏寫「負責」要提醒：${rd}`,
        !rd.includes("沒有「分派規則」") && "研發沒有分派規則要提醒",
        !rd.includes("外掛 打錯的外掛 不在 外掛/ 裡") && "外掛名字打錯要提醒",
        !rd.includes("不能寫「MEMORY.md」") && "寫了不能寫的地方要提醒",
        !rd.includes("沒有 SOUL.md") && "沒有 SOUL.md 要提醒",
        !rd.includes("資料/ 是空的") && "資料/ 是空的要提醒",
        !text.includes("❌ 角色「倉管」沒有載入：角色.json 讀不懂") && "JSON 壞掉要列出來",
        !text.includes("❌ 角色「採購」沒有載入：資料夾裡沒有 角色.json") && "沒有 角色.json 要列出來",
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${factory.split("\n")[0].slice(0, 100)}\n${rd.split("\n").slice(1, 3).join(" / ")}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-8-02",
    name: "照範本建的廠務助理能用：秘書依廠務的分派規則交辦 → 廠務查自己的資料回報 → 回覆附 📨",
    async run(t) {
      const { out } = await start(t, "factory");
      const reply = lines(t, out, "送出").find((line) => line.includes("W-1012")) ?? "";
      const problems = [
        !reply.includes("📨 交辦 #1：廠務助理（廠務-1），已回報；他查了 read 生產排程.md") && `廠務交辦沒成功：${reply || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply.slice(-90)) : fail(problems.join("\n"));
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
  return { system, isResult: (last?.parts ?? []).some((part) => part.functionResponse), factory: system.includes("你是團隊裡的廠務助理") };
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
const finish = () => setTimeout(() => { console.log("[0s] 品檢結束"); process.exit(0); }, 300);

export const fakes = {
  async status() {
    const state = { queue: [null, "/status"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) return text("好");
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("秘書狀態")) finish(); });
    };
  },

  /** 「A 公司那兩台什麼時候出貨？」→ 秘書照廠務-1 交辦 → 廠務 read 生產排程 → 回報。 */
  async factory() {
    const state = { queue: [null, "A 公司那兩台什麼時候出貨？"], id: 0 };
    let step = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.factory) {
          step++;
          if (step === 1) return call("read", { path: "角色/廠務/資料/生產排程.md" });
          return text("【結果】\nW-1012 A 公司 RA-200 2 台，預計 10/28 (排程) 完工\n【沒做到的】\n（無）\n【要老闆確認的】\n（無）");
        }
        if (!req.isResult) return call("delegate", { 角色: "廠務", 規則: "廠務-1", 交辦: "查 A 公司 RA-200 兩台的出貨日期", 要回報: "預計完工與出貨日期" });
        return text("A 公司那兩台（工單 W-1012）預計 10/28 完工。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("W-1012")) finish(); });
    };
  },
};
