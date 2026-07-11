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
    <header className="grid max-w-5xl items-end gap-6 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.45fr)]">
      <div>
        <p className="font-mono text-[0.68rem] font-bold tracking-[0.12em] text-accent uppercase">
          Workspace / {index}
        </p>
        <h1 className="mt-5 font-heading text-[clamp(3.6rem,7vw,7rem)] leading-[0.9] font-medium tracking-[-0.055em] text-balance">
          {title}
        </h1>
      </div>
      <p className="pb-2 leading-7 text-muted-foreground">{summary}</p>
    </header>
  );
}
