// 工程自檢：一行指令跑完所有品檢，每一項印 ✅／❌／👀。
// 用法（在專案根目錄）：node self-check.mjs          ← 跑全部（含前幾課的「沒退步」檢查）
//                      node self-check.mjs L1       ← 只跑某一課
// 規則：
// - 一律在暫存副本裡跑，用假金鑰、假 Telegram、假 Gemini。不讀 .env、不用 .env 啟動秘書、不花委託人的額度。
// - 副本不含 .env、data/、文件/、日誌/ 和其他使用者資料（agent.log、提醒.json）；跑完整個刪掉，專案資料夾裡不會留下任何測試檔。
// - 各課的檢查項目放在 品檢/ 資料夾（品檢/L1.mjs、品檢/L2-1.mjs…），這支程式會依課程順序全部跑。
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CHECK_DIR = join(ROOT, "品檢");
// 使用者資料不帶進副本：委託人真機上設的提醒會讓測試多出一筆，結果跟合格輸出對不上。
const NOT_COPIED = new Set(["node_modules", ".git", ".claude", "data", "文件", "日誌", "agent.log",
  "提醒.json", "待辦.json", "排程.json", "通知.json", "固定會議.json", "情報.json", "公司信箱.json",
  "角色", "審核"]); // L5 部門助理的資料夾、審核標準與考題（可能有客戶資料）；要測的品檢自己在副本裡建
const FAKE_ENV = { GEMINI_API_KEY: "fake", TELEGRAM_BOT_TOKEN: "fake", TELEGRAM_ALLOWED_USERS: "1" };
const copies = [];
const madeCopies = [];
const children = new Set();

/** 逐檔複製（Node 24 的 cpSync 在 Windows 遇到中文資料夾名稱會當掉）。 */
function copyTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      mkdirSync(join(to, entry.name), { recursive: true });
      copyTree(join(from, entry.name), join(to, entry.name));
    } else if (entry.isFile()) {
      copyFileSync(join(from, entry.name), join(to, entry.name));
    }
  }
}

/** 建一份暫存副本：不含 .env（.env.example 除外）、data/、文件/、日誌/、使用者資料；node_modules 用連結。 */
function makeCopy() {
  const dir = mkdtempSync(join(tmpdir(), "ai-secretary-self-check-"));
  copies.push(dir);
  madeCopies.push(dir);
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    const name = entry.name;
    if (NOT_COPIED.has(name)) continue;
    if (name.startsWith(".env") && name !== ".env.example") continue;
    if (entry.isDirectory()) {
      mkdirSync(join(dir, name));
      copyTree(join(ROOT, name), join(dir, name));
    } else if (entry.isFile()) {
      copyFileSync(join(ROOT, name), join(dir, name));
    }
  }
  if (existsSync(join(ROOT, "node_modules"))) {
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "junction");
  }
  // 假日清單：副本一律從「沒有假日」開始（「不要重抓」讓程式不會真的連去 Google，品檢不碰外網）。
  // 要測假日的檢查自己覆寫這個檔案。
  mkdirSync(join(dir, "data"), { recursive: true });
  writeFileSync(join(dir, "data", "台灣假日.json"), `${JSON.stringify({ 來源: "品檢：固定的假日清單", 不要重抓: true, 國定假日: {} }, null, 2)}
`);
  return dir;
}

function removeCopy(dir) {
  const link = join(dir, "node_modules");
  try { unlinkSync(link); } catch {} // 先拆連結，刪副本時才不會碰到專案真正的 node_modules
  rmSync(dir, { recursive: true, force: true });
}

/** 環境變數：拿掉任何真的金鑰，再放入假值。 */
function fakeEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/KEY|TOKEN|SECRET|ALLOWED_USERS/i.test(name)) delete env[name];
  }
  delete env.NODE_OPTIONS;
  return { ...env, ...FAKE_ENV, ...extra };
}

/** 執行一個程式，收集輸出；超過 timeoutMs 就結束它。 */
function run(command, args, { cwd, env, timeoutMs = 60_000, verbatim = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: verbatim });
    children.add(child);
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { out += chunk; });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      children.delete(child);
      resolve({ code, out: out.replace(/\r\n/g, "\n"), timedOut });
    });
  });
}

