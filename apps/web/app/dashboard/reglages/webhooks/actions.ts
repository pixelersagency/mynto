'use server';

import {
  WEBHOOK_EVENT_TYPES,
  type ApiWebhookDelivery,
  type WebhookSubscribableEvent,
} from '@mynto/shared';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/admin';
import { requireAdminMutation } from '@/lib/auth/origin';
import { ServiceError } from '@/lib/services/audits';
import {
  createWebhook,
  deleteWebhook,
  getDelivery,
  resendDelivery,
  rotateWebhookSecret,
  testWebhook,
  updateWebhook,
} from '@/lib/services/webhooks';

/**
 * Mutations of Réglages > Webhooks. Each one checks the admin session and
 * the Origin first. The signing secret is returned once (creation,
 * regeneration) and never logged.
 */

export interface WebhookFormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
  /** Shown once, right after creation or regeneration. */
  secret?: string;
  id?: string;
}

const IdSchema = z.string().uuid();
const EVENTS = new Set<string>(WEBHOOK_EVENT_TYPES);

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ServiceError ? err.message : fallback;
}

function formEvents(form: FormData): WebhookSubscribableEvent[] {
  return form
    .getAll('events')
    .filter(
      (v): v is string => typeof v === 'string' && EVENTS.has(v),
    ) as WebhookSubscribableEvent[];
}

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v.trim() : '';
}

function validate(
  form: FormData,
  withUrl: boolean,
):
  | { ok: true; url: string; events: WebhookSubscribableEvent[]; description: string }
  | WebhookFormState {
  const fieldErrors: Record<string, string> = {};
  const url = text(form, 'url');
  const events = formEvents(form);
  const description = text(form, 'description');
  if (withUrl && url === '') fieldErrors.url = 'Indique l’adresse qui recevra les événements.';
  if (withUrl && url.length > 2048) fieldErrors.url = 'Adresse trop longue.';
  if (events.length === 0) fieldErrors.events = 'Choisis au moins un événement.';
  if (description.length > 120) fieldErrors.description = '120 caractères au plus.';
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: 'Corrige les champs signalés.', fieldErrors };
  }
  return { ok: true, url, events, description };
}

export async function createWebhookAction(
  _prev: WebhookFormState,
  form: FormData,
): Promise<WebhookFormState> {
  await requireAdminMutation();
  const v = validate(form, true);
  if (!('url' in v)) return v;
  try {
    const created = await createWebhook({
      url: v.url,
      events: v.events,
      ...(v.description !== '' ? { description: v.description } : {}),
    });
    revalidatePath('/dashboard/reglages/webhooks');
    return {
      ok: true,
      message: 'Webhook créé. Copie le secret maintenant : il ne sera plus affiché.',
      secret: created.secret,
      id: created.id,
    };
  } catch (err) {
    const message = errorMessage(err, 'Création impossible pour le moment.');
    if (err instanceof ServiceError && err.code === 'invalid_url') {
      return { ok: false, message: 'Corrige les champs signalés.', fieldErrors: { url: message } };
    }
    return { ok: false, message };
  }
}

export async function updateWebhookAction(
  _prev: WebhookFormState,
  form: FormData,
): Promise<WebhookFormState> {
  await requireAdminMutation();
  const id = IdSchema.safeParse(form.get('id'));
  if (!id.success) return { ok: false, message: 'Webhook inconnu.' };
  const managed = form.get('managed') === '1';
  const v = validate(form, !managed);
  if (!('url' in v)) return v;
  try {
    await updateWebhook(id.data, {
      ...(managed ? {} : { url: v.url }),
      events: v.events,
      description: v.description === '' ? null : v.description,
      active: form.get('active') === 'on',
      ...(form.has('legacy_present')
        ? { legacy_radar_format: form.get('legacy_radar_format') === 'on' }
        : {}),
    });
    revalidatePath('/dashboard/reglages/webhooks', 'layout');
    revalidatePath('/dashboard');
    return { ok: true, message: 'Webhook enregistré.' };
  } catch (err) {
    const message = errorMessage(err, 'Enregistrement impossible pour le moment.');
    if (err instanceof ServiceError && err.code === 'invalid_url') {
      return { ok: false, message: 'Corrige les champs signalés.', fieldErrors: { url: message } };
    }
    return { ok: false, message };
  }
}

export async function setWebhookActiveAction(
  id: string,
  active: boolean,
): Promise<WebhookFormState> {
  await requireAdminMutation();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Webhook inconnu.' };
  try {
    await updateWebhook(parsed.data, { active });
    revalidatePath('/dashboard/reglages/webhooks', 'layout');
    revalidatePath('/dashboard');
    return { ok: true, message: active ? 'Webhook activé.' : 'Webhook désactivé.' };
  } catch (err) {
    return { ok: false, message: errorMessage(err, 'Modification impossible pour le moment.') };
  }
}

export async function pingWebhookAction(id: string): Promise<WebhookFormState> {
  await requireAdminMutation();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Webhook inconnu.' };
  try {
    await testWebhook(parsed.data);
    revalidatePath(`/dashboard/reglages/webhooks/${parsed.data}`);
    return {
      ok: true,
      message: 'Ping envoyé. Le résultat arrive dans le journal d’ici quelques secondes.',
    };
  } catch (err) {
    return { ok: false, message: errorMessage(err, 'Envoi impossible pour le moment.') };
  }
}

export async function rotateSecretAction(id: string): Promise<WebhookFormState> {
  await requireAdminMutation();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Webhook inconnu.' };
  try {
    const res = await rotateWebhookSecret(parsed.data);
    revalidatePath(`/dashboard/reglages/webhooks/${parsed.data}`);
    return {
      ok: true,
      message: 'Nouveau secret créé. L’ancien ne fonctionne plus. Copie celui-ci maintenant.',
      secret: res.secret,
    };
  } catch (err) {
    return { ok: false, message: errorMessage(err, 'Régénération impossible pour le moment.') };
  }
}

export async function deleteWebhookAction(id: string): Promise<WebhookFormState> {
  await requireAdminMutation();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Webhook inconnu.' };
  try {
    await deleteWebhook(parsed.data);
    revalidatePath('/dashboard/reglages/webhooks', 'layout');
    return { ok: true, message: 'Webhook supprimé.' };
  } catch (err) {
    return { ok: false, message: errorMessage(err, 'Suppression impossible pour le moment.') };
  }
}

export async function resendDeliveryAction(
  webhookId: string,
  deliveryId: string,
): Promise<WebhookFormState> {
  await requireAdminMutation();
  const ids = z.object({ w: IdSchema, d: IdSchema }).safeParse({ w: webhookId, d: deliveryId });
  if (!ids.success) return { ok: false, message: 'Livraison inconnue.' };
  try {
    await resendDelivery(ids.data.w, ids.data.d);
    revalidatePath(`/dashboard/reglages/webhooks/${ids.data.w}`);
    return { ok: true, message: 'Renvoi programmé. Il part d’ici quelques secondes.' };
  } catch (err) {
    return { ok: false, message: errorMessage(err, 'Renvoi impossible pour le moment.') };
  }
}

/** Detail of one delivery for the drawer (read-only, admin session). */
export async function deliveryDetailAction(
  webhookId: string,
  deliveryId: string,
): Promise<ApiWebhookDelivery | null> {
  await requireAdmin();
  const ids = z.object({ w: IdSchema, d: IdSchema }).safeParse({ w: webhookId, d: deliveryId });
  if (!ids.success) return null;
  try {
    return await getDelivery(ids.data.w, ids.data.d);
  } catch {
    return null;
  }
}
