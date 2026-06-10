import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Flipbook } from '../Flipbook';
import type { PageSource } from '../types/PageSource';

function makeSource(): PageSource {
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 4,
    getPageSize: () => ({ width: 612, height: 792 }),
    renderPage: vi.fn(() => Promise.resolve(document.createElement('canvas'))),
    dispose: () => {},
  };
}

const CustomBar = () => <div />;

describe('Flipbook toolbar conflict dev-warn', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('warns once when toolbar={<JSX/>} + showPrint={false}', () => {
    const source = makeSource();
    const { rerender } = render(
      <Flipbook source={source} toolbar={<CustomBar />} showPrint={false} />,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/toolbar.*combined with built-in/i);
    // Re-render with same conflicting combo: warnedRef gates duplicate warning.
    rerender(<Flipbook source={source} toolbar={<CustomBar />} showPrint={false} />);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns when toolbar={<JSX/>} + compact={true}', () => {
    const source = makeSource();
    render(<Flipbook source={source} toolbar={<CustomBar />} compact={true} />);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('warns when toolbar={<JSX/>} + title prop set', () => {
    const source = makeSource();
    render(<Flipbook source={source} toolbar={<CustomBar />} title="My Doc" />);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT warn when toolbar={true} + showPrint={false} (built-in props valid with built-in toolbar)', () => {
    const source = makeSource();
    render(<Flipbook source={source} toolbar={true} showPrint={false} />);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn when toolbar={false} + showPrint={false}', () => {
    const source = makeSource();
    render(<Flipbook source={source} toolbar={false} showPrint={false} />);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT warn when toolbar={<JSX/>} alone (no built-in-only props)', () => {
    const source = makeSource();
    render(<Flipbook source={source} toolbar={<CustomBar />} />);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // Production-mode behavior is verified separately by the Verify Phase bundle-grep:
  // `grep "toolbar.*combined with built-in" dist/index.js` returns ZERO matches because
  // vite/rolldown statically replaces `process.env.NODE_ENV !== 'production'` with
  // `false` during build, dead-code-eliminating the entire warn block.
});
