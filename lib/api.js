const fs = require("node:fs/promises");
const path = require("node:path");
const {
  MAX_UPLOAD_BYTES,
  userDir,
  ensureUser,
  saveIndex,
  uniquePageSlug,
  validateHtmlUpload
} = require("./store");
const { verifyApiKey } = require("./auth");
const { checkLimit } = require("./rate-limit");

const READ_LIMIT = { max: 120, windowMs: 5 * 60 * 1000 };
const WRITE_LIMIT = { max: 20, windowMs: 5 * 60 * 1000 };

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(payload);
}

function pageResponse(user, page) {
  return {
    slug: page.slug,
    url: `/${user}/${page.slug}.html`,
    originalName: page.originalName,
    bytes: page.bytes,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt
  };
}

async function listSites(user) {
  const index = await ensureUser(user);
  return index.pages
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((page) => pageResponse(user, page));
}

async function createSite(user, { filename, html }) {
  const name = String(filename || "site.html");
  const buffer = Buffer.from(String(html ?? ""), "utf8");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const error = new Error("Upload is too large.");
    error.statusCode = 413;
    throw error;
  }

  const upload = validateHtmlUpload({ filename: name, content: buffer });

  const index = await ensureUser(user);
  const slug = await uniquePageSlug(user);
  await fs.writeFile(path.join(userDir(user), `${slug}.html`), upload.content);

  const page = {
    slug,
    originalName: path.basename(upload.filename),
    bytes: upload.content.length,
    createdAt: new Date().toISOString()
  };
  index.pages.push(page);
  await saveIndex(user, index);

  return pageResponse(user, page);
}

async function replaceSite(user, slug, { filename, html }) {
  if (!/^[a-z0-9-]+$/.test(String(slug || ""))) {
    const error = new Error("Invalid site slug.");
    error.statusCode = 400;
    throw error;
  }

  const index = await ensureUser(user);
  const page = index.pages.find((candidate) => candidate.slug === slug);
  if (!page) {
    const error = new Error("That site does not belong to this owner.");
    error.statusCode = 404;
    throw error;
  }

  const name = String(filename || page.originalName || "site.html");
  const buffer = Buffer.from(String(html ?? ""), "utf8");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const error = new Error("Upload is too large.");
    error.statusCode = 413;
    throw error;
  }

  const upload = validateHtmlUpload({ filename: name, content: buffer });
  await fs.writeFile(path.join(userDir(user), `${slug}.html`), upload.content);

  page.originalName = path.basename(upload.filename);
  page.bytes = upload.content.length;
  page.updatedAt = new Date().toISOString();
  await saveIndex(user, index);

  return pageResponse(user, page);
}

async function readJsonBody(req) {
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
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

async function authenticate(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  return verifyApiKey(match[1].trim());
}

async function handleApiRequest(req, res, pathname) {
  const user = await authenticate(req);
  if (!user) return sendJson(res, 401, { error: "Missing or invalid API key." });

  const isWrite = req.method !== "GET";
  const limit = isWrite ? WRITE_LIMIT : READ_LIMIT;
  if (!checkLimit(`${user}:${isWrite ? "write" : "read"}`, limit.max, limit.windowMs)) {
    return sendJson(res, 429, { error: "Rate limit exceeded. Try again shortly." });
  }

  if (req.method === "GET" && pathname === "/api/v1/sites") {
    const sites = await listSites(user);
    return sendJson(res, 200, { user, sites });
  }

  if (req.method === "POST" && pathname === "/api/v1/sites") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }

    try {
      const site = await createSite(user, body);
      return sendJson(res, 201, site);
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
  }

  const replaceMatch = req.method === "PUT" && /^\/api\/v1\/sites\/([a-z0-9-]+)$/.exec(pathname);
  if (replaceMatch) {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }

    try {
      const site = await replaceSite(user, replaceMatch[1], body);
      return sendJson(res, 200, site);
    } catch (error) {
      return sendJson(res, error.statusCode || 400, { error: error.message });
    }
  }

  return sendJson(res, 404, { error: "Not found." });
}

module.exports = { handleApiRequest, listSites, createSite, replaceSite, sendJson };
