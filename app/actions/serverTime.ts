"use server";
// U6. Authoritative server time for the client clock-offset handshake (KTD9).
// Clients measure their offset against this once on connect and render the
// countdown corrected by it, so a skewed device clock still shows the real
// submit window.

export async function serverNow(): Promise<number> {
  return Date.now();
}
