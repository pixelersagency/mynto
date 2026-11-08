import type { AiCheckId, AiCheckResult } from '@mynto/shared';

import { probe, probeFirstOk, type ProbeResult } from '../probe.js';
import { buildCheck, notApplicable, probeEvidence, type AiAuditContext } from '../types.js';

/**
 * Protocol discovery: what an agent can *do* with the site once it can
 * read it. All of these are well-known documents, so each check is a
 * short list of candidate paths plus a shape assertion on the JSON.
 */
export async function runProtocolChecks(ctx: AiAuditContext): Promise<AiCheckResult[]> {
  const [mcp, a2a, skills, apiCatalog, oauth, oauthResource, authMd, ard] = await Promise.all([
    checkWellKnownJson(ctx, {
      id: 'mcp_server_card',
      paths: [
        '/.well-known/mcp/server-card.json',
        '/.well-known/mcp/server-cards.json',
        '/.well-known/mcp.json',
      ],
      requiredKeys: ['name', 'version', 'url', 'transport', 'endpoints', 'servers'],
      successMessage: 'Fiche de serveur MCP publiée : les agents voient tes outils.',
      failMessage: 'Pas de fiche de serveur MCP.',
      specUrls: ['https://modelcontextprotocol.io/'],
      fixPrompt: [
        'Publie une fiche de serveur MCP à l’adresse /.well-known/mcp/server-card.json',
        'avec le nom, la version, l’adresse et le transport de ton serveur MCP.',
        'Si tu n’as pas encore de serveur MCP, commence par y proposer tes 2 ou 3 actions principales.',
      ].join(' '),
    }),
    checkWellKnownJson(ctx, {
      id: 'a2a_agent_card',
      paths: ['/.well-known/agent-card.json', '/.well-known/agent.json'],
      requiredKeys: ['name', 'url', 'skills', 'capabilities'],
      successMessage: 'Fiche d’agent A2A publiée.',
      failMessage: 'Pas de fiche d’agent A2A.',
      specUrls: ['https://a2a-protocol.org/'],
      fixPrompt: [
        'Publie une fiche d’agent A2A à l’adresse /.well-known/agent-card.json',
        'avec le nom de ton agent, son adresse, ce qu’il sait faire et ses compétences,',
        'pour que les autres agents sachent quoi lui confier.',
      ].join(' '),
    }),
    checkWellKnownJson(ctx, {
      id: 'agent_skills',
      paths: ['/.well-known/agent-skills/index.json', '/.well-known/skills/index.json'],
      requiredKeys: ['skills', 'items', 'name'],
      successMessage: 'Index Agent Skills publié.',
      failMessage: 'Pas d’index Agent Skills.',
      specUrls: ['https://agentskills.io/home'],
      fixPrompt: [
        'Publie un index Agent Skills à l’adresse /.well-known/agent-skills/index.json',
        'avec les compétences que tu mets à disposition des agents,',
        'chacune avec son nom, sa description et l’adresse de son fichier SKILL.md.',
      ].join(' '),
    }),
    checkApiCatalog(ctx),
    checkWellKnownJson(ctx, {
      id: 'oauth_discovery',
      paths: ['/.well-known/openid-configuration', '/.well-known/oauth-authorization-server'],
      requiredKeys: ['issuer', 'authorization_endpoint', 'token_endpoint'],
      successMessage: 'Description OAuth ou OpenID Connect publiée.',
      failMessage: 'Pas de description OAuth ni OpenID Connect.',
      specUrls: ['https://www.rfc-editor.org/rfc/rfc8414.html'],
      fixPrompt: [
        'Publie la description de ton serveur d’autorisation à l’adresse',
        '/.well-known/oauth-authorization-server (ou /.well-known/openid-configuration)',
        'avec les champs issuer, authorization_endpoint, token_endpoint et scopes_supported.',
      ].join(' '),
    }),
    checkOauthProtectedResource(ctx),
    checkAuthMd(ctx),
    checkWellKnownJson(ctx, {
      id: 'ard_manifest',
      paths: ['/.well-known/ai-catalog.json', '/.well-known/ard.json'],
      requiredKeys: ['resources', 'catalog', 'name'],
      successMessage: 'Manifeste ARD publié.',
      failMessage: 'Pas de manifeste ARD (Agentic Resource Discovery).',
      specUrls: ['https://agenticresourcediscovery.org/'],
      fixPrompt: [
        'Publie un manifeste ARD à l’adresse /.well-known/ai-catalog.json',
        'avec les ressources qu’un agent peut utiliser (points d’accès, documentation, flux),',
        'chacune avec son type, son adresse et une courte description.',
      ].join(' '),
    }),
  ]);

  return [mcp, a2a, skills, checkWebMcp(ctx), apiCatalog, oauth, oauthResource, authMd, ard];
}

