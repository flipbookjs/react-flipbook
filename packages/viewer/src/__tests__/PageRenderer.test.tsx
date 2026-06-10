// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PageRenderer } from '../components/PageRenderer';
import { PageRegistryWriteContext, type PageRegistryWrite, type PageRegistryEntry } from '../core/PageRegistry';
import type { PageSource } from '../types/PageSource';

function makeStubSource(): PageSource {
  const canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 800;
  return {
    init: () => Promise.resolve(),
    getPageCount: () => 10,
    getPageSize: () => ({ width: 600, height: 800 }),
    renderPage: () => Promise.resolve(canvas),
    dispose: () => {},
  };
}

let mockRegistry: PageRegistryWrite;
let registerSpy: ReturnType<typeof vi.fn<(pageIndex: number, entry: PageRegistryEntry) => void>>;
let unregisterSpy: ReturnType<typeof vi.fn<(pageIndex: number) => void>>;

beforeEach(() => {
  registerSpy = vi.fn<(pageIndex: number, entry: PageRegistryEntry) => void>();
  unregisterSpy = vi.fn<(pageIndex: number) => void>();
  mockRegistry = { register: registerSpy, unregister: unregisterSpy };
});

function withRegistry(children: ReactNode) {
  return (
    <PageRegistryWriteContext.Provider value={mockRegistry}>
      {children}
    </PageRegistryWriteContext.Provider>
  );
}

describe('PageRenderer — PageRegistry wiring', () => {
  it('registers canvas + element with the registry after page renders', async () => {
    const source = makeStubSource();
    render(withRegistry(<PageRenderer source={source} pageIndex={3} scale={1} />));

    await waitFor(() => expect(registerSpy).toHaveBeenCalledTimes(1));
    const [pageIndex, entry] = registerSpy.mock.calls[0];
    expect(pageIndex).toBe(3);
    expect(entry.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(entry.element).toBeInstanceOf(HTMLDivElement);
  });

  it('unregisters on unmount', async () => {
    const source = makeStubSource();
    const { unmount } = render(withRegistry(<PageRenderer source={source} pageIndex={5} scale={1} />));

    await waitFor(() => expect(registerSpy).toHaveBeenCalled());
    unmount();
    expect(unregisterSpy).toHaveBeenCalledWith(5);
  });

  it('renders without a registry provider (optional-chaining contract)', async () => {
    const source = makeStubSource();
    // No provider → useContext returns null → registry?.register is a no-op.
    expect(() => render(<PageRenderer source={source} pageIndex={0} scale={1} />)).not.toThrow();
    // Wait briefly for render-effect; should not throw on missing registry.
    await new Promise((r) => setTimeout(r, 50));
  });
});
