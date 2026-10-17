# L3-3・Office 文件｜施工工單

| 欄位 | 內容 |
|---|---|
| 工單編號 | L3-3-GEM-01 |
| 品名 | AI 秘書升級：外掛「Office」（`make_docx` Markdown 轉 Word、`make_xlsx` 表格做 Excel，支援公式） |
| 版次 | V1.2（2026-09-27：參考件含 L1 V1.3 的修正；V1.1 起含 L1 V1.2 的網路修正） |
| 前置條件 | **L3-2 權限分級已完工**（黑視窗有「權限：…」一行） |
| 適用平台 | Windows ✅ 已驗證／macOS ⏳ 待驗證／Linux ✗ 不承接 |
| 驗證基準 | `@earendil-works/pi-coding-agent` 1.0.1、Node.js v24.13.1、Windows 11；參考件 = repo tag `L3-3-V1.2`（V1.1 為 `L3-3-V1.1`、V1 為 `L3-3`） |
| 施工者 | 學員指定的 coding agent |
| 委託人 | 學員本人（下稱「委託人」） |

---

## 0. 施工者須知

- **這是升級工單。** 新增 `外掛/Office/index.mjs`；`package.json` 加三個依賴並執行 `npm install`。**`bridge.mjs` 不動**，`權限.json`、`SOUL.md`、`MEMORY.md`、技能、`外掛/傳檔案/` 都不動。
- **需要網路**：`npm install` 會下載三個程式庫。其餘都在本機。
- **品檢不需要任何金鑰**：4.1 的 `q-office.mjs` 用假的 Telegram 和假的 Gemini（照劇本呼叫工具），最後把做出來的 Word、Excel 讀回來檢查。不可以用委託人的真金鑰測試。
- **先讀完整張工單，才可以動工。**
- 3.4、3.5 的參考件經過真金鑰與真機實測。跟參考件不同的每一處，都要寫進施工日誌。
- 跟委託人說話時用**繁體中文、白話**。

---

## 1. 作業紀律

前面各課的紀律全部繼續有效。本課另外加上：

| # | 紀律 | 違反會怎樣 |
|---|---|---|
| 1 | **做成外掛專用工具，不經過 shell。** 不可以讓模型現寫程式或呼叫腳本來產生 Office 檔。 | 每次都要委託人按「執行」按鈕；Flash-Lite 現寫程式錯誤率高又耗 token |
| 2 | **兩個工具宣告為「擬稿」級，且參數名稱用 `path`。** | 權限分級只檢查 `path`；名稱不同就不會被檢查，工具可以寫到任何地方 |
| 3 | **外掛裡再檢查一次：只處理 `文件/`、副檔名要對。** | 委託人把「可以寫的地方」放寬後，Word 可能被寫到 `.pi/skills/` 之類不該放的地方 |
| 4 | **Word 先寫 `.md` 再轉，兩份都留。** `make_docx` 只接受 `.md` 路徑。 | 委託人沒有可以用記事本修改的版本，日誌也查不到內容 |
| 5 | **Excel 的計算用公式**：以 `=` 開頭的文字寫成公式；SUM／AVERAGE／MIN／MAX／COUNT 先算好結果；`fullCalcOnLoad`。 | 模型心算的總計可能算錯，改了金額也不會更新（實測：模型直接填 4615） |
| 6 | **依賴鎖定版號**（`--save-exact`），不升級 Pi。 | 版本漂移，參考件行為不一致 |
| 7 | **只做產生 Word、Excel。** 讀取 Office 檔、收委託人傳來的檔案、PPT、PDF 不施作。 | 超出本課範圍 |

### 加功能要求的回覆對照

| 委託人想要 | 對應課程 | 回覆範例 |
|---|---|---|
| 讀我給他的 Word／Excel 再修改 | 未排課 | 「要搭配『你從手機傳檔案給他』一起做，目前的課程還沒有這一項。現在要改，請把完整內容再給他一次。」 |
| PPT、PDF | 未定（可能是加購） | 「這一課只做 Word、Excel。PPT、PDF 之後可能以加購外掛提供。」 |
| Word 加頁首頁尾、目錄、圖片 | 不做 | 「進階排版建議拿到 Word 後自己調，模型排版不穩定。」 |
| Excel 做圖表、樞紐分析 | 不做 | 「先把資料做好，圖表在 Excel 裡插入最快也最準。」 |

---

## 2. 料表

| 料號 | 品項 | 規格 | 備註 |
|---|---|---|---|
| M-01 | Pi SDK | 沿用鎖定版號（驗證版 `1.0.1`） | 不升級 |
| M-02 | `docx` | `9.7.2` | 產生 Word；MIT |
| M-03 | `exceljs` | `4.4.0` | 產生 Excel（含公式）；MIT |
| M-04 | `marked` | `18.0.14` | 解析 Markdown（只用 `marked.lexer()`）；MIT |