/** 在新的副本裡啟動秘書。fake = 檢查模組裡 fakes 的名稱（假 Telegram／假 Gemini 劇本）。 */
async function startBridge({ module, fake, env = {}, timeoutMs = 60_000, prepare } = {}) {
  const dir = makeCopy();
  if (prepare) await prepare(dir);
  if (existsSync(join(dir, ".env"))) throw new Error("副本裡出現 .env，停止（自檢不准用 .env 啟動）");
  const args = [];
  if (fake) {
    const loader = join(dir, "_self-check-fake.mjs");
    writeFileSync(loader, `import { fakes } from ${JSON.stringify(pathToFileURL(join(dir, "品檢", module)).href)};\nawait fakes[${JSON.stringify(fake)}]();\n`);
    args.push("--import", pathToFileURL(loader).href);
  }
  args.push("bridge.mjs");
  const result = await run(process.execPath, args, { cwd: dir, env: fakeEnv(env), timeoutMs });
  removeCopy(dir);
  copies.splice(copies.indexOf(dir), 1);
  return result;
}

/** 只取劇本印的行（以「[秒數」開頭），去掉秒數，方便比對順序。 */
function scriptLines(out) {
  return out.split("\n").filter((line) => /^\[\d/.test(line)).map((line) => line.replace(/^\[[\d.]+s\]?\s?/, "").trim());
}

const tools = { ROOT, makeCopy, removeCopy, fakeEnv, run, startBridge, scriptLines };

const only = process.argv[2];
const modules = existsSync(CHECK_DIR)
  ? readdirSync(CHECK_DIR)
    .filter((name) => name.endsWith(".mjs"))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .filter((name) => !only || basename(name, ".mjs") === only)
  : [];
if (modules.length === 0) {
  console.log(`❌ 找不到檢查項目（品檢/${only ? `${only}.mjs` : "*.mjs"}）`);
  process.exit(1);
}

console.log(`工程自檢開始（假金鑰、在暫存副本執行）：${modules.map((name) => basename(name, ".mjs")).join("、")}`);
console.log("有幾項要跑將近 2 分鐘，請等到最後一行「自檢結束」。\n");
const counts = { "✅": 0, "❌": 0, "👀": 0, "⏭️": 0 };
for (const name of modules) {
  const { checks } = await import(pathToFileURL(join(CHECK_DIR, name)).href);
  const results = await Promise.all(checks.map(async (check) => {
    const begin = Date.now();
    try {
      return { ...await check.run({ ...tools, module: name }), seconds: Math.round((Date.now() - begin) / 1000) };
    } catch (error) {
      return { mark: "❌", detail: `檢查程式出錯：${error?.stack ?? error}`, seconds: Math.round((Date.now() - begin) / 1000) };
    }
  }));
  console.log(`── ${basename(name, ".mjs")} ──`);
  checks.forEach((check, index) => {
    const { mark, detail = "", seconds } = results[index];
    counts[mark]++;
    console.log(`${mark} ${check.id} ${check.name}${seconds >= 5 ? `（${seconds} 秒）` : ""}`);
    for (const line of String(detail).split("\n").filter(Boolean)) console.log(`     ${line}`);
  });
  console.log("");
}

// 收尾：測試程序全部結束、副本全部刪掉、專案裡沒有測試檔。
for (const child of children) child.kill();
for (const dir of copies) removeCopy(dir);
const leftovers = readdirSync(ROOT).filter((name) => /^(q-(outbox|stall|resume|search|seed|stop|file|perm|office|maps|calendar|gmail|status)\.mjs|q07-.*\.log|_self-check-fake\.mjs)$/.test(name));
const tempLeft = madeCopies.filter((dir) => existsSync(dir));
if (leftovers.length > 0 || tempLeft.length > 0) {
  counts["❌"]++;
  console.log(`❌ 收尾：專案裡有測試檔 ${leftovers.join("、") || "（無）"}；暫存副本 ${tempLeft.length} 個沒刪掉`);
} else {
  console.log("✅ 收尾：測試程序都已結束、暫存副本已刪除、專案資料夾裡沒有測試檔");
}
console.log(`\n自檢結束：✅ ${counts["✅"]}　❌ ${counts["❌"]}　👀 ${counts["👀"]}（要施工者自己確認）　⏭️ ${counts["⏭️"]}（這台電腦不適用）`);
process.exit(counts["❌"] > 0 ? 1 : 0);
