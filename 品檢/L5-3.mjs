// L5-3 單一窗口與分派的工程自檢（Q5-3-01～Q5-3-05）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L5-3）。
// 用假 Telegram／假 Gemini 啟動副本；副本裡建兩位有分派規則的助理（業務、研發），假 Gemini 從 system prompt 分辨是秘書還是助理。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

/** 在副本裡建兩位有分派規則的助理：業務（拿走 Gmail）、研發。 */
function team(dir) {
  const role = (name, config, files) => {
    mkdirSync(join(dir, "角色", name, "資料"), { recursive: true });
    writeFileSync(join(dir, "角色", name, "角色.json"), JSON.stringify(config));
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, "角色", name, "資料", file), text);
  };
  role("業務", { 負責: "客戶、報價、訂單", 外掛: ["Gmail", "Office", "傳檔案"], 分派規則: ["客戶、報價、訂單、付款條件的問題", "要擬給客戶的回覆"], 關鍵字: ["報價"] },
    { "報價紀錄.md": "| 日期 | 客戶 | 品項 | 單價（未稅） |\n|---|---|---|---|\n| 2026-08-12 | A 公司 | RA-200 | 485000 |\n" });
  role("研發", { 負責: "新機種與規格", 外掛: [], 分派規則: ["新機種進度、規格、測試結果"] }, { "進度.md": "PW-40 打樣中\n" });
  mkdirSync(join(dir, "data", "google"), { recursive: true });
  for (const file of ["client.json", "gmail-token.json"]) writeFileSync(join(dir, "data", "google", file), "{}");
}

const lines = (t, out, prefix) => t.scriptLines(out).filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length).trim());
const start = (t, fake, prepare = team) => t.startBridge({ module: t.module, fake, env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare });

