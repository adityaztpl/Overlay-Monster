export interface OverlayState {
  protectedMode: boolean;
  alwaysOnTop: boolean;
  visible: boolean;
}

export interface OverlayAPI {
  getState(): Promise<OverlayState>;
  setProtection(enabled: boolean): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  toggle(): Promise<boolean>;
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

declare global {
  interface Window {
    overlay?: OverlayAPI;
    browser?: BrowserAPI;
  }
}
