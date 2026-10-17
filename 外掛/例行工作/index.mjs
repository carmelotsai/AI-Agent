// 例行工作：每天固定時間交給秘書做的事（例如晨報）。設定存在 排程.json；時間到由主程式把指令交給秘書，照樣排隊。
// 跟「提醒」不同：提醒只是把一句話傳給你；例行工作會在沒人看著時呼叫模型、用工具，所以新增、刪除都要你按按鈕。
// 國定假日（含補假）不做，只有「每天 HH:mm」照做；假日資料跟「固定會議」共用 台灣假日.mjs。
// 拿掉這個資料夾再重啟，秘書就不會做例行工作，其他功能照常。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { holidayList, holidayOn } from "../../台灣假日.mjs";

const FILE = "排程.json";
const STATE = join("data", "排程狀態.json"); // 每個例行工作處理到哪一次；程式維護，使用者不用管
const NOON = 12; // 早上的例行工作（例如晨報）錯過了，中午前開機就補做；過了中午不補，改傳一則說明
const DEFAULT_QUIET = ["22:00-07:00", "12:00-13:00"];
const WEEK = "日一二三四五六";
// 時間寫法跟「提醒」外掛一樣（兩個外掛各自一份，拿掉其中一個不影響另一個）
const REPEAT = /^(每天|每個工作日|每週([一二三四五六日])|每月([1-9]|[12]\d|3[01])日) ([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (value) => String(value).padStart(2, "0");
const label = (date) => `${date.getMonth() + 1}/${date.getDate()}（${WEEK[date.getDay()]}）${pad(date.getHours())}:${pad(date.getMinutes())}`;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * 這個時間寫法在 day 這一天有沒有排（有的話回傳那天的時間）。
 * 國定假日（含補假）那天不排，整個跳過不補做——放假不用看晨報、不用覆盤。
 * 只有「每天 HH:mm」例外：使用者寫「每天」就是每天都要，假日照做。
 */
function onDay(repeat, day) {
  const [, kind, weekday, monthDay, hour, minute] = repeat.match(REPEAT);
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), +hour, +minute);
  const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  if (kind === "每天") return at;
  const fits = (kind === "每個工作日" && day.getDay() >= 1 && day.getDay() <= 5) ||
    (weekday && day.getDay() === WEEK.indexOf(weekday)) ||
    (monthDay && day.getDate() === Math.min(+monthDay, lastDay));
  return fits && !holidayOn(ROOT.root, day) ? at : null;
}

/** 最近一次「已經到了」的時間（往回找 62 天）；from 之後的下一次（往後找 62 天）。 */
function previous(repeat, now) {
  for (let offset = 0; offset <= 62; offset++) {
    const at = onDay(repeat, new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
    if (at && at <= now) return at;
  }
  return null;
}
function next(repeat, from) {
  for (let offset = 0; offset <= 62; offset++) {
    const at = onDay(repeat, new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset));
    if (at && at > from) return at;
  }
  return null;
}

/**
 * 該做的時間落在安靜時段裡 → 延到時段結束的那一刻（"22:00-07:00" 這種跨午夜的會延到隔天早上）。
 * 沒落在裡面就原封不動回傳。安靜時段接在一起的話會一路延到最後。
 */
function afterQuiet(ranges, due) {
  const parsed = ranges.map((range) => String(range).match(/^(\d\d):(\d\d)-(\d\d):(\d\d)$/)).filter(Boolean)
    .map((match) => ({ start: +match[1] * 60 + +match[2], end: +match[3] * 60 + +match[4] }));
  let at = new Date(due);
  for (let guard = 0; guard <= parsed.length; guard++) {
    const minutes = at.getHours() * 60 + at.getMinutes();
    const hit = parsed.find(({ start, end }) => (start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end));
    if (!hit) return at;
    // 跨午夜的時段，如果現在還在午夜前那半段，結束時間是「隔天」的
    const nextDay = hit.start > hit.end && minutes >= hit.start ? 1 : 0;
    at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + nextDay, Math.floor(hit.end / 60), hit.end % 60);
  }
  return at;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`${path} 讀不懂，先不做例行工作（修好後不用重啟）：${error.message}`);
    return null;
  }
}

