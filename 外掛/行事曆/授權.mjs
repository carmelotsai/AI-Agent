// Google 授權（只要做一次）：在專案資料夾執行 `node 外掛/行事曆/授權.mjs`。
// 會打開瀏覽器到 Google 的授權頁，你按同意後，權杖存到 data/google/token.json（不進 Git，秘書也讀不到）。
// 事前要把 Google Cloud 下載的憑證（Desktop app）存成 data/google/client.json，步驟見 L3-5 學員手冊。
import { exec } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOOGLE_DIR = join(ROOT, "data", "google");
const CLIENT_FILE = join(GOOGLE_DIR, "client.json");
const TOKEN_FILE = join(GOOGLE_DIR, "token.json");
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly", // 看行事曆清單與行程
  "https://www.googleapis.com/auth/calendar.events", // 新增、修改、刪除行程（秘書每次都會先傳按鈕問你）
];
const base64url = (buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

if (!existsSync(CLIENT_FILE)) {
  console.error("找不到 data/google/client.json。請先照 L3-5 學員手冊下載 Google Cloud 的憑證，存成這個檔名。");
  process.exit(1);
}
const client = JSON.parse(readFileSync(CLIENT_FILE, "utf8")).installed;
if (!client?.client_id || !client?.client_secret) {
  console.error("data/google/client.json 不是「Desktop app（電腦版應用程式）」的憑證，請重新建立並下載。");
  process.exit(1);
}

// PKCE：證明換權杖的是同一個程式
const verifier = base64url(randomBytes(32));
const challenge = base64url(createHash("sha256").update(verifier).digest());
const state = base64url(randomBytes(16));

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    response.writeHead(404).end();
    return;
  }
  const finish = (status, message) => {
    response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<p style="font-size:20px">${message}</p>`);
    console.log(message.replace(/<[^>]+>/g, ""));
    server.close();
    process.exit(status === 200 ? 0 : 1);
  };
  if (url.searchParams.get("state") !== state) return finish(400, "授權失敗：驗證碼不符，請重新執行一次。");
  if (url.searchParams.has("error")) return finish(400, `授權沒有完成（${url.searchParams.get("error")}）。要用的話請重新執行一次。`);
  const result = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code: url.searchParams.get("code"),
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  }).then((res) => res.json());
  if (!result.refresh_token) return finish(400, `授權失敗：${result.error_description ?? result.error ?? "沒有拿到權杖"}`);
  mkdirSync(GOOGLE_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: result.refresh_token, scope: result.scope, created: new Date().toISOString() }, null, 1));
  finish(200, "✅ 授權完成，權杖已存到 data/google/token.json。可以關掉這個分頁，重新啟動秘書。");
});

let redirectUri;
server.listen(0, "127.0.0.1", () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // 要 refresh token，之後秘書才能自己換新的
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  console.log("正在打開瀏覽器到 Google 授權頁；沒有自動打開的話，請複製下面的網址貼到瀏覽器：\n");
  console.log(authUrl + "\n");
  const opener = process.platform === "win32" ? `start "" "${authUrl}"` : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener);
  setTimeout(() => {
    console.error("等了 5 分鐘都沒有完成授權，先結束。要用的話請重新執行一次。");
    process.exit(1);
  }, 5 * 60_000);
});
