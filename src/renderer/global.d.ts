import type { OutpostBridge } from '../shared/contracts';

declare global {
  interface Window {
    outpost: OutpostBridge;
  }
}

export {};
