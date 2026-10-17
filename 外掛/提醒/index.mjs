// 提醒：使用者說「明天下午 3 點提醒我…」，秘書用工具記進 提醒.json；時間到由程式直接傳給使用者，不經模型。
// 拿掉這個資料夾再重啟，秘書就不會設提醒（會照實說他做不到），其他功能照常。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { holidayOn } from "../../台灣假日.mjs";

const FILE = "提醒.json";
const LATE_MINUTES = 2; // 晚超過 2 分鐘才送出，就註明原定時間（電腦關機、睡眠時錯過的）
const MAX_TEXT = 200;
const WEEK = "日一二三四五六";
const REPEAT = /^(每天|每個工作日|每週([一二三四五六日])|每月([1-9]|[12]\d|3[01])日) ([01]\d|2[0-3]):([0-5]\d)$/;
const pad = (value) => String(value).padStart(2, "0");
const NL = "\n";

/** 時間寫成給人看的樣子：10/5（一）09:00 */
const label = (date) => `${date.getMonth() + 1}/${date.getDate()}（${WEEK[date.getDay()]}）${pad(date.getHours())}:${pad(date.getMinutes())}`;
/** 存檔用的本地時間：2026-10-05T09:00 */
const local = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** 一次性的時間：只接受 YYYY-MM-DDTHH:mm（本地時間）。 */
function parseAt(at) {
  const match = String(at ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  const date = match && new Date(+match[1], match[2] - 1, +match[3], +match[4], +match[5]);
  if (!date || date.getMonth() !== match[2] - 1 || date.getDate() !== +match[3]) {
    throw new Error(`時間格式不對：「${at}」，要寫成 YYYY-MM-DDTHH:mm，例如 2026-10-05T09:00`);
  }
  return date;
}

/** 循環提醒在 after 之後的下一次。每月 31 日這類，遇到小月就用月底那天。 */
function nextRepeat(repeat, after) {
  const match = repeat.match(REPEAT);
  if (!match) throw new Error(`看不懂「${repeat}」。循環只能寫：每天 HH:mm、每個工作日 HH:mm、每週一 HH:mm（一～日）、每月N日 HH:mm`);
  const [, kind, weekday, monthDay, hour, minute] = match;
  for (let offset = 0; offset <= 62; offset++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset, +hour, +minute);
    if (day <= after) continue;
    const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    if (kind === "每天" ||
      (kind === "每個工作日" && day.getDay() >= 1 && day.getDay() <= 5) ||
      (weekday && day.getDay() === WEEK.indexOf(weekday)) ||
      (monthDay && day.getDate() === Math.min(+monthDay, lastDay))) return day;
  }
  throw new Error(`算不出「${repeat}」的下一次`);
}

// ── 待辦追蹤：白天每隔幾小時問一次「這幾件還沒回報」，收工時給一份清單 ──
const TODO_FILE = "待辦.json";
const TODO_DEFAULT = { 開啟: false, 只在工作日: true, 從幾點開始: "09:30", 每幾小時: 2, 收工時間: "18:00" };

/** 今天放假嗎？放假回傳原因（「週末」或假日名稱），上班日回傳 null。 */
function restDay(root, day) {
  if (day.getDay() === 0 || day.getDay() === 6) return "週末";
  return holidayOn(root, day) ?? null;
}
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const minutesOf = (text) => +text.slice(0, 2) * 60 + +text.slice(3);

function readTodos(root) {
  const path = join(root, TODO_FILE);
  if (!existsSync(path)) return { 追蹤: { ...TODO_DEFAULT }, 日期: null, 待辦: [] };
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const track = { ...TODO_DEFAULT, ...(data.追蹤 ?? {}) };
    if (!CLOCK.test(track.從幾點開始) || !CLOCK.test(track.收工時間) || !(track.每幾小時 > 0)) throw new Error("追蹤的時間設定不對");
    return { ...data, 追蹤: track, 待辦: Array.isArray(data.待辦) ? data.待辦.filter((item) => item && typeof item.內容 === "string") : [] };
  } catch (error) {
    console.error(`待辦.json 讀不懂，先不追蹤待辦（修好後不用重啟）：${error.message}`);
    return null;
  }
}

