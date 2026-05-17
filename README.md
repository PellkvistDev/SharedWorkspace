# WorkspaceOS

A self-hosted personal workspace server. The web UI is the "OS" — file
explorer, terminal, Claude Code remote control, and a browser tab, all
gated behind a single-user login and reachable from any device on your
Tailscale network.

> Designed for **Windows** as the host (this is your PC), but the server
> code is cross-platform; it will run on macOS or Linux too.

---

## Stack

| Layer        | Choice |
| ---          | --- |
| Backend      | Node.js 20+ · Fastify · TypeScript |
| Realtime     | `@fastify/websocket` (ws) |
| PTY          | `node-pty` |
| Frontend     | React 18 · Vite · TypeScript · Tailwind |
| Editor       | Monaco (`@monaco-editor/react`) |
| Terminal UI  | `xterm.js` + fit + web-links |
| Auth         | `bcrypt` + httpOnly session cookies + CSRF |
| DB           | `better-sqlite3` (file under `./data`) |
| Logging      | `pino` (JSON to file + pretty to console) |

Monorepo layout via **pnpm workspaces**:

```
/server   Fastify API + WS + static asset host
/client   React + Vite UI
/shared   Shared TypeScript types
```

---

## Prerequisites

- **Node.js 20+** (22 recommended). Windows: install from <https://nodejs.org>.
- **pnpm 9+**: `npm install -g pnpm`
- **Build tools** so `node-pty` and `better-sqlite3` can compile native
  bindings:
  - Windows: `npm install -g windows-build-tools` is deprecated — instead
    install the **Visual Studio Build Tools** (Desktop C++ workload) and a
    recent Python. Most users can just run `npm config set msvs_version 2022`
    after installing Visual Studio Build Tools 2022.
  - Linux/macOS: standard `build-essential` / Xcode CLT.
- **OpenSSL** in PATH (for `pnpm gen-certs`). Git for Windows ships it.

---

## Install

```bash
pnpm install
pnpm build
```

`pnpm build` builds shared types, the server (TypeScript → dist), and the
client (Vite → `client/dist`). The server serves the built client
statically, so once you've built, a single `pnpm start` runs everything.

---

## First-run configuration

1. **Copy `.env.example` to `.env`** and edit values.

2. **Set the password.** The password hash is stored in `.env` only — the
   plaintext is never written to disk.

   ```bash
   pnpm hash-password
   ```

   Paste the printed bcrypt hash into `.env` as `PASSWORD_HASH`.

3. **Set a session secret** (`SESSION_SECRET`) — any long random string. If
   you skip this the server logs a warning and uses a random ephemeral
   secret (sessions invalidate on restart).

4. **Point `WORKSPACE_ROOT` at the folder you want exposed.** Default:
   `C:\Workspace` on Windows. Everything in the file explorer is sandboxed
   to this directory — paths that try to escape (including via symlinks)
   are rejected by `server/src/fs-sandbox.ts`.

5. **Pick your shell** (optional). `TERMINAL_SHELL` overrides the
   auto-detected default. On Windows, the recommended order is:

   - `pwsh.exe` (PowerShell 7, install from <https://aka.ms/powershell>)
   - `powershell.exe` (built-in Windows PowerShell)
   - `cmd.exe` (always present)

   Leave `TERMINAL_SHELL` blank for the OS default.

6. **Claude Code CLI.** Install per Anthropic docs and verify `claude` is
   on the system PATH (the server spawns it as `claude`). If you keep it
   somewhere bespoke, set `CLAUDE_CMD` to the absolute path.

---

## Running

### Dev (auto-reload)

```bash
pnpm dev
```

This runs the server with `tsx watch` and the Vite dev server in parallel.
Open <http://localhost:5173> — Vite proxies `/api` and `/ws/*` to the
backend on `:8443`.

### Prod (single process)

```bash
pnpm build
pnpm start
```

The server serves the built UI from `client/dist` on `PORT` (default 8443).
With TLS configured (see below) it speaks HTTPS; otherwise plain HTTP.

### One-click on Windows

`start.bat` will run the production server (assumes `pnpm install && pnpm
build` has already been run once).

---

## TLS

### Dev: self-signed certs

```bash
pnpm gen-certs
```

This drops `cert.pem` and `key.pem` into `./certs` and the `.env.example`
values already point at them. Your browser will warn on first visit —
accept once. Don't reuse these certs in production.

### Prod: Tailscale MagicDNS + Let's Encrypt

Tailscale issues real Let's Encrypt certs for hosts on your tailnet. After
you've installed Tailscale and enabled HTTPS in the admin console:

```powershell
tailscale cert <your-machine>.<tailnet>.ts.net
```

This writes `<host>.crt` and `<host>.key` to the current directory. Point
the server at them:

```
TLS_CERT=C:\path\to\host.crt
TLS_KEY=C:\path\to\host.key
```

You'll want a scheduled task to renew them periodically (Tailscale certs
expire after 90 days; re-run the `tailscale cert` command).

