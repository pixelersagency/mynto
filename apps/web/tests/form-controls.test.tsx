import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from '../components/ui/empty-state';
import { RadioGroup } from '../components/ui/radio-group';
import { SwitchField } from '../components/ui/switch';

// Radix measures the switch (jsdom has no ResizeObserver).
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

function formOf(el: HTMLElement): FormData {
  const form = el.closest('form');
  if (!form) throw new Error('no form');
  return new FormData(form);
}

describe('SwitchField', () => {
  it('is a labelled switch that posts "on" like a checkbox', async () => {
    const user = userEvent.setup();
    render(
      <form>
        <SwitchField id="t-lh" name="lighthouse" label="Lighthouse" description="Plus lent." />
      </form>,
    );
    const sw = screen.getByRole('switch', { name: 'Lighthouse' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveAccessibleDescription('Plus lent.');
    expect(formOf(sw).get('lighthouse')).toBeNull();

    await user.click(screen.getByText('Lighthouse'));
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(formOf(sw).get('lighthouse')).toBe('on');

    sw.focus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Enter}');
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('posts its value for multi-value fields and respects disabled', () => {
    render(
      <form>
        <SwitchField id="t-a" name="axes" value="ux" defaultChecked label="UX" />
        <SwitchField id="t-b" name="axes" value="ui" defaultChecked label="UI" disabled />
      </form>,
    );
    const ux = screen.getByRole('switch', { name: 'UX' });
    expect(formOf(ux).getAll('axes')).toContain('ux');
    expect(screen.getByRole('switch', { name: 'UI' })).toBeDisabled();
  });
});

describe('RadioGroup', () => {
  const options = [
    { value: 'auto', label: 'Automatique', description: 'Le scanner choisit.' },
    { value: 'vitrine', label: 'Site vitrine', description: 'Présentation, contact.' },
  ];

  it('renders a named group of native radios with short names and descriptions', async () => {
    const user = userEvent.setup();
    render(
      <form>
        <RadioGroup name="site_type" legend="Type de site" defaultValue="auto" options={options} />
      </form>,
    );
    expect(screen.getByRole('group', { name: 'Type de site' })).toBeInTheDocument();
    const auto = screen.getByRole('radio', { name: 'Automatique' });
    expect(auto).toBeChecked();
    expect(auto).toHaveAccessibleDescription('Le scanner choisit.');

    await user.click(screen.getByText('Site vitrine'));
    expect(formOf(auto).get('site_type')).toBe('vitrine');
  });

  it('segmented variant stays controlled', async () => {
    const user = userEvent.setup();
    const seen: string[] = [];
    render(
      <RadioGroup
        variant="segmented"
        name="p"
        legend="Fournisseur"
        value="a"
        onValueChange={(v) => seen.push(v)}
        options={[
          { value: 'a', label: 'Anthropic' },
          { value: 'g', label: 'Gemini' },
        ]}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Gemini' }));
    expect(seen).toEqual(['g']);
  });
});

describe('EmptyState', () => {
  it('centres the title, text and action', () => {
    render(
      <EmptyState title="Aucun audit." description="Lance-en un." action={<a href="/x">Go</a>} />,
    );
    const title = screen.getByText('Aucun audit.');
    expect(title.parentElement).toHaveClass('text-center', 'max-w-[420px]');
    expect(title.parentElement?.parentElement).toHaveClass(
      'flex-1',
      'items-center',
      'justify-center',
    );
  });
});
