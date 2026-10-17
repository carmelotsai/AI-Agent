// L4-3 會議前提醒、會前準備、重要新信通知的工程自檢（Q4-3-01～Q4-3-09）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs（或 node self-check.mjs L4-3）。
// 在子程式裡用固定時鐘＋假的 Google 回應（行事曆、Gmail）測外掛，不需要授權、不連網路。
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");

/** 在副本裡跑 units[name]：假授權檔、固定時鐘（2026-10-05 星期一 09:40，可用 __setNow 改）。 */
async function unit(t, name) {
  const dir = t.makeCopy();
  for (const file of ["提醒.json", "排程.json", "通知.json", "固定會議.json", "情報.json"]) rmSync(join(dir, file), { force: true });
  mkdirSync(join(dir, "data", "google"), { recursive: true });
  writeFileSync(join(dir, "data", "google", "client.json"), JSON.stringify({ installed: { client_id: "fake", client_secret: "fake" } }));
  for (const file of ["token.json", "gmail-token.json"]) writeFileSync(join(dir, "data", "google", file), JSON.stringify({ refresh_token: "fake" }));
  try {
    const code = [
      `const RealDate = Date; let offset = 0;`,
      `class FakeDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(RealDate.now() + offset); } static now() { return RealDate.now() + offset; } }`,
      `globalThis.Date = FakeDate; globalThis.__setNow = (...a) => { offset = new RealDate(...a).getTime() - RealDate.now(); };`,
      `globalThis.__setNow(2026, 9, 5, 9, 40);`,
      `const { units } = await import(${JSON.stringify(pathToFileURL(join(dir, "品檢", "L4-3.mjs")).href)});`,
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
    id: "Q4-3-01",
    name: "會前提醒：前 15 分鐘、只提醒一次、全天不提醒、午休提前到 11:50、開始了就不補",
    async run(t) {
      return verdict(await unit(t, "meeting"));
    },
  },
  {
    id: "Q4-3-02",
    name: "會前提醒：授權失效只通知一次；可以在 通知.json 改提前幾分鐘",
    async run(t) {
      return verdict(await unit(t, "meetingSettings"));
    },
  },
  {
    id: "Q4-3-03",
    name: "重要新信：名單空的不查；新增規則（執行級）；第一次只記下、之後新信才通知；不含內文",
    async run(t) {
      return verdict(await unit(t, "mail"));
    },
  },
  {
    id: "Q4-3-04",
    name: "晨報的「要注意的信」：名單空的整段不列；有名單只列未讀的寄件人與主旨",
    async run(t) {
      return verdict(await unit(t, "brief"));
    },
  },
  {
    id: "Q4-3-05",
    name: "會前準備：設定（執行級）、標題符合的會議開始前 N 分鐘交給秘書、午休提前、不重複；技能存在",
    async run(t) {
      return verdict(await unit(t, "prep"));
    },
  },
  {
    id: "Q4-3-06",
    name: "固定會議：週二 13:30 準備與提醒、國定假日前一天問、假日節慶照常、臨時改時間、取消、午休提前",
    async run(t) {
      return verdict(await unit(t, "fixed"));
    },
  },
  {
    id: "Q4-3-09",
    name: "固定會議延期撞到本來就有的那一場：合成一場，不準備兩次、不提醒兩次；延到別天的「下一場」看得準",
    async run(t) {
      return verdict(await unit(t, "collide"));
    },
  },
  {
    id: "Q4-3-07",
    name: "修改固定會議：一次按鈕、列出改前改後；只改分鐘數保留臨時調整，改時間才清掉；同名不能重複新增",
    async run(t) {
      return verdict(await unit(t, "fixedUpdate"));
    },
  },
  {
    id: "Q4-3-08",
    name: "修改行程：只改備註、使用者沒提行事曆 → 擋下改提醒；有提到才跳按鈕並列出備註改前改後；什麼都沒改就擋下",
    async run(t) {
      return verdict(await unit(t, "calendarUpdate"));
    },
  },
];

// ── 外掛的單元測試（在子程式裡、固定時鐘、假 Google）────────────────────────
const check = (what, ok, got) => ({ what, ok: Boolean(ok), got: typeof got === "string" ? got : JSON.stringify(got) });
const at = (h, m) => new Date(2026, 9, 5, h, m).toISOString();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** 假的 Google：calls 記下每次呼叫的網址；events／messages 可以在測試中途改。 */
function fakeGoogle(world) {
  world.calls = [];
  globalThis.fetch = async (url) => {
    const target = decodeURIComponent(String(url));
    world.calls.push(target);
    if (target.startsWith("https://oauth2.googleapis.com/token")) {
      return world.authBroken ? json({ error: "invalid_grant" }, 400) : json({ access_token: "fake", expires_in: 3600 });
    }
    if (target.includes("/users/me/calendarList")) return json({ items: [{ id: "primary", primary: true, accessRole: "owner", summary: "我的行事曆" }] });
    const single = target.match(/\/calendars\/primary\/events\/([^?/]+)/);
    if (single) return json((world.events ?? []).find((event) => event.id === single[1]) ?? {});
    if (target.includes("/calendars/primary/events")) return json({ items: world.events ?? [] });
    if (target.includes("/gmail/v1/users/me/profile")) return json({ emailAddress: "me@example.com" });
    if (/\/gmail\/v1\/users\/me\/messages\?/.test(target)) {
      world.lastQuery = new URL(String(url)).searchParams.get("q");
      return json({ messages: (world.messages ?? []).filter((item) => !world.unreadOnly || item.unread).map(({ id }) => ({ id })) });
    }
    const message = (world.messages ?? []).find((item) => target.includes(`/messages/${item.id}?`));
    if (message) {
      return json({ id: message.id, internalDate: String(new Date(2026, 9, 5, 8, 30).getTime()), payload: { headers: [{ name: "From", value: message.from }, { name: "Subject", value: message.subject }] } });
    }
    throw new TypeError(`假 Google 沒有這個網址：${target}`);
  };
}

async function loadPlugin(dir, name) {
  const module = await import(pathToFileURL(join(dir, "外掛", name, "index.mjs")).href);
  const tools = new Map(), notes = new Map(), sent = [], runs = [];
  const bridge = {
    root: dir, setReplyNote: (key, text) => notes.set(key, text), notify: async (text) => { sent.push(text); },
    runRoutine: (routine, why) => { runs.push({ ...routine, why }); },
  };
  module.default({ registerTool: (tool) => tools.set(tool.name, tool), on: () => {} }, bridge);
  const call = async (tool, input) => {
    try {
      const result = await tools.get(tool).execute("id", input);
      return { ok: true, text: result.content[0].text };
    } catch (error) {
      return { ok: false, text: error.message };
    }
  };
  return { module, tools, notes, sent, runs, bridge, call };
}

export const units = {
  async meeting(dir) {
    const world = {
      events: [
        { id: "a", summary: "研發週會", location: "3 樓會議室", start: { dateTime: at(10, 0) }, end: { dateTime: at(11, 0) }, htmlLink: "https://calendar.google.com/a" },
        { id: "b", summary: "午餐後的會", start: { dateTime: at(13, 0) }, end: { dateTime: at(14, 0) }, htmlLink: "https://calendar.google.com/b" },
        { id: "c", summary: "全天的活動", start: { date: "2026-10-05" }, end: { date: "2026-10-06" } },
        { id: "d", summary: "快開始的會", start: { dateTime: at(9, 50) }, end: { dateTime: at(10, 0) } },
        { id: "e", summary: "已經開始的會", start: { dateTime: at(9, 30) }, end: { dateTime: at(10, 30) } },
      ],
    };
    fakeGoogle(world);
    const { module, bridge, sent } = await loadPlugin(dir, "行事曆");
    const results = [];
    await module.tick(bridge); // 09:40
    results.push(check("09:40：09:50 的會已過了提醒時間但還沒開始 → 馬上提醒「10 分鐘後」", sent.length === 1 && sent[0] === "📅 10 分鐘後：快開始的會（09:50–10:00）", sent));
    results.push(check("已經開始的會不補提醒", !sent.some((text) => text.includes("已經開始的會")), sent));
    globalThis.__setNow(2026, 9, 5, 9, 45, 10);
    await module.tick(bridge);
    results.push(check("09:45：10:00 的會提醒「15 分鐘後」、附地點與連結",
      sent.includes("📅 15 分鐘後：研發週會（10:00–11:00＠3 樓會議室）\n🔗 https://calendar.google.com/a"), sent));
    const count = sent.length;
    globalThis.__setNow(2026, 9, 5, 9, 46);
    await module.tick(bridge);
    results.push(check("同一場不重複提醒", sent.length === count, sent.slice(count)));
    globalThis.__setNow(2026, 9, 5, 11, 49);
    await module.tick(bridge);
    results.push(check("13:00 的會原本 12:45 提醒（午休時段）→ 11:49 還不提醒", !sent.some((text) => text.includes("午餐後的會")), sent));
    globalThis.__setNow(2026, 9, 5, 11, 50, 5);
    await module.tick(bridge);
    results.push(check("11:50 提醒 13:00 的會，註明午休前先提醒",
      sent.includes("📅 13:00 午餐後的會（13:00–14:00）\n午休前先提醒你\n🔗 https://calendar.google.com/b"), sent));
    results.push(check("全天活動不提醒", !sent.some((text) => text.includes("全天的活動")), sent));
    const state = JSON.parse(readFileSync(join(dir, "data", "會前提醒.json"), "utf8"));
    results.push(check("提醒過的記在 data/會前提醒.json（重啟後不重複）", Object.keys(state).length === 3, Object.keys(state)));
    const calendarCalls = world.calls.filter((url) => url.includes("/events")).length;
    results.push(check("不是每 30 秒都去查行事曆（5 分鐘最多一次）", calendarCalls <= 3, `查了 ${calendarCalls} 次`));
    return results;
  },

  async meetingSettings(dir) {
    const world = { authBroken: true, events: [] };
    fakeGoogle(world);
    const { module, bridge, sent } = await loadPlugin(dir, "行事曆");
    const results = [];
    await module.tick(bridge);
    globalThis.__setNow(2026, 9, 5, 9, 46);
    await module.tick(bridge);
    globalThis.__setNow(2026, 9, 5, 9, 52);
    await module.tick(bridge);
    const warnings = sent.filter((text) => text.startsWith("⚠️ 會前提醒暫停"));
    results.push(check("授權失效：只通知一次，並說明要重新授權", warnings.length === 1 && /node 外掛\/行事曆\/授權\.mjs/.test(warnings[0]), sent));
    world.authBroken = false;
    world.events = [{ id: "x", summary: "客戶來訪", start: { dateTime: at(10, 30) }, end: { dateTime: at(11, 30) } }];
    writeFileSync(join(dir, "通知.json"), JSON.stringify({ 會前提醒: { 提前幾分鐘: 30 } }));
    globalThis.__setNow(2026, 9, 5, 9, 58);
    await module.tick(bridge);
    results.push(check("通知.json 改成 30 分鐘：10:30 的會在 10:00 前還不提醒", !sent.some((text) => text.includes("客戶來訪")), sent));
    globalThis.__setNow(2026, 9, 5, 10, 0, 5);
    await module.tick(bridge);
    results.push(check("10:00 提醒「30 分鐘後：客戶來訪」", sent.includes("📅 30 分鐘後：客戶來訪（10:30–11:30）"), sent));
    return results;
  },

  async mail(dir) {
    const world = { messages: [{ id: "m1", from: "王經理 <wang@example.com>", subject: "上週的報價" }] };
    fakeGoogle(world);
    const { module, bridge, sent, call, notes } = await loadPlugin(dir, "Gmail");
    const results = [];
    results.push(check("新增、刪除規則＝執行（按鈕確認）；列出、要注意的信＝查閱",
      module.levels.add_mail_rule === "執行" && module.levels.remove_mail_rule === "執行" && module.levels.list_mail_rules === "查閱" && module.levels.important_mail === "查閱", module.levels));
    await module.tick(bridge);
    results.push(check("名單是空的：不去 Gmail 查、不通知", sent.length === 0 && !world.calls.some((url) => url.includes("/messages?")), world.calls));
    const button = await module.describe.add_mail_rule({ type: "寄件人", value: "@example.com" });
    results.push(check("按鈕說明：新增重要信件規則、只有寄件人和主旨",
      button === "新增重要信件規則：寄件人包含「@example.com」\n之後符合的新信會傳通知給你（只有寄件人和主旨，不含內文）。", button));
    let bad = "";
    try {
      await module.describe.add_mail_rule({ type: "內文", value: "x" });
    } catch (error) {
      bad = error.message;
    }
    results.push(check("type 不對 → 直接擋下", /只能是「寄件人」或「主旨關鍵字」/.test(bad), bad));
    const add = await call("add_mail_rule", { type: "寄件人", value: "@example.com" });
    await call("add_mail_rule", { type: "主旨關鍵字", value: "報價" });
    const file = JSON.parse(readFileSync(join(dir, "通知.json"), "utf8"));
    results.push(check("寫進 通知.json 的「重要信件」，回覆附件數",
      add.ok && JSON.stringify(file.重要信件) === JSON.stringify({ 寄件人: ["@example.com"], 主旨關鍵字: ["報價"] }) && notes.get("重要信件") === "✉️ 已新增重要信件規則：主旨關鍵字包含「報價」（目前共 2 條）", file));
    results.push(check("搜尋語法：收件匣、2 天內、寄件人或主旨（OR）", world.lastQuery === "in:inbox newer_than:2d {from:@example.com subject:報價}", world.lastQuery));
    // 真機驗收時的情況：規則一加完、下一次檢查之前就寄到的信，要算新信
    world.messages.unshift({ id: "m2", from: "\"陳小姐\" <chen@example.com>", subject: "報價單確認" });
    globalThis.__setNow(2026, 9, 5, 9, 51);
    await module.tick(bridge);
    results.push(check("規則加完後、下一次檢查前寄到的信也會通知（附連結、不含內文）",
      sent.length === 1 && sent[0] === "✉️ 重要新信：陳小姐〈報價單確認〉\n🔗 https://mail.google.com/mail/u/me%40example.com/#inbox/m2", sent));
    results.push(check("加規則時信箱裡已經有的信（m1）不補通知", !sent.some((text) => text.includes("上週的報價")), sent));
    world.messages.unshift({ id: "m3", from: "王經理 <wang@example.com>", subject: "交期" });
    globalThis.__setNow(2026, 9, 5, 9, 55);
    await module.tick(bridge);
    results.push(check("10 分鐘內不會再查", sent.length === 1, sent));
    globalThis.__setNow(2026, 9, 5, 10, 2);
    await module.tick(bridge);
    results.push(check("10:02 再查：通知「王經理〈交期〉」", sent.length === 2 && sent[1].startsWith("✉️ 重要新信：王經理〈交期〉"), sent));
    globalThis.__setNow(2026, 9, 5, 10, 13);
    await module.tick(bridge);
    results.push(check("同一封不重複通知", sent.length === 2, sent));
    const remove = await call("remove_mail_rule", { type: "主旨關鍵字", value: "報價" });
    results.push(check("刪除規則後剩 1 條", remove.ok && notes.get("重要信件") === "🗑️ 已刪除重要信件規則：主旨關鍵字包含「報價」（還剩 1 條）", notes.get("重要信件")));
    return results;
  },

  async prep(dir) {
    const world = {
      events: [
        { id: "w", summary: "研發週會", location: "3 樓會議室", start: { dateTime: at(10, 30) }, end: { dateTime: at(11, 30) } },
        { id: "l", summary: "研發週會（午後加開）", start: { dateTime: at(13, 0) }, end: { dateTime: at(14, 0) } },
        { id: "o", summary: "業務會議", start: { dateTime: at(10, 30) }, end: { dateTime: at(11, 0) } },
      ],
    };
    fakeGoogle(world);
    const { module, bridge, runs, call, notes } = await loadPlugin(dir, "行事曆");
    const results = [];
    results.push(check("新增、取消會前準備＝執行（按鈕確認），列出＝查閱",
      module.levels.add_meeting_prep === "執行" && module.levels.remove_meeting_prep === "執行" && module.levels.list_meeting_preps === "查閱", module.levels));
    const button = await module.describe.add_meeting_prep({ meeting: "研發週會" });
    results.push(check("按鈕說明：會議、預設 30 分鐘、要做的事",
      button === "新增會前準備：行事曆標題包含「研發週會」的會議\n時間：每次開始前 30 分鐘\n要他做的事：在 文件/ 找上一次同名會議的紀錄，摘要重點、決議、還沒完成的事項", button));
    let bad = "";
    try {
      await module.describe.add_meeting_prep({ meeting: "研發週會", minutes: 500 });
    } catch (error) {
      bad = error.message;
    }
    results.push(check("分鐘數不合理 → 直接擋下", /5～180/.test(bad), bad));
    const add = await call("add_meeting_prep", { meeting: "研發週會" });
    const file = JSON.parse(readFileSync(join(dir, "通知.json"), "utf8"));
    results.push(check("寫進 通知.json 的「會前準備」，回覆附 📋",
      add.ok && file.會前準備?.[0]?.會議 === "研發週會" && file.會前準備[0].提前幾分鐘 === 30 && notes.get("會前準備")?.startsWith("📋 已設定會前準備：「研發週會」開始前 30 分鐘"), file));
    globalThis.__setNow(2026, 9, 5, 9, 59);
    await module.tick(bridge);
    results.push(check("09:59：10:30 的會還沒到 30 分鐘前", runs.length === 0, runs));
    globalThis.__setNow(2026, 9, 5, 10, 0, 10);
    await module.tick(bridge);
    const weekly = runs.find((item) => item.name === "會前準備：研發週會");
    results.push(check("10:00：交給秘書「會前準備：研發週會」，附這次會議的時間地點",
      weekly && weekly.why === "10:30 開會前 30 分鐘" && weekly.task.includes("照 meeting-prep 技能，整理「研發週會」上一次的會議紀錄") && weekly.task.includes("2026-10-05 10:30–11:30＠3 樓會議室"), runs));
    results.push(check("標題不符合的會議（業務會議）不做", !runs.some((item) => item.name.includes("業務會議")), runs));
    globalThis.__setNow(2026, 9, 5, 10, 5);
    await module.tick(bridge);
    results.push(check("同一場不重複", runs.filter((item) => item.name === "會前準備：研發週會").length === 1, runs));
    globalThis.__setNow(2026, 9, 5, 11, 50, 5);
    await module.tick(bridge);
    const lunch = runs.find((item) => item.name === "會前準備：研發週會（午後加開）");
    results.push(check("13:00 的會（原本 12:30 準備，落在午休）→ 11:50 準備", lunch?.why === "13:00 開會，午休前先準備", runs));
    const remove = await call("remove_meeting_prep", { meeting: "研發週會" });
    results.push(check("取消後 通知.json 沒有會前準備", remove.ok && JSON.parse(readFileSync(join(dir, "通知.json"), "utf8")).會前準備.length === 0, remove.text));
    const skill = readFileSync(join(dir, ".pi", "skills", "meeting-prep", "SKILL.md"), "utf8");
    results.push(check("技能 meeting-prep：在 文件/ 找上一次同名紀錄、找不到照實說、不可以編造", skill.includes("文件/") && skill.includes("找不到") && skill.includes("不可以編造"), "SKILL.md 內容不對"));
    return results;
  },

  /**
   * 10/9（五）是國慶補假，使用者回「延到下週五同一時間」。
   * 下週五本來就有一場 → 那兩場其實是同一場，只能準備一次、提醒一次。
   */
  async collide(dir) {
    const results = [];
    const prepare = async (例外) => {
      writeFileSync(join(dir, "data", "台灣假日.json"), JSON.stringify({
        不要重抓: true,
        國定假日: { "2026-10-09": "中華民國國慶日 補假", "2026-10-10": "中華民國國慶日" },
      }));
      writeFileSync(join(dir, "固定會議.json"), JSON.stringify({
        固定會議: [{ 名稱: "研發會議", 時間: "每週五 13:30", 會前準備: 30, 會前提醒: 15, 例外 }],
      }));
      rmSync(join(dir, "data", "固定會議狀態.json"), { force: true });
      const loaded = await loadPlugin(dir, "固定會議");
      const at = async (...when) => {
        loaded.runs.length = 0;
        loaded.sent.length = 0;
        globalThis.__setNow(...when);
        await loaded.module.tick(loaded.bridge);
        return { runs: [...loaded.runs], sent: [...loaded.sent] };
      };
      return { ...loaded, at };
    };

    const moved = await prepare([{ 日期: "2026-10-09", 改成: "2026-10-16T13:30" }]);
    const quiet = [await moved.at(2026, 9, 9, 13, 1), await moved.at(2026, 9, 9, 13, 16)];
    results.push(check("10/9 當天安靜：不準備、不提醒、不問", quiet.every((step) => step.runs.length === 0 && step.sent.length === 0), quiet));
    const prep = await moved.at(2026, 9, 16, 13, 1);
    results.push(check("10/16 13:00 只交辦一次會前準備", prep.runs.length === 1, prep.runs.map((item) => item.name)));
    const remind = await moved.at(2026, 9, 16, 13, 16);
    results.push(check("10/16 13:15 只提醒一次", remind.sent.length === 1, remind.sent));
    results.push(check("合成的那場不寫「臨時改的」（對使用者來說就是本來那場）",
      remind.sent[0] === "📅 14 分鐘後：研發會議（13:30）", remind.sent[0]));
    globalThis.__setNow(2026, 9, 8, 20, 0);
    results.push(check("/status 下一場寫 10/16（五）13:30，不加「原本」",
      /下一場 10\/16（五）13:30；/.test(moved.module.status(moved.bridge)), moved.module.status(moved.bridge)));

    // 延到別天（沒撞到）：照舊標示「原本 10/9」，而且「下一場」要排在 10/16 前面
    const away = await prepare([{ 日期: "2026-10-09", 改成: "2026-10-12T13:30" }]);
    globalThis.__setNow(2026, 9, 8, 20, 0);
    const status = away.module.status(away.bridge);
    results.push(check("延到 10/12：下一場 10/12（一）13:30（原本 10/9（五）13:30），不會被 10/16 蓋過去",
      /下一場 10\/12（一）13:30（原本 10\/9（五）13:30）/.test(status), status));
    const away12 = await away.at(2026, 9, 12, 13, 16);
    results.push(check("10/12 照新時間提醒一次，註明臨時改的",
      away12.sent.length === 1 && /原本 10\/9（五）13:30/.test(away12.sent[0]), away12.sent));
    return results;
  },

  async fixed(dir) {
    // 這一項要測「真的去抓假日行事曆」：先刪掉副本預設的固定清單，換成下面這份假的 ics
    rmSync(join(dir, "data", "台灣假日.json"), { force: true });
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261013", "SUMMARY:測試國定假日", "DESCRIPTION:國定假日", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261020", "SUMMARY:測試節慶", "DESCRIPTION:假日節慶\\n如要隱藏假日節慶", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    let icsFetches = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes("calendar.google.com/calendar/ical")) {
        icsFetches++;
        return new Response(ics, { status: 200 });
      }
      throw new TypeError(`不應該連到 ${url}`);
    };
    const { module, bridge, sent, runs, call, notes } = await loadPlugin(dir, "固定會議");
    const results = [];
    results.push(check("新增、刪除＝執行（按鈕），臨時改一場＝擬稿，列出＝查閱",
      module.levels.add_fixed_meeting === "執行" && module.levels.remove_fixed_meeting === "執行" && module.levels.change_meeting_once === "擬稿" && module.levels.list_fixed_meetings === "查閱", module.levels));
    const button = await module.describe.add_fixed_meeting({ name: "研發週會", time: "每週二 13:30" });
    results.push(check("按鈕說明：時間、會前 30 分鐘整理紀錄、15 分鐘提醒、國定假日前一天問",
      button === "新增固定會議：研發週會（每週二 13:30）\n開會前 30 分鐘：整理 文件/ 裡上一次的會議紀錄給你\n開會前 15 分鐘：提醒你\n遇到國定假日：前一天 09:00 問你要不要延期", button));
    const add = await call("add_fixed_meeting", { name: "研發週會", time: "每週二 13:30" });
    await call("add_fixed_meeting", { name: "午會", time: "每週三 12:30", prep_minutes: 0 });
    results.push(check("寫進 固定會議.json，回覆附下次時間", add.ok && notes.get("固定會議研發週會") === "📅 已設定固定會議「研發週會」：每週二 13:30，下次 10/6（二）13:30", notes.get("固定會議研發週會")));
    // 10/6（二）一般的週二
    globalThis.__setNow(2026, 9, 6, 12, 59);
    await module.tick(bridge);
    results.push(check("12:59 還沒到會前準備", runs.length === 0, runs));
    globalThis.__setNow(2026, 9, 6, 13, 0, 10);
    await module.tick(bridge);
    results.push(check("13:00 會前準備交給秘書（meeting-prep、這次的日期時間）",
      runs.length === 1 && runs[0].name === "會前準備：研發週會" && runs[0].task.includes("照 meeting-prep 技能，整理「研發週會」上一次的會議紀錄") && runs[0].task.includes("2026-10-06 13:30") && runs[0].why === "13:30 開會前 30 分鐘", runs));
    globalThis.__setNow(2026, 9, 6, 13, 15, 10);
    await module.tick(bridge);
    results.push(check("13:15 提醒「15 分鐘後：研發週會（13:30）」", sent.includes("📅 15 分鐘後：研發週會（13:30）"), sent));
    globalThis.__setNow(2026, 9, 6, 13, 20);
    await module.tick(bridge);
    results.push(check("不重複準備、不重複提醒", runs.length === 1 && sent.filter((text) => text.includes("研發週會（13:30）")).length === 1, { runs, sent }));
    // 10/7（三）12:30 的午會：提醒 12:15 落在午休 → 11:50
    globalThis.__setNow(2026, 9, 7, 11, 50, 5);
    await module.tick(bridge);
    results.push(check("12:30 的會：提醒提前到 11:50，註明午休前先提醒", sent.includes("📅 12:30 午會\n午休前先提醒你"), sent));
    results.push(check("會前準備設 0：不做", !runs.some((item) => item.name.includes("午會")), runs));
    // 10/13（二）國定假日：10/12（一）09:00 先問
    globalThis.__setNow(2026, 9, 12, 8, 59);
    await module.tick(bridge);
    results.push(check("前一天 08:59 還不問", !sent.some((text) => text.includes("要延期嗎")), sent));
    globalThis.__setNow(2026, 9, 12, 9, 0, 10);
    await module.tick(bridge);
    results.push(check("前一天 09:00 問要不要延期",
      sent.includes("📅 10/13（二）是國定假日「測試國定假日」，研發週會（13:30）要延期嗎？\n回我例如「延到週三 13:30」「這週取消」或「照常開」。"), sent));
    const list = await call("list_fixed_meetings", {});
    results.push(check("列出時註明那場是國定假日", list.ok && list.text.includes("10/13（二）13:30（測試國定假日，國定假日：前一天會問你要不要延期）"), list.text));
    // 國定假日回「照常開」：記下來，照原時間準備（不是當成沒回覆）
    const keep = await call("change_meeting_once", { name: "研發週會", date: "2026-10-13", new_time: "2026-10-13T13:30" });
    results.push(check("回「照常開」：回覆附「10/13（二）13:30 → 照常開」", keep.ok && notes.get("固定會議研發週會") === "📅 研發週會：10/13（二）13:30 → 照常開", notes.get("固定會議研發週會")));
    // 使用者回「延到週三 13:30」
    const change = await call("change_meeting_once", { name: "研發週會", date: "2026-10-13", new_time: "2026-10-14T13:30" });
    results.push(check("臨時改一場：回覆附「10/13（二）13:30 → 改到 10/14（三）13:30」", change.ok && notes.get("固定會議研發週會") === "📅 研發週會：10/13（二）13:30 → 改到 10/14（三）13:30", notes.get("固定會議研發週會")));
    globalThis.__setNow(2026, 9, 13, 13, 0, 10);
    await module.tick(bridge);
    results.push(check("改過了：10/13 不做、也不傳「沒收到回覆」", !runs.some((item) => item.task.includes("2026-10-13")) && !sent.some((text) => text.includes("沒有收到你")), { runs, sent }));
    globalThis.__setNow(2026, 9, 14, 13, 15, 10);
    await module.tick(bridge);
    results.push(check("10/14 照新時間準備與提醒，註明臨時改的",
      runs.some((item) => item.task.includes("2026-10-14 13:30") && item.task.includes("臨時改的")) && sent.includes("📅 15 分鐘後：研發週會（13:30）\n（這次臨時改的，原本 10/13（二）13:30）"), { runs, sent }));
    // 10/20（二）只是「假日節慶」：照常開、不問
    globalThis.__setNow(2026, 9, 19, 9, 1);
    await module.tick(bridge);
    globalThis.__setNow(2026, 9, 20, 13, 0, 10);
    await module.tick(bridge);
    results.push(check("假日節慶不算放假：前一天不問、照常準備", !sent.some((text) => text.includes("測試節慶")) && runs.some((item) => item.task.includes("2026-10-20 13:30")), { runs, sent }));
    // 10/27（二）取消
    await call("change_meeting_once", { name: "研發週會", date: "2026-10-27", cancel: true });
    globalThis.__setNow(2026, 9, 27, 13, 15, 10);
    await module.tick(bridge);
    results.push(check("取消的那場不準備、不提醒", !runs.some((item) => item.task.includes("2026-10-27")) && !sent.some((text) => text.includes("15 分鐘後：研發週會") && text.includes("10/27")), { runs, sent }));
    // 國定假日沒回覆：到時間不做，傳一則說明（11/3 設成假日：用 例外 以外的方式測 → 直接改假日快取）
    globalThis.__setNow(2026, 10, 3, 12, 0);
    writeFileSync(join(dir, "data", "台灣假日.json"), JSON.stringify({ 抓取時間: new Date().toISOString(), 國定假日: { "2026-11-03": "測試假日二" } }));
    const fresh = await import(pathToFileURL(join(dir, "外掛", "固定會議", "index.mjs")).href + "?v2");
    const sent2 = [], runs2 = [];
    const bridge2 = { ...bridge, notify: async (text) => { sent2.push(text); }, runRoutine: (routine, why) => { runs2.push({ ...routine, why }); } };
    globalThis.__setNow(2026, 10, 3, 13, 0, 10);
    await fresh.tick(bridge2);
    results.push(check("國定假日沒收到回覆：不準備，傳「這次先不準備、不提醒」",
      runs2.length === 0 && sent2.some((text) => text.startsWith("📅 今天是國定假日「測試假日二」，沒有收到你對研發週會要不要延期的回覆")), { runs2, sent2 }));
    results.push(check("假日資料一天最多抓一次（測試跨了 8 天，同一天的多次檢查不重抓）", icsFetches <= 8, `抓了 ${icsFetches} 次`));
    return results;
  },

  async fixedUpdate(dir) {
    globalThis.fetch = async () => new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR", { status: 200 });
    const { module, call, notes } = await loadPlugin(dir, "固定會議");
    const file = () => JSON.parse(readFileSync(join(dir, "固定會議.json"), "utf8")).固定會議;
    const results = [];
    results.push(check("修改＝執行（按鈕確認）", module.levels.update_fixed_meeting === "執行", module.levels));
    await call("add_fixed_meeting", { name: "研發會議", time: "每週五 13:30" });
    const dup = await call("add_fixed_meeting", { name: "研發會議", time: "每週二 13:30" });
    results.push(check("同名不能再新增（要改請用 update_fixed_meeting）", !dup.ok && /update_fixed_meeting/.test(dup.text), dup.text));
    await call("change_meeting_once", { name: "研發會議", date: "2026-10-09", new_time: "2026-10-09T13:30" }); // 10/9 照常開
    const minutesOnly = await module.describe.update_fixed_meeting({ name: "研發會議", prep_minutes: 20 });
    results.push(check("只改會前準備：按鈕列出「30 分鐘 → 20 分鐘」，時間不變、不清臨時調整",
      minutesOnly === "修改固定會議：研發會議\n時間：每週五 13:30（不變）\n會前準備：30 分鐘 → 20 分鐘\n會前提醒：15 分鐘（不變）", minutesOnly));
    await call("update_fixed_meeting", { name: "研發會議", prep_minutes: 20 });
    results.push(check("只改分鐘數後，10/9 照常開的紀錄還在", file()[0].會前準備 === 20 && file()[0].例外.length === 1, file()));
    const timeChange = await module.describe.update_fixed_meeting({ name: "研發會議", time: "每週二 13:30" });
    results.push(check("改時間：按鈕列出「每週五 13:30 → 每週二 13:30（下次…）」並說明清掉 1 場臨時調整",
      timeChange === "修改固定會議：研發會議\n時間：每週五 13:30 → 每週二 13:30（下次 10/6（二）13:30）\n會前準備：20 分鐘（不變）\n會前提醒：15 分鐘（不變）\n之前臨時改的 1 場會清掉（時間改了，舊的調整不適用）", timeChange));
    const update = await call("update_fixed_meeting", { name: "研發會議", time: "每週二 13:30" });
    results.push(check("改時間後：只有一筆、每週二 13:30、臨時調整清掉，回覆附「📅 已修改固定會議」",
      update.ok && file().length === 1 && file()[0].時間 === "每週二 13:30" && file()[0].例外.length === 0 &&
      notes.get("固定會議研發會議") === "📅 已修改固定會議「研發會議」：每週二 13:30，會前準備 20 分鐘、會前提醒 15 分鐘，下次 10/6（二）13:30", notes.get("固定會議研發會議")));
    const same = await call("update_fixed_meeting", { name: "研發會議", time: "每週二 13:30" });
    results.push(check("跟原本一樣 → 說沒有要改的", !same.ok && /沒有要改的/.test(same.text), same.text));
    return results;
  },

  async calendarUpdate(dir) {
    const world = { events: [{ id: "x", summary: "開發臨時會議", start: { dateTime: at(13, 30) }, end: { dateTime: at(14, 30) }, status: "confirmed" }] };
    fakeGoogle(world);
    const { module, call, bridge } = await loadPlugin(dir, "行事曆");
    const results = [];
    await call("calendar_events", { from: "2026-10-05", to: "2026-10-05" }); // 先查，才有編號 E1
    const noteOnly = { id: "E1", date: "2026-10-05", start: "13:30", end: "14:30", title: "開發臨時會議", note: "討論C 公司的設備案子" };
    bridge.userText = () => "明天的開發臨時會議也要討論C 公司的設備案子";
    let blocked = "";
    try {
      await module.describe.calendar_update(noteOnly);
    } catch (error) {
      blocked = error.message;
    }
    results.push(check("使用者只是補充討論事項（沒提行事曆）、只改備註 → 直接擋下、請它改提醒就好", /更新提醒就好/.test(blocked), blocked || "沒有擋下"));
    bridge.userText = () => "把要討論的事寫進行事曆的備註";
    const note = await module.describe.calendar_update(noteOnly);
    results.push(check("使用者說要寫進行事曆：按鈕列出「備註：（無） → 討論C 公司的設備案子」", note.includes("\n備註：（無） → 討論C 公司的設備案子"), note));
    const moved = await module.describe.calendar_update({ ...noteOnly, note: undefined, start: "15:00", end: "16:00" });
    results.push(check("改時間（不只備註）照常跳按鈕，不受影響", moved.includes("15:00–16:00"), moved));
    let same = "";
    try {
      await module.describe.calendar_update({ id: "E1", date: "2026-10-05", start: "13:30", end: "14:30", title: "開發臨時會議" });
    } catch (error) {
      same = error.message;
    }
    results.push(check("什麼都沒改：直接擋下（說明「跟原本的行程一樣」），不跳按鈕", /跟原本的行程一樣/.test(same), same || "沒有擋下"));
    const prompt = module.prompt;
    results.push(check("說明：只是補充要討論的事，改提醒就好、不要為了加備註去改行程", prompt.includes("更新提醒就好") && prompt.includes("不要為了加備註去改行程"), "prompt 沒有寫到"));
    return results;
  },

  async brief(dir) {
    const world = {
      unreadOnly: true,
      messages: [
        { id: "m1", from: "王經理 <wang@example.com>", subject: "報價單確認", unread: true },
        { id: "m2", from: "王經理 <wang@example.com>", subject: "已讀的信", unread: false },
      ],
    };
    fakeGoogle(world);
    const { call } = await loadPlugin(dir, "Gmail");
    const results = [];
    const empty = await call("important_mail", {});
    results.push(check("名單是空的：回「名單是空的，不列信件」", empty.ok && empty.text === "重要信件名單是空的，不列信件。", empty.text));
    writeFileSync(join(dir, "通知.json"), JSON.stringify({ 重要信件: { 寄件人: ["王經理"], 主旨關鍵字: [] } }));
    const list = await call("important_mail", {});
    results.push(check("有名單：搜尋未讀、24 小時內", world.lastQuery === "in:inbox is:unread newer_than:1d {from:王經理}", world.lastQuery));
    world.messages.push({ id: "m3", from: "<boss@example.com>", subject: "沒有顯示名稱的寄件人", unread: true });
    const bare = await call("important_mail", {});
    results.push(check("寄件人沒有顯示名稱：顯示信箱、不帶角括號", bare.text.includes("\"寄件人\": \"boss@example.com\"") && !bare.text.includes("<boss@"), bare.text));
    results.push(check("只列寄件人、主旨、時間（沒有內文）", list.ok && list.text.includes("報價單確認") && !list.text.includes("已讀的信") && !/摘要|內文/.test(list.text), list.text));
    const skill = readFileSync(join(dir, ".pi", "skills", "morning-brief", "SKILL.md"), "utf8");
    results.push(check("晨報技能有「要注意的信」段落、名單空的整段拿掉", skill.includes("important_mail") && skill.includes("整段拿掉"), "SKILL.md 沒有寫到"));
    return results;
  },
};
