export function LoadingState() {
  return (
    <div className="fbjs-loading" role="status">
      <div className="fbjs-loading-spinner" aria-hidden="true" />
      <span className="fbjs-loading-label">Loading…</span>
    </div>
  );
}
