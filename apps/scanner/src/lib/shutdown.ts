/**
 * Graceful shutdown with a hard deadline.
 *
 * On SIGTERM / SIGINT the steps run in order (stop accepting HTTP, close the
 * BullMQ workers, close Postgres, close Redis). Each step may hang: BullMQ
 * waits for Redis forever when it is unreachable, and a worker waits for its
 * running audit. So a timer is armed first and forces the exit when the
 * deadline passes, whatever the steps are doing. `docker compose stop`
 * sends SIGKILL after its grace period; exiting on our own just before is
 * cleaner (logs flushed, exit code 1 tells what happened).
 *
 * An audit cut by the deadline is not lost: its BullMQ lock expires and the
 * job is picked up again as "stalled" at the next start.
 *
 * A second signal during the shutdown exits at once (Ctrl+C twice).
 */

export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown>;
}

export interface ShutdownLogger {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface ShutdownOptions {
  steps: ShutdownStep[];
  /** Hard deadline, in ms, after the first signal. */
  timeoutMs: number;
  logger: ShutdownLogger;
  exit?: (code: number) => void;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (t: unknown) => void;
}

export type ShutdownHandler = (signal: string) => Promise<void>;

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8_000;

export function createShutdownHandler(opts: ShutdownOptions): ShutdownHandler {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const setTimer =
    opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as { unref?: () => void });
  const clearTimer =
    opts.clearTimer ??
    ((t: unknown) => {
      clearTimeout(t as NodeJS.Timeout);
    });
  let started = false;
  let done = false;

  const finish = (code: number): void => {
    if (done) return;
    done = true;
    exit(code);
  };

  return async (signal: string) => {
    if (started) {
      opts.logger.warn({ signal }, 'shutdown_forced_by_second_signal');
      finish(1);
      return;
    }
    started = true;
    opts.logger.info({ signal, timeoutMs: opts.timeoutMs }, 'shutdown_requested');

    const timer = setTimer(() => {
      opts.logger.error({ timeoutMs: opts.timeoutMs }, 'shutdown_timeout_forced_exit');
      finish(1);
    }, opts.timeoutMs);
    // Never keep the process alive just for this timer.
    timer.unref?.();

    let failed = false;
    for (const step of opts.steps) {
      if (done) return;
      try {
        await step.run();
      } catch (err) {
        failed = true;
        opts.logger.error(
          { step: step.name, err: err instanceof Error ? err.message : 'unknown' },
          'shutdown_step_failed',
        );
      }
    }
    clearTimer(timer);
    if (!done) opts.logger.info({ failed }, 'shutdown_complete');
    finish(failed ? 1 : 0);
  };
}
