"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BookOpenIcon,
  BotIcon,
  CheckCircle2Icon,
  ListTreeIcon,
  MenuIcon,
  Settings2Icon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const navigation = [
  { label: "Sessions", icon: ListTreeIcon, href: "/sessions" },
  { label: "Repositories", icon: BookOpenIcon, href: "/" },
  { label: "Chat", icon: BotIcon, href: "/agent" },
  { label: "Approvals", icon: CheckCircle2Icon },
];

export function OperatorShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-muted/20 text-foreground">
      <header className="sticky top-0 z-40 flex h-14 items-center border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <MobileNavigation />
        <Brand className="ml-3" />
      </header>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-background md:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <Separator />
        <Navigation className="flex-1 p-3" />
        <div className="p-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground" />
              }
            >
              <Settings2Icon className="size-4" />
              Settings
              <span className="ml-auto text-[10px] text-muted-foreground/70">Soon</span>
            </TooltipTrigger>
            <TooltipContent side="right">This view is not available yet.</TooltipContent>
          </Tooltip>
        </div>
        <Separator />
        <div className="p-4">
          <p className="text-xs font-medium">Paige operator</p>
        </div>
      </aside>

      <main className="min-h-[calc(100svh-3.5rem)] md:min-h-svh md:pl-60">
        {children}
      </main>
    </div>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link className={cn("flex items-center gap-2.5", className)} href="/">
      <span className="grid size-7 place-items-center overflow-hidden rounded-md border bg-white">
        <Image src="/paige-magpie.png" alt="" width={24} height={24} priority />
      </span>
      <span className="text-sm font-semibold tracking-tight">Paige</span>
    </Link>
  );
}

function Navigation({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav className={cn("space-y-1", className)} aria-label="Operator navigation">
      <p className="mb-2 px-2.5 text-[11px] font-medium text-muted-foreground">Manage</p>
      {navigation.map((item) => {
        const Icon = item.icon;
        if (item.href) {
          const active = item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              href={item.href}
              key={item.label}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        }

        return (
          <Tooltip key={item.label}>
            <TooltipTrigger
              render={
                <span className="flex cursor-default items-center gap-3 rounded-md px-2.5 py-2 text-sm text-muted-foreground" />
              }
            >
              <Icon className="size-4" />
              {item.label}
              <span className="ml-auto text-[10px] text-muted-foreground/70">Soon</span>
            </TooltipTrigger>
            <TooltipContent side="right">This view is not available yet.</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function MobileNavigation() {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="outline" size="icon" aria-label="Open navigation" />}
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b p-5 text-left">
          <SheetTitle><Brand /></SheetTitle>
          <SheetDescription>Manage Paige and its repository access.</SheetDescription>
        </SheetHeader>
        <Navigation className="p-3" />
      </SheetContent>
    </Sheet>
  );
}
