# Development Learnings

This file records mistakes, fixes, and lessons learned while developing Overlay Monster.

## Rules

1. Read this file before changing the build, release, updater, or deployment system.
2. Add a short entry when a bug wastes development time or reveals an important constraint.
3. Record the root cause, fix, and prevention rule.
4. Do not delete old lessons unless they are proven obsolete.

## Electron UI / Renderer

### 2026-08-25 — Vite Electron builds must use relative asset paths

**Symptom**

The packaged Electron app showed a blank white renderer area while the native `WebContentsView` loaded the browser page correctly.

**Root cause**

Electron loads the renderer with:

```text
file://.../dist/renderer/index.html
```

Vite's default `base` is `/`. That generates root-relative assets such as `/assets/index.js`. Under `file://`, those paths resolve incorrectly, so the React renderer JavaScript does not load.

**Fix**

Use a relative Vite base for the Electron build:

```ts
base: mode === 'electron' ? './' : '/',
```

Keep `/` for the normal Vercel/web build.

**Prevention**

Whenever a Vite app is loaded with `BrowserWindow.loadFile()`, verify production asset paths are relative.

---

## Electron Release and Auto-Update

### 2026-08-25 — Do not use `latest` for `electron-updater`

**Symptom**

`electron-builder` failed with an incompatibility error because `electron-updater` was set to `latest`.

**Fix**

Use:

```json
"electron-updater": "^4.0.0"
```

**Prevention**

Do not use `latest` for tightly coupled Electron build/runtime packages.

---

### 2026-08-25 — Release workflow version extraction must avoid PowerShell quoting traps

Use PowerShell JSON parsing instead of nested shell quoting:

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
"version=$version" >> $env:GITHUB_OUTPUT
```

---

### 2026-08-25 — `setup-node` npm cache requires a lockfile

`actions/setup-node` with `cache: npm` requires a supported lockfile. The repository previously had no lockfile.

Use a committed `package-lock.json` for reproducible builds, or do not enable npm caching.

---

### 2026-08-25 — Release builds should not run on every source commit

Normal source commits should not create Windows release builds. Production releases need an explicit release signal, preferably a semantic version tag such as `v0.2.4`.

---

### 2026-08-25 — GitHub Releases need versioned tags for Electron auto-update

Preferred flow:

```text
package.json version
        ↓
v0.2.4 tag
        ↓
GitHub Actions
        ↓
electron-builder
        ↓
GitHub Release
        ↓
latest.yml + installer
        ↓
electron-updater
```

Do not rely on manually overwriting a permanent `latest` tag.

---

## TypeScript / Build Scripts

### 2026-08-25 — Verify TypeScript config paths

The `typecheck` script previously referenced `tsconfig.tsconfig.json`. The correct file is `tsconfig.json`.

---

## Release Checklist

- [ ] `package.json` version is correct.
- [ ] Electron renderer uses relative assets when loaded with `file://`.
- [ ] `electron-updater` is compatible with `electron-builder`.
- [ ] TypeScript config paths are valid.
- [ ] Dependencies install successfully.
- [ ] Electron build succeeds.
- [ ] NSIS installer is generated.
- [ ] `latest.yml` is generated.
- [ ] GitHub Release has the correct semantic version tag.
- [ ] Existing installed versions can discover the new release.
- [ ] Vercel download button points to the latest release installer.
