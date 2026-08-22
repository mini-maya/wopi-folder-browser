# WOPI Folder Browser

This project is a small WOPI host for Collabora Online CODE. It lists Office files from a mounted folder, opens them in Collabora, and writes saves back into the same folder.

## Screenshots

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshot_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshot_light.png">
  <img alt="Screenshot" src="screenshot_light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshot_details_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshot_details_light.png">
  <img alt="Screenshot details" src="screenshot_details_light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshot_admin_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshot_admin_light.png">
  <img alt="Screenshot admin" src="screenshot_admin_light.png">
</picture>

## Features

- reads supported Office files from a local or mounted folder
- shows a simple browser UI with nested paths
- opens the selected file inside an embedded Collabora iframe
- supports document open/save/rename workflows with lock handling via WOPI
- supports **Open/Edit/View** launch modes and public share links
- supports creating new text/spreadsheet/presentation files and optional template-based creation
- supports rename/move/copy/delete, favorites, recent files, and version history restore
- supports file uploads into the root folder or a selected folder, including drag-and-drop of files and folders
- supports Office thumbnails in the details panel via Collabora `convert-to` with version-based cache
- supports authentication with session cookies and admin user management
- exposes feature matrix, diagnostics, and supported-format endpoints
- runs together with a Collabora CODE container via Docker Compose
- keeps document access scoped to Docker mounts and per-user mount permissions

### Supported file types

The app lists common Writer, Calc, and Impress formats such as:

- Writer: `odt`, `doc`, `docx`, `rtf`, `txt`
- Calc: `ods`, `xls`, `xlsx`, `csv`, `tsv`
- Impress: `odp`, `ppt`, `pptx`

Additional extensions can be added in `lib/documentStore.js`.

All file access is organized around Docker mounts. The app scans the configured `MOUNT_ROOT`, turns each subdirectory into a mount, and displays only the mounts assigned to the current user. This keeps each mount isolated and prevents unauthorized access across users or WOPI state.

## Quick start with Docker run

If Collabora is already running elsewhere, you can start the WOPI app as a standalone container with explicit mounts.

```sh
mkdir -p \
  /srv/wopi-folder-browser/mounts/documents \
  /srv/wopi-folder-browser/mounts/projects \
  /srv/wopi-folder-browser/mounts/archive \
  /srv/wopi-folder-browser/wopi-state

docker run -d \
  --name wopi-folder-browser \
  --restart unless-stopped \
  --network my-collabora-network \
  -p 3000:3000 \
  -e PORT=3000 \
  -e APP_BASE_URL=http://localhost:3000 \
  -e COLLABORA_INTERNAL_URL=http://collabora:9980 \
  -e COLLABORA_PUBLIC_URL=http://localhost:9980 \
  -e ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret \
  -e SESSION_SECRET=replace-with-a-second-long-random-secret \
  -v /srv/wopi-folder-browser/mounts:/mnt \
  -v /srv/wopi-folder-browser/wopi-state:/var/lib/wopi-state \
  ghcr.io/mini-maya/wopi-folder-browser:latest
```

Notes:

- Each subdirectory under `MOUNT_ROOT` becomes a mount in the app.
- If Collabora is not on the same Docker network, replace `http://collabora:9980` with the host or service URL that the app can reach.
- `APP_BASE_URL` should be the public URL the browser and Collabora need to reach the WOPI host.
- `COLLABORA_PUBLIC_URL` is the browser-visible Collabora URL used inside the iframe.

Minimal example (run Collabora + app with `docker run` on one network):

