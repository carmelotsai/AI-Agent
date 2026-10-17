// 地圖：透過 SerpApi 查 Google 地圖——地點的營業時間、票價（maps_place），兩地之間的車程（maps_route）。
// 回傳的是 Google 地圖上的原始欄位，不經模型改寫。金鑰只由這個外掛讀取，不會出現在回傳結果裡。
// .env 沒有 SERPAPI_KEY 時不提供查地圖；拿掉這個資料夾再重啟，秘書就不會查地圖，其他功能照常。
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const KEY = process.env.SERPAPI_KEY;
const CACHE_DAYS = 7;   // 同樣的查詢 7 天內直接用快取，不再花額度
const DAILY_LIMIT = 30; // 每天最多真的查幾次（免費方案每月 250 次）
const MODES = { Driving: "開車", Transit: "大眾運輸", "Two-wheeler": "機車", Walking: "步行", Cycling: "自行車", Flight: "飛機" };

/** 權限等級：只查資料、不影響外界，屬於「查閱」。 */
export const levels = { maps_place: "查閱", maps_route: "查閱" };

/** 加進秘書的 system prompt（沒有金鑰就不加）。 */
export const prompt = KEY
  ? "使用者問地點的營業時間、公休日、票價，或兩地之間要多久時：用 maps_place 查地點、maps_route 查車程，不要憑記憶回答。" +
    "排行程、規劃旅遊時也一樣：你有這兩個工具（國內外都查得到），每一站的營業時間、站與站之間的車程都要查；行程檔存好後，程式會比對有沒有沒查證的時間。" +
    "但要先照 trip-plan 技能把日期、天數、交通、風格、人數與節奏問清楚，使用者回答後才開始查。搭火車、高鐵、客運的段落，用 maps_route 加 depart_at（出發日期與時間）查班次。" +
    "查到的名稱跟使用者說的對不上，或有好幾個可能的地點（例如同名的不同公司、分店）時，先列出候選請使用者確認是哪一個，確認後再往下排。" +
    "每次查詢都會用掉 SerpApi 額度（每月 250 次），同一個地點或路線不要重複查。" +
    "查不到的營業時間就寫「Google 地圖沒有列出，請自行確認」，不可以用自己的記憶補上，也不要加「通常」「大約」之類的推測時間。回覆時註明「資料來自 Google 地圖（查詢於某日）」；營業時間只有每週固定時段，國定假日、臨時公休不一定查得到，要提醒使用者出發前再確認。"
  : "";

/** 秒數 → 「1 小時 28 分」（SerpApi 的文字有時會被截掉「分」）。 */
function minutesText(seconds, fallback) {
  if (typeof seconds !== "number") return fallback;
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分` : `${minutes} 分`;
}

const TRAIN_NAMES = { "Local Train": "區間車", "Tze-Chiang Limited Express": "自強號", "Chu-Kuang Express": "莒光號", "High-Speed Rail": "高鐵", Taroko: "太魯閣號", Puyouma: "普悠瑪號" };

/** 「上午8:04」「下午1:11」→「08:04」「13:11」；看不懂就照原樣。 */
function clock(text = "") {
  const match = /^(上午|下午|中午|凌晨|晚上)?\s*(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return text;
  const hour = (Number(match[2]) % 12) + (["下午", "晚上", "中午"].includes(match[1]) ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[3]}`;
}

/** 車次名稱翻成中文（「Tze-Chiang Limited Express 418 往臺東」→「自強號 418 往臺東」）。 */
function trainTitle(title = "") {
  return Object.entries(TRAIN_NAMES).reduce((result, [english, chinese]) => result.replace(english, chinese), title);
}

/** 大眾運輸的一個選項：出發→抵達、要轉幾次車、每一段搭什麼。 */
function transitPlan(route) {
  const rides = (route.trips ?? []).filter((trip) => trip.travel_mode !== "Walking");
  return {
    出發抵達: `${clock(rides[0]?.start_stop?.time)} → ${clock(rides.at(-1)?.end_stop?.time)}`,
    時間: minutesText(route.duration, route.formatted_duration),
    轉乘: rides.length > 1 ? `${rides.length - 1} 次` : "不用轉車",
    分段: (route.trips ?? []).map((trip) => trip.travel_mode === "Walking"
      ? `步行 ${trip.formatted_duration ?? ""}`.trim()
      : `${trainTitle(trip.title)}：${trip.start_stop?.name} ${clock(trip.start_stop?.time)} → ${trip.end_stop?.name} ${clock(trip.end_stop?.time)}`),
  };
}

