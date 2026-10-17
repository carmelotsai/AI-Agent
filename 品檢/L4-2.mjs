// L4-2 晨間簡報（例行工作）的工程自檢（Q4-2-01～Q4-2-07）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L4-2）。
// 外掛的時間判斷在子程式裡用固定時鐘測；主程式的部分用假 Telegram／假 Gemini 啟動副本。
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");
const PLUGIN = "外掛/例行工作/index.mjs";
const BRIEF = { 名稱: "晨報", 時間: "每個工作日 08:00", 要他做的事: "照 morning-brief 技能寫今天的晨報" };

/** 副本裡先清掉使用者真的提醒、排程與狀態，測試從空白開始。 */
function clean(dir) {
  for (const file of ["提醒.json", "排程.json", "通知.json", "固定會議.json", "情報.json", join("data", "排程狀態.json")]) rmSync(join(dir, file), { force: true });
}

/** 在副本裡跑 units[name]：固定時鐘（可用 __setNow 改），印出 JSON 結果。 */
async function unit(t, name) {
  const dir = t.makeCopy();
  clean(dir);
  try {
    const code = [
      `const RealDate = Date; let offset = 0;`,
      `class FakeDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } }`,
      `globalThis.Date = FakeDate; globalThis.__setNow = (...a) => { offset = new RealDate(...a).getTime() - RealDate.now(); };`,
      `globalThis.__setNow(2026, 9, 5, 7, 0);`,
      `const { units } = await import(${JSON.stringify(pathToFileURL(join(dir, "品檢", "L4-2.mjs")).href)});`,
      `console.log("結果:" + JSON.stringify(await units[${JSON.stringify(name)}](${JSON.stringify(dir)})));`,
    ].join("\n");
    const { out } = await t.run(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, env: t.fakeEnv(), timeoutMs: 30_000 });
    const line = out.split("\n").find((text) => text.startsWith("結果:"));
    if (!line) throw new Error(`子程式沒有結果：\n${tail(out)}`);
    return JSON.parse(line.slice(3));
  } finally {
    t.removeCopy(dir);
  }
}

function verdict(results) {
  const text = results.map((item) => `${item.ok ? "✅" : "❌"} ${item.what}${item.ok ? "" : `：${item.got}`}`).join("\n");
  return results.every((item) => item.ok) ? pass(text) : fail(text);
}

