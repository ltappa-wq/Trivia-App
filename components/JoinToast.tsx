"use client";
// U9 / R2. Host-lobby join announcements: each new player pops in as a bouncing
// name box (R2.1) and settles out on its own. Purely presentational — the queue
// and expiry live in useJoinAnnouncements (KTD6). Multiple rapid joins stack
// rather than overlap (R2.3).

import type { JoinAnnouncement } from "@/lib/realtime/hooks";

export function JoinToast({ items }: { items: JoinAnnouncement[] }) {
  if (items.length === 0) return null;
  return (
    <div className="join-toasts" aria-live="polite">
      {items.map((it) => (
        <div key={it.key} className="join-toast">
          <span className="join-toast__name">{it.username}</span> joined 🎉
        </div>
      ))}
    </div>
  );
}
