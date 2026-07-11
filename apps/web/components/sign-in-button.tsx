"use client";

import { GitBranch } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignInButton() {
  const [pending, setPending] = useState(false);

  return (
    <Button
      className="w-full gap-2"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await authClient.signIn.social({
          provider: "github",
          callbackURL: "/",
          errorCallbackURL: "/forbidden",
        });
        if (result.error) setPending(false);
      }}
      type="button"
    >
      <GitBranch aria-hidden="true" />
      {pending ? "Opening GitHub…" : "Continue with GitHub"}
    </Button>
  );
}