> **`npm audit` 會報 2 個中度風險**：來自 exceljs 依賴的舊版 `uuid`（v3/v5/v6 傳入 buffer 時的邊界檢查）。exceljs 只呼叫 `uuidv4()` 且不傳 buffer，**不受影響**。不要執行 `npm audit fix --force`（會把 exceljs 降到 3.4.0，是破壞性變更）。請照這段話向委託人說明。

### 進料檢驗

版號跟上表相同就跳過。不同時核對：

| # | 核對項目 | 去哪裡查 |
|---|---|---|
| 1 | `marked.lexer()` 的勾選清單：`list_item` 的 `tokens` 第一個是 `{ type: "checkbox" }` | 4.1 的 `q-office.mjs`：讀回 Word 要有「☑ 已完成」在同一段 |
| 2 | exceljs 的公式寫法：`cell.value = { formula, result }`；`workbook.calcProperties.fullCalcOnLoad` | 4.1 的 `q-office.mjs`：讀回 Excel 要有 `{"formula":"SUM(B2:B3)","result":668}` |
| 3 | Gemini 接受 `items: { type: ["string", "number", "boolean", "null"] }` 的參數格式 | 參考件已用真金鑰驗證（0.87.1；1.0.1 轉換參數格式的 `pi-ai/dist/api/google-shared.js` 與 0.87.1 相同）；Pi 版本不同時，請委託人實機考核 T3-3-03 |

---

## 3. 製程

### 3.1 工序一：確認 L3-2 已完工

| 項目 | 方法 | 判定 |
|---|---|---|
| L3-2 程式 | `bridge.mjs` 有 `checkPermission`、專案有 `權限.json` | 沒有 → 請委託人先做 L3-2 |
| 改過程式？ | 比對 `bridge.mjs` 與 repo tag `L3-2-V1.2`（較舊的比 `L3-2-V1.1` 或 `L3-2`） | 不一致 → 列差異問委託人（本課不改 `bridge.mjs`，但要確認權限分級還在） |
| 只差網路修正？ | 差異只有 L1 的網路修正：V1.2 的檔案開頭 `net.setDefaultAutoSelectFamilyAttemptTimeout(1000)`、`send()`／`sendNow()`／`outbox`／`flushOutbox()`、收訊迴圈的 `await flushOutbox()`；V1.3 的檔案開頭包一層 `globalThis.fetch`（Gemini 90 秒沒回應就重連）、`showTyping()` 與收訊迴圈的 `stopTyping` | 視為一致，照常整份替換（本課參考件已包含這些修正） |
| 已經有 `外掛/Office/`？ | 看 `外掛/` | 有 → 列出內容問委託人，不可以直接覆蓋 |
| `package.json` 的依賴 | 看 `dependencies` | 除了 `@earendil-works/pi-coding-agent` 還有別的 → 保留，只加本課三個 |
| Agent 沒在跑 | 列出 `node` 程序 | 還開著 → 請委託人先關掉黑視窗（**沒重啟就測，會跑到舊程式**） |

### 3.2 工序二：開立《升級確認單》

```text
《升級確認單》L3-3 Office 文件
────────────────────────────
專案位置：【路徑】
秘書：【SOUL.md 裡的名字】

這次升級會：
  ✔ 新增外掛「Office」：把 文件/ 裡的 .md 轉成 Word；把表格做成 Excel
  ✔ Excel 的加總用公式，改金額會自動更新
  ✔ 做好可以直接傳到你手機（用 L3-1 的傳檔案）
  ✘ 讀懂 Word／Excel、收你傳來的檔案（未排課）；PPT、PDF（可能是加購）

會新增：外掛/Office/index.mjs
會修改：package.json、package-lock.json（加三個做 Office 檔的程式庫，需要網路）
其他都不動。測試不需要你的金鑰。
────────────────────────────
請回覆「同意」開工，或告訴我要改哪裡。
```

### 3.3 工序三：備份

```text
data/backup/package.before-L3-3.json
```

### 3.4 工序四：安裝依賴

在委託人專案根目錄執行：

```powershell
npm install --save-exact docx@9.7.2 exceljs@4.4.0 marked@18.0.14
```

完成後 `package.json` 的 `dependencies` 應該是（若委託人原本有其他依賴，一併保留）：

<!-- 參考件：L3-3-V1.2:package.json -->
```
{
  "name": "gemini-pi-agent",
  "private": true,
  "type": "module",
  "version": "1.0.0",
  "description": "Pi Agent 引擎 + Google Gemini API，本機執行、接 Telegram 的個人 AI 助理",
  "engines": {
    "node": ">=22.19.0"
  },
  "scripts": {
    "start": "node --env-file=.env bridge.mjs"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "1.0.1",
    "docx": "9.7.2",
    "exceljs": "4.4.0",
    "marked": "18.0.14"
  }
}
```

