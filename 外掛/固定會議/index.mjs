// 固定會議：沒有放在行事曆、但固定時間開的會（例如每週二 13:30 研發週會）。
// 開會前先整理上一次的會議紀錄（會前準備，照例行工作的規矩）、開會前 15 分鐘提醒；
// 遇到國定假日，前一天先問使用者要不要延期；臨時改時間由使用者告訴秘書，只改那一次。
// 設定在 固定會議.json；假日資料跟「例行工作」共用 台灣假日.mjs（Google 台灣假日行事曆，只算「國定假日」）。
// 拿掉這個資料夾再重啟，就不會有固定會議的準備和提醒，其他功能照常。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { holidayList, holidayOn } from "../../台灣假日.mjs";

const FILE = "固定會議.json";
const STATE = join("data", "固定會議狀態.json"); // 哪一場已經準備、提醒、詢問過
const ASK_AT = "09:00"; // 會議那天是假日：前一天幾點問使用者要不要延期
const LOOKAHEAD_DAYS = 8;
const WEEK = "日一二三四五六";
// 時間寫法跟「提醒」「例行工作」一樣，但固定會議不用「每天」
const REPEAT = /^(每個工作日|每週([一二三四五六日])|每月([1-9]|[12]\d|3[01])日) ([01]\d|2[0-3]):([0-5]\d)$/;
const AT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (value) => String(value).padStart(2, "0");
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
const label = (date) => `${date.getMonth() + 1}/${date.getDate()}（${WEEK[date.getDay()]}）${clock(date)}`;
const dayLabel = (date) => `${date.getMonth() + 1}/${date.getDate()}（${WEEK[date.getDay()]}）`;

/** 規則在某一天有沒有排（有的話回傳那天開會的時間）。 */
function onDay(rule, day) {
  const [, kind, weekday, monthDay, hour, minute] = rule.match(REPEAT);
  const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  const fits = (kind === "每個工作日" && day.getDay() >= 1 && day.getDay() <= 5) ||
    (weekday && day.getDay() === WEEK.indexOf(weekday)) ||
    (monthDay && day.getDate() === Math.min(+monthDay, lastDay));
  return fits ? new Date(day.getFullYear(), day.getMonth(), day.getDate(), +hour, +minute) : null;
}

/**
 * 接下來幾天的每一場：{ 原本, 開始（改過的時間；取消是 null）, 改過 }。
 * 例外（臨時改時間、取消）以「原本那天的日期」為準。
 */
function occurrences(meeting, from, days = LOOKAHEAD_DAYS) {
  const list = [];
  for (let offset = -7; offset <= days; offset++) { // 往回 7 天：上週那場被改到這幾天的也找得到
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    const planned = onDay(meeting.時間, day);
    if (!planned) continue;
    const change = (meeting.例外 ?? []).find((item) => item.日期 === ymd(planned));
    let start = planned;
    if (change?.改成 === "取消") start = null;
    else if (change && AT.test(change.改成 ?? "")) {
      const [, y, mo, d, h, mi] = change.改成.match(AT);
      start = new Date(+y, mo - 1, +d, +h, +mi);
    }
    list.push({ 原本: planned, 開始: start, 改過: Boolean(change) });
  }
  // 延期剛好落在本來就有的那一場（例如「延到下週五同一時間」）＝那兩場其實是同一場，
  // 合成一場才不會準備兩次、提醒兩次；留下沒改過的那筆，標示也就不會寫「臨時改的」。
  const merged = new Map();
  for (const item of list) {
    const key = item.開始 ? `開始|${+item.開始}` : `取消|${+item.原本}`; // 取消的沒有開始時間，各自算一場
    const kept = merged.get(key);
    if (!kept || (kept.改過 && !item.改過)) merged.set(key, item);
  }
  // 照實際開會時間排序：臨時改到別天的，才不會卡在原本那天的位置上（「下一場」要看得準）
  return [...merged.values()].sort((a, b) => (a.開始 ?? a.原本) - (b.開始 ?? b.原本));
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`${path} 讀不懂：${error.message}`);
    return null;
  }
}

