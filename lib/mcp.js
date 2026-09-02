const { createMcpHandler, McpServer } = require("@modelcontextprotocol/server");
const { toNodeHandler } = require("@modelcontextprotocol/node");
const { z } = require("zod/v4");
const { verifyApiKey } = require("./auth");
const { listSites, createSite, replaceSite } = require("./api");
const { checkLimit } = require("./rate-limit");

const MCP_RATE_LIMIT = { max: 60, windowMs: 5 * 60 * 1000 };

// Host header allowlist for the deployed domain(s), e.g. "sitepaste.app,www.sitepaste.app".
// Empty by default for local development; set in production to prevent DNS-rebinding attacks.
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

function factory({ authInfo }) {
  const user = authInfo.extra.user;
  const server = new McpServer({ name: "sitepaste", version: "1.0.0" });

  server.registerTool(
    "list_sites",
    {
      title: "List sites",
      description: "List the authenticated user's hosted HTML pages.",
      inputSchema: z.object({})
    },
    async () => {
      const sites = await listSites(user);
      return {
        content: [{ type: "text", text: JSON.stringify(sites, null, 2) }],
        structuredContent: { sites }
      };
    }
  );

  server.registerTool(
    "create_site",
    {
      title: "Create site",
      description: "Create a new hosted standalone HTML page and return its share URL.",
      inputSchema: z.object({
        filename: z.string().describe("Suggested file name, e.g. index.html"),
        html: z.string().describe("Full HTML document contents")
      })
    },
    async ({ filename, html }) => {
      try {
        const site = await createSite(user, { filename, html });
        return {
          content: [{ type: "text", text: `Created ${site.url}` }],
          structuredContent: site
        };
      } catch (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    }
  );

  server.registerTool(
    "replace_site",
    {
      title: "Replace site",
      description: "Completely replace the HTML content of an existing site, keeping its share URL. Use list_sites to find the slug.",
      inputSchema: z.object({
        slug: z.string().describe("The site's slug, as returned by list_sites (e.g. sunny-window-nest)"),
        filename: z.string().optional().describe("Optional new file name; keeps the existing one if omitted"),
        html: z.string().describe("Full HTML document contents to replace the existing page with")
      })
    },
    async ({ slug, filename, html }) => {
      try {
        const site = await replaceSite(user, slug, { filename, html });
        return {
          content: [{ type: "text", text: `Replaced ${site.url}` }],
          structuredContent: site
        };
      } catch (error) {
        return { content: [{ type: "text", text: error.message }], isError: true };
      }
    }
  );

  return server;
}

const handler = createMcpHandler(factory);
const nodeHandler = toNodeHandler(handler);

function hostAllowed(req) {
  if (ALLOWED_HOSTS.length === 0) return true;
  const host = String(req.headers.host || "").toLowerCase();
  return ALLOWED_HOSTS.includes(host);
}

async function handleMcpRequest(req, res) {
  if (!hostAllowed(req)) {
    res.writeHead(421, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Misdirected Request.");
  }

  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const presented = match ? match[1].trim() : null;
  const user = presented ? await verifyApiKey(presented) : null;

  if (!user) {
    res.writeHead(401, {
      "Content-Type": "application/json; charset=utf-8",
      "WWW-Authenticate": "Bearer"
    });
    return res.end(JSON.stringify({ error: "Missing or invalid API key." }));
  }

  if (!checkLimit(`mcp:${user}`, MCP_RATE_LIMIT.max, MCP_RATE_LIMIT.windowMs)) {
    res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify({ error: "Rate limit exceeded. Try again shortly." }));
  }

  req.auth = { token: presented, clientId: user, scopes: [], extra: { user } };
  await nodeHandler(req, res);
}

module.exports = { handleMcpRequest };
