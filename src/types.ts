export type ProtectionStatus = 'pending' | 'applied' | 'disabled' | 'unsupported' | 'error';

export interface OverlayState {
  protectedMode: boolean;
  protectionStatus: ProtectionStatus;
  alwaysOnTop: boolean;
  visible: boolean;
}

export interface OverlayAPI {
  getState(): Promise<OverlayState>;
  setProtection(enabled: boolean): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  toggle(): Promise<boolean>;
  onStateChanged(callback: (state: OverlayState) => void): () => void;
  onShortcutToggle(callback: () => void): () => void;
}

export interface BrowserAPI {
  navigate(url: string): Promise<string>;
  back(): Promise<boolean>;
  forward(): Promise<boolean>;
  reload(): Promise<boolean>;
  getUrl(): Promise<string>;
  onUrlChanged(callback: (url: string) => void): () => void;
}

export interface AppAPI {
  getVersion(): Promise<string>;
  checkForUpdates(): Promise<{ status: string }>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(callback: (payload: { status: string; version?: string }) => void): () => void;
}

declare global {
  interface Window {
    overlay?: OverlayAPI;
    browser?: BrowserAPI;
    appApi?: AppAPI;
  }
}
