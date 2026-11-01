"use server";

import { getServiceClient } from "@/lib/supabase/server";
import { normalizeCode } from "@/lib/join";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

/** RPC checks token, review deadline, challenges, and expected index atomically. */
export async function autoAdvance(code: string, token: string, expectedIndex: number): Promise<boolean> {
  if (!Number.isInteger(expectedIndex) || expectedIndex < 0) return false;
  const room = normalizeCode(code);
  const { data, error } = await getServiceClient().rpc("auto_advance_question", {
    p_token: token, p_code: room, p_expected_index: expectedIndex,
  });
  if (error) throw new Error(`Could not advance: ${error.message}`);
  if (data) await broadcastToRoom(room, ROOM_EVENTS.question, { index: expectedIndex + 1 });
  return !!data;
}

export async function setReviewAutoAdvance(code: string, token: string, expectedIndex: number, enabled: boolean): Promise<boolean> {
  if (!Number.isInteger(expectedIndex) || expectedIndex < 0) return false;
  const room = normalizeCode(code);
  const { data, error } = await getServiceClient().rpc("set_review_auto_advance", {
    p_token: token, p_code: room, p_expected_index: expectedIndex, p_enabled: enabled,
  });
  if (error) throw new Error(`Could not update auto-advance: ${error.message}`);
  if (data) await broadcastToRoom(room, ROOM_EVENTS.review, { index: expectedIndex });
  return !!data;
}