/** 讀 排程.json；格式不對的那幾筆略過並記 log。null：檔案壞了，不要覆寫它。 */
function loadSchedule(root) {
  const data = readJson(join(root, FILE), { 例行工作: [] });
  if (data === null) return null;
  const list = Array.isArray(data.例行工作) ? data.例行工作 : [];
  const fine = list.filter((item) => {
    const ok = item && typeof item.名稱 === "string" && typeof item.要他做的事 === "string" && REPEAT.test(item.時間 ?? "");
    if (!ok) console.error(`排程.json 有一筆格式不對，先略過：${JSON.stringify(item)}`);
    return ok;
  });
  return { data, list, fine, quiet: Array.isArray(data.安靜時段) ? data.安靜時段 : DEFAULT_QUIET };
}

function saveSchedule(root, data) {
  writeFileSync(join(root, FILE), `${JSON.stringify({
    說明: "秘書的例行工作。「時間」寫法：每天 HH:mm、每個工作日 HH:mm、每週一 HH:mm、每月N日 HH:mm。國定假日不做。安靜時段內不主動發訊息，到的例行工作延到時段結束（跨午夜的會延到隔天早上）。可以直接改這個檔案，不用重啟。",
    安靜時段: DEFAULT_QUIET,
    ...data,
  }, null, 2)}\n`);
}

/** 權限等級：新增、刪除例行工作等於幫秘書排班（之後會在沒人看著時呼叫模型、用工具），屬於「執行」，每次按鈕確認。 */
export const levels = { add_routine: "執行", update_routine: "執行", remove_routine: "執行", list_routines: "查閱" };

/** 修改後的樣子；參數不對就丟出錯誤（按鈕說明與實際修改共用，兩邊才會一致）。 */
function updated(root, { name, time, task }) {
  const schedule = loadSchedule(root);
  if (schedule === null) throw new Error("排程.json 格式壞掉了，請使用者先修好或刪掉它");
  const old = schedule.list.find((item) => item?.名稱 === name);
  if (!old) throw new Error(`找不到叫「${name}」的例行工作`);
  if (!time && !task) throw new Error("要改時間（time）或要做的事（task），至少填一個");
  if (time && !REPEAT.test(String(time))) throw new Error(`看不懂時間「${time}」。只能寫：每天 HH:mm、每個工作日 HH:mm、每週一 HH:mm（一～日）、每月N日 HH:mm`);
  const after = { ...old, ...(time ? { 時間: time } : {}), ...(task ? { 要他做的事: String(task).trim() } : {}) };
  return { schedule, old, after };
}

/** 執行級工具的確認說明（按鈕上方顯示的文字）；參數不對就丟出錯誤，直接擋下、不問使用者。 */
export const describe = {
  async add_routine({ name, time, task }) {
    const title = String(name ?? "").trim(), what = String(task ?? "").trim();
    if (!title || !what) throw new Error("例行工作要有名稱和要做的事");
    if (!REPEAT.test(String(time ?? ""))) throw new Error(`看不懂時間「${time}」。只能寫：每天 HH:mm、每個工作日 HH:mm、每週一 HH:mm（一～日）、每月N日 HH:mm`);
    return [
      `新增例行工作：${title}`,
      `時間：${time}（下次 ${label(next(time, new Date()))}）`,
      `要他做的事：${what}`,
    ].join("\n");
  },
  async remove_routine({ name }) {
    return `刪除例行工作：${name}`;
  },
  async update_routine(input) {
    const { old, after } = updated(ROOT.root, input);
    return [
      `修改例行工作：${old.名稱}`,
      old.時間 !== after.時間 ? `時間：${old.時間} → ${after.時間}（下次 ${label(next(after.時間, new Date()))}）` : `時間：${old.時間}（不變）`,
      old.要他做的事 !== after.要他做的事 ? `要他做的事：${old.要他做的事} → ${after.要他做的事}` : `要他做的事：${old.要他做的事}（不變）`,
    ].join("\n");
  },
};
// describe 和 onDay 都是在模組層級的函式，拿不到 bridge；外掛載入時把專案資料夾記在這裡
const ROOT = { root: "." };

