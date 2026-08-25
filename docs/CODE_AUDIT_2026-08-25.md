# Overlay Monster — End-to-End Code Audit

**Audit date:** 2026-08-25  
**Repository:** `adityaztpl/Overlay-Monster`  
**Branch audited:** `main`  
**Current application version:** `0.2.8`  
**Latest observed release:** `v0.2.8`  
**Latest observed successful Windows workflow:** run #55

## Executive Summary

The repository has a working Electron + React + Vite foundation and the Windows packaging pipeline currently produces a successful release. The latest observed release is `v0.2.8` and contains both `Overlay-Monster-Setup.exe` and `latest.yml`.

The project is **not production-ready yet** for a security-sensitive overlay browser. The highest-priority work is:

1. Fix the release trigger/versioning model.
2. Make dependency installation reproducible.
3. Remove `latest` dependency versions from build-critical packages.
4. Harden Electron renderer/browser security settings.
5. Define the exact screen-capture protection guarantee and test it on supported Windows capture paths.
6. Add automated tests for protection, startup, updater, and browser lifecycle.
7. Add CI separate from release packaging.

## Scorecard

| Area | Score | Status |
|---|---:|---|
| Architecture | 7/10 | Good foundation |
| Electron security | 5/10 | Needs hardening |
| Screen-capture protection | 6/10 | Implemented but limited |
| UI / renderer | 7/10 | Functional architecture |
| Browser surface | 6/10 | Functional, needs policy controls |
| Auto-update | 6/10 | Working pipeline, needs safer release model |
| CI/CD | 5/10 | Builds work, release trigger is wrong |
| Dependency management | 3/10 | Reproducibility is weak |
| Error handling / diagnostics | 7/10 | Stronger than initial implementation |
| Testing | 2/10 | No meaningful automated test suite |
| Documentation | 7/10 | Learning/release docs now exist |
| **Overall** | **5.5/10** | **Prototype / active development** |

---

# 1. Architecture Audit

## Current structure

```text
React UI
   ↓ contextBridge
preload.ts
   ↓ IPC
Electron main.ts
   ├── BrowserWindow
   ├── WebContentsView
   ├── screen-capture protection
   ├── clipboard monitor
   ├── global shortcut
   └── electron-updater

Vite
   ├── web build → dist
   └── Electron build → dist/renderer

Electron Builder
   ↓
NSIS installer
   ↓
GitHub Release
```

### Good

- Clear separation between React renderer and Electron main process.
- `contextBridge` is used instead of exposing raw `ipcRenderer`.
- `contextIsolation` is enabled.
- Browser navigation is routed through IPC.
- Startup logging and uncaught-error logging were added.
- Renderer failure and browser render-process failure are logged.

### Concern

`main.ts` has grown into a large multi-responsibility module. It currently handles:

- window lifecycle
- browser lifecycle
- protection
- updater
- clipboard monitoring
- ChatGPT DOM interaction
- global shortcuts
- startup diagnostics
- IPC

This increases regression risk.

### Recommendation

Split into modules:

```text
electron/
  main.ts
  window.ts
  browser.ts
  protection.ts
  updater.ts
  clipboard.ts
  ipc.ts
  diagnostics.ts
```

Priority: **Medium**.

---

# 2. Screen-Capture Protection / “Stealth” Audit

## Current implementation

The app calls Electron `setContentProtection()` and then verifies the Windows display-affinity value using `GetWindowDisplayAffinity`.

The implementation checks for:

```text
WDA_EXCLUDEFROMCAPTURE = 0x11
```

The app now applies protection during startup and reports:

```text
pending
applied
disabled
unsupported
error
```

This is a major improvement over simply assuming protection worked.

## Important limitation

This is **capture exclusion**, not universal invisibility.

It cannot guarantee that every meeting application, recorder, driver, virtual display, or capture path will honor Windows capture exclusion.

The product UI must not claim universal “invisible to all screen sharing” behavior.

## Current gaps

### High

- No automated Windows integration test verifies the actual behavior against supported capture APIs.
- No user-facing explanation of supported vs unsupported capture paths.
- `skipTaskbar` is enabled, but taskbar hiding is not equivalent to complete window exclusion from every window switcher or operating-system UI.
- No product-level definition of what “stealth” guarantees.

### Medium

- Global shortcut registration result is not checked. A shortcut conflict can silently disable the toggle shortcut.
- Protection state is runtime-only. Settings reset after restart.

### Recommendation

Define the feature as:

> Windows screen-capture exclusion for supported capture paths.

Add a Windows test matrix covering:

- Electron capture
- supported Windows capture APIs
- common meeting-app sharing paths
- window capture vs display capture

Do not attempt to bypass security software or system monitoring. That is outside the legitimate capture-protection feature.

Priority: **Critical** for product correctness.

---

# 3. Electron Security Audit

## Good

Main renderer uses:

```text
contextIsolation: true
nodeIntegration: false
```

The preload exposes narrow APIs through `contextBridge`.

