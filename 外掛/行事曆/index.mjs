// 行事曆：看 Google 行事曆（查閱），新增、修改、刪除行程（執行級：每次先傳按鈕給使用者確認）。
// 授權一次：`node 外掛/行事曆/授權.mjs`。憑證與權杖在 data/google/（不進 Git，秘書讀不到），只由這個外掛使用。
// 不加參加者、不寄通知信（sendUpdates=none）。開會前 15 分鐘主動提醒（設定在 通知.json）。拿掉這個資料夾再重啟，秘書就不會碰行事曆。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_DAYS = 31; // 一次最多查幾天
const API = "https://www.googleapis.com/calendar/v3";

/** 權限等級：看是「查閱」；新增、修改、刪除會動到你的行事曆，是「執行」（每次先問）。 */
export const levels = {
  calendar_events: "查閱", calendar_create: "執行", calendar_update: "執行", calendar_delete: "執行",
  // 會前準備：等於排一件會在沒人看著時做的工作（跟例行工作一樣），新增、刪除每次按鈕確認
  add_meeting_prep: "執行", remove_meeting_prep: "執行", list_meeting_preps: "查閱",
};

/** 加進秘書的 system prompt。 */
export const prompt =
  "使用者問行程、會議、某天有什麼事時，用 calendar_events 查 Google 行事曆，不要憑記憶或工作日誌回答；日期用訊息開頭的【現在時間】推算。" +
  "要新增行程用 calendar_create；要修改或刪除，先用 calendar_events 查出那一筆的編號（E1、E2…），再用 calendar_update 或 calendar_delete。" +
  "日期、時間不清楚時先問使用者，不要自己猜；有好幾筆可能是同一件事時，先列出來請使用者指定。" +
  "新增、修改、刪除都會先由系統傳按鈕給使用者確認，按了才會做；工具回傳「已新增／已修改／已刪除」就代表使用者已經同意、而且已經完成，不要再請使用者按按鈕，也不用自己附連結（系統會附上）。不能加參加者、不能寄邀請；使用者要邀請別人時，照實說明請他自己在 Google 行事曆操作。" +
  "使用者只是補充開會要討論的事、要記得的事（例如「明天那個會也要討論 X」），更新提醒就好，不要為了加備註去改行程（改行程要使用者按按鈕）；他明說「寫進行事曆」才改。" +
  "系統會在每場會議前 15 分鐘自動提醒使用者，不用另外設提醒。使用者要某個固定會議開始前先幫他整理上一次的會議紀錄（例如「每次研發週會前 30 分鐘幫我整理上次的紀錄」），用 add_meeting_prep；會議名稱填行事曆標題裡會出現的字。";

