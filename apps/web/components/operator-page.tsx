import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function OperatorPage({
  className,
  ...props
}: ComponentPropsWithoutRef<"section">) {
  return (
    <section
      className={cn(
        "flex min-h-[calc(100svh-3.5rem)] flex-col bg-muted/20 md:min-h-svh",
        className,
      )}
      {...props}
    />
  );
}

export function OperatorPageHeader({
  actions,
  description,
  leading,
  title,
  titleAccessory,
  titleId,
}: {
  actions?: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  title: ReactNode;
  titleAccessory?: ReactNode;
  titleId: string;
}) {
  return (
    <header className="shrink-0 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {leading ? <div className="shrink-0">{leading}</div> : null}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-medium" id={titleId}>
                {title}
              </h1>
              {titleAccessory}
            </div>
            {description ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
    </header>
  );
}

export function OperatorPageContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14",
        className,
      )}
      {...props}
    />
  );
}
