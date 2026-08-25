# Development Learnings

This file records mistakes, fixes, and lessons learned while developing Overlay Monster.

## Rules

1. Read this file before changing the build, release, updater, or deployment system.
2. Add a short entry when a bug wastes development time or reveals an important constraint.
3. Record the root cause, fix, and prevention rule.
4. Do not delete old lessons unless they are proven obsolete.

## Electron Release and Auto-Update

### 2026-08-25 — Do not use `latest` for `electron-updater`

**Symptom**

`electron-builder` failed with:

```text
At least electron-updater 4.0.0 is recommended by current electron-builder version.
Please set electron-updater version to "^4.0.0".
Received "latest"
```

**Root cause**

`package.json` used:

```json
"electron-updater": "latest"
```

**Fix**

Use a compatible explicit range:

```json
"electron-updater": "^4.0.0"
```

**Prevention**

Do not use `latest` for tightly coupled Electron build/runtime packages. Pin a compatible semver range.

---

### 2026-08-25 — Release workflow version extraction must avoid PowerShell quoting traps

**Symptom**

GitHub Actions failed during `Read app version` with a Node `SyntaxError` caused by escaped quotes being passed incorrectly from PowerShell.

**Bad pattern**

```powershell
node -p \"require('./package.json').version\"
```

**Fix**

Use PowerShell JSON parsing:

```powershell
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
"version=$version" >> $env:GITHUB_OUTPUT
```

**Prevention**

Prefer native PowerShell parsing inside Windows Actions. Avoid nested shell quoting when reading JSON.

---

### 2026-08-25 — `setup-node` npm cache requires a lockfile

**Symptom**

GitHub Actions failed at `actions/setup-node` with:

```text
Dependencies lock file is not found
```

**Root cause**

The workflow enabled `cache: npm`, but the repository did not contain `package-lock.json`, `npm-shrinkwrap.json`, or `yarn.lock`.

**Fix**

Disable npm caching until a lockfile is committed, or commit a valid `package-lock.json` and use it consistently.

**Prevention**

Use a committed lockfile for reproducible builds. Do not enable package-manager caching without the required lockfile.

---

### 2026-08-25 — Release builds should not run on every source commit

**Problem**

The release workflow originally triggered on every push to `main`.

**Impact**

Normal source changes started Windows packaging and release jobs.

**Current approach**

Release automation should be separated from normal development. A release signal should be explicit, preferably a semantic version tag such as:

```text
v0.2.4
```

If a temporary `package.json` path trigger is used, only changes to the application version should trigger packaging.

**Prevention**

Keep release workflows separate from normal CI. Use version tags for production releases.

---

### 2026-08-25 — GitHub Releases need versioned tags for Electron auto-update

The Electron updater needs predictable release metadata such as `latest.yml` and versioned releases.

Preferred release flow:

```text
package.json version change
        ↓
semantic version tag: v0.2.4
        ↓
GitHub Actions
        ↓
electron-builder
        ↓
GitHub Release v0.2.4
        ↓
latest.yml + installer
        ↓
electron-updater
```

Do not rely on manually overwriting a permanent `latest` tag as the primary release mechanism.

---

## TypeScript / Build Scripts

### 2026-08-25 — Verify TypeScript config paths

**Symptom**

The `typecheck` script referenced:

```text
tsconfig.tsconfig.json
```

**Fix**

The correct project config is:

```text
tsconfig.json
```

**Prevention**

When changing npm scripts, verify every referenced file exists in the repository.

---

## Dependency Management

### General rule

Prefer reproducible dependency versions for build-critical packages:

- `electron`
- `electron-builder`
- `electron-updater`
- TypeScript
- Vite
- Node-related build tooling

Avoid blindly using `latest` when package compatibility matters.

## Release Checklist

Before creating a Windows release:

- [ ] `package.json` version is correct.
- [ ] `electron-updater` is compatible with `electron-builder`.
- [ ] TypeScript config paths are valid.
- [ ] Build scripts reference existing files.
- [ ] Dependencies install successfully.
- [ ] Electron build succeeds.
- [ ] NSIS installer is generated.
- [ ] `latest.yml` is generated.
- [ ] GitHub Release has the correct semantic version tag.
- [ ] Existing installed versions can discover the new release.
- [ ] Vercel download button points to the latest release installer.