/** 讀 固定會議.json；null：檔案壞了，不要覆寫。 */
function load(root) {
  const data = readJson(join(root, FILE), { 固定會議: [] });
  if (data === null) return null;
  const list = (Array.isArray(data.固定會議) ? data.固定會議 : []).filter((item) => {
    const ok = item && typeof item.名稱 === "string" && REPEAT.test(item.時間 ?? "");
    if (!ok) console.error(`固定會議.json 有一筆格式不對，先略過：${JSON.stringify(item)}`);
    return ok;
  });
  return { data, list };
}

function save(root, data, list) {
  writeFileSync(join(root, FILE), `${JSON.stringify({
    說明: "固定時間開的會（沒有放在行事曆的）。「時間」寫法：每週二 13:30、每個工作日 09:00、每月1日 10:00。會前準備、會前提醒是開會前幾分鐘（0 = 不要）。例外：某一場改時間（改成 YYYY-MM-DDTHH:mm）或「取消」，以原本那天的日期為準。可以直接改，不用重啟。",
    ...data,
    固定會議: list,
  }, null, 2)}\n`);
}


/** 午休規則（跟行事曆的會前提醒一樣，設定在 通知.json 的「會前提醒」）：提醒、準備的時間落在午休時段，提前到午休前。 */
function lunchShift(root, at) {
  let settings = {};
  try {
    settings = JSON.parse(readFileSync(join(root, "通知.json"), "utf8")).會前提醒 ?? {};
  } catch {}
  const range = /^\d\d:\d\d-\d\d:\d\d$/.test(settings.午休時段 ?? "") ? settings.午休時段 : "12:00-13:00";
  const early = /^\d\d:\d\d$/.test(settings.午休前提醒時間 ?? "") ? settings.午休前提醒時間 : "11:50";
  const [from, to] = range.split("-").map((text) => +text.slice(0, 2) * 60 + +text.slice(3));
  const minutes = at.getHours() * 60 + at.getMinutes();
  if (minutes < from || minutes >= to) return at;
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), +early.slice(0, 2), +early.slice(3));
}

function checkMeeting({ name, time, prep_minutes, remind_minutes }) {
  const title = String(name ?? "").trim();
  if (!title || title.length > 30) throw new Error("會議名稱要是 1～30 個字");
  if (!REPEAT.test(String(time ?? ""))) throw new Error(`看不懂時間「${time}」。只能寫：每週二 13:30、每個工作日 09:00、每月1日 10:00`);
  const minutes = (value, fallback) => (value === undefined || value === null || value === "" ? fallback : Number(value));
  const prep = minutes(prep_minutes, 30), remind = minutes(remind_minutes, 15);
  for (const value of [prep, remind]) if (!Number.isInteger(value) || value < 0 || value > 180) throw new Error("開會前幾分鐘要是 0～180 的整數（0 = 不要）");
  return { 名稱: title, 時間: time, 會前準備: prep, 會前提醒: remind, 例外: [] };
}

/** 臨時改一場：找出原本那一場、檢查新時間。按鈕說明不需要（擬稿級），但回覆最後由程式附上改前改後。 */
function checkChange(meeting, { date, new_time, cancel }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ""))) throw new Error("date 要寫原本那一場的日期 YYYY-MM-DD");
  const [y, m, d] = date.split("-").map(Number);
  const planned = onDay(meeting.時間, new Date(y, m - 1, d));
  if (!planned) throw new Error(`${date} 不是「${meeting.名稱}」原本開會的日子（${meeting.時間}）`);
  if (cancel) return { planned, change: { 日期: date, 改成: "取消" } };
  if (!AT.test(String(new_time ?? ""))) throw new Error("new_time 要寫成 YYYY-MM-DDTHH:mm；這次不開就用 cancel");
  const [, ny, nmo, nd, nh, nmi] = new_time.match(AT);
  const moved = new Date(+ny, nmo - 1, +nd, +nh, +nmi);
  if (moved <= new Date()) throw new Error(`${label(moved)} 已經過了`);
  return { planned, moved, change: { 日期: date, 改成: new_time } };
}

let pluginRoot = "."; // 按鈕說明要讀設定檔（外掛載入時設定）

/**
 * 修改固定會議後的樣子（按鈕說明與實際修改共用）。
 * 時間改了，以前的臨時調整（以原本日期為準）就不適用，一起清掉；只改分鐘數就保留。
 */