/** 「2026-10-24 08:00」（當地時間）→ SerpApi 的 depart_at。SerpApi 把時間戳當成當地的鐘面時間（實測），所以用 UTC 編碼。 */
function departAt(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) throw new Error(`出發時間要寫成「2026-10-24 08:00」，收到「${text}」`);
  const [, y, mo, d, h, mi] = match.map(Number);
  return `depart_at:${Date.UTC(y, mo - 1, d, h, mi) / 1000}`;
}

class LimitError extends Error {} // 到每日上限（跟網路錯誤分開，回覆要特別提醒）

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（本地時間）

/** 呼叫 SerpApi；有新鮮的快取就用快取。回傳 { data, queriedAt }。 */
async function serp(cacheDir, params) {
  mkdirSync(cacheDir, { recursive: true });
  const hash = createHash("sha1").update(JSON.stringify(params)).digest("hex").slice(0, 16);
  const cacheFile = join(cacheDir, `${hash}.json`);
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (Date.now() - cached.savedAt < CACHE_DAYS * 86_400_000) return { data: cached.data, queriedAt: cached.queriedAt, cached: true };
  }
  const usageFile = join(cacheDir, "usage.json");
  const usage = existsSync(usageFile) ? JSON.parse(readFileSync(usageFile, "utf8")) : {};
  const count = usage.date === today() ? usage.count : 0;
  if (count >= DAILY_LIMIT) {
    throw new LimitError(`今天查地圖已經 ${DAILY_LIMIT} 次，到每日上限了，明天再查。沒查到的車程、營業時間不要自己估，照實告訴使用者沒查到。`);
  }
  writeFileSync(usageFile, JSON.stringify({ date: today(), count: count + 1 }));

  const url = `https://serpapi.com/search.json?${new URLSearchParams({ ...params, api_key: KEY })}`;
  let data;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    data = await response.json();
  } catch (error) {
    throw new Error(`連不上地圖服務（${error.name === "TimeoutError" ? "逾時" : "網路錯誤"}），請稍後再試。`);
  }
  if (data.error) throw new Error(`地圖查不到：${data.error}`);
  delete data.search_metadata; // 不存查詢紀錄的連結
  const queriedAt = today();
  writeFileSync(cacheFile, JSON.stringify({ savedAt: Date.now(), queriedAt, data }));
  return { data, queriedAt, cached: false };
}

/** 一週的營業時間：{ 星期日: "09:00–17:00", … }；Google 地圖沒有就回傳說明文字。 */
function weeklyHours(place) {
  if (place.operating_hours && typeof place.operating_hours === "object") return place.operating_hours;
  if (Array.isArray(place.hours)) return Object.assign({}, ...place.hours);
  return "Google 地圖沒有列出營業時間（不要自己推測，請使用者自行確認）";
}

function summarizePlace(place) {
  return {
    名稱: place.title,
    地址: place.address,
    類型: [place.type ?? place.types ?? []].flat().join("、") || undefined,
    評分: place.rating ? `${place.rating}（${place.reviews ?? "?"} 則評論）` : undefined,
    營業時間: weeklyHours(place),
    票價: place.admission?.[0]?.options?.map((option) => `${option.title ?? ""} ${option.price ?? ""}`.trim()).join("、") || undefined,
    電話: place.phone,
  };
}

const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 1) }], details: {} });

/** 一週營業時間縮成一句：「每天 09:00–17:00」或「星期一 休息；其他天 09:00–17:00」。 */
function compactHours(hours) {
  if (typeof hours !== "object") return "Google 地圖沒有列出營業時間";
  const groups = new Map();
  for (const [day, time] of Object.entries(hours)) groups.set(time, [...(groups.get(time) ?? []), day]);
  const [common] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (groups.size === 1) return `每天 ${common}`;
  const others = [...groups.entries()].filter(([time]) => time !== common).map(([time, days]) => `${days.join("、")} ${time}`);
  return `${others.join("；")}；其他天 ${common}`;
}

const TRIP_FILE = /^文件\/[^/]*行程[^/]*\.md$/;
const LOG_HEADING = "## 地圖查詢紀錄（系統自動附上）";

