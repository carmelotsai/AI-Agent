// 台灣國定假日清單，兩個外掛共用：「例行工作」用來跳過假日不做、「固定會議」用來前一天問要不要延期。
// 來源是 Google 台灣假日行事曆，只取「國定假日」（情人節、冬至這類「假日節慶」照常上班）。
// 每天最多抓一次，存在 data/台灣假日.json；抓不到就用上次存的，一小時後再試。
// 想自己維護假日清單（例如公司的特休日）：改 data/台灣假日.json，把「不要重抓」設成 true，程式就不會再去抓、不會蓋掉你改的。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CACHE = join("data", "台灣假日.json");
const ICAL = "https://calendar.google.com/calendar/ical/zh-tw.taiwan%23holiday%40group.v.calendar.google.com/public/basic.ics";
const DAY = 24 * 3_600_000;

const pad = (value) => String(value).padStart(2, "0");
/** Date → "YYYY-MM-DD"（本機時區，不要用 toISOString，那是 UTC）。 */
export const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

function readCache(root) {
  const path = join(root, CACHE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`${CACHE} 讀不懂，當成沒有假日資料：${error.message}`);
    return null;
  }
}

let holidays = { 抓到: 0, 讀過存檔: false, 假日: {} };

/**
 * 同步查某一天是不是國定假日：是就回傳假日名稱（例如「中華民國國慶日 補假」），不是回傳 undefined。
 * 第一次呼叫會把存檔讀進來；還沒抓過假日資料時一律回傳 undefined（當成上班日，不會誤跳過）。
 */
export function holidayOn(root, date) {
  if (!holidays.讀過存檔) holidays = { ...holidays, 讀過存檔: true, 假日: readCache(root)?.國定假日 ?? {} };
  return holidays.假日[typeof date === "string" ? date : ymd(date)];
}

/** 國定假日（YYYY-MM-DD → 名稱）。每天最多抓一次；抓不到就用上次存的。 */
export async function holidayList(root) {
  if (Date.now() - holidays.抓到 < DAY) return holidays.假日;
  const cached = readCache(root);
  if (cached?.不要重抓) {
    holidays = { 抓到: Date.now(), 讀過存檔: true, 假日: cached.國定假日 ?? {} };
    return holidays.假日;
  }
  if (cached?.抓取時間 && Date.now() - new Date(cached.抓取時間).getTime() < DAY) {
    holidays = { 抓到: Date.now(), 讀過存檔: true, 假日: cached.國定假日 ?? {} };
    return holidays.假日;
  }
  try {
    const response = await fetch(ICAL, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const days = {};
    for (const [, block] of (await response.text()).matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)) {
      const event = block.replace(/\r?\n[ \t]/g, "");
      const date = event.match(/DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
      // 只算「國定假日」；「假日節慶」（情人節、冬至這類）照常上班
      if (date && /DESCRIPTION:國定假日/.test(event)) days[`${date[1]}-${date[2]}-${date[3]}`] = event.match(/SUMMARY:(.*)/)?.[1].trim() ?? "國定假日";
    }
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, CACHE), `${JSON.stringify({ 來源: "Google 台灣假日行事曆（只取國定假日）", 抓取時間: new Date().toISOString(), 國定假日: days }, null, 2)}\n`);
    holidays = { 抓到: Date.now(), 讀過存檔: true, 假日: days };
  } catch (error) {
    console.error("抓台灣假日失敗，先用上次存的：", error.message);
    holidays = { 抓到: Date.now() - 23 * 3_600_000, 讀過存檔: true, 假日: cached?.國定假日 ?? {} }; // 一小時後再試
  }
  return holidays.假日;
}
