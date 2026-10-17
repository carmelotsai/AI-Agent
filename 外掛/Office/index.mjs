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
