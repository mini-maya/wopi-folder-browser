# WOPI Folder Browser

This project is a small WOPI host for Collabora Online CODE. It lists Office files from a mounted folder, opens them in Collabora, and writes saves back into the same folder.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="screenshot_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="screenshot_light.png">
  <img alt="Screenshot" src="screenshot_light.png">
</picture>

## Features

- reads supported Office files from a local or mounted folder
- shows a simple browser UI with nested paths
- opens the selected file inside an embedded Collabora iframe
- implements `CheckFileInfo`, `GetFile`, `PutFile`, `WOPI locks`, and `RenameFile`
- supports **Open/Edit/View** launch modes and public share links
- supports creating new text/spreadsheet/presentation files and optional template-based creation
- supports rename/move/copy/delete, favorites, recent files, and version history restore
- supports file uploads into the root folder or a selected folder, including drag-and-drop of files and folders
- supports authentication with session cookies, personal user storage, and admin user management
- exposes feature matrix, diagnostics, and supported-format endpoints
- runs together with a Collabora CODE container via Docker Compose

## Reference analysis (Nextcloud richdocuments)

Reference app: `ref_richdocuments/richdocuments`, version **12.0.0-dev.0** (`appinfo/info.xml`).

The current host exposes `/api/feature-matrix` with a mapped list of features and categories:

1. already provided by Collabora
2. provided by WOPI
3. implemented in this application
4. already provided by existing application components
5. not meaningful / not supported in this sample host

## Supported file types

The app lists common Writer, Calc, and Impress formats such as:

- Writer: `odt`, `doc`, `docx`, `rtf`, `txt`
- Calc: `ods`, `xls`, `xlsx`, `csv`, `tsv`
- Impress: `odp`, `ppt`, `pptx`

Additional extensions can be added in `lib/documentStore.js`.

## Quick start with Docker Compose

1. Optionally create a document folder on your host and place a few Office files inside it.
2. Set `DOCUMENTS_HOST_PATH` if you do not want to use the bundled `example-documents` folder. Optionally set `WOPI_STATE_ROOT` to move the app state (`.wopi-state`) into a dedicated host folder or Docker volume.
3. Start the stack:

   ```sh
   docker compose up --build
   ```

4. Open `http://localhost:3000`.

5. Create the initial admin account from inside the app container:

   ```sh
   docker compose exec app npm run setup:admin -- --username admin --password "ChangeThisNow123!"
   ```

   The command is one-time only. A second run returns an error because setup is already completed.

The browser talks to the app on `localhost:3000`, while the Collabora container talks to the same app over the internal Docker network using the service name `app:3000`.

This local Compose setup is intentionally **plain HTTP end-to-end**. Do not enable `ssl.termination=true` unless you actually put Collabora behind an HTTPS reverse proxy that terminates TLS.

For production Compose:

```sh
docker compose --env-file .env.production -f docker-compose.prod.yml exec app \
  npm run setup:admin -- --username admin --password "ChangeThisNow123!"
```

## Configuration

The Compose file already wires the important variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `DOCUMENTS_HOST_PATH` | Host folder mounted into the app container | `./example-documents` |
| `WOPI_STATE_ROOT` | Dedicated folder for persistent runtime state; defaults to `<DOCUMENT_ROOT>/.wopi-state` | `<DOCUMENT_ROOT>/.wopi-state` |
| `APP_BASE_URL` | Collabora-reachable base URL used for `WOPISrc` callbacks | `http://app:3000` |
| `COLLABORA_INTERNAL_URL` | URL used by the app container to fetch discovery | `http://collabora:9980` |
| `COLLABORA_PUBLIC_URL` | Browser-visible Collabora URL used inside the iframe | `http://localhost:9980` |
| `ACCESS_TOKEN_SECRET` | Secret used to sign WOPI access tokens | `change-me-for-real-usage` |
| `SESSION_SECRET` | Secret used to sign browser session cookies | `change-me-session-secret` |
| `PASSWORD_MIN_LENGTH` | Minimum password length for setup/admin/user password flows | `12` |

`WOPI_STATE_ROOT` is the key setting that moves the hidden `.wopi-state` directory out of the documents tree. In Docker Compose it is usually mounted separately, for example:

```yaml
services:
  app:
    environment:
      DOCUMENT_ROOT: /documents
      WOPI_STATE_ROOT: /var/lib/wopi-state
    volumes:
      - ${DOCUMENTS_HOST_PATH:-./example-documents}:/documents
      - ${WOPI_STATE_ROOT:-./wopi-state}:/var/lib/wopi-state
```

This keeps the document volume clean while preserving the app's registry, locks, and cache data in a dedicated Docker volume or host folder.
| `MAX_DOCUMENT_SIZE` | Raw upload limit for `PutFile` | `100mb` |
| `TEMPLATE_ROOT` | Template root folder for personal/group/global/admin templates | `<DOCUMENT_ROOT>/.templates` |
| `DEFAULT_EDITOR_MODE` | Launch mode for Open action (`edit`/`view`) | `edit` |
| `ALLOW_DOCUMENT_CREATION` | Enables/disables API creation endpoints | `1` |
| `ALLOW_TEMPLATES` | Enables/disables template endpoints | `1` |
| `ALLOW_PDF_EXPORT` | Feature flag for PDF export integration hooks | `1` |
| `ALLOW_PUBLIC_EDITING` | Enables/disables edit-capable public links | `1` |
| `PREVIEW_GENERATION` | Feature flag for preview generation hooks | `1` |
| `DEFAULT_TEXT_DOCUMENT_NAME` | Default localized base name for new text docs | `Untitled document` |
| `DEFAULT_SPREADSHEET_NAME` | Default localized base name for new spreadsheets | `Untitled spreadsheet` |
| `DEFAULT_PRESENTATION_NAME` | Default localized base name for new presentations | `Untitled presentation` |