function writeTodos(root, data) {
  writeFileSync(join(root, TODO_FILE), `${JSON.stringify({
    說明: "今天要追蹤的待辦。「開啟」true 時，白天每隔幾小時提醒你還有哪幾件沒回報，收工時間給一份清單。每天第一次提醒前，會從最新一份工作日誌的「還沒完成的事」重新列一次。狀態只有：待辦、已完成、擱置。可以直接改，不用重啟。",
    ...data,
  }, null, 2)}\n`);
}

/** 今天的提醒時間點（從幾點開始、每幾小時，到收工時間為止，不含收工那一刻）。 */
function checkpoints(track) {
  const start = minutesOf(track.從幾點開始), end = minutesOf(track.收工時間);
  const list = [];
  for (let at = start; at < end && list.length < 24; at += track.每幾小時 * 60) list.push(at);
  return list;
}

/** 安靜時段（跟例行工作共用 排程.json 的設定）：落在裡面就延到時段結束。 */
function afterQuiet(root, minutes) {
  let ranges = ["22:00-07:00", "12:00-13:00"];
  try {
    const custom = JSON.parse(readFileSync(join(root, "排程.json"), "utf8")).安靜時段;
    if (Array.isArray(custom) && custom.length > 0) ranges = custom;
  } catch {}
  for (const range of ranges) {
    const match = String(range).match(/^(\d\d:\d\d)-(\d\d:\d\d)$/);
    if (!match) continue;
    const from = minutesOf(match[1]), to = minutesOf(match[2]);
    const inside = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
    if (inside) return to;
  }
  return minutes;
}

const todoLines = (list) => list.map((item, index) => `${index + 1}. ${item.內容}`).join("\n");

/** 權限等級：設提醒只會在時間到時傳一段使用者自己說的話給他本人，屬於「擬稿」；列出屬於「查閱」。 */
export const levels = {
  add_reminder: "擬稿", list_reminders: "查閱", cancel_reminder: "擬稿",
  // 待辦追蹤：只會傳訊息給使用者本人，不影響外界，跟提醒一樣是擬稿級（不跳按鈕）
  list_todos: "查閱", update_todo: "擬稿", add_todo: "擬稿", track_todos: "擬稿",
};

/** 加進秘書的 system prompt。 */
export const prompt = [
  "使用者明確要你提醒他時，才用 add_reminder 設定；時間到了系統會直接把提醒內容傳給他，不經過你，你也不會在那時候幫他做事。",
  "使用者只是提到某件事、或拒絕了你提的做法（例如按了「不要」加進行事曆），不要自己幫他設提醒；可以問他要不要。",
  "一次性的提醒填 at（用使用者訊息開頭的【現在時間】換算成 YYYY-MM-DDTHH:mm）；循環的填 repeat，只能寫「每天 HH:mm」「每個工作日 HH:mm」「每週一 HH:mm」「每月N日 HH:mm」。",
  "時間不清楚（例如只說「月底」沒說幾點）、或已經過了（例如今天週六說「這週五」），先問使用者，不要自己猜。「工作日」是週一到週五，不含國定假日。",
  "使用者問有哪些提醒時用 list_reminders，依時間列成 1、2、3（不要寫〔代號〕）；要取消時先用 list_reminders 確認是哪一個，再用 cancel_reminder 傳它的代號。",
  "電腦關機或睡眠時提醒送不出去，會在秘書下次啟動時補發；使用者問起時照實說明。",
  "待辦追蹤：使用者要你盯著今天的待辦（例如「今天的待辦每兩小時提醒我一次」），用 track_todos 打開；清單每天早上從最新一份工作日誌的「還沒完成的事」自動帶出來。",
  "使用者回報某件做完了、或今天先擱著（例如「第 1 件做完了」「報價單今天先擱著」），用 update_todo 更新；他臨時說今天還要做某件事，用 add_todo 加進今天的清單。問今天還有什麼沒做用 list_todos。",
  "待辦的狀態只記在今天的清單裡，不會改工作日誌（日誌換日時才整理）；擱置的今天不再提醒，明天晨報還是會出現。",
  "待辦追蹤週末與國定假日（含補假）不提醒，使用者不用自己關掉；他說放假也要追的話，把 待辦.json 的「只在工作日」改成 false。",
].join("\n");