function updatedMeeting(root, { name, time, prep_minutes, remind_minutes }) {
  const schedule = load(root);
  if (schedule === null) throw new Error("固定會議.json 格式壞掉了，請使用者先修好或刪掉它");
  const old = schedule.list.find((item) => item.名稱 === name);
  if (!old) throw new Error(`沒有叫「${name}」的固定會議`);
  const pick = (value, fallback) => (value === undefined || value === null || value === "" ? fallback : value);
  const checked = checkMeeting({ name, time: pick(time, old.時間), prep_minutes: pick(prep_minutes, old.會前準備), remind_minutes: pick(remind_minutes, old.會前提醒) });
  if (checked.時間 === old.時間 && checked.會前準備 === old.會前準備 && checked.會前提醒 === old.會前提醒) throw new Error("跟原本的設定一樣，沒有要改的");
  const timeChanged = checked.時間 !== old.時間;
  const cleared = timeChanged ? (old.例外 ?? []).filter((item) => new Date(`${item.日期}T23:59`) > new Date()).length : 0;
  return { ...schedule, old, after: { ...checked, 例外: timeChanged ? [] : (old.例外 ?? []) }, cleared };
}

/** 權限等級：新增、修改、刪除固定會議會讓秘書在沒人看著時做事（會前準備），屬於「執行」；臨時改一場的時間是「擬稿」（不新增工作，回覆會附改前改後）。 */
export const levels = {
  add_fixed_meeting: "執行", update_fixed_meeting: "執行", remove_fixed_meeting: "執行",
  list_fixed_meetings: "查閱", change_meeting_once: "擬稿",
};

export const describe = {
  async add_fixed_meeting(input) {
    const meeting = checkMeeting(input);
    return [
      `新增固定會議：${meeting.名稱}（${meeting.時間}）`,
      meeting.會前準備 ? `開會前 ${meeting.會前準備} 分鐘：整理 文件/ 裡上一次的會議紀錄給你` : "會前準備：不要",
      meeting.會前提醒 ? `開會前 ${meeting.會前提醒} 分鐘：提醒你` : "會前提醒：不要",
      `遇到國定假日：前一天 ${ASK_AT} 問你要不要延期`,
    ].join("\n");
  },
  async update_fixed_meeting(input) {
    const { old, after, cleared } = updatedMeeting(pluginRoot, input);
    const minutes = (value) => (value ? `${value} 分鐘` : "不要");
    const line = (title, before, now, show = (value) => value) =>
      before === now ? `${title}：${show(now)}（不變）` : `${title}：${show(before)} → ${show(now)}`;
    const next = occurrences(after, new Date()).find((item) => item.開始 && item.開始 > new Date());
    return [
      `修改固定會議：${old.名稱}`,
      line("時間", old.時間, after.時間) + (old.時間 !== after.時間 && next ? `（下次 ${label(next.開始)}）` : ""),
      line("會前準備", old.會前準備, after.會前準備, minutes),
      line("會前提醒", old.會前提醒, after.會前提醒, minutes),
      ...(cleared ? [`之前臨時改的 ${cleared} 場會清掉（時間改了，舊的調整不適用）`] : []),
    ].join("\n");
  },
  async remove_fixed_meeting({ name }) {
    return `刪除固定會議：${name}（之後不再準備、不再提醒）`;
  },
};

export const prompt = [
  "沒有放在行事曆、但固定時間開的會（例如「研發週會每週二 13:30」），用 add_fixed_meeting 設定；系統會在開會前整理上一次的會議紀錄、開會前提醒，遇到國定假日前一天會問使用者要不要延期。",
  "使用者說某一場臨時改時間或不開（例如「這週研發週會改到週三 10:00」「下週研發週會取消」「照常開」），用 change_meeting_once 只改那一場：date 填原本那一場的日期，new_time 填新的時間，不開就 cancel。遇到國定假日、使用者回「照常開」時，也要用 change_meeting_once，new_time 填原本的時間（不然系統會當成沒回覆，那次不準備、不提醒）。日期照【現在時間】附的這週、下週範圍換算。",
  "使用者要以後都改（例如「研發會議以後改成每週二下午 1 點半」「會前準備改成 20 分鐘前」），用 update_fixed_meeting 一次改好；不要先刪再加，也不要用 add_fixed_meeting 重設。",
  "問固定會議、下次什麼時候開，用 list_fixed_meetings。",
].join("\n");