## High-risk improvement

The `BrowserWindow` and `WebContentsView` currently use:

```text
sandbox: false
```

The browser view is designed to load arbitrary websites. This increases the attack surface.

### Recommendation

Enable Chromium sandboxing where compatible with the application architecture:

```ts
sandbox: true
```

Then test clipboard, ChatGPT interaction, navigation, and updater UI.

Priority: **High**.

## Browser navigation policy

The browser accepts arbitrary HTTP/HTTPS URLs and redirects popup requests into the same view.

Missing controls include:

- permission request policy
- download policy
- notification policy
- popup policy beyond the current redirect
- navigation allow/deny policy
- certificate error policy
- protocol-handler policy

For a general-purpose browser this can be intentional. For a controlled overlay browser, explicit policies are safer.

Priority: **High**.

---

# 4. IPC Audit

## Good

The preload API is reasonably narrow:

```text
overlay
browser
appApi
```

The renderer cannot directly access Node APIs.

## Concern

IPC inputs are lightly validated.

For example, browser navigation receives a renderer-provided URL and passes it into `loadURL()` after basic normalization.

### Recommendation

Validate IPC arguments centrally:

```text
URL → valid http/https URL
boolean → strict boolean
```

Reject unsupported protocols.

Priority: **Medium**.

---

# 5. Clipboard / Auto-Paste Audit

## Current behavior

The main process polls the system clipboard every **750 ms**.

It hashes text/image content and, when ChatGPT is open, attempts to focus the ChatGPT composer and paste the new clipboard content.

## Good

- Clipboard content is not sent to an external service by this code.
- Duplicate clipboard content is avoided using hashes.
- Auto-paste can be disabled.
- Copy operations are given a short ignore window.

## Risks / gaps

### High

Automatic clipboard monitoring is privacy-sensitive.

A user can copy unrelated sensitive content while ChatGPT is open. The application may attempt to paste it into the composer.

### Medium

ChatGPT DOM selectors are brittle:

```text
[data-testid="prompt-textarea"]
#prompt-textarea
contenteditable selectors
textarea placeholder selectors
```

ChatGPT UI changes can break auto-paste.

### Medium

The 750 ms polling interval is simple but inefficient compared with event-driven clipboard detection where available.

### Recommendation

Add:

- explicit “Auto-paste” confirmation/education
- a visible activity indicator
- stronger URL/origin checks
- configurable polling interval
- tests for text and image clipboard flows
- safe failure when the composer cannot be identified

Priority: **High**.

---

# 6. Renderer / UI Audit

## Good

- React state maps to native Electron state.
- Native and Vercel/web preview modes are separated.
- Update state is surfaced in the UI.
- Protection state is surfaced.
- Download button uses the latest GitHub release endpoint.
- Responsive CSS exists.

## Issue

The renderer has a web preview fallback and native browser surface, which is useful for Vercel, but this creates two distinct runtime experiences.

The web version cannot provide native Electron capabilities. This distinction should be explicit in the UI and documentation.

## Earlier packaged-renderer bug

The Electron build required a relative Vite base because the renderer is loaded using `file://` through `loadFile()`.

Current `vite.config.ts` correctly uses:

```ts
base: mode === 'electron' ? './' : '/'
```

This fix should remain covered by a packaging smoke test.

Priority: **Medium**.

---

# 7. Auto-Update Audit

## Current status

The latest successful release is `v0.2.8`.

It contains:

```text
Overlay-Monster-Setup.exe
latest.yml
```

The release workflow completed successfully in the latest observed run.

## Good

- `electron-updater` is present.
- Automatic download is enabled.
- Downgrades are disabled.
- Prereleases are disabled.
- Update errors are logged.
- `latest.yml` is published.
- Versioned GitHub releases are created.

## Critical workflow problem

The release workflow still triggers on source changes:

```yaml
push:
  branches:
    - main
  paths:
    - package.json
    - electron/**
    - src/**
    - index.html
    - vite.config.ts
    - tsconfig.json
    - tsconfig.electron.json
    - .github/workflows/release.yml
```

This means a normal source commit can create a production release.

The release version comes from `package.json`, so a source commit that does not change the version can attempt to publish the same version again.

### Recommendation

Use semantic version tags as the release trigger:

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
  workflow_dispatch:
```

Validate that the tag version equals `package.json.version` before packaging.

Priority: **Critical**.

---

# 8. Dependency Management Audit

## Critical issue

`package.json` uses `latest` for multiple build-critical dependencies:

```text
react
react-dom
@types/node
@types/react
@types/react-dom
@vitejs/plugin-react
electron
 electron-builder
typescript
vite
```

Only `electron-updater` has an explicit range.

This makes builds non-reproducible. A future dependency release can break the installer without any source-code change.

## Lockfile

The workflow uses `npm install` and deliberately disables npm caching because the repository previously lacked a lockfile.

The correct long-term solution is:

```text
package.json
package-lock.json
```

Then use:

```bash
npm ci
```

in CI.

Priority: **Critical**.

---

# 9. Build Audit

## Current build chain

```text
npm run build
  ├── npm run build:web
  └── npm run build:electron