export const checks = [
  {
    id: "Q5-3-01",
    name: "分派：秘書看得到分派規則表、有 delegate；照規則交給業務 → 業務收到交辦單、查資料回答 → 回覆最後由程式附 📨（交給誰、依據哪條、他查了什麼）",
    async run(t) {
      const { out } = await start(t, "flow");
      const prompt = lines(t, out, "秘書知道")[0] ?? "";
      const gen = lines(t, out, "秘書工具")[0] ?? "";
      const sheet = lines(t, out, "交辦單")[0] ?? "";
      const back = lines(t, out, "回給秘書")[0] ?? "";
      const reply = lines(t, out, "送出").find((line) => line.includes("A 公司上次")) ?? "";
      const problems = [
        !gen.includes("delegate") && `秘書沒有 delegate：${gen || tail(out)}`,
        !prompt.includes("業務-1：客戶、報價、訂單、付款條件的問題 → 交給業務助理") && `秘書的 system prompt 要有分派規則表：${prompt.slice(0, 300)}`,
        !prompt.includes("研發-1：新機種進度、規格、測試結果 → 交給研發助理") && "分派規則表要有研發",
        !/【交辦單( #\d+)?】交辦者：秘書｜依據：業務-1（客戶、報價、訂單、付款條件的問題）/.test(sheet) && `交辦單格式不對：${sheet || tail(out)}`,
        // L5-4 起標記多了編號、「已回答」改「已回報」，這裡兩種都認
        !/業務助理的回(答|報)/.test(back) && `助理的回答沒交回給秘書：${back}`,
        !/系統記錄）?：?他查了 read 報價紀錄\.md/.test(back) && `交回秘書時要附程式記的「他查了什麼」：${back}`,
        !/📨 交辦( #\d+)?：業務助理（業務-1），已回(答|報)；他查了 read 報價紀錄\.md/.test(reply) && `回覆最後要附 📨：${reply || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(reply.slice(0, 200)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-3-02",
    name: "規則由程式檢查：規則跟對象不符被退回（不讓模型自由決定交給誰）",
    async run(t) {
      const { out } = await start(t, "mismatch");
      const result = lines(t, out, "工具結果")[0] ?? "";
      const problems = [
        !result.includes("規則 研發-1 是交給研發助理的，不是業務助理") && `規則與對象不符要退回：${result || tail(out)}`,
        out.includes("[0s] 業務被交辦") && "規則不符時不應該交給業務",
      ].filter(Boolean);
      return problems.length === 0 ? pass(result.slice(0, 160)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-3-03",
    name: "使用者說「叫業務…」：由程式附「使用者指定交給業務助理」；沒點名的不附",
    async run(t) {
      const { out } = await start(t, "named");
      const hints = lines(t, out, "提醒");
      const problems = [
        !hints[0]?.includes("有") && `「叫業務查一下」要附指定提醒：${hints.join(" / ") || tail(out)}`,
        !hints[1]?.includes("沒有") && `「今天天氣如何」不應該附：${hints.join(" / ")}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(hints.join(" / ")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-3-04",
    name: "例行工作裡交辦：助理也藏起執行級工具，交辦單寫明老闆不在旁邊",
    async run(t) {
      const { out } = await start(t, "routine", (dir) => {
        team(dir);
        writeFileSync(join(dir, "排程.json"), JSON.stringify({ 例行工作: [{ 名稱: "交辦測試", 時間: "每天 23:59", 要他做的事: "請業務整理今天的報價狀態" }] }));
      });
      const tools = lines(t, out, "業務工具")[0] ?? "";
      const sheet = lines(t, out, "交辦單")[0] ?? "";
      const problems = [
        !tools && `例行工作沒有交辦到業務：\n${tail(out)}`,
        tools.includes("powershell") || tools.includes("gmail_send") ? `例行工作中，業務助理不應該有執行級工具：${tools}` : "",
        !sheet.includes("這是例行工作，老闆現在不在旁邊") && `交辦單要寫明是例行工作：${sheet}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(tools) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-3-05",
    name: "/stop 在交辦中：秘書與助理一起停；下一則秘書收到「被叫停了」，不會又交辦一次",
    async run(t) {
      const { out } = await start(t, "stop");
      const sent = lines(t, out, "送出");
      const problems = [
        !out.includes("助理被中止") && `助理的請求沒有被中止：\n${tail(out)}`,
        !sent.some((line) => line.includes("已停止")) && `沒有回「已停止」：\n${tail(out)}`,
        !out.includes("秘書看到叫停") && "下一則秘書沒有收到「被叫停了」的提醒（會接著交辦）",
        out.includes("又交辦了") && "叫停後秘書又交辦了一次",
      ].filter(Boolean);
      return problems.length === 0 ? pass(sent.join("\n").slice(0, 200)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-3-06",
    name: "資料邊界不從日誌漏：秘書整理日誌時不抄助理回報的資料；秘書的規則寫明記得答案也要交辦",
    async run(t) {
      const { out } = await start(t, "journal");
      const journal = lines(t, out, "日誌指令")[0] ?? "";
      const rule = lines(t, out, "秘書規則")[0] ?? "";
      const problems = [
        journal !== "有團隊規則" && `整理日誌的指令要有「不抄助理回報的資料」：${journal || tail(out)}`,
        rule !== "有" && `秘書的規則要寫「記得答案也要交辦」：${rule || tail(out)}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(`日誌指令：${journal}；秘書規則：${rule}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-3-08",
    name: "關鍵字由程式把關：訊息有「報價」就附提醒；秘書沒交辦就回答 → 退回一次 → 交辦後重答；不需要助理資料時可以說明理由不交辦",
    async run(t) {
      const { out } = await start(t, "keyword");
      const hint = lines(t, out, "關鍵字提醒")[0] ?? "";
      const sent = lines(t, out, "送出");
      const first = sent.find((line) => line.includes("業務查過了")) ?? "";
      const second = sent.find((line) => line.includes("Quotation")) ?? "";
      const problems = [
        hint !== "有" && `訊息有「報價」要附提醒：${hint || tail(out)}`,
        !/📨 交辦( #\d+)?：業務助理（業務-1），已回(答|報)/.test(first) && `沒交辦就回答，退回後要交辦：${first || sent.join(" / ") || tail(out)}`,
        !first.includes("（秘書第一次沒交辦，系統請他交辦後重答）") && `要註明退回過：${first}`,
        !second.includes("不需要業務的資料") && `只是翻譯時，秘書可以說明不用交辦：${second}`,
        !second.includes("（訊息有助理的關鍵字，秘書說明了為什麼不用交辦）") && `要註明沒交辦的原因：${second}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${first.slice(0, 160)}\n${second.slice(0, 160)}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q5-3-07",
    name: "回覆裡的 LaTeX 公式換成一般文字（$$\\text{OEE} … \\times …$$ → OEE = … × …）；價格 NT$ 不動",
    async run(t) {
      const { out } = await start(t, "latex", null);
      const sent = lines(t, out, "送出").find((line) => line.includes("計算公式")) ?? "";
      const problems = [
        !sent.includes("OEE = 可用率 × 表現性 × 品質率") && `公式沒換成一般文字：${sent || tail(out)}`,
        /\\text|\$\$/.test(sent) && `還留著 LaTeX 記號：${sent}`,
        !sent.includes("NT$485,000，另一台 NT$1,260,000") && `價格的 NT$ 被動到了：${sent}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass(sent.slice(0, 160)) : fail(problems.join("\n"));
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
const salesAnswer = (req, step) => {
  if (step === 1) return call("read", { path: "角色/業務/資料/報價紀錄.md" });
  return text("A 公司 2026-08-12 報價 RA-200，485,000 元（未稅）。");
};

export const fakes = {
  /** 「A 公司上次報價多少？」→ 秘書照業務-1 交辦 → 業務 read → 回答 → 秘書回覆。 */
  async flow() {
    const state = { queue: [null, "A 公司上次報價多少？"], id: 0 };
    let salesStep = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") {
          if (!req.isResult) {
            console.log(`[0s] 秘書工具 ${req.tools.join(",")}`);
            console.log(`[0s] 秘書知道 ${flat(req.system.slice(req.system.indexOf("分派規則"), req.system.indexOf("分派規則") + 300))}`);
            return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: "查 A 公司上次報價的金額與日期" });
          }
          console.log(`[0s] 回給秘書 ${flat(req.lastText)}`);
          return text("A 公司上次（8/12）報價 RA-200 485,000 元（未稅）。");
        }
        salesStep++;
        if (salesStep === 1) console.log(`[0s] 交辦單 ${flat(req.lastText).replace(/^【現在時間：[^】]*】 ⏎ /, "")}`);
        return salesAnswer(req, salesStep);
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("A 公司上次")) finish(); });
    };
  },

  /** 秘書用研發的規則交給業務 → 程式退回。 */
  async mismatch() {
    const state = { queue: [null, "A 公司上次報價多少？"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who !== "秘書") { console.log("[0s] 業務被交辦"); return text("好"); }
        if (!req.isResult) return call("delegate", { 角色: "業務", 規則: "研發-1", 交辦: "查 A 公司報價" });
        console.log(`[0s] 工具結果 ${flat(req.lastText)}`);
        return text("規則選錯了，我重新確認。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("規則選錯")) finish(); });
    };
  },

  /** 「叫業務查一下 A 公司」要附指定提醒；「今天天氣如何」不附。 */
  async named() {
    const state = { queue: [null, "叫業務查一下 A 公司", "今天天氣如何"], id: 0 };
    let count = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        count++;
        console.log(`[0s] 提醒 ${req.lastText.includes("【系統提醒：使用者指定交給業務助理") ? "有" : "沒有"}`);
        return text(count === 1 ? "第一則好" : "第二則好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("第二則好")) finish(); });
    };
  },

  /** /run交辦測試：例行工作裡秘書交辦給業務，看業務的工具與交辦單。 */
  async routine() {
    const state = { queue: [null, "/run 交辦測試"], id: 0 };
    let salesStep = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") {
          if (!req.isResult) return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: "整理今天的報價狀態" });
          return text("業務整理好了。");
        }
        salesStep++;
        if (salesStep === 1) {
          console.log(`[0s] 業務工具 ${req.tools.join(",")}`);
          console.log(`[0s] 交辦單 ${flat(req.lastText)}`);
        }
        return salesAnswer(req, salesStep);
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("🕗")) finish(); });
    };
  },

  /** 有關鍵字「報價」：第一則秘書憑記憶回答 → 程式退回 → 交辦；第二則只是翻譯 → 秘書說明不用交辦。 */
  async keyword() {
    const state = { queue: [null, "A 公司上次報價多少？", "報價這個詞英文怎麼說？"], id: 0 };
    let salesStep = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "業務") return salesAnswer(req, ++salesStep);
        if (req.lastText.includes("A 公司上次報價多少")) {
          console.log(`[0s] 關鍵字提醒 ${req.lastText.includes("【系統提醒：這則訊息有「報價」，是業務助理負責的事") ? "有" : "沒有"}`);
          return text("A 公司上次報價 485,000 元。"); // 憑記憶、沒交辦
        }
        if (req.lastText.includes("你沒有交辦就回答了") && req.allText.includes("A 公司上次報價多少")
          && !req.allText.includes("報價這個詞英文")) return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: "查 A 公司上次報價" });
        if (req.isResult) return text("業務查過了：A 公司 8/12 報價 485,000 元（未稅）。");
        if (req.lastText.includes("報價這個詞英文怎麼說")) return text("Quotation。");
        if (req.lastText.includes("你沒有交辦就回答了")) return text("這只是翻譯，不需要業務的資料。報價的英文是 Quotation。");
        return text("好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("Quotation")) finish(); });
    };
  },

  /** 模型用 LaTeX 寫公式，回覆裡也有價格 NT$。 */
  async latex() {
    const state = { queue: [null, "什麼是 OEE？"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        return text("計算公式：\n$$\\text{OEE} = \\text{可用率} \\times \\text{表現性} \\times \\text{品質率}$$\n設備 NT$485,000，另一台 NT$1,260,000。");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("計算公式")) finish(); });
    };
  },

  /** 跟秘書說一句 → /new：看秘書的規則、日誌整理指令裡的團隊規則。 */
  async journal() {
    const state = { queue: [null, "你好", "/new"], id: 0 };
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.lastText.includes("【系統指令：整理工作日誌】")) {
          console.log(`[0s] 日誌指令 ${req.lastText.includes("不要把助理回報的金額、數量、日期、客戶資料抄進日誌") ? "有團隊規則" : "沒有團隊規則"}`);
          return text("# 日誌\n\n## 今天做了什麼\n- 打招呼\n\n## 產出的文件\n- （無）\n\n## 還沒完成的事\n- （無）\n\n## 建議長期記住的事\n- （無）");
        }
        if (req.lastText.includes("【系統指令：列出主題】")) return text("- 打招呼");
        console.log(`[0s] 秘書規則 ${req.system.includes("就算你記得答案、日誌或之前的對話裡有，符合分派規則的事也一定要交辦") ? "有" : "沒有"}`);
        return text("你好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => { if (sent.includes("今天先到這")) finish(); });
    };
  },

  /** 交辦中業務卡住 → /stop → 再傳一則：秘書的對話要有「被叫停了」，而且不再交辦。 */
  async stop() {
    const state = { queue: [null, "叫業務整理所有報價"], id: 0 };
    let round = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const req = parse(options);
        if (req.who === "秘書") {
          if (req.isResult) return text("好的。");
          round++;
          if (round === 1) return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: "整理所有報價" });
          if (/叫停/.test(req.allText)) {
            console.log("[0s] 秘書看到叫停");
            return text("剛才那件被你叫停了，沒有做完。");
          }
          console.log("[0s] 又交辦了");
          return call("delegate", { 角色: "業務", 規則: "業務-1", 交辦: "整理所有報價" });
        }
        state.queue.push("/stop");
        return new Promise((_, reject) => options.signal?.addEventListener("abort", () => {
          console.log("[0s] 助理被中止");
          reject(new DOMException("aborted", "AbortError"));
        }));
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      return telegram(target, options, state, (sent) => {
        if (sent.includes("已停止")) setTimeout(() => state.queue.push("剛剛那件做到哪了？"), 500);
        if (sent.includes("被你叫停了")) finish();
      });
    };
  },
};
