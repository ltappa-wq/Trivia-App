import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fredoka } from "next/font/google";
import "./globals.css";

// Fredoka (rounded, playful) drives headings, buttons, and scores per the UX
// refresh; body/inputs keep the existing system stack. Self-hosted via next/font
// so there is no external font request at runtime.
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Buzzr",
  description: "Live, AI-generated multiplayer trivia.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fredoka.variable}>
      <body>{children}</body>
    </html>
  );
}
