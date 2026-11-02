/** Only owner-configured destinations; game data never enters these URLs. */
export function parseTipJar(venmoUsername?: string, stripeUrl?: string) {
  const venmo = venmoUsername && !/[^A-Za-z0-9_-]/.test(venmoUsername)
    ? `https://venmo.com/u/${encodeURIComponent(venmoUsername)}`
    : null;
  let stripe: string | null = null;
  if (stripeUrl) {
    try {
      const url = new URL(stripeUrl);
      if (url.protocol === "https:" && url.hostname === "buy.stripe.com" &&
          !url.username && !url.password && !url.port) {
        stripe = url.href;
      }
    } catch { /* Invalid owner configuration is hidden. */ }
  }
  return { venmo, stripe };
}

// Direct references are inlined by Next.js at build time on server and client.
export const tipJar = parseTipJar(
  process.env.NEXT_PUBLIC_TIP_VENMO_USERNAME,
  process.env.NEXT_PUBLIC_TIP_STRIPE_URL,
);
