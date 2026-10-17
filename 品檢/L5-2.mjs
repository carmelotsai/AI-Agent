// L5-2 第一位部門助理的工程自檢（Q5-2-01～Q5-2-05）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-2）。
// 用假 Telegram／假 Gemini 啟動副本；副本裡建兩位助理（業務、研發），假 Gemini 從 system prompt 分辨是秘書還是助理。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

/** 在副本裡建兩位助理：業務（拿走 Gmail）、研發（沒有外掛）。 */
function team(dir) {
  const role = (name, config, files) => {
    mkdirSync(join(dir, "角色", name, "資料"), { recursive: true });
    writeFileSync(join(dir, "角色", name, "角色.json"), JSON.stringify(config));
    writeFileSync(join(dir, "角色", name, "SOUL.md"), `# ${name}助理\n\n做事仔細、數字一定查過再說。\n`);
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, "角色", name, "資料", file), text);
  };
  role("業務", { 負責: "客戶、報價、訂單", 外掛: ["Gmail", "Office", "傳檔案"] },
    { "報價紀錄.md": "| 日期 | 客戶 | 品項 | 單價（未稅） |\n|---|---|---|---|\n| 2026-08-12 | A 公司 | RA-200 | 485000 |\n" });
  role("研發", { 負責: "新機種與規格", 外掛: [] }, { "進度.md": "PW-40 打樣中\n" });
  // 讓 Gmail 外掛註冊得了工具（假的授權檔，工具不會真的連 Google）
  mkdirSync(join(dir, "data", "google"), { recursive: true });
  for (const file of ["client.json", "gmail-token.json"]) writeFileSync(join(dir, "data", "google", file), "{}");
}

const lines = (t, out, prefix) => t.scriptLines(out).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
const start = (t, fake, prepare = team) => t.startBridge({ module: t.module, fake, env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare });

