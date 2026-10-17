// L1 到職篇的工程自檢（Q-01～Q-12；Q-13 收尾由 self-check.mjs 最後一行負責）。
// 不要直接執行這支；在專案根目錄執行 node self-check.mjs。
// checks：每一項檢查。fakes：假 Telegram＋假 Gemini 劇本，self-check.mjs 會在副本裡用 --import 載入，不需要任何金鑰。
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const read = (root, file) => readFileSync(join(root, file), "utf8");
const pass = (detail) => ({ mark: "✅", detail });
const fail = (detail) => ({ mark: "❌", detail });
const tail = (out, lines = 15) => out.trim().split("\n").slice(-lines).join("\n");
const BAT = "啟動 Agent.bat";
const COMMAND = "啟動 Agent.command";

let started;
/** Q-03、Q-05 共用一次啟動：假 Telegram 一律回 404（假 Token），看秘書會不會因此結束。 */
const startOnce = (t) => (started ??= t.startBridge({ module: t.module, fake: "start", timeoutMs: 30_000 }));

export const checks = [
  {
    id: "Q-01",
    name: "依賴安裝",
    async run({ ROOT }) {
      const wanted = JSON.parse(read(ROOT, "package.json")).dependencies?.["@earendil-works/pi-coding-agent"];
      const file = join(ROOT, "node_modules/@earendil-works/pi-coding-agent/package.json");
      if (!existsSync(file)) return fail("node_modules 裡沒有 Pi，請先執行 npm install");
      const installed = JSON.parse(readFileSync(file, "utf8")).version;
      return installed === wanted ? pass(`已安裝 Pi ${installed}`) : fail(`package.json 要 ${wanted}，實際裝的是 ${installed}，請重跑 npm install`);
    },
  },
  {
    id: "Q-02",
    name: "版本鎖定",
    async run({ ROOT }) {
      const deps = JSON.parse(read(ROOT, "package.json")).dependencies ?? {};
      const loose = Object.entries(deps).filter(([, version]) => !/^\d+\.\d+\.\d+$/.test(version));
      return loose.length === 0
        ? pass(Object.entries(deps).map(([name, version]) => `${name} ${version}`).join("、"))
        : fail(`沒有鎖定版號：${loose.map(([name, version]) => `${name} ${version}`).join("、")}`);
    },
  },
  {
    id: "Q-03",
    name: "模型解析（假金鑰）",
    async run(t) {
      const { out } = await startOnce(t);
      const line = out.split("\n").find((text) => text.startsWith("Agent 已啟動"));
      return line && /模型 google\//.test(line) ? pass(line) : fail(`沒有印出「Agent 已啟動，模型 google/…」：\n${tail(out)}`);
    },
  },
  {
    id: "Q-04",
    name: "缺設定時的錯誤訊息",
    async run(t) {
      const noGemini = await t.startBridge({ module: t.module, fake: "start", env: { GEMINI_API_KEY: "" }, timeoutMs: 30_000 });
      const noTelegram = await t.startBridge({ module: t.module, fake: "start", env: { TELEGRAM_BOT_TOKEN: "" }, timeoutMs: 30_000 });
      const lines = [];
      for (const [label, result, wanted] of [
        ["缺 GEMINI_API_KEY", noGemini, "找不到 GEMINI_API_KEY"],
        ["缺 TELEGRAM_BOT_TOKEN", noTelegram, "請在 .env 設定 TELEGRAM_BOT_TOKEN"],
      ]) {
        const message = result.out.split("\n").find((text) => text.startsWith("Error: ") && text.includes(wanted));
        if (!message || result.code === 0 || result.timedOut) return fail(`${label}：沒有出現「${wanted}」或程式沒有停下來\n${tail(result.out)}`);
        lines.push(`${label} → ${message.trim()}`);
      }
      return pass(lines.join("\n"));
    },
  },
  {
    id: "Q-05",
    name: "啟動流程（假 Token 的輪詢錯誤不會讓程式結束）",
    async run(t) {
      const { out } = await startOnce(t);
      const wanted = ["Agent 已啟動", "等待 Telegram 訊息…", "輪詢錯誤：", "品檢結束：輪詢錯誤"];
      const missing = wanted.filter((text) => !out.includes(text));
      if (missing.length > 0) return fail(`缺少：${missing.join("、")}\n${tail(out)}`);
      return pass(out.split("\n").filter((text) => /^等待|^輪詢錯誤|品檢結束/.test(text) || /^\[/.test(text)).slice(0, 4).join("\n"));
    },
  },
  {
    id: "Q-06",
    name: "啟動檔編碼",
    async run({ ROOT }) {
      if (process.platform !== "win32") {
        const file = join(ROOT, COMMAND);
        if (!existsSync(file)) return fail(`找不到 ${COMMAND}`);
        const text = readFileSync(file, "utf8");
        const executable = (statSync(file).mode & 0o111) !== 0;
        return !text.includes("\r") && executable ? pass(`${COMMAND}：LF、可執行`) : fail(`${COMMAND} 要是 LF 換行且可執行（chmod +x）`);
      }
      const file = join(ROOT, BAT);
      if (!existsSync(file)) return fail(`找不到 ${BAT}`);
      const bytes = readFileSync(file);
      const ascii = bytes.every((byte) => byte < 0x80);
      const text = bytes.toString("latin1");
      const crlf = !/(^|[^\r])\n/.test(text) && text.includes("\r\n");
      return ascii && crlf ? pass(`${BAT}：全部 ASCII、全部 CRLF`) : fail(`${BAT}：${ascii ? "" : "有非 ASCII 字元；"}${crlf ? "" : "不是全部 CRLF"}`);
    },
  },
  {
    id: "Q-07",
    name: "啟動檔實際執行（Windows）",
    async run(t) {
      if (process.platform !== "win32") return { mark: "⏭️", detail: "不是 Windows；macOS 的啟動檔待驗證" };
      // 副本裡放「假的 .env」和替身 bridge.mjs：只驗證 .bat → npm start → --env-file 這條路，不會啟動真的秘書。
      const dir = t.makeCopy();
      writeFileSync(join(dir, "bridge.mjs"), "console.log(`（替身）bridge.mjs 已由 npm start 啟動，TELEGRAM_BOT_TOKEN=${process.env.TELEGRAM_BOT_TOKEN}`);\n");
      writeFileSync(join(dir, ".env"), "GEMINI_API_KEY=fake-bat\nTELEGRAM_BOT_TOKEN=fake-bat\nTELEGRAM_ALLOWED_USERS=1\n");
      const env = t.fakeEnv();
      for (const name of ["GEMINI_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS"]) delete env[name];
      // 檔名有中文和空格：用完整路徑、整串原樣交給 cmd.exe，不然會出現「'啟動' 不是內部或外部命令」的假錯誤。
      const { out, timedOut } = await t.run("cmd.exe", [`/d /s /c ""${join(dir, BAT)}""`], { cwd: dir, env, timeoutMs: 60_000, verbatim: true });
      t.removeCopy(dir);
      const order = ["Starting Agent...", "TELEGRAM_BOT_TOKEN=fake-bat", "Agent stopped"].map((text) => out.indexOf(text));
      const ok = !timedOut && order.every((index) => index >= 0) && order[0] < order[1] && order[1] < order[2];
      const shown = out.split("\n").filter((text) => /Starting Agent|npm start|> node|替身|Agent stopped/.test(text)).join("\n");
      return ok ? pass(shown) : fail(`輸出順序不對（應為 Starting Agent... → 替身 bridge.mjs → Agent stopped...）\n${tail(out)}`);
    },
  },
  {
    id: "Q-08",
    name: "金鑰隔離",
    async run({ ROOT, run }) {
      const ignore = existsSync(join(ROOT, ".gitignore")) ? read(ROOT, ".gitignore").split(/\r?\n/).map((line) => line.trim()) : [];
      if (!ignore.includes(".env")) return fail(".gitignore 沒有 .env 這一行");
      if (!existsSync(join(ROOT, ".env.example"))) return fail("找不到 .env.example");
      const filled = read(ROOT, ".env.example").split(/\r?\n/).filter((line) => /^[A-Z_]+=\S/.test(line.trim()));
      if (filled.length > 0) return fail(`.env.example 有填值（只該是空白範本）：${filled.map((line) => line.split("=")[0]).join("、")}`);
      const lines = [".gitignore 有 .env", ".env.example 是空白範本"];
      if (existsSync(join(ROOT, ".git"))) {
        const { code } = await run("git", ["check-ignore", "-q", ".env"], { cwd: ROOT });
        if (code !== 0) return fail("git check-ignore 顯示 .env 沒有被忽略");
        lines.push("git check-ignore：.env 會被忽略");
      }
      lines.push(existsSync(join(ROOT, ".env")) ? "有 .env（內容沒有讀取）" : "還沒有 .env（工序八會建立）");
      return pass(lines.join("\n"));
    },
  },
  {
    id: "Q-09",
    name: "人事資料",
    async run({ ROOT }) {
      const shape = {
        "SOUL.md": ["# SOUL.md", "## 我是誰", "## 我的職責", "## 我的個性與說話方式", "## 我的規矩"],
        "MEMORY.md": ["# MEMORY.md", "## 關於你", "## 你希望我注意的事", "## 其他你要我記住的事"],
      };
      const lines = [];
      for (const [file, headings] of Object.entries(shape)) {
        if (!existsSync(join(ROOT, file))) return fail(`找不到 ${file}`);
        const text = read(ROOT, file);
        const actual = text.split(/\r?\n/).filter((line) => /^#{1,2} /.test(line)).map((line) => line.trim());
        if (actual.join("|") !== headings.join("|")) return fail(`${file} 的章節跟範本不同：${actual.join("、")}`);
        if (/【[^】]+】/.test(text)) return fail(`${file} 還有沒填的【代號】`);
        lines.push(`${file}：章節與範本一致，沒有沒填的【代號】`);
      }
      lines.push("內容請施工者逐項對照《到職確認單》");
      return { mark: "👀", detail: lines.join("\n") };
    },
  },
  {
    id: "Q-10",
    name: "斷線補送",
    async run(t) {
      const { out } = await t.startBridge({ module: t.module, fake: "outbox", timeoutMs: 40_000 });
      const wanted = [
        "使用者傳] 第1則",
        "使用者傳] 第2則",
        "網路斷線，送不出去] 第1則的回覆",
        "網路斷線，送不出去] 第1則的回覆",
        "網路斷線，送不出去] 第1則的回覆",
        "網路斷線，送不出去] 第1則的回覆",
        "使用者傳] 第3則",
        "秘書回覆] （剛才網路斷線，這是補送的回覆） ⏎  ⏎ 第1則的回覆",
        "秘書回覆] 第2則的回覆",
        "秘書回覆] 第3則的回覆",
        "品檢結束",
      ];
      const actual = t.scriptLines(out);
      const shown = out.split("\n").filter((line) => /^\[\d/.test(line)).join("\n");
      return actual.join("\n") === wanted.join("\n") ? pass(shown) : fail(`順序或內容跟合格輸出不同：\n${shown || tail(out)}`);
    },
  },
  {
    id: "Q-11",
    name: "連線設定",
    async run({ ROOT }) {
      const count = read(ROOT, "bridge.mjs").split("setDefaultAutoSelectFamilyAttemptTimeout(1000)").length - 1;
      return count === 1 ? pass("setDefaultAutoSelectFamilyAttemptTimeout(1000)：1 處") : fail(`setDefaultAutoSelectFamilyAttemptTimeout(1000) 出現 ${count} 處（應為 1）`);
    },
  },
  {
    id: "Q-12",
    name: "卡住會重連、輸入中（約 110 秒）",
    async run(t) {
      const [body, headers] = await Promise.all(["body", "headers"].map((mode) =>
        t.startBridge({ module: t.module, fake: "stall", env: { STALL: mode }, timeoutMs: 170_000 })));
      const lines = [];
      for (const [mode, { out }] of [["body", body], ["headers", headers]]) {
        const raw = out.split("\n").filter((line) => /^\[\d/.test(line));
        const aborted = raw.find((line) => line.includes("第 1 次請求被中斷") && line.includes("90 秒沒有回應"));
        const seconds = Number(aborted?.match(/^\[(\d+)s/)?.[1]);
        const typing = Number(out.match(/「輸入中…」送了 (\d+) 次/)?.[1] ?? 0);
        const after = out.match(/回覆後 10 秒內又送了 (\d+) 次/)?.[1];
        const replied = out.includes("秘書回覆] 收到，這是第1則的回覆");
        if (!aborted || seconds < 85 || seconds > 100 || !replied || typing < 20 || after !== "0") {
          return fail(`STALL=${mode} 不合格（應在約 90 秒中斷、第 2 次回覆、輸入中 20 次以上、回覆後 0 次）：\n${raw.join("\n") || tail(out)}`);
        }
        lines.push(`STALL=${mode}：第 ${seconds} 秒中斷重連 → 回覆；輸入中 ${typing} 次；回覆後 ${after} 次`);
      }
      return pass(lines.join("\n"));
    },
  },
];

// ── 假 Telegram＋假 Gemini 劇本（在副本裡、秘書啟動前載入）─────────────────
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (text) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);

export const fakes = {
  /** 假 Token：Telegram 一律回 404。輪詢錯誤 2 次後秘書還活著，就算合格。 */
  async start() {
    let polls = 0;
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) throw new TypeError("品檢：不應該呼叫 Gemini");
      if (target.endsWith("/getUpdates") && ++polls === 2) {
        setTimeout(() => { console.log(`[${polls}] 品檢結束：輪詢錯誤 ${polls} 次，程式沒有結束`); process.exit(0); }, 100);
      }
      return new Response(JSON.stringify({ ok: false, error_code: 404, description: "Not Found" }), { status: 404 });
    };
  },

  /** L1 V1.2：網路斷線時回覆不能掉。使用者連傳兩則；前兩則回覆送出時斷線（含 2 秒後重試共失敗 4 次），接著收訊也斷 6 秒；恢復後要照順序補送，再回第三則。 */
  async outbox() {
    const SCRIPT = [{ at: 0, text: "第1則" }, { at: 0, text: "第2則" }, { at: 9000, text: "第3則" }];
    let start = 0; // 從秘書第一次連 Telegram 開始計時（電腦忙的時候，秘書啟動比較慢）
    const begin = () => {
      if (start) return;
      start = Date.now();
      setTimeout(() => { console.log(`[${elapsed()}] 品檢結束`); process.exit(0); }, 16000);
    };
    const elapsed = () => `${((Date.now() - start) / 1000).toFixed(1)}s`;
    let sendTries = 0, received = 0, outageUntil = 0;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        const said = JSON.parse(options.body).contents.at(-1).parts.map((part) => part.text ?? "").join("");
        return sse(`${said.match(/第\d則/)[0]}的回覆`);
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      begin();
      const body = JSON.parse(options.body);
      if (target.endsWith("/sendChatAction")) return ok(true);
      if (target.endsWith("/sendMessage")) {
        sendTries++;
        if (sendTries <= 4) {
          console.log(`[${elapsed()} 網路斷線，送不出去] ${body.text.split("\n").at(-1)}`);
          if (sendTries === 4) outageUntil = Date.now() + 6000;
          throw new TypeError("fetch failed");
        }
        console.log(`[${elapsed()} 秘書回覆] ${body.text.split("\n").join(" ⏎ ")}`);
        return ok({ message_id: sendTries });
      }
      if (Date.now() < outageUntil) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        throw new TypeError("fetch failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      const due = SCRIPT.map((item, index) => ({ ...item, id: index + 1 })).filter((item) => item.id > received && Date.now() - start >= item.at);
      for (const item of due) {
        received = item.id;
        console.log(`[${elapsed()} 使用者傳] ${item.text}`);
      }
      return ok(due.map((item) => ({ update_id: item.id, message: { text: item.text, from: { id: 1 }, chat: { id: 1 } } })));
    };
  },

  /** L1 V1.3：Gemini 連線卡住時，90 秒內要中斷並自動重試；處理期間 Telegram 要顯示「輸入中…」。
   *  STALL=body：回了開頭就不再有資料；STALL=headers：連開頭都不回。 */
  async stall() {
    const MODE = process.env.STALL ?? "body";
    let start = 0; // 從秘書第一次連 Telegram 開始計時
    const begin = () => {
      if (start) return;
      start = Date.now();
      setTimeout(() => {
        console.log(`[${elapsed()}] ❌ 150 秒內沒有回覆（Gemini 請求 ${geminiCalls} 次，輸入中 ${typing} 次）`);
        process.exit(1);
      }, 150_000);
    };
    const elapsed = () => `${((Date.now() - start) / 1000).toFixed(0)}s`;
    const chunk = (text) => `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }] })}\r\n\r\n`;
    let geminiCalls = 0, typing = 0, sent = false;
    globalThis.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.includes("generativelanguage.googleapis.com")) {
        geminiCalls++;
        if (geminiCalls === 1) {
          console.log(`[${elapsed()} Gemini] 第 1 次請求：連線卡住（${MODE}）`);
          const aborted = () => new Promise((_, reject) => {
            const signal = options.signal;
            if (!signal) return;
            signal.addEventListener("abort", () => {
              console.log(`[${elapsed()} Gemini] 第 1 次請求被中斷：${signal.reason?.message ?? signal.reason}`);
              reject(signal.reason);
            }, { once: true });
          });
          if (MODE === "headers") return aborted();
          const body = new ReadableStream({ start(controller) { aborted().catch((reason) => controller.error(reason)); } });
          return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
        }
        console.log(`[${elapsed()} Gemini] 第 ${geminiCalls} 次請求：正常回答`);
        return new Response(chunk("收到，這是第1則的回覆"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      if (!target.includes("api.telegram.org")) throw new TypeError(`品檢：不應該連到 ${target}`);
      begin();
      const body = JSON.parse(options.body);
      if (target.endsWith("/sendChatAction")) {
        typing++;
        return ok(true);
      }
      if (target.endsWith("/sendMessage")) {
        console.log(`[${elapsed()} 秘書回覆] ${body.text}`);
        console.log(`[${elapsed()}] 「輸入中…」送了 ${typing} 次`);
        const typingAtReply = typing;
        setTimeout(() => {
          console.log(`[${elapsed()}] 回覆後 10 秒內又送了 ${typing - typingAtReply} 次「輸入中…」（應為 0）`);
          console.log(`[${elapsed()}] 品檢結束`);
          process.exit(0);
        }, 10_000);
        return ok({ message_id: 1 });
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!sent) {
        sent = true;
        console.log(`[${elapsed()} 使用者傳] 第1則`);
        return ok([{ update_id: 1, message: { text: "第1則", from: { id: 1 }, chat: { id: 1 } } }]);
      }
      return ok([]);
    };
  },
};
