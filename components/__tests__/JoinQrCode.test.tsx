// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { QRCodeSVG } from "qrcode.react";
import { JoinQrCode } from "@/components/JoinQrCode";
it("renders an accessible QR encoding the exact absolute join URL", () => {
  const url = "https://buzzr.example/join?code=12345";
  const view = render(<JoinQrCode url={url} />);
  expect(screen.getByRole("img", { name: "Scan to join this trivia game" }).tagName.toLowerCase()).toBe("svg");
  const path = view.container.querySelectorAll("path")[1].getAttribute("d");
  view.unmount();
  const expected = render(<QRCodeSVG value={url} size={320} level="M" marginSize={4} />);
  expect(expected.container.querySelectorAll("path")[1].getAttribute("d")).toBe(path);
});
