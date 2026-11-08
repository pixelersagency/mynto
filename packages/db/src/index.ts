import { getSql, type Sql } from './client.js';
import { createAiRepo, type AiRepo } from './repos/ai.js';
import { createAnalyticsRepo, type AnalyticsRepo } from './repos/analytics.js';
import { createApiKeysRepo, type ApiKeysRepo } from './repos/api-keys.js';
import { createAuditsRepo, type AuditsRepo } from './repos/audits.js';
import { createDashboardRepo, type DashboardRepo } from './repos/dashboard.js';
import { createEmailRepo, type EmailRepo } from './repos/email.js';
import { createRadarRepo, type RadarRepo } from './repos/radar.js';
import { createReportsRepo, type ReportsRepo } from './repos/reports.js';
import {
  createAuditSettingsRepo,
  createSettingsRepo,
  type AuditSettingsRepo,
  type SettingsRepo,
} from './repos/settings.js';
import { createViewsRepo, type ViewsRepo } from './repos/views.js';
import { createWebhooksRepo, type WebhooksRepo } from './repos/webhooks.js';

export {
  closeSql,
  createSql,
  getSql,
  isUniqueViolation,
  jsonb,
  pgErrorCode,
  type Queryable,
  type Sql,
} from './client.js';
export {
  DbSchemaError,
  createAuditsRepo,
  type AuditInterpretRow,
  type AuditPatch,
  type AuditSource,
  type AuditsRepo,
  type AuditStateRow,
  type CreateAuditInput,
  type FindingRowInput,
  type LlmStatus,
  type PurgedAudit,
} from './repos/audits.js';
export {
  createRadarRepo,
  type InsertRadarViewInput,
  type RadarCacheCandidateRow,
  type RadarDetailRow,
  type RadarLinkRow,
  type RadarRepo,
  type RecordViewResult,
  type RefreshResult,
} from './repos/radar.js';
export {
  createDashboardRepo,
  type AuditDetailExtra,
  type AuditHistoryPoint,
  type AuditOpenRow,
  type AuditTopFinding,
  type DashboardAuditRef,
  type DashboardAuditRow,
  type HomeItem,
  type WeekStats,
  type DashboardCounts,
  type DashboardRefreshResult,
  type DashboardRepo,
  type DashboardSort,
  type DashboardStatusFilter,
  type DeletedAudit,
  type ListAuditsFilter,
  type TrackingLinkRow,
} from './repos/dashboard.js';
export {
  AgencySettingsInputSchema,
  FAVICON_KEY_PATTERN,
  LOGO_KEY_PATTERN,
  createAuditSettingsRepo,
  createSettingsRepo,
  type AuditSettingsRepo,
  type AgencySettingsInput,
  type AgencySettingsRow,
  type SettingsRepo,
} from './repos/settings.js';
export {
  DEFAULT_REPORT_SETTINGS,
  FONT_KEY_RE,
  TEMPLATE_ID_RE,
  createReportsRepo,
  type CustomTemplateRow,
  type ReportSettingsRow,
  type ReportsRepo,
  type TemplateStateRow,
} from './repos/reports.js';
export {
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_SUBJECT,
  SMTP_PASSWORD_AAD,
  SmtpSettingsInputSchema,
  createEmailRepo,
  fillEmailTemplate,
  type EmailRepo,
  type EmailSendRow,
  type SmtpSettingsInput,
  type SmtpSettingsPublic,
  type SmtpSettingsSecret,
} from './repos/email.js';
export {
  AUDIT_VIEWS_RETENTION_DAYS,
  createViewsRepo,
  type ViewsRepo,
  type InsertAuditViewInput,
} from './repos/views.js';
export {
  WEBHOOK_SECRET_PREFIX,
  createWebhooksRepo,
  emitAuditFinished,
  emitWebhookEvent,
  generateWebhookSecret,
  newWebhookEventId,
  webhookSecretAad,
  type AttemptOutcome,
  type AttemptResult,
  type ClaimedDelivery,
  type EmitInput,
  type WebhookAttemptRow,
  type WebhookDeliveryDetail,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
  type WebhooksRepo,
} from './repos/webhooks.js';
export {
  AI_PROVIDERS,
  AiModelsSchema,
  AiSettingsInputSchema,
  DEFAULT_AI_MODELS,
  VISION_PROVIDERS,
  createAiRepo,
  type AiKeyInfo,
  type AiModels,
  type AiProvider,
  type AiRepo,
  type AiSettingsInput,
  type AiSettingsRow,
  type VisionProvider,
} from './repos/ai.js';
export {
  API_KEY_PREFIX,
  ApiKeyNameSchema,
  createApiKeysRepo,
  generateApiKey,
  isApiKeyFormat,
  type ApiKeyRow,
  type ApiKeysRepo,
  type CreatedApiKey,
} from './repos/api-keys.js';
export {
  createAnalyticsRepo,
  type ActivityEvent,
  type AnalyticsRange,
  type AnalyticsRepo,
} from './repos/analytics.js';
export {
  loadStoredKeys,
  narrativeModelFor,
  resolveAiConfig,
  visionModelFor,
  type AiEnv,
  type EffectiveAiConfig,
  type EffectiveCall,
  type KeySource,
} from './ai-config.js';
export {
  DecryptionError,
  EncryptionKeyInvalidError,
  EncryptionKeyMissingError,
  decryptSecret,
  encryptSecret,
  hasValidMasterKey,
  maskSecret,
  parseMasterKey,
  sha256Hex,
} from './secrets.js';
export * from './public-columns.js';

export interface Repos {
  ai: AiRepo;
  analytics: AnalyticsRepo;
  apiKeys: ApiKeysRepo;
  auditSettings: AuditSettingsRepo;
  audits: AuditsRepo;
  dashboard: DashboardRepo;
  email: EmailRepo;
  radar: RadarRepo;
  reports: ReportsRepo;
  settings: SettingsRepo;
  views: ViewsRepo;
  webhooks: WebhooksRepo;
}

export function createRepos(sql: Sql): Repos {
  return {
    ai: createAiRepo(sql),
    analytics: createAnalyticsRepo(sql),
    apiKeys: createApiKeysRepo(sql),
    auditSettings: createAuditSettingsRepo(sql),
    audits: createAuditsRepo(sql),
    dashboard: createDashboardRepo(sql),
    email: createEmailRepo(sql),
    radar: createRadarRepo(sql),
    reports: createReportsRepo(sql),
    settings: createSettingsRepo(sql),
    views: createViewsRepo(sql),
    webhooks: createWebhooksRepo(sql),
  };
}

let shared: Repos | null = null;

/** Repositories bound to the shared DATABASE_URL client (created lazily). */
export function db(): Repos {
  shared ??= createRepos(getSql());
  return shared;
}

/** Health probe: SELECT 1. */
export async function ping(sql: Sql = getSql()): Promise<void> {
  await sql`select 1`;
}
