import { ReportActions } from './ReportActions';

/**
 * Report rendered by the template engine (sanitized HTML + CSS scoped to
 * .mynto-report). The page around it stays white: no theme bleeds in.
 */
export function TemplateReport({ html, css }: { html: string; css: string }): React.ReactElement {
  return (
    <>
      <style
        // Template CSS, validated at import (no @import, no url()) and nested
        // under .mynto-report by the engine.
        dangerouslySetInnerHTML={{
          __html: `html,body{background:#fff !important}\n${css.replace(/<\/style/gi, '<\\/style')}`,
        }}
      />
      <div
        id="report"
        // Sanitized by @mynto/templates (allowlist, no script, no handlers).
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <ReportActions />
    </>
  );
}
