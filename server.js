const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_UPLOAD_BYTES = 1024 * 1024 * Number(process.env.MAX_UPLOAD_MB || 5);
const PASSWORD_KEY_LENGTH = 64;
const scrypt = promisify(crypto.scrypt);

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
  return `sitepaste_user=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
}

async function ensureUser(user) {
  const dir = userDir(user);
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

function userDir(user) {
  return path.join(DATA_DIR, "users", user);
}

function authPath(user) {
  return path.join(userDir(user), "auth.json");
}

async function loadAuth(user) {
  try {
    return JSON.parse(await fs.readFile(authPath(user), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function createPasswordAuth(user, password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  await fs.mkdir(userDir(user), { recursive: true });
  try {
    await fs.writeFile(authPath(user), JSON.stringify({
      algorithm: "scrypt",
      keyLength: PASSWORD_KEY_LENGTH,
      salt: salt.toString("base64"),
      hash: Buffer.from(hash).toString("base64"),
      createdAt: new Date().toISOString()
    }, null, 2), { flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

async function verifyPassword(user, password) {
  const auth = await loadAuth(user);
  if (!auth) return null;
  if (auth.algorithm !== "scrypt" || !auth.salt || !auth.hash) return false;

  const expected = Buffer.from(auth.hash, "base64");
  const actual = await scrypt(password, Buffer.from(auth.salt, "base64"), auth.keyLength || PASSWORD_KEY_LENGTH);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
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
  <title>${escapeHtml(title)} · SitePaste.app</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="/" aria-label="SitePaste.app home">
      <span class="brand-mark">S</span>
      <span>SitePaste.app</span>
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
  <title>Welcome · SitePaste.app</title>
  <link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="welcome">
  <main class="welcome-shell">
    <section class="intro">
      <p class="eyebrow">SitePaste.app</p>
      <h1>Paste an HTML page and share one clean URL.</h1>
      <p>Your first name becomes your owner key. Add a password once, then use it whenever you need to recover access on a fresh browser.</p>
    </section>
    <form class="name-card" method="post" action="/setup">
      <label for="firstName">First name</label>
      <input id="firstName" name="firstName" type="text" autocomplete="given-name" placeholder="Jason" required maxlength="40" autofocus>
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required minlength="8">
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
    <h1>Your SitePaste pages will appear here.</h1>
    <p>Use the hidden upload URL whenever you want to add another standalone page.</p>
    <a class="button" href="/upload">Upload Page</a>
  </section>`;
}

function statusBanner(message, kind = "success") {
  if (!message) return "";
  return `<p class="${kind} banner">${escapeHtml(message)}</p>`;
}

function fileList(user, pages, message = "", kind = "success") {
  if (!pages.length) return emptyState();
  const rows = pages
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((page) => {
      const url = `/${user}/${page.slug}.html`;
      const timestamp = page.updatedAt || page.createdAt;
      const dateLabel = page.updatedAt ? "Updated" : "Created";
      const created = new Date(timestamp).toLocaleString();
      const replaceId = `replace-${page.slug}`;
      return `<article class="file-row">
        <div>
          <h2>${escapeHtml(page.originalName)}</h2>
          <p>${dateLabel} ${escapeHtml(created)}</p>
        </div>
        <div class="actions">
          <input readonly value="${escapeHtml(url)}" aria-label="Share URL for ${escapeHtml(page.originalName)}">
          <a class="icon-link" href="${escapeHtml(url)}" title="Open page" aria-label="Open page">↗</a>
          <form class="replace-form" method="post" action="/replace" enctype="multipart/form-data">
            <input type="hidden" name="slug" value="${escapeHtml(page.slug)}">
            <label class="button secondary replace-button" for="${escapeHtml(replaceId)}">Choose</label>
            <input id="${escapeHtml(replaceId)}" class="replace-input" name="htmlFile" type="file" accept=".html,text/html" required>
            <button class="replace-submit" type="submit" disabled>Replace</button>
          </form>
        </div>
      </article>`;
    })
    .join("");

  return `<section class="panel">
    <div class="section-head">
      <div>
        <p class="eyebrow">Your files</p>
        <h1>${pages.length} pasted page${pages.length === 1 ? "" : "s"}</h1>
      </div>
      <a class="button" href="/upload">Upload</a>
    </div>
    ${statusBanner(message, kind)}
    <div class="file-list">${rows}</div>
  </section>
  <script src="/assets/upload.js"></script>`;
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
  const password = String(body.password || "");
  if (!user) return send(res, 400, welcomePage("Use at least one letter or number."));
  if (password.length < 8) return send(res, 400, welcomePage("Use a password with at least 8 characters."));

  const passwordMatches = await verifyPassword(user, password);
  if (passwordMatches === false) {
    return send(res, 401, welcomePage("That password does not match this owner."));
  }

  if (passwordMatches === null) {
    const created = await createPasswordAuth(user, password);
    if (!created && !(await verifyPassword(user, password))) {
      return send(res, 401, welcomePage("That password does not match this owner."));
    }
  }

  await ensureUser(user);
  redirect(res, "/", { "Set-Cookie": cookieForUser(user) });
}

