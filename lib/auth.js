const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { userDir, slugifyName } = require("./store");

const PASSWORD_KEY_LENGTH = 64;
const scrypt = promisify(crypto.scrypt);

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

function apiKeyPath(user) {
  return path.join(userDir(user), "apikey.json");
}

function hashApiKey(key) {
  return crypto.createHash("sha256").update(key).digest("base64");
}

async function createApiKey(user) {
  const secret = crypto.randomBytes(32).toString("base64url");
  const key = `${user}.${secret}`;
  await fs.mkdir(userDir(user), { recursive: true });
  await fs.writeFile(apiKeyPath(user), JSON.stringify({
    hash: hashApiKey(key),
    algorithm: "sha256",
    createdAt: new Date().toISOString()
  }, null, 2));
  return key;
}

async function hasApiKey(user) {
  try {
    await fs.access(apiKeyPath(user));
    return true;
  } catch {
    return false;
  }
}

async function verifyApiKey(presentedKey) {
  const key = String(presentedKey || "");
  const separator = key.indexOf(".");
  if (separator === -1) return null;

  const user = key.slice(0, separator);
  if (!user || user !== slugifyName(user)) return null;

  let record;
  try {
    record = JSON.parse(await fs.readFile(apiKeyPath(user), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!record || record.algorithm !== "sha256" || !record.hash) return null;

  const expected = Buffer.from(record.hash, "base64");
  const actual = Buffer.from(hashApiKey(key), "base64");
  if (expected.length !== actual.length) return null;
  return crypto.timingSafeEqual(expected, actual) ? user : null;
}

module.exports = {
  loadAuth,
  createPasswordAuth,
  verifyPassword,
  createApiKey,
  hasApiKey,
  verifyApiKey
};