```sh
mkdir -p \
  /srv/wopi-folder-browser/mounts/documents \
  /srv/wopi-folder-browser/mounts/projects \
  /srv/wopi-folder-browser/mounts/archive \
  /srv/wopi-folder-browser/wopi-state

docker network create wopi-net

docker run -d \
  --name collabora \
  --restart unless-stopped \
  --network wopi-net \
  -p 9980:9980 \
  -e aliasgroup1=http://wopi-folder-browser:3000 \
  -e extra_params="--o:ssl.enable=false --o:ssl.termination=false --o:welcome.enable=false" \
  collabora/code:latest

docker run -d \
  --name wopi-folder-browser \
  --restart unless-stopped \
  --network wopi-net \
  -p 3000:3000 \
  -e APP_BASE_URL=http://localhost:3000 \
  -e COLLABORA_INTERNAL_URL=http://collabora:9980 \
  -e COLLABORA_PUBLIC_URL=http://localhost:9980 \
  -e ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret \
  -e SESSION_SECRET=replace-with-a-second-long-random-secret \
  -v /srv/wopi-folder-browser/mounts:/mnt \
  -v /srv/wopi-folder-browser/wopi-state:/var/lib/wopi-state \
  ghcr.io/mini-maya/wopi-folder-browser:latest
```

### Docker run with self-signed Collabora certificates

If your Collabora endpoint is HTTPS and signed by your own CA, mount the CA cert into the app container and set `NODE_EXTRA_CA_CERTS`:

```sh
mkdir -p \
  /srv/wopi-folder-browser/mounts/documents \
  /srv/wopi-folder-browser/mounts/projects \
  /srv/wopi-folder-browser/mounts/archive \
  /srv/wopi-folder-browser/wopi-state \
  /srv/wopi-folder-browser/certs

docker run -d \
  --name wopi-folder-browser \
  --restart unless-stopped \
  --network my-collabora-network \
  -p 3000:3000 \
  -e APP_BASE_URL=https://office.lan \
  -e COLLABORA_INTERNAL_URL=https://collabora.lan \
  -e COLLABORA_PUBLIC_URL=https://collabora.lan \
  -e NODE_EXTRA_CA_CERTS=/run/certs/collabora-ca.crt \
  -e ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret \
  -e SESSION_SECRET=replace-with-a-second-long-random-secret \
  -v /srv/wopi-folder-browser/mounts:/mnt \
  -v /srv/wopi-folder-browser/wopi-state:/var/lib/wopi-state \
  -v /srv/wopi-folder-browser/certs/ca.crt:/run/certs/collabora-ca.crt:ro \
  ghcr.io/mini-maya/wopi-folder-browser:latest
```

## Quick start with Docker Compose

This setup runs both the WOPI app and a Collabora CODE container together.
The app uses the published image `ghcr.io/mini-maya/wopi-folder-browser:latest`.
Use this section with `docker-compose.yml` (no `.env` file required).

### 1. Create the host folders

```sh
mkdir -p \
  ./wopi_dev_folder/mounts/documents \
  ./wopi_dev_folder/mounts/projects \
  ./wopi_dev_folder/mounts/archive \
  ./wopi_dev_folder/wopi-state
```

The app stores its persistent WOPI state in `WOPI_STATE_ROOT`, which is set to `/var/lib/wopi-state` in Docker. That directory must be mounted into the container so the login state, user records, mounts, locks, and other runtime metadata stay consistent across restarts.

### 2. Start the stack

```sh
docker compose pull
docker compose up -d
```

### 3. Open the app

Open `http://localhost:3000`.

### 4. Create the initial admin account

```sh
docker compose exec app npm run setup:admin -- --username admin --password "ChangeThisNow123!"
```

This command is one-time only. A second run returns an error because setup is already completed.

Each subdirectory under `./wopi_dev_folder/mounts` becomes a mount inside the app. The browser talks to the app on `localhost:3000`, while Collabora talks to the same app over Docker's internal network using the service name `app:3000`.

This local Compose setup is intentionally plain HTTP end-to-end. Do not enable `ssl.termination=true` unless Collabora is actually behind an HTTPS reverse proxy that terminates TLS.

## Application path defaults