export const checks = [
  {
    id: "Q4-2-01",
    name: "例行工作外掛：工具、權限等級、按鈕說明、/run、定時工作",
    async run(t) {
      return verdict(await unit(t, "load"));
    },
  },
  {
    id: "Q4-2-02",
    name: "時間判斷：準時、不重複、中午前補做、過中午只說明、安靜時段延後（含整個排在半夜的）、週末不做",
    async run(t) {
      return verdict(await unit(t, "tick"));
    },
  },
  {
    id: "Q4-2-03",
    name: "新增、刪除、列出例行工作；/run 的回答",
    async run(t) {
      return verdict(await unit(t, "tools"));
    },
  },
  {
    id: "Q4-2-07",
    name: "國定假日（含補假）不做例行工作，也不補做；「每天」照做；下次會跳到假日後面",
    async run(t) {
      return verdict(await unit(t, "holiday"));
    },
  },
  {
    id: "Q4-2-04",
    name: "主程式：/run晨報（沒空格也行）→ 附上技能內容與程式先查好的資料、藏起執行級工具、結果傳給主人並附 🕗，之後工具還原",
    async run(t) {
      const { out } = await t.startBridge({
        module: t.module, fake: "run", env: { TELEGRAM_ALLOWED_USERS: "7,1" }, timeoutMs: 40_000,
        prepare(dir) {
          clean(dir);
          writeFileSync(join(dir, "排程.json"), JSON.stringify({ 例行工作: [BRIEF] }));
        },
      });
      const lines = t.scriptLines(out);
      const first = lines.find((line) => line.startsWith("Gemini 第1次")) ?? "";
      const later = lines.find((line) => line.startsWith("Gemini 第2次")) ?? "";
      const sent = lines.filter((line) => line.startsWith("送出"));
      const problems = [
        !first.includes("例行工作:有") && `例行工作的訊息沒有【例行工作：晨報】開頭：${first || tail(out)}`,
        !first.includes("powershell:無") && `例行工作時還看得到 powershell（應該藏起來）：${first}`,
        !first.includes("read:有") && `例行工作時看不到 read：${first}`,
        !first.includes("技能內容:有") && `例行工作的指令沒有附上 morning-brief 技能現在的內容：${first}`,
        !first.includes("先查:有") && `例行工作的指令沒有附上程式先查好的資料（提醒、日誌待辦、沒有行事曆）：${first}`,
        !sent.some((line) => line.startsWith("送出 chat=7 ") && line.includes("送出 chat=7 🗓 今天的晨報內容") && line.includes("🕗 例行工作：晨報（/run 立刻執行）")) &&
          `晨報沒有傳給主人（7）或沒有附 🕗：\n${sent.join("\n")}`,
        !later.includes("powershell:有") && `例行工作做完後 powershell 沒有還原：${later || tail(out)}`,
        !later.includes("例行工作:無") && `使用者的訊息被當成例行工作：${later}`,
      ].filter(Boolean);
      return problems.length === 0 ? pass([first, later, ...sent].join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-2-05",
    name: "主程式：例行工作只能寫 文件/（寫技能被擋下、記事件）；沒做成時傳說明並提示 /run",
    async run(t) {
      const { out } = await t.startBridge({
        module: t.module, fake: "blocked", env: { TELEGRAM_ALLOWED_USERS: "7" }, timeoutMs: 40_000,
        prepare(dir) {
          clean(dir);
          writeFileSync(join(dir, "排程.json"), JSON.stringify({ 例行工作: [BRIEF, { 名稱: "壞掉", 時間: "每天 09:00", 要他做的事: "測試" }] }));
        },
      });
      const lines = t.scriptLines(out);
      const blocked = out.includes("擋下 write：這是例行工作，只能寫「文件/」");
      const event = lines.find((line) => line.startsWith("事件") && line.includes("\"擋下\"") && line.includes(".pi/skills"));
      const failedNote = lines.find((line) => line.includes("⚠️ 例行工作「壞掉」沒有做成") && line.includes("要補跑請傳 /run 壞掉"));
      const failedEvent = lines.find((line) => line.startsWith("事件") && line.includes("例行工作失敗"));
      const problems = [
        !blocked && `例行工作寫 .pi/skills/ 沒有被擋下：\n${tail(out)}`,
        !event && "事件紀錄沒有這次擋下",
        !failedNote && `沒做成時沒有傳「⚠️ 例行工作「壞掉」沒有做成 … 要補跑請傳 /run 壞掉」：\n${lines.filter((line) => line.startsWith("送出")).join("\n")}`,
        !failedEvent && "事件紀錄沒有「例行工作失敗」",
      ].filter(Boolean);
      return problems.length === 0 ? pass([event, failedNote, failedEvent].join("\n")) : fail(problems.join("\n"));
    },
  },
  {
    id: "Q4-2-06",
    name: "主程式：同一個資料夾已經有秘書在跑，第二個啟動時說明並結束",
    async run(t) {
      const dir = t.makeCopy();
      clean(dir);
      try {
        const loader = join(dir, "_self-check-fake.mjs");
        writeFileSync(loader, `import { fakes } from ${JSON.stringify(pathToFileURL(join(dir, "品檢", "L4-2.mjs")).href)};\nawait fakes.idle();\n`);
        const args = ["--import", pathToFileURL(loader).href, "bridge.mjs"];
        const first = t.run(process.execPath, args, { cwd: dir, env: t.fakeEnv(), timeoutMs: 40_000 });
        await new Promise((resolve) => setTimeout(resolve, 15_000)); // 等第一個啟動好（自檢同時跑好幾個秘書時，啟動比較慢）
        const second = await t.run(process.execPath, args, { cwd: dir, env: t.fakeEnv(), timeoutMs: 20_000 });
        const firstResult = await first;
        const said = second.out.includes("這個資料夾已經有一個秘書在跑了");
        const problems = [
          !firstResult.out.includes("等待 Telegram 訊息") && `第一個秘書沒有正常啟動：\n${tail(firstResult.out)}`,
          !said && `第二個沒有說「已經有一個秘書在跑」：\n${tail(second.out)}`,
          (second.code === 0 || second.timedOut) && "第二個沒有自己結束",
          second.out.includes("等待 Telegram 訊息") && "第二個還是開始收訊息了",
        ].filter(Boolean);
        return problems.length === 0 ? pass(second.out.split("\n").find((line) => line.includes("已經有一個秘書"))) : fail(problems.join("\n"));
      } finally {
        t.removeCopy(dir);
      }
    },
  },
];

// ── 外掛的單元測試（在子程式裡、固定時鐘下執行）────────────────────────────
const check = (what, ok, got) => ({ what, ok: Boolean(ok), got: typeof got === "string" ? got : JSON.stringify(got) });

async function loadPlugin(dir) {
  const module = await import(pathToFileURL(join(dir, PLUGIN)).href);
  const tools = new Map(), notes = new Map(), runs = [], sent = [];
  const bridge = {
    root: dir,
    setReplyNote: (key, text) => notes.set(key, text),
    notify: async (text) => { sent.push(text); },
    runRoutine: (routine, why) => { runs.push({ ...routine, why }); },
  };
  module.default({ registerTool: (tool) => tools.set(tool.name, tool) }, bridge);
  const call = async (name, input) => {
    try {
      return { ok: true, text: (await tools.get(name).execute("id", input)).content[0].text };
    } catch (error) {
      return { ok: false, text: error.message };
    }
  };
  const schedule = () => JSON.parse(readFileSync(join(dir, "排程.json"), "utf8"));
  const write = (data) => writeFileSync(join(dir, "排程.json"), JSON.stringify(data));
  return { module, tools, notes, runs, sent, bridge, call, schedule, write };
}

export const units = {
  async load(dir) {
    const { module, tools } = await loadPlugin(dir);
    let badTime = "";
    try {
      await module.describe.add_routine({ name: "晨報", time: "每天早上", task: "x" });
    } catch (error) {
      badTime = error.message;
    }
    const text = await module.describe.add_routine({ name: "晨報", time: "每個工作日 08:00", task: "照 morning-brief 技能寫今天的晨報" });
    return [
      check("註冊 add_routine、update_routine、remove_routine、list_routines",
        ["add_routine", "update_routine", "remove_routine", "list_routines"].every((name) => tools.has(name)), [...tools.keys()]),
      check("等級：新增、修改、刪除＝執行（按鈕確認），列出＝查閱",
        module.levels.add_routine === "執行" && module.levels.update_routine === "執行" && module.levels.remove_routine === "執行" && module.levels.list_routines === "查閱", module.levels),
      check("按鈕說明列出名稱、時間與下次、要做的事",
        text === "新增例行工作：晨報\n時間：每個工作日 08:00（下次 10/5（一）08:00）\n要他做的事：照 morning-brief 技能寫今天的晨報", text),
      check("時間寫法不對 → 說明做不出來（直接擋下，不跳按鈕）", /看不懂時間「每天早上」/.test(badTime), badTime),
      check("匯出 /run 指令與 tick", typeof module.commands?.run === "function" && typeof module.tick === "function", Object.keys(module)),
    ];
  },

  async tick(dir) {
    const { module, bridge, runs, sent, write } = await loadPlugin(dir);
    const results = [];
    write({ 例行工作: [BRIEF, { 名稱: "午後", 時間: "每天 12:30", 要他做的事: "午後的事" }] });
    globalThis.__setNow(2026, 9, 5, 7, 0); // 10/5（一）07:00：第一次看到，只記起點
    await module.tick(bridge);
    results.push(check("剛新增時不追做以前的", runs.length === 0 && sent.length === 0, { runs, sent }));
    globalThis.__setNow(2026, 9, 5, 8, 0, 30);
    await module.tick(bridge);
    results.push(check("08:00 準時交給秘書，說明寫「每個工作日 08:00」", runs.length === 1 && runs[0].name === "晨報" && runs[0].why === "每個工作日 08:00", runs));
    globalThis.__setNow(2026, 9, 5, 8, 1);
    await module.tick(bridge);
    results.push(check("同一次不重複做", runs.length === 1, runs));
    globalThis.__setNow(2026, 9, 5, 12, 31);
    await module.tick(bridge);
    results.push(check("12:30 的例行工作在安靜時段（12:00～13:00）先不做", runs.length === 1, runs));
    globalThis.__setNow(2026, 9, 5, 13, 0, 10);
    await module.tick(bridge);
    results.push(check("13:00 安靜時段結束就做，說明是安靜時段延後的（不是遲到）",
      runs.length === 2 && runs[1].name === "午後" && runs[1].why === "原定 10/5（一）12:30，安靜時段結束後做", runs));
    // 10/6（二）電腦 09:40 才開：08:00 的晨報中午前補做
    globalThis.__setNow(2026, 9, 6, 9, 40);
    await module.tick(bridge);
    results.push(check("09:40 才開機：晨報補做，說明「原定 10/6（二）08:00，晚了 100 分鐘補做」",
      runs.length === 3 && runs[2].why === "原定 10/6（二）08:00，晚了 100 分鐘補做", runs));
    // 10/7（三）13:10 才開機：晨報過了中午不補，只傳說明
    globalThis.__setNow(2026, 9, 7, 13, 10);
    await module.tick(bridge);
    const brief = runs.filter((item) => item.name === "晨報");
    results.push(check("13:10 才開機：晨報不補做", brief.length === 2, runs));
    results.push(check("傳一則說明，提示 /run 晨報", sent.some((text) => text === "🕗 10/7（三）08:00 的例行工作「晨報」沒有做：那時秘書沒有在執行，過了中午就不補。要看的話傳 /run 晨報"), sent));
    // 10/10（六）08:01：每個工作日 → 週末不做
    const before = runs.length;
    globalThis.__setNow(2026, 9, 10, 8, 1);
    await module.tick(bridge);
    results.push(check("星期六不做「每個工作日」的晨報", !runs.slice(before).some((item) => item.name === "晨報"), runs.slice(before)));
    // 改了時間：當成新的，從現在開始算
    write({ 例行工作: [{ ...BRIEF, 時間: "每天 07:30" }] });
    const count = runs.length;
    await module.tick(bridge);
    results.push(check("改了時間就從現在開始算，不立刻補做", runs.length === count, runs.slice(count)));
    // 整個排在安靜時段裡的例行工作（半夜 23:00）：延到隔天 07:00 做，不可以被當成「跨日了、錯過了」
    write({ 例行工作: [{ 名稱: "夜間整理", 時間: "每天 23:00", 要他做的事: "整理明天的行程" }] });
    globalThis.__setNow(2026, 9, 12, 21, 0);
    await module.tick(bridge);
    globalThis.__setNow(2026, 9, 12, 23, 1);
    await module.tick(bridge);
    const sentBefore = sent.length;
    results.push(check("23:00 在安靜時段內：先不做", !runs.some((item) => item.name === "夜間整理"), runs));
    globalThis.__setNow(2026, 9, 13, 2, 0);
    await module.tick(bridge);
    results.push(check("半夜 02:00 還在安靜時段：還是不做，也不說「沒有做」", !runs.some((item) => item.name === "夜間整理") && sent.length === sentBefore, sent.slice(sentBefore)));
    globalThis.__setNow(2026, 9, 13, 7, 0, 10);
    await module.tick(bridge);
    const night = runs.filter((item) => item.name === "夜間整理");
    results.push(check("隔天 07:00 安靜時段結束就做，說明「原定 10/12（一）23:00，安靜時段結束後做」",
      night.length === 1 && night[0].why === "原定 10/12（一）23:00，安靜時段結束後做", night));
    // 同樣是半夜的，但電腦整晚關機、隔天下午才開 → 過了中午不補，說明寫得出「該做的是 07:00」
    write({ 例行工作: [{ 名稱: "夜間二", 時間: "每天 23:00", 要他做的事: "x" }] });
    globalThis.__setNow(2026, 9, 13, 21, 0);
    await module.tick(bridge);
    globalThis.__setNow(2026, 9, 14, 15, 0);
    await module.tick(bridge);
    results.push(check("半夜的例行工作整晚沒開機：過了中午不補，說明安靜時段結束後（10/14（三）07:00）秘書沒在跑",
      !runs.some((item) => item.name === "夜間二") &&
      sent.some((text) => text === "🕗 10/13（二）23:00 的例行工作「夜間二」沒有做：安靜時段結束後（10/14（三）07:00）秘書沒有在執行，過了中午就不補。要看的話傳 /run 夜間二"), sent));
    return results;
  },

  /** 10/9（五）是國慶日補假、10/10（六）是國慶日：那兩天不做，下次直接跳到 10/12（一）。 */
  async holiday(dir) {
    writeFileSync(join(dir, "data", "台灣假日.json"), JSON.stringify({
      不要重抓: true,
      國定假日: { "2026-10-09": "中華民國國慶日 補假", "2026-10-10": "中華民國國慶日" },
    }));
    const { module, bridge, runs, sent, call, write } = await loadPlugin(dir);
    const results = [];
    write({ 例行工作: [BRIEF, { 名稱: "覆盤", 時間: "每週五 17:00", 要他做的事: "照 weekly-review 技能做本週覆盤" }, { 名稱: "午後", 時間: "每天 12:30", 要他做的事: "午後的事" }] });
    globalThis.__setNow(2026, 9, 8, 7, 0); // 10/8（四）07:00：只記起點
    await module.tick(bridge);
    globalThis.__setNow(2026, 9, 8, 8, 1); // 10/8（四）08:00：平常日照做
    await module.tick(bridge);
    results.push(check("10/8（四）晨報照做", runs.filter((item) => item.name === "晨報").length === 1, runs));
    globalThis.__setNow(2026, 9, 9, 8, 1); // 10/9（五）：國慶日補假
    await module.tick(bridge);
    results.push(check("10/9（五）是補假 → 不做晨報", runs.filter((item) => item.name === "晨報").length === 1, runs));
    results.push(check("跳過不吵人：不傳晨報「沒有做」的說明", !sent.some((text) => text.includes("晨報")), sent));
    globalThis.__setNow(2026, 9, 9, 13, 1); // 安靜時段剛過
    await module.tick(bridge);
    results.push(check("「每天 12:30」的假日照做（使用者寫「每天」就是每天）", runs.some((item) => item.name === "午後"), runs));
    globalThis.__setNow(2026, 9, 9, 17, 1);
    await module.tick(bridge);
    results.push(check("10/9 的「每週五 17:00」覆盤也跳過", !runs.some((item) => item.name === "覆盤"), runs));
    globalThis.__setNow(2026, 9, 12, 8, 1); // 10/12（一）
    await module.tick(bridge);
    results.push(check("10/12（一）晨報回來做，而且不補做 10/9 那次",
      runs.filter((item) => item.name === "晨報").length === 2 && runs.at(-1).why === "每個工作日 08:00", runs));
    globalThis.__setNow(2026, 9, 8, 9, 0); // 回到 10/8（四）09:00 看「下次」怎麼算
    const list = await call("list_routines", {});
    results.push(check("列出時「下次」跳過 10/9 補假、10/10 國慶日與週末 → 晨報 10/12（一）、覆盤 10/16（五）",
      list.ok && /晨報：每個工作日 08:00（下次 10\/12（一）08:00）/.test(list.text) && /覆盤：每週五 17:00（下次 10\/16（五）17:00）/.test(list.text), list.text));
    const status = module.status(bridge);
    results.push(check("/status 寫明「國定假日不做」", /🕗 例行工作：3 件（國定假日不做；安靜時段 /.test(status), status));
    return results;
  },

  async tools(dir) {
    const { module, call, notes, runs, schedule, bridge } = await loadPlugin(dir);
    const results = [];
    const empty = await call("list_routines", {});
    results.push(check("沒有例行工作時說「目前沒有例行工作」", empty.ok && empty.text === "目前沒有例行工作。", empty.text));
    const add = await call("add_routine", { name: "晨報", time: "每個工作日 08:00", task: "照 morning-brief 技能寫今天的晨報" });
    results.push(check("新增後寫進排程.json，預設安靜時段 22:00-07:00、12:00-13:00",
      add.ok && schedule().例行工作[0].名稱 === "晨報" && JSON.stringify(schedule().安靜時段) === JSON.stringify(["22:00-07:00", "12:00-13:00"]), schedule()));
    results.push(check("回覆最後附「🕗 已新增例行工作 … 下次 10/5（一）08:00（要馬上試跑請傳 /run 晨報）」",
      notes.get("例行工作晨報") === "🕗 已新增例行工作「晨報」：每個工作日 08:00，下次 10/5（一）08:00（要馬上試跑請傳 /run 晨報）", notes.get("例行工作晨報")));
    const dup = await call("add_routine", { name: "晨報", time: "每天 09:00", task: "x" });
    results.push(check("同名不能重複新增", !dup.ok && /已經有叫「晨報」/.test(dup.text), dup.text));
    const list = await call("list_routines", {});
    results.push(check("列出：件數、時間、下次、要做的事", list.ok && list.text === "目前共 1 件例行工作：\n1. 晨報：每個工作日 08:00（下次 10/5（一）08:00）— 照 morning-brief 技能寫今天的晨報", list.text));
    const unknown = await module.commands.run("週報", bridge);
    const noName = await module.commands.run("", bridge);
    const ok = await module.commands.run("晨報", bridge);
    results.push(check("/run 不存在的名稱 → 說沒有，列出有哪些", unknown === "沒有叫「週報」的例行工作。目前有：晨報", unknown));
    results.push(check("/run 沒給名稱 → 問要跑哪一個", /要跑哪一個？例如 \/run 晨報/.test(noName ?? ""), noName));
    results.push(check("/run 晨報 → 交給秘書、不另外回話", ok === null && runs.length === 1 && runs[0].why === "/run 立刻執行" && runs[0].task === "照 morning-brief 技能寫今天的晨報", { ok, runs }));
    // 修改：一次改好（一次按鈕），按鈕說明列出改前改後
    const button = await module.describe.update_routine({ name: "晨報", time: "每天 07:30" });
    results.push(check("修改的按鈕說明：時間 改前 → 改後（下次）、要做的事不變",
      button === "修改例行工作：晨報\n時間：每個工作日 08:00 → 每天 07:30（下次 10/5（一）07:30）\n要他做的事：照 morning-brief 技能寫今天的晨報（不變）", button));
    const update = await call("update_routine", { name: "晨報", time: "每天 07:30" });
    results.push(check("修改後排程.json 只有一筆、時間是每天 07:30，回覆附「🕗 已修改例行工作」",
      update.ok && schedule().例行工作.length === 1 && schedule().例行工作[0].時間 === "每天 07:30" &&
      notes.get("例行工作晨報") === "🕗 已修改例行工作「晨報」：每天 07:30，下次 10/5（一）07:30", notes.get("例行工作晨報")));
    let badUpdate = "";
    try {
      await module.describe.update_routine({ name: "晨報", time: "早上七點" });
    } catch (error) {
      badUpdate = error.message;
    }
    results.push(check("修改時時間寫法不對 → 直接擋下", /看不懂時間「早上七點」/.test(badUpdate), badUpdate));
    const remove = await call("remove_routine", { name: "晨報" });
    results.push(check("刪除後排程.json 沒有晨報，回覆附「🗑️ 已刪除例行工作」", remove.ok && schedule().例行工作.length === 0 && notes.get("例行工作晨報") === "🗑️ 已刪除例行工作「晨報」", remove.text));
    const missing = await call("remove_routine", { name: "晨報" });
    results.push(check("刪除不存在的 → 說找不到", !missing.ok && /找不到叫「晨報」/.test(missing.text), missing.text));
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
/** 劇本：照順序把使用者訊息交給秘書（每次 getUpdates 給一則）。 */
function script(messages) {
  let index = 0;
  return () => (index < messages.length ? [{ update_id: index + 1, message: { text: messages[index++], from: { id: 7 }, chat: { id: 7 } } }] : []);
}
const lastUserText = (body) => (body.contents ?? []).filter((item) => item.role === "user").at(-1)?.parts.map((part) => part.text ?? "").join("") ?? "";
const toolNames = (body) => JSON.stringify(body.tools ?? []);

export const fakes = {
  /** 什麼都不做的秘書（給重複啟動的檢查用）。 */
  async idle() {
    globalThis.fetch = async (url) => {
      if (String(url).includes("generativelanguage.googleapis.com")) throw new TypeError("品檢：不應該呼叫 Gemini");
      await new Promise((resolve) => setTimeout(resolve, 500));
      return ok([]);
    };
  },

  /** 傳 /run 晨報，等晨報傳回來，再傳一則一般訊息。 */
  async run() {
    const next = script(["/run晨報"]); // 沒有空格也要認得（真機驗收時委託人這樣打）
    let calls = 0, followUp = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse(options.body);
        const tools = toolNames(body);
        calls++;
        console.log(`[0s] Gemini 第${calls}次 例行工作:${lastUserText(body).includes("【例行工作：晨報】") ? "有" : "無"}、` +
          `powershell:${tools.includes("\"powershell\"") || tools.includes("\"bash\"") ? "有" : "無"}、read:${tools.includes("\"read\"") ? "有" : "無"}、` +
          `技能內容:${lastUserText(body).includes("以下是「morning-brief」技能現在的內容") && lastUserText(body).includes("## 步驟") ? "有" : "無"}、` +
          `先查:${lastUserText(body).includes("以下是系統剛才先幫你查好的資料") && lastUserText(body).includes("【今天的提醒】\n目前沒有提醒") && lastUserText(body).includes("【還沒完成的事】最新一份日誌") && lastUserText(body).includes("【今天的行程】這個工具目前沒有") ? "有" : "無"}`);
        if (calls === 2) finish(500);
        return sse({ text: calls === 1 ? "🗓 🗓 今天的晨報內容" : "好的" }); // 圖示重複，程式要合併成一個
      }
      const body = JSON.parse(options.body ?? "{}");
      if (target.endsWith("/sendMessage")) {
        console.log(`[0s] 送出 chat=${body.chat_id} ${body.text.replace(/\n/g, " ⏎ ")}`);
        if (body.text.includes("🕗 例行工作")) followUp = true;
        return ok({ message_id: 1 });
      }
      if (target.endsWith("/sendChatAction")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (followUp) {
        followUp = false;
        return ok([{ update_id: 99, message: { text: "謝謝", from: { id: 7 }, chat: { id: 7 } } }]);
      }
      return ok(next());
    };
  },

  /** /run 晨報：模型想寫技能（例行工作只能寫 文件/）；/run 壞掉：模型沒有回任何文字。 */
  async blocked() {
    const next = script(["/run 晨報", "/run 壞掉"]);
    let calls = 0, done = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse(options.body);
        calls++;
        if (lastUserText(body).includes("【例行工作：壞掉】")) return sse({ text: "" });
        if (calls === 1) return sse({ functionCall: { name: "write", args: { path: ".pi/skills/x/SKILL.md", content: "x" } } });
        return sse({ text: "技能寫不進去，這件事要你回來確認。" });
      }
      const body = JSON.parse(options.body ?? "{}");
      if (target.endsWith("/sendMessage")) {
        console.log(`[0s] 送出 chat=${body.chat_id} ${body.text.replace(/\n/g, " ⏎ ")}`);
        if (++done === 2) {
          setTimeout(() => {
            for (const line of readFileSync("data/事件紀錄.jsonl", "utf8").trim().split("\n")) console.log(`[0s] 事件 ${line}`);
            finish(0);
          }, 300);
        }
        return ok({ message_id: 1 });
      }
      if (target.endsWith("/sendChatAction")) return ok(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      return ok(next());
    };
  },
};
