'use client';

import { useState, useTransition } from 'react';

import { setAuditTemplateAction } from '../actions';

/** Report template of one audit, changeable after creation. */
export function TemplatePicker({
  auditId,
  value,
  options,
  defaultName,
}: {
  auditId: string;
  value: string;
  options: { id: string; name: string }[];
  defaultName: string;
}): React.ReactElement {
  const [current, setCurrent] = useState(value);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor="panel-template" className="sr-only">
        Modèle du rapport
      </label>
      <select
        id="panel-template"
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setCurrent(next);
          start(async () => {
            const res = await setAuditTemplateAction({ auditId, templateId: next });
            setMessage(res.message);
          });
        }}
        className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px]"
      >
        <option value="">Par défaut ({defaultName})</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <span role="status" className="text-[12px] text-[var(--fg-muted)]">
        {message}
      </span>
    </span>
  );
}
