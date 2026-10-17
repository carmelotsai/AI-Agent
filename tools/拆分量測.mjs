// 拆分量測（L5-1）：用同一份題庫考秘書兩次，看「拆出部門助理」會不會讓他做得更好。
//   ① 現在的秘書：全部外掛、全部部門的規則都在他身上
//   ② 拆分之後：每題只給那個部門的外掛和規則（模擬部門助理）
// 用法（在專案資料夾的 PowerShell，自己跑，不要交給 coding agent）：
//   node --env-file=.env tools/拆分量測.mjs          ← 每題每組跑 3 次
//   node --env-file=.env tools/拆分量測.mjs 2        ← 每題每組跑 2 次（省額度）
// 規則：
// - 會用真的 Gemini、花真的額度：開跑前先印出預估請求數，按 Enter 才開始（加 --yes 不問，品檢用）。
// - 在專案的暫存副本裡考：副本不含 .env、data/、文件/、日誌/、角色/ 和題庫本身（秘書偷看不到答案），考完刪掉。
// - 工具一律不真的執行：不寄信、不改行事曆、不寫檔；只記下秘書「想用哪個工具」。查資料的 read、grep、find、ls 在副本裡照常。
// - 報告寫到 文件/拆分量測/日期_時間.md，原始紀錄在 data/拆分量測/。
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BANK_FILE = "量測題庫.json";
const MODEL_CANDIDATES = ["gemini-3.5-flash-lite", "gemini-2.5-flash-lite", "gemini-3.5-flash"];
const SHELL_TOOL = process.platform === "win32" ? "powershell" : "bash";
const BUILTIN = ["read", "write", "edit", SHELL_TOOL, "grep", "find", "ls"];
const LOOKUP = ["read", "grep", "find", "ls"];
const BETTER = 10;     // ② 比 ① 高幾個百分點以上，才算「拆了會變好」
const NOT_COPIED = new Set(["node_modules", ".git", ".claude", ".env", "data", "文件", "日誌", "角色", BANK_FILE, "agent.log"]);

const args = process.argv.slice(2);
const ROUNDS = Math.max(1, Math.min(5, Number(args.find((arg) => /^\d+$/.test(arg)) ?? 3)));
const YES = args.includes("--yes");
// 每分鐘最多幾次請求（免費層上限很低，也別吃光秘書平常要用的額度）；品檢用假 Gemini 時用 --rpm=600 放寬
const PER_MINUTE = Number(args.find((arg) => arg.startsWith("--rpm="))?.slice(6)) || 8;
const pad = (value) => String(value).padStart(2, "0");
const now = new Date();
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
const norm = (text) => String(text).replace(/\s+/g, "").replace(/，/g, ",").replace(/（/g, "(").replace(/）/g, ")");

