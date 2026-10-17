// L4-1 提醒的工程自檢（Q4-1-01～Q4-1-08）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L4-1）。
// 外掛的時間計算在子程式裡用固定時鐘測（2026-10-03 21:30 星期六）；主程式的部分用假 Telegram／假 Gemini 啟動副本。
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");
const PLUGIN = "外掛/提醒/index.mjs";

/** 副本會帶到使用者真的設定（提醒、排程、通知、固定會議），測試從空白開始；不清掉的話，固定會議會去抓假日資料、打亂假 Telegram 的劇本。 */
const cleanUserFiles = (dir) => { for (const file of ["提醒.json", "排程.json", "通知.json", "固定會議.json", "情報.json"]) rmSync(join(dir, file), { force: true }); };

/** 在副本裡跑 unit(name)：固定時鐘、匯入提醒外掛，印出 JSON 結果。 */
async function unit(t, name) {
  const dir = t.makeCopy();
  cleanUserFiles(dir);
  try {
    const code = [
      `const RealDate = Date; let offset = new RealDate(2026, 9, 3, 21, 30).getTime() - RealDate.now();`,
      `class FakeDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } }`,
      `globalThis.Date = FakeDate; globalThis.__setNow = (...a) => { offset = new RealDate(...a).getTime() - RealDate.now(); };`,
      `const { units } = await import(${JSON.stringify(pathToFileURL(join(dir, "品檢", "L4-1.mjs")).href)});`,
      `console.log("結果:" + JSON.stringify(await units[${JSON.stringify(name)}](${JSON.stringify(dir)})));`,
    ].join("\n");
    const { out } = await t.run(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, env: t.fakeEnv(), timeoutMs: 60_000 });
    const line = out.split("\n").find((text) => text.startsWith("結果:"));
    if (!line) throw new Error(`子程式沒有結果：\n${tail(out)}`);
    return JSON.parse(line.slice(3));
  } finally {
    t.removeCopy(dir);
  }
}

/** 用 out 裡的 [檢查] 行判斷：全部 ✅ 才合格。 */
function verdict(results) {
  const bad = results.filter((item) => !item.ok);
  const text = results.map((item) => `${item.ok ? "✅" : "❌"} ${item.what}${item.ok ? "" : `：${item.got}`}`).join("\n");
  return bad.length === 0 ? pass(text) : fail(text);
}

