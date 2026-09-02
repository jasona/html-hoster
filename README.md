# SitePaste.app

A tiny Gist-like pastebin for standalone HTML pages.

## Run locally

```sh
npm start
```

Open `http://localhost:3000`, enter your first name and password, then visit `/upload` to upload an `.html` file. Uploaded pages get URLs like `/jason/flower-purple-hat.html`.

Passwords are stored as salted `scrypt` hashes in each owner's data directory, so a returning owner can re-authenticate if their browser cookie is gone.

## Docker

```sh
docker build -t sitepaste .
docker run -p 3000:3000 -v sitepaste-data:/app/data sitepaste
```

For Coolify, deploy the repository as a Docker app and mount persistent storage at `/app/data`.

## Environment

- `PORT`: HTTP port inside the container, defaults to `3000`
- `DATA_DIR`: storage directory, defaults to `./data` locally and `/app/data` in Docker
- `MAX_UPLOAD_MB`: upload limit in megabytes, defaults to `5`
- `MCP_ALLOWED_HOSTS`: comma-separated list of hostnames the `/mcp` endpoint will accept (e.g. `sitepaste.app`). Leave unset for local development; set it in production to prevent DNS-rebinding attacks.

## API

Visit `/account` while signed in to generate an API key (shown once — copy it somewhere safe; regenerating invalidates the old one). Use it as a Bearer token:

```sh
# List your sites
curl -H "Authorization: Bearer <key>" https://sitepaste.app/api/v1/sites

# Create a new site
curl -X POST https://sitepaste.app/api/v1/sites \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"filename": "index.html", "html": "<!doctype html><title>Hi</title><h1>Hello!</h1>"}'

# Replace an existing site's content (keeps its share URL)
curl -X PUT https://sitepaste.app/api/v1/sites/<slug> \
  -H "Authorization: Bearer <key>" \
  -H "Content-Type: application/json" \
  -d '{"html": "<!doctype html><title>Hi</title><h1>Updated!</h1>"}'
```

`POST /api/v1/sites` responds `201` with `{ slug, url, originalName, bytes, createdAt }`. `PUT /api/v1/sites/<slug>` responds `200` with the same shape (plus `updatedAt`); `filename` is optional and keeps the existing name if omitted. All endpoints are rate-limited per key. Deleting a site via the API isn't supported yet.

## MCP

The same deployment exposes a remote MCP server at `/mcp` with three tools — `list_sites`, `create_site`, and `replace_site` (for updating a site's content in place, e.g. after the LLM makes changes) — backed by the same API key. Add it to an MCP client's config, e.g. Claude Code's `.mcp.json`:

```json
{
  "mcpServers": {
    "sitepaste": {
      "url": "https://sitepaste.app/mcp",
      "headers": { "Authorization": "Bearer <key>" }
    }
  }
}
```

Check your MCP client's own docs for its exact remote-server config format — the important parts are the `/mcp` URL and the `Authorization: Bearer <key>` header.