---

## Tailscale

Install Tailscale on the host (<https://tailscale.com/download>) and on
each device you want to reach the workspace from. Once connected, you can
visit the host by its MagicDNS name (e.g.
`https://yourpc.tailnet.ts.net:8443`).

The server binds to `0.0.0.0` by default; restrict it to the Tailscale
interface by setting `HOST` to the Tailscale-assigned IP if you want extra
defense in depth.

---

## Running as a Windows service

`node-windows` is the easiest:

```bash
npm install -g node-windows
```

Then save and run this script (`install-service.js`) once:

```js
const { Service } = require("node-windows");
const path = require("path");
const svc = new Service({
  name: "WorkspaceOS",
  description: "Personal workspace server",
  script: path.resolve("server/dist/index.js"),
  nodeOptions: [],
  workingDirectory: path.resolve("."),
});
svc.on("install", () => svc.start());
svc.install();
```

NSSM (<https://nssm.cc>) is an equally good alternative if you prefer GUI
service management.

### Run as a non-admin Windows user

Create a dedicated, non-privileged Windows account (e.g. `workspaceos`)
and grant it:

- Read/write on the workspace root only (`C:\Workspace` by default).
- "Log on as a service" right (via `secpol.msc` → Local Policies → User
  Rights Assignment).
- No admin group membership.

When installing the service, set it to run as that user. Even if the
server is compromised, the blast radius is limited to that user's
permissions.

---

## Security checklist

- [x] HTTPS supported (auto-enabled when `TLS_CERT`/`TLS_KEY` are present)
- [x] All API and WS routes auth-gated; WS connections check `Origin`
- [x] Filesystem ops sandboxed via `fs-sandbox.ts` (no path traversal, no
      escaping symlinks)
- [x] PTY spawns use array-form args — user input never becomes an argv
- [x] Login rate-limited (5 attempts / 15 min / IP)
- [x] CSRF token required on state-changing requests
- [x] Security headers (`X-Frame-Options`, `nosniff`, HSTS in prod)
- [x] Per-PTY idle sweeper to clean up zombie sessions

The proxy endpoint (`/api/proxy`) refuses internal/loopback hosts to avoid
becoming an SSRF gadget.

---

## Architectural notes & decisions

- **Single user.** No user table; `PASSWORD_HASH` is the credential.
- **CSRF.** Server returns the per-session CSRF token from
  `/api/auth/status` and `/api/auth/login`; the client sends it as
  `X-CSRF-Token` on every POST/PUT/PATCH/DELETE. Cookies are SameSite=Lax.
- **PtySessionManager.** Shared between the Terminal and Claude Code
  features. Sessions are persistent across reconnects (identified by
  UUID), with an in-memory scrollback ring buffer for replay. Idle
  sessions are reaped per `PTY_IDLE_TIMEOUT_MS`.
- **Claude chat parser.** The server forwards raw PTY output and also
  buffers a cleaned (ANSI-stripped) version. The client renders chat
  bubbles from the cleaned stream and offers a raw `xterm.js` toggle for
  power moves (or whenever the parser miscategorises something). The
  cleaned buffer is committed to SQLite as an assistant message when the
  PTY goes idle.
- **Browser tab.** Defaults to a sandboxed iframe. If a site refuses to be
  framed (X-Frame-Options/CSP), click the **Proxy** button to render it
  through `/api/proxy`, which strips frame-busting headers and injects a
  `<base>` tag for relative URLs. Proxied mode is marked clearly with an
  amber border.

---

## Build phases

See the original spec — Phase 1 → Phase 7. This repo has all phases
scaffolded; deploy and exercise each one before relying on the next.

## License

Personal use. No license is included; you own this.
