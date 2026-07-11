import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PrimaryNav } from "./primary-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid min-h-svh grid-cols-1 lg:grid-cols-[17.5rem_minmax(0,1fr)]"
      data-app-shell
    >
      <a
        className="fixed top-3 left-3 z-50 -translate-y-40 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-transform focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>

      <aside
        className="sticky top-0 z-10 grid grid-cols-[auto_1fr] items-center border-b border-foreground/20 bg-card/90 px-4 py-3 backdrop-blur-xl lg:flex lg:h-svh lg:flex-col lg:items-stretch lg:border-r lg:border-b-0 lg:px-5 lg:py-6"
        data-shell-sidebar
      >
        <Link
          className="flex w-fit items-center gap-3 rounded-md"
          href="/"
          aria-label="Docs Agent home"
        >
          <span
            className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full border border-foreground/25 bg-background"
            aria-hidden="true"
          >
            <Image className="size-full object-cover" src="/paige-magpie.png" alt="" width={128} height={128} priority />
          </span>
          <span className="grid gap-0.5 max-sm:hidden">
            <span className="font-heading text-xl leading-none font-semibold tracking-tight">Docs Agent</span>
            <span className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">by Paige</span>
          </span>
        </Link>

        <PrimaryNav />

        <div className="mt-auto hidden rounded-xl border border-foreground/15 bg-background/60 p-4 lg:grid lg:gap-1.5">
          <span className="font-mono text-[0.64rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">Workspace</span>
          <p className="font-heading text-lg font-semibold">Local operator</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-[#9aaa79] shadow-[0_0_0_3px_rgba(154,170,121,0.2)]" />
            Environment-backed
          </div>
        </div>
      </aside>

      <div className="grid min-w-0 grid-rows-[auto_1fr_auto]">
        <header className="flex min-h-20 items-center justify-between gap-4 border-b px-[clamp(1.4rem,4vw,4rem)] py-4">
          <div className="grid gap-0.5">
            <p className="font-mono text-[0.68rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">Control plane</p>
            <strong className="font-heading font-semibold max-sm:hidden">Documentation operations</strong>
          </div>
          <Badge className="gap-2 border-foreground/15 bg-card text-foreground" variant="outline">
            <span className="size-2 rounded-full bg-[#9aaa79] shadow-[0_0_0_3px_rgba(154,170,121,0.2)]" />
            Local only
          </Badge>
        </header>

        <main
          className="w-full max-w-[94rem] px-[clamp(1.4rem,6vw,6rem)] py-[clamp(2rem,6vw,6rem)] focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-accent"
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </main>

        <footer className="px-[clamp(1.4rem,4vw,4rem)] pb-4">
          <Separator />
          <div className="flex justify-between gap-4 pt-4 font-mono text-[0.64rem] font-bold tracking-[0.1em] text-muted-foreground uppercase max-sm:flex-col">
            <span>Evidence before edits</span>
            <span>Single workspace</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
