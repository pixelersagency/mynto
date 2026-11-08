/**
 * Coarse browser family + device class ("Chrome, ordinateur"): enough to
 * tell a phone from a desk, never enough to fingerprint. Used by both view
 * counters (tracking links and /audit/full reports) instead of the raw
 * User-Agent (CNIL-simplified policy). Null for an empty User-Agent.
 */
export const UA_FAMILY_MAX_LENGTH = 200;

export function userAgentFamily(ua: string | null | undefined): string | null {
  if (typeof ua !== 'string' || ua.trim().length === 0) return null;
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : ua.includes('Firefox/')
        ? 'Firefox'
        : ua.includes('SamsungBrowser/')
          ? 'Samsung Internet'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : ua.includes('Safari/')
              ? 'Safari'
              : 'Autre navigateur';
  const device = /iPad|Tablet/.test(ua)
    ? 'tablette'
    : /Mobi|iPhone|Android/.test(ua)
      ? 'mobile'
      : 'ordinateur';
  return `${browser}, ${device}`.slice(0, UA_FAMILY_MAX_LENGTH);
}