```

Electron Builder then packages:

```text
release/Overlay-Monster-Setup.exe
```

## Good

- Separate web and Electron modes.
- Electron TypeScript compilation is separate.
- NSIS target is configured.
- Installer naming is stable.

## Risk

The build depends on multiple `latest` packages and has no lockfile.

This is the largest build reproducibility weakness.

Priority: **High**.

---

# 10. CI/CD Audit

## Current state

The latest observed Windows workflow is successful.

There is no clear separate CI workflow for:

- typecheck
- web build
- Electron build
- tests

The release workflow is currently doing both validation and production packaging.

### Recommended pipeline

```text
Pull Request
   ↓
CI
 ├── npm ci
 ├── typecheck
 ├── web build
 ├── Electron build
 └── tests

Merge to main
   ↓
No release

v0.2.9 tag
   ↓
Release workflow
 ├── npm ci
 ├── tests
 ├── build
 ├── package
 └── GitHub Release
```

Priority: **High**.

---

# 11. Error Handling / Diagnostics

This area is stronger than the original implementation.

Current diagnostics include:

- startup log file
- uncaught exception logging
- unhandled rejection logging
- renderer load failure logging
- renderer process crash logging
- browser process crash logging
- protection verification logging
- updater error logging
- clipboard error logging

## Improvement

Add structured log levels and rotation. `startup.log` can grow indefinitely.

Priority: **Low/Medium**.

---

# 12. Testing Audit

## Current state

No meaningful automated test suite is present.

This is the largest quality gap after dependency management.

## Required tests

### Unit tests

- URL normalization
- protection state transitions
- update state transitions
- clipboard signature generation

### Electron integration tests

- packaged renderer starts
- browser view starts
- navigation works
- protection is applied
- protection status is reported
- global shortcut works
- hide/show works
- updater detects a newer release

### Windows smoke test

```text
Install v0.2.8
        ↓
Start app
        ↓
Verify React UI
        ↓
Verify browser surface
        ↓
Verify protection status
        ↓
Verify updater
```

Priority: **Critical**.

---

# 13. Vercel Audit

`vercel.json` correctly runs:

```text
npm run build:web
```

and deploys `dist`.

The Vercel/web runtime is intentionally not a native Electron runtime.

The download button points at the latest GitHub release installer.

## Recommendation

Expose the current release version on the web landing page from a trusted release source instead of hard-coding UI text.

Priority: **Low/Medium**.

---

# 14. Priority Backlog

## P0 — Fix before calling this production-ready

- [ ] Change release workflow to semantic-version tag trigger.
- [ ] Require tag version == `package.json.version`.
- [ ] Add `package-lock.json`.
- [ ] Replace build-critical `latest` dependencies with explicit versions/ranges.
- [ ] Add automated Electron startup smoke test.
- [ ] Add Windows capture-protection integration test.

## P1

- [ ] Harden Electron sandbox configuration.
- [ ] Add browser permission/download/navigation policies.
- [ ] Add CI workflow separate from release workflow.
- [ ] Add unit/integration tests.
- [ ] Refactor `main.ts` into focused modules.
- [ ] Improve clipboard privacy controls.
- [ ] Verify global shortcut registration.

## P2

- [ ] Persist user settings.
- [ ] Add structured/rotating logs.
- [ ] Improve updater UI and error messages.
- [ ] Expose current release version on Vercel dynamically.
- [ ] Add product telemetry only if explicitly designed and privacy-reviewed.

---

# 15. Recommended Target Architecture

```text
                    ┌────────────────────┐
                    │      React UI      │
                    └─────────┬──────────┘
                              │ contextBridge
                    ┌─────────▼──────────┐
                    │      preload      │
                    └─────────┬──────────┘
                              │ IPC
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
┌──────▼──────┐       ┌───────▼───────┐      ┌──────▼──────┐
│ window.ts   │       │  browser.ts   │      │ updater.ts  │
└─────────────┘       └───────────────┘      └─────────────┘
       │                      │                      │
┌──────▼──────┐       ┌───────▼───────┐      ┌──────▼──────┐
│protection.ts│       │ clipboard.ts  │      │ GitHub      │
└─────────────┘       └───────────────┘      │ Releases    │
                                             └─────────────┘
```

This makes the high-risk native features independently testable.

---

# 16. Final Assessment

Overlay Monster is a **functional prototype with a working Windows packaging/release path**, not yet a hardened production desktop application.

The latest build pipeline is healthy, but the process is too permissive and non-reproducible. The most important technical change is to separate **CI from release**, use **version tags**, and introduce a **lockfile with pinned build dependencies**.

The screen-capture feature is implemented as Windows capture exclusion, with native verification. It should not be marketed as universal invisibility because capture technologies can differ.

The next engineering phase should focus on **P0 items first**, then security hardening and automated Windows testing.
