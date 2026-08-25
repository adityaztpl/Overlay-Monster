/// <reference types="vite/client" />

import type { OverlayAPI } from './types';

declare global {
  interface Window {
    overlay: OverlayAPI;
  }
}

export {};
