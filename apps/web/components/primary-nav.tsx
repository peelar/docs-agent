"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { href: "/status", label: "Status", glyph: "status" },
  { href: "/signals", label: "Signals", glyph: "signals" },
] as const;

export function PrimaryNav() {
  const pathname = usePathname();

  return (
    <nav className="primary-nav" aria-label="Primary" data-shell-nav>
      <p className="nav-label">Workspace</p>
      {navigation.map((item) => {
        const isCurrent = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            className="nav-link"
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            key={item.href}
          >
            <span
              className={`nav-glyph nav-glyph-${item.glyph}`}
              aria-hidden="true"
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
