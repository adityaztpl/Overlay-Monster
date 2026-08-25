import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { OverlayState } from './types';

const fallbackState: OverlayState = { protectedMode: true, alwaysOnTop: true, visible: true };
const demoSites = ['https://example.com', 'https://developer.mozilla.org', 'https://react.dev'];
const downloadUrl = 'https://github.com/adityaztpl/Overlay-Monster/releases/latest/download/Overlay-Monster-Setup.exe';

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'https://example.com';
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

export default function App(): JSX.Element {
  const [state, setState] = useState(fallbackState);
  const [url, setUrl] = useState('https://example.com');
  const [demoUrl, setDemoUrl] = useState('https://example.com');
  const [aiPrompt, setAiPrompt] = useState('');
  const [answer, setAnswer] = useState('AI panel ready. Connect your provider API to stream responses.');
  const [appVersion, setAppVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState('');
  const native = Boolean(window.overlay && window.browser);
  const webPreviewBlocked = useMemo(() => !isEmbeddableDemo(demoUrl), [demoUrl]);

  useEffect(() => {
    if (!native) return;
    void window.overlay!.getState().then(setState);
    void window.browser!.getUrl().then((value) => value && setUrl(value));
    if (window.appApi) {
      void window.appApi.getVersion().then(setAppVersion);
      const removeUpdateListener = window.appApi.onUpdateStatus(({ status, version }) => {
        setUpdateStatus(version ? `${status}:${version}` : status);
      });
      return () => removeUpdateListener();
    }
    return undefined;
  }, [native]);

  useEffect(() => {
    if (!native) return;
    const removeShortcutListener = window.overlay!.onShortcutToggle(() =>
      setState((current) => ({ ...current, visible: !current.visible })),
    );
    const removeUrlListener = window.browser!.onUrlChanged((value) => setUrl(value));
    return () => {
      removeShortcutListener();
      removeUrlListener();
    };
  }, [native]);

  const navigate = async (event?: FormEvent) => {
    event?.preventDefault();
    const targetUrl = normalizeUrl(url);
    setUrl(targetUrl);

    if (native) {
      const target = await window.browser!.navigate(targetUrl);
      setUrl(target);
    } else {
      setDemoUrl(targetUrl);
    }
  };

  const selectDemoSite = (site: string) => {
    setUrl(site);
    setDemoUrl(site);
  };

  const openInCurrentTab = () => {
    window.location.assign(demoUrl);
  };

  const askAI = (event: FormEvent) => {
    event.preventDefault();
    if (!aiPrompt.trim()) return;
    setAnswer(`Ready for provider integration: “${aiPrompt.trim()}”`);
    setAiPrompt('');
  };

  const setProtection = async (enabled: boolean) => {
    const value = native ? await window.overlay!.setProtection(enabled) : enabled;
    setState((current) => ({ ...current, protectedMode: value }));
  };

  const setTop = async (enabled: boolean) => {
    const value = native ? await window.overlay!.setAlwaysOnTop(enabled) : enabled;
    setState((current) => ({ ...current, alwaysOnTop: value }));
  };

  const updateLabel = updateStatus.startsWith('available') || updateStatus.startsWith('downloaded')
    ? 'Update ready'
    : updateStatus.startsWith('downloading')
      ? `Updating ${updateStatus.split(':')[1] ?? ''}%`
      : `v${appVersion}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="logo">◈</span><div><strong>Overlay Monster</strong><small>Protected AI Browser</small></div></div>
        <form className="address" onSubmit={navigate}>
          <button type="button" onClick={() => native && void window.browser!.back()}>‹</button>
          <button type="button" onClick={() => native && void window.browser!.forward()}>›</button>
          <input value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Address" />
          <button type="button" onClick={() => native ? void window.browser!.reload() : void navigate()}>↻</button>
        </form>
        <a className="download-button" href={downloadUrl}>Download for Windows ↓</a>
        {native && <button className="version-button" type="button" onClick={() => void window.appApi?.checkForUpdates()}>{updateLabel}</button>}
        <div className="security"><span className="dot" /> {state.protectedMode ? 'Protected' : 'Protection off'}</div>
      </header>

      <section className="layout">
        <aside className="ai-panel">
          <div className="panel-head"><div><span className="eyebrow">AI ASSISTANT</span><h1>Meeting Copilot</h1></div><span className="live">LIVE</span></div>
          <div className="context-card"><span>◉</span><div><strong>Browser context</strong><small>Ready to analyze the current page</small></div></div>
          <div className="answer"><span className="ai-mark">AI</span><p>{answer}</p></div>
          <div className="quick-actions">
            {['Summarize page', 'Extract key points', 'Explain this'].map((item) => <button key={item} onClick={() => setAnswer(`${item}: waiting for AI provider connection.`)}>{item}</button>)}
          </div>
          <form className="prompt" onSubmit={askAI}><textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Ask AI anything..." /><button type="submit">Send ↗</button></form>
          <div className="toggles">
            <label><span>Content protection</span><input type="checkbox" checked={state.protectedMode} onChange={(e) => void setProtection(e.target.checked)} /></label>
            <label><span>Always on top</span><input type="checkbox" checked={state.alwaysOnTop} onChange={(e) => void setTop(e.target.checked)} /></label>
          </div>
          <div className="shortcut"><kbd>Ctrl</kbd><b>+</b><kbd>Shift</kbd><b>+</b><kbd>Space</kbd><span>toggle overlay</span></div>
        </aside>

        <section className="browser-panel">
          {!native && (
            <div className="web-preview">
              <div className="demo-tabs">
                {demoSites.map((site) => (
                  <button key={site} onClick={() => selectDemoSite(site)}>{new URL(site).hostname}</button>
                ))}
              </div>

              {webPreviewBlocked ? (
                <div className="preview-fallback">
                  <div className="preview-icon">↗</div>
                  <h2>This site blocks iframe embedding</h2>
                  <p>{demoUrl}</p>
                  <span>Browser security headers such as CSP or X-Frame-Options prevent a normal web app from rendering this site inside an iframe.</span>
                  <button type="button" onClick={openInCurrentTab}>Open in current tab ↗</button>
                  <small>For the full in-app browser surface, run the Electron build. It uses WebContentsView and loads the site directly.</small>
                </div>
              ) : (
                <iframe title="Browser preview" src={demoUrl} />
              )}
            </div>
          )}
          {native && <div className="native-browser"><div className="browser-note">Native Electron browser surface is active → {url}</div></div>}
        </section>
      </section>
    </main>
  );
}
