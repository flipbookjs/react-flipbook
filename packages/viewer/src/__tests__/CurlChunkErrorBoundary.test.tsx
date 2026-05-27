// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { CurlChunkErrorBoundary } from '../curl/CurlChunkErrorBoundary';

function Boom(): never {
  throw new Error('synthetic curl chunk failure');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CurlChunkErrorBoundary', () => {
  it('renders children when no error', () => {
    const { container } = render(
      <CurlChunkErrorBoundary>
        <div data-testid="ok">curl content</div>
      </CurlChunkErrorBoundary>,
    );
    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
  });

  it('renders null and logs dev warning when a child throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // React logs error boundary catches to console.error in dev — suppress.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { container } = render(
      <CurlChunkErrorBoundary>
        <Boom />
      </CurlChunkErrorBoundary>,
    );

    expect(container.innerHTML).toBe('');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('curl chunk failed'),
      expect.any(Error),
      expect.any(Object),
    );
  });

  it('does NOT auto-reset on re-render with new children (error state persists)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { container, rerender } = render(
      <CurlChunkErrorBoundary>
        <Boom />
      </CurlChunkErrorBoundary>,
    );

    expect(container.innerHTML).toBe('');

    rerender(
      <CurlChunkErrorBoundary>
        <div data-testid="recovered">curl recovered</div>
      </CurlChunkErrorBoundary>,
    );

    // Default React error-boundary behavior: state persists; no auto-reset.
    expect(container.querySelector('[data-testid="recovered"]')).toBeNull();
  });
});
