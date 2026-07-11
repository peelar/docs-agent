import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { PrimaryNav } from "./primary-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell" data-app-shell>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <aside className="shell-sidebar" data-shell-sidebar>
        <Link className="brand" href="/" aria-label="Docs Agent home">
          <span className="brand-mark" aria-hidden="true">
            <Image src="/paige-magpie.png" alt="" width={128} height={128} priority />
          </span>
          <span className="brand-copy">
            <span className="brand-name">Docs Agent</span>
            <span className="brand-role">by Paige</span>
          </span>
        </Link>

        <PrimaryNav />

        <div className="workspace-card">
          <span>Workspace</span>
          <p>Local preview</p>
          <div className="workspace-card-status">Shell available</div>
        </div>
      </aside>

      <div className="shell-stage">
        <header className="shell-topbar">
          <div className="topbar-context">
            <p className="eyebrow">Control plane</p>
            <strong>Documentation operations</strong>
          </div>
          <div className="mode-badge">Local preview</div>
        </header>

        <main className="shell-main" id="main-content" tabIndex={-1}>
          {children}
        </main>

        <footer className="shell-footer">
          <span>Evidence before edits</span>
          <span>Single workspace</span>
        </footer>
      </div>
    </div>
  );
}
