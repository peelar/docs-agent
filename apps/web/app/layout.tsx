import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";

import { OperatorShell } from "@/components/operator-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Paige operator",
  description: "Inspect Paige sessions and configure its documentation repository.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn(geist.variable, geistMono.variable)}>
      <body>
        <div className="isolate">
          <TooltipProvider>
            <OperatorShell>{children}</OperatorShell>
          </TooltipProvider>
        </div>
      </body>
    </html>
  );
}
