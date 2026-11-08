import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SitePreview } from '../app/dashboard/_components/SitePreview';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 20,
    right: 140,
    top: 40,
    bottom: 60,
    width: 120,
    height: 20,
    x: 20,
    y: 40,
    toJSON() {
      return {};
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Expected element to exist');
  return value;
}

function fixture(heroUrl: string | null = '/hero.png') {
  return render(
    <div data-testid="scroll" style={{ overflowX: 'auto' }}>
      <table>
        <tbody>
          <tr>
            <td style={{ overflow: 'hidden' }}>
              <SitePreview heroUrl={heroUrl}>
                <a href="#site">Site</a>
              </SitePreview>
            </td>
            <td>Score</td>
          </tr>
        </tbody>
      </table>
    </div>,
  );
}

function preview() {
  return document.querySelector<HTMLElement>('[data-site-preview]');
}

describe('site screenshot preview', () => {
  it('loads only on identity hover and portals outside the clipped table', () => {
    fixture();
    expect(document.querySelector('img')).toBeNull();
    fireEvent.mouseEnter(screen.getByText('Score'));
    expect(preview()).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('link'));
    expect(preview()?.parentElement).toBe(document.body);
    expect(screen.getByTestId('scroll').contains(preview())).toBe(false);
    expect(preview()?.classList.contains('fixed')).toBe(true);
    expect(preview()?.style.visibility).toBe('hidden');
    fireEvent.load(required(document.querySelector('img')));
    expect(preview()?.style.visibility).toBe('visible');
  });

  it('supports keyboard focus and Escape without reopening until a new interaction', () => {
    fixture();
    fireEvent.focus(screen.getByRole('link'));
    expect(preview()).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(preview()).toBeNull();
    fireEvent.blur(screen.getByRole('link'));
    fireEvent.focus(screen.getByRole('link'));
    expect(preview()).not.toBeNull();
  });

  it('flips above and clamps to the viewport on scroll and resize', () => {
    fixture();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 1000,
      right: 1020,
      top: 700,
      bottom: 720,
      width: 20,
      height: 20,
      x: 1000,
      y: 700,
      toJSON() {
        return {};
      },
    });
    fireEvent.focus(screen.getByRole('link'));
    expect(preview()?.style.left).toBe('776px');
    expect(preview()?.style.top).toBe('542px');
    fireEvent.scroll(screen.getByTestId('scroll'));
    fireEvent.resize(window);
    expect(preview()?.style.top).toBe('542px');
  });

  it('allows hovering the screenshot, then closes and cleans pending timers on unmount', () => {
    vi.useFakeTimers();
    const view = fixture();
    fireEvent.mouseEnter(screen.getByRole('link'));
    fireEvent.mouseLeave(required(screen.getByRole('link').parentElement));
    fireEvent.mouseEnter(required(preview()));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(preview()).not.toBeNull();
    fireEvent.mouseLeave(required(preview()));
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(preview()).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('link'));
    fireEvent.mouseLeave(required(screen.getByRole('link').parentElement));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(preview()).toBeNull();
  });

  it('omits missing and failed screenshots', () => {
    const view = fixture(null);
    fireEvent.focus(screen.getByRole('link'));
    expect(preview()).toBeNull();
    view.unmount();
    fixture();
    fireEvent.focus(screen.getByRole('link'));
    fireEvent.error(required(document.querySelector('img')));
    expect(preview()).toBeNull();
    fireEvent.mouseEnter(screen.getByRole('link'));
    expect(preview()).toBeNull();
  });
});
