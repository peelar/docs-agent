export function PageHeading({
  index,
  title,
  summary,
}: {
  index: string;
  title: string;
  summary: string;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="section-label">Workspace / {index}</p>
        <h1>{title}</h1>
      </div>
      <p className="page-heading-summary">{summary}</p>
    </header>
  );
}
