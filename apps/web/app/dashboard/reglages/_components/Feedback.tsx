export function Feedback({
  state,
}: {
  state: { ok: boolean; message: string | null };
}): React.ReactElement {
  return (
    <div aria-live="polite" className="min-h-5">
      {state.message ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={`text-[13px] ${state.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
