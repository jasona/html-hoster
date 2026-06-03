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
