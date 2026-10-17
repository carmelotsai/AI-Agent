// L4-7 結訓（/status 的主動工作清單）的工程自檢（Q4-7-01～Q4-7-03）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L4-7）。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 20) => out.trim().split("\n").slice(-lines).join("\n");

/** 副本的設定：兩件提醒、兩個例行工作、一個固定會議、情報關鍵字、重要信件名單。 */
function settings(dir) {
  for (const file of ["提醒.json", "排程.json", "通知.json", "固定會議.json", "情報.json", "公司信箱.json"]) rmSync(join(dir, file), { force: true });
  writeFileSync(join(dir, "待辦.json"), JSON.stringify({
    追蹤: { 開啟: true, 從幾點開始: "09:30", 每幾小時: 2, 收工時間: "18:00" },
    日期: "2026-10-09",
    待辦: [{ 內容: "確認六家廠商的地址", 狀態: "待辦" }, { 內容: "交週報", 狀態: "已完成" }],
  }));
  writeFileSync(join(dir, "提醒.json"), JSON.stringify({
    下一個編號: 9,
    提醒: [
      { 編號: 7, 內容: "交週報", 下次: "2026-10-12T09:00", 重複: "每週一 09:00" },
      { 編號: 8, 內容: "打給王經理", 下次: "2026-10-09T14:00" },
    ],
  }));
  writeFileSync(join(dir, "排程.json"), JSON.stringify({
    安靜時段: ["22:00-07:00", "12:00-13:00"],
    例行工作: [
      { 名稱: "晨報", 時間: "每個工作日 07:30", 要他做的事: "照 morning-brief 技能寫今天的晨報" },
      { 名稱: "覆盤", 時間: "每週五 17:00", 要他做的事: "照 weekly-review 技能做本週覆盤" },
    ],
  }));
  writeFileSync(join(dir, "固定會議.json"), JSON.stringify({
    固定會議: [{ 名稱: "研發會議", 時間: "每週五 13:30", 會前準備: 30, 會前提醒: 15, 例外: [] }],
  }));
  writeFileSync(join(dir, "情報.json"), JSON.stringify({ 關鍵字: ["機械手臂", "自動化展"], RSS: [] }));
  writeFileSync(join(dir, "通知.json"), JSON.stringify({ 重要信件: { 寄件人: ["@example.com"], 主旨關鍵字: ["報價"] } }));
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "data", "排程狀態.json"), JSON.stringify({
    "晨報｜每個工作日 07:30": "2026-10-09T07:30:12.000Z",
    "做過|晨報｜每個工作日 07:30": "2026-10-09T07:30:12.000Z", // 真的做過（「上次」只算這個）
    "覆盤｜每週五 17:00": "2026-10-09T00:00:00.000Z", // 看過但還沒做過
  }));
  mkdirSync(join(dir, "文件", "情報"), { recursive: true });
  writeFileSync(join(dir, "文件", "情報", "2026-10-09.md"), "# 標題\n\n- 10/9 08:00｜某新聞｜某報｜https://news.google.com/a｜機械手臂\n");
}

let started;
const startOnce = (t) => (started ??= t.startBridge({ module: t.module, fake: "status", timeoutMs: 60_000, prepare: settings }));
const statusText = (out) => t2(out, "狀態");
const t2 = (out, prefix) => out.split("\n").filter((line) => line.startsWith(`[0s] ${prefix}`)).map((line) => line.slice(5 + prefix.length)).join("\n");

