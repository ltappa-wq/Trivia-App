"use server";
// Collect end-of-game feedback and email it via Resend.

import { Resend } from "resend";
import { getServiceClient } from "@/lib/supabase/server";
import { checkSharedRateLimit } from "@/lib/rateLimit";
import { callerIp } from "@/lib/serverRequest";

const FEEDBACK_LIMIT = 5;
const FEEDBACK_WINDOW_MS = 60_000;
const MAX_LEN = 2000;
const DEFAULT_TO = "ltappa@gmail.com";

export async function submitFeedback(input: {
  message: string;
  roomCode?: string | null;
}): Promise<{ sent: true }> {
  const message = (input.message ?? "").trim();
  if (!message) throw new Error("Enter some feedback first");
  if (message.length > MAX_LEN) {
    throw new Error(`Feedback must be ${MAX_LEN} characters or fewer`);
  }

  const supabase = getServiceClient();
  if (
    !(await checkSharedRateLimit(
      supabase,
      `feedback:${await callerIp()}`,
      FEEDBACK_LIMIT,
      FEEDBACK_WINDOW_MS,
    ))
  ) {
    throw new Error("Too many feedback submissions — please wait a moment.");
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Feedback email is not configured (missing RESEND_API_KEY)");
  }

  const to = process.env.FEEDBACK_TO_EMAIL?.trim() || DEFAULT_TO;
  const from =
    process.env.RESEND_FROM?.trim() || "BUZZR Trivia <onboarding@resend.dev>";

  const room = input.roomCode?.trim() ? input.roomCode.trim().toUpperCase() : "n/a";
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject: `BUZZR feedback${room !== "n/a" ? ` · room ${room}` : ""}`,
    text: [
      `Room: ${room}`,
      `When: ${new Date().toISOString()}`,
      "",
      message,
    ].join("\n"),
  });
  if (error) {
    throw new Error(error.message || "Could not send feedback");
  }
  return { sent: true };
}
