import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { OverlayState } from './types';

const fallbackState: OverlayState = {
  protectedMode: true,
  protectionStatus: 'pending',
  alwaysOnTop: true,
  visible: true,
  autoPasteEnabled: true,
};
const demoSites = ['https://example.com', 'https://developer.mozilla.org', 'https://react.dev'];
const downloadUrl = 'https://github.com/adityaztpl/Overlay-Monster/releases/latest/download/Overlay-Monster-Setup.exe';

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'https://chatgpt.com/';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isEmbeddableDemo(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'example.com' || hostname.endsWith('.example.com');
  } catch {
    return false;
  }
}

export default function App() {
  const [state, setState] = useState(fallbackState);
  const [url, setUrl] = useState('https://example.com');
  const [demoUrl, setDemoUrl] = useState('https://example.com');
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const native = Boolean(window.overlay && window.browser);
  const webPreviewBlocked = useMemo(() => !isEmbeddableDemo(demoUrl), [demoUrl]);

  useEffect(() => {
    if (!native) return;
    void window.overlay!.getState().then(setState);
    void window.browser!.getUrl().then((value) => value && setUrl(value));

    const removeStateListener = window.overlay!.onStateChanged(setState);
    let removeUpdateListener: (() => void) | undefined;
    if (window.appApi) {
      void window.appApi.getVersion().then(setAppVersion);
      removeUpdateListener = window.appApi.onUpdateStatus(({ status, version }) => {
        setUpdateStatus(version ? `${status}:${version}` : status);
      });
    }
    return () => {
      removeStateListener();
      removeUpdateListener?.();
    };
  }, [native]);

  useEffect(() => {
    if (!native) return;
    const removeUrlListener = window.browser!.onUrlChanged((value) => setUrl(value));
    return () => removeUrlListener();
  }, [native]);

  const navigate = async (event?: FormEvent) => {
    event?.preventDefault();
    const targetUrl = normalizeUrl(url);
    setUrl(targetUrl);
    if (native) setUrl(await window.browser!.navigate(targetUrl));
    else setDemoUrl(targetUrl);
  };

  const selectDemoSite = (site: string) => {
    setUrl(site);
    setDemoUrl(site);
  };

  const openInCurrentTab = () => window.location.assign(demoUrl);

  const setProtection = async (enabled: boolean) => {
    if (native) await window.overlay!.setProtection(enabled);
    setState((current) => ({ ...current, protectedMode: enabled, protectionStatus: enabled ? 'pending' : 'disabled' }));
    if (native) setState(await window.overlay!.getState());
  };

  const setTop = async (enabled: boolean) => {
    const value = native ? await window.overlay!.setAlwaysOnTop(enabled) : enabled;
    setState((current) => ({ ...current, alwaysOnTop: value }));
  };

  const setAutoPaste = async (enabled: boolean) => {
    const value = native ? await window.overlay!.setAutoPaste(enabled) : enabled;
    setState((current) => ({ ...current, autoPasteEnabled: value }));
  };

  const protectionLabel = state.protectionStatus === 'applied'
    ? 'Capture protected'
    : state.protectionStatus === 'disabled'
      ? 'Protection off'
      : state.protectionStatus === 'unsupported'
        ? 'Protection unsupported'
        : state.protectionStatus === 'error'
          ? 'Protection error'
          : 'Applying protection…';

  const updateLabel = updateStatus.startsWith('available') || updateStatus.startsWith('downloaded')
    ? 'Update ready'
    : updateStatus.startsWith('downloading')
      ? `Updating ${updateStatus.split(':')[1] ?? ''}%`
      : `v${appVersion}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◇</span>
          <div><strong>Overlay Monster</strong><small>Protected AI Browser</small></div>
        </div>

        <form className="address" onSubmit={navigate}>
          <button type="button" aria-label="Back" onClick={() => native && void window.browser!.back()}>‹</button>
          <button type="button" aria-label="Forward" onClick={() => native && void window.browser!.forward()}>›</button>
          <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Address" />
          <button type="button" aria-label="Reload" onClick={() => native ? void window.browser!.reload() : void navigate()}>↻</button>
        </form>

        {!native && <a className="download-button" href={downloadUrl}>Download for Windows ↓</a>}
        {native && <button className="version-button" type="button" onClick={() => void window.appApi?.checkForUpdates()}>{updateLabel}</button>}

        {native && (
          <div className="top-controls">
            <label className="control-chip" title="Exclude this window from supported Windows screen capture">
              <input type="checkbox" checked={state.protectedMode} onChange={(e) => void setProtection(e.target.checked)} />
              <span>🛡 {protectionLabel}</span>
            </label>
            <label className="control-chip" title="Paste new clipboard text or screenshots into ChatGPT when ChatGPT is open">
              <input type="checkbox" checked={state.autoPasteEnabled} onChange={(e) => void setAutoPaste(e.target.checked)} />
              <span>📋 Auto-paste</span>
            </label>
            <label className="control-chip" title="Keep Overlay Monster above other windows">
              <input type="checkbox" checked={state.alwaysOnTop} onChange={(e) => void setTop(e.target.checked)} />
              <span>📌 Top</span>
            </label>
          </div>
        )}
      </header>

      <section className="browser-panel">
        {!native && (
          <div className="web-preview">
            <div className="demo-tabs">
              {demoSites.map((site) => <button key={site} onClick={() => selectDemoSite(site)}>{new URL(site).hostname}</button>)}
            </div>
            {webPreviewBlocked ? (
              <div className="preview-fallback">
                <div className="preview-icon">↗</div>
                <h2>This site blocks iframe embedding</h2>
                <p>{demoUrl}</p>
                <span>Run the Electron build for the full native browser surface.</span>
                <button type="button" onClick={openInCurrentTab}>Open in current tab ↗</button>
              </div>
            ) : <iframe title="Browser preview" src={demoUrl} />}
          </div>
        )}
        {native && <div className="native-browser" aria-label="Native browser surface" />}
      </section>

      <footer className="statusbar">
        <span>Ctrl + Shift + Space <small>toggle overlay</small></span>
        <span>Clipboard stays local to this app</span>
        <span>Text + screenshots → ChatGPT composer</span>
      </footer>
    </main>
  );
}
