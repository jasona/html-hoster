const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_UPLOAD_BYTES = 1024 * 1024 * Number(process.env.MAX_UPLOAD_MB || 5);

const WORDS_A = [
  "amber", "bright", "cedar", "crimson", "dawn", "ember", "flower", "glimmer",
  "honey", "indigo", "juniper", "kind", "linen", "meadow", "neon", "opal",
  "paper", "quiet", "river", "silver", "sunny", "tender", "violet", "willow"
];
const WORDS_B = [
  "apple", "bloom", "cloud", "door", "fern", "garden", "harbor", "island",
  "jacket", "kite", "lantern", "maple", "notebook", "orbit", "pearl", "quilt",
  "ribbon", "stone", "table", "umbrella", "velvet", "window", "yarn", "zinnia"
];
const WORDS_C = [
  "arc", "badge", "cap", "desk", "echo", "frame", "hat", "ink", "jar", "key",
  "lamp", "moon", "nest", "path", "ring", "shell", "tile", "vase", "wave", "zip"
];

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  res.end(body);
}

function redirect(res, location, headers = {}) {
  res.writeHead(303, { Location: location, ...headers });
  res.end();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function slugifyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function cookieForUser(user) {
  const encoded = encodeURIComponent(user);
  return `html_hoster_user=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

async function ensureUser(user) {
  const dir = path.join(DATA_DIR, "users", user);
  await fs.mkdir(dir, { recursive: true });
  const indexPath = path.join(dir, "index.json");
  try {
    return JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const fresh = { user, pages: [] };
    await fs.writeFile(indexPath, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

async function saveIndex(user, index) {
  const indexPath = path.join(DATA_DIR, "users", user, "index.json");
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

function layout({ title, user, body, active = "home" }) {
  const uploadActive = active === "upload" ? "active" : "";
  const homeActive = active === "home" ? "active" : "";
  const owner = user ? `<span class="owner">${escapeHtml(user)}</span>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · HTML Hoster</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/" aria-label="HTML Hoster home">
      <span class="brand-mark">H</span>
      <span>HTML Hoster</span>
    </a>
    <nav aria-label="Primary">
      <a class="${homeActive}" href="/">Files</a>
      <a class="${uploadActive}" href="/upload">Upload</a>
      ${owner}
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}

function welcomePage(error = "") {
  const errorHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome · HTML Hoster</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="welcome">
  <main class="welcome-shell">
    <section class="intro">
      <p class="eyebrow">Private by habit, public by link</p>
      <h1>Host a tiny HTML page and share one clean URL.</h1>
      <p>Your first name becomes your owner key on this browser. Uploads stay simple, portable, and easy to run in a Docker container.</p>
    </section>
    <form class="name-card" method="post" action="/setup">
      <label for="firstName">First name</label>
      <input id="firstName" name="firstName" type="text" autocomplete="given-name" placeholder="Jason" required maxlength="40" autofocus>
      ${errorHtml}
      <button type="submit">Continue</button>
    </form>
  </main>
</body>
</html>`;
}

function emptyState() {
  return `<section class="empty">
    <p class="eyebrow">No pages yet</p>
    <h1>Your shared HTML pages will appear here.</h1>
    <p>Use the hidden upload URL whenever you want to add another standalone page.</p>
    <a class="button" href="/upload">Upload HTML</a>
  </section>`;
}

function fileList(user, pages) {
  if (!pages.length) return emptyState();
  const rows = pages
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((page) => {
      const url = `/${user}/${page.slug}.html`;
      const created = new Date(page.createdAt).toLocaleString();
      return `<article class="file-row">
        <div>
          <h2>${escapeHtml(page.originalName)}</h2>
          <p>${escapeHtml(created)}</p>
        </div>
        <div class="actions">
          <input readonly value="${escapeHtml(url)}" aria-label="Share URL for ${escapeHtml(page.originalName)}">
          <a class="icon-link" href="${escapeHtml(url)}" title="Open page" aria-label="Open page">↗</a>
        </div>
      </article>`;
    })
    .join("");

  return `<section class="panel">
    <div class="section-head">
      <div>
        <p class="eyebrow">Your files</p>
        <h1>${pages.length} hosted page${pages.length === 1 ? "" : "s"}</h1>
      </div>
      <a class="button" href="/upload">Upload</a>
    </div>
    <div class="file-list">${rows}</div>
  </section>`;
}

function uploadPage(user, message = "") {
  const messageHtml = message ? `<p class="success">${message}</p>` : "";
  return layout({
    title: "Upload",
    user,
    active: "upload",
    body: `<section class="upload-panel">
      <p class="eyebrow">Hidden upload room</p>
      <h1>Choose one standalone HTML file.</h1>
      <form class="upload-form" method="post" action="/upload" enctype="multipart/form-data">
        <label class="dropzone" for="htmlFile">
          <span class="upload-icon">↑</span>
          <span class="drop-title">Select .html file</span>
          <span class="drop-copy">The page is saved under your owner key: ${escapeHtml(user)}</span>
          <input id="htmlFile" name="htmlFile" type="file" accept=".html,text/html" required>
        </label>
        ${messageHtml}
        <button type="submit">Upload</button>
      </form>
    </section>
    <script src="/assets/upload.js"></script>`
  });
}

function uploadedPage(user, page) {
  const shareUrl = `/${user}/${page.slug}.html`;
  return layout({
    title: "Uploaded",
    user,
    active: "upload",
    body: `<section class="uploaded">
      <p class="eyebrow">Ready to share</p>
      <h1>${escapeHtml(page.originalName)}</h1>
      <div class="share-box">
        <input readonly value="${escapeHtml(shareUrl)}" aria-label="Share URL">
        <a class="icon-link" href="${escapeHtml(shareUrl)}" title="Open page" aria-label="Open page">↗</a>
      </div>
      <a class="button secondary" href="/">Back to files</a>
    </section>`
  });
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      const error = new Error("Upload is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseFormUrlEncoded(buffer) {
  return Object.fromEntries(new URLSearchParams(buffer.toString("utf8")));
}

function parseMultipart(buffer, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!boundaryMatch) throw new Error("Missing upload boundary.");

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const parts = [];
  let cursor = buffer.indexOf(boundary);

  while (cursor !== -1) {
    cursor += boundary.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) break;

    const nextBoundary = buffer.indexOf(boundary, headerEnd + 4);
    if (nextBoundary === -1) break;

    const headerText = buffer.slice(cursor, headerEnd).toString("utf8");
    let content = buffer.slice(headerEnd + 4, nextBoundary);
    if (content.at(-2) === 13 && content.at(-1) === 10) content = content.slice(0, -2);

    const disposition = /content-disposition:\s*form-data;\s*([^\r\n]+)/i.exec(headerText)?.[1] || "";
    const name = /name="([^"]+)"/i.exec(disposition)?.[1];
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];

    parts.push({ name, filename, content, headers: headerText });
    cursor = nextBoundary;
  }

  return parts;
}

function randomFrom(values) {
  return values[crypto.randomInt(values.length)];
}

async function uniquePageSlug(user) {
  const userDir = path.join(DATA_DIR, "users", user);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = `${randomFrom(WORDS_A)}-${randomFrom(WORDS_B)}-${randomFrom(WORDS_C)}`;
    try {
      await fs.access(path.join(userDir, `${slug}.html`));
    } catch {
      return slug;
    }
  }
  return crypto.randomBytes(8).toString("hex");
}

function isOwnerPath(pathname) {
  return /^\/[a-z0-9-]+\/[a-z0-9-]+\.html$/.test(pathname);
}

async function handleSetup(req, res) {
  const body = parseFormUrlEncoded(await readBody(req));
  const user = slugifyName(body.firstName);
  if (!user) return send(res, 400, welcomePage("Use at least one letter or number."));
  await ensureUser(user);
  redirect(res, "/", { "Set-Cookie": cookieForUser(user) });
}

async function handleUpload(req, res, user) {
  const contentType = req.headers["content-type"] || "";
  const parts = parseMultipart(await readBody(req), contentType);
  const upload = parts.find((part) => part.name === "htmlFile" && part.filename);

  if (!upload) return send(res, 400, uploadPage(user, "Choose an HTML file first."));
  if (!upload.filename.toLowerCase().endsWith(".html")) {
    return send(res, 400, uploadPage(user, "Only .html files can be uploaded."));
  }

  const textStart = upload.content.slice(0, 2048).toString("utf8").toLowerCase();
  if (!textStart.includes("<html") && !textStart.includes("<!doctype html")) {
    return send(res, 400, uploadPage(user, "That file does not look like an HTML document."));
  }

  const index = await ensureUser(user);
  const slug = await uniquePageSlug(user);
  await fs.writeFile(path.join(DATA_DIR, "users", user, `${slug}.html`), upload.content);

  const page = {
    slug,
    originalName: path.basename(upload.filename),
    bytes: upload.content.length,
    createdAt: new Date().toISOString()
  };
  index.pages.push(page);
  await saveIndex(user, index);

  send(res, 201, uploadedPage(user, page));
}

async function serveStatic(req, res, pathname) {
  const name = pathname.replace("/assets/", "");
  if (!/^[a-z0-9._-]+$/i.test(name)) return send(res, 404, "Not found");
  const filePath = path.join(PUBLIC_DIR, name);
  const ext = path.extname(filePath);
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600"
    });
    res.end(body);
  } catch {
    send(res, 404, "Not found");
  }
}

async function serveHostedPage(req, res, pathname) {
  const [, user, file] = pathname.split("/");
  const slug = file.replace(/\.html$/, "");
  const filePath = path.join(DATA_DIR, "users", user, `${slug}.html`);
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    });
    res.end(body);
  } catch {
    send(res, 404, layout({
      title: "Not found",
      user: null,
      body: `<section class="empty"><h1>Page not found.</h1><p>This shared URL does not exist here.</p></section>`
    }));
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/assets/")) return serveStatic(req, res, pathname);
  if (req.method === "GET" && isOwnerPath(pathname)) return serveHostedPage(req, res, pathname);
  if (req.method === "POST" && pathname === "/setup") return handleSetup(req, res);

  const cookies = parseCookies(req.headers.cookie);
  const user = slugifyName(cookies.html_hoster_user);
  if (!user) return send(res, 200, welcomePage());

  if (req.method === "GET" && pathname === "/") {
    const index = await ensureUser(user);
    return send(res, 200, layout({ title: "Files", user, body: fileList(user, index.pages) }));
  }

  if (req.method === "GET" && pathname === "/upload") return send(res, 200, uploadPage(user));
  if (req.method === "POST" && pathname === "/upload") return handleUpload(req, res, user);

  send(res, 404, layout({
    title: "Not found",
    user,
    body: `<section class="empty"><h1>Nothing lives here.</h1><p>Try your files list or the upload room.</p></section>`
  }));
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    const status = error.statusCode || 500;
    send(res, status, layout({
      title: "Error",
      user: null,
      body: `<section class="empty"><h1>Something went sideways.</h1><p>${escapeHtml(error.message || "Unknown error")}</p></section>`
    }));
  });
});

server.listen(PORT, () => {
  console.log(`HTML Hoster listening on http://localhost:${PORT}`);
});