/** 加進秘書的 system prompt。 */
export const prompt = [
  "使用者要你每天（或每週、每月）固定時間自動做某件事時（例如「每個工作日早上 8 點給我晨報」），用 add_routine 新增例行工作；系統會先跳按鈕讓他確認。",
  "add_routine 的 task 要寫清楚到時候要做什麼；晨報就寫「照 morning-brief 技能寫今天的晨報」；每週覆盤（檢討這週哪裡做錯）就寫「照 weekly-review 技能做本週覆盤」，時間建議每週五 17:00。只是到時間傳一句話給他的，用提醒（add_reminder），不要用例行工作。",
  "例行工作執行時沒人看著，只能查資料、寫「文件/」、建 Gmail 草稿；寄信、跑指令這類事做不了，使用者要的話請他之後自己叫你做。",
  "使用者要改例行工作的時間或內容（例如「晨報改成 7 點半」），用 update_routine 一次改好；不要先刪再加，那樣他要按兩次按鈕。",
  "例行工作遇到國定假日（含補假）那天不做，也不會補做，使用者不用自己關掉；只有寫「每天 HH:mm」的假日照做。",
  "使用者想馬上跑一次例行工作，請他傳 /run 加名稱，例如 /run 晨報。",
].join("\n");

export default function (pi, bridge) {
  ROOT.root = bridge.root;

  pi.registerTool({
    name: "update_routine",
    label: "修改例行工作",
    description: "修改一個例行工作的時間或要做的事（用名稱指定）。改時間就用這個，不要先刪再加。time 寫法同 add_routine。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "例行工作的名稱，例如「晨報」" },
        time: { type: "string", description: "新的時間，例如「每天 07:30」；不改就不填" },
        task: { type: "string", description: "新的要做的事；不改就不填" },
      },
      required: ["name"],
    },
    async execute(_toolCallId, input) {
      const { schedule, old, after } = updated(bridge.root, input);
      saveSchedule(bridge.root, { ...schedule.data, 例行工作: schedule.list.map((item) => (item === old ? after : item)) });
      const text = `已修改例行工作「${after.名稱}」：${after.時間}，下次 ${label(next(after.時間, new Date()))}`;
      bridge.setReplyNote(`例行工作${after.名稱}`, `🕗 ${text}`);
      return { content: [{ type: "text", text: `${text}（使用者已經按了同意，已經完成，不用再請使用者確認）。` }], details: {} };
    },
  });

  pi.registerTool({
    name: "add_routine",
    label: "新增例行工作",
    description: "新增一個例行工作：時間到系統會把 task 交給你做，做完把結果傳給使用者。time 只能寫：每天 HH:mm、每個工作日 HH:mm、每週一 HH:mm（一～日）、每月N日 HH:mm。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "名稱，短一點，例如「晨報」；/run 時用這個名稱" },
        time: { type: "string", description: "例如「每個工作日 08:00」" },
        task: { type: "string", description: "到時候要你做的事，例如「照 morning-brief 技能寫今天的晨報」" },
      },
      required: ["name", "time", "task"],
    },
    async execute(_toolCallId, { name, time, task }) {
      await describe.add_routine({ name, time, task }); // 再檢查一次參數
      const schedule = loadSchedule(bridge.root);
      if (schedule === null) throw new Error("排程.json 格式壞掉了，請使用者先修好或刪掉它");
      const title = name.trim();
      if (schedule.list.some((item) => item?.名稱 === title)) throw new Error(`已經有叫「${title}」的例行工作，換個名稱或先刪掉舊的`);
      saveSchedule(bridge.root, { ...schedule.data, 例行工作: [...schedule.list, { 名稱: title, 時間: time, 要他做的事: task.trim() }] });
      const text = `已新增例行工作「${title}」：${time}，下次 ${label(next(time, new Date()))}`;
      bridge.setReplyNote(`例行工作${title}`, `🕗 ${text}（要馬上試跑請傳 /run ${title}）`);
      return { content: [{ type: "text", text: `${text}（使用者已經按了同意，已經完成，不用再請使用者確認）。` }], details: {} };
    },
  });

  pi.registerTool({
    name: "remove_routine",
    label: "刪除例行工作",
    description: "刪除一個例行工作（用名稱）。",
    parameters: { type: "object", properties: { name: { type: "string", description: "例行工作的名稱" } }, required: ["name"] },
    async execute(_toolCallId, { name }) {
      const schedule = loadSchedule(bridge.root);
      if (schedule === null) throw new Error("排程.json 格式壞掉了，請使用者先修好或刪掉它");
      if (!schedule.list.some((item) => item?.名稱 === name)) throw new Error(`找不到叫「${name}」的例行工作`);
      saveSchedule(bridge.root, { ...schedule.data, 例行工作: schedule.list.filter((item) => item?.名稱 !== name) });
      bridge.setReplyNote(`例行工作${name}`, `🗑️ 已刪除例行工作「${name}」`);
      return { content: [{ type: "text", text: `已刪除例行工作「${name}」（使用者已經按了同意，已經完成，不用再請使用者確認）。` }], details: {} };
    },
  });

  pi.registerTool({
    name: "list_routines",
    label: "列出例行工作",
    description: "列出所有例行工作與下次執行時間。",
    parameters: { type: "object", properties: {} },
    async execute() {
      const schedule = loadSchedule(bridge.root);
      if (schedule === null) throw new Error("排程.json 格式壞掉了，請使用者先修好或刪掉它");
      const now = new Date();
      const text = schedule.fine.length === 0
        ? "目前沒有例行工作。"
        : [`目前共 ${schedule.fine.length} 件例行工作：`, ...schedule.fine.map((item, index) =>
          `${index + 1}. ${item.名稱}：${item.時間}（下次 ${label(next(item.時間, now))}）— ${item.要他做的事}`)].join("\n");
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}

/** Telegram 指令：/run 名稱 → 立刻照例行工作的規矩跑一次（照樣排隊）。 */
export const commands = {
  async run(args, bridge) {
    const schedule = loadSchedule(bridge.root);
    if (schedule === null) return "排程.json 格式壞掉了，請先修好或刪掉它。";
    const name = args.trim();
    if (!name) {
      return schedule.fine.length === 0
        ? "目前沒有例行工作。"
        : `要跑哪一個？例如 /run ${schedule.fine[0].名稱}\n目前有：${schedule.fine.map((item) => item.名稱).join("、")}`;
    }
    const routine = schedule.fine.find((item) => item.名稱 === name);
    if (!routine) return `沒有叫「${name}」的例行工作。目前有：${schedule.fine.map((item) => item.名稱).join("、") || "（無）"}`;
    const state = readJson(join(bridge.root, STATE), {}) ?? {};
    state[`做過|${routine.名稱}｜${routine.時間}`] = new Date().toISOString();
    mkdirSync(join(bridge.root, "data"), { recursive: true });
    writeFileSync(join(bridge.root, STATE), `${JSON.stringify(state, null, 2)}\n`);
    bridge.runRoutine({ name: routine.名稱, task: routine.要他做的事 }, "/run 立刻執行");
    return null; // 不另外回話：結果做完會自己傳過去
  },
};

/** /status 顯示：每個例行工作的時間、下次什麼時候、上次做了沒。 */
export const statusOrder = 2;
export function status(bridge) {
  const schedule = loadSchedule(bridge.root);
  if (schedule === null) return "🕗 例行工作：排程.json 讀不懂，請修好或刪掉它";
  if (schedule.fine.length === 0) return "🕗 例行工作：沒有";
  const state = readJson(join(bridge.root, STATE), {}) ?? {};
  const now = new Date();
  return [
    `🕗 例行工作：${schedule.fine.length} 件（國定假日不做；安靜時段 ${schedule.quiet.join("、")} 不打擾你）`,
    ...schedule.fine.map((item) => {
      const last = state[`做過|${item.名稱}｜${item.時間}`];
      return `　- ${item.名稱}：${item.時間}，下次 ${label(next(item.時間, now))}${last ? `，上次 ${label(new Date(last))}` : "，還沒做過"}`;
    }),
  ].join("\n");
}

/**
 * 每 30 秒由主程式呼叫：到時間的例行工作交給秘書（不等它做完，結果由主程式傳給使用者）。
 * 安靜時段內先不做；錯過的（電腦沒開）中午前補做、過了中午不補，改傳一則說明。
 */
export async function tick(bridge) {
  await holidayList(bridge.root); // 每天最多抓一次；沒裝「固定會議」外掛時也要有假日資料
  const schedule = loadSchedule(bridge.root);
  if (schedule === null || schedule.fine.length === 0) return;
  const statePath = join(bridge.root, STATE);
  const state = readJson(statePath, {}) ?? {};
  const now = new Date();
  let changed = false;
  for (const routine of schedule.fine) {
    const key = `${routine.名稱}｜${routine.時間}`; // 改了時間就當成新的
    const due = previous(routine.時間, now);
    if (!state[key]) {
      // 剛新增（或剛改時間）：從現在開始算，不追做以前的
      state[key] = now.toISOString();
      changed = true;
      continue;
    }
    if (!due || due <= new Date(state[key])) continue; // 這一次已經處理過
    // 安靜時段：延到時段結束才做，而且是從「延後後的時間」算準不準時、該不該補做
    // （不然排在 23:00 的例行工作延到隔天 07:00 就跨日了，會被當成錯過、永遠做不到）
    const sendAt = afterQuiet(schedule.quiet, due);
    if (now < sendAt) continue; // 還在安靜時段裡，或還沒到該做的時間
    const delayed = +sendAt !== +due;
    const late = Math.round((now - sendAt) / 60_000);
    const cutoff = sendAt.getHours() < NOON
      ? new Date(sendAt.getFullYear(), sendAt.getMonth(), sendAt.getDate(), NOON)
      : new Date(sendAt.getFullYear(), sendAt.getMonth(), sendAt.getDate(), 23, 59);
    state[key] = now.toISOString();
    changed = true;
    if (now < cutoff && sameDay(now, sendAt)) {
      state[`做過|${key}`] = now.toISOString(); // /status 的「上次」只算真的交給秘書那幾次（key 本身還包含「只是看到、不用補做」）
      const why = delayed
        ? `原定 ${label(due)}，安靜時段結束後做${late <= 2 ? "" : `（又晚了 ${late} 分鐘）`}`
        : late <= 2 ? `${routine.時間}` : `原定 ${label(due)}，晚了 ${late} 分鐘補做`;
      bridge.runRoutine({ name: routine.名稱, task: routine.要他做的事 }, why);
    } else {
      await bridge.notify(`🕗 ${label(due)} 的例行工作「${routine.名稱}」沒有做：${delayed ? `安靜時段結束後（${label(sendAt)}）` : "那時"}秘書沒有在執行，過了${sendAt.getHours() < NOON ? "中午" : "當天"}就不補。要看的話傳 /run ${routine.名稱}`);
    }
  }
  if (changed) {
    mkdirSync(join(bridge.root, "data"), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }
}