### 3.5 工序五：新增 `外掛/Office/index.mjs`

**為什麼**：到 L3-2 為止，秘書只能產出 `.md`。要做 Office 檔，有兩條路：讓模型現寫程式／呼叫腳本（經過 shell，L3-2 之後每次都要委託人按按鈕），或做成外掛專用工具（屬擬稿級、只能寫 `文件/`、不用按）。選後者：模型只給內容，格式由外掛負責，穩定又省 token。

| 工具 | 參數 | 做什麼 |
|---|---|---|
| `make_docx` | `path`：`文件/` 裡的 `.md` | 用 `marked.lexer()` 解析，轉成同名 `.docx`：標題、段落、粗體／斜體／刪除線／行內程式碼、項目與編號清單（含巢狀）、勾選清單（☑／☐）、表格（標題列粗體加底色、框線）、引言、程式碼、分隔線。字型 Calibri＋微軟正黑體（中文） |
| `make_xlsx` | `path`：`文件/` 裡的 `.xlsx`；`sheets: [{ name, rows }]` | 第一列粗體並凍結；欄寬依內容（中文算兩格，8～60）；以 `=` 開頭的文字寫成公式 |

**Excel 公式**（紀律第 5 條）：真機驗收時，委託人說「並加總」，模型把心算的 4615 直接填進去，改金額不會更新，資料多時也可能算錯。所以：

- 以 `=` 開頭的文字寫成 `{ formula }`；`fullCalcOnLoad = true`，用 Excel 打開時重算。
- `quickResult()` 先算 SUM／AVERAGE／MIN／MAX／COUNT（參數是儲存格或範圍，可以參照已算好的公式）的結果一起存進檔案，**手機預覽才看得到數字**。其他公式（例如 `=B5*2`）不預算，交給 Excel。
- `prompt` 告訴模型：要計算時填公式，不要心算。

> **實測**（真金鑰）：「整理成會議紀錄並出成 Word 傳給我」→ 照 meeting-notes 技能寫 `.md` → `make_docx` → `send_file`；委託人那句「並加總」重跑兩次，總計都是 `=SUM(B2:B6)`、預算結果 4615。「把 SOUL.md 轉成 Word」→ 模型先把內容寫成 `文件/…_SOUL.md` 再轉，專案根目錄沒有多出檔案（合法做法）。

