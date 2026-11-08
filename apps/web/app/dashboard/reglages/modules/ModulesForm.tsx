'use client';

import type { AuditModules } from '@mynto/shared';
import { useActionState } from 'react';

import { ModulesFieldset } from '../../_components/ModulesFieldset';
import { Feedback } from '../_components/Feedback';
import { saveModulesAction, type SettingsState } from '../actions';

import { DashButton } from '@/components/ui/dash-button';

export function ModulesForm({ initial }: { initial: AuditModules }): React.ReactElement {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveModulesAction, {
    ok: false,
    message: null,
  });
  return (
    <form action={action} className="space-y-6" noValidate>
      <ModulesFieldset
        initial={initial}
        error={state.fieldErrors?.axes}
        idPrefix="def"
        showGlobalScoreSetting
      />
      <div className="flex flex-wrap items-center gap-3">
        <DashButton type="submit" variant="primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </DashButton>
        <Feedback state={state} />
      </div>
    </form>
  );
}
