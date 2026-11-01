"use client";

import { QRCodeSVG } from "qrcode.react";

/** Absolute join URL supplied by the caller; reusable on host/presenter screens. */
export function JoinQrCode({ url, label = "Scan to join this trivia game" }: { url: string; label?: string }) {
  return <QRCodeSVG value={url} size={320} level="M" marginSize={4}
    bgColor="#ffffff" fgColor="#000000" role="img"
    title={label} aria-label={label}
    style={{ display: "block", width: "min(320px, 100%)", height: "auto" }} />;
}
