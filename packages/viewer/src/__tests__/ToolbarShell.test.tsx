import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Ref } from 'react';
import { ToolbarShell } from '../toolbar/ToolbarShell';
import { useToolbarPart } from '../toolbar/useToolbarPart';
import { LABELS } from '../toolbar/labels';

// A minimal probe part that calls useToolbarPart and renders a button. Doesn't
// pull in the full FlipbookProvider — ToolbarShell + useToolbarPart are
// hook-free of any flipbook context, so we test them in isolation.
function ProbePart({ label }: { label: string }) {
  const { ref, tabIndex, onFocus, onKeyDown } = useToolbarPart<HTMLButtonElement>();
  return (
    <button
      ref={ref as Ref<HTMLButtonElement>}
      type="button"
      aria-label={label}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      {label}
    </button>
  );
}

describe('ToolbarShell — ARIA + composition', () => {
  it('renders role="toolbar" with the default aria-label', () => {
    render(<ToolbarShell><ProbePart label="X" /></ToolbarShell>);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar).toHaveAttribute('aria-label', LABELS.toolbarLabel);
  });

  it('accepts a custom aria-label override', () => {
    render(<ToolbarShell aria-label="My toolbar"><ProbePart label="X" /></ToolbarShell>);
    expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', 'My toolbar');
  });

  it('renders the fbjs-toolbar class plus any consumer className', () => {
    const { container } = render(
      <ToolbarShell className="my-extra">
        <ProbePart label="X" />
      </ToolbarShell>,
    );
    const el = container.querySelector('[role="toolbar"]') as HTMLElement;
    expect(el.className).toContain('fbjs-toolbar');
    expect(el.className).toContain('my-extra');
  });

  it('renders children inside the toolbar div', () => {
    render(
      <ToolbarShell>
        <ProbePart label="A" />
        <ProbePart label="B" />
        <ProbePart label="C" />
      </ToolbarShell>,
    );
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'C' })).toBeInTheDocument();
  });
});

describe('ToolbarShell — roving-tabindex initial state', () => {
  it('first registered part has tabIndex=0; rest have -1', () => {
    render(
      <ToolbarShell>
        <ProbePart label="First" />
        <ProbePart label="Second" />
        <ProbePart label="Third" />
      </ToolbarShell>,
    );
    expect(screen.getByRole('button', { name: 'First' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Second' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Third' })).toHaveAttribute('tabindex', '-1');
  });

  it('a standalone part (outside ToolbarShell) has tabIndex=0', () => {
    render(<ProbePart label="Standalone" />);
    expect(screen.getByRole('button', { name: 'Standalone' })).toHaveAttribute('tabindex', '0');
  });
});

describe('ToolbarShell — forwarded ref', () => {
  it('exposes the div ref via forwardRef', () => {
    const ref = vi.fn();
    render(
      <ToolbarShell ref={ref}>
        <ProbePart label="X" />
      </ToolbarShell>,
    );
    // ref was called at least once with an HTMLDivElement
    expect(ref).toHaveBeenCalled();
    const lastCall = ref.mock.calls[ref.mock.calls.length - 1];
    expect(lastCall[0]).toBeInstanceOf(HTMLDivElement);
  });
});