export default function (pi, bridge) {
  pluginRoot = bridge.root;
  const text = (value) => ({ content: [{ type: "text", text: value }], details: {} });
  const loadOrThrow = () => {
    const schedule = load(bridge.root);
    if (schedule === null) throw new Error("固定會議.json 格式壞掉了，請使用者先修好或刪掉它");
    return schedule;
  };

  pi.registerTool({
    name: "add_fixed_meeting",
    label: "新增固定會議",
    description: "新增一個固定時間開的會（沒有放在行事曆的）。time 寫法：每週二 13:30、每個工作日 09:00、每月1日 10:00。prep_minutes：開會前幾分鐘整理上一次的會議紀錄（預設 30，0 = 不要）；remind_minutes：開會前幾分鐘提醒（預設 15，0 = 不要）。系統會先跳按鈕讓使用者確認。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "會議名稱，例如「研發週會」；整理紀錄時會用這個名稱找" },
        time: { type: "string", description: "例如「每週二 13:30」" },
        prep_minutes: { type: "number", description: "預設 30" },
        remind_minutes: { type: "number", description: "預設 15" },
      },
      required: ["name", "time"],
    },
    async execute(_toolCallId, input) {
      const meeting = checkMeeting(input);
      const { data, list } = loadOrThrow();
      if (list.some((item) => item.名稱 === meeting.名稱)) throw new Error(`已經有叫「${meeting.名稱}」的固定會議；要改設定請用 update_fixed_meeting`);
      save(bridge.root, data, [...list, meeting]);
      const next = occurrences(meeting, new Date()).find((item) => item.開始 && item.開始 > new Date());
      bridge.setReplyNote(`固定會議${meeting.名稱}`, `📅 已設定固定會議「${meeting.名稱}」：${meeting.時間}${next ? `，下次 ${label(next.開始)}` : ""}`);
      return text(`已設定（使用者已經按了同意，已經完成，不用再請使用者確認）固定會議「${meeting.名稱}」：${meeting.時間}。`);
    },
  });

  pi.registerTool({
    name: "update_fixed_meeting",
    label: "修改固定會議",
    description: "以後都改：修改固定會議的時間、會前準備或會前提醒的分鐘數（沒給的欄位維持原本）。只改某一場用 change_meeting_once。系統會先跳按鈕讓使用者確認。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "固定會議的名稱" },
        time: { type: "string", description: "新的時間，例如「每週二 13:30」；不改就不填" },
        prep_minutes: { type: "number", description: "新的會前準備分鐘數（0 = 不要）；不改就不填" },
        remind_minutes: { type: "number", description: "新的會前提醒分鐘數（0 = 不要）；不改就不填" },
      },
      required: ["name"],
    },
    async execute(_toolCallId, input) {
      const { data, list, old, after } = updatedMeeting(bridge.root, input);
      save(bridge.root, data, list.map((item) => (item === old ? after : item)));
      const next = occurrences(after, new Date()).find((item) => item.開始 && item.開始 > new Date());
      bridge.setReplyNote(`固定會議${after.名稱}`, `📅 已修改固定會議「${after.名稱}」：${after.時間}，會前準備 ${after.會前準備 || "不要"}${after.會前準備 ? " 分鐘" : ""}、會前提醒 ${after.會前提醒 || "不要"}${after.會前提醒 ? " 分鐘" : ""}${next ? `，下次 ${label(next.開始)}` : ""}`);
      return text(`已修改（使用者已經按了同意，已經完成，不用再請使用者確認）固定會議「${after.名稱}」。`);
    },
  });

  pi.registerTool({
    name: "remove_fixed_meeting",
    label: "刪除固定會議",
    description: "刪除一個固定會議。系統會先跳按鈕讓使用者確認。",
    parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    async execute(_toolCallId, { name }) {
      const { data, list } = loadOrThrow();
      if (!list.some((item) => item.名稱 === name)) throw new Error(`沒有叫「${name}」的固定會議`);
      save(bridge.root, data, list.filter((item) => item.名稱 !== name));
      bridge.setReplyNote(`固定會議${name}`, `🗑️ 已刪除固定會議「${name}」`);
      return text(`已刪除（使用者已經按了同意，已經完成，不用再請使用者確認）固定會議「${name}」。`);
    },
  });

  pi.registerTool({
    name: "change_meeting_once",
    label: "臨時改一場會議",
    description: "只改固定會議的某一場：date 填原本那一場的日期（YYYY-MM-DD），new_time 填新時間（YYYY-MM-DDTHH:mm）；這場不開就 cancel: true；國定假日照常開，new_time 填原本的時間。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "固定會議的名稱" },
        date: { type: "string", description: "原本那一場的日期 YYYY-MM-DD" },
        new_time: { type: "string", description: "新的時間 YYYY-MM-DDTHH:mm" },
        cancel: { type: "boolean", description: "這場不開" },
      },
      required: ["name", "date"],
    },
    async execute(_toolCallId, input) {
      const { data, list } = loadOrThrow();
      const meeting = list.find((item) => item.名稱 === input.name);
      if (!meeting) throw new Error(`沒有叫「${input.name}」的固定會議`);
      const { planned, moved, change } = checkChange(meeting, input);
      meeting.例外 = [...(meeting.例外 ?? []).filter((item) => item.日期 !== change.日期), change]
        .filter((item) => new Date(`${item.日期}T23:59`) > new Date(Date.now() - 7 * 86_400_000)); // 一週前的例外清掉
      save(bridge.root, data, list);
      const after = !moved ? "這次不開" : moved.getTime() === planned.getTime() ? "照常開" : `改到 ${label(moved)}`;
      bridge.setReplyNote(`固定會議${meeting.名稱}`, `📅 ${meeting.名稱}：${label(planned)} → ${after}`);
      return text(`已改：${meeting.名稱} ${label(planned)} → ${after}。`);
    },
  });

  pi.registerTool({
    name: "list_fixed_meetings",
    label: "列出固定會議",
    description: "列出固定會議與接下來一週的場次（含臨時改時間、國定假日）。",
    parameters: { type: "object", properties: {} },
    async execute() {
      const { list } = loadOrThrow();
      if (list.length === 0) return text("目前沒有固定會議。");
      const days = await holidayList(bridge.root);
      const now = new Date();
      return text(list.map((meeting) => {
        const coming = occurrences(meeting, now, 15).filter((item) => (item.開始 ?? item.原本) > now).slice(0, 2).map((item) => {
          const holiday = days[ymd(item.原本)];
          if (!item.開始) return `${dayLabel(item.原本)} 不開`;
          return `${label(item.開始)}${item.改過 ? `（原本 ${label(item.原本)}）` : ""}${holiday && !item.改過 ? `（${holiday}，國定假日：前一天會問你要不要延期）` : ""}`;
        });
        return `${meeting.名稱}：${meeting.時間}，會前準備 ${meeting.會前準備 || "不要"}${meeting.會前準備 ? " 分鐘" : ""}、會前提醒 ${meeting.會前提醒 || "不要"}${meeting.會前提醒 ? " 分鐘" : ""}\n  接下來：${coming.join("、") || "（無）"}`;
      }).join("\n"));
    },
  });
}

