// L4-6 自我覆盤的工程自檢（Q4-6-01～Q4-6-03）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L4-6）。
// 用假 Telegram／假 Gemini 啟動副本；假時鐘固定在 2026-10-09（五）17:00。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

const iso = (month, day, hour, minute) => new Date(2026, month - 1, day, hour, minute).toISOString();
const EVENTS = [
  { 時間: iso(9, 29, 10, 0), 種類: "按不要", 工具: "calendar_create", 原因: "你按了「不要」，所以我沒有執行。" }, // 10 天前：不算
  { 時間: iso(10, 4, 10, 0), 種類: "擋下", 工具: "calendar_create", 原因: "你按了「不要」，所以我沒有執行。" }, // 舊格式：也要算成按不要
  { 時間: iso(10, 5, 9, 30), 種類: "按不要", 工具: "calendar_create", 原因: "你按了「不要」，所以我沒有執行。" },
  { 時間: iso(10, 6, 11, 0), 種類: "逾時未按", 工具: "powershell", 原因: "你 5 分鐘內沒有按按鈕，所以我沒有執行。", 指令: "Get-Date" },
  { 時間: iso(10, 7, 14, 0), 種類: "/stop", 正在做事: true, 取消排隊: 0 },
  { 時間: iso(10, 7, 15, 0), 種類: "擋下", 工具: "write", 原因: "我沒有權限寫入 bridge.mjs" },
  { 時間: iso(10, 8, 8, 0), 種類: "模型出錯", 訊息: "{\"error\":{\"code\":503,\"message\":\"This model is currently experiencing high demand\"}}" },
  { 時間: iso(10, 8, 8, 1), 種類: "模型出錯", 訊息: "Request aborted" },
  { 時間: iso(10, 8, 9, 0), 種類: "例行工作失敗", 名稱: "晨報" },
];
const JOURNALS = {
  "2026-10-02": "# 2026-10-02 工作日誌\n\n## 今天做了什麼\n- 太舊的一天（8 天前）。\n\n## 產出的文件\n- （無）\n\n## 還沒完成的事\n- （無）\n\n## 建議長期記住的事\n- （無）\n",
  "2026-10-05": "# 2026-10-05 工作日誌\n\n## 今天做了什麼\n- 使用者提到明天要開會，我自己設了提醒，他說我沒要你設。\n\n## 產出的文件\n- （無）\n\n## 還沒完成的事\n- （無）\n\n## 建議長期記住的事\n- （無）\n",
};
const ROUTINE = { 例行工作: [{ 名稱: "覆盤", 時間: "每週五 17:00", 要他做的事: "照 weekly-review 技能做本週覆盤" }] };

function prepare(dir) {
  for (const file of ["提醒.json", "通知.json", "固定會議.json", "情報.json"]) rmSync(join(dir, file), { force: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "日誌"), { recursive: true });
  writeFileSync(join(dir, "排程.json"), JSON.stringify(ROUTINE));
  writeFileSync(join(dir, "data", "事件紀錄.jsonl"), `${EVENTS.map((event) => JSON.stringify(event)).join("\n")}\n`);
  for (const [day, text] of Object.entries(JOURNALS)) writeFileSync(join(dir, "日誌", `${day}.md`), text);
}

let started;
const startOnce = (t) => (started ??= t.startBridge({ module: t.module, fake: "review", env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 60_000, prepare }));

