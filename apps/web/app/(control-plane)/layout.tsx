import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "../../components/app-shell";
import { getCurrentOperator } from "@/lib/operator";

export const dynamic = "force-dynamic";

export default async function ControlPlaneLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const access = await getCurrentOperator();
  if (access.status === "unauthorized") redirect("/sign-in");
  if (access.status === "forbidden") redirect("/forbidden");
  if (access.status === "unavailable") {
    throw new Error(access.message);
  }
  return <AppShell operator={access.principal}>{children}</AppShell>;
}
