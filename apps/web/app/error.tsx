"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "../components/state-panel";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      action={
        <Button onClick={reset} type="button">
          Try This View Again
        </Button>
      }
    />
  );
}