<!-- 參考件：L3-3-V1.2:外掛/Office/index.mjs -->
```js
// Office：把「文件/」裡的 Markdown 轉成 Word（make_docx），把表格資料做成 Excel（make_xlsx）。
// 模型只給內容，不現寫程式。拿掉這個資料夾再重啟，秘書就不會做 Office 檔，其他功能照常。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import ExcelJS from "exceljs";
import { marked } from "marked";

const FONT = { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft JhengHei" }; // 中文用微軟正黑體
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

/** 權限等級：只寫「文件/」（權限分級會檢查 path），屬於「擬稿」。 */
export const levels = { make_docx: "擬稿", make_xlsx: "擬稿" };

/** 加進秘書的 system prompt。 */
export const prompt =
  "使用者要 Word 檔時：先照平常把內容寫成「文件/」裡的 .md，再用 make_docx 轉成同名的 .docx（.md 也留著）。" +
  "使用者要 Excel 檔時：用 make_xlsx，把表格資料直接交給它，第一列放欄位名稱，數字用數字不要加引號。" +
  "要加總、平均等計算時，不要自己心算，填 Excel 公式（以 = 開頭的文字，例如 \"=SUM(B2:B6)\"），列號從第 1 列（欄位名稱）開始算。" +
  "做好後如果使用者要，就用 send_file 把檔案傳給他。";

/** 相對於專案的路徑（用 / 分隔）；不在「文件/」裡就丟錯誤。 */
function docsPath(root, path, extension) {
  const full = resolve(root, path);
  const rel = relative(root, full).split(sep).join("/");
  if (!rel.startsWith("文件/")) throw new Error(`只能處理「文件/」裡的檔案，不能處理 ${path}`);
  if (!rel.toLowerCase().endsWith(extension)) throw new Error(`${path} 要是 ${extension} 檔`);
  return { full, rel };
}

// ── Word：Markdown → .docx ───────────────────────────────────────────────
/** 行內格式（粗體、斜體、程式碼、連結）→ TextRun。 */
function runs(tokens = [], style = {}) {
  return tokens.flatMap((token) => {
    if (token.type === "strong") return runs(token.tokens, { ...style, bold: true });
    if (token.type === "em") return runs(token.tokens, { ...style, italics: true });
    if (token.type === "del") return runs(token.tokens, { ...style, strike: true });
    if (token.type === "codespan") return [new TextRun({ ...style, text: token.text, font: "Consolas" })];
    if (token.type === "link") return runs(token.tokens, { ...style, underline: {} });
    if (token.type === "br") return [new TextRun({ ...style, break: 1 })];
    if (token.tokens) return runs(token.tokens, style);
    return [new TextRun({ ...style, text: token.text ?? token.raw ?? "" })];
  });
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const cell = (item, header) => new TableCell({
  children: [new Paragraph({ children: runs(item.tokens, header ? { bold: true } : {}) })],
  borders: { top: border, bottom: border, left: border, right: border },
  ...(header ? { shading: { fill: "E7E6E6" } } : {}),
});

/** 區塊（標題、段落、清單、表格…）→ docx 元件。 */
function blocks(tokens, level = 0) {
  return tokens.flatMap((token) => {
    switch (token.type) {
      case "heading":
        return [new Paragraph({ heading: HEADINGS[token.depth - 1], children: runs(token.tokens) })];
      case "paragraph":
      case "text":
        return [new Paragraph({ children: runs(token.tokens ?? [{ text: token.text }]) })];
      case "list":
        return token.items.flatMap((item) => {
          const [first, ...rest] = item.tokens.filter((child) => child.type !== "checkbox"); // 勾選框另外畫
          const inline = first && (first.type === "text" || first.type === "paragraph") ? first.tokens ?? [{ text: first.text }] : [];
          const children = item.task ? [new TextRun(item.checked ? "☑ " : "☐ "), ...runs(inline)] : runs(inline);
          const paragraph = token.ordered
            ? new Paragraph({ numbering: { reference: "numbers", level }, children })
            : new Paragraph({ bullet: { level }, children });
          const others = inline.length > 0 ? rest : item.tokens;
          return [paragraph, ...blocks(others, level + 1)];
        });
      case "table":
        return [new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ tableHeader: true, children: token.header.map((item) => cell(item, true)) }),
            ...token.rows.map((row) => new TableRow({ children: row.map((item) => cell(item, false)) })),
          ],
        }), new Paragraph("")];
      case "blockquote":
        return blocks(token.tokens, level);
      case "code":
        return token.text.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, font: "Consolas" })] }));
      case "hr":
        return [new Paragraph({ border: { bottom: border }, children: [] })];
      default:
        return [];
    }
  });
}

async function markdownToDocx(markdown) {
  const heading = (size) => ({ run: { font: FONT, size, bold: true, color: "1F3864" }, paragraph: { spacing: { before: 240, after: 120 } } });
  const document = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { after: 120 } } },
        heading1: heading(36), heading2: heading(30), heading3: heading(26),
        heading4: heading(24), heading5: heading(24), heading6: heading(24),
      },
    },
    numbering: {
      config: [{
        reference: "numbers",
        levels: [0, 1, 2, 3].map((level) => ({
          level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: blocks(marked.lexer(markdown)) }],
  });
  return Packer.toBuffer(document);
}

// ── Excel：表格資料 → .xlsx ──────────────────────────────────────────────
/** 欄名轉數字：A→1、AA→27。 */
const columnNumber = (letters) => [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);

/**
 * 常見公式先算好一個結果存進檔案，手機預覽才看得到數字（用 Excel 打開仍會重算）。
 * 只算 SUM／AVERAGE／MIN／MAX／COUNT 加上儲存格或範圍；其他公式回傳 undefined，交給 Excel 算。
 */
function quickResult(worksheet, formula) {
  const match = formula.replace(/\s/g, "").toUpperCase().match(/^(SUM|AVERAGE|MIN|MAX|COUNT)\((.+)\)$/);
  if (!match) return undefined;
  const numbers = [];
  for (const part of match[2].split(",")) {
    const range = part.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (!range) return undefined;
    const [, c1, r1, c2 = c1, r2 = r1] = range;
    for (let row = Math.min(+r1, +r2); row <= Math.max(+r1, +r2); row++) {
      for (let col = Math.min(columnNumber(c1), columnNumber(c2)); col <= Math.max(columnNumber(c1), columnNumber(c2)); col++) {
        const value = worksheet.getCell(row, col).value;
        const number = typeof value === "number" ? value : value?.result;
        if (typeof number === "number") numbers.push(number);
        else if (typeof value === "string" && value.startsWith("=")) return undefined; // 參照還沒算的公式
      }
    }
  }
  const sum = numbers.reduce((total, number) => total + number, 0);
  return { SUM: sum, AVERAGE: numbers.length ? sum / numbers.length : undefined, MIN: numbers.length ? Math.min(...numbers) : undefined,
    MAX: numbers.length ? Math.max(...numbers) : undefined, COUNT: numbers.length }[match[1]];
}

const textWidth = (value) => [...String(value ?? "")].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);

async function sheetsToXlsx(sheets) {
  const workbook = new ExcelJS.Workbook();
  for (const [index, sheet] of sheets.entries()) {
    const worksheet = workbook.addWorksheet(String(sheet.name || `工作表${index + 1}`).slice(0, 31));
    for (const row of sheet.rows) worksheet.addRow(row);
    // 以 = 開頭的文字當成 Excel 公式
    worksheet.eachRow((row) => row.eachCell((item) => {
      if (typeof item.value === "string" && item.value.startsWith("=")) {
        const formula = item.value.slice(1).trim();
        item.value = { formula, result: quickResult(worksheet, formula) };
      }
    }));
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", ySplit: 1 }]; // 第一列（欄位名稱）固定
    worksheet.columns.forEach((column) => {
      let widest = 0;
      column.eachCell({ includeEmpty: false }, (item) => { widest = Math.max(widest, textWidth(item.value?.result ?? item.value)); });
      column.width = Math.min(Math.max(widest + 2, 8), 60);
    });
  }
  workbook.calcProperties.fullCalcOnLoad = true; // 用 Excel 打開時重算公式
  return workbook.xlsx.writeBuffer();
}

export default function (pi, bridge) {
  pi.registerTool({
    name: "make_docx",
    label: "做 Word",
    description: "把「文件/」裡的一份 Markdown（.md）轉成同名的 Word 檔（.docx），放在同一個資料夾。",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "要轉換的 .md，例如「文件/2026-09-27_會議紀錄.md」" } },
      required: ["path"],
    },
    async execute(_toolCallId, { path }) {
      const { full, rel } = docsPath(bridge.root, path, ".md");
      if (!existsSync(full)) throw new Error(`找不到 ${rel}，請先把內容寫成這個 .md`);
      const output = full.replace(/\.md$/i, ".docx");
      writeFileSync(output, await markdownToDocx(readFileSync(full, "utf8")));
      const outRel = rel.replace(/\.md$/i, ".docx");
      return { content: [{ type: "text", text: `已做好 ${outRel}` }], details: {} };
    },
  });

  pi.registerTool({
    name: "make_xlsx",
    label: "做 Excel",
    description: "用表格資料做一個 Excel 檔（.xlsx），放在「文件/」。每個工作表是一個二維陣列，第一列放欄位名稱。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要存的位置，例如「文件/2026-09-27_報價比較.xlsx」" },
        sheets: {
          type: "array",
          description: "工作表清單",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "工作表名稱" },
              rows: {
                type: "array",
                description: "每一列是一個陣列；第一列是欄位名稱；數字用數字",
                items: { type: "array", items: { type: ["string", "number", "boolean", "null"] } },
              },
            },
            required: ["rows"],
          },
        },
      },
      required: ["path", "sheets"],
    },
    async execute(_toolCallId, { path, sheets }) {
      const { full, rel } = docsPath(bridge.root, path, ".xlsx");
      if (!Array.isArray(sheets) || sheets.length === 0) throw new Error("至少要有一個工作表");
      writeFileSync(full, Buffer.from(await sheetsToXlsx(sheets)));
      const rows = sheets.reduce((sum, sheet) => sum + (sheet.rows?.length ?? 0), 0);
      return { content: [{ type: "text", text: `已做好 ${rel}（${sheets.length} 個工作表、共 ${rows} 列）` }], details: {} };
    },
  });
}
```

