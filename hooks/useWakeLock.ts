import { useState, useEffect } from 'react';
import { wakeLockService, type WakeLockState, type WakeLockMode } from '../services/wakeLockService';

/**
 * Hook to read and control global Screen Wake Lock status
 */
export function useWakeLock() {
  const [state, setState] = useState<WakeLockState>(() => wakeLockService.getState());

  useEffect(() => {
    return wakeLockService.subscribe(setState);
  }, []);

  const setMode = (mode: WakeLockMode, onToast?: (msg: string) => void) => {
    wakeLockService.setMode(mode, onToast);
  };

  return {
    ...state,
    setMode,
    acquireLock: (reason: string, onToast?: (msg: string) => void) => wakeLockService.acquireLock(reason, onToast),
    releaseLock: (reason: string) => wakeLockService.releaseLock(reason),
  };
}

/**
 * Component-level hook that automatically acquires a wake lock while an operation is active
 * (e.g. file uploading, sorting, validating, scraping) and automatically releases it on completion or unmount.
 */
export function useActiveWakeLock(
  isActive: boolean,
  reason: string,
  onToast?: (msg: string) => void
) {
  useEffect(() => {
    if (isActive) {
      wakeLockService.acquireLock(reason, onToast);
      return () => {
        wakeLockService.releaseLock(reason);
      };
    }
  }, [isActive, reason]);
}
