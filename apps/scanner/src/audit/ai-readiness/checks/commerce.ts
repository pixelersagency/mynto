import type { AiCheckResult } from '@mynto/shared';

import { probe, probeFirstOk } from '../probe.js';
import { buildCheck, notApplicable, probeEvidence, type AiAuditContext } from '../types.js';

/**
 * Agentic commerce. These standards only make sense for a site that
 * actually sells, so on a non-commerce site every check is `neutral` and
 * drops out of the score instead of dragging it down.
 */
export async function runCommerceChecks(ctx: AiAuditContext): Promise<AiCheckResult[]> {
  if (!ctx.applies('x402')) {
    return [
      notApplicable('x402', ['https://www.x402.org/']),
      notApplicable('mpp', ['https://mpp.dev']),
      notApplicable('ucp', ['https://ucp.dev/']),
      notApplicable('acp', ['https://agenticcommerce.dev']),
    ];
  }

  const [x402, mpp, ucp, acp] = await Promise.all([
    checkX402(ctx),
    checkMpp(ctx),
    checkUcp(ctx),
    checkAcp(ctx),
  ]);
  return [x402, mpp, ucp, acp];
}

/** x402 announces itself with a 402 plus payment headers or a JSON body. */
async function checkX402(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://www.x402.org/'];
  const tried = await probeFirstOk([`${ctx.origin}/api`, `${ctx.origin}/api/v1`, ctx.targetUrl], {
    accept: 'application/json,*/*',
    maxBytes: 32_000,
  });

  const hit = tried.find(
    (r) =>
      r.status === 402 ||
      'x-payment' in r.headers ||
      'x-accept-payment' in r.headers ||
      /"x402"|accepts.*"scheme"/i.test(r.body),
  );

  if (!hit) {
    return buildCheck({
      id: 'x402',
      status: 'fail',
      message: 'Aucun paiement x402 trouvé.',
      evidence: tried.map((r) => probeEvidence('GET point d’accès', r)),
      specUrls,
      fixPrompt: [
        'Si tu vends l’accès à des contenus ou à une API, mets en place x402 :',
        'réponds HTTP 402 avec un JSON qui décrit les moyens de paiement acceptés,',
        'puis accepte l’en-tête X-PAYMENT pour servir la requête une fois payée.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'x402',
    status: 'pass',
    message: 'Paiement x402 en place.',
    evidence: [probeEvidence('GET point d’accès', hit)],
    specUrls,
  });
}

async function checkMpp(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://mpp.dev'];
  const tried = await probeFirstOk(
    [`${ctx.origin}/.well-known/mpp.json`, `${ctx.origin}/openapi.json`],
    { accept: 'application/json,*/*' },
  );
  const hit = tried.find((r) => r.ok && /merchant[_-]?payment|"mpp"/i.test(r.body));

  if (!hit) {
    return buildCheck({
      id: 'mpp',
      status: 'fail',
      message: 'Pas de description de paiement MPP.',
      evidence: tried.map((r) => probeEvidence('GET', r)),
      specUrls,
      fixPrompt: [
        'Décris tes moyens de paiement au format MPP :',
        'publie la description de tes points de paiement (OpenAPI ou /.well-known/mpp.json)',
        'pour qu’un agent acheteur sache comment régler une commande.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'mpp',
    status: 'pass',
    message: 'Description de paiement MPP publiée.',
    evidence: [probeEvidence('GET', hit)],
    specUrls,
  });
}

async function checkUcp(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://ucp.dev/'];
  const tried = await probeFirstOk(
    [`${ctx.origin}/.well-known/ucp`, `${ctx.origin}/.well-known/ucp.json`],
    { accept: 'application/json,*/*' },
  );
  const hit = tried.find(
    (r) => r.ok && !r.contentType.includes('html') && r.body.trim().length > 0,
  );

  if (!hit) {
    return buildCheck({
      id: 'ucp',
      status: 'fail',
      message: 'Pas de profil UCP.',
      evidence: tried.map((r) => probeEvidence('GET', r)),
      specUrls,
      fixPrompt: [
        'Publie un profil UCP à l’adresse /.well-known/ucp avec ton catalogue,',
        'tes règles de panier et tes points de commande,',
        'pour qu’un agent puisse passer commande sans passer par tes pages.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'ucp',
    status: 'pass',
    message: 'Profil UCP publié.',
    evidence: [probeEvidence('GET', hit)],
    specUrls,
  });
}

async function checkAcp(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://agenticcommerce.dev'];
  const res = await probe(`${ctx.origin}/.well-known/acp.json`, {
    accept: 'application/json,*/*',
  });
  const valid = res.ok && !res.contentType.includes('html') && res.body.trim().startsWith('{');

  if (!valid) {
    return buildCheck({
      id: 'acp',
      status: 'fail',
      message: 'Pas de document ACP.',
      evidence: [probeEvidence('GET /.well-known/acp.json', res)],
      specUrls,
      fixPrompt: [
        'Publie un document ACP à l’adresse /.well-known/acp.json',
        'qui décrit le paiement mené par un agent : flux de produits, ouverture de session',
        'et validation de la commande.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'acp',
    status: 'pass',
    message: 'Document ACP publié.',
    evidence: [probeEvidence('GET /.well-known/acp.json', res)],
    specUrls,
  });
}
