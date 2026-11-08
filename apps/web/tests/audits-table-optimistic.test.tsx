import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditRowView } from '../app/dashboard/_components/AuditsTable';
import { applyOptimistic } from '../app/dashboard/_components/optimistic';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

let resolveDelete: (v: unknown) => void = () => undefined;
const deleteAuditsAction = vi.fn(
  () =>
    new Promise((r) => {
      resolveDelete = r;
    }),
);
const refreshAuditsAction = vi.fn(() =>
  Promise.resolve({ ok: true, done: 1, skipped: 0, failed: 0, message: '1 relancé.' }),
);
vi.mock('../app/dashboard/actions', () => ({
  deleteAuditsAction: (...a: unknown[]) => deleteAuditsAction(...(a as [])),
  refreshAuditsAction: (...a: unknown[]) => refreshAuditsAction(...(a as [])),
}));

const { AuditsTable } = await import('../app/dashboard/_components/AuditsTable');

function row(id: string, name: string, status: AuditRowView['status'] = 'completed'): AuditRowView {
  return {
    id,
    slug: `slug${id}xxxxxx`,
    url: `https://${name}.fr/`,
    host: `${name}.fr`,
    name,
    label: null,
    source: 'dashboard',
    status,
    score: status === 'completed' ? 70 : null,
    createdAt: '2026-11-01T10:00:00.000Z',
    createdLabel: '1 novembre 2026',
    pages: 1,
    weakAxes: [],
    notEvaluated: [],
    aiScore: null,
    faviconUrl: null,
    heroUrl: null,
    delta: null,
    axes: [],
    progressStep: null,
    recentlyOpened: false,
    trackingToken: null,
    opened: false,
    views: 0,
    lastViewedAt: null,
  };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function alphaBox(): HTMLElement {
  const [box] = screen.getAllByRole('checkbox', { name: 'Sélectionner alpha' });
  if (!box) throw new Error('no checkbox');
  return box;
}

function visibleNames(): string[] {
  const table = screen.getByRole('table');
  return within(table)
    .queryAllByRole('checkbox')
    .map((c) => c.getAttribute('aria-label') ?? '')
    .filter((l) => l.startsWith('Sélectionner '))
    .map((l) => l.replace('Sélectionner ', ''));
}

describe('applyOptimistic', () => {
  it('hides removed ids and shows refreshing ones as running', () => {
    const rows = [row(A, 'alpha'), row(B, 'beta')];
    const out = applyOptimistic(rows, new Set([A]), new Set([B]));
    expect(out.map((r) => r.id)).toEqual([B]);
    expect(out[0]).toMatchObject({ status: 'running', score: null });
  });
});

describe('AuditsTable optimistic delete', () => {
  beforeEach(() => {
    refresh.mockClear();
    deleteAuditsAction.mockClear();
  });

  it('removes the row at once and a late auto-refresh render does not bring it back', async () => {
    const user = userEvent.setup();
    const props = { publicUrl: 'https://audit.test', highlightId: null, fadeTail: false };
    const { rerender } = render(
      <AuditsTable rows={[row(A, 'alpha'), row(B, 'beta')]} {...props} />,
    );
    expect(visibleNames()).toEqual(['alpha', 'beta']);

    await user.click(alphaBox());
    await user.click(screen.getByRole('button', { name: /Supprimer/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Supprimer/ }));

    // Optimistic: gone before the server answers.
    expect(visibleNames()).toEqual(['beta']);
    expect(deleteAuditsAction).toHaveBeenCalledWith([A]);

    // A poll started before the delete lands with the stale list.
    rerender(<AuditsTable rows={[row(A, 'alpha'), row(B, 'beta')]} {...props} />);
    expect(visibleNames()).toEqual(['beta']);

    await act(async () => {
      resolveDelete({ ok: true, done: 1, skipped: 0, failed: 0, message: '1 audit supprimé.' });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    // Still hidden after the server confirmed, even with another stale render.
    rerender(<AuditsTable rows={[row(A, 'alpha'), row(B, 'beta')]} {...props} />);
    expect(visibleNames()).toEqual(['beta']);
  });

  it('restores the row when the delete fails', async () => {
    const user = userEvent.setup();
    const props = { publicUrl: 'https://audit.test', highlightId: null, fadeTail: false };
    render(<AuditsTable rows={[row(A, 'alpha'), row(B, 'beta')]} {...props} />);
    await user.click(alphaBox());
    await user.click(screen.getByRole('button', { name: /Supprimer/ }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /Supprimer/ }),
    );
    expect(visibleNames()).toEqual(['beta']);
    await act(async () => {
      resolveDelete({
        ok: false,
        done: 0,
        skipped: 0,
        failed: 1,
        message: '0 supprimé(s), 1 en erreur.',
        failedIds: [A],
      });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(visibleNames()).toEqual(['alpha', 'beta']);
    });
  });
});
