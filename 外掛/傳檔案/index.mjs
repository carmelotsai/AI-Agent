// 傳檔案：把「文件/」「日誌/」裡的檔案傳到使用者的 Telegram。
// 拿掉這個資料夾再重啟，秘書就不會傳檔案，其他功能照常。
import { existsSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ALLOWED_DIRS = ["文件", "日誌"];
const MAX_BYTES = 50 * 1024 * 1024; // Telegram Bot 傳檔上限 50 MB

/** 權限等級：只傳給使用者本人，而且只能傳 文件/、日誌/，屬於「查閱」。 */
export const levels = { send_file: "查閱" };

/** 加進秘書的 system prompt。 */
export const prompt =
  "使用者要你把檔案傳給他時，用 send_file 工具；只能傳「文件/」和「日誌/」裡的檔案。" +
  "send_file 成功才算傳到；失敗時照實告訴使用者原因。";

export default function (pi, bridge) {
  pi.registerTool({
    name: "send_file",
    label: "傳檔案",
    description: "把一個檔案傳到使用者的 Telegram。只能傳「文件/」和「日誌/」裡的檔案。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "相對於工作目錄的路徑，例如「文件/2026-09-27_週報.md」" },
      },
      required: ["path"],
    },
    async execute(_toolCallId, { path }) {
      const full = resolve(bridge.root, path);
      const rel = relative(bridge.root, full).split(sep).join("/");
      if (!ALLOWED_DIRS.includes(rel.split("/")[0])) {
        throw new Error(`只能傳「文件/」和「日誌/」裡的檔案，不能傳 ${path}`);
      }
      if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`找不到檔案 ${path}`);
      if (statSync(full).size > MAX_BYTES) throw new Error(`${path} 超過 50 MB，Telegram 傳不了`);
      await bridge.sendFile(full);
      return { content: [{ type: "text", text: `已把 ${rel} 傳給使用者。` }], details: {} };
    },
  });
}