/** /status 顯示：每個固定會議的時間、下一場（含臨時改過的）。 */
export const statusOrder = 3;
export function status(bridge) {
  const schedule = load(bridge.root);
  if (schedule === null) return "📅 固定會議：固定會議.json 讀不懂，請修好或刪掉它";
  if (schedule.list.length === 0) return "📅 固定會議：沒有";
  const now = new Date();
  return [
    `📅 固定會議：${schedule.list.length} 個`,
    ...schedule.list.map((meeting) => {
      const coming = occurrences(meeting, now).find((item) => (item.開始 ?? item.原本) > now);
      const holiday = coming && !coming.改過 && holidayOn(bridge.root, coming.原本); // 已經抓過才有；沒抓到就不標假日
      const when = !coming ? "（算不出下一場）"
        : !coming.開始 ? `下一場 ${dayLabel(coming.原本)} 不開`
        : `下一場 ${label(coming.開始)}${coming.改過 ? `（原本 ${label(coming.原本)}）` : holiday ? `（${holiday}，會先問你要不要延期）` : ""}`;
      const extras = [meeting.會前準備 ? `會前 ${meeting.會前準備} 分鐘整理上次紀錄` : "", meeting.會前提醒 ? `會前 ${meeting.會前提醒} 分鐘提醒` : ""].filter(Boolean).join("、");
      return `　- ${meeting.名稱}：${meeting.時間}，${when}${extras ? `；${extras}` : ""}`;
    }),
  ].join("\n");
}

