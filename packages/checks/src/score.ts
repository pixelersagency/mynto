import type { AuditAxis, AxisResult, CheckResult, CheckStatus } from './types.js';

/** Penalty per check status when rolling an axis up to a 0-100 score. */
const PENALTY: Record<CheckStatus, number> = {
  fail: 26,
  warn: 10,
  pass: 0,
  info: 0,
};

/**
 * Builds an AxisResult from a list of checks. Score starts at 100 and is
 * reduced by each non-passing check, floored at 0. Mirrors the "one bad
 * thing hurts" feel of the scanner's severity model, scaled to /100 for
 * a familiar reading.
 */
export function buildAxis(axis: AuditAxis, checks: CheckResult[]): AxisResult {
  let score = 100;
  for (const c of checks) score -= PENALTY[c.status];
  if (score < 0) score = 0;
  return { axis, score: Math.round(score), checks };
}

/** Convenience constructors keeping axis files terse. */
export function pass(
  id: string,
  label: string,
  detail: string,
  value?: string | number,
): CheckResult {
  return { id, label, status: 'pass', detail, value };
}
export function warn(
  id: string,
  label: string,
  detail: string,
  value?: string | number,
): CheckResult {
  return { id, label, status: 'warn', detail, value };
}
export function fail(
  id: string,
  label: string,
  detail: string,
  value?: string | number,
): CheckResult {
  return { id, label, status: 'fail', detail, value };
}
export function info(
  id: string,
  label: string,
  detail: string,
  value?: string | number,
): CheckResult {
  return { id, label, status: 'info', detail, value };
}

/** Picks pass/warn/fail by a boolean pair. */
export function verdict(
  id: string,
  label: string,
  ok: boolean,
  okDetail: string,
  koDetail: string,
  severity: 'warn' | 'fail' = 'fail',
  value?: string | number,
): CheckResult {
  return ok
    ? pass(id, label, okDetail, value)
    : { id, label, status: severity, detail: koDetail, value };
}