---

## 4. 品檢表

### 4.1 工程自檢（施工者，在副本執行，不需要金鑰）

**先做完 3.4 的 `npm install`**（副本的 `node_modules` 連到委託人專案，要先裝好）。

**建立副本**：同 L3-2 工單 4.1（複製 `bridge.mjs`、`SOUL.md`、`MEMORY.md`、`package.json`、`.gitignore`、`.ignore`、`.pi/`、`外掛/`、`權限.json`；`node_modules` 用連結；**不要**複製 `.env`、`data/`、`日誌/`、`文件/`）。

| # | 項目 | 方法（在副本） | 合格標準 |
|---|---|---|---|
| Q3-3-01 | 語法與依賴 | `node --check 外掛/Office/index.mjs`；在委託人專案 `npm ls docx exceljs marked` | 無錯誤；最上層的版號是 9.7.2、4.4.0、18.0.14（Pi 自己另帶一份 `marked`，列在 `@earendil-works/pi-coding-agent` 底下、版號不同，屬正常） |
| Q3-3-02 | 啟動 | 假環境變數啟動（同 L2-1 工單 Q2-1-02） | 工具那一行有 `make_docx`、`make_xlsx`；「外掛：Office, 傳檔案」 |
| Q3-3-03 | 做 Word、Excel 並讀回 | `node --import ./q-office.mjs bridge.mjs`（環境變數見下方） | 輸出如下方「合格輸出」 |
| Q3-3-04 | 拿掉外掛 | 把 `外掛/Office` 移到副本外面，刪掉副本的 `data/`、`文件/`，再跑 Q3-3-03 | 「外掛：傳檔案」；四題都是 `{"error":"Tool make_… not found"}`；讀回都是「沒有 …」 |
| Q3-3-05 | L3-2 權限沒退步 | 放回 `外掛/Office`，刪掉副本的 `data/`，跑 L3-2 工單的 `q-perm.mjs` | 同 L3-2 工單 Q3-2-03 合格輸出 |
| Q3-3-06 | L3-1 傳檔沒退步 | 刪掉副本的 `data/`，跑 L3-1 工單的 `q-file.mjs` | 同 L3-2 工單 Q3-2-05（`.env` 由權限擋下） |
| Q3-3-07 | L2-5 叫停沒退步 | 刪掉副本的 `data/`，跑 L2-5 工單 V1.1 的 `q-stop.mjs` | 同 L2-5 工單 Q2-5-03 合格輸出 |
| Q3-3-08 | 人事資料與其他檔案 | 比對**委託人專案**施工前後 | 只有 `package.json`、`package-lock.json` 改變，多了 `外掛/Office/index.mjs` |
| Q3-3-09 | L1～L2 迴歸 | 同 L2-3 工單 Q2-3-06 | 通過 |
| Q3-3-10 | 收尾 | 關閉測試程序、**刪除整個副本資料夾** | 委託人專案沒有測試檔 |

