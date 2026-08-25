import { useEffect, useState } from 'react';
import type { OverlayState } from './types';

const initialState: OverlayState = {
  protectedMode: true,
  alwaysOnTop: true,
  visible: true,
};

export default function App(): JSX.Element {
  const [state, setState] = useState<OverlayState>(initialState);

  useEffect(() => {
    void window.overlay.getState().then(setState);
    return window.overlay.onShortcutToggle(() => {
      setState((current) => ({ ...current, visible: !current.visible }));
    });
  }, []);

  const setProtection = async (enabled: boolean) => {
    const protectedMode = await window.overlay.setProtection(enabled);
    setState((current) => ({ ...current, protectedMode }));
  };

  const setAlwaysOnTop = async (enabled: boolean) => {
    const alwaysOnTop = await window.overlay.setAlwaysOnTop(enabled);
    setState((current) => ({ ...current, alwaysOnTop }));
  };

  return (
    <main className="shell">
      <section className="panel">
        <header className="header">
          <div>
            <span className="eyebrow">OVERLAY MONSTER</span>
            <h1>Protected AI Workspace</h1>
            <p>Secure Electron shell for AI-assisted browsing.</p>
          </div>
          <span className={`status ${state.protectedMode ? 'active' : ''}`}>
            {state.protectedMode ? 'PROTECTED' : 'UNPROTECTED'}
          </span>
        </header>

        <div className="workspace">
          <div className="workspace-card">
            <span className="orb">AI</span>
            <h2>Workspace ready</h2>
            <p>Browser surface and provider routing will plug into this shell.</p>
          </div>
        </div>

        <footer className="controls">
          <label className="control">
            <span>Content protection</span>
            <input
              type="checkbox"
              checked={state.protectedMode}
              onChange={(event) => void setProtection(event.target.checked)}
            />
          </label>
          <label className="control">
            <span>Always on top</span>
            <input
              type="checkbox"
              checked={state.alwaysOnTop}
              onChange={(event) => void setAlwaysOnTop(event.target.checked)}
            />
          </label>
          <kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Space</kbd>
          <span className="hint">toggle overlay</span>
        </footer>
      </section>
    </main>
  );
}
