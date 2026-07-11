import Link from "next/link";

export default function Home() {
  return (
    <div className="entry-layout">
      <section className="entry-hero" aria-labelledby="entry-title">
        <p className="section-label">Local operator preview</p>
        <h1 id="entry-title">Keep the story as current as the product.</h1>
        <p className="entry-summary">
          This control plane will make Docs Agent&apos;s readiness and evidence
          legible without turning the runtime into a dashboard.
        </p>
        <div className="entry-actions">
          <Link className="button button-primary" href="/status">
            Open Local Preview
            <span aria-hidden="true">↗</span>
          </Link>
          <Link className="button button-secondary" href="/signals">
            View Signal Space
          </Link>
        </div>
      </section>

      <aside className="entry-note" aria-label="Preview boundary">
        <div className="entry-note-rule" aria-hidden="true" />
        <p className="entry-note-index">Foundation / 01</p>
        <h2>A shell before the services.</h2>
        <p>
          Navigation and interface states are available for local review.
          Authentication and workspace data are intentionally not connected.
        </p>
      </aside>
    </div>
  );
}
