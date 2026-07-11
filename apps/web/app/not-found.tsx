import Link from "next/link";

import { NotFoundState } from "../components/state-panel";

export default function NotFound() {
  return (
    <NotFoundState
      action={
        <Link className="button button-primary" href="/status">
          Return to Status
        </Link>
      }
    />
  );
}
