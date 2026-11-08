/**
 * Login throttle (in memory, per process): 5 failed attempts per IP per
 * 15 minutes, plus a global cap of 50 failures per 15 minutes so a
 * distributed guess run is slowed too. A success clears the IP's counter.
 * Single-instance install: an in-memory window is enough; a restart
 * resets it (acceptable, the hash is scrypt anyway).
 */

export const LOGIN_MAX_FAILURES_PER_IP = 5;
export const LOGIN_MAX_FAILURES_GLOBAL = 50;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface Window {
  failures: number[];
}

export class LoginThrottle {
  private readonly byIp = new Map<string, Window>();
  private global: number[] = [];

  constructor(
    private readonly perIp = LOGIN_MAX_FAILURES_PER_IP,
    private readonly globalMax = LOGIN_MAX_FAILURES_GLOBAL,
    private readonly windowMs = LOGIN_WINDOW_MS,
  ) {}

  private prune(list: number[], now: number): number[] {
    return list.filter((t) => now - t < this.windowMs);
  }

  /** Null when an attempt is allowed, otherwise seconds until the next one. */
  check(ip: string, now: number = Date.now()): number | null {
    this.global = this.prune(this.global, now);
    const w = this.byIp.get(ip);
    const list = w ? this.prune(w.failures, now) : [];
    if (w) w.failures = list;
    const blockedUntil: number[] = [];
    if (list.length >= this.perIp) blockedUntil.push((list[0] ?? now) + this.windowMs);
    if (this.global.length >= this.globalMax)
      blockedUntil.push((this.global[0] ?? now) + this.windowMs);
    if (blockedUntil.length === 0) return null;
    return Math.max(1, Math.ceil((Math.max(...blockedUntil) - now) / 1000));
  }

  recordFailure(ip: string, now: number = Date.now()): void {
    const w = this.byIp.get(ip) ?? { failures: [] };
    w.failures = [...this.prune(w.failures, now), now];
    this.byIp.set(ip, w);
    this.global = [...this.prune(this.global, now), now];
    if (this.byIp.size > 10_000) {
      for (const [k, v] of this.byIp)
        if (this.prune(v.failures, now).length === 0) this.byIp.delete(k);
    }
  }

  reset(ip: string): void {
    this.byIp.delete(ip);
  }
}

/** Process-wide instance used by the login action. */
export const loginThrottle = new LoginThrottle();