/**
 * 每 30 秒由主程式呼叫：
 * - 會議那天是國定假日、而且還沒改過 → 前一天 09:00 問要不要延期；到開會時間還沒回 → 這次不準備、不提醒，傳一則說明。
 * - 其他 → 開會前 N 分鐘交給秘書做會前準備（例行工作）、開會前 M 分鐘提醒。
 */
export async function tick(bridge) {
  const schedule = load(bridge.root);
  if (schedule === null || schedule.list.length === 0) return;
  const days = await holidayList(bridge.root);
  const statePath = join(bridge.root, STATE);
  const done = readJson(statePath, {}) ?? {};
  const now = new Date();
  let changed = false;
  const mark = (key) => {
    done[key] = now.toISOString();
    changed = true;
  };
  for (const meeting of schedule.list) {
    for (const item of occurrences(meeting, now)) {
      const id = `${meeting.名稱}|${ymd(item.原本)}`;
      const holiday = !item.改過 && days[ymd(item.原本)];
      if (holiday) {
        const ask = new Date(item.原本.getFullYear(), item.原本.getMonth(), item.原本.getDate() - 1, +ASK_AT.slice(0, 2), +ASK_AT.slice(3));
        if (!done[`詢問|${id}`] && now >= ask && now < item.原本) {
          mark(`詢問|${id}`);
          await bridge.notify(`📅 ${dayLabel(item.原本)}是國定假日「${holiday}」，${meeting.名稱}（${clock(item.原本)}）要延期嗎？\n回我例如「延到週三 ${clock(item.原本)}」「這週取消」或「照常開」。`);
        }
        const prepAt = new Date(item.原本.getTime() - (meeting.會前準備 || meeting.會前提醒 || 0) * 60_000);
        if (!done[`假日|${id}`] && now >= prepAt && now < item.原本) {
          mark(`假日|${id}`);
          await bridge.notify(`📅 今天是國定假日「${holiday}」，沒有收到你對${meeting.名稱}要不要延期的回覆，這次先不準備、不提醒。要開的話跟我說新的時間。`);
        }
        continue;
      }
      if (!item.開始 || now >= item.開始) continue; // 取消了、或已經開始
      const key = `${id}|${item.開始.toISOString()}`; // 改過時間就重新算
      const prepAt = lunchShift(bridge.root, new Date(item.開始.getTime() - meeting.會前準備 * 60_000));
      const remindAt = lunchShift(bridge.root, new Date(item.開始.getTime() - meeting.會前提醒 * 60_000));
      if (meeting.會前準備 && !done[`準備|${key}`] && now >= prepAt) {
        mark(`準備|${key}`);
        bridge.runRoutine?.(
          { name: `會前準備：${meeting.名稱}`, task: `照 meeting-prep 技能，整理「${meeting.名稱}」上一次的會議紀錄。這次的會：${meeting.名稱}（${ymd(item.開始)} ${clock(item.開始)}${item.改過 ? `，原本 ${label(item.原本)}，臨時改的` : ""}）。` },
          `${clock(item.開始)} 開會前 ${meeting.會前準備} 分鐘`,
        );
      }
      if (meeting.會前提醒 && !done[`提醒|${key}`] && now >= remindAt) {
        mark(`提醒|${key}`);
        const minutes = Math.max(1, Math.round((item.開始 - now) / 60_000));
        const lead = minutes > meeting.會前提醒 + 1 && remindAt < new Date(item.開始.getTime() - meeting.會前提醒 * 60_000)
          ? `📅 ${clock(item.開始)} ${meeting.名稱}\n午休前先提醒你`
          : `📅 ${minutes} 分鐘後：${meeting.名稱}（${clock(item.開始)}）`;
        await bridge.notify(`${lead}${item.改過 ? `\n（這次臨時改的，原本 ${label(item.原本)}）` : ""}`);
      }
    }
  }
  // 兩週前的紀錄刪掉
  for (const [key, value] of Object.entries(done)) {
    if (now - new Date(value) > 14 * 86_400_000) {
      delete done[key];
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(join(bridge.root, "data"), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(done, null, 2)}\n`);
  }
}