export const checks = [
  {
    id: "Q5-2-01",
    name: "照資料邊界拆：分給業務的 Gmail 從秘書身上拿掉、傳檔案共用；秘書沒有交辦工具；秘書知道團隊、知道要請老闆用 /試用",
    async run(t) {
      const { out } = await start(t, "trial");
      const gen = lines(t, out, "秘書工具")[0] ?? "";
      const sales = lines(t, out, "業務工具")[0] ?? "";
      const prompt = lines(t, out, "秘書知道")[0] ?? "";
      const problems = [
        !gen && `秘書沒有被呼叫：\n${tail(out)}`,
        gen.includes("gmail_") && "Gmail 分給業務了，秘書身上不應該還有 gmail_ 工具",
        !gen.includes("send_file") && "傳檔案是共用外掛，秘書身上要留著",
        gen.includes("delegate") && "L5-2 還沒有交辦（delegate 是 L5-4）",
        !sales.includes("gmail_search") && `業務助理要有 Gmail 的工具：${sales || tail(out)}`,
        !sales.includes("read") && "業務助理要有 read",
        !prompt.includes("業務助理（客戶、報價、訂單）") && `秘書的 system prompt 要列出團隊：${prompt}`,
        !prompt.includes("/試用 業務") && "秘書要知道請老闆用 /試用 問助理",
      ].filter(Boolean);
      return problems.length === 0 ? pass(`秘書 ${gen.split(",").length} 個工具、業務 ${sales.split(",").length} 個`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-2-02",
    name: "/試用：直接問業務助理，他查自己的資料回答；回覆最後由程式附「👤 業務助理回答」與他查了什麼；助理名字打錯會列出團隊",
    async run(t) {
      const { out } = await start(t, "trial");
      const asked = lines(t, out, "業務收到")[0] ?? "";
      const reply = lines(t, out, "送出").find((line) => line.includes("485")) ?? "";
      const wrong = lines(t, out, "送出").find((line) => line.includes("倉管")) ?? "";
      const problems = [
        !asked.includes("【老闆用 /試用 直接問你】A 公司上次報價多少") && `業務助理沒收到 /試用 的問題：${asked || tail(out)}`,
        !reply.includes("👤 業務助理回答（/試用）；他查了 read 報價紀錄.md") && `回覆最後要附「👤 業務助理回答…他查了…」：${reply || tail(out)}`,
        !wrong.includes("團隊有：業務、研發") && `助理名字打錯要列出團隊：${wrong || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${reply.slice(0, 140)}\n${wrong.slice(0, 80)}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-2-03",
    name: "權限：秘書讀不到助理的資料、grep 結果裡助理的資料被拿掉；助理不能寫 MEMORY.md、不能讀別的助理的資料夾",
    async run(t) {
      const { out } = await start(t, "perm");
      const results = lines(t, out, "工具結果");
      const find = (keyword) => results.find((line) => line.startsWith(keyword)) ?? "";
      const problems = [
        !find("read#秘書").includes("沒有權限讀 角色/業務/資料/報價紀錄.md") && `秘書讀業務資料沒被擋：${find("read#秘書") || tail(out)}`,
        /角色\/(業務|研發)\/資料/.test(find("grep#秘書")) && `秘書從根目錄 grep 看到了助理的資料：${find("grep#秘書").slice(0, 300)}`,
        !find("grep#秘書").includes("已拿掉") && `grep 結果拿掉資料時要說一聲：${find("grep#秘書").slice(0, 300)}`,
        !find("write#業務").includes("業務助理只能寫") && `業務寫 MEMORY.md 沒被擋：${find("write#業務")}`,
        !find("read#業務").includes("那是研發助理的資料夾") && `業務讀研發的資料沒被擋：${find("read#業務")}`,
        readFileSync(join(t.ROOT, "MEMORY.md"), "utf8").includes("被改了") && "專案的 MEMORY.md 被動到了",
      ].filter(Boolean);
      return problems.length === 0 ? pass(results.map((line) => line.slice(0, 90)).join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-2-04",
    name: "/stop 停得了被 /試用 的助理；下一次 /試用，助理收到「被叫停了」，不會接著做",
    async run(t) {
      const { out } = await start(t, "stop");
      const sent = lines(t, out, "送出");
      const problems = [
        !out.includes("助理被中止") && `助理的請求沒有被中止：\n${tail(out)}`,
        !sent.some((line) => line.includes("已停止")) && `沒有回「已停止」：\n${tail(out)}`,
        !out.includes("業務看到叫停") && "下一次 /試用，業務助理沒有收到「被叫停了」的提醒（會接著做）",
      ].filter(Boolean);
      return problems.length === 0 ? pass(sent.join("\n").slice(0, 300)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-2-05",
    name: "/status 列出團隊與「已交給助理」的外掛；沒有 角色/ 時不出現團隊",
    async run(t) {
      const { out } = await start(t, "status");
      const text = lines(t, out, "送出").find((line) => line.includes("秘書狀態")) ?? "";
      const plain = await start(t, "status", null); // null：不建 角色/（undefined 會變回預設的 team）
      const plainText = lines(t, plain.out, "送出").find((line) => line.includes("秘書狀態")) ?? "";
      const problems = [
        !text.includes("👤 業務助理：客戶、報價、訂單｜外掛 Gmail、Office、傳檔案") && `沒有列出業務助理：${text.slice(0, 300) || tail(out)}`,
        !text.includes("👤 研發助理") && "沒有列出研發助理",
        !text.includes("➡️ Gmail：交給業務助理") && "Gmail 要顯示「交給業務助理」",
        !plainText && `沒有 角色/ 時 /status 沒回：${tail(plain.out)}`,
        plainText.includes("團隊") && "沒有 角色/ 時不應該出現團隊",
      ].filter(Boolean);
      return problems.length === 0 ? pass(text.match(/團隊[^⏎]*⏎[^⏎]*/)?.[0] ?? text.slice(0, 200)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-2-06",
    name: "助理沒查資料就回答數字 → 程式退回一次、查過再答，回覆最後註明；沒有數字的回答不退回",
    async run(t) {
      const { out } = await start(t, "recheck");
      const sent = lines(t, out, "送出");
      const answer = sent.find((line) => line.includes("485")) ?? "";
      const chat = sent.find((line) => line.includes("我很好")) ?? "";
      const problems = [
        !out.includes("系統退回") && `沒查資料就回答數字，程式要退回：\n${tail(out)}`,
        !answer.includes("查過了") && `退回後要用第二次的回答：${answer}`,
        !answer.includes("他查了 read 報價紀錄.md（第一次沒查就回答，系統請他查過後重答）") && `回覆最後要註明退回過：${answer}`,
        chat.includes("系統請他查過") && "沒有數字的回答不應該被退回",
      ].filter(Boolean);
      return problems.length === 0 ? pass(answer.slice(0, 200)) : fail(problems.join("\n"));
    },
  },
];

// ── 假 Telegram＋假 Gemini（在副本裡、秘書啟動前載入）──────────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (part) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const call = (name, args) => sse({ functionCall: { name, args } });
const text = (value) => sse({ text: value });
const flat = (value) => String(value).replace(/\n/g, " ⏎ ");
/** 這次請求是誰發的（看 system prompt）、最後一則是什麼、工具有哪些。 */
function parse(options) {
  const body = JSON.parse(options.body);
  const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
  const who = system.includes("你是團隊裡的業務助理") ? "業務" : system.includes("你是團隊裡的研發助理") ? "研發" : "秘書";
  const last = body.contents?.at(-1);
  const lastText = (last?.parts ?? []).map((part) => part.text ?? (part.functionResponse ? JSON.stringify(part.functionResponse.response) : "")).join("");
  const allText = (body.contents ?? []).map((item) => (item.parts ?? []).map((part) => part.text ?? "").join("")).join("\n");
  const tools = (body.tools ?? []).flatMap((tool) => (tool.functionDeclarations ?? []).map((item) => item.name));
  return { who, system, lastText, allText, tools, isResult: (last?.parts ?? []).some((part) => part.functionResponse) };
}
/** 共用的假 Telegram：state.queue 依序是要傳的訊息（null 表示這輪沒有）；onSend 收到秘書送出的訊息時呼叫。 */
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
  /** 先跟秘書說一句（看他的工具與 prompt）→ /試用 業務 → /試用 倉管（打錯名字）。 */
  async trial() {
    const state = { queue: [null, "你好", "/試用 業務 A 公司上次報價多少？", "/試用 倉管 庫存多少"], id: 0 };
    let salesStep = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") {
          console.log(`[0s] 秘書工具 ${req.tools.join(",")}`);
          console.log(`[0s] 秘書知道 ${flat(req.system.slice(req.system.indexOf("你的團隊")).slice(0, 300))}`);
          return text("你好，有什麼事？");
        }
        salesStep++;
        if (salesStep === 1) {
          console.log(`[0s] 業務工具 ${req.tools.join(",")}`);
          console.log(`[0s] 業務收到 ${flat(req.lastText).replace(/^【現在時間：[^】]*】 ⏎ /, "")}`);
          return call("read", { path: "角色/業務/資料/報價紀錄.md" });
        }
        return text("A 公司 2026-08-12 報價 RA-200，485,000 元（未稅）。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("倉管")) finish(); });
    };
  },

  /** 權限：秘書讀業務資料、從根目錄 grep；業務（/試用）寫 MEMORY.md、讀研發的資料夾。 */
  async perm() {
    const state = { queue: [null, "測試權限", "/試用 業務 測試權限"], id: 0 };
    const steps = {
      秘書: [
        ["read#秘書", () => call("read", { path: "角色/業務/資料/報價紀錄.md" })],
        ["grep#秘書", () => call("grep", { pattern: "485000|PW-40" })],
        ["", () => text("秘書測試完成")],
      ],
      業務: [
        ["write#業務", () => call("write", { path: "MEMORY.md", content: "被改了" })],
        ["read#業務", () => call("read", { path: "角色/研發/資料/進度.md" })],
        ["", () => text("業務測試完成")],
      ],
    };
    const step = { 秘書: 0, 業務: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        const who = req.who === "秘書" ? "秘書" : "業務";
        // 這次請求帶回的是上一步那個工具的結果
        if (req.isResult && step[who] > 0) console.log(`[0s] 工具結果 ${steps[who][step[who] - 1][0]} ${flat(req.lastText)}`);
        const [, reply] = steps[who][Math.min(step[who]++, steps[who].length - 1)];
        return reply();
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("業務測試完成")) finish(); });
    };
  },

  /** /試用 業務 → 助理請求卡著 → /stop → 再 /試用 一次，看助理有沒有收到「被叫停了」。 */
  async stop() {
    const state = { queue: [null, "/試用 業務 整理所有報價"], id: 0 };
    let round = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") return text("好");
        round++;
        if (round === 1) {
          state.queue.push("/stop");
          // 卡住不回，直到被 /stop 中止
          return new Promise((_, reject) => options.signal?.addEventListener("abort", () => {
            console.log("[0s] 助理被中止");
            reject(new DOMException("aborted", "AbortError"));
          }));
        }
        if (/叫停/.test(req.allText)) console.log("[0s] 業務看到叫停");
        return text("A 公司 485000");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => {
        if (sent.includes("已停止")) setTimeout(() => state.queue.push("/試用 業務 查 A 公司報價"), 500);
        if (sent.includes("👤 業務助理回答")) finish();
      });
    };
  },

  /** /試用 業務：第一次沒查資料就回答數字 → 程式退回 → 第二次先 read 再答；接著問一句沒有數字的，不應該被退回。 */
  async recheck() {
    const state = { queue: [null, "/試用 業務 A 公司上次報價多少？", "/試用 業務 你好嗎"], id: 0 };
    let salesStep = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") return text("好");
        salesStep++;
        if (req.lastText.includes("你好嗎")) return text("我很好，隨時可以幫忙。");
        if (salesStep === 1) return text("A 公司上次報價 485,000 元。"); // 憑記憶、沒查
        if (salesStep === 2) {
          if (req.lastText.includes("你剛才沒有查任何資料")) console.log("[0s] 系統退回");
          return call("read", { path: "角色/業務/資料/報價紀錄.md" });
        }
        return text("查過了：A 公司 2026-08-12 報價 485,000 元（未稅）。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("我很好")) finish(); });
    };
  },

  /** /status（不呼叫模型）。 */
  async status() {
    const state = { queue: [null, "/status"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) return text("好");
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("秘書狀態")) finish(); });
    };
  },
};