interface WellKnownSpec {
  id: AiCheckId;
  paths: string[];
  /** The document counts as valid if it carries at least one of these keys. */
  requiredKeys: string[];
  successMessage: string;
  failMessage: string;
  specUrls: string[];
  fixPrompt: string;
}

/**
 * Shared shape for every well-known JSON document. A 200 that returns the
 * SPA's HTML shell (very common on catch-all routers) must not read as a
 * pass, hence the JSON parse plus the key assertion.
 */
async function checkWellKnownJson(
  ctx: AiAuditContext,
  spec: WellKnownSpec,
): Promise<AiCheckResult> {
  if (!ctx.applies(spec.id)) return notApplicable(spec.id, spec.specUrls);

  const tried = await probeFirstOk(
    spec.paths.map((p) => `${ctx.origin}${p}`),
    { accept: 'application/json,*/*' },
  );
  const evidence = tried.map((r) => probeEvidence('GET', r));
  const valid = tried.find((r) => hasAnyKey(r, spec.requiredKeys));

  if (!valid) {
    const respondingButWrong = tried.some((r) => r.ok);
    return buildCheck({
      id: spec.id,
      status: 'fail',
      message: respondingButWrong
        ? `${spec.failMessage} Un document répond mais n’a pas la forme attendue.`
        : spec.failMessage,
      evidence,
      specUrls: spec.specUrls,
      fixPrompt: spec.fixPrompt,
    });
  }

  return buildCheck({
    id: spec.id,
    status: 'pass',
    message: spec.successMessage,
    evidence,
    specUrls: spec.specUrls,
  });
}

