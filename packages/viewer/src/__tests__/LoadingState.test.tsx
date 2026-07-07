// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingState } from '../components/LoadingState';

describe('LoadingState — a11y contract', () => {
  it('exposes role=status without redundant ARIA attributes', () => {
    render(<LoadingState />);
    const status = screen.getByRole('status');
    // role="status" carries an implicit aria-live="polite"; an explicit
    // aria-live would be redundant, and dropping aria-label was the whole
    // point of the switch from the old `<div aria-label="Loading document">`
    // anti-pattern. Pin both to prevent drift.
    expect(status).not.toHaveAttribute('aria-label');
    expect(status).not.toHaveAttribute('aria-live');
    expect(status.querySelector('.fbjs-loading-spinner')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});
