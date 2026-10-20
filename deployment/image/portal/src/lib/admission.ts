/**
 * Admission control for AI turns (architecture v0.3 A12). Open WebUI and the model provider only serve so many turns at once; past
 * that, everyone slows down and some turns fail (load probe, spikes/s0/LOAD.md). So Digi lets a limited number run, holds the rest in a
 * short queue, and tells people plainly when it is busy instead of letting requests time out.
 *
 * Limits are per portal instance: overall, per tenant (so one university cannot starve another) and per person. The queue is fair:
 * when a slot frees, the first waiter that is allowed in goes, so one person at their own limit never blocks others.
 * Env: ADMISSION_GLOBAL, ADMISSION_PER_TENANT, ADMISSION_PER_USER, ADMISSION_QUEUE_MAX, ADMISSION_WAIT_MS.
 */
export class BusyError extends Error {
  constructor(readonly reason: "queue_full" | "wait_timeout") { super("busy"); }
}

type Limits = { global: number; perTenant: number; perUser: number; queueMax: number; waitMs: number };
type Waiter = { tenant: string; user: string; admit: (release: () => void) => void; fail: (e: Error) => void; timer: ReturnType<typeof setTimeout>; onPosition?: (n: number) => void };

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
export const limitsFromEnv = (): Limits => ({
  global: num(process.env.ADMISSION_GLOBAL, 12),
  perTenant: num(process.env.ADMISSION_PER_TENANT, 40),
  perUser: num(process.env.ADMISSION_PER_USER, 2),
  queueMax: num(process.env.ADMISSION_QUEUE_MAX, 200),
  waitMs: num(process.env.ADMISSION_WAIT_MS, 30_000),
});

export class Admission {
  private running = 0;
  private byTenant = new Map<string, number>();
  private byUser = new Map<string, number>();
  private queue: Waiter[] = [];

  constructor(private limits: Limits) {}

  stats() { return { running: this.running, queued: this.queue.length, limits: this.limits }; }

  private allowed(tenant: string, user: string) {
    return this.running < this.limits.global && (this.byTenant.get(tenant) ?? 0) < this.limits.perTenant && (this.byUser.get(user) ?? 0) < this.limits.perUser;
  }

  private take(tenant: string, user: string): () => void {
    this.running++;
    this.byTenant.set(tenant, (this.byTenant.get(tenant) ?? 0) + 1);
    this.byUser.set(user, (this.byUser.get(user) ?? 0) + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.running--;
      for (const [m, k] of [[this.byTenant, tenant], [this.byUser, user]] as const) {
        const n = (m.get(k) ?? 1) - 1;
        if (n <= 0) m.delete(k); else m.set(k, n);
      }
      this.drain();
    };
  }

  private drain() {
    for (let i = 0; i < this.queue.length; ) {
      const w = this.queue[i]!;
      if (this.allowed(w.tenant, w.user)) {
        this.queue.splice(i, 1);
        clearTimeout(w.timer);
        w.admit(this.take(w.tenant, w.user));
        this.positions();
      } else i++;
    }
  }

  private positions() { this.queue.forEach((w, i) => w.onPosition?.(i + 1)); }

  /** Resolves with a release function. Rejects with BusyError if the queue is full or the wait runs out, or AbortError if cancelled. */
  acquire(tenant: string, user: string, opts: { signal?: AbortSignal; onPosition?: (n: number) => void } = {}): Promise<() => void> {
    if (this.allowed(tenant, user)) return Promise.resolve(this.take(tenant, user));
    if (this.queue.length >= this.limits.queueMax) return Promise.reject(new BusyError("queue_full"));
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        tenant, user, onPosition: opts.onPosition,
        admit: resolve, fail: reject,
        timer: setTimeout(() => { this.remove(w); reject(new BusyError("wait_timeout")); }, this.limits.waitMs),
      };
      opts.signal?.addEventListener("abort", () => { this.remove(w); clearTimeout(w.timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      this.queue.push(w);
      opts.onPosition?.(this.queue.length);
    });
  }

  private remove(w: Waiter) {
    const i = this.queue.indexOf(w);
    if (i >= 0) { this.queue.splice(i, 1); this.positions(); }
  }
}

const g = globalThis as { __admission?: Admission };
export const admission = (): Admission => (g.__admission ??= new Admission(limitsFromEnv()));
