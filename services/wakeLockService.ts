// Screen Wake Lock Service
// Prevents screen from dimming or going to sleep during active operations
// (file upload, parsing, MX validation, sorting, extracting)

export type WakeLockMode = 'auto' | 'always' | 'off';

export interface WakeLockState {
  isActive: boolean;
  mode: WakeLockMode;
  isSupported: boolean;
  activeReasons: string[];
}

type Subscriber = (state: WakeLockState) => void;

class WakeLockService {
  private sentinel: any = null;
  private activeReasons: Set<string> = new Set();
  private mode: WakeLockMode = 'auto';
  private subscribers: Set<Subscriber> = new Set();
  private isReacquiring: boolean = false;
  private fallbackIntervalId: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem('app_screen_wake_lock_mode') as WakeLockMode;
      if (savedMode && ['auto', 'always', 'off'].includes(savedMode)) {
        this.mode = savedMode;
      }

      // Re-acquire lock when tab regains visibility (browser automatically releases wake lock on tab hide)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.shouldBeActive()) {
          this.applyLock();
        }
      });

      // If initialized in 'always' mode, apply lock immediately
      if (this.mode === 'always') {
        this.applyLock();
      }
    }
  }

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  public getMode(): WakeLockMode {
    return this.mode;
  }

  public setMode(newMode: WakeLockMode, onToast?: (msg: string) => void) {
    this.mode = newMode;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('app_screen_wake_lock_mode', newMode);
    }

    if (newMode === 'off') {
      this.releasePhysicalLock();
      if (onToast) onToast("Screen Sleep: Standard power mode restored.");
    } else if (newMode === 'always') {
      this.applyLock();
      if (onToast) onToast("☀️ Screen Wake Lock: Display will remain awake continuously.");
    } else { // auto
      if (this.activeReasons.size > 0) {
        this.applyLock();
        if (onToast) onToast("Screen Wake Lock: Active while processing tasks.");
      } else {
        this.releasePhysicalLock();
        if (onToast) onToast("Screen Wake Lock: Auto-awake enabled (activates during file uploads & sorting).");
      }
    }

    this.notifySubscribers();
  }

  public getState(): WakeLockState {
    return {
      isActive: this.sentinel !== null || this.fallbackIntervalId !== null,
      mode: this.mode,
      isSupported: this.isSupported(),
      activeReasons: Array.from(this.activeReasons),
    };
  }

  public subscribe(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    cb(this.getState());
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private notifySubscribers() {
    const state = this.getState();
    this.subscribers.forEach(cb => {
      try {
        cb(state);
      } catch (e) {
        console.error("WakeLock subscription error:", e);
      }
    });
  }

  private shouldBeActive(): boolean {
    if (this.mode === 'off') return false;
    if (this.mode === 'always') return true;
    return this.activeReasons.size > 0;
  }

  public async acquireLock(reason: string, onToast?: (msg: string) => void): Promise<void> {
    const wasActive = this.shouldBeActive();
    this.activeReasons.add(reason);

    if (this.mode !== 'off' && (!wasActive || !this.sentinel)) {
      await this.applyLock();
      if (onToast && !wasActive) {
        onToast("☀️ Screen Wake Lock: Preventing screen sleep during active processing.");
      }
    }

    this.notifySubscribers();
  }

  public async releaseLock(reason: string): Promise<void> {
    this.activeReasons.delete(reason);

    if (!this.shouldBeActive()) {
      await this.releasePhysicalLock();
    }

    this.notifySubscribers();
  }

  private async applyLock(): Promise<void> {
    if (this.isReacquiring) return;
    this.isReacquiring = true;

    try {
      if (this.isSupported()) {
        if (!this.sentinel) {
          const wakeLock = (navigator as any).wakeLock;
          this.sentinel = await wakeLock.request('screen');
          
          this.sentinel.addEventListener('release', () => {
            this.sentinel = null;
            if (this.shouldBeActive() && document.visibilityState === 'visible') {
              this.applyLock();
            }
            this.notifySubscribers();
          });
        }
      } else {
        // Fallback for browsers without screen wake lock: tiny heartbeat activity
        if (!this.fallbackIntervalId && typeof window !== 'undefined') {
          this.fallbackIntervalId = window.setInterval(() => {
            // Keep event loop active
          }, 30000);
        }
      }
    } catch (err: any) {
      console.warn("[Screen Wake Lock] Request notice:", err?.message || err);
      // Fallback heartbeat if native request was denied by sandbox/battery saver
      if (!this.fallbackIntervalId && typeof window !== 'undefined') {
        this.fallbackIntervalId = window.setInterval(() => {}, 30000);
      }
    } finally {
      this.isReacquiring = false;
      this.notifySubscribers();
    }
  }

  private async releasePhysicalLock(): Promise<void> {
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch (e) {
        console.warn("[Screen Wake Lock] Release notice:", e);
      }
      this.sentinel = null;
    }

    if (this.fallbackIntervalId && typeof window !== 'undefined') {
      window.clearInterval(this.fallbackIntervalId);
      this.fallbackIntervalId = null;
    }
  }
}

export const wakeLockService = new WakeLockService();
