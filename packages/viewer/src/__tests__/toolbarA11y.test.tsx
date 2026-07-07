import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Flipbook } from '../Flipbook';
import type { PageSource } from '../types/PageSource';

expect.extend(toHaveNoViolations);

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

describe('Flipbook a11y audit (jest-axe, scoped to .fbjs-root)', () => {
  it('default Flipbook with built-in toolbar has zero ARIA violations', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} title="Doc" />);
    await waitFor(() => {
      expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    });
    // Scope axe to .fbjs-root — captures both toolbars + the container +
    // theme runtime + loading overlay + stage. Matches parts-a11y.test.tsx's
    // narrower scoping pattern (that one scopes to the toolbar element
    // specifically for toolbar-invariant audits).
    const root = container.querySelector('.fbjs-root')!;
    const results = await axe(root);
    expect(results).toHaveNoViolations();
  });

  it('compact + title produces zero violations', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} compact title="Compact Doc" />);
    await waitFor(() => {
      expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    });
    const root = container.querySelector('.fbjs-root')!;
    const results = await axe(root);
    expect(results).toHaveNoViolations();
  });

  it('toolbar={false} (no chrome) on the root produces zero violations', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} toolbar={false} />);
    await waitFor(() => {
      expect(container.querySelector('.fbjs-root')).not.toBeNull();
    });
    const root = container.querySelector('.fbjs-root')!;
    const results = await axe(root);
    expect(results).toHaveNoViolations();
  });
});
