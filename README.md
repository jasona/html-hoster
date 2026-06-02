# HTML Hoster

A tiny Gist-like host for standalone HTML files.

## Run locally

```sh
npm start
```

Open `http://localhost:3000`, enter your first name once, then visit `/upload` to upload an `.html` file. Uploaded pages get URLs like `/jason/flower-purple-hat.html`.

## Docker

```sh
docker build -t html-hoster .
docker run -p 3000:3000 -v html-hoster-data:/app/data html-hoster
```

For Coolify, deploy the repository as a Docker app and mount persistent storage at `/app/data`.

## Environment

- `PORT`: HTTP port inside the container, defaults to `3000`
- `DATA_DIR`: storage directory, defaults to `./data` locally and `/app/data` in Docker
- `MAX_UPLOAD_MB`: upload limit in megabytes, defaults to `5`
