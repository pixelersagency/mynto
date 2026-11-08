import type { ApiError } from '@mynto/shared';
import type { ZodError } from 'zod';

import { ServiceError } from '../services/audits';

/** JSON helpers of the public API: every error is `{ error, message }`. */

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function apiJson(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

export function apiError(
  status: number,
  error: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  const body: ApiError = { error, message };
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function validationError(err: ZodError): Response {
  const first = err.issues[0];
  const where = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
  return apiError(400, 'invalid_request', `${where}${first?.message ?? 'Requête invalide.'}`);
}

export function serviceErrorResponse(err: unknown): Response {
  if (err instanceof ServiceError) return apiError(err.status, err.code, err.message);
  return apiError(500, 'internal', 'Erreur interne.');
}

/** Reads a JSON body (max 16 KB). Null when missing or not JSON. */
export async function readJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  const text = await req.text();
  if (text.length === 0) return {};
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
