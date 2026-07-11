"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function OperatorMenu({
  displayName,
  githubLogin,
  canSignOut,
}: {
  displayName: string;
  githubLogin: string;
  canSignOut: boolean;
}) {
  const [pending, setPending] = useState(false);

  return (
    <div className="flex items-center gap-3">
      <div className="grid text-right leading-tight max-sm:hidden">
        <span className="text-sm font-semibold">{displayName}</span>
        <span className="font-mono text-[0.64rem] text-muted-foreground">@{githubLogin}</span>
      </div>
      {canSignOut ? (
        <Button
          aria-label="Sign out"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await authClient.signOut({
              fetchOptions: {
                onSuccess: () => window.location.assign("/sign-in"),
                onError: () => setPending(false),
              },
            });
          }}
          size="icon"
          type="button"
          variant="outline"
        >
          <LogOut aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