**環境變數**（全部是假值）：

```powershell
$env:GEMINI_API_KEY="fake"; $env:TELEGRAM_BOT_TOKEN="fake"; $env:TELEGRAM_ALLOWED_USERS="1"; node --import ./q-office.mjs bridge.mjs
```

**`q-office.mjs`**（放在副本根目錄；會用到 `exceljs`，以及 `docx`／`exceljs` 附帶的 `jszip`）：

```js
// L3-3 品檢：假的 Telegram＋假的 Gemini（照劇本呼叫 make_docx、make_xlsx），不需要任何金鑰。
// 結束前把做出來的 Word、Excel 讀回來，檢查內容。
// 用法（在副本根目錄）：node --import ./q-office.mjs bridge.mjs   （環境變數用假值）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import JSZip from "jszip";

mkdirSync("文件", { recursive: true });
writeFileSync("文件/品檢.md", [
  "# 品檢會議紀錄", "", "- **日期**：2026-09-27", "- [x] 已完成", "", "1. 第一項", "2. 第二項", "",
  "| 事項 | 負責人 |", "|---|---|", "| 設計稿 | 王小明 |", "",
].join("\n"));
const SCRIPT = [
  { say: "做 Word", tool: "make_docx", args: { path: "文件/品檢.md" } },
  { say: "做 Excel", tool: "make_xlsx", args: { path: "文件/品檢.xlsx", sheets: [{ name: "消費", rows: [
    ["項目", "金額"], ["早餐", 169], ["午餐", 499], ["總計", "=SUM(B2:B3)"]] }] } },
  { say: "Word 做到專案外", tool: "make_docx", args: { path: "SOUL.md" } },
  { say: "Excel 存到根目錄", tool: "make_xlsx", args: { path: "品檢.xlsx", sheets: [{ rows: [["a"]] }] } },
];

const realFetch = globalThis.fetch;
const start = Date.now();
const elapsed = () => `${((Date.now() - start) / 1000).toFixed(1)}s`;
const ok = (result) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const sse = (parts) => new Response(
  `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] })}\r\n\r\n`,
  { status: 200, headers: { "Content-Type": "text/event-stream" } },
);
let step = -1, waiting = false;

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.includes("generativelanguage.googleapis.com")) {
    const last = JSON.parse(options.body).contents.at(-1).parts;
    const result = last.find((part) => part.functionResponse)?.functionResponse.response;
    if (result) return sse([{ text: JSON.stringify(result).slice(0, 150) }]);
    const item = SCRIPT.find((entry) => last.some((part) => part.text?.includes(entry.say)));
    if (!item) return sse([{ text: "好的。" }]);
    return sse([{ functionCall: { name: item.tool, args: item.args } }]);
  }
  if (!target.includes("api.telegram.org")) return realFetch(url, options);
  const body = JSON.parse(options.body);
  if (target.endsWith("/sendChatAction")) return ok(true); // 「輸入中…」（L1 V1.3 起）
  if (target.endsWith("/sendMessage")) {
    console.log(`[${elapsed()} 秘書回覆] ${body.text}`);
    waiting = false;
    return ok({ message_id: 1 });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (waiting || step + 1 >= SCRIPT.length) return ok([]);
  step++;
  waiting = true;
  console.log(`\n[${elapsed()} 使用者傳] ${SCRIPT[step].say}`);
  return ok([{ update_id: step + 1, message: { text: SCRIPT[step].say, from: { id: 1 }, chat: { id: 1 } } }]);
};

/** 讀回 Word：段落文字、表格數、字型。 */
async function checkDocx() {
  if (!existsSync("文件/品檢.docx")) return "沒有 文件/品檢.docx";
  const zip = await JSZip.loadAsync(readFileSync("文件/品檢.docx"));
  const xml = await zip.file("word/document.xml").async("string");
  const styles = await zip.file("word/styles.xml").async("string");
  const lines = xml.split("</w:p>")
    .map((paragraph) => (paragraph.match(/<w:t[^>]*>[^<]*<\/w:t>/g) ?? []).map((text) => text.replace(/<[^>]+>/g, "")).join(""))
    .filter(Boolean);
  return `${lines.join(" / ")}｜表格 ${(xml.match(/<w:tbl>/g) ?? []).length} 個｜微軟正黑體 ${/Microsoft JhengHei/.test(styles) ? "有" : "沒有"}`;
}

/** 讀回 Excel：每一列的值（公式顯示成 {formula, result}）。 */
async function checkXlsx() {
  if (!existsSync("文件/品檢.xlsx")) return "沒有 文件/品檢.xlsx";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile("文件/品檢.xlsx");
  const rows = [];
  workbook.getWorksheet("消費").eachRow((row) => rows.push(JSON.stringify(row.values.slice(1))));
  return rows.join(" ");
}

setTimeout(async () => {
  console.log(`\n[${elapsed()} 讀回 Word] ${await checkDocx()}`);
  console.log(`[${elapsed()} 讀回 Excel] ${await checkXlsx()}`);
  console.log(`[${elapsed()} 根目錄] 品檢.xlsx ${existsSync("品檢.xlsx") ? "被建立了" : "沒有被建立"}`);
  console.log(`[${elapsed()}] 品檢結束`);
  process.exit(0);
}, 8000);
```