// ── 題庫 ─────────────────────────────────────────────────────────────
if (!process.env.GEMINI_API_KEY) {
  console.log("找不到 GEMINI_API_KEY。請在專案資料夾執行：node --env-file=.env tools/拆分量測.mjs");
  process.exit(1);
}
if (!existsSync(join(ROOT, BANK_FILE))) {
  console.log(`找不到 ${BANK_FILE}（題庫）。請先照 L5-1 手冊寫好再跑。`);
  process.exit(1);
}
let bank;
try {
  bank = JSON.parse(readFileSync(join(ROOT, BANK_FILE), "utf8"));
} catch (error) {
  console.log(`${BANK_FILE} 讀不懂（JSON 格式錯了）：${error.message}`);
  process.exit(1);
}
const departments = bank.部門 ?? {};
const deptNames = Object.keys(departments);
const problems = [];
if (deptNames.length === 0) problems.push("「部門」至少要寫一個（要拆出去的部門，例如業務）");
const questions = (bank.題目 ?? []).map((item, index) => ({ ...item, 編號: index + 1, 類: item.該用的工具 ? "工具" : "規則" }));
for (const item of questions) {
  if (!item.問題) problems.push(`第 ${item.編號} 題沒有「問題」`);
  if (item.部門 !== "秘書" && !departments[item.部門]) problems.push(`第 ${item.編號} 題的部門「${item.部門}」不在「部門」裡（也可以寫「秘書」）`);
  if (!item.該用的工具 && !item.必含 && !item.不可含) problems.push(`第 ${item.編號} 題要寫「該用的工具」或「必含／不可含」其中一種`);
}
if (questions.length === 0) problems.push("「題目」是空的");
if (problems.length > 0) {
  console.log(`${BANK_FILE} 有問題，先修好再跑：\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

// ── 暫存副本：秘書在這裡考試，看不到題庫、.env、使用者資料 ────────────────
function copyTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (from === ROOT && NOT_COPIED.has(entry.name)) continue;
    if (entry.isDirectory()) {
      mkdirSync(join(to, entry.name), { recursive: true });
      copyTree(join(from, entry.name), join(to, entry.name));
    } else if (entry.isFile()) {
      copyFileSync(join(from, entry.name), join(to, entry.name));
    }
  }
}
const COPY = mkdtempSync(join(tmpdir(), "拆分量測-"));
copyTree(ROOT, COPY);
symlinkSync(join(ROOT, "node_modules"), join(COPY, "node_modules"), "junction");
for (const dir of ["data/pi-agent", "data/google", "文件", "日誌"]) mkdirSync(join(COPY, dir), { recursive: true });
// 讓需要授權的外掛也註冊得了工具（工具不會真的執行，所以放假的就好；真的授權檔不帶進副本）
for (const file of ["client.json", "token.json", "gmail-token.json"]) writeFileSync(join(COPY, "data", "google", file), "{}");
process.env.SERPAPI_KEY ||= "量測用";
function cleanup() {
  try { unlinkSync(join(COPY, "node_modules")); } catch {}
  rmSync(COPY, { recursive: true, force: true });
}

// ── 外掛（從副本載入）────────────────────────────────────────────────
const plugins = [];
for (const entry of readdirSync(join(COPY, "外掛"), { withFileTypes: true })) {
  const file = join(COPY, "外掛", entry.name, "index.mjs");
  if (!entry.isDirectory() || !existsSync(file)) continue;
  try {
    const module = await import(pathToFileURL(file).href);
    if (typeof module.default === "function") plugins.push({ name: entry.name, module });
  } catch (error) {
    console.log(`外掛「${entry.name}」載入失敗，量測時先略過：${error.message}`);
  }
}
const pluginNames = plugins.map((plugin) => plugin.name);
for (const [name, dept] of Object.entries(departments)) {
  const missing = (dept.外掛 ?? []).filter((plugin) => !pluginNames.includes(plugin));
  if (missing.length > 0) console.log(`⚠️ 部門「${name}」的外掛 ${missing.join("、")} 不在 外掛/ 裡，量測時當作沒有`);
}
const deptPlugins = (name) => name === "秘書"
  // 秘書留下的：沒有分給任何部門的外掛
  ? pluginNames.filter((plugin) => !deptNames.some((dept) => (departments[dept].外掛 ?? []).includes(plugin)))
  : (departments[name].外掛 ?? []).filter((plugin) => pluginNames.includes(plugin));
const fakeBridge = new Proxy({ root: COPY, userText: () => "", journalTodos: () => ({ day: null, items: [] }) }, {
  get: (target, key) => (key in target ? target[key] : async () => undefined),
});

// ── 預估、確認 ───────────────────────────────────────────────────────
// 每次考一題平均約 2 次請求（先查再做、選了工具後還有一次）：2026-10-14 真機 72 次考試用了 145 次
const estimate = Math.ceil(questions.length * 2 * ROUNDS * 2);
const limit = estimate * 2; // 超過這個數就停（萬一模型一直重試）
console.log([
  `拆分量測：${questions.length} 題 × 2 組（① 現在的秘書、② 拆分後）× 每題 ${ROUNDS} 次`,
  `預估 ${estimate} 次 Gemini 請求（上限 ${limit} 次，超過就停），每分鐘最多 ${PER_MINUTE} 次，大約 ${Math.ceil(estimate / PER_MINUTE)} 分鐘。`,
  "會花你 Gemini 金鑰的額度；免費額度的人一天最多跑一次，跑的時候秘書也會比較慢。",
  "工具一律不真的執行（不寄信、不改行事曆、不寫檔）。",
].join("\n"));
if (!YES) {
  const answer = await new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    rl.question("要開始嗎？按 Enter 開始，輸入 n 再按 Enter 取消：", (text) => { done = true; rl.close(); resolve(text); });
    rl.on("close", () => { if (!done) resolve("n"); });
  });
  if (answer.trim().toLowerCase().startsWith("n")) {
    console.log("已取消，沒有花任何額度。");
    cleanup();
    process.exit(0);
  }
}

// ── 考試 ─────────────────────────────────────────────────────────────
const runtime = await ModelRuntime.create({ authPath: join(COPY, "data", "pi-agent", "auth.json") });
const model = MODEL_CANDIDATES.map((id) => runtime.getModel("google", id)).find(Boolean);
if (!model) {
  console.log("找不到可用的 Gemini 模型，請確認 GEMINI_API_KEY。");
  cleanup();
  process.exit(1);
}
const sent = [];
let requests = 0;
async function throttle() {
  for (;;) {
    const time = Date.now();
    while (sent.length > 0 && time - sent[0] > 60_000) sent.shift();
    if (sent.length < PER_MINUTE) break;
    await new Promise((resolve) => setTimeout(resolve, 60_000 - (time - sent[0]) + 200));
  }
  sent.push(Date.now());
  requests++;
  if (requests > limit) throw new Error(`請求數超過上限 ${limit}，停止量測`);
}

const soul = existsSync(join(COPY, "SOUL.md")) ? readFileSync(join(COPY, "SOUL.md"), "utf8") : "";
const memory = existsSync(join(COPY, "MEMORY.md")) ? readFileSync(join(COPY, "MEMORY.md"), "utf8") : "";
function rulesText(names) {
  const parts = names.filter((name) => (departments[name]?.規則 ?? []).length > 0)
    .map((name) => `【${name}】\n${departments[name].規則.map((rule) => `- ${rule}`).join("\n")}`);
  return parts.length > 0 ? `各部門的工作規則（照問題屬於哪個部門，用那個部門的規則）：\n${parts.join("\n")}` : "";
}

/** 考一題：開一個全新的 session（不帶之前的對話），記下他想用哪個工具、回了什麼。 */
async function askOne(question, group) {
  // ① 秘書身上什麼都有；② 只給這題所屬部門的外掛與規則（秘書的題目就給秘書留下的外掛、沒有部門規則）
  const names = group === "①" ? pluginNames : deptPlugins(question.部門);
  const rules = group === "①" ? deptNames : question.部門 === "秘書" ? [] : [question.部門];
  const chosen = plugins.filter((plugin) => names.includes(plugin.name));
  const levels = Object.assign({}, ...chosen.map((plugin) => plugin.module.levels ?? {}));
  const result = { 編號: question.編號, 部門: question.部門, 類: question.類, 組: group, 呼叫: [] };
  let decided = null;
  let session;
  const isQuery = (name) => (levels[name] ?? "執行") === "查閱" && !question.該用的工具.includes(name);
  /** 他選定了這個工具：記下來、停掉這一題（後面的動作不用看）。 */
  const decide = (name) => {
    if (decided) return;
    decided = name;
    setImmediate(() => session?.abort().catch(() => {}));
  };
  const loader = new DefaultResourceLoader({
    cwd: COPY, agentDir: join(COPY, "data", "pi-agent"), noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    noSkills: group === "②" && question.部門 !== "秘書", // 秘書的技能留在秘書身上；部門助理沒有
    extensionFactories: [
      {
        name: "量測",
        factory: (pi) => {
          pi.on("before_provider_request", async (event) => {
            await throttle();
            if (event.payload?.config) event.payload.config.temperature = 0; // 同一題每次盡量一樣，報告才比得出差別
            return event.payload;
          });
          pi.on("tool_call", (event) => {
            result.呼叫.push(event.toolName);
            if (question.類 === "規則") return { block: true, reason: "（量測中，工具不執行；請直接用文字回覆）" };
            if (LOOKUP.includes(event.toolName)) return undefined;
            if (decided) return { block: true, reason: "（量測中，不執行）" };
            // 先查再做是合理的：查閱級又不是答案的工具，回「查無資料」讓他繼續
            if (isQuery(event.toolName) && result.呼叫.length < 5) return { block: true, reason: "（量測中：查詢結果是空的，沒有資料）" };
            decide(event.toolName);
            return { block: true, reason: "（量測中，不執行）" };
          });
        },
      },
      ...chosen.map((plugin) => ({ name: plugin.name, factory: (pi) => plugin.module.default(pi, fakeBridge) })),
    ],
    systemPromptOverride: () => {
      const tools = [...BUILTIN, ...loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()])];
      result.工具數 = tools.length;
      return [
        soul, "---", memory, "---",
        `你有這些工具：${tools.join("、")}，工作目錄是本專案資料夾。使用者要你做就做；做不到就誠實說。`,
        ...chosen.map((plugin) => plugin.module.prompt ?? "").filter(Boolean),
        rulesText(rules),
        "寫給別人的文字直接寫在回覆裡。只輸出要給使用者看的回覆，不要寫出你的思考過程。",
        "用使用者使用的語言回覆。",
      ].filter(Boolean).join("\n\n");
    },
  });
  await loader.reload();
  const toolNames = [...BUILTIN, ...loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()])];
  ({ session } = await createAgentSession({
    cwd: COPY, agentDir: join(COPY, "data", "pi-agent"), modelRuntime: runtime, model, resourceLoader: loader,
    tools: toolNames, sessionManager: SessionManager.inMemory(), thinkingLevel: "medium",
  }));
  let error = "";
  session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    if (event.message.errorMessage) error = event.message.errorMessage;
    // 參數不合格的工具呼叫不會走到 tool_call，從模型的回覆裡直接看他選了哪個工具
    if (question.類 !== "工具") return;
    for (const block of event.message.content ?? []) {
      if (block.type === "toolCall" && !LOOKUP.includes(block.name) && !isQuery(block.name)) decide(block.name);
    }
  });
  const week = "日一二三四五六";
  const time = new Date();
  try {
    await session.prompt(`【現在時間：${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}（星期${week[time.getDay()]}）】\n${question.問題}`);
  } catch (caught) {
    if (!decided) error ||= String(caught?.message ?? caught);
  }
  if (decided) error = ""; // 選定工具後由量測中止，不算出錯
  const messages = session.messages;
  const first = messages.find((message) => message.role === "assistant" && message.usage);
  result.輸入token = first?.usage ? (first.usage.input ?? 0) + (first.usage.cacheRead ?? 0) : null;
  if (question.類 === "工具") {
    result.選了 = decided ?? "（沒用工具）";
    result.對 = question.該用的工具.includes(decided);
  } else {
    const reply = [...messages].reverse().find((message) => message.role === "assistant" && Array.isArray(message.content))
      ?.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim() ?? "";
    const text = norm(reply);
    result.缺 = (question.必含 ?? []).filter((word) => !text.includes(norm(word)));
    result.混到 = (question.不可含 ?? []).filter((word) => text.includes(norm(word)));
    result.回覆 = reply.slice(0, 200);
    result.對 = reply !== "" && result.缺.length === 0 && result.混到.length === 0;
  }
  if (error) result.錯誤 = error.slice(0, 160);
  session.dispose();
  return result;
}

const results = [];
let stopped = "";
try {
  for (const question of questions) {
    for (const group of ["①", "②"]) {
      for (let round = 1; round <= ROUNDS; round++) {
        const result = await askOne(question, group);
        results.push(result);
        const what = result.類 === "工具" ? `選了 ${result.選了}` : result.對 ? "規則都對" : `缺 ${result.缺.join("、") || "－"}；混到 ${result.混到.join("、") || "－"}`;
        console.log(`${result.對 ? "✅" : "❌"} 第 ${question.編號} 題（${question.部門}）${group} 第 ${round} 次：${what}${result.錯誤 ? `（出錯：${result.錯誤}）` : ""}`);
        if (result.錯誤 && /429|quota|exceeded/i.test(result.錯誤)) throw new Error("Gemini 額度或速率上限到了");
      }
    }
  }
} catch (error) {
  stopped = String(error?.message ?? error);
  console.log(`\n⚠️ 量測中斷：${stopped}。已經考完的題目照樣寫進報告。`);
} finally {
  cleanup();
}

// ── 報告 ─────────────────────────────────────────────────────────────
const rate = (list) => list.length === 0 ? null : Math.round((100 * list.filter((item) => item.對).length) / list.length);
const show = (list) => list.length === 0 ? "－" : `${rate(list)}%（${list.filter((item) => item.對).length}/${list.length}）`;
const pick = (group, kind, dept) => results.filter((item) => item.組 === group && item.類 === kind && (!dept || item.部門 === dept));
const avgTokens = (group) => {
  const list = results.filter((item) => item.組 === group && item.輸入token);
  return list.length === 0 ? null : Math.round(list.reduce((sum, item) => sum + item.輸入token, 0) / list.length);
};
const toolCount = (group, dept) => results.find((item) => item.組 === group && (!dept || item.部門 === dept))?.工具數 ?? "－";
const same = questions.flatMap((question) => ["①", "②"].map((group) => {
  const runs = results.filter((item) => item.編號 === question.編號 && item.組 === group);
  return runs.length < 2 ? null : new Set(runs.map((item) => (item.類 === "工具" ? item.選了 : item.對))).size === 1;
})).filter((value) => value !== null);

// 建議由程式依門檻判斷，不經模型：② 比 ① 高 BETTER 個百分點以上的部門，才建議拆
const verdicts = deptNames.map((dept) => {
  const gaps = ["工具", "規則"].map((kind) => {
    const a = rate(pick("①", kind, dept));
    const b = rate(pick("②", kind, dept));
    return a === null || b === null ? null : { kind, a, b, gap: b - a };
  }).filter(Boolean);
  const better = gaps.filter((item) => item.gap >= BETTER);
  return { dept, gaps, split: better.length > 0, better };
});
const label = (kind) => (kind === "工具" ? "選對工具" : "規則沒搞混");
const tokensA = avgTokens("①");
const tokensB = avgTokens("②");
const conclusion = [
  ...verdicts.map(({ dept, split, better, gaps }) => split
    ? `- **建議拆出「${dept}」**：拆分後${better.map((item) => `${label(item.kind)}從 ${item.a}% 變 ${item.b}%`).join("、")}，高了 ${BETTER} 個百分點以上。`
    : `- **「${dept}」還不用拆**：${gaps.length > 0 ? gaps.map((item) => `${label(item.kind)} ${item.a}% → ${item.b}%`).join("、") : "沒有這個部門的題目"}，差不到 ${BETTER} 個百分點。`),
  ...(tokensA && tokensB ? [`- 費用參考：每則訊息的輸入約 ${tokensA} → ${tokensB} token（拆分後秘書身上的工具說明變少）；但每次交辦要多 2～4 次請求，整體不一定比較省。`] : []),
  "- 量出來不用拆很正常：大部分人的秘書一位就夠。資料多到常找錯、部門規則常搞混、或想把公司信箱跟個人的事分開時，再回來量一次。",
];
const lines = [
  `# 拆分量測報告（${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}）`,
  "",
  `模型 ${model.id}；題庫 ${questions.length} 題，每題每組 ${ROUNDS} 次；實際請求 ${requests} 次。工具一律沒有真的執行。`,
  ...(stopped ? ["", `⚠️ 量測中斷：${stopped}（下面只算已經考完的）`] : []),
  "",
  "## 結論（程式依門檻判斷）",
  "",
  ...conclusion,
  "",
  "## 數字",
  "",
  "| 指標 | ① 現在的秘書 | ② 拆分後 |",
  "|---|---|---|",
  `| 工具數 | ${toolCount("①")} | ${[...deptNames, "秘書"].map((dept) => `${dept} ${toolCount("②", dept)}`).join("／")} |`,
  `| 每則訊息的輸入 token（平均） | ${tokensA ?? "－"} | ${tokensB ?? "－"} |`,
  `| 選對工具（全部） | ${show(pick("①", "工具"))} | ${show(pick("②", "工具"))} |`,
  ...[...deptNames, "秘書"].filter((dept) => pick("①", "工具", dept).length > 0)
    .map((dept) => `| 選對工具（${dept}） | ${show(pick("①", "工具", dept))} | ${show(pick("②", "工具", dept))} |`),
  `| 規則沒搞混（全部） | ${show(pick("①", "規則"))} | ${show(pick("②", "規則"))} |`,
  ...[...deptNames, "秘書"].filter((dept) => pick("①", "規則", dept).length > 0)
    .map((dept) => `| 規則沒搞混（${dept}） | ${show(pick("①", "規則", dept))} | ${show(pick("②", "規則", dept))} |`),
  `| 同一題每次結果一樣 | ${same.length > 0 ? `${same.filter(Boolean).length}/${same.length}` : "－"} | |`,
  "",
  "## 每題明細",
  "",
  "| 題 | 部門 | 組 | 對 | 結果 |",
  "|---|---|---|---|---|",
  ...results.map((item) => `| ${item.編號} | ${item.部門} | ${item.組} | ${item.對 ? "✅" : "❌"} | ${(item.類 === "工具"
    ? `選了 ${item.選了}（該用 ${questions[item.編號 - 1].該用的工具.join("／")}）`
    : `缺 ${item.缺.join("、") || "－"}；混到 ${item.混到.join("、") || "－"}；${item.回覆}`).replace(/\|/g, "／").replace(/\n/g, " ")}${item.錯誤 ? `（出錯：${item.錯誤.replace(/\|/g, "／")}）` : ""} |`),
  "",
];
mkdirSync(join(ROOT, "文件", "拆分量測"), { recursive: true });
mkdirSync(join(ROOT, "data", "拆分量測"), { recursive: true });
writeFileSync(join(ROOT, "文件", "拆分量測", `${stamp}.md`), lines.join("\n"));
writeFileSync(join(ROOT, "data", "拆分量測", `${stamp}.json`), JSON.stringify(results, null, 2));
// 畫面上不顯示 Markdown 的粗體記號（** 在 PowerShell 裡只是雜訊；報告檔裡才有用）
console.log(`\n結論：\n${conclusion.join("\n").replace(/\*\*/g, "")}\n\n完整報告：文件/拆分量測/${stamp}.md（實際請求 ${requests} 次）`);