export const checks = [
  {
    id: "Q4-6-01",
    name: "覆盤的資料：事件分類統計、哪些要檢討由程式先標、10 天前不算、只附最近 7 天的日誌與現有技能清單",
    async run(t) {
      const { out } = await startOnce(t);
      const sent = t.scriptLines(out).find((line) => line.startsWith("收到")) ?? "";
      const problems = [
        !sent.includes("【本週事件】2026-W41（10/3～10/9），共 8 筆") && `標題與筆數不對（應為 2026-W41、10/3～10/9、共 8 筆）：\n${sent.slice(0, 300) || tail(out)}`,
        !sent.includes("按不要 2") && "「按不要」應該 2 次（一次是舊格式的擋下）",
        !sent.includes("逾時未按 1") && "「逾時未按」應該 1 次",
        !sent.includes("/stop 1") && "「/stop」應該 1 次",
        !sent.includes("擋下 1") && "「擋下」應該 1 次（寫 bridge.mjs）",
        !sent.includes("模型出錯（503 忙線） 1") && !sent.includes("模型出錯（503 忙線）1") && "503 要另外分類",
        !sent.includes("模型出錯（被中斷） 1") && !sent.includes("模型出錯（被中斷）1") && "「Request aborted」要分成被中斷",
        !sent.includes("例行工作失敗 1") && "「例行工作失敗」應該 1 次",
        sent.includes("9/29") && "10 天前的事件不應該出現",
        !sent.includes("其中 ★要檢討 4 筆") && "★要檢討應該 4 筆（按不要 2、逾時未按 1、例行工作失敗 1）",
        !sent.includes("合併成 3 件事") && "★ 的事要合併：按不要 ×2 一件、逾時未按一件、例行工作失敗一件，共 3 件",
        !sent.includes("1. 新增行事曆行程（calendar_create） 按不要 ×2｜") && "同一個工具連續被按不要要合併成「新增行事曆行程（calendar_create） 按不要 ×2」，工具名要換成白話",
        !sent.includes("執行指令（powershell） 逾時未按") && "逾時沒按的要寫「執行指令（powershell）」",
        !sent.includes("例行工作「晨報」 例行工作失敗") && "例行工作失敗要寫出是哪個例行工作",
        !sent.includes("/stop （使用者叫停，只記次數）") && "/stop 不用檢討，只記次數",
        !sent.includes("我沒有權限寫入 bridge.mjs （規則正常擋下，不用檢討）") && "規則正常擋下（寫 bridge.mjs）不用檢討",
        !sent.includes("（系統外部，不用檢討）") && "模型出錯屬系統外部，不用檢討",
        !sent.includes("【現有技能】") || !sent.includes(".pi/skills/weekly-review/SKILL.md") && "要附上現有技能清單",
        !sent.includes("【本週日誌】") || !sent.includes("我自己設了提醒，他說我沒要你設") && "最近 7 天的日誌（10/5）要附上",
        sent.includes("太舊的一天") && "8 天前的日誌（10/2）不應該附上",
      ].filter(Boolean);
      return problems.length === 0 ? pass(sent.slice(0, 260)) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-6-02",
    name: "/run覆盤：例行工作寫得進 文件/覆盤/、回覆附 🕗、不會自己改技能；技能寫明只建議、套用只改點名的",
    async run(t) {
      const { out } = await startOnce(t);
      const lines = t.scriptLines(out);
      const written = lines.find((line) => line.startsWith("覆盤檔"))?.slice(4) ?? "";
      const reply = lines.find((line) => line.startsWith("送出 chat=7 📋 本週覆盤")) ?? "";
      const skill = readFileSync(join(t.ROOT, ".pi", "skills", "weekly-review", "SKILL.md"), "utf8");
      const problems = [
        !written.includes("# 2026-W41 覆盤") && `文件/覆盤/2026-W41.md 沒有寫進去（例行工作應該寫得進 文件/）：\n${tail(out)}`,
        out.includes("擋下 write") && `寫覆盤檔被擋下了：\n${tail(out)}`,
        !reply.includes("🕗 例行工作：覆盤（/run 立刻執行）") && `回覆沒有附 🕗：${reply || tail(out)}`,
        !skill.includes("只建議，不自己改") && "技能沒寫「只建議，不自己改」",
        !skill.includes("只改使用者點名的那幾條") && "技能沒寫套用時只改點名的",
        !skill.includes("先查:") || !/- 本週事件：本週事件/.test(skill) || !/- 本週日誌：本週日誌/.test(skill) ? "技能沒有「先查:」本週事件與本週日誌" : "",
        !skill.includes("不要為了交差硬找問題") && "技能沒寫沒問題就老實說",
        !skill.includes("不要拆成好幾條") && "技能沒寫已合併的事一行一條",
        !skill.includes("沒有技能可以改，這幾件要靠施工人員") && "技能沒寫「沒有技能可改」時手機版怎麼寫",
        !skill.includes("只有 ★ 的才寫進") && "技能沒寫只有 ★ 的才檢討",
        !skill.includes("不准寫「推測」") && "技能沒禁止推測",
        !skill.includes("503") && "技能沒寫模型忙線不是你的錯",
      ].filter(Boolean);
      return problems.length === 0 ? pass(`${reply.slice(0, 120)}\n${written.slice(0, 80)}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-6-03",
    name: "事件紀錄：使用者按「不要」記成「按不要」、不跟權限擋下混在一起",
    async run(t) {
      const { out } = await t.startBridge({
        module: t.module, fake: "declined", env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 40_000,
        prepare(dir) {
          for (const file of ["提醒.json", "通知.json", "固定會議.json", "情報.json", "排程.json"]) rmSync(join(dir, file), { force: true });
        },
      });
      const lines = t.scriptLines(out).filter((line) => line.startsWith("事件"));
      const kinds = lines.map((line) => JSON.parse(line.slice(3)).種類);
      const problems = [
        !kinds.includes("按不要") && `按「不要」沒有記成「按不要」：${JSON.stringify(kinds)}\n${tail(out)}`,
        kinds.includes("擋下") && "按「不要」不應該又記成「擋下」",
      ].filter(Boolean);
      return problems.length === 0 ? pass(lines.join("\n")) : fail(problems.join("\n"));
    },
  },
];

// ── 假 Telegram＋假 Gemini（在副本裡、秘書啟動前載入）──────────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (part) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const lastUserText = (body) => (body.contents ?? []).filter((item) => item.role === "user").at(-1)?.parts.map((part) => part.text ?? "").join("") ?? "";

export const fakes = {
  /** 假時鐘 10/9（五）17:00，傳 /run覆盤：把 Gemini 收到的指令全文印出來，模型照指示用 write 存覆盤檔。 */
  async review() {
    const RealDate = Date;
    const offset = new RealDate(2026, 9, 9, 17, 0).getTime() - RealDate.now();
    globalThis.Date = class extends RealDate {
      constructor(...args) { args.length ? super(...args) : super(RealDate.now() + offset); }
      static now() { return RealDate.now() + offset; }
    };
    let step = 0, calls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse(options.body);
        const said = lastUserText(body);
        // 寫完檔之後 Gemini 收到的最後一則是工具結果，要看整段對話裡有沒有例行工作的指令
        const inRoutine = (body.contents ?? []).some((item) => (item.parts ?? []).some((part) => (part.text ?? "").includes("【例行工作：覆盤】")));
        if (!inRoutine) return sse({ text: "好" });
        calls++;
        if (calls === 1) {
          console.log(`[0s] 收到 ${said.replace(/\n/g, " ⏎ ")}`);
          return sse({ functionCall: { name: "write", args: { path: "文件/覆盤/2026-W41.md", content: "# 2026-W41 覆盤（10/3～10/9）\n\n## 建議（只建議，沒有改）\n- 無" } } });
        }
        return sse({ text: "📋 本週覆盤（10/3～10/9）\n事件：按不要 2\n\n要照建議改哪幾條，回我編號。\n完整內容：文件/覆盤/2026-W41.md" });
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      const body = JSON.parse(options.body ?? "{}");
      if (target.endsWith("/sendMessage")) {
        console.log(`[0s] 送出 chat=${body.chat_id} ${body.text.replace(/\n/g, " ⏎ ")}`);
        if (body.text.includes("🕗 例行工作：覆盤")) {
          let file = "（沒有）";
          try { file = readFileSync("文件/覆盤/2026-W41.md", "utf8").replace(/\n/g, " ⏎ "); } catch {}
          console.log(`[0s] 覆盤檔 ${file}`);
          setTimeout(() => { console.log("[0s] 品檢結束"); process.exit(0); }, 300);
        }
        return ok({ message_id: 1 });
      }
      if (target.endsWith("/sendChatAction")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      step++;
      return step === 2 ? ok([{ update_id: 1, message: { text: "/run覆盤", from: { id: 7 }, chat: { id: 7 } } }]) : ok([]);
    };
  },

  /** 使用者傳一句話，模型想跑 powershell（執行級）→ 秘書傳按鈕 → 假使用者按「不要」。 */
  async declined() {
    let step = 0, buttonId = 0, answered = false, calls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        calls++;
        return calls === 1 ? sse({ functionCall: { name: "powershell", args: { command: "Get-Date" } } }) : sse({ text: "好，不執行。" });
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      const body = JSON.parse(options.body ?? "{}");
      if (target.endsWith("/sendMessage")) {
        if (body.reply_markup) buttonId = 500;
        if (body.text.includes("好，不執行")) {
          setTimeout(() => {
            for (const line of readFileSync("data/事件紀錄.jsonl", "utf8").trim().split("\n")) console.log(`[0s] 事件 ${line}`);
            console.log("[0s] 品檢結束");
            process.exit(0);
          }, 300);
        }
        return ok({ message_id: body.reply_markup ? 500 : 1 });
      }
      if (target.endsWith("/sendChatAction") || target.endsWith("/editMessageText") || target.endsWith("/answerCallbackQuery")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      step++;
      if (step === 2) return ok([{ update_id: 1, message: { text: "現在幾點？", from: { id: 7 }, chat: { id: 7 } } }]);
      if (buttonId && !answered) {
        answered = true;
        return ok([{ update_id: 2, callback_query: { id: "q1", from: { id: 7 }, message: { message_id: buttonId }, data: "skip" } }]);
      }
      return ok([]);
    };
  },
};
