// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(cleanup);

import { ErrorBoundary } from '../components/ErrorBoundary';

// React logs caught errors via console.error. Suppress per-test to keep
// output clean. Wrapped in a helper so each test scopes its silencing.
function withSuppressedConsoleError(fn: () => void) {
  const original = console.error;
  console.error = vi.fn();
  try {
    fn();
  } finally {
    console.error = original;
  }
}

function Thrower({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok">all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('ok')).toBeTruthy();
    expect(screen.getByText('all good')).toBeTruthy();
  });

  it('renders the default fallback when a child throws', () => {
    withSuppressedConsoleError(() => {
      render(
        <ErrorBoundary>
          <Thrower message="kaboom" />
        </ErrorBoundary>,
      );

      // Default fallback: <div role="alert" className="fbjs-error"> with two <p>s
      const alert = screen.getByRole('alert');
      expect(alert).toBeTruthy();
      expect(alert.className).toBe('fbjs-error');
      expect(screen.getByText('Something went wrong')).toBeTruthy();
      expect(screen.getByText('kaboom')).toBeTruthy();
    });
  });

  it('renders a custom fallback when the prop is provided', () => {
    withSuppressedConsoleError(() => {
      render(
        <ErrorBoundary
          fallback={(err) => <div data-testid="custom-fallback">{err.message}</div>}
        >
          <Thrower message="custom boom" />
        </ErrorBoundary>,
      );

      expect(screen.getByTestId('custom-fallback')).toBeTruthy();
      expect(screen.getByText('custom boom')).toBeTruthy();
      // Default fallback should NOT have rendered
      expect(screen.queryByText('Something went wrong')).toBeNull();
    });
  });
});
