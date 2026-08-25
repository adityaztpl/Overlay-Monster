# Audit Remediation — 2026-08-25

## Scope

This document records the remediation work completed after the end-to-end code audit.

## Completed

### Release pipeline

- Release workflow no longer runs on normal source commits.
- Production releases use `vMAJOR.MINOR.PATCH` tags.
- Manual release dispatch requires an explicit version.
- `package.json.version` is validated against the release version.
- Release artifacts are explicitly verified before publishing.
- CI is separate from release packaging.

### Dependency management

- Build-critical dependencies no longer use `latest`.
- Node 22 is the supported CI runtime.
- npm version is declared in `packageManager`.
- Lockfile synchronization workflow added.
- CI/release use `npm ci` when `package-lock.json` exists.

### Electron security

- Browser renderer sandbox enabled.
- Local renderer sandbox enabled.
- `nodeIntegration: false` retained.
- `contextIsolation: true` retained.
- `webSecurity: true` explicitly enabled.
- Remote permission checks added.
- Camera/microphone requests require user confirmation.
- Other remote permissions are denied by default.
- Production remote navigation restricted to HTTPS.
- HTTP is allowed only for localhost development.
- Redirects and window-open navigation are checked.
- IPC handlers validate the sender.
- Renderer CSP added.

### Electron renderer reliability

- Vite Electron build uses relative asset paths.
- Packaged renderer path is checked before loading.
- Startup errors are logged to `startup.log`.

### Capture protection

- Windows content protection is applied during startup.
- Native `GetWindowDisplayAffinity` verification remains enabled.
- UI reports `applied`, `error`, `unsupported`, or `disabled` instead of assuming success.

## Remaining Work

### P0

- Generate and review the first committed `package-lock.json` produced by CI.
- Run Windows CI on the hardened code.
- Build a fresh installer from a new version tag.
- Test installed upgrade from `v0.2.8` to the next release.
- Test capture protection on real Windows capture paths.

### P1

- Add automated Electron startup smoke tests.
- Add Windows integration tests for `GetWindowDisplayAffinity`.
- Persist user settings safely.
- Add log rotation and size limits.
- Refactor `electron/main.ts` into focused modules.
- Add explicit download handling and browser permission UX where needed.

### P2

- Improve update status UI.
- Add release notes automation.
- Add dependency/security scanning.
- Add crash diagnostics suitable for production.

## Verification Rule

No feature is considered production-ready until:

```text
Source
  ↓
CI
  ↓
Windows build
  ↓
Fresh installation
  ↓
Runtime test
  ↓
Upgrade test
```

passes.

## Security Reference

The hardening follows Electron's security guidance: sandbox renderers, keep Node integration disabled for remote content, use context isolation, configure permission handlers, constrain navigation, validate IPC senders, and keep Electron current.
