"use client";

import { ErrorState } from "../components/state-panel";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ErrorState
      action={
        <button className="button button-primary" onClick={reset} type="button">
          Try This View Again
        </button>
      }
    />
  );
}
