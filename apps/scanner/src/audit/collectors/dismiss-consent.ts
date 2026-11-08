import type { Page } from 'playwright';

/**
 * CSS that hides consent / cookie / GDPR overlays from the major
 * European vendors plus a few generic catch-all selectors. Injected as a
 * style tag *after* navigation so the banner never affects screenshots.
 *
 * Vendors covered (selector patterns confirmed against their public
 * docs / observed live HTML):
 *   - Didomi          (didomi.io)
 *   - Axeptio         (axeptio.eu)
 *   - OneTrust        (onetrust.com / Cookiepro)
 *   - TarteAuCitron   (tarteaucitron.io — popular FR open-source)
 *   - Cookiebot       (Cybot)
 *   - Quantcast Choice
 *   - Usercentrics
 *   - Sourcepoint
 *   - Iubenda
 *
 * The generic catch-alls match `[id*="cookie-banner" i]` etc. — they
 * occasionally false-positive on legit "cookie settings" page sections
 * but that's acceptable since this CSS only runs in the screenshot
 * collector, not in the live page.
 *
 * The trailing `html, body { overflow: auto; position: static }`
 * unfreezes pages that lock scroll while the banner is up (Didomi /
 * OneTrust both do this) — without it the screenshot would capture a
 * truncated body.
 */
const CONSENT_KILL_CSS = `
  /* Vendor: Didomi */
  #didomi-notice, [id^="didomi-popup"], [class*="didomi-popup"],
  #didomi-host, .didomi-popup-open,

  /* Vendor: Axeptio */
  #axeptio_overlay, #axeptio_main_button, [class*="ax-cookie"],
  [class*="axeptio_widget"],

  /* Vendor: OneTrust / Cookiepro */
  #onetrust-banner-sdk, #onetrust-consent-sdk, #onetrust-pc-sdk,
  #ot-sdk-cookie-policy, .onetrust-pc-dark-filter,

  /* Vendor: TarteAuCitron (popular FR open-source) */
  #tarteaucitronAlertBigBottom, #tarteaucitronAlertBigTop,
  #tarteaucitronRoot, #tarteaucitron, .tarteaucitronAlertBigBottom,

  /* Vendor: Cookiebot (Cybot) */
  #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay,
  #CookiebotWidget,

  /* Vendor: Quantcast Choice */
  .qc-cmp2-container, #qc-cmp2-ui, [class*="qc-cmp2-"],

  /* Vendor: Usercentrics */
  #usercentrics-root, [id*="usercentrics-cmp"],

  /* Vendor: Sourcepoint */
  [id*="sp_message_container"], [class*="sp_message"],

  /* Vendor: Iubenda */
  #iubenda-cs-banner, .iubenda-cs-overlay,

  /* Generic catch-alls (id/class contains, case-insensitive) */
  [id*="cookie-banner" i], [class*="cookie-banner" i],
  [id*="cookie-notice" i], [class*="cookie-notice" i],
  [id*="cookie-consent" i], [class*="cookie-consent" i],
  [id*="gdpr-banner" i], [class*="gdpr-banner" i],
  [id*="cookieConsent" i], [class*="cookieConsent" i],
  [role="dialog"][aria-label*="cookie" i],
  [role="dialog"][aria-label*="consent" i],
  [role="dialog"][aria-label*="confidentialit" i] {
    display: none !important;
    visibility: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }

  /* Unfreeze pages that lock scroll while the banner is up */
  html, body {
    overflow: auto !important;
    position: static !important;
  }
`;

/**
 * Inject the consent-banner kill CSS into the page. Returns silently
 * on failure — the screenshot collectors must complete even when this
 * step fails (e.g. page navigated away mid-execution).
 */
export async function dismissConsentOverlays(page: Page): Promise<void> {
  await page.addStyleTag({ content: CONSENT_KILL_CSS }).catch(() => undefined);
}
