import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="grid items-end gap-[clamp(3rem,8vw,8rem)] lg:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.65fr)]">
      <section className="max-w-4xl" aria-labelledby="entry-title">
        <p className="font-mono text-[0.68rem] font-bold tracking-[0.12em] text-accent uppercase">Operator control plane</p>
        <h1
          className="mt-6 max-w-[11ch] font-heading text-[clamp(3.8rem,8vw,8rem)] leading-[0.88] font-medium tracking-[-0.055em] text-balance"
          id="entry-title"
        >
          Keep the story as current as the product.
        </h1>
        <p className="mt-9 max-w-2xl text-[clamp(1.05rem,1.8vw,1.3rem)] leading-8 text-muted-foreground text-pretty">
          Readiness and evidence live here without turning the runtime into a
          generic dashboard.
        </p>
        <div className="mt-9 flex flex-wrap gap-3 max-sm:grid">
          <Button asChild size="lg">
            <Link href="/status">
              Review Status
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/signals">View Signal Space</Link>
          </Button>
        </div>
      </section>

      <Card className="relative overflow-hidden border-foreground/25 bg-card/80 shadow-[0_22px_70px_rgba(28,43,38,0.1)]" aria-label="Product boundary">
        <div className="absolute top-0 left-6 h-0.75 w-16 bg-accent" aria-hidden="true" />
        <CardContent className="p-6">
          <p className="mb-10 font-mono text-[0.68rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">First delivery / 01</p>
          <h2 className="font-heading text-3xl leading-none font-medium tracking-[-0.04em]">Evidence before action.</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Readiness and evidence stay read-only. Workspace setup changes pass
            a visible preflight and retain the operator who saved them.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