export const checks = [
  {
    id: "Q4-7-01",
    name: "/status 的主動工作：提醒、待辦追蹤、例行工作（下次、上次）、固定會議、情報、重要信件都列出來",
    async run(t) {
      const { out } = await startOnce(t);
      const text = statusText(out);
      const problems = [
        !text.includes("主動工作（不用你開口，時間到我自己做）：") && `沒有「主動工作」區塊：\n${tail(out)}`,
        !text.includes("⏰ 提醒：2 件，最近一件 10/9（五）14:00「打給王經理」") && "提醒：應該是 2 件、最近一件 10/9 14:00 打給王經理",
        !text.includes("🕗 例行工作：2 件（國定假日不做；安靜時段 22:00-07:00、12:00-13:00 不打擾你）") && "例行工作：應該 2 件並列出假日與安靜時段",
        !/- 晨報：每個工作日 07:30，下次 10\/\d+（.）07:30，上次 10\/9（五）15:30/.test(text) && "晨報：要有下次與上次（上次只算真的做過的）",
        !/- 覆盤：每週五 17:00，下次 10\/9（五）17:00，還沒做過/.test(text) && "覆盤：看過但沒做過，要寫「還沒做過」",
        !/📅 固定會議：1 個/.test(text) && "固定會議：應該 1 個",
        !/- 研發會議：每週五 13:30，下一場 10\/9（五）13:30；會前 30 分鐘整理上次紀錄、會前 15 分鐘提醒/.test(text) && "固定會議：要有下一場與會前準備、提醒的分鐘數",
        !text.includes("📰 產業消息：追蹤 機械手臂、自動化展，每小時抓一次，今天 1 則") && "情報：要列關鍵字與今天幾則",
        !/✉️ (重要新信|Gmail：還沒授權)/.test(text) && "重要信件：要顯示（沒授權時顯示沒授權）",
        !text.includes("📝 待辦追蹤：開啟（09:30 起每 2 小時，18:00 收工清單，週末與國定假日不追）；今天 2 件，還沒完成 1 件（確認六家廠商的地址）") && "待辦追蹤：要顯示設定與今天還剩幾件",
        text.indexOf("⏰ 提醒") > text.indexOf("🕗 例行工作") && "順序：提醒要排在例行工作前面",
        text.indexOf("🕗 例行工作") > text.indexOf("📅 固定會議") && "順序：例行工作要排在固定會議前面",
        text.indexOf("📰 產業消息") < text.indexOf("📅 固定會議") && "順序：產業消息排最後",
      ].filter(Boolean);
      return problems.length === 0 ? pass(text.split("\n").filter((line) => /^[⏰🕗📅📰✉️🗓🏢　]/.test(line)).join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-7-02",
    name: "/status 其他：已經上班多久、電腦睡眠設定、沒有任何主動工作時說明",
    async run(t) {
      const { out } = await startOnce(t);
      const text = statusText(out);
      const empty = await t.startBridge({
        module: t.module, fake: "status", timeoutMs: 40_000,
        prepare(dir) {
          for (const file of ["提醒.json", "排程.json", "通知.json", "固定會議.json", "情報.json", "公司信箱.json"]) rmSync(join(dir, file), { force: true });
        },
      });
      const emptyText = statusText(empty.out);
      const problems = [
        !/已經上班：\d+ 分鐘（從 \d\d:\d\d 啟動；關掉重開會重新算）/.test(text) && `沒有「已經上班」：\n${text.slice(0, 300)}`,
        process.platform === "win32" && !/電腦睡眠：(插電時永不睡眠 ✅|⚠️ 插電時 \d+ 分鐘沒動就睡著)/.test(text) && "Windows 上應該顯示電腦睡眠設定",
        !emptyText.includes("⏰ 提醒：沒有") && "沒有提醒時要寫「沒有」",
        !emptyText.includes("🕗 例行工作：沒有") && "沒有例行工作時要寫「沒有」",
        !emptyText.includes("📅 固定會議：沒有") && "沒有固定會議時要寫「沒有」",
        !emptyText.includes("📰 產業消息：沒有追蹤任何關鍵字") && "沒有情報來源時要說明",
      ].filter(Boolean);
      return problems.length === 0 ? pass([text.split("\n").find((line) => line.startsWith("已經上班")), text.split("\n").find((line) => line.startsWith("電腦睡眠")) ?? "（非 Windows，不顯示睡眠設定）"].join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-7-03",
    name: "/status 不排隊、不呼叫模型、不顯示金鑰內容；某個設定檔壞掉也照樣回答",
    async run(t) {
      const { out } = await t.startBridge({
        module: t.module, fake: "status", timeoutMs: 40_000,
        prepare(dir) {
          settings(dir);
          writeFileSync(join(dir, "提醒.json"), "{ 這不是 JSON");
        },
      });
      const text = statusText(out);
      const problems = [
        !text.includes("⏰ 提醒：提醒.json 讀不懂") && `提醒.json 壞掉時應該說明，其他照常：\n${text.slice(0, 300) || tail(out)}`,
        !text.includes("🕗 例行工作：2 件") && "一個設定檔壞掉不應該影響其他的",
        out.includes("品檢：呼叫了 Gemini") && "/status 不應該呼叫模型",
        /fake-telegram-token|AIza/.test(text) && "/status 不應該顯示金鑰內容",
        !/GEMINI_API_KEY ✅|GEMINI_API_KEY —/.test(text) && "金鑰那行應該只顯示有沒有填",
      ].filter(Boolean);
      return problems.length === 0 ? pass(text.split("\n").filter((line) => /提醒|例行工作|金鑰/.test(line)).join("\n")) : fail(problems.join("\n"));
    },
  },
];

// ── 假 Telegram＋假 Gemini ─────────────────────────────────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });

export const fakes = {
  /** 假時鐘 2026-10-09（五）09:00；傳 /status，把回覆整段印出來。 */
  async status() {
    const RealDate = Date;
    const offset = new RealDate(2026, 9, 9, 9, 0).getTime() - RealDate.now();
    globalThis.Date = class extends RealDate {
      constructor(...args) { args.length ? super(...args) : super(RealDate.now() + offset); }
      static now() { return RealDate.now() + offset; }
    };
    let step = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        console.log("[0s] 品檢：呼叫了 Gemini");
        throw new TypeError("品檢：/status 不應該呼叫 Gemini");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      const body = JSON.parse(options.body ?? "{}");
      if (target.endsWith("/sendMessage")) {
        for (const line of body.text.split("\n")) console.log(`[0s] 狀態${line}`);
        setTimeout(() => { console.log("[0s] 品檢結束"); process.exit(0); }, 300);
        return ok({ message_id: 1 });
      }
      if (target.endsWith("/sendChatAction")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      step++;
      return step === 2 ? ok([{ update_id: 1, message: { text: "/status", from: { id: 1 }, chat: { id: 1 } } }]) : ok([]);
    };
  },
};
