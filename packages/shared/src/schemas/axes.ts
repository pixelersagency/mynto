import { z } from 'zod';

export const AuditAxisSchema = z.enum([
  'ux',
  'ui',
  'seo_technique',
  'seo_contenu',
  'performance',
  'accessibilite',
  'conformite',
  'conversion',
]);
export type AuditAxis = z.infer<typeof AuditAxisSchema>;

/** Canonical axis order. */
export const ALL_AXES = [
  'seo_technique',
  'seo_contenu',
  'performance',
  'accessibilite',
  'conformite',
  'conversion',
  'ux',
  'ui',
] as const;