async function checkApiCatalog(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://www.rfc-editor.org/rfc/rfc9727.html'];
  if (!ctx.applies('api_catalog')) return notApplicable('api_catalog', specUrls);
  const res = await probe(`${ctx.origin}/.well-known/api-catalog`, {
    accept: 'application/linkset+json,application/json,*/*',
  });

  const valid = res.ok && !res.contentType.includes('html') && /linkset|"href"/i.test(res.body);
  if (!valid) {
    return buildCheck({
      id: 'api_catalog',
      status: 'fail',
      message: 'Pas de catalogue d’API.',
      evidence: [probeEvidence('GET /.well-known/api-catalog', res)],
      specUrls,
      fixPrompt: [
        'Publie un catalogue d’API à l’adresse /.well-known/api-catalog, au format linkset JSON (RFC 9727),',
        'avec un lien rel="service-desc" vers chacune de tes descriptions OpenAPI.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'api_catalog',
    status: 'pass',
    message: 'Catalogue d’API publié.',
    evidence: [probeEvidence('GET /.well-known/api-catalog', res)],
    specUrls,
  });
}

/**
 * RFC 9728 can be advertised two ways: the well-known document, or a
 * `WWW-Authenticate` header carrying `resource_metadata` on a 401. Both
 * count.
 */
async function checkOauthProtectedResource(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://www.rfc-editor.org/rfc/rfc9728.html'];
  if (!ctx.applies('oauth_protected_resource')) {
    return notApplicable('oauth_protected_resource', specUrls);
  }
  const res = await probe(`${ctx.origin}/.well-known/oauth-protected-resource`, {
    accept: 'application/json,*/*',
  });
  const headerHint = ctx.home.headers['www-authenticate'] ?? '';

  if (hasAnyKey(res, ['resource', 'authorization_servers'])) {
    return buildCheck({
      id: 'oauth_protected_resource',
      status: 'pass',
      message: 'Description de ressource protégée publiée.',
      evidence: [probeEvidence('GET /.well-known/oauth-protected-resource', res)],
      specUrls,
    });
  }

  if (headerHint.toLowerCase().includes('resource_metadata')) {
    return buildCheck({
      id: 'oauth_protected_resource',
      status: 'pass',
      message: 'Ressource protégée signalée dans l’en-tête WWW-Authenticate.',
      evidence: [
        { label: 'WWW-Authenticate', url: ctx.home.url, detail: headerHint.slice(0, 240) },
      ],
      specUrls,
    });
  }

  return buildCheck({
    id: 'oauth_protected_resource',
    status: 'fail',
    message: 'Pas de description de ressource protégée OAuth (rien non plus dans WWW-Authenticate).',
    evidence: [probeEvidence('GET /.well-known/oauth-protected-resource', res)],
    specUrls,
    fixPrompt: [
      'Publie /.well-known/oauth-protected-resource (RFC 9728) avec le champ resource',
      'et la liste authorization_servers, puis ajoute resource_metadata dans l’en-tête',
      'WWW-Authenticate de tes réponses 401.',
    ].join(' '),
  });
}

async function checkAuthMd(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://workos.com/auth-md'];
  if (!ctx.applies('auth_md')) return notApplicable('auth_md', specUrls);
  const tried = await probeFirstOk([`${ctx.origin}/auth.md`, `${ctx.origin}/.well-known/auth.md`], {
    accept: 'text/markdown,text/plain,*/*',
  });
  const found = tried.find(
    (r) => r.ok && !r.contentType.includes('html') && r.body.trim().length > 0,
  );

  if (!found) {
    return buildCheck({
      id: 'auth_md',
      status: 'fail',
      message: 'Pas de fichier auth.md pour expliquer à un agent comment se connecter.',
      evidence: tried.map((r) => probeEvidence('GET auth.md', r)),
      specUrls,
      fixPrompt: [
        'Publie un fichier /auth.md en Markdown qui explique comment un agent se connecte chez toi :',
        'la méthode (OAuth, clé d’API), les adresses, les droits demandés et un exemple de requête.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'auth_md',
    status: 'pass',
    message: 'Fichier auth.md publié.',
    evidence: [probeEvidence('GET auth.md', found)],
    specUrls,
  });
}

/**
 * WebMCP lives in the page's JavaScript, so a fetch-only audit can only
 * see its declaration markers. A negative result is reported as such
 * rather than as proof of absence.
 */
function checkWebMcp(ctx: AiAuditContext): AiCheckResult {
  const specUrls = ['https://webmcp.org/'];
  if (!ctx.applies('webmcp')) return notApplicable('webmcp', specUrls);
  const html = ctx.home.body;
  const markers = [
    /navigator\.modelContext/i,
    /provideContext\s*\(/i,
    /registerTool\s*\(/i,
    /type=["']application\/mcp(\+json)?["']/i,
  ].filter((re) => re.test(html));

  if (markers.length === 0) {
    return buildCheck({
      id: 'webmcp',
      status: 'fail',
      message: 'La page ne déclare aucun outil WebMCP.',
      evidence: [probeEvidence('GET page cible', ctx.home)],
      specUrls,
      fixPrompt: [
        'Déclare tes actions principales en WebMCP dans la page :',
        'appelle navigator.modelContext.provideContext() avec la liste de tes outils',
        '(nom, description, paramètres attendus) pour qu’un agent puisse agir dans la page.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'webmcp',
    status: 'pass',
    message: 'Outils WebMCP trouvés dans la page.',
    evidence: [probeEvidence('GET page cible', ctx.home)],
    specUrls,
  });
}

function hasAnyKey(res: ProbeResult, keys: string[]): boolean {
  if (!res.ok) return false;
  if (res.contentType.includes('html')) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return false;
  }
  const objects: Record<string, unknown>[] = Array.isArray(parsed)
    ? parsed.filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    : typeof parsed === 'object' && parsed !== null
      ? [parsed as Record<string, unknown>]
      : [];
  return objects.some((obj) => keys.some((key) => key in obj));
}

export const __testables = { hasAnyKey };