const today = () => new Date().toLocaleDateString("sv-SE");
const pad = (value) => String(value).padStart(2, "0");
const WEEKDAYS = "日一二三四五六";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 本機時區的時差字串，例如 +08:00。 */
function offset(date) {
  const minutes = -date.getTimezoneOffset();
  return `${minutes >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** Google 的時間 → { date: "2026-09-28", time: "14:00" }（全天沒有 time）。 */
function parts(time) {
  if (time.date) return { date: time.date };
  const date = new Date(time.dateTime);
  return { date: date.toLocaleDateString("sv-SE"), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

const dayLabel = (date) => `${date}（${WEEKDAYS[new Date(`${date}T00:00:00`).getDay()]}）`;

/** 一筆行程的白話摘要：「2026-09-30（三）15:00–16:00 產品會議＠3F」。 */
function summary(event) {
  const start = parts(event.start);
  const end = parts(event.end);
  const time = start.time ? ` ${start.time}–${end.time}` : "（全天）";
  return `${dayLabel(start.date)}${time} ${event.summary ?? "（沒有標題）"}${event.location ? `＠${event.location}` : ""}`;
}

/** 由日期、時間組出 Google 的 start／end。沒有 start 就是全天。 */
function times(date, start, end) {
  if (!DATE.test(date ?? "")) throw new Error("日期格式要是 YYYY-MM-DD");
  if (!start) {
    const next = new Date(`${date}T00:00:00`);
    next.setDate(next.getDate() + 1);
    return { start: { date }, end: { date: next.toLocaleDateString("sv-SE") } };
  }
  if (!TIME.test(start) || (end && !TIME.test(end))) throw new Error("時間格式要是 HH:MM（24 小時制）");
  const begin = new Date(`${date}T${start}:00`);
  const finish = end ? new Date(`${date}T${end}:00`) : new Date(begin.getTime() + 60 * 60_000); // 沒給結束時間就一小時
  if (finish <= begin) throw new Error("結束時間要晚於開始時間");
  const iso = (value) => `${value.toLocaleDateString("sv-SE")}T${pad(value.getHours())}:${pad(value.getMinutes())}:00${offset(value)}`;
  return { start: { dateTime: iso(begin) }, end: { dateTime: iso(finish) } };
}

export default function (pi, bridge) {
  const googleDir = join(bridge.root, "data", "google");
  const clientFile = join(googleDir, "client.json");
  const tokenFile = join(googleDir, "token.json");
  if (!existsSync(clientFile) || !existsSync(tokenFile)) {
    console.log("外掛「行事曆」：還沒完成 Google 授權（執行 node 外掛/行事曆/授權.mjs），先不提供行事曆。");
    return;
  }

  let access = { token: "", expires: 0 };
  /** 用 refresh token 換 access token（快到期才換）。 */
  async function accessToken() {
    if (access.token && Date.now() < access.expires - 60_000) return access.token;
    const client = JSON.parse(readFileSync(clientFile, "utf8")).installed;
    const { refresh_token } = JSON.parse(readFileSync(tokenFile, "utf8"));
    const result = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(20_000),
    }).then((response) => response.json());
    if (!result.access_token) {
      throw new Error(result.error === "invalid_grant"
        ? "Google 授權已失效（被撤銷、超過 6 個月沒用，或 Google Cloud 的應用程式還在「測試」狀態 7 天到期），請使用者重新執行授權：node 外掛/行事曆/授權.mjs"
        : `Google 授權出錯：${result.error_description ?? result.error ?? "不明原因"}`);
    }
    access = { token: result.access_token, expires: Date.now() + result.expires_in * 1000 };
    return access.token;
  }

  async function google(path, { method = "GET", params = {}, body } = {}) {
    const response = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, {
      method,
      headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const data = response.status === 204 ? {} : await response.json();
    if (!response.ok) {
      const insufficient = data.error?.status === "PERMISSION_DENIED" && /scope/i.test(data.error?.message ?? "");
      throw new Error(insufficient
        ? "目前的 Google 授權只能看行事曆，不能修改。請使用者重新執行授權：node 外掛/行事曆/授權.mjs"
        : `Google 行事曆回應錯誤：${data.error?.message ?? response.status}`);
    }
    return data;
  }

  // 短編號（E1、E2…）↔ 行事曆與活動 ID；秘書只要記短編號
  const ids = new Map();
  const keys = new Map();
  function shortId(calendarId, eventId) {
    const key = `${calendarId}\n${eventId}`;
    if (!keys.has(key)) {
      const id = `E${keys.size + 1}`;
      keys.set(key, id);
      ids.set(id, { calendarId, eventId });
    }
    return keys.get(key);
  }
  function lookup(id) {
    const found = ids.get(String(id ?? "").toUpperCase());
    if (!found) throw new Error(`找不到編號 ${id}，請先用 calendar_events 查一次`);
    return found;
  }
  const fetchEvent = ({ calendarId, eventId }) => google(`calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);

  async function calendars() {
    return (await google("users/me/calendarList", { params: { minAccessRole: "reader" } })).items.filter((item) => item.selected || item.primary);
  }
  /** 依名稱找可寫入的行事曆；沒給名稱就用主要行事曆（回傳真實 ID，編號才會跟查詢時一致）。 */
  async function writableCalendar(name) {
    const list = await calendars();
    const found = name ? list.find((item) => [item.summaryOverride, item.summary, item.id].includes(name)) : list.find((item) => item.primary);
    if (!found) throw new Error(name ? `找不到叫「${name}」的行事曆` : "找不到主要行事曆");
    if (!["writer", "owner"].includes(found.accessRole)) throw new Error(`「${found.summaryOverride ?? found.summary}」行事曆只能看，不能寫入`);
    return found.id;
  }
  /** 修改、刪除前確認那一筆所在的行事曆可以寫入。 */
  async function ensureWritable(calendarId) {
    const found = (await calendars()).find((item) => item.id === calendarId);
    if (found && !["writer", "owner"].includes(found.accessRole)) throw new Error(`這一筆在「${found.summaryOverride ?? found.summary}」行事曆，只能看，不能修改或刪除`);
  }

  /** 新增或修改後的活動內容（修改時沒給的欄位沿用原本的）。 */
  function changed(input, current) {
    const old = current ? { start: parts(current.start), end: parts(current.end) } : undefined;
    const date = input.date ?? old?.start.date;
    let start = input.start ?? (input.all_day ? undefined : old?.start.time);
    let end = input.end;
    if (current && !input.end && old.start.time && start) {
      // 只改開始時間：維持原本的長度
      const length = new Date(current.end.dateTime) - new Date(current.start.dateTime);
      const finish = new Date(new Date(`${date}T${start}:00`).getTime() + length);
      end = `${pad(finish.getHours())}:${pad(finish.getMinutes())}`;
    }
    if (input.all_day) start = end = undefined;
    return {
      summary: input.title ?? current?.summary,
      location: input.location ?? current?.location,
      description: input.note ?? current?.description,
      ...times(date, start, end),
    };
  }

  // 會前提醒（tick）用：某段時間內所有勾選顯示的行事曆的行程（不含已取消的）
  upcomingEvents = async (from, to) => {
    const events = [];
    for (const calendar of await calendars()) {
      const data = await google(`calendars/${encodeURIComponent(calendar.id)}/events`, {
        params: { timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "50" },
      });
      events.push(...(data.items ?? []).filter((event) => event.status !== "cancelled"));
    }
    return events;
  };

  let counts = { 查了: [], 新增: 0, 修改: 0, 刪除: 0, 連結: [] };
  pi.on("agent_start", () => { counts = { 查了: [], 新增: 0, 修改: 0, 刪除: 0, 連結: [] }; });
  function note() {
    const done = ["新增", "修改", "刪除"].filter((kind) => counts[kind] > 0).map((kind) => `${kind} ${counts[kind]} 筆`);
    const viewed = counts.查了.length > 0 ? `查了 ${counts.查了.join("、")}` : "";
    // 新增、修改的活動附上 Google 行事曆連結，點開就能核對（程式附上，不靠模型）
    const links = counts.連結.slice(-3).map((link) => `🔗 ${link}`);
    bridge.setReplyNote?.("行事曆", [`🗓️ 本次實際在 Google 行事曆：${[viewed, ...done].filter(Boolean).join("；")}（${today()}）`, ...links].join("\n"));
  }

  pi.registerTool({
    name: "calendar_events",
    label: "看行事曆",
    description: "查 Google 行事曆某段期間的行程（含所有勾選顯示的行事曆）。每一筆有編號（E1、E2…），修改或刪除時用。",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "開始日期 YYYY-MM-DD（含）" },
        to: { type: "string", description: "結束日期 YYYY-MM-DD（含）；只查一天就跟 from 一樣" },
      },
      required: ["from", "to"],
    },
    async execute(_toolCallId, { from, to }) {
      if (!DATE.test(from ?? "") || !DATE.test(to ?? "")) throw new Error("日期格式要是 YYYY-MM-DD");
      const start = new Date(`${from}T00:00:00`);
      const end = new Date(`${to}T00:00:00`);
      if (end < start) throw new Error("結束日期不能早於開始日期");
      end.setDate(end.getDate() + 1); // 含結束那天
      if ((end - start) / 86_400_000 > MAX_DAYS) throw new Error(`一次最多查 ${MAX_DAYS} 天`);

      const list = await calendars();
      const events = [];
      for (const calendar of list) {
        const data = await google(`calendars/${encodeURIComponent(calendar.id)}/events`, {
          params: { timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" },
        });
        for (const event of data.items ?? []) {
          if (event.status === "cancelled") continue;
          const begin = parts(event.start);
          events.push({
            sort: event.start.dateTime ?? `${event.start.date}T00:00:00`,
            編號: shortId(calendar.id, event.id),
            開始: begin.time ? `${dayLabel(begin.date)}${begin.time}` : dayLabel(begin.date),
            結束: begin.time ? parts(event.end).time : undefined,
            全天: begin.time ? undefined : true,
            標題: event.summary ?? "（沒有標題）",
            地點: event.location,
            行事曆: list.length > 1 ? (calendar.summaryOverride ?? calendar.summary) : undefined,
            只能看: ["writer", "owner"].includes(calendar.accessRole) ? undefined : true,
          });
        }
      }
      events.sort((a, b) => a.sort.localeCompare(b.sort));
      const range = from === to ? from : `${from}～${to}`;
      counts.查了.push(range);
      note();
      console.log(`看行事曆：${range}，${events.length} 筆`);
      return {
        content: [{ type: "text", text: JSON.stringify({
          資料來源: `Google 行事曆（查詢於 ${today()}）`,
          期間: range,
          行程: events.length > 0 ? events.map(({ sort, ...rest }) => rest) : "這段期間沒有行程",
        }, null, 1) }],
        details: {},
      };
    },
  });

  const eventFields = {
    title: { type: "string", description: "標題" },
    date: { type: "string", description: "日期 YYYY-MM-DD" },
    start: { type: "string", description: "開始時間 HH:MM（24 小時制）；全天活動不要填" },
    end: { type: "string", description: "結束時間 HH:MM；沒填就是一小時" },
    all_day: { type: "boolean", description: "是否為全天活動" },
    location: { type: "string", description: "地點" },
    note: { type: "string", description: "備註（會放在活動說明）" },
  };

  pi.registerTool({
    name: "calendar_create",
    label: "新增行程",
    description: "在 Google 行事曆新增一個活動（不加參加者、不寄邀請）。會先請使用者按按鈕確認。",
    parameters: {
      type: "object",
      properties: { ...eventFields, calendar: { type: "string", description: "要放在哪個行事曆（名稱）；沒填就是主要行事曆" } },
      required: ["title", "date"],
    },
    async execute(_toolCallId, input) {
      const calendarId = await writableCalendar(input.calendar);
      const event = await google(`calendars/${encodeURIComponent(calendarId)}/events`, {
        method: "POST", params: { sendUpdates: "none" }, body: changed(input),
      });
      counts.新增++;
      if (event.htmlLink) counts.連結.push(event.htmlLink);
      note();
      console.log(`新增行程：${summary(event)}`);
      return { content: [{ type: "text", text: `已新增（使用者已經按了同意，已經完成，不用再請使用者確認）：${summary(event)}（編號 ${shortId(calendarId, event.id)}）` }], details: {} };
    },
  });

  pi.registerTool({
    name: "calendar_update",
    label: "修改行程",
    description: "修改 Google 行事曆的一個活動（用 calendar_events 查到的編號）；只填要改的欄位。重複活動只改這一次。會先請使用者按按鈕確認。",
    parameters: { type: "object", properties: { id: { type: "string", description: "編號，例如 E3" }, ...eventFields }, required: ["id"] },
    async execute(_toolCallId, input) {
      const target = lookup(input.id);
      await ensureWritable(target.calendarId);
      const current = await fetchEvent(target);
      const event = await google(`calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(target.eventId)}`, {
        method: "PATCH", params: { sendUpdates: "none" }, body: changed(input, current),
      });
      counts.修改++;
      if (event.htmlLink) counts.連結.push(event.htmlLink);
      note();
      console.log(`修改行程：${summary(current)} → ${summary(event)}`);
      return { content: [{ type: "text", text: `已修改（使用者已經按了同意，已經完成，不用再請使用者確認）：${summary(current)} → ${summary(event)}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "calendar_delete",
    label: "刪除行程",
    description: "刪除 Google 行事曆的一個活動（用 calendar_events 查到的編號）。重複活動只刪這一次。會先請使用者按按鈕確認。",
    parameters: { type: "object", properties: { id: { type: "string", description: "編號，例如 E3" } }, required: ["id"] },
    async execute(_toolCallId, { id }) {
      const target = lookup(id);
      await ensureWritable(target.calendarId);
      const current = await fetchEvent(target);
      await google(`calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(target.eventId)}`, {
        method: "DELETE", params: { sendUpdates: "none" },
      });
      counts.刪除++;
      note();
      console.log(`刪除行程：${summary(current)}`);
      return { content: [{ type: "text", text: `已刪除（使用者已經按了同意，已經完成，不用再請使用者確認）：${summary(current)}` }], details: {} };
    },
  });

  // ── 會前準備：設定在 通知.json 的「會前準備」，時間到由 tick 交給秘書做（例行工作的規矩）──
  pluginRoot = bridge.root;
  const text = (value) => ({ content: [{ type: "text", text: value }], details: {} });

  pi.registerTool({
    name: "add_meeting_prep",
    label: "新增會前準備",
    description: "某個會議（行事曆標題包含 meeting 這幾個字）每次開始前 minutes 分鐘，系統會叫你整理上一次的會議紀錄給使用者。系統會先跳按鈕讓使用者確認。",
    parameters: {
      type: "object",
      properties: {
        meeting: { type: "string", description: "行事曆標題裡會出現的字，例如「研發週會」" },
        minutes: { type: "number", description: "開會前幾分鐘，預設 30" },
      },
      required: ["meeting"],
    },
    async execute(_toolCallId, input) {
      const prep = checkPrep(input);
      const { data, list } = loadPreps(bridge.root);
      const rest = list.filter((item) => item.會議 !== prep.會議); // 同一個會議再設一次 = 改設定
      savePreps(bridge.root, data, [...rest, prep]);
      bridge.setReplyNote?.("會前準備", `📋 已設定會前準備：「${prep.會議}」開始前 ${prep.提前幾分鐘} 分鐘整理上一次的會議紀錄（目前共 ${rest.length + 1} 個會議）`);
      return text(`已設定（使用者已經按了同意，已經完成，不用再請使用者確認）：標題包含「${prep.會議}」的會議，每次開始前 ${prep.提前幾分鐘} 分鐘，系統會叫你整理上一次的會議紀錄。`);
    },
  });

  pi.registerTool({
    name: "remove_meeting_prep",
    label: "取消會前準備",
    description: "取消某個會議的會前準備。系統會先跳按鈕讓使用者確認。",
    parameters: { type: "object", properties: { meeting: { type: "string", description: "設定時的會議名稱" } }, required: ["meeting"] },
    async execute(_toolCallId, { meeting }) {
      const { data, list } = loadPreps(bridge.root);
      if (!list.some((item) => item.會議 === meeting)) throw new Error(`沒有「${meeting}」的會前準備`);
      savePreps(bridge.root, data, list.filter((item) => item.會議 !== meeting));
      bridge.setReplyNote?.("會前準備", `🗑️ 已取消「${meeting}」的會前準備`);
      return text(`已取消「${meeting}」的會前準備（使用者已經按了同意，已經完成，不用再請使用者確認）。`);
    },
  });

  pi.registerTool({
    name: "list_meeting_preps",
    label: "列出會前準備",
    description: "列出設定了會前準備的會議。",
    parameters: { type: "object", properties: {} },
    async execute() {
      const { list } = loadPreps(bridge.root);
      return text(list.length === 0
        ? "目前沒有設定會前準備。"
        : list.map((item, index) => `${index + 1}. 標題包含「${item.會議}」：開始前 ${item.提前幾分鐘} 分鐘`).join("\n"));
    },
  });

  // 確認按鈕上的白話說明（權限分級會在按鈕訊息顯示）
  describeTools = {
    async calendar_create(input) {
      await writableCalendar(input.calendar);
      const calendar = input.calendar ? `（行事曆：${input.calendar}）` : "";
      return `新增行程：\n${summary(changed(input))}${calendar}${input.note ? `\n備註：${input.note}` : ""}`;
    },
    async calendar_update(input) {
      const target = lookup(input.id);
      await ensureWritable(target.calendarId);
      const current = await fetchEvent(target);
      const after = changed(input, current);
      const repeat = current.recurringEventId ? "\n（重複活動：只改這一次）" : "";
      const others = current.attendees?.length > 1 ? "\n⚠️ 這個活動有其他參加者，修改不會通知他們" : "";
      const before = summary(current), now = summary({ ...after, summary: after.summary, location: after.location });
      const oldNote = (current.description ?? "").trim(), newNote = (after.description ?? "").trim();
      // 真機驗收時只改了備註，按鈕卻只顯示日期時間標題，「原本」「改成」一模一樣；備註有改就列出來，什麼都沒改就不問
      if (before === now && oldNote === newNote) throw new Error("跟原本的行程一樣，沒有要改的");
      // 只改備註、使用者也沒提到行事曆：不跳按鈕，請秘書改提醒就好。
      // 真機驗收時，同一本對話裡有前例（補充討論事項就順手改備註），說明壓不過，所以由程式看使用者原話
      if (before === now && !/行事曆|日曆|備註/.test(bridge.userText?.() ?? "")) {
        throw new Error("使用者只是補充要討論、要記得的事，沒有說要寫進行事曆；更新提醒就好，不用改行程的備註");
      }
      const note = oldNote !== newNote ? `\n備註：${oldNote || "（無）"} → ${newNote || "（無）"}` : "";
      return `修改行程：\n原本：${before}\n改成：${now}${note}${repeat}${others}`;
    },
    async calendar_delete({ id }) {
      const target = lookup(id);
      await ensureWritable(target.calendarId);
      const current = await fetchEvent(target);
      const repeat = current.recurringEventId ? "\n（重複活動：只刪這一次）" : "";
      const others = current.attendees?.length > 1 ? "\n⚠️ 這個活動有其他參加者，刪除不會通知他們" : "";
      return `⚠️ 刪除行程：\n${summary(current)}${repeat}${others}\n刪錯了可以到 Google 行事曆的「垃圾桶」還原。`;
    },
  };
}

/** 執行級工具的確認說明；外掛載入後才有內容（要用到授權與編號）。 */
let describeTools = {};
let pluginRoot = "."; // 會前準備的設定檔在哪（外掛載入時設定）

/** 會前準備的參數檢查（按鈕說明與實際設定共用）。 */
function checkPrep({ meeting, minutes }) {
  const title = String(meeting ?? "").trim();
  if (!title || title.length > 50) throw new Error("會議名稱要是 1～50 個字（行事曆標題裡會出現的字）");
  const before = minutes === undefined || minutes === null || minutes === "" ? 30 : Number(minutes);
  if (!Number.isInteger(before) || before < 5 || before > 180) throw new Error("開會前幾分鐘要是 5～180 的整數");
  return { 會議: title, 提前幾分鐘: before, 要他做的事: `照 meeting-prep 技能，整理「${title}」上一次的會議紀錄` };
}

function loadPreps(root) {
  let data = {};
  try {
    data = JSON.parse(readFileSync(join(root, "通知.json"), "utf8"));
  } catch (error) {
    if (existsSync(join(root, "通知.json"))) throw new Error(`通知.json 格式壞掉了，請使用者先修好或刪掉它：${error.message}`);
  }
  const list = (Array.isArray(data.會前準備) ? data.會前準備 : [])
    .filter((item) => item && typeof item.會議 === "string" && item.提前幾分鐘 > 0 && typeof item.要他做的事 === "string");
  return { data, list };
}

function savePreps(root, data, list) {
  writeFileSync(join(root, "通知.json"), `${JSON.stringify({
    說明: "秘書的主動通知設定。會前提醒：開會前幾分鐘提醒；落在午休時段的提前到午休前。會前準備：標題包含這些字的會議，開始前先整理上一次的會議紀錄給你。重要信件：寄件人（姓名、信箱或 @網域）或主旨包含這些字的新信，會傳通知給你。可以直接改，不用重啟。",
    ...data,
    會前準備: list,
  }, null, 2)}\n`);
}

// ── 會前提醒：主程式每 30 秒呼叫 tick；每 5 分鐘才真的去查一次「接下來 4 小時」的行程（不經模型）──
const SETTINGS = "通知.json";
const STATE = join("data", "會前提醒.json"); // 已經提醒過哪幾場；重啟後不重複
const FETCH_MINUTES = 5;
const LOOKAHEAD_HOURS = 4; // 會前準備最多可以設開會前 180 分鐘
const DEFAULT_SETTINGS = { 提前幾分鐘: 15, 午休時段: "12:00-13:00", 午休前提醒時間: "11:50" };
let upcomingEvents = null; // 外掛載入、授權都好了才有
const cache = { at: 0, events: [] };
let authWarned = false;

/** 通知.json 的「會前提醒」；沒有檔案或格式不對就用預設值。 */
function reminderSettings(root) {
  try {
    const custom = JSON.parse(readFileSync(join(root, SETTINGS), "utf8")).會前提醒 ?? {};
    const merged = { ...DEFAULT_SETTINGS, ...custom };
    if (!(merged.提前幾分鐘 > 0) || !/^\d\d:\d\d-\d\d:\d\d$/.test(merged.午休時段) || !TIME.test(merged.午休前提醒時間)) throw new Error("欄位格式不對");
    return merged;
  } catch (error) {
    if (existsSync(join(root, SETTINGS))) console.error("通知.json 的「會前提醒」讀不懂，先用預設值：", error.message);
    return DEFAULT_SETTINGS;
  }
}

/** 什麼時候提醒：開會前 N 分鐘；那個時間落在午休時段，就提前到午休前（例：13:00 的會 → 11:50 提醒）。 */
function remindAt(start, settings) {
  const at = new Date(start.getTime() - settings.提前幾分鐘 * 60_000);
  const [from, to] = settings.午休時段.split("-").map((text) => +text.slice(0, 2) * 60 + +text.slice(3));
  const minutes = at.getHours() * 60 + at.getMinutes();
  if (minutes < from || minutes >= to) return { at, early: false };
  const [hour, minute] = settings.午休前提醒時間.split(":");
  return { at: new Date(at.getFullYear(), at.getMonth(), at.getDate(), +hour, +minute), early: true };
}

const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** /status 顯示：會前提醒提前幾分鐘、有沒有設會前準備。 */
export const statusOrder = 4;
export function status(bridge) {
  if (!upcomingEvents) return "🗓 行事曆：還沒授權，不會提醒開會（執行 node 外掛/行事曆/授權.mjs）";
  const settings = reminderSettings(bridge.root);
  const lines = [`🗓 會前提醒：行事曆上的會議，開會前 ${settings.提前幾分鐘} 分鐘提醒你（${settings.午休時段} 的會改在 ${settings.午休前提醒時間} 先提醒）`];
  try {
    const preps = loadPreps(bridge.root).list;
    if (preps.length > 0) {
      lines.push(`📋 會前準備：${preps.map((item) => `標題有「${item.會議}」的會，開會前 ${item.提前幾分鐘} 分鐘整理上次紀錄`).join("；")}`);
    }
  } catch (error) {
    lines.push(`📋 會前準備：讀不到（${error.message}）`);
  }
  return lines.join("\n");
}

export async function tick(bridge) {
  if (!upcomingEvents) return;
  const now = Date.now();
  if (now - cache.at >= FETCH_MINUTES * 60_000) {
    cache.at = now;
    try {
      cache.events = await upcomingEvents(now, now + LOOKAHEAD_HOURS * 3_600_000);
      authWarned = false;
    } catch (error) {
      // 授權過期這類問題只通知一次，不要每 5 分鐘吵一次
      if (!authWarned) {
        authWarned = true;
        await bridge.notify(`⚠️ 會前提醒暫停：${error.message}`);
      }
      return;
    }
  }
  const settings = reminderSettings(bridge.root);
  const statePath = join(bridge.root, STATE);
  let sent = {};
  try {
    sent = JSON.parse(readFileSync(statePath, "utf8"));
  } catch {}
  let changed = false;
  for (const event of cache.events) {
    if (!event.start?.dateTime) continue; // 全天活動不提醒
    const start = new Date(event.start.dateTime);
    const key = `${event.id}|${event.start.dateTime}`; // 時間改了就當成新的一場
    if (sent[key] || now >= start.getTime()) continue;
    const { at, early } = remindAt(start, settings);
    if (now < at.getTime()) continue;
    sent[key] = new Date(now).toISOString();
    changed = true;
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const detail = `${clock(start)}${end ? `–${clock(end)}` : ""}${event.location ? `＠${event.location}` : ""}`;
    const minutes = Math.max(1, Math.round((start.getTime() - now) / 60_000));
    const title = event.summary ?? "（沒有標題）";
    const text = early
      ? `📅 ${clock(start)} ${title}（${detail}）\n午休前先提醒你`
      : `📅 ${minutes} 分鐘後：${title}（${detail}）`;
    await bridge.notify(event.htmlLink ? `${text}\n🔗 ${event.htmlLink}` : text);
  }
  // 會前準備：標題符合的會議，開始前 N 分鐘交給秘書整理上一次的會議紀錄（照例行工作的規矩：排隊、只能查、只能寫 文件/）
  let preps = [];
  try {
    preps = loadPreps(bridge.root).list;
  } catch (error) {
    console.error(error.message);
  }
  for (const event of cache.events) {
    if (!event.start?.dateTime || !bridge.runRoutine) continue;
    const title = event.summary ?? "";
    const start = new Date(event.start.dateTime);
    for (const prep of preps.filter((item) => title.includes(item.會議))) {
      const key = `準備|${event.id}|${event.start.dateTime}`;
      if (sent[key] || now >= start.getTime()) continue;
      const { at, early } = remindAt(start, { ...settings, 提前幾分鐘: prep.提前幾分鐘 });
      if (now < at.getTime()) continue;
      sent[key] = new Date(now).toISOString();
      changed = true;
      const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
      const detail = `${start.toLocaleDateString("sv-SE")} ${clock(start)}${end ? `–${clock(end)}` : ""}${event.location ? `＠${event.location}` : ""}`;
      bridge.runRoutine(
        { name: `會前準備：${title}`, task: `${prep.要他做的事}。這次的會：${title}（${detail}）。` },
        early ? `${clock(start)} 開會，午休前先準備` : `${clock(start)} 開會前 ${prep.提前幾分鐘} 分鐘`,
      );
    }
  }
  // 兩天前的紀錄刪掉，檔案不會一直變大
  for (const [key, value] of Object.entries(sent)) {
    if (now - new Date(value).getTime() > 2 * 86_400_000) {
      delete sent[key];
      changed = true;
    }
  }
  if (changed) {
    mkdirSync(join(bridge.root, "data"), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(sent, null, 2)}\n`);
  }
}
export const describe = {
  calendar_create: (input) => describeTools.calendar_create(input),
  calendar_update: (input) => describeTools.calendar_update(input),
  calendar_delete: (input) => describeTools.calendar_delete(input),
  add_meeting_prep: async (input) => {
    const prep = checkPrep(input);
    const old = loadPreps(pluginRoot).list.find((item) => item.會議 === prep.會議);
    return [
      `${old ? "修改" : "新增"}會前準備：行事曆標題包含「${prep.會議}」的會議`,
      `時間：每次開始前 ${prep.提前幾分鐘} 分鐘${old ? `（原本 ${old.提前幾分鐘} 分鐘）` : ""}`,
      "要他做的事：在 文件/ 找上一次同名會議的紀錄，摘要重點、決議、還沒完成的事項",
    ].join("\n");
  },
  remove_meeting_prep: async ({ meeting }) => `取消會前準備：「${meeting}」`,
};
