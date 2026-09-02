const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
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

function slugifyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function userDir(user) {
  return path.join(DATA_DIR, "users", user);
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
  const indexPath = path.join(userDir(user), "index.json");
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

function randomFrom(values) {
  return values[crypto.randomInt(values.length)];
}

async function uniquePageSlug(user) {
  const dir = userDir(user);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = `${randomFrom(WORDS_A)}-${randomFrom(WORDS_B)}-${randomFrom(WORDS_C)}`;
    try {
      await fs.access(path.join(dir, `${slug}.html`));
    } catch {
      return slug;
    }
  }
  return crypto.randomBytes(8).toString("hex");
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

module.exports = {
  DATA_DIR,
  MAX_UPLOAD_BYTES,
  WORDS_A,
  WORDS_B,
  WORDS_C,
  slugifyName,
  userDir,
  ensureUser,
  saveIndex,
  uniquePageSlug,
  validateHtmlUpload
};
