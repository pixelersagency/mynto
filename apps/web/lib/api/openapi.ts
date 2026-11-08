import {
  AI_CHECK_IDS,
  AI_SITE_TYPE_INPUTS,
  ALL_AXES,
  WEBHOOK_API_VERSION,
  WEBHOOK_EVENT_TYPES,
} from '@mynto/shared';

/**
 * OpenAPI 3.1 description of the REST API v1. Hand-written (no generator
 * dependency) and kept next to the routes; the docs page of the dashboard
 * renders this same object, so the two never drift.
 */

type Json = Record<string, unknown>;

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const errorResponse = (description: string): Json => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

const json = (schema: Json, description: string): Json => ({
  description,
  content: { 'application/json': { schema } },
});

const idParam: Json = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Audit id (UUID). An id replaced by a refresh resolves to the current scan.',
  schema: { type: 'string', format: 'uuid' },
};

const templateIdParam: Json = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Template id (lowercase letters, digits, dashes).',
  schema: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,39}$' },
};

const webhookIdParam: Json = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Webhook id (UUID).',
  schema: { type: 'string', format: 'uuid' },
};

const deliveryIdParam: Json = {
  name: 'deliveryId',
  in: 'path',
  required: true,
  description: 'Delivery id (UUID), also sent as X-Mynto-Delivery.',
  schema: { type: 'string', format: 'uuid' },
};

const COMMON_ERRORS: Json = {
  '401': errorResponse('Missing, invalid or revoked API key.'),
  '429': errorResponse('Rate limit of the key reached (see Retry-After).'),
};

const axesSchema: Json = {
  type: 'array',
  items: { type: 'string', enum: [...ALL_AXES] },
  minItems: 1,
  maxItems: ALL_AXES.length,
  uniqueItems: true,
};

