"use client";
import { useEffect, useState } from "react";

/** Rotate presentation pages only; this never changes the game's phase/index. */
export function useDisplayPage(count: number, size: number, scope: string) {
  const pages = Math.max(1, Math.ceil(count / size));
  const [cursor, setCursor] = useState({ scope, page: 0 });
  const page = cursor.scope === scope ? cursor.page % pages : 0;
  useEffect(() => {
    if (pages <= 1) return;
    const timer = setInterval(() => setCursor(previous => ({ scope,
      page: previous.scope === scope ? (previous.page + 1) % pages : 1,
    })), 8000);
    return () => clearInterval(timer);
  }, [pages, scope]);
  return { start: page * size, page: page + 1, pages };
}
