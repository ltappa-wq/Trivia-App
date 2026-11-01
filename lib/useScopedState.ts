"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

/** Reset local state during render when its owning question/phase changes.
 * This prevents a stale frame and avoids an effect-driven reset render. */
export function useScopedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [scope, setScope] = useState(key);
  const [value, setValue] = useState(initial);
  if (scope !== key) {
    setScope(key);
    setValue(() => initial);
    return [initial, setValue];
  }
  return [value, setValue];
}
