# Overlay Monster

Protected AI browser workspace.

## Web preview

Vercel can host the React renderer. In a browser, the app runs in preview mode and uses an iframe browser surface where sites permit embedding.

## Desktop runtime

Electron adds the native browser surface using `WebContentsView`, content-protection controls, always-on-top control, and the global overlay shortcut.

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
