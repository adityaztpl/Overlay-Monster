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
