import type { ZodIssue } from 'zod';

/**
 * French, one-line-per-variable description of an environment validation
 * failure, shared by the web app and the scanner. Never prints a value:
 * only the variable name and what is expected.
 */
export function describeEnvIssues(
  issues: readonly ZodIssue[],
  env: Record<string, string | undefined>,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const i of issues) {
    const key = i.path.join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    const missing = env[key] === undefined || env[key] === '';
    lines.push(
      missing
        ? `  - ${key} : manquante (obligatoire)`
        : `  - ${key} : invalide (${frenchIssue(i)})`,
    );
  }
  return lines;
}

function frenchIssue(i: ZodIssue): string {
  switch (i.code) {
    case 'too_small':
      return i.type === 'string'
        ? `${String(i.minimum)} caractères minimum`
        : `valeur minimale ${String(i.minimum)}`;
    case 'too_big':
      return i.type === 'string'
        ? `${String(i.maximum)} caractères maximum`
        : `valeur maximale ${String(i.maximum)}`;
    case 'invalid_enum_value':
      return `valeurs possibles : ${i.options.join(', ')}`;
    case 'invalid_string':
      if (i.validation === 'url') return 'URL attendue';
      if (i.validation === 'email') return 'adresse email attendue';
      if (i.validation === 'regex') return 'format inattendu';
      if (typeof i.validation === 'object' && 'startsWith' in i.validation) {
        return `doit commencer par « ${i.validation.startsWith} »`;
      }
      return 'format inattendu';
    case 'invalid_union':
    case 'invalid_literal':
      return 'valeurs possibles : 1, 0, true, false';
    case 'invalid_type':
      return `type attendu : ${i.expected}`;
    case 'custom':
      return i.message === 'must be a postgres:// URL' ? 'URL postgres:// attendue' : i.message;
    default:
      return i.message;
  }
}
