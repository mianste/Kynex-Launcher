export function CatalogLoading({ label }) {
  return (
    <div
      className="resource-loading catalog-loading"
      role="status"
      aria-label={label}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div className="resource-skeleton-row" key={index}>
          <i />
          <span>
            <b />
            <small />
            <small />
          </span>
        </div>
      ))}
    </div>
  );
}