The app keeps its internal defaults in code. These are the canonical container paths used by the runtime and are applied automatically unless you explicitly override them in the environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOUNT_ROOT` | `/mnt` | Root directory inside the container that contains the Docker mount folders. |
| `WOPI_STATE_ROOT` | `/var/lib/wopi-state` | Persistent root for runtime state, locks, user records, and per-mount metadata. |

The app scans `MOUNT_ROOT` and treats each subdirectory as one mount. Host-side bind mounts are configured directly in the Compose files, and `WOPI_STATE_ROOT` must point to the shared persisted state directory that both setup and runtime use. You can override either value via environment variables when needed, but the defaults are already set in the app so they do not have to be repeated in Compose files.

## Docker Compose (with Collabora and `.env.production`)

`docker-compose.prod.yml` uses a dedicated `.env.production` file.
Use this section for server-style deployments with explicit host paths and production secrets.

```sh
cp .env.production.example .env.production
```

Then start the stack with the prod compose file:

```sh
docker compose -f docker-compose.prod.yml up -d
```

Example `.env.production`:

```sh
# Required runtime settings
APP_BASE_URL=https://office.lan
COLLABORA_INTERNAL_URL=https://collabora.lan
COLLABORA_PUBLIC_URL=https://collabora.lan
ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret
SESSION_SECRET=replace-with-a-second-long-random-secret
PASSWORD_MIN_LENGTH=12

# Optional overrides; defaults are already defined in the app
MOUNT_ROOT=/mnt
WOPI_STATE_ROOT=/var/lib/wopi-state

# Collabora admin
COLLABORA_ADMIN_USER=admin
COLLABORA_ADMIN_PASSWORD=replace-with-a-strong-password
```

The production compose file mounts the host folders into the container at `MOUNT_ROOT`:

```yaml
services:
  app:
    env_file:
      - .env.production
    restart: unless-stopped
    volumes:
      - /srv/wopi-folder-browser/mounts:/mnt
      - /srv/wopi-folder-browser/wopi-state:/var/lib/wopi-state
  collabora:
    restart: unless-stopped
```

## Docker Compose for dev

The repository includes a local development layout under `wopi_dev_folder` and a dedicated development file: `docker-compose.dev.yml`.
Use this section when you need local image builds (code changes in the current checkout).

```sh
docker compose -f docker-compose.dev.yml up --build
```

This version is meant for quick local testing and development. It keeps the runtime defaults in code and uses the local mirror folders for the host-side mounts.

## Environment variable reference

### Mount configuration

The app discovers mounts by scanning `MOUNT_ROOT` and creating one mount for each subdirectory. Each user sees only the mount folders they are explicitly allowed to access, so access checks happen server-side and not in the browser.

### Production `.env.production` variables

These variables are used by `docker-compose.prod.yml` through `env_file`.
The `.env.production` block above is the quick bootstrap example; this table is the canonical reference for meaning and allowed values.

| Variable | Type | Topic | Purpose | Effect / persistence | Default / example |
| --- | --- | --- | --- | --- | --- |
| `APP_BASE_URL` | Variable | WOPI / network | Public base URL the browser and Collabora use to reach the WOPI host | Used for callback URLs and WOPI discovery at runtime. | `https://office.lan` |
| `COLLABORA_INTERNAL_URL` | Variable | WOPI / network | URL the app container uses to fetch discovery | Used by app-side discovery calls. | `https://collabora.lan` |
| `COLLABORA_PUBLIC_URL` | Variable | WOPI / network | Browser-visible Collabora URL used inside the iframe | Used in browser-facing URLs. | `https://collabora.lan` |
| `ACCESS_TOKEN_SECRET` | Initial | Auth | Secret used to sign WOPI access tokens | Rotate carefully; existing tokens become invalid. | `replace-with-a-long-random-secret` |
| `SESSION_SECRET` | Initial | Auth | Secret used to sign browser session cookies | Rotating invalidates active sessions. | `replace-with-a-second-long-random-secret` |
| `PASSWORD_MIN_LENGTH` | Variable | Auth | Minimum password length for setup/admin/user password flows | Runtime password policy. | `12` |
| `MOUNT_ROOT` | Variable | Mounts | Base directory inside the container that contains the Docker mount folders | Each subdirectory becomes one mount in the app. | `/mnt` |
| `WOPI_STATE_ROOT` | Variable | State | Persistent root for runtime state and lock metadata | Keeps WOPI state and mount-specific data separated. | `/var/lib/wopi-state` |
| `COLLABORA_ADMIN_USER` | Initial | Collabora auth | Admin username for Collabora-only admin tasks | Used for Collabora admin integration. | optional |
| `COLLABORA_ADMIN_PASSWORD` | Variable | Collabora auth | Admin password for Collabora-only admin tasks | Used for configured admin calls at runtime. | optional |

