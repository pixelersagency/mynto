import { DnsResolutionError, setHostResolverForTests } from '../../src/lib/dns-resolver.js';

/**
 * Unit tests never touch the real DNS: the SSRF guards resolve through this
 * deterministic resolver. Every name answers one public
 * address (93.184.215.14), except `*.invalid` (RFC 2606) which does not exist. A test that
 * needs another answer passes its own resolver to checkUrlSafe /
 * checkWebhookTarget, or calls setHostResolverForTests itself.
 */
setHostResolverForTests((host) => {
  if (host.endsWith('.invalid')) {
    return Promise.reject(new DnsResolutionError('ENOTFOUND', `${host}: NXDOMAIN`));
  }
  return Promise.resolve([{ address: '93.184.215.14', family: 4 }]);
});
