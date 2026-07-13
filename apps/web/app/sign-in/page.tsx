import Image from "next/image";

import { SignInButton } from "@/components/sign-in-button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 py-12">
      <Card className="w-full max-w-md border-foreground/20 bg-card/95 shadow-2xl shadow-foreground/5">
        <CardHeader className="items-center gap-4 text-center">
          <span className="grid size-20 place-items-center overflow-hidden rounded-full border border-foreground/20 bg-background">
            <Image src="/paige-magpie.png" alt="" width={160} height={160} priority />
          </span>
          <div className="grid gap-2">
            <p className="font-mono text-[0.68rem] font-bold tracking-[0.12em] text-muted-foreground uppercase">
              Single operator workspace
            </p>
            <h1 className="font-heading text-3xl font-medium leading-snug">
              Sign in to Paige
            </h1>
            <CardDescription className="text-sm leading-6">
              Use an approved GitHub account. There is no public signup.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <SignInButton />
        </CardContent>
      </Card>
    </main>
  );
}
