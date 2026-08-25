# Development Learnings

This file records mistakes, fixes, and lessons learned while developing Overlay Monster.

## Rules

1. Read this file before changing the build, release, updater, security, or deployment system.
2. Add a short entry when a bug wastes development time or reveals an important constraint.
3. Record the root cause, fix, and prevention rule.
4. Do not delete old lessons unless they are proven obsolete.

## Electron UI / Renderer

### 2026-08-25 — Vite Electron builds must use relative asset paths

**Symptom**

The packaged Electron app showed a blank white renderer area while the native `WebContentsView` loaded the browser page correctly.

**Root cause**

Electron loads the renderer with `file://.../dist/renderer/index.html`. Vite's default `base` is `/`, which generates root-relative assets such as `/assets/index.js`. Those paths fail under `file://`.

**Fix**

```ts
base: mode === 'electron' ? './' : '/'
```

**Prevention**

Whenever Vite output is loaded with `BrowserWindow.loadFile()`, verify production asset paths are relative.

---

## Electron Security

### 2026-08-25 — Remote web content must use renderer sandboxing

**Problem**

The browser `WebContentsView` and local `BrowserWindow` renderer explicitly used `sandbox: false`.

**Fix**

Both renderers now use:

```ts
contextIsolation: true,
nodeIntegration: false,
sandbox: true,
webSecurity: true
```

**Prevention**

Do not disable Electron sandboxing for remote content unless there is a documented native-module requirement.

---

### 2026-08-25 — Remote permission requests need an explicit policy

**Problem**

Electron can approve permission requests by default unless a handler is configured.

**Fix**

The default session now:

- Allows fullscreen on secure origins.
- Prompts before camera/microphone access.
- Denies other permission types by default.
- Requires HTTPS outside development.

**Prevention**

Every remote-content Electron app must define permission checks and request handling.

---

### 2026-08-25 — IPC handlers must validate their sender

**Problem**

Privileged IPC handlers did not validate that the caller was the trusted local renderer.

**Fix**

IPC handlers now reject calls unless `event.sender === mainWindow.webContents`.

**Prevention**

Validate IPC senders before performing privileged operations or returning native state.

---

### 2026-08-25 — Remote navigation must be constrained

**Problem**

The browser accepted arbitrary navigation protocols.

**Fix**

Production navigation now permits HTTPS only. Development additionally permits localhost HTTP. Window-open and redirect navigation are checked too.

**Prevention**

Parse URLs with `URL`. Never use weak string-prefix checks for security decisions.

---

### 2026-08-25 — Local renderer needs a Content Security Policy

**Problem**

The local renderer had no CSP.

**Fix**

Added a restrictive CSP to `index.html`.

**Prevention**

Keep the local Electron renderer on a restrictive CSP and do not add remote script sources.

---

## Electron Release and Auto-Update

### 2026-08-25 — Do not use `latest` for `electron-updater`

**Symptom**

`electron-builder` failed because `electron-updater` was set to `latest`.

**Fix**

Use an explicit compatible version. The current project pins `electron-updater` to `6.8.9`.

**Prevention**

Do not use `latest` for tightly coupled Electron build/runtime packages.

---

### 2026-08-25 — Release workflow version extraction must avoid PowerShell quoting traps

Use PowerShell JSON parsing:

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
"version=$version" >> $env:GITHUB_OUTPUT
```

---

### 2026-08-25 — `setup-node` npm cache requires a lockfile

`actions/setup-node` with `cache: npm` requires a supported lockfile.

The repository now generates and commits `package-lock.json` through `.github/workflows/sync-lockfile.yml`.

---

### 2026-08-25 — Release builds should not run on every source commit

Normal commits run CI only. Production releases run from semantic version tags such as `v0.2.9`.

---

### 2026-08-25 — GitHub Releases need versioned tags for Electron auto-update

Preferred flow:

```text
package.json version
        ↓
v0.2.9 tag
        ↓
GitHub Actions
        ↓
electron-builder
        ↓
GitHub Release v0.2.9
        ↓
latest.yml + installer
        ↓
electron-updater
```

Do not rely on a permanent manually overwritten `latest` tag.

---

## TypeScript / Build Scripts

### 2026-08-25 — Verify TypeScript config paths

The `typecheck` script previously referenced `tsconfig.tsconfig.json`. The correct file is `tsconfig.json`.

---

## Release Checklist

- [ ] CI passes.
- [ ] `package.json` version is correct.
- [ ] Exact dependency versions are used.
- [ ] `package-lock.json` is current.
- [ ] Electron renderer uses relative assets when loaded with `file://`.
- [ ] Electron renderer sandboxing is enabled.
- [ ] IPC sender validation is enabled.
- [ ] Remote permission policy is configured.
- [ ] Remote navigation is constrained.
- [ ] `electron-updater` is compatible with `electron-builder`.
- [ ] TypeScript config paths are valid.
- [ ] NSIS installer is generated.
- [ ] `latest.yml` is generated.
- [ ] GitHub Release has the correct semantic version tag.
- [ ] Existing installed versions can discover the new release.
- [ ] Vercel download button points to the latest release installer.