export const checks = [
  {
    id: "Q4-1-01",
    name: "提醒外掛：三個工具、權限等級、定時工作",
    async run(t) {
      return verdict(await unit(t, "load"));
    },
  },
  {
    id: "Q4-1-02",
    name: "設定提醒：時間換算與檢查（現在 10/3（六）21:30）",
    async run(t) {
      return verdict(await unit(t, "add"));
    },
  },
  {
    id: "Q4-1-03",
    name: "時間到：送出、刪除或排下一次、錯過補發只補一次",
    async run(t) {
      return verdict(await unit(t, "tick"));
    },
  },
  {
    id: "Q4-1-04",
    name: "列出與取消；提醒.json 壞掉時不覆寫",
    async run(t) {
      return verdict(await unit(t, "listCancel"));
    },
  },
  {
    id: "Q4-1-05",
    name: "主程式：一啟動就補發錯過的提醒，只發給白名單第一個 ID",
    async run(t) {
      const { out } = await t.startBridge({
        module: t.module, fake: "missed", env: { TELEGRAM_ALLOWED_USERS: "7,1" }, timeoutMs: 70_000,
        prepare(dir) {
          cleanUserFiles(dir);
          const pad = (value) => String(value).padStart(2, "0");
          const local = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
          const hourAgo = new Date(Date.now() - 3_600_000), tomorrow = new Date(Date.now() + 86_400_000);
          writeFileSync(join(dir, "提醒.json"), JSON.stringify({ 提醒: [
            { 編號: 1, 內容: "打給王經理", 下次: local(hourAgo) },
            { 編號: 2, 內容: "明天的事", 下次: local(tomorrow) },
          ] }));
        },
      });
      const lines = t.scriptLines(out);
      const owner = out.includes("主動訊息發給：7（TELEGRAM_ALLOWED_USERS 的第一個）");
      const sent = lines.filter((line) => line.startsWith("送出"));
      const reminder = sent.find((line) => line.includes("⏰ 提醒：打給王經理"));
      const problems = [
        !owner && "啟動時沒有印出「主動訊息發給：7」",
        !reminder && "沒有補發「⏰ 提醒：打給王經理」",
        reminder && !reminder.startsWith("送出 chat=7 ") && `發錯人：${reminder}`,
        reminder && !/原定 \d+\/\d+（.）\d\d:\d\d，那時秘書沒有在執行，現在補發/.test(reminder) && "補發的提醒沒有註明原定時間",
        sent.some((line) => line.includes("明天的事")) && "還沒到的提醒被送出去了",
        sent.length !== 1 && `應只送 1 則，實際 ${sent.length} 則`,
        !lines.some((line) => line.includes("提醒.json 剩下：2")) && `送出後提醒.json 應只剩編號 2：${lines.find((line) => line.includes("提醒.json 剩下")) ?? "（沒讀到）"}`,
        out.includes("品檢：呼叫了 Gemini") && "補發提醒不應該呼叫 Gemini",
      ].filter(Boolean);
      return problems.length === 0 ? pass([...lines.filter((line) => /送出|剩下/.test(line))].join("\n")) : fail(`${problems.join("\n")}\n${tail(out)}`);
    },
  },
  {
    id: "Q4-1-06",
    name: "system prompt：有提醒外掛才說會提醒；拿掉提醒（與例行工作）外掛就恢復「不會主動發訊息」",
    async run(t) {
      const clean = cleanUserFiles;
      const withPlugin = await t.startBridge({ module: t.module, fake: "prompt", timeoutMs: 70_000, prepare: clean });
      const without = await t.startBridge({
        module: t.module, fake: "prompt", timeoutMs: 70_000,
        prepare(dir) {
          clean(dir);
          // 例行工作（L4-2）也會改那一句，所以兩個都拿掉
          for (const name of ["提醒", "例行工作"]) rmSync(join(dir, "外掛", name), { recursive: true, force: true });
        },
      });
      const read = (out) => t.scriptLines(out).find((line) => line.startsWith("prompt"));
      const a = read(withPlugin.out) ?? "", b = read(without.out) ?? "";
      const problems = [
        !a.includes("add_reminder:有") && `有外掛時 Gemini 沒收到 add_reminder 工具：${a || tail(withPlugin.out)}`,
        !a.includes("舊句:無") && "有外掛時 system prompt 還有「你不會主動發訊息」",
        !a.includes("提醒說明:有") && "有外掛時 system prompt 沒有提醒的說明",
        !b.includes("add_reminder:無") && `拿掉外掛後 Gemini 還收到 add_reminder：${b || tail(without.out)}`,
        !b.includes("舊句:有") && "拿掉外掛後 system prompt 沒有「你不會主動發訊息」",
      ].filter(Boolean);
      return problems.length === 0 ? pass(`有外掛：${a}\n拿掉外掛：${b}`) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-1-07",
    name: "事件紀錄：被擋下時記進 data/事件紀錄.jsonl",
    async run(t) {
      const { out } = await t.startBridge({ module: t.module, fake: "blocked", timeoutMs: 70_000, prepare: cleanUserFiles });
      const event = t.scriptLines(out).find((line) => line.startsWith("事件"));
      if (!event) return fail(`沒有事件紀錄：\n${tail(out)}`);
      const record = JSON.parse(event.slice(3));
      const fine = record.種類 === "擋下" && record.工具 === "write" && /bridge\.mjs/.test(record.原因) && !isNaN(new Date(record.時間));
      return fine ? pass(event) : fail(`事件紀錄內容不對：${event}`);
    },
  },
  {
    id: "Q4-1-09",
    name: "待辦追蹤：清單從日誌帶出來、每 2 小時提醒沒回報的、回報後不再提醒、收工清單、擱置今天不再提醒",
    async run(t) {
      return verdict(await unit(t, "todos"));
    },
  },
  {
    id: "Q4-1-08",
    name: "主程式：時間標記附這週日期；「這週X」已經過了，訊息後面附提示",
    async run(t) {
      return verdict(await unit(t, "week"));
    },
  },
];

// ── 外掛的單元測試（在子程式裡、固定時鐘下執行）────────────────────────────
let journalTodos = { day: "2026-10-02", items: [] }; // 主程式給的「最新一份日誌的還沒完成的事」

async function loadPlugin(dir) {
  const module = await import(pathToFileURL(join(dir, PLUGIN)).href);
  const tools = new Map();
  const notes = new Map();
  const sent = [];
  const bridge = {
    root: dir,
    setReplyNote: (key, text) => notes.set(key, text),
    notify: async (text) => { sent.push(text); },
    journalTodos: () => journalTodos,
  };
  module.default({ registerTool: (tool) => tools.set(tool.name, tool) }, bridge);
  const call = async (name, input) => {
    try {
      const result = await tools.get(name).execute("id", input);
      return { ok: true, text: result.content[0].text };
    } catch (error) {
      return { ok: false, text: error.message };
    }
  };
  const file = () => JSON.parse(readFileSync(join(dir, "提醒.json"), "utf8")).提醒;
  return { module, tools, notes, sent, bridge, call, file };
}
const check = (what, ok, got) => ({ what, ok: Boolean(ok), got: typeof got === "string" ? got : JSON.stringify(got) });

/** 從副本的 bridge.mjs 取出 nowLabel、pastWeekdayHint 兩個函式（bridge.mjs 一匯入就會啟動，不能直接 import）。 */
function weekFunctions(dir) {
  const code = readFileSync(join(dir, "bridge.mjs"), "utf8");
  const nowLabel = code.match(/function nowLabel\([\s\S]*?\n}\n/)?.[0];
  const hint = code.match(/function pastWeekdayHint\([\s\S]*?\n}\n/)?.[0];
  if (!nowLabel || !hint) return null;
  return new Function(`
    const pad = (value) => String(value).padStart(2, "0");
    const formatDate = (date) => \`\${date.getFullYear()}-\${pad(date.getMonth() + 1)}-\${pad(date.getDate())}\`;
    ${nowLabel}
    ${hint}
    return { nowLabel, pastWeekdayHint };`)();
}

export const units = {
  async todos(dir) {
    // 假日清單要在外掛第一次載入前就寫好（程式只讀一次存檔）；10/9（五）是國慶日補假
    writeFileSync(join(dir, "data", "台灣假日.json"), JSON.stringify({
      不要重抓: true, 國定假日: { "2026-10-09": "中華民國國慶日 補假" },
    }));
    journalTodos = { day: "2026-10-02", items: ["確認六家廠商的地址", "交週報", "打給王經理"] };
    const { module, bridge, sent, notes, call } = await loadPlugin(dir);
    const file = () => JSON.parse(readFileSync(join(dir, "待辦.json"), "utf8"));
    const results = [];
    // 現在是 2026-10-03（六）21:30（unit 的固定時鐘）
    await module.tick(bridge);
    results.push(check("還沒打開追蹤：什麼都不做", sent.length === 0 && !existsSync(join(dir, "待辦.json")),
      { 送出: [...sent], 有待辦json: existsSync(join(dir, "待辦.json")) })); // got 不要直接傳 sent，那個陣列後面會被清掉
    // 10/3（六）是週末：打開也不追，說明要講清楚
    const weekend = await call("track_todos", { on: true, start: "09:30", every_hours: 2, end: "18:00" });
    results.push(check("週末打開：說明「今天放假（週末），不提醒；下個上班日 09:30 開始」",
      weekend.ok && /今天放假（週末），不提醒；下個上班日 09:30 開始/.test(weekend.text), weekend.text));
    await module.tick(bridge);
    results.push(check("週末不提醒、不給收工清單", sent.length === 0, sent));
    await call("track_todos", { on: false });
    // 10/2（五）21:30：上班日的晚上打開，不該馬上補發今天 17:30 那次與收工清單
    globalThis.__setNow(2026, 9, 2, 21, 30);
    const late = await call("track_todos", { on: true, start: "09:30", every_hours: 2, end: "18:00" });
    results.push(check("上班日晚上打開：說明「今天的時間都過了，明天 09:30 開始」", late.ok && /今天的時間都過了，明天 09:30 開始/.test(late.text), late.text));
    await module.tick(bridge);
    results.push(check("晚上打開後不補發今天過掉的提醒與收工清單", sent.length === 0, sent));
    await call("track_todos", { on: false });
    globalThis.__setNow(2026, 9, 5, 8, 0); // 回到 10/5（一）08:00 再打開，照正常流程測
    const on = await call("track_todos", { on: true, start: "09:30", every_hours: 2, end: "18:00" });
    results.push(check("打開追蹤：回覆說明時間，寫進 待辦.json",
      on.ok && file().追蹤.開啟 === true && file().追蹤.從幾點開始 === "09:30" && notes.get("待辦追蹤") === "📝 待辦追蹤：已打開（09:30 起每 2 小時，18:00 給收工清單，週末與國定假日不追）；下次提醒：今天 09:30", on.text));
    results.push(check("早上打開：說明「下次提醒：今天 09:30」", /下次提醒：今天 09:30/.test(on.text), on.text));
    globalThis.__setNow(2026, 9, 5, 9, 0); // 10/5（一）09:00：還沒到第一個時間點
    await module.tick(bridge);
    results.push(check("09:00 還沒到 09:30，不提醒", sent.length === 0, sent));
    globalThis.__setNow(2026, 9, 5, 9, 31);
    await module.tick(bridge);
    results.push(check("09:31：清單從日誌帶出 3 件，提醒「還沒完成（09:30，3 件）」",
      sent.length === 1 && sent[0].startsWith("📝 還沒完成（09:30，3 件）") && sent[0].includes("1. 確認六家廠商的地址") && sent[0].includes("3. 打給王經理"), sent));
    results.push(check("待辦.json 記下日期與來源", file().日期 === "2026-10-05" && file().來源 === "日誌/2026-10-02.md 的「還沒完成的事」", file()));
    globalThis.__setNow(2026, 9, 5, 10, 30);
    await module.tick(bridge);
    results.push(check("同一個時間點不重複提醒", sent.length === 1, sent));
    const done = await call("update_todo", { which: "1", status: "已完成" });
    results.push(check("回報第 1 件完成：狀態改掉、回覆附「📝 …待辦 → 已完成（今天還剩 2 件沒完成）」",
      done.ok && file().待辦[0].狀態 === "已完成" && notes.get("待辦確認六家廠商的地址") === "📝 「確認六家廠商的地址」待辦 → 已完成（今天還剩 2 件沒完成）", notes.get("待辦確認六家廠商的地址")));
    const hold = await call("update_todo", { which: "週報", status: "擱置" });
    results.push(check("用關鍵字回報擱置", hold.ok && file().待辦[1].狀態 === "擱置", hold.text));
    globalThis.__setNow(2026, 9, 5, 11, 31);
    await module.tick(bridge);
    results.push(check("11:30：只提醒還沒回報的那 1 件（完成、擱置的不列）",
      sent.length === 2 && sent[1].startsWith("📝 還沒完成（11:30，1 件）") && sent[1].includes("1. 打給王經理") && !sent[1].includes("交週報"), sent));
    const added = await call("add_todo", { text: "臨時加的事" });
    results.push(check("臨時加一件：今天共 2 件沒完成", added.ok && file().待辦.length === 4 && /今天還有 2 件沒完成/.test(added.text), added.text));
    await call("update_todo", { which: "打給王經理", status: "已完成" });
    await call("update_todo", { which: "臨時加的事", status: "已完成" });
    globalThis.__setNow(2026, 9, 5, 13, 31);
    await module.tick(bridge);
    results.push(check("全部回報完了：13:30 不提醒", sent.length === 2, sent.slice(2)));
    globalThis.__setNow(2026, 9, 5, 18, 1);
    await module.tick(bridge);
    const closing = sent.at(-1);
    results.push(check("18:00 收工清單：完成 3 件、擱置 1 件、沒有還沒完成的",
      sent.length === 3 && closing.startsWith("🌆 今天收工了（18:00）") && closing.includes("✅ 完成 3 件") && closing.includes("⏸ 擱置 1 件：交週報") && closing.includes("今天的待辦都回報完了"), closing));
    await module.tick(bridge);
    results.push(check("收工清單一天只給一次", sent.length === 3, sent.slice(3)));
    // 新的一天：清單重來，擱置的會再出現（日誌還沒整理，所以還在）
    globalThis.__setNow(2026, 9, 6, 9, 31);
    await module.tick(bridge);
    results.push(check("隔天 09:30：清單重新從日誌列，擱置過的又出現",
      sent.length === 4 && sent[3].startsWith("📝 還沒完成（09:30，3 件）") && sent[3].includes("交週報"), sent.at(-1)));
    const list = await call("list_todos", {});
    results.push(check("list_todos 列出狀態與追蹤設定", list.ok && /1\. \[待辦\] 確認六家廠商的地址/.test(list.text) && /追蹤中：09:30 起每 2 小時提醒，18:00 收工清單/.test(list.text), list.text));
    const off = await call("track_todos", { on: false });
    globalThis.__setNow(2026, 9, 6, 11, 31);
    await module.tick(bridge);
    results.push(check("關掉追蹤後不再提醒", off.ok && sent.length === 4, sent.slice(4)));
    // 國定假日（含補假）也不追
    const holiday = await loadPlugin(dir);
    globalThis.__setNow(2026, 9, 8, 8, 0); // 10/8（四）先打開
    await holiday.call("track_todos", { on: true, start: "09:30", every_hours: 2, end: "18:00" });
    globalThis.__setNow(2026, 9, 9, 9, 31); // 10/9（五）補假
    await holiday.module.tick(holiday.bridge);
    globalThis.__setNow(2026, 9, 9, 18, 1);
    await holiday.module.tick(holiday.bridge);
    results.push(check("國定假日補假：不提醒、也不給收工清單", holiday.sent.length === 0, holiday.sent));
    results.push(check("/status 寫「今天放假（中華民國國慶日 補假），不提醒」",
      holiday.module.status(holiday.bridge).includes("📝 待辦追蹤：開啟（09:30 起每 2 小時，18:00 收工清單，週末與國定假日不追）；今天放假（中華民國國慶日 補假），不提醒"),
      holiday.module.status(holiday.bridge)));
    globalThis.__setNow(2026, 9, 12, 9, 31); // 10/12（一）上班日：回來照常提醒
    await holiday.module.tick(holiday.bridge);
    results.push(check("10/12（一）上班日：照常提醒", holiday.sent.length === 1 && holiday.sent[0].startsWith("📝 還沒完成（09:30，"), holiday.sent));
    return results;
  },

  async week(dir) {
    const fns = weekFunctions(dir);
    if (!fns) return [check("bridge.mjs 有 nowLabel 與 pastWeekdayHint", false, "找不到這兩個函式")];
    const sunday = new Date(2026, 9, 4, 7, 56), wednesday = new Date(2026, 9, 7, 10, 0);
    return [
      check("星期日的時間標記：這週 9/28（一）～10/4（日），下週 10/5（一）～10/11（日）",
        fns.nowLabel(sunday) === "2026-10-04 07:56（星期日）；這週是 9/28（一）～10/4（日），下週是 10/5（一）～10/11（日）", fns.nowLabel(sunday)),
      check("星期日說「這週六」→ 提示 10/3 已過、問是不是 10/10",
        fns.pastWeekdayHint("我這週六下午要去好市多", sunday) === "\n【系統提醒：只給你看，不要照抄給使用者】「這週六」是 10/3（六），已經過了。請用你自己的話問使用者是不是指下週的 10/10（六）；他確認之前不要用工具去做。",
        fns.pastWeekdayHint("我這週六下午要去好市多", sunday)),
      check("「本週五」「這禮拜一」也比對得到", /10\/2（五）/.test(fns.pastWeekdayHint("本週五交報告", sunday)) && /9\/28（一）/.test(fns.pastWeekdayHint("這禮拜一的會", sunday)),
        fns.pastWeekdayHint("本週五交報告、這禮拜一的會", sunday)),
      check("星期日說「這週日」（今天）不提示", fns.pastWeekdayHint("這週日晚上", sunday) === "", fns.pastWeekdayHint("這週日晚上", sunday)),
      check("星期三說「這週五」（還沒到）不提示", fns.pastWeekdayHint("這週五下午三點", wednesday) === "", fns.pastWeekdayHint("這週五下午三點", wednesday)),
      check("「下週六」不提示", fns.pastWeekdayHint("下週六下午三點", sunday) === "", fns.pastWeekdayHint("下週六下午三點", sunday)),
    ];
  },


  async load(dir) {
    const { module, tools } = await loadPlugin(dir);
    return [
      check("註冊 add_reminder、list_reminders、cancel_reminder", ["add_reminder", "list_reminders", "cancel_reminder"].every((name) => tools.has(name)), [...tools.keys()]),
      check("等級：設定、取消＝擬稿，列出＝查閱", module.levels.add_reminder === "擬稿" && module.levels.cancel_reminder === "擬稿" && module.levels.list_reminders === "查閱", module.levels),
      check("匯出 tick（主程式每 30 秒呼叫）", typeof module.tick === "function", typeof module.tick),
      check("prompt 有說明時間要先問清楚", /先問使用者/.test(module.prompt), module.prompt),
    ];
  },

  async add(dir) {
    const { call, notes, file } = await loadPlugin(dir);
    const results = [];
    const once = await call("add_reminder", { text: "打給王經理", at: "2026-10-04T15:00" });
    results.push(check("一次性：10/4 15:00 設定成功", once.ok && file()[0].下次 === "2026-10-04T15:00", once.text));
    results.push(check("回覆最後由程式附上「⏰ 已設定提醒 10/4（日）15:00「打給王經理」（目前共 1 件提醒）」",
      notes.get("提醒1") === "⏰ 已設定提醒 10/4（日）15:00「打給王經理」（目前共 1 件提醒）", notes.get("提醒1")));
    const repeats = [
      ["每週一 09:00", "2026-10-05T09:00"],
      ["每個工作日 17:30", "2026-10-05T17:30"],
      ["每天 08:00", "2026-10-04T08:00"],
      ["每天 22:00", "2026-10-03T22:00"],
      ["每月1日 09:00", "2026-11-01T09:00"],
      ["每月31日 09:00", "2026-10-31T09:00"],
      ["每週六 21:00", "2026-10-10T21:00"],
    ];
    for (const [repeat, expected] of repeats) {
      const result = await call("add_reminder", { text: repeat, repeat });
      const item = file().find((entry) => entry.內容 === repeat);
      results.push(check(`循環「${repeat}」下一次是 ${expected}`, result.ok && item?.下次 === expected, item?.下次 ?? result.text));
    }
    const rejects = [
      [{ text: "已經過了", at: "2026-10-03T15:00" }, /已經過了/],
      [{ text: "格式錯", at: "明天下午三點" }, /格式不對/],
      [{ text: "不存在的日期", at: "2026-02-30T09:00" }, /格式不對/],
      [{ text: "兩個都填", at: "2026-10-04T15:00", repeat: "每天 08:00" }, /只能填一個/],
      [{ text: "都沒填" }, /要填一個/],
      [{ text: "看不懂的循環", repeat: "每兩週 09:00" }, /看不懂/],
      [{ text: "" , at: "2026-10-04T15:00" }, /空的/],
    ];
    for (const [input, wanted] of rejects) {
      const result = await call("add_reminder", input);
      results.push(check(`擋下：${input.text || "（空白內容）"}`, !result.ok && wanted.test(result.text), result.text));
    }
    results.push(check("擋下的都沒有寫進提醒.json", file().length === 1 + repeats.length, file().length));
    return results;
  },

  async tick(dir) {
    const { module, bridge, sent, file } = await loadPlugin(dir);
    const results = [];
    writeFileSync(join(dir, "提醒.json"), JSON.stringify({ 說明: "測試", 提醒: [
      { 編號: 1, 內容: "準時的", 下次: "2026-10-03T21:29" },
      { 編號: 2, 內容: "錯過的", 下次: "2026-10-03T15:00" },
      { 編號: 3, 內容: "交週報", 下次: "2026-09-21T09:00", 重複: "每週一 09:00" },
      { 編號: 4, 內容: "還沒到", 下次: "2026-10-04T09:00" },
    ] }));
    await module.tick(bridge);
    results.push(check("準時的：「⏰ 提醒：準時的」（晚 1 分鐘不註明）", sent.includes("⏰ 提醒：準時的"), sent));
    results.push(check("錯過的：註明原定 10/3（六）15:00", sent.includes("⏰ 提醒：錯過的\n（原定 10/3（六）15:00，那時秘書沒有在執行，現在補發）"), sent));
    const weekly = sent.filter((text) => text.includes("交週報"));
    results.push(check("循環錯過兩週只補發一次", weekly.length === 1 && weekly[0].startsWith("⏰ 提醒：交週報（每週一 09:00）\n（原定 9/21（一）09:00"), weekly));
    results.push(check("還沒到的不送", !sent.some((text) => text.includes("還沒到")), sent));
    const left = file();
    results.push(check("一次性的送出後刪掉；循環的排到 10/5 09:00；還沒到的留著",
      left.length === 2 && left.find((item) => item.編號 === 3)?.下次 === "2026-10-05T09:00" && left.some((item) => item.編號 === 4), left));
    results.push(check("提醒.json 的「說明」保留", JSON.parse(readFileSync(join(dir, "提醒.json"), "utf8")).說明 === "測試", "說明不見了"));
    sent.length = 0;
    await module.tick(bridge);
    results.push(check("再跑一次不會重複送", sent.length === 0, sent));
    globalThis.__setNow(2026, 9, 5, 9, 0, 30);
    await module.tick(bridge);
    results.push(check("10/5 09:00 到了，循環提醒照常送出（準時、不註明補發）", sent.includes("⏰ 提醒：交週報（每週一 09:00）"), sent));
    results.push(check("10/4 09:00 那則同時補發", sent.some((text) => text.startsWith("⏰ 提醒：還沒到\n（原定 10/4（日）09:00")), sent));
    results.push(check("送出後排到 10/12 09:00", file().find((item) => item.編號 === 3)?.下次 === "2026-10-12T09:00", file()));
    // 代號只增不減：1、2、4 都送掉、只剩 3，新的提醒要是代號 5，不能重用 1；顯示的件數是 2
    const { call } = await loadPlugin(dir);
    const added = await call("add_reminder", { text: "新的", at: "2026-10-06T10:00" });
    results.push(check("送出後的代號不重用（新提醒是代號 5）、件數是 2", added.ok && added.text.includes("〔代號 5〕") && added.text.includes("目前共 2 件提醒"), added.text));
    return results;
  },

  async listCancel(dir) {
    const { call, notes, file, module, bridge, sent } = await loadPlugin(dir);
    const results = [];
    const empty = await call("list_reminders", {});
    results.push(check("沒有提醒時說「目前沒有提醒」", empty.ok && empty.text === "目前沒有提醒。", empty.text));
    await call("add_reminder", { text: "晚一點的", at: "2026-10-06T10:00" });
    await call("add_reminder", { text: "早一點的", at: "2026-10-04T08:00" });
    const list = await call("list_reminders", {});
    results.push(check("依時間排成 1、2，附件數與代號", list.ok &&
      list.text === "目前共 2 件提醒：\n1. 10/4（日）08:00「早一點的」〔代號 2〕\n2. 10/6（二）10:00「晚一點的」〔代號 1〕", list.text));
    const cancel = await call("cancel_reminder", { id: 1 });
    results.push(check("取消代號 1 後只剩代號 2，回覆附「🗑️ 已取消提醒 …（還剩 1 件）」", cancel.ok && file().length === 1 && file()[0].編號 === 2 &&
      notes.get("提醒1") === "🗑️ 已取消提醒 10/6（二）10:00「晚一點的」（還剩 1 件）", notes.get("提醒1")));
    const missing = await call("cancel_reminder", { id: 99 });
    const after = await call("add_reminder", { text: "取消後新增", at: "2026-10-08T10:00" });
    results.push(check("取消後的代號不重用：新提醒是代號 3", after.ok && after.text.includes("〔代號 3〕"), after.text));
    results.push(check("取消不存在的代號會說找不到", !missing.ok && /找不到代號 99/.test(missing.text), missing.text));
    // 使用者手動改壞其中一筆：其他照常、壞的原樣保留
    writeFileSync(join(dir, "提醒.json"), JSON.stringify({ 提醒: [{ 編號: 2, 內容: "早一點的", 下次: "2026-10-04T08:00" }, { 編號: 5, 內容: "壞的", 下次: "明天" }] }));
    const add = await call("add_reminder", { text: "新的", at: "2026-10-07T09:00" });
    results.push(check("有一筆壞掉時仍能新增（代號跳過壞掉那筆的 5），壞的那筆原樣留著",
      add.ok && add.text.includes("〔代號 6〕") && file().some((item) => item.下次 === "明天") && file().length === 3, add.text));
    // 整個檔案壞掉：工具說明原因、不覆寫；tick 不送也不覆寫
    writeFileSync(join(dir, "提醒.json"), "{ 這不是 JSON");
    const broken = await call("add_reminder", { text: "壞檔", at: "2026-10-07T09:00" });
    await module.tick(bridge);
    results.push(check("提醒.json 壞掉：設定時說明原因、檔案沒被覆寫、tick 不送", !broken.ok && /格式壞掉/.test(broken.text) &&
      readFileSync(join(dir, "提醒.json"), "utf8") === "{ 這不是 JSON" && sent.length === 0, broken.text));
    return results;
  },
};

// ── 假 Telegram＋假 Gemini 劇本（在副本裡、秘書啟動前載入）─────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (part) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
const finish = (delay) => setTimeout(() => { console.log("[0s] 品檢結束"); process.exit(0); }, delay);

export const fakes = {
  /** 提醒.json 裡有一則一小時前就該送的提醒：秘書一啟動就要補發給主人，不經 Gemini。 */
  async missed() {
    let started = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        console.log("[0s] 品檢：呼叫了 Gemini");
        throw new TypeError("品檢：不應該呼叫 Gemini");
      }
      const body = JSON.parse(options.body);
      if (target.endsWith("/sendMessage")) {
        console.log(`[0s] 送出 chat=${body.chat_id} ${body.text.replace(/\n/g, " ⏎ ")}`);
        return ok({ message_id: 1 });
      }
      if (!started) {
        started = true;
        setTimeout(() => {
          const left = JSON.parse(readFileSync("提醒.json", "utf8")).提醒.map((item) => item.編號);
          console.log(`[0s] 提醒.json 剩下：${left.join("、")}`);
          finish(0);
        }, 3000);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      return ok([]);
    };
  },

  /** 使用者傳一句話，看 Gemini 收到的工具與 system prompt。 */
  async prompt() {
    let sent = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse(options.body);
        const system = (body.systemInstruction?.parts ?? []).map((part) => part.text ?? "").join("");
        const tools = JSON.stringify(body.tools ?? []);
        console.log(`[0s] prompt add_reminder:${tools.includes("add_reminder") ? "有" : "無"}、` +
          `舊句:${system.includes("你不會主動發訊息") ? "有" : "無"}、提醒說明:${system.includes("用 add_reminder 設定") ? "有" : "無"}`);
        finish(500);
        return sse({ text: "你好" });
      }
      if (target.endsWith("/sendMessage") || target.endsWith("/sendChatAction")) return ok({ message_id: 1 });
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (sent) return ok([]);
      sent = true;
      return ok([{ update_id: 1, message: { text: "你好", from: { id: 1 }, chat: { id: 1 } } }]);
    };
  },

  /** 模型想改 bridge.mjs → 權限擋下 → 事件紀錄要有一筆「擋下」。 */
  async blocked() {
    let sent = false, calls = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        if (++calls === 1) return sse({ functionCall: { name: "write", args: { path: "bridge.mjs", content: "x" } } });
        return sse({ text: "我沒有權限改 bridge.mjs。" });
      }
      if (target.endsWith("/sendMessage")) {
        setTimeout(() => {
          for (const line of readFileSync("data/事件紀錄.jsonl", "utf8").trim().split("\n")) console.log(`[0s] 事件 ${line}`);
          finish(0);
        }, 300);
        return ok({ message_id: 1 });
      }
      if (target.endsWith("/sendChatAction")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (sent) return ok([]);
      sent = true;
      return ok([{ update_id: 1, message: { text: "幫我改 bridge.mjs", from: { id: 1 }, chat: { id: 1 } } }]);
    };
  },
};