export default function (pi, bridge) {
  const file = join(bridge.root, FILE);
  let broken = []; // 格式不對的那幾筆：不用，但存檔時原樣留著，讓使用者自己修

  /** 讀 提醒.json；格式壞掉的那幾筆略過並記 log，不讓整個功能停擺。 */
  function load() {
    broken = [];
    if (!existsSync(file)) return [];
    try {
      const list = JSON.parse(readFileSync(file, "utf8")).提醒;
      if (!Array.isArray(list)) throw new Error("沒有「提醒」清單");
      return list.filter((item) => {
        const fine = item && typeof item.內容 === "string" && Number.isInteger(item.編號) && !isNaN(new Date(item.下次)) &&
          (item.重複 === undefined || REPEAT.test(item.重複));
        if (!fine) {
          console.error(`提醒.json 有一筆格式不對，先略過：${JSON.stringify(item)}`);
          broken.push(item);
        }
        return fine;
      });
    } catch (error) {
      console.error(`提醒.json 讀不懂，先不送提醒（修好後不用重啟）：${error.message}`);
      return null; // null：檔案壞了，不要覆寫它
    }
  }

  function save(list, next) {
    const data = {
      說明: "秘書的提醒，由程式維護。可以手動刪掉某一筆；新增請跟秘書說。「下次」是本地時間。",
      下一個編號: next ?? nextId(list),
      提醒: [...list, ...broken],
    };
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  }

  /** 下一個代號（檔案裡的「編號」）：只增不減，送出或取消的代號不會再被用到（避免取消時指錯）。只給秘書用，不顯示給使用者。 */
  function nextId(list) {
    let stored = 0;
    try {
      stored = Number(JSON.parse(readFileSync(file, "utf8")).下一個編號) || 0;
    } catch {}
    return Math.max(stored, 1, ...list.map((entry) => entry.編號 + 1), ...broken.map((entry) => (Number(entry?.編號) || 0) + 1));
  }

  /** 給使用者看的寫法：10/5（一）09:00（每週一 09:00）「交週報」。 */
  const describe = (item) => `${label(new Date(item.下次))}${item.重複 ? `（${item.重複}）` : ""}「${item.內容}」`;
  const byTime = (list) => [...list].sort((a, b) => new Date(a.下次) - new Date(b.下次));

  pi.registerTool({
    name: "add_reminder",
    label: "設定提醒",
    description:
      "設定一個提醒，時間到系統會把內容傳給使用者。一次性的填 at（本地時間 YYYY-MM-DDTHH:mm）；循環的填 repeat" +
      "（只能寫：每天 HH:mm、每個工作日 HH:mm、每週一 HH:mm（一～日）、每月N日 HH:mm）。at 與 repeat 只填一個。",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "提醒的內容，用使用者的話，例如「交週報」" },
        at: { type: "string", description: "一次性提醒的時間，例如 2026-10-05T09:00" },
        repeat: { type: "string", description: "循環提醒，例如「每週一 09:00」" },
      },
      required: ["text"],
    },
    async execute(_toolCallId, { text, at, repeat }) {
      const content = String(text ?? "").trim();
      if (!content) throw new Error("提醒內容是空的");
      if (content.length > MAX_TEXT) throw new Error(`提醒內容太長（最多 ${MAX_TEXT} 字）`);
      if (Boolean(at) === Boolean(repeat)) throw new Error("at（一次性）和 repeat（循環）要填一個，而且只能填一個");
      const now = new Date();
      let next;
      if (at) {
        next = parseAt(at);
        if (next <= now) throw new Error(`${label(next)} 已經過了（現在是 ${label(now)}），請跟使用者確認時間`);
      } else {
        next = nextRepeat(repeat, now);
      }
      const list = load();
      if (list === null) throw new Error("提醒.json 格式壞掉了，請使用者先修好或刪掉它");
      const item = { 編號: nextId(list), 內容: content, 下次: local(next), ...(repeat ? { 重複: repeat } : {}) };
      save([...list, item], item.編號 + 1);
      // 時間由程式寫在回覆最後：模型算錯日期時，使用者一眼看得出來
      const total = list.length + 1;
      bridge.setReplyNote(`提醒${item.編號}`, `⏰ 已設定提醒 ${describe(item)}（目前共 ${total} 件提醒）`);
      return { content: [{ type: "text", text: `已設定提醒 ${describe(item)}〔代號 ${item.編號}〕，目前共 ${total} 件提醒。` }], details: {} };
    },
  });

  pi.registerTool({
    name: "list_reminders",
    label: "列出提醒",
    description: "列出所有還沒到的提醒，依時間排序。每行最後的〔代號〕只給 cancel_reminder 用，列給使用者看時不要寫代號，用 1、2、3 排序即可。",
    parameters: { type: "object", properties: {} },
    async execute() {
      const list = load();
      if (list === null) throw new Error("提醒.json 格式壞掉了，請使用者先修好或刪掉它");
      const text = list.length === 0
        ? "目前沒有提醒。"
        : [`目前共 ${list.length} 件提醒：`, ...byTime(list).map((item, index) => `${index + 1}. ${describe(item)}〔代號 ${item.編號}〕`)].join("\n");
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  pi.registerTool({
    name: "cancel_reminder",
    label: "取消提醒",
    description: "取消一個提醒。先用 list_reminders 找到是哪一個，再傳它的〔代號〕（不是清單上的 1、2、3）。",
    parameters: {
      type: "object",
      properties: { id: { type: "number", description: "list_reminders 每行最後〔代號〕的數字" } },
      required: ["id"],
    },
    async execute(_toolCallId, { id }) {
      const list = load();
      if (list === null) throw new Error("提醒.json 格式壞掉了，請使用者先修好或刪掉它");
      const item = list.find((entry) => entry.編號 === Number(id));
      if (!item) throw new Error(`找不到代號 ${id} 的提醒，請先用 list_reminders 查`);
      save(list.filter((entry) => entry !== item));
      const left = list.length - 1;
      bridge.setReplyNote(`提醒${item.編號}`, `🗑️ 已取消提醒 ${describe(item)}（還剩 ${left} 件）`);
      return { content: [{ type: "text", text: `已取消提醒 ${describe(item)}，還剩 ${left} 件。` }], details: {} };
    },
  });

  // ── 待辦追蹤的工具 ──
  const text = (value) => ({ content: [{ type: "text", text: value }], details: {} });
  const todosOrThrow = () => {
    const data = readTodos(bridge.root);
    if (data === null) throw new Error("待辦.json 格式壞掉了，請使用者先修好或刪掉它");
    return data;
  };
  /** 今天的清單；日期不是今天就從最新一份日誌的「還沒完成的事」重新列。 */
  const todayTodos = (data) => {
    const today = ymd(new Date());
    if (data.日期 === today) return data;
    const { day, items } = bridge.journalTodos();
    return { ...data, 日期: today, 來源: day ? `日誌/${day}.md 的「還沒完成的事」` : "（還沒有工作日誌）", 待辦: items.map((內容) => ({ 內容, 狀態: "待辦" })) };
  };
  const STATUS = { 已完成: "已完成", 完成: "已完成", 做完: "已完成", 擱置: "擱置", 暫緩: "擱置", 待辦: "待辦", 還沒完成: "待辦" };

  pi.registerTool({
    name: "list_todos",
    label: "今天的待辦",
    description: "列出今天追蹤中的待辦與狀態（待辦、已完成、擱置）。",
    parameters: { type: "object", properties: {} },
    async execute() {
      const data = todayTodos(todosOrThrow());
      if (data.待辦.length === 0) return text("今天沒有要追蹤的待辦。");
      const group = (狀態) => data.待辦.filter((item) => (item.狀態 ?? "待辦") === 狀態);
      return text([
        `今天的待辦（來源：${data.來源 ?? "—"}）：`,
        ...data.待辦.map((item, index) => `${index + 1}. [${item.狀態 ?? "待辦"}] ${item.內容}`),
        `還沒完成 ${group("待辦").length} 件、已完成 ${group("已完成").length} 件、擱置 ${group("擱置").length} 件。`,
        data.追蹤.開啟 ? `追蹤中：${data.追蹤.從幾點開始} 起每 ${data.追蹤.每幾小時} 小時提醒，${data.追蹤.收工時間} 收工清單。` : "目前沒有在追蹤（要的話用 track_todos 打開）。",
      ].join("\n"));
    },
  });

  pi.registerTool({
    name: "update_todo",
    label: "回報待辦",
    description: "更新今天某一件待辦的狀態：已完成、擱置（今天先不做，不再提醒）、待辦（改回還沒完成）。用編號或內容的關鍵字指定。",
    parameters: {
      type: "object",
      properties: {
        which: { type: "string", description: "list_todos 的編號（例如「1」），或內容的關鍵字（例如「報價單」）" },
        status: { type: "string", enum: ["已完成", "擱置", "待辦"] },
      },
      required: ["which", "status"],
    },
    async execute(_toolCallId, { which, status }) {
      const 狀態 = STATUS[String(status ?? "").trim()];
      if (!狀態) throw new Error("狀態只能是「已完成」「擱置」或「待辦」");
      const data = todayTodos(todosOrThrow());
      if (data.待辦.length === 0) throw new Error("今天沒有要追蹤的待辦");
      const key = String(which ?? "").trim();
      const byIndex = /^\d+$/.test(key) ? data.待辦[Number(key) - 1] : undefined;
      const matched = byIndex ? [byIndex] : data.待辦.filter((item) => item.內容.includes(key));
      if (matched.length === 0) throw new Error(`找不到「${key}」這件待辦，請先用 list_todos 看清單`);
      if (matched.length > 1) throw new Error(`「${key}」對到 ${matched.length} 件（${matched.map((item) => item.內容.slice(0, 20)).join("、")}），請用編號指定`);
      const item = matched[0];
      const before = item.狀態 ?? "待辦";
      item.狀態 = 狀態;
      item.回報時間 = new Date().toISOString();
      writeTodos(bridge.root, data);
      const left = data.待辦.filter((entry) => (entry.狀態 ?? "待辦") === "待辦").length;
      bridge.setReplyNote(`待辦${item.內容.slice(0, 10)}`, `📝 「${item.內容}」${before} → ${狀態}（今天還剩 ${left} 件沒完成）`);
      return text(`已更新：「${item.內容}」${before} → ${狀態}。今天還剩 ${left} 件沒完成。`);
    },
  });

  pi.registerTool({
    name: "add_todo",
    label: "加一件今天的待辦",
    description: "臨時加一件今天要做的事到追蹤清單（只影響今天的追蹤，不會改工作日誌）。",
    parameters: { type: "object", properties: { text: { type: "string", description: "要做的事" } }, required: ["text"] },
    async execute(_toolCallId, input) {
      const 內容 = String(input.text ?? "").trim();
      if (!內容 || 內容.length > MAX_TEXT) throw new Error(`內容要是 1～${MAX_TEXT} 個字`);
      const data = todayTodos(todosOrThrow());
      if (data.待辦.some((item) => item.內容 === 內容)) return text(`「${內容}」已經在今天的清單裡了。`);
      data.待辦.push({ 內容, 狀態: "待辦", 新增時間: new Date().toISOString() });
      writeTodos(bridge.root, data);
      const left = data.待辦.filter((item) => (item.狀態 ?? "待辦") === "待辦").length;
      bridge.setReplyNote(`待辦${內容.slice(0, 10)}`, `📝 已加進今天的待辦：「${內容}」（今天共 ${left} 件沒完成）`);
      return text(`已加進今天的待辦：「${內容}」。今天還有 ${left} 件沒完成。`);
    },
  });

  pi.registerTool({
    name: "track_todos",
    label: "待辦追蹤開關",
    description: "打開或關掉待辦追蹤（打開後上班日每隔幾小時提醒還有哪幾件沒回報，收工時給清單；週末與國定假日不追）。可以順便改時間設定。",
    parameters: {
      type: "object",
      properties: {
        on: { type: "boolean", description: "true 打開、false 關掉" },
        start: { type: "string", description: "從幾點開始，例如 09:30；不改就不填" },
        every_hours: { type: "number", description: "每幾小時提醒一次；不改就不填" },
        end: { type: "string", description: "收工時間，例如 18:00；不改就不填" },
      },
      required: ["on"],
    },
    async execute(_toolCallId, { on, start, every_hours, end }) {
      const data = todosOrThrow();
      const track = { ...data.追蹤, 開啟: Boolean(on) };
      if (start) track.從幾點開始 = String(start);
      if (end) track.收工時間 = String(end);
      if (every_hours) track.每幾小時 = Number(every_hours);
      if (!CLOCK.test(track.從幾點開始) || !CLOCK.test(track.收工時間)) throw new Error("時間要寫成 HH:MM（24 小時制）");
      if (!(track.每幾小時 >= 1 && track.每幾小時 <= 12)) throw new Error("每幾小時要是 1～12");
      if (minutesOf(track.收工時間) <= minutesOf(track.從幾點開始)) throw new Error("收工時間要晚於開始時間");
      const next = { ...todayTodos(data), 追蹤: track };
      const how = `${track.從幾點開始} 起每 ${track.每幾小時} 小時，${track.收工時間} 給收工清單${track.只在工作日 === false ? "，假日也追" : "，週末與國定假日不追"}`;
      if (!track.開啟) {
        writeTodos(bridge.root, next);
        bridge.setReplyNote("待辦追蹤", "📝 待辦追蹤：已關掉");
        return text("已關掉待辦追蹤。");
      }
      // 剛打開（或剛改時間）：今天已經過掉的時間點不補發，不然晚上打開會馬上收到「17:30 還沒完成」和收工清單
      const now = new Date();
      const rest = track.只在工作日 !== false && restDay(bridge.root, now);
      const minutes = now.getHours() * 60 + now.getMinutes();
      const points = checkpoints(track).map((at) => ({ at, real: afterQuiet(bridge.root, at) }));
      const passed = points.filter((point) => minutes >= point.real).at(-1);
      if (passed) next.提醒到 = `${ymd(now)} ${passed.at}`;
      const closing = afterQuiet(bridge.root, minutesOf(track.收工時間));
      if (minutes >= closing) next.收工過 = ymd(now);
      writeTodos(bridge.root, next);
      const upcoming = points.find((point) => point.real > minutes);
      const when = rest
        ? `今天放假（${rest}），不提醒；下個上班日 ${track.從幾點開始} 開始`
        : upcoming
        ? `下次提醒：今天 ${pad(Math.floor(upcoming.real / 60))}:${pad(upcoming.real % 60)}`
        : minutes < closing
          ? `今天的提醒時間都過了，${track.收工時間} 會給你收工清單`
          : `今天的時間都過了，明天 ${track.從幾點開始} 開始`;
      bridge.setReplyNote("待辦追蹤", `📝 待辦追蹤：已打開（${how}）；${when}`);
      return text(`已打開待辦追蹤：${how}。${when}。`);
    },
  });
}

/** /status 顯示：還有幾件提醒、待辦追蹤開了沒。 */
export const statusOrder = 1;
export function status(bridge) {
  let list = [];
  try {
    list = JSON.parse(readFileSync(join(bridge.root, FILE), "utf8")).提醒 ?? [];
  } catch {
    // 提醒.json 不在或壞掉，待辦追蹤那行還是要出來
    const 提醒行 = existsSync(join(bridge.root, FILE)) ? "⏰ 提醒：提醒.json 讀不懂，請修好或刪掉它" : "⏰ 提醒：沒有";
    return [提醒行, todoStatus(bridge)].filter(Boolean).join(NL);
  }
  const sorted = list.filter((item) => item?.內容 && !isNaN(new Date(item.下次))).sort((a, b) => new Date(a.下次) - new Date(b.下次));
  if (sorted.length === 0) return ["⏰ 提醒：沒有", todoStatus(bridge)].filter(Boolean).join(NL);
  const next = sorted[0];
  return [`⏰ 提醒：${sorted.length} 件，最近一件 ${label(new Date(next.下次))}${next.重複 ? `（${next.重複}）` : ""}「${next.內容}」`, todoStatus(bridge)].filter(Boolean).join(NL);
}

/** /status 的待辦追蹤那一行。 */
function todoStatus(bridge) {
  const data = readTodos(bridge.root);
  if (data === null) return "📝 待辦追蹤：待辦.json 讀不懂，請修好或刪掉它";
  if (!data.追蹤.開啟) return "";
  const track = data.追蹤;
  const how = `${track.從幾點開始} 起每 ${track.每幾小時} 小時，${track.收工時間} 收工清單${track.只在工作日 === false ? "，假日也追" : "，週末與國定假日不追"}`;
  const rest = track.只在工作日 !== false && restDay(bridge.root, new Date());
  if (rest) return `📝 待辦追蹤：開啟（${how}）；今天放假（${rest}），不提醒`;
  if (data.日期 !== ymd(new Date())) return `📝 待辦追蹤：開啟（${how}）；今天的清單還沒列（第一次提醒前會從最新日誌帶出來）`;
  const left = data.待辦.filter((item) => (item.狀態 ?? "待辦") === "待辦");
  return `📝 待辦追蹤：開啟（${how}）；今天 ${data.待辦.length} 件，還沒完成 ${left.length} 件${left.length ? `（${left.slice(0, 3).map((item) => item.內容.slice(0, 15)).join("、")}${left.length > 3 ? "…" : ""}）` : ""}`;
}

/**
 * 每 30 秒由主程式呼叫一次（不排隊、不經模型）：到時間的提醒直接傳給使用者。
 * 一次性的送出後刪掉；循環的算出下一次。錯過好幾次的循環提醒只補發一次。
 */
export async function tick(bridge) {
  await trackTodos(bridge);
  const file = join(bridge.root, FILE);
  if (!existsSync(file)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(data.提醒)) return;
  } catch {
    return; // 格式壞掉：工具那邊會告訴使用者；這裡不覆寫
  }
  const now = new Date();
  const due = data.提醒.filter((item) => item && typeof item.內容 === "string" && new Date(item.下次) <= now);
  if (due.length === 0) return;
  const keep = [];
  const messages = [];
  for (const item of data.提醒) {
    if (!due.includes(item)) {
      keep.push(item);
      continue;
    }
    const planned = new Date(item.下次);
    const late = now - planned > LATE_MINUTES * 60_000;
    messages.push([
      `⏰ 提醒：${item.內容}`,
      item.重複 ? `（${item.重複}）` : "",
      late ? `\n（原定 ${label(planned)}，那時秘書沒有在執行，現在補發）` : "",
    ].join(""));
    if (item.重複 && REPEAT.test(item.重複)) keep.push({ ...item, 下次: local(nextRepeat(item.重複, now)) });
  }
  // 先存檔再送：就算送的途中當掉，也不會重複提醒（送不出去的由主程式排進 outbox 補送）
  // 記下一個編號：送出刪掉的編號不會再被用到
  const next = Math.max(Number(data.下一個編號) || 0, ...data.提醒.map((item) => (Number(item?.編號) || 0) + 1));
  writeFileSync(file, `${JSON.stringify({ ...data, 下一個編號: next, 提醒: keep }, null, 2)}\n`);
  for (const text of messages) await bridge.notify(text);
}

/**
 * 待辦追蹤（tick 的一部分）：
 * - 每天第一個時間點之前，從最新一份工作日誌的「還沒完成的事」重新列今天的清單。
 * - 到時間點時，如果還有「待辦」狀態的，傳一則「還沒完成」；落在安靜時段就延到時段結束。
 * - 收工時間給一份清單（完成幾件、擱置幾件、還剩哪些）。沒開追蹤就什麼都不做。
 */
async function trackTodos(bridge) {
  const data = readTodos(bridge.root);
  if (data === null || !data.追蹤.開啟) return;
  const now = new Date();
  // 放假不追待辦：週末、國定假日（含補假）都不提醒，也不做收工清單。
  // 假日也想被追的話，把 待辦.json 的「只在工作日」改成 false。
  if (data.追蹤.只在工作日 !== false && (restDay(bridge.root, now) !== null)) return;
  const today = ymd(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  let changed = false;
  let current = data;
  if (data.日期 !== today) {
    // 新的一天：清單重新來過（擱置、完成都只算今天）
    const { day, items } = bridge.journalTodos();
    current = {
      ...data,
      日期: today,
      來源: day ? `日誌/${day}.md 的「還沒完成的事」` : "（還沒有工作日誌）",
      待辦: items.map((內容) => ({ 內容, 狀態: "待辦" })),
      提醒到: null,
      收工過: null,
    };
    changed = true;
  }
  const left = current.待辦.filter((item) => (item.狀態 ?? "待辦") === "待辦");
  const done = current.待辦.filter((item) => item.狀態 === "已完成");
  const held = current.待辦.filter((item) => item.狀態 === "擱置");
  // 這個時間點之前，最近一個該提醒的（延後過安靜時段）
  const due = checkpoints(current.追蹤)
    .map((at) => ({ at, real: afterQuiet(bridge.root, at) }))
    .filter((point) => minutes >= point.real)
    .at(-1);
  if (due && current.提醒到 !== `${today} ${due.at}` && left.length > 0) {
    current = { ...current, 提醒到: `${today} ${due.at}` };
    changed = true;
    await bridge.notify([
      `📝 還沒完成（${pad(Math.floor(due.at / 60))}:${pad(due.at % 60)}，${left.length} 件）`,
      todoLines(left),
      "",
      "做完或要擱置，跟我說一聲，例如「第 1 件做完了」「第 2 件今天先擱著」。",
    ].join("\n"));
  } else if (due && current.提醒到 !== `${today} ${due.at}`) {
    current = { ...current, 提醒到: `${today} ${due.at}` }; // 全部回報完了：記下來，不用提醒
    changed = true;
  }
  const endAt = afterQuiet(bridge.root, minutesOf(current.追蹤.收工時間));
  if (minutes >= endAt && current.收工過 !== today && current.待辦.length > 0) {
    current = { ...current, 收工過: today };
    changed = true;
    await bridge.notify([
      `🌆 今天收工了（${current.追蹤.收工時間}）`,
      `✅ 完成 ${done.length} 件${done.length ? `：${done.map((item) => item.內容).join("、")}` : ""}`,
      ...(held.length ? [`⏸ 擱置 ${held.length} 件：${held.map((item) => item.內容).join("、")}`] : []),
      left.length ? `📝 還沒完成 ${left.length} 件：\n${todoLines(left)}\n\n沒完成的明天晨報還會出現。` : "今天的待辦都回報完了，辛苦了。",
    ].join("\n"));
  }
  if (changed) writeTodos(bridge.root, current);
}