### Additional application runtime variables

These optional variables are read directly by the app at runtime and are not already covered by the production `.env.production` table above.

| Variable | Type | Topic | Purpose | Effect / persistence | Default / example |
| --- | --- | --- | --- | --- | --- |
| `MAX_DOCUMENT_SIZE` | Variable | Uploads | Raw upload limit for `PutFile` | Limits maximum incoming file size. | `100mb` |
| `DEFAULT_EDITOR_MODE` | Variable | UI | Launch mode for Open action (`edit` or `view`) | Runtime default for document open mode. | `edit` |
| `ALLOW_DOCUMENT_CREATION` | Variable | Features | Enables/disables create-document API endpoints (`1` enabled, `0` disabled) | `1` by default. | `1` |
| `ALLOW_TEMPLATES` | Variable | Features | Enables/disables template endpoints (`1` enabled, `0` disabled) | `1` by default. | `1` |
| `ALLOW_PDF_EXPORT` | Variable | Features | Feature flag for PDF export integration hooks (`1` enabled, `0` disabled) | `1` by default. | `1` |
| `ALLOW_PUBLIC_EDITING` | Variable | Features | Enables/disables edit-capable public links (`1` enabled, `0` disabled) | `1` by default. | `1` |
| `PREVIEW_GENERATION` | Variable | Features | Feature flag for preview generation hooks (`1` enabled, `0` disabled) | `1` by default. | `1` |
| `THUMBNAIL_MAX_WIDTH` | Variable | Preview | Maximum thumbnail width in pixels | `1024` by default. | `1024` |
| `THUMBNAIL_MAX_HEIGHT` | Variable | Preview | Maximum thumbnail height in pixels | `1024` by default. | `1024` |
| `THUMBNAIL_RETRY_COUNT` | Variable | Preview | Conversion retry attempts | `3` by default. | `3` |
| `THUMBNAIL_RETRY_DELAY_MS` | Variable | Preview | Delay between conversion retries in ms | `300` by default. | `300` |
| `THUMBNAIL_REQUEST_TIMEOUT_MS` | Variable | Preview | Timeout for capabilities/convert requests in ms | `15000` by default. | `15000` |
| `THUMBNAIL_TOKEN_TTL_MS` | Variable | Preview | Read-only WOPI token lifetime for thumbnail requests | `60000` by default. | `60000` |
| `THUMBNAIL_DEBUG` | Variable | Preview | Enables detailed thumbnail debug logs (`1` enabled, `0` disabled) | `0` by default. | `0` |

> **Important:** Environment changes become active only after container restart or redeploy.

## Reference analysis (Nextcloud richdocuments)

Reference app: `ref_richdocuments/richdocuments`, version **12.0.0-dev.0** (`appinfo/info.xml`).

The current host exposes `/api/feature-matrix` with a mapped list of features and categories:

1. already provided by Collabora
2. provided by WOPI
3. implemented in this application
4. already provided by existing application components
5. not meaningful / not supported in this sample host

## Running without Docker

```sh
npm install
npm start
```

Useful environment variables:

```sh
PORT=3000
APP_BASE_URL=http://localhost:3000
COLLABORA_INTERNAL_URL=http://localhost:9980
COLLABORA_PUBLIC_URL=http://localhost:9980
ACCESS_TOKEN_SECRET=change-me
SESSION_SECRET=change-me-session
PASSWORD_MIN_LENGTH=12
THUMBNAIL_DEBUG=0
```