**Q3-3-03 合格輸出**（啟動訊息之後；秒數會有些許差異，順序與內容要一致）：

```text
[2.3s 使用者傳] 做 Word
[2.5s 秘書回覆] {"output":"已做好 文件/品檢.docx"}

[2.6s 使用者傳] 做 Excel
[2.7s 秘書回覆] {"output":"已做好 文件/品檢.xlsx（1 個工作表、共 4 列）"}

[2.9s 使用者傳] Word 做到專案外
擋下 make_docx：我沒有權限修改 SOUL.md：我只能寫 文件/、.pi/skills/，MEMORY.md 只能修改、不能整份覆寫。
[2.9s 秘書回覆] {"error":"我沒有權限修改 SOUL.md：我只能寫 文件/、.pi/skills/，MEMORY.md 只能修改、不能整份覆寫。（請照實轉告使用者，不要改用其他工具或其他寫法繞過。）"}

[3.2s 使用者傳] Excel 存到根目錄
擋下 make_xlsx：我沒有權限修改 品檢.xlsx：我只能寫 文件/、.pi/skills/，MEMORY.md 只能修改、不能整份覆寫。
[3.2s 秘書回覆] {"error":"我沒有權限修改 品檢.xlsx：我只能寫 文件/、.pi/skills/，MEMORY.md 只能修改、不能整份覆寫。（請照實轉告使用者，不要改用其他工具或其他寫法繞過。）"}

[8.0s 讀回 Word] 品檢會議紀錄 / 日期：2026-09-27 / ☑ 已完成 / 第一項 / 第二項 / 事項 / 負責人 / 設計稿 / 王小明｜表格 1 個｜微軟正黑體 有
[8.0s 讀回 Excel] ["項目","金額"] ["早餐",169] ["午餐",499] ["總計",{"formula":"SUM(B2:B3)","result":668}]
[8.0s 根目錄] 品檢.xlsx 沒有被建立
[8.0s] 品檢結束
```

注意：

- **讀回 Word** 要有「☑ 已完成」（勾選框與文字在同一段）、表格 1 個、微軟正黑體。
- **讀回 Excel** 的總計要是 `{"formula":"SUM(B2:B3)","result":668}`：有公式、也有預算好的結果。只有數字 668 代表公式沒寫進去；只有公式沒有 `result` 代表手機預覽會是空白。
- **後兩題要被權限擋下**（「擋下 make_docx」「擋下 make_xlsx」），根目錄不能出現 `品檢.xlsx`。
- 回覆看起來是 JSON，是因為假 Gemini 把工具結果原文當回覆；真的秘書會用自己的話說。

