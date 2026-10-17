// L4-5 索引式記憶的工程自檢（Q4-5-01～Q4-5-03）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L4-5）。
// 用假 Telegram／假 Gemini 啟動副本；假時鐘固定在 2026-10-03（六）08:00，日誌放 9/29、9/30、10/2 三份。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

const JOURNALS = {
  "2026-09-29": "# 2026-09-29 工作日誌\n\n## 今天做了什麼\n- 跟A公司開會，討論B專案的機械手臂電箱。\n\n## 產出的文件\n- （無）\n\n## 還沒完成的事\n- B專案：到現場勘查樓梯\n\n## 建議長期記住的事\n- （無）\n",
  "2026-09-30": "# 2026-09-30 工作日誌\n\n## 今天做了什麼\n- 回覆A公司的報價單。\n- 取消B專案的現場勘查。\n\n## 產出的文件\n- `文件/2026-09-30_報價單.md`\n\n## 還沒完成的事\n- A公司的報價單等對方回覆\n\n## 建議長期記住的事\n- （無）\n",
  "2026-10-02": "# 2026-10-02 工作日誌\n\n## 今天做了什麼\n- 新增技能 meeting-warmup。\n\n## 產出的文件\n- `.pi/skills/meeting-warmup/SKILL.md`\n\n## 還沒完成的事\n- （無）\n\n## 建議長期記住的事\n- （無）\n",
};

let started;
const startOnce = (t) => (started ??= t.startBridge({
  module: t.module, fake: "memory", timeoutMs: 60_000,
  prepare(dir) {
    for (const file of ["提醒.json", "排程.json", "通知.json", "固定會議.json", "情報.json"]) rmSync(join(dir, file), { force: true });
    mkdirSync(join(dir, "日誌"), { recursive: true });
    for (const [day, text] of Object.entries(JOURNALS)) writeFileSync(join(dir, "日誌", `${day}.md`), text);
  },
}));

