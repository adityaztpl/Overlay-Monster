# Overlay Monster

Protected AI browser workspace.

## Web preview

Vercel hosts the React renderer. Browser preview mode uses an iframe where sites permit embedding.

## Desktop runtime

Electron provides the native browser surface through `WebContentsView`, content protection, always-on-top control, and the global overlay shortcut.

## Commands

```bash
npm install
npm run dev
npm run build
npm run electron
```

## Architecture

- `src/` — React UI and web preview
- `electron/main.ts` — native window, browser surface, IPC, protection
- `electron/preload.ts` — isolated IPC bridge