## Running without Docker

```sh
npm install
npm start
```

Useful environment variables:

```sh
PORT=3000
DOCUMENT_ROOT=./example-documents
APP_BASE_URL=http://localhost:3000
COLLABORA_INTERNAL_URL=http://localhost:9980
COLLABORA_PUBLIC_URL=http://localhost:9980
ACCESS_TOKEN_SECRET=change-me
SESSION_SECRET=change-me-session
PASSWORD_MIN_LENGTH=12
```

## Production setup: `office.lan` + `collabora.lan`

Use `docker-compose.prod.yml` when:

- the WOPI app is published as `https://office.lan`
- Collabora CODE is published as `https://collabora.lan`
- Collabora itself runs on plain HTTP in the container
- a reverse proxy terminates TLS in front of Collabora
- the certificate for `collabora.lan` is signed by your own CA and you have the matching `ca.crt`

### Files

- `docker-compose.prod.yml`: production-oriented Compose example
- `.env.production.example`: required environment variables

### App container settings

Set the WOPI app so it talks to the public HTTPS Collabora URL:

| Variable | Value for this setup | Why |
| --- | --- | --- |
| `APP_BASE_URL` | `https://office.lan` | This becomes the `WOPISrc` base URL used by Collabora callbacks. |
| `COLLABORA_INTERNAL_URL` | `https://collabora.lan` | The app fetches `/hosting/discovery` from this address. |
| `COLLABORA_PUBLIC_URL` | `https://collabora.lan` | The browser opens the editor iframe on this public URL. |
| `NODE_EXTRA_CA_CERTS` | `/run/certs/collabora-ca.crt` | Lets Node trust your self-signed CA for outbound HTTPS to Collabora. |

Mount the CA file read-only into the app container:

```yaml
volumes:
  - /path/to/ca.crt:/run/certs/collabora-ca.crt:ro
```

`ca.crt` must be the CA certificate that signed the reverse proxy certificate presented by `collabora.lan`.

### Collabora container settings

For Collabora behind a TLS-terminating reverse proxy, the container must be configured for **HTTP internally** and **HTTPS externally**:

| Setting | Required value | Why |
| --- | --- | --- |
| `aliasgroup1` | `https://office\\.lan` | Allows your WOPI host. Use the exact external scheme and host; include `:PORT` if you publish on a non-standard port. |
| `--o:ssl.enable=false` | enabled in `extra_params` | Collabora should not speak TLS itself when the proxy terminates TLS. |
| `--o:ssl.termination=true` | enabled in `extra_params` | Tells Collabora that the public entrypoint is HTTPS behind a proxy. |
| `--o:server_name=collabora.lan` | enabled in `extra_params` | Makes Collabora use the public hostname consistently behind the proxy. |
| `username` / `password` | set strong values | Protects the admin console. |

The example in `docker-compose.prod.yml` is:

```yaml
environment:
  aliasgroup1: https://office\\.lan
  extra_params: >-
    --o:ssl.enable=false
    --o:ssl.termination=true
    --o:welcome.enable=false
    --o:server_name=collabora.lan
```

### Reverse proxy requirements for `collabora.lan`

Your proxy in front of the Collabora container must:

1. forward all Collabora paths to container port `9980`
2. preserve the `Host` header as `collabora.lan`
3. send `X-Forwarded-Proto: https`
4. support WebSocket upgrade requests
5. allow larger request bodies and disable overly aggressive buffering/timeouts for long editing sessions

In practice this means the proxy must correctly handle normal HTTP requests **and** WebSocket traffic for paths under `/cool/`, plus discovery endpoints like `/hosting/discovery`.

### Reverse proxy requirements for `office.lan`

If the WOPI app is also behind HTTPS, the proxy in front of `office.lan` must:

1. publish the app as `https://office.lan`
2. pass requests to the app container on port `3000`
3. preserve the external host so `APP_BASE_URL=https://office.lan` stays valid
4. allow Collabora to call back to `https://office.lan/wopi/...`

### Compose workflow

1. Copy the example env file and adjust the paths and secrets:

   ```sh
   cp .env.production.example .env.production
   ```

2. Ensure your reverse proxy can resolve and reach the `collabora` and `app` services on the external Docker network named in `PROXY_NETWORK`.
3. Ensure the same DNS names used publicly are resolvable from the containers, especially `collabora.lan`.
4. Start the stack:

   ```sh
   docker compose --env-file .env.production -f docker-compose.prod.yml up --build -d
   ```

### What must be configured on the Collabora container?

At minimum:

1. `aliasgroup1` for the exact external WOPI host, here `https://office.lan`
2. `ssl.enable=false` because TLS ends at the proxy
3. `ssl.termination=true` because the public URL is HTTPS
4. `server_name=collabora.lan` so generated public URLs match the proxy hostname
5. strong admin credentials
6. placement on the same Docker network as the reverse proxy

If one of these points is wrong, the common symptoms are:

- **Unauthorized WOPI host**: `aliasgroup*` does not match the WOPI host exactly
- **Socket/WebSocket connection errors**: proxy upgrade headers or `ssl.termination` are wrong
- **TLS/certificate errors from the app**: the app container does not trust the CA for `collabora.lan`

## Notes

- The app keeps a public shared area and additionally supports authenticated personal user storage.
- In production, run both services behind HTTPS and replace the development token secret.