export const checks = [
  {
    id: "Q4-5-01",
    name: "主題索引：啟動時補整理舊日誌，日期由程式填；主題含「：」也正確；/new 後加上今天",
    async run(t) {
      const { out } = await startOnce(t);
      const lines = t.scriptLines(out);
      const first = lines.find((line) => line.startsWith("索引第1版"))?.slice(6) ?? "";
      const after = lines.find((line) => line.startsWith("索引/new後"))?.slice(8) ?? "";
      const problems = [
        !first.includes("- A公司：2026-09-29、2026-09-30") && `「A公司」應該是 9/29、9/30：\n${first || tail(out)}`,
        !first.includes("- B專案：2026-09-29、2026-09-30") && "「B專案」應該是 9/29、9/30",
        !first.includes("- 技能：meeting-warmup：2026-10-02") && "主題「技能：meeting-warmup」應該完整保留、日期 10/2",
        first.indexOf("技能：meeting-warmup") > first.indexOf("- A公司") && "最近出現的主題（10/2）應該排在前面",
        !after.includes("- A公司：2026-09-29、2026-09-30、2026-10-03") && `/new 後今天（10/3）的日誌也要整理進去：\n${after || tail(out)}`,
        (out.match(/列出主題 2026-09-29/g) ?? []).length !== 1 && "9/29 的日誌沒改過，不應該重複整理",
      ].filter(Boolean);
      return problems.length === 0 ? pass(after.split(" ⏎ ").filter((line) => line.startsWith("- ")).join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-5-02",
    name: "月摘要：上個月（9 月）寫成 日誌/月摘要/2026-09.md，「月底還沒完成的事」照抄 9/30 的日誌",
    async run(t) {
      const { out } = await startOnce(t);
      const summary = t.scriptLines(out).find((line) => line.startsWith("月摘要檔"))?.slice(4) ?? "";
      const problems = [
        !summary.includes("# 2026-09 月摘要") && `沒有 日誌/月摘要/2026-09.md：\n${tail(out)}`,
        !summary.includes("## 重要決定與結果") && "缺「重要決定與結果」",
        !summary.includes("## 月底還沒完成的事 ⏎  ⏎ - A公司的報價單等對方回覆") && `「月底還沒完成的事」應該照抄 9/30 的日誌：\n${summary}`,
        summary.includes("到現場勘查樓梯") && "已經取消的待辦（9/29 的勘查）不應該出現",
        out.includes("要求月摘要 2026-10") && "這個月（10 月）還沒結束，不應該做摘要",
      ].filter(Boolean);
      return problems.length === 0 ? pass(summary.split(" ⏎ ").filter(Boolean).slice(0, 4).join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-5-03",
    name: "system prompt 附上主題索引，並說明先查索引、查不到再 grep",
    async run(t) {
      const { out } = await startOnce(t);
      const line = t.scriptLines(out).find((text) => text.startsWith("prompt")) ?? "";
      const fine = line.includes("索引:有") && line.includes("先查索引:有") && line.includes("A公司:有");
      return fine ? pass(line) : fail(`system prompt 沒有主題索引：${line || tail(out)}`);
    },
  },
];

// ── 假 Telegram＋假 Gemini（在副本裡、秘書啟動前載入）──────────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (text) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const TOPICS = {
  "2026-09-29": "- A公司\n- B專案",
  "2026-09-30": "- A公司\n- B專案\n- 報價單",
  "2026-10-02": "- 技能：meeting-warmup",
  "2026-10-03": "- A公司",
};

export const fakes = {
  async memory() {
    // 假時鐘：2026-10-03（六）08:00
    const RealDate = Date;
    const offset = new RealDate(2026, 9, 3, 8, 0).getTime() - RealDate.now();
    globalThis.Date = class extends RealDate {
      constructor(...args) { args.length ? super(...args) : super(RealDate.now() + offset); }
      static now() { return RealDate.now() + offset; }
    };
    const show = (file) => { try { return readFileSync(file, "utf8").replace(/\n/g, " ⏎ "); } catch { return "（沒有）"; } };
    let step = 0, done = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse(options.body);
        const said = (body.contents ?? []).filter((item) => item.role === "user").at(-1)?.parts.map((part) => part.text ?? "").join("") ?? "";
        if (said.includes("【系統指令：列出主題】")) {
          const day = said.match(/這份日誌的日期是 (\d{4}-\d{2}-\d{2})/)?.[1];
          console.log(`[0s] 列出主題 ${day}`);
          return sse(TOPICS[day] ?? "- 其他");
        }
        if (said.includes("【系統指令：整理月摘要】")) {
          console.log(`[0s] 要求月摘要 ${said.match(/以下是 (\d{4}-\d{2}) 的所有工作日誌/)?.[1]}`);
          return sse("## 重要決定與結果\n- 回覆A公司的報價單；取消B專案的現場勘查\n\n## 往來的人與公司\n- A公司\n\n## 產出的文件\n- 文件/2026-09-30_報價單.md");
        }
        if (said.includes("【系統指令：整理工作日誌】")) {
          return sse("# 2026-10-03 工作日誌\n\n## 今天做了什麼\n- 跟A公司確認報價。\n\n## 產出的文件\n- （無）\n\n## 還沒完成的事\n- （無）\n\n## 建議長期記住的事\n- （無）");
        }
        const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
        console.log(`[0s] prompt 索引:${system.includes("以下是主題索引") ? "有" : "無"}、先查索引:${system.includes("先在索引找日期") && system.includes("再用 grep") ? "有" : "無"}、A公司:${system.includes("- A公司：2026-09-29") ? "有" : "無"}`);
        return sse("你好");
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      const body = JSON.parse(options.body ?? "{}");
      if (target.endsWith("/sendMessage")) {
        if (step === 1 && !done) {
          console.log(`[0s] 索引第1版 ${show("日誌/索引.md")}`);
          console.log(`[0s] 月摘要檔 ${show("日誌/月摘要/2026-09.md")}`);
        }
        if (body.text.includes("今天先到這")) {
          done = true;
          setTimeout(() => {
            console.log(`[0s] 索引/new後 ${show("日誌/索引.md")}`);
            console.log("[0s] 品檢結束");
            process.exit(0);
          }, 300);
        }
        return ok({ message_id: 1 });
      }
      if (target.endsWith("/sendChatAction")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      step++;
      if (step === 1) return ok([{ update_id: 1, message: { text: "你好", from: { id: 1 }, chat: { id: 1 } } }]);
      if (step === 8) return ok([{ update_id: 2, message: { text: "/new", from: { id: 1 }, chat: { id: 1 } } }]);
      return ok([]);
    };
  },
};