/** 比對行程檔：寫了幾處營業時間、車程，這一輪實際查了幾個地點、幾段路線；寫的比查的多，多出來的就是沒查證的。 */
function auditTrip(body, counts) {
  const lines = body.split("\n");
  const marked = /未查|估計|沒有列出|自行確認/; // 秘書自己標了沒查證的，不算
  const hours = lines.filter((line) => line.includes("營業時間") && !marked.test(line)).length;
  const drives = lines.filter((line) => /車程|🚗|🚆/.test(line) && /\d+\s*(分|小時)/.test(line) && !marked.test(line)).length;
  const warnings = [];
  if (hours > counts.地點) warnings.push(`⚠️ 行程寫了 ${hours} 處營業時間，這一輪只查了 ${counts.地點} 個地點；其他的是秘書寫的，沒有查證，請自行確認。`);
  if (drives > counts.路線) warnings.push(`⚠️ 行程寫了 ${drives} 處車程，這一輪只查了 ${counts.路線} 段路線；其他的是秘書估的，請自行確認。`);
  return warnings;
}

export default function (pi, bridge) {
  if (!KEY) {
    console.log("外掛「地圖」：.env 沒有 SERPAPI_KEY，先不提供查地圖。");
    return;
  }
  const cacheDir = join(bridge.root, "data", "maps-cache");
  // 這一輪（使用者傳一則訊息到秘書回完）真的查過的東西；由程式記錄，模型碰不到
  let records = [];
  let counts = { 地點: 0, 路線: 0 };
  let limitHit = false; // 這一輪有沒有撞到每日上限
  let tripWarnings = []; // 這一輪寫的行程檔，有多少營業時間、車程沒查證
  let nudged = false; // 這一輪已經要求秘書補查過（只要求一次，避免來回不停）
  pi.on("agent_start", () => { records = []; counts = { 地點: 0, 路線: 0 }; limitHit = false; tripWarnings = []; nudged = false; });
  // 回覆最後附一行：只有真的查過或寫了行程才會有，秘書自稱「資料來自 Google 地圖」時可以對照
  const updateNote = (queriedAt = today()) => bridge.setReplyNote?.("地圖", [
    `📍 本次實際查了 ${counts.地點} 個地點、${counts.路線} 段路線（Google 地圖，查詢於 ${queriedAt}）`,
    ...(limitHit ? [`⚠️ 今天查地圖已到每日上限（${DAILY_LIMIT} 次），沒查到的地點、車程是秘書估的，請自己確認。`] : []),
    ...tripWarnings,
  ].join("\n"));
  const lookup = async (params) => {
    try {
      return await serp(cacheDir, params);
    } catch (error) {
      if (error instanceof LimitError) {
        limitHit = true;
        updateNote();
      }
      throw error;
    }
  };
  const record = (kind, line, cached, queriedAt) => {
    console.log(`查地圖：${line}（${cached ? "快取" : "新查詢"}）`);
    if (records.includes(line)) return;
    records.push(line);
    counts[kind]++;
    updateNote(queriedAt);
  };

  // 秘書寫好「文件/…行程….md」後，在最後附上（或更新）這一輪的查詢紀錄，並比對有多少沒查證
  pi.on("tool_result", (event) => {
    if ((event.toolName !== "write" && event.toolName !== "edit") || event.isError) return undefined;
    const full = resolve(bridge.root, event.input.path ?? "");
    if (!TRIP_FILE.test(relative(bridge.root, full).split(sep).join("/")) || !existsSync(full)) return undefined;
    const body = readFileSync(full, "utf8").split(`\n---\n${LOG_HEADING}`)[0].trimEnd();
    tripWarnings = auditTrip(body, counts);
    const lines = records.length > 0 ? records : ["這一輪沒有查 Google 地圖。"];
    writeFileSync(full, `${body}\n\n---\n${LOG_HEADING}\n\n${[...lines, ...tripWarnings].map((line) => `- ${line}`).join("\n")}\n`);
    updateNote();
    if (tripWarnings.length === 0 || nudged || limitHit) return undefined;
    // 有沒查證的時間：把結果退回給秘書，要求補查（每一輪一次；查到上限就改標「未查」）
    nudged = true;
    return {
      content: [...event.content, { type: "text", text: [
        "【系統檢查】行程檔已存，但有時間沒有查證：",
        ...tripWarnings.map((line) => line.replace(/^⚠️ /, "")),
        "你有 maps_place、maps_route 工具：請用 maps_place 查行程裡每一站的營業時間、用 maps_route 查站與站之間的車程，再用 edit 把查到的結果改進行程檔。",
        "查不到、或查到每日上限的，改寫成「營業時間：未查，請自行確認」「車程約 N 分（估計，未查）」。改完再回覆使用者。",
      ].join("\n") }],
    };
  });

  pi.registerTool({
    name: "maps_place",
    label: "查地點",
    description: "在 Google 地圖查一個地點：地址、評分、每週營業時間、票價。找到好幾個同名地點時列出前 3 個。",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "地點名稱，最好加上城市，例如「台北 國立故宮博物院」" } },
      required: ["query"],
    },
    async execute(_toolCallId, { query }) {
      const { data, queriedAt, cached } = await lookup({ engine: "google_maps", q: query, hl: "zh-tw", gl: "tw" });
      const places = data.place_results ? [data.place_results] : (data.local_results ?? []).slice(0, 3);
      if (places.length === 0) throw new Error(`Google 地圖找不到「${query}」`);
      record("地點", `${places[0].title}：${compactHours(weeklyHours(places[0]))}（查詢於 ${queriedAt}）`, cached, queriedAt);
      return text({ 資料來源: `Google 地圖（查詢於 ${queriedAt}）`, 結果: places.map(summarizePlace) });
    },
  });

  pi.registerTool({
    name: "maps_route",
    label: "查車程",
    description: "在 Google 地圖查兩地之間各種交通方式（開車、大眾運輸、機車、步行）要多久，以及建議路線。" +
      "搭火車、高鐵、客運時填 depart_at（出發日期與時間），會查那個時間之後的班次：車次、上下車時刻、要不要轉車。",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "出發地，例如「台北車站」" },
        to: { type: "string", description: "目的地，例如「九份老街」" },
        depart_at: { type: "string", description: "選填，搭大眾運輸的出發時間（當地時間），格式「2026-10-24 08:00」" },
      },
      required: ["from", "to"],
    },
    async execute(_toolCallId, { from, to, depart_at }) {
      if (depart_at) {
        // 指定出發時間：只查大眾運輸，列出那個時間之後的班次
        const { data, queriedAt, cached } = await lookup({ engine: "google_maps_directions", start_addr: from, end_addr: to, travel_mode: "3", time: departAt(depart_at), hl: "zh-tw", gl: "tw" });
        const plans = (data.directions ?? []).filter((route) => route.trips?.length).slice(0, 3).map(transitPlan);
        if (plans.length === 0) throw new Error(`Google 地圖查不到「${from}」到「${to}」在 ${depart_at} 之後的大眾運輸班次`);
        const rides = plans[0].分段.filter((leg) => !leg.startsWith("步行")).map((leg) => leg.split("：")[0]).join("、");
        record("路線", `${from} → ${to}（${depart_at} 後出發）：大眾運輸 ${plans[0].時間}，${plans[0].出發抵達}（${rides}）（查詢於 ${queriedAt}）`, cached, queriedAt);
        return text({
          資料來源: `Google 地圖（查詢於 ${queriedAt}）；時刻表可能調整，出發前請到台鐵、高鐵、客運官網確認`,
          起點: data.places_info?.[0]?.address ?? from,
          終點: data.places_info?.at(-1)?.address ?? to,
          出發時間: `${depart_at} 之後`,
          班次選項: plans,
        });
      }
      const { data, queriedAt, cached } = await lookup({ engine: "google_maps_directions", start_addr: from, end_addr: to, hl: "zh-tw", gl: "tw" });
      if (!data.directions?.length && !data.durations?.length) throw new Error(`Google 地圖查不到「${from}」到「${to}」的路線`);
      const modes = Object.fromEntries((data.durations ?? []).map((item) => [MODES[item.travel_mode] ?? item.travel_mode, minutesText(item.duration, item.formatted_duration)]));
      const main = ["開車", "大眾運輸", "機車"].filter((mode) => modes[mode]).map((mode) => `${mode} ${modes[mode]}`).join("、");
      record("路線", `${from} → ${to}：${main || "查無時間"}（查詢於 ${queriedAt}）`, cached, queriedAt);
      return text({
        資料來源: `Google 地圖（查詢於 ${queriedAt}，依當時路況估計）`,
        起點: data.places_info?.[0]?.address ?? from,
        終點: data.places_info?.at(-1)?.address ?? to,
        各交通方式: modes,
        建議路線: (data.directions ?? []).slice(0, 3).map((route) => ({
          交通方式: MODES[route.travel_mode] ?? route.travel_mode,
          時間: minutesText(route.duration, route.formatted_duration),
          距離: route.formatted_distance,
          經由: route.via,
          // 大眾運輸附上班次；沒指定出發時間時，是依查詢當下找的班次，只能當參考
          ...(route.trips?.length && route.travel_mode === "Transit" ? { 參考班次_依查詢當下時間: transitPlan(route) } : {}),
        })),
      });
    },
  });
}