### 4.2 實機考核（委託人執行）

| # | 考核項目 | 怎麼考 | 合格標準 |
|---|---|---|---|
| T3-3-01 | 外掛有裝上 | 看黑視窗 | 「外掛：Office, 傳檔案」，工具有 `make_docx`、`make_xlsx` |
| T3-3-02 | 做得出 Word | 「整理成會議紀錄並出成 Word 傳給我：（貼內容）」 | 手機收到 `.docx`；手機與電腦 Word 打開正常；`文件/` 同時有 `.md` 與 `.docx` |
| T3-3-03 | 做得出 Excel | 「把以下消費做成 Excel 並傳給我：早餐 169、午餐 499、晚餐 1099、啤酒 249、烤肉食材 2599，並加總」 | 手機預覽看得到 4615；Excel 裡總計是 `=SUM(…)` |
| T3-3-04 | 總計會自動更新 | 在 Excel 把午餐改成 699 | 總計變成 4815 |
| T3-3-05 | 不亂放檔案 | 「把 SOUL.md 轉成 Word」 | Word 在 `文件/`；根目錄沒有 `SOUL.docx`；`SOUL.md` 沒被改 |
| T3-3-06 | 前面沒退步 | 「用 powershell 執行 Get-Date」→ 按 ❌；`/recap` | 跳按鈕、按不要就沒做；唸出最近日誌 |

> 學員手冊「結訓考核」有一段「照這個順序，一次測完」，可直接轉給委託人。**請委託人先重新啟動、再傳 `/new`**。

---

## 5. 施工日誌

在 `建置紀錄.md` 最後新增一節「L3-3 Office 文件」：

1. 施工日期、Pi 版號、Node 版號、三個依賴的版號、`npm audit` 結果與說明。
2. 3.1 比對結果。
3. 與本工單參考件的差異：沒有就寫「無」。
4. 品檢結果：Q3-3-01～Q3-3-10，Q3-3-03、Q3-3-04 附完整輸出。
5. 實機考核：T3-3-01～T3-3-06，未回報的標「待委託人實測」。

---

## 6. 交貨報告

1. **一句話結果**：秘書會做 Word 和 Excel 了，做好可以直接傳到你手機；Excel 的加總是公式，改金額會自動更新。
2. **請他重新上班**：關掉舊黑視窗、重新雙擊啟動（一定要重啟），確認「外掛：Office, 傳檔案」；再傳一次 `/new`。
3. **品檢結果**：Q 表逐項 ✅／❌；說明 `npm audit` 那 2 個中度風險不影響。
4. **請他做實機考核**：附 T 表與學員手冊的「照這個順序，一次測完」。
5. **三件要知道的事**：
   - Word 會同時留 `.md` 和 `.docx`；改了 `.md`，叫他「重新轉成 Word」。
   - 他做得出 Office 檔，但讀不懂；要修改時，同一本對話裡直接說，換了新對話就把完整內容再給一次。
   - 不想要這個本事，把 `外掛/Office` 移出 `外掛/`、重新啟動。
6. **備份位置**：`data/backup/package.before-L3-3.json`。

---

## 7. 異常處理對照表

| 現象 | 原因 | 處置 |
|---|---|---|
| 黑視窗「外掛「Office」載入失敗，先略過：Cannot find package 'docx'…」 | 沒有 `npm install`，或裝在別的資料夾 | 在專案根目錄執行 3.4 的指令，重啟 |
| Excel 的總計是寫死的數字 | 跑舊程式（沒重啟）；或同一本對話照抄前面的做法 | 重啟、`/new` 後再請他做一次 |
| 手機預覽 Excel 某格空白 | 那格是 `quickResult()` 不算的公式 | 正常；用 Excel 打開就會算 |
| Word 裡勾選框和文字分成兩行 | `marked` 版本不同，勾選清單的 token 結構變了 | 照 2 的進料檢驗第 1 項核對 |
| 秘書說「沒有權限」寫 Word／Excel | 路徑不在 `權限.json` 的「可以寫的地方」 | 正常；請他存到 `文件/` |
| `npm audit` 報 uuid 中度風險 | exceljs 依賴舊版 uuid | 不影響（見 2 的說明）；**不要** `npm audit fix --force` |
| 秘書改用 PowerShell 做 Office 檔（跳按鈕） | 外掛沒載入，或 `prompt` 沒生效 | 確認黑視窗有「外掛：Office」；請委託人按 ❌ |
| 委託人要求加功能 | 超出本課範圍 | 照第 1 章對照表回覆 |