export function openApiDocument(baseUrl: string): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: 'mynto API',
      version: '1.0.0',
      description:
        'REST API of a self-hosted mynto install: create website audits, read their results and the tracking links, and get analytics. ' +
        'Authenticate with an API key created in Réglages > API et MCP: `Authorization: Bearer myn_live_...`. ' +
        'Errors are JSON `{ "error": code, "message": text }`. The contact email and the LLM inputs are never returned.',
    },
    servers: [{ url: `${baseUrl.replace(/\/+$/, '')}/api/v1` }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/audits': {
        get: {
          operationId: 'listAudits',
          summary: 'List audits',
          description: 'Current audits (refreshed scans are replaced), newest first.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['in_progress', 'completed', 'failed', 'expired'] },
            },
            {
              name: 'q',
              in: 'query',
              description: 'Search on URL or label.',
              schema: { type: 'string', maxLength: 200 },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            '200': json(ref('AuditList'), 'A page of audits.'),
            '400': errorResponse('Invalid query.'),
            ...COMMON_ERRORS,
          },
        },
        post: {
          operationId: 'createAudit',
          summary: 'Create an audit',
          description:
            'Queues an audit. It takes 2 to 5 minutes: poll GET /audits/{id} until status is completed or failed. ' +
            '`modules` overrides the install defaults (Réglages > Modules d’audit). ' +
            'Set `modules.ai_readiness` to true to run the Préparation IA tests, and `site_type` to pick the site type (auto by default).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('CreateAudit') } },
          },
          responses: {
            '202': json(ref('Audit'), 'Audit queued.'),
            '400': errorResponse('Invalid body, invalid or private URL (unsafe_url).'),
            '503': errorResponse('Scanner or queue unavailable.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/audits/{id}': {
        parameters: [idParam],
        get: {
          operationId: 'getAudit',
          summary: 'Get an audit',
          responses: {
            '200': json(ref('Audit'), 'The audit.'),
            '404': errorResponse('Unknown audit.'),
            ...COMMON_ERRORS,
          },
        },
        delete: {
          operationId: 'deleteAudit',
          summary: 'Delete an audit',
          description:
            'Erases the report, its older scans, its tracking links and screenshots. Links already sent stop working.',
          responses: {
            '200': json(
              {
                type: 'object',
                properties: { deleted: { type: 'integer' } },
                required: ['deleted'],
              },
              'Number of scans deleted.',
            ),
            '404': errorResponse('Unknown audit.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/audits/{id}/refresh': {
        parameters: [idParam],
        post: {
          operationId: 'refreshAudit',
          summary: 'Re-run an audit',
          description:
            'New scan with the same modules. The report URL and tracking link keep working and show the new scan. ' +
            'Answers 200 with refreshed=false while a scan is already running.',
          responses: {
            '202': json(ref('RefreshResult'), 'New scan queued.'),
            '200': json(ref('RefreshResult'), 'Nothing done (reason given).'),
            '404': errorResponse('Unknown audit.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/audits/{id}/findings': {
        parameters: [idParam],
        get: {
          operationId: 'getFindings',
          summary: 'Findings of an audit',
          responses: {
            '200': json(
              {
                type: 'object',
                properties: { data: { type: 'array', items: ref('Finding') } },
                required: ['data'],
              },
              'Findings, P0 first.',
            ),
            '404': errorResponse('Unknown audit.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/templates': {
        get: {
          operationId: 'listTemplates',
          summary: 'List report templates',
          description: 'Built-in templates (standard, compact, commercial) and the agency ones.',
          responses: {
            '200': json(
              {
                type: 'object',
                properties: { data: { type: 'array', items: ref('TemplateSummary') } },
              },
              'Templates.',
            ),
            ...COMMON_ERRORS,
          },
        },
      },
      '/templates/{id}': {
        get: {
          operationId: 'getTemplate',
          summary: 'Get a template (manifest, files, settings)',
          parameters: [templateIdParam],
          responses: {
            '200': json(ref('Template'), 'Template.'),
            '404': errorResponse('Unknown template.'),
            ...COMMON_ERRORS,
          },
        },
        put: {
          operationId: 'saveTemplate',
          summary: 'Create or replace an agency template',
          description:
            'Saved only when it passes the check (files, manifest, no script or remote resource, render in web and print modes, accessibility lint). Built-in ids are refused.',
          parameters: [templateIdParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['files'],
                  properties: {
                    files: { type: 'object', additionalProperties: { type: 'string' } },
                    preview_png_base64: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': json(ref('TemplateSaveResult'), 'Replaced.'),
            '201': json(ref('TemplateSaveResult'), 'Created.'),
            '422': json(ref('TemplateSaveResult'), 'Refused by the check: see issues.'),
            '409': errorResponse('Built-in template id.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/templates/{id}/preview': {
        post: {
          operationId: 'previewTemplate',
          summary: 'Render a template as an HTML document',
          description:
            'On a completed audit (audit_id) or the example audit. Draft files can be passed without saving.',
          parameters: [templateIdParam],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    audit_id: { type: 'string', format: 'uuid' },
                    mode: { type: 'string', enum: ['web', 'print'] },
                    settings: { type: 'object' },
                    files: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            '200': json(
              {
                type: 'object',
                properties: {
                  html: { type: 'string' },
                  issues: { type: 'array', items: ref('TemplateIssue') },
                },
              },
              'Rendered document.',
            ),
            '422': errorResponse('The draft does not render.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/report-data/schema': {
        get: {
          operationId: 'getReportDataSchema',
          summary: 'JSON Schema of the report-data v1 contract, with example data',
          responses: {
            '200': json(
              {
                type: 'object',
                properties: { schema: { type: 'object' }, example: { type: 'object' } },
              },
              'Schema and example.',
            ),
            ...COMMON_ERRORS,
          },
        },
      },
      '/webhooks': {
        get: {
          operationId: 'listWebhooks',
          summary: 'List webhooks',
          description: 'Outgoing webhook endpoints of the install. Secrets are never returned.',
          responses: {
            '200': json(
              { type: 'object', properties: { data: { type: 'array', items: ref('Webhook') } } },
              'Endpoints.',
            ),
            ...COMMON_ERRORS,
          },
        },
        post: {
          operationId: 'createWebhook',
          summary: 'Create a webhook',
          description:
            'Registers an HTTPS URL that receives a signed POST for every chosen event. The signing secret is in this answer only: store it. ' +
            'Every request carries `X-Mynto-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, `X-Mynto-Event` and `X-Mynto-Delivery`. ' +
            'Private, loopback and link-local targets (and plain http) are refused unless the install sets WEBHOOKS_ALLOW_PRIVATE=1.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('CreateWebhook') } },
          },
          responses: {
            '201': json(ref('WebhookWithSecret'), 'Endpoint created, secret shown once.'),
            '400': errorResponse('Invalid body or refused URL (invalid_url).'),
            '503': errorResponse('APP_ENCRYPTION_KEY missing (encryption_key_missing).'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/webhooks/{id}': {
        parameters: [webhookIdParam],
        get: {
          operationId: 'getWebhook',
          summary: 'Get a webhook',
          responses: {
            '200': json(ref('Webhook'), 'The endpoint.'),
            '404': errorResponse('Unknown webhook.'),
            ...COMMON_ERRORS,
          },
        },
        patch: {
          operationId: 'updateWebhook',
          summary: 'Update a webhook',
          description:
            'Changes the URL, events, description, active flag or the legacy Radar format. Turning an endpoint back on clears its failure streak. ' +
            'The URL of the endpoint managed by the environment (Radar) cannot be changed here (409 managed_by_env).',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('UpdateWebhook') } },
          },
          responses: {
            '200': json(ref('Webhook'), 'Updated endpoint.'),
            '400': errorResponse('Invalid body or refused URL.'),
            '404': errorResponse('Unknown webhook.'),
            '409': errorResponse('Managed by the environment.'),
            ...COMMON_ERRORS,
          },
        },
        delete: {
          operationId: 'deleteWebhook',
          summary: 'Delete a webhook',
          description:
            'Deletes the endpoint and its delivery log. The Radar endpoint is removed by unsetting RADAR_WEBHOOK_URL.',
          responses: {
            '200': json(
              { type: 'object', properties: { deleted: { type: 'boolean' } } },
              'Deleted.',
            ),
            '404': errorResponse('Unknown webhook.'),
            '409': errorResponse('Managed by the environment.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/webhooks/{id}/test': {
        parameters: [webhookIdParam],
        post: {
          operationId: 'testWebhook',
          summary: 'Send a ping',
          description:
            'Queues a `ping` event for this endpoint only, delivered within a few seconds (even when the endpoint is off). Read the result in the deliveries.',
          responses: {
            '202': json(
              {
                type: 'object',
                properties: { event_id: { type: 'string' }, status: { const: 'queued' } },
              },
              'Ping queued.',
            ),
            '404': errorResponse('Unknown webhook.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/webhooks/{id}/rotate-secret': {
        parameters: [webhookIdParam],
        post: {
          operationId: 'rotateWebhookSecret',
          summary: 'Regenerate the signing secret',
          description: 'The new secret is returned once and replaces the old one immediately.',
          responses: {
            '200': json(ref('WebhookWithSecret'), 'New secret.'),
            '404': errorResponse('Unknown webhook.'),
            '409': errorResponse('Managed by the environment.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/webhooks/{id}/deliveries': {
        parameters: [webhookIdParam],
        get: {
          operationId: 'listWebhookDeliveries',
          summary: 'Delivery log',
          description: 'Deliveries of the last 30 days, newest first.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['pending', 'success', 'failed'] },
            },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
            },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
          ],
          responses: {
            '200': json(
              {
                type: 'object',
                properties: {
                  data: { type: 'array', items: ref('WebhookDelivery') },
                  pagination: { type: 'object' },
                },
              },
              'A page of deliveries.',
            ),
            '404': errorResponse('Unknown webhook.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/webhooks/{id}/deliveries/{deliveryId}': {
        parameters: [webhookIdParam, deliveryIdParam],
        get: {
          operationId: 'getWebhookDelivery',
          summary: 'Delivery detail',
          description:
            'Body sent and every attempt (status code, duration, first 2 KB of the answer).',
          responses: {
            '200': json(ref('WebhookDelivery'), 'The delivery.'),
            '404': errorResponse('Unknown delivery.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/webhooks/{id}/deliveries/{deliveryId}/resend': {
        parameters: [webhookIdParam, deliveryIdParam],
        post: {
          operationId: 'resendWebhookDelivery',
          summary: 'Resend a delivery',
          description:
            'Sends the same event again (same body, same event id) under a new delivery id.',
          responses: {
            '202': json(
              { type: 'object', properties: { delivery_id: { type: 'string', format: 'uuid' } } },
              'Queued.',
            ),
            '404': errorResponse('Unknown delivery.'),
            ...COMMON_ERRORS,
          },
        },
      },
      '/analytics/summary': {
        get: {
          operationId: 'getAnalyticsSummary',
          summary: 'Analytics summary',
          parameters: [
            {
              name: 'days',
              in: 'query',
              schema: { type: 'integer', enum: [7, 30, 90], default: 30 },
            },
          ],
          responses: {
            '200': json(ref('AnalyticsSummary'), 'Aggregates over the period.'),
            '400': errorResponse('Invalid period.'),
            ...COMMON_ERRORS,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'API key myn_live_...' },
      },
      schemas: {
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string' },
            description: { type: ['string', 'null'] },
            events: { type: 'array', items: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] } },
            active: { type: 'boolean' },
            legacy_radar_format: {
              type: 'boolean',
              description: 'link.opened is sent in the historical Radar "audit_viewed" format.',
            },
            managed_by_env: {
              type: 'boolean',
              description: 'URL and secret come from RADAR_WEBHOOK_URL / RADAR_WEBHOOK_SECRET.',
            },
            secret_hint: { type: ['string', 'null'] },
            consecutive_failures: { type: 'integer' },
            disabled_at: { type: ['string', 'null'], format: 'date-time' },
            disabled_reason: { type: ['string', 'null'], enum: ['auto', 'env_removed', null] },
            last_status: { type: ['string', 'null'], enum: ['success', 'failed', null] },
            last_status_code: { type: ['integer', 'null'] },
            last_delivery_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        WebhookWithSecret: {
          allOf: [
            ref('Webhook'),
            {
              type: 'object',
              properties: {
                secret: { type: 'string', description: 'whsec_..., returned once.' },
              },
              required: ['secret'],
            },
          ],
        },
        CreateWebhook: {
          type: 'object',
          additionalProperties: false,
          required: ['url', 'events'],
          properties: {
            url: { type: 'string', maxLength: 2048, description: 'HTTPS URL.' },
            events: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] },
            },
            description: { type: 'string', maxLength: 120 },
            active: { type: 'boolean', default: true },
          },
        },
        UpdateWebhook: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', maxLength: 2048 },
            events: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES] },
            },
            description: { type: ['string', 'null'], maxLength: 120 },
            active: { type: 'boolean' },
            legacy_radar_format: { type: 'boolean' },
          },
        },
        WebhookDelivery: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            endpoint_id: { type: 'string', format: 'uuid' },
            event_id: {
              type: 'string',
              description: 'evt_..., stable across attempts and resends.',
            },
            event_type: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES, 'ping'] },
            format: { type: 'string', enum: ['standard', 'legacy_radar'] },
            status: { type: 'string', enum: ['pending', 'success', 'failed'] },
            attempts: { type: 'integer', maximum: 6 },
            next_attempt_at: { type: ['string', 'null'], format: 'date-time' },
            last_status_code: { type: ['integer', 'null'] },
            last_duration_ms: { type: ['integer', 'null'] },
            last_error: { type: ['string', 'null'] },
            manual: { type: 'boolean', description: 'Created by a resend.' },
            created_at: { type: 'string', format: 'date-time' },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
            request_body: { type: 'string', description: 'Detail only: the exact body sent.' },
            attempts_log: {
              type: 'array',
              description: 'Detail only.',
              items: {
                type: 'object',
                properties: {
                  attempt: { type: 'integer' },
                  status_code: { type: ['integer', 'null'] },
                  error: { type: ['string', 'null'] },
                  duration_ms: { type: 'integer' },
                  response_body: { type: ['string', 'null'], maxLength: 2048 },
                  created_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        WebhookPayload: {
          type: 'object',
          description: `Body POSTed to the endpoints (api_version ${WEBHOOK_API_VERSION}). See docs/webhooks.md for every event.`,
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: [...WEBHOOK_EVENT_TYPES, 'ping'] },
            created_at: { type: 'string', format: 'date-time' },
            api_version: { const: WEBHOOK_API_VERSION },
            data: { type: 'object' },
          },
        },
        TemplateSummary: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            version: { type: 'string' },
            builtin: { type: 'boolean' },
            enabled: { type: 'boolean' },
            is_default: { type: 'boolean' },
            based_on: { type: ['string', 'null'] },
          },
        },
        Template: {
          allOf: [
            ref('TemplateSummary'),
            {
              type: 'object',
              properties: {
                manifest: { type: 'object' },
                files: { type: 'object', additionalProperties: { type: 'string' } },
                settings: { type: 'object' },
                has_preview: { type: 'boolean' },
              },
            },
          ],
        },
        TemplateIssue: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['error', 'warning'] },
            file: { type: ['string', 'null'] },
            message: { type: 'string' },
          },
        },
        TemplateSaveResult: {
          type: 'object',
          properties: {
            saved: { type: 'boolean' },
            created: { type: 'boolean' },
            issues: { type: 'array', items: ref('TemplateIssue') },
          },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' }, message: { type: 'string' } },
          required: ['error', 'message'],
        },
        Modules: {
          type: 'object',
          properties: {
            axes: axesSchema,
            lighthouse: { type: 'boolean' },
            vision: { type: 'boolean' },
            hero: { type: 'boolean' },
            narrative: { type: 'boolean' },
            ai_readiness: {
              type: 'boolean',
              description: 'Préparation IA module (24 tests on AI agents). Off by default.',
            },
            site_type: { type: 'string', enum: [...AI_SITE_TYPE_INPUTS] },
            ai_in_global_score: {
              type: 'boolean',
              description: 'Install setting: the AI readiness score counts in the global score.',
            },
          },
          required: ['axes', 'lighthouse', 'vision', 'hero', 'narrative'],
        },
        CreateAudit: {
          type: 'object',
          additionalProperties: false,
          properties: {
            url: { type: 'string', maxLength: 2048, examples: ['https://example.com'] },
            label: { type: 'string', minLength: 1, maxLength: 120 },
            modules: {
              type: 'object',
              additionalProperties: false,
              description: 'Partial override, merged over the install defaults.',
              properties: {
                axes: axesSchema,
                lighthouse: { type: 'boolean' },
                vision: { type: 'boolean' },
                hero: { type: 'boolean' },
                narrative: { type: 'boolean' },
                ai_readiness: { type: 'boolean' },
                site_type: { type: 'string', enum: [...AI_SITE_TYPE_INPUTS] },
              },
            },
            site_type: {
              type: 'string',
              enum: [...AI_SITE_TYPE_INPUTS],
              description:
                'Site type of the Préparation IA tests (shortcut for modules.site_type). auto = detected from the home page; a vitrine is not tested on API or commerce standards.',
            },
            template: {
              type: 'string',
              pattern: '^[a-z][a-z0-9-]{1,39}$',
              description: 'Report template id (see GET /templates). Omit for the install default.',
            },
          },
          required: ['url'],
        },
        AiCheck: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: [...AI_CHECK_IDS] },
            rule_code: { type: 'string', examples: ['ia.llms_txt'] },
            label: { type: 'string' },
            category: {
              type: 'string',
              enum: [
                'discoverability',
                'content_accessibility',
                'bot_access',
                'protocol_discovery',
                'commerce',
              ],
            },
            status: { type: 'string', enum: ['pass', 'fail', 'neutral', 'skipped'] },
            applicable: { type: 'boolean' },
            message: { type: 'string' },
            fix: { type: ['string', 'null'] },
          },
          required: [
            'id',
            'rule_code',
            'label',
            'category',
            'status',
            'applicable',
            'message',
            'fix',
          ],
        },
        AiReadiness: {
          type: 'object',
          description:
            'Préparation IA (optional module). Separate score, not in `score` unless included_in_global_score.',
          properties: {
            evaluated: { type: 'boolean', description: 'False = module off ("Non évalué").' },
            score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
            level: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
            level_name: { type: ['string', 'null'] },
            site_type: {
              type: ['string', 'null'],
              enum: ['vitrine', 'contenu', 'app_api', 'ecommerce', null],
            },
            site_type_auto: { type: ['boolean', 'null'] },
            included_in_global_score: { type: 'boolean' },
            checks: {
              type: 'array',
              items: ref('AiCheck'),
              description: 'Per-test results, on GET /audits/{id} only.',
            },
          },
          required: [
            'evaluated',
            'score',
            'level',
            'level_name',
            'site_type',
            'site_type_auto',
            'included_in_global_score',
          ],
        },
        AxisResult: {
          type: 'object',
          properties: {
            axis: { type: 'string', enum: [...ALL_AXES] },
            evaluated: {
              type: 'boolean',
              description: 'False = disabled for this audit ("Non évalué").',
            },
            score: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
            band: { type: ['string', 'null'] },
          },
          required: ['axis', 'evaluated', 'score', 'band'],
        },
        Audit: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string' },
            label: { type: ['string', 'null'] },
            status: {
              type: 'string',
              enum: ['queued', 'running', 'completed', 'failed', 'expired'],
            },
            source: { type: 'string', enum: ['dashboard', 'radar', 'api', 'mcp', 'web'] },
            score: {
              type: ['integer', 'null'],
              description: '0-100, weighted over the evaluated axes only.',
            },
            band: { type: ['string', 'null'] },
            axes: { type: 'array', items: ref('AxisResult') },
            modules: ref('Modules'),
            ai_readiness: ref('AiReadiness'),
            created_at: { type: 'string', format: 'date-time' },
            scanned_at: { type: ['string', 'null'], format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' },
            report_url: {
              type: 'string',
              description: 'Direct report URL (not counted as an opening).',
            },
            tracking_url: {
              type: ['string', 'null'],
              description: 'Link to send to the prospect: its openings are counted.',
            },
            template: {
              type: ['string', 'null'],
              description: 'Report template of the audit (null = install default).',
            },
            views_count: { type: 'integer' },
            last_viewed_at: { type: ['string', 'null'], format: 'date-time' },
            pages: { type: ['integer', 'null'] },
          },
          required: [
            'id',
            'url',
            'label',
            'status',
            'source',
            'score',
            'band',
            'axes',
            'modules',
            'ai_readiness',
            'created_at',
            'scanned_at',
            'expires_at',
            'report_url',
            'tracking_url',
            'template',
            'views_count',
            'last_viewed_at',
            'pages',
          ],
        },
        AuditList: {
          type: 'object',
          properties: {
            data: { type: 'array', items: ref('Audit') },
            pagination: {
              type: 'object',
              properties: {
                limit: { type: 'integer' },
                offset: { type: 'integer' },
                total: { type: 'integer' },
              },
              required: ['limit', 'offset', 'total'],
            },
          },
          required: ['data', 'pagination'],
        },
        RefreshResult: {
          type: 'object',
          properties: {
            audit: ref('Audit'),
            refreshed: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['audit', 'refreshed'],
        },
        Finding: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            rule_code: { type: 'string' },
            axis: {
              type: 'string',
              enum: [...ALL_AXES, 'ia'],
              description: '`ia` = failed Préparation IA test (rule_code `ia.<test>`).',
            },
            severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
            effort: { type: ['string', 'null'] },
            title: { type: 'string' },
            affected_urls: { type: 'array', items: { type: 'string' } },
            recommendation: { type: ['string', 'null'] },
          },
          required: [
            'id',
            'rule_code',
            'axis',
            'severity',
            'effort',
            'title',
            'affected_urls',
            'recommendation',
          ],
        },
        AnalyticsSummary: {
          type: 'object',
          description: 'Aggregates over [from, to). Disabled axes are excluded from the averages.',
          properties: {
            period_days: { type: 'integer' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
            audits: { type: 'object' },
            weekly: { type: 'array', items: { type: 'object' } },
            average_score: { type: ['number', 'null'] },
            axes: { type: 'array', items: { type: 'object' } },
            score_bands: { type: 'array', items: { type: 'object' } },
            links: { type: 'object' },
            sources: { type: 'array', items: { type: 'object' } },
            top_findings: { type: 'array', items: { type: 'object' } },
            llm: { type: 'object' },
            ai_readiness: {
              type: 'object',
              description:
                'Préparation IA: audits evaluated, average score, count under 50, most failed tests.',
            },
          },
        },
      },
    },
  };
}

export interface DocOperation {
  method: string;
  path: string;
  summary: string;
  description: string | null;
}

/** Flat list of the operations, for the dashboard reference page. */
export function listOperations(doc: Json): DocOperation[] {
  const out: DocOperation[] = [];
  const paths = doc.paths as Record<string, Record<string, unknown>>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = item[method] as { summary?: string; description?: string } | undefined;
      if (op) {
        out.push({
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? '',
          description: op.description ?? null,
        });
      }
    }
  }
  return out;
}
