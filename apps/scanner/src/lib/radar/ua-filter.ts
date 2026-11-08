/**
 * Rejects user agents that are not a human reading the report.
 *
 * Radar sends the /r/<token> link by email, and corporate mail gateways
 * open every link before the recipient does (Microsoft Safe Links,
 * Proofpoint, Mimecast, Barracuda...). Counting those as views would mark
 * every prospect as "hot" seconds after the send. The beacon already
 * requires JS + 5 s of visible tab, which most scanners never reach; this
 * list is the second filter, applied server-side on the beacon's UA.
 *
 * Extends the categories of apps/web/lib/audit-views.ts#classifyUserAgent
 * (AI crawlers, search bots, social previews, monitors) with the mail
 * security scanners and generic automation clients.
 */
const BLOCKED_UA_PATTERNS: readonly RegExp[] = [
  // Mail security link scanners
  /BingPreview/i,
  /Safe ?Links/i,
  /Microsoft Office/i,
  /ms-office/i,
  /Proofpoint/i,
  /\bppops\b/i,
  /Mimecast/i,
  /Barracuda/i,
  /Google-Read-Aloud/i,
  /GoogleImageProxy/i,
  /\bTrend ?Micro\b/i,
  /Symantec/i,
  /\bForcepoint\b/i,
  // Headless and automation clients
  /HeadlessChrome/i,
  /PhantomJS/i,
  /Puppeteer/i,
  /Playwright/i,
  /Selenium/i,
  /Lighthouse/i,
  /python-requests/i,
  /python-urllib/i,
  /aiohttp/i,
  /\bcurl\//i,
  /\bWget\//i,
  /Go-http-client/i,
  /okhttp/i,
  /axios\//i,
  /node-fetch/i,
  /undici/i,
  /Java\//i,
  /libwww-perl/i,
  /HttpClient/i,
  // AI crawlers (same list as classifyUserAgent)
  /GPTBot/i,
  /OAI-SearchBot/i,
  /ChatGPT-User/i,
  /ClaudeBot/i,
  /Claude-User/i,
  /Claude-Web/i,
  /anthropic-ai/i,
  /PerplexityBot/i,
  /Perplexity-User/i,
  /Google-Extended/i,
  /CCBot/i,
  /Bytespider/i,
  /Meta-ExternalAgent/i,
  /cohere-ai/i,
  // Social previews (link unfurl in Slack, WhatsApp, LinkedIn...)
  /facebookexternalhit/i,
  /LinkedInBot/i,
  /Twitterbot/i,
  /Slackbot/i,
  /WhatsApp/i,
  /TelegramBot/i,
  /Discordbot/i,
  /SkypeUriPreview/i,
  // Monitors
  /UptimeRobot/i,
  /Pingdom/i,
  /StatusCake/i,
  // Catch-all words, last so the specific names above document intent.
  // `bot` anywhere, except the CUBOT phone brand ("Android 10; CUBOT X30").
  /(?<!cu)bot/i,
  /crawler/i,
  /spider/i,
  /preview/i,
  /scanner/i,
  /scan\b/i,
];

export function isBlockedViewerUserAgent(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== 'string') return true;
  const ua = userAgent.trim();
  // Every real browser sends a UA. An empty or tiny one is a script.
  if (ua.length < 10) return true;
  // Real browsers all announce Mozilla/5.0 (Chrome, Safari, Firefox, Edge,
  // mobile webviews). Anything else is a library or a bespoke client.
  if (!ua.startsWith('Mozilla/5.0 ')) return true;
  return BLOCKED_UA_PATTERNS.some((re) => re.test(ua));
}
