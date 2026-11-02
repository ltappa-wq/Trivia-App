import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/fredoka/latin-500.css";
import "@fontsource/fredoka/latin-600.css";
import "@fontsource/fredoka/latin-700.css";
import "./globals.css";

// Bundle Fredoka locally so builds and fixture tests need no Google font fetch.
export const metadata: Metadata = {
  title: "Buzzr",
  description: "Live, AI-generated multiplayer trivia.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
