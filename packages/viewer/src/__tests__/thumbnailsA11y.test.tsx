import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Flipbook } from '../Flipbook';
import { LABELS } from '../toolbar/labels';
import type { PageSource } from '../types/PageSource';

expect.extend(toHaveNoViolations);

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 6,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

describe('Thumbnail panel a11y audit', () => {
  it('default closed panel has zero violations', async () => {
    const source = makeSource();
    const { container } = render(<Flipbook source={source} />);
    await waitFor(() => {
      expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    });
    const root = container.querySelector('.fbjs-root')!;
    const results = await axe(root);
    expect(results).toHaveNoViolations();
  });

  it('open panel has zero violations', async () => {
    const source = makeSource();
    // Single render — capture `container` from this render so the axe audit
    // runs against the *opened* panel. A second `render(<Flipbook />)` would
    // audit a fresh tree with the panel closed (default state), which would
    // pass for the wrong reason.
    const { container } = render(<Flipbook source={source} />);
    const button = await screen.findByRole('button', { name: LABELS.thumbnailsToggle });
    act(() => { button.click(); });
    await waitFor(() => {
      expect(screen.getByRole('region', { name: LABELS.thumbnailPanelLabel })).toBeInTheDocument();
    });
    const root = container.querySelector('.fbjs-root')!;
    const results = await axe(root);
    expect(results).toHaveNoViolations();
  });
});