async function handleUpload(req, res, user) {
  const contentType = req.headers["content-type"] || "";
  const parts = parseMultipart(await readBody(req), contentType);
  let upload;
  try {
    upload = validateHtmlUpload(parts.find((part) => part.name === "htmlFile" && part.filename));
  } catch (error) {
    return send(res, error.statusCode || 400, uploadPage(user, error.message));
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

function validateHtmlUpload(upload) {
  if (!upload) {
    const error = new Error("Choose an HTML file first.");
    error.statusCode = 400;
    throw error;
  }

  if (!upload.filename.toLowerCase().endsWith(".html")) {
    const error = new Error("Only .html files can be uploaded.");
    error.statusCode = 400;
    throw error;
  }

  const textStart = upload.content.slice(0, 2048).toString("utf8").toLowerCase();
  if (!textStart.includes("<html") && !textStart.includes("<!doctype html")) {
    const error = new Error("That file does not look like an HTML document.");
    error.statusCode = 400;
    throw error;
  }

  return upload;
}

async function handleReplace(req, res, user) {
  const contentType = req.headers["content-type"] || "";
  const parts = parseMultipart(await readBody(req), contentType);
  const slug = parts.find((part) => part.name === "slug")?.content.toString("utf8").trim();
  const index = await ensureUser(user);
  let upload;
  try {
    upload = validateHtmlUpload(parts.find((part) => part.name === "htmlFile" && part.filename));
  } catch (error) {
    return send(res, error.statusCode || 400, layout({
      title: "Files",
      user,
      body: fileList(user, index.pages, error.message, "error")
    }));
  }

  if (!/^[a-z0-9-]+$/.test(slug || "")) {
    return send(res, 400, layout({
      title: "Files",
      user,
      body: fileList(user, index.pages, "Choose an existing page to replace.", "error")
    }));
  }

  const page = index.pages.find((candidate) => candidate.slug === slug);
  if (!page) {
    return send(res, 404, layout({
      title: "Files",
      user,
      body: fileList(user, index.pages, "That page does not belong to this owner.", "error")
    }));
  }

  await fs.writeFile(path.join(DATA_DIR, "users", user, `${slug}.html`), upload.content);

  page.originalName = path.basename(upload.filename);
  page.bytes = upload.content.length;
  page.updatedAt = new Date().toISOString();
  await saveIndex(user, index);

  redirect(res, `/?replaced=${encodeURIComponent(slug)}`);
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
  const user = slugifyName(cookies.sitepaste_user);
  if (!user) return send(res, 200, welcomePage());

  if (req.method === "GET" && pathname === "/") {
    const index = await ensureUser(user);
    const replaced = url.searchParams.get("replaced");
    const message = replaced ? "File replaced. The share URL stayed the same." : "";
    return send(res, 200, layout({ title: "Files", user, body: fileList(user, index.pages, message) }));
  }

  if (req.method === "GET" && pathname === "/upload") return send(res, 200, uploadPage(user));
  if (req.method === "POST" && pathname === "/upload") return handleUpload(req, res, user);
  if (req.method === "POST" && pathname === "/replace") return handleReplace(req, res, user);

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
  console.log(`SitePaste.app listening on http://localhost:${PORT}`);
});
