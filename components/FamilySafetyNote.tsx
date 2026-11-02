"use client";

import { useEffect, useState } from "react";
import { getFamilySafetySummary } from "@/app/actions/familySafety";

export function FamilySafetyNote({ code, token, refreshKey }: { code: string; token: string; refreshKey: string }) {
  const [summary, setSummary] = useState<{ enabled: boolean; replaced: number } | null>(null);
  useEffect(() => {
    let active = true;
    void getFamilySafetySummary(code, token).then(value => { if (active) setSummary(value); }).catch(() => {});
    return () => { active = false; };
  }, [code, token, refreshKey]);
  if (!summary?.enabled) return null;
  return <aside aria-label="Family-friendly game">
    <span>Family-friendly</span>
    {summary.replaced > 0 && <p role="status">{summary.replaced} {summary.replaced === 1 ? "question was" : "questions were"} replaced to keep it family-friendly.</p>}
  </aside>;
}
