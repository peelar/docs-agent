import Link from "next/link";

import { Button } from "@/components/ui/button";
import { NotFoundState } from "../components/state-panel";

export default function NotFound() {
  return (
    <NotFoundState
      action={
        <Button asChild>
          <Link href="/status">Return to Status</Link>
        </Button>
      }
    />
  );
}
