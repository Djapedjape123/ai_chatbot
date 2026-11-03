// Da li je uređaj telefon ili tablet (Faza 3.5): samo tada se prikazuje dugme za slikanje.
// Ovo je pravilo prikaza, NE bezbednosna provera: server ne zna uređaj i proverava svaku sliku isto.
// Laptop sa ekranom na dodir takođe dobija dugme (prihvaćeno u planu).
import { useSyncExternalStore } from 'react';

export type DeviceSignals = { coarsePointer: boolean; maxTouchPoints: number };

export function isTouchCameraDevice({ coarsePointer, maxTouchPoints }: DeviceSignals): boolean {
  return coarsePointer && maxTouchPoints > 0;
}

// Čita signale iz pregledača; na serveru (bez window) uvek false
export function detectTouchCameraDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return isTouchCameraDevice({
    coarsePointer: window.matchMedia('(any-pointer: coarse)').matches,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

// Hook za komponente: na serveru i pri hidrataciji false (isti HTML), pa odmah posle stvarna vrednost
const noSubscription = () => () => {};
export function useTouchCameraDevice(): boolean {
  return useSyncExternalStore(noSubscription, detectTouchCameraDevice, () => false);
}
