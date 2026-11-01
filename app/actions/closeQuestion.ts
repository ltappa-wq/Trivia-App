"use server";

import { authorizePacingToken } from "@/lib/participantAuth";
import { getServiceClient } from "@/lib/supabase/server";
import { normalizeCode } from "@/lib/join";
import { broadcastToRoom } from "@/lib/realtime/broadcast";
import { ROOM_EVENTS } from "@/lib/realtime/events";

export type CloseQuestionResult =
  | { status: "reviewing"; index: number }
  | { status: "noop" };

/** Any participant may request timer close; only a host may force an early close.
 * The RPC authorizes the token and checks deadline + phase under the game lock. */
export async function closeQuestion(
  code: string,
  token: string,
  expectedIndex: number,
  force = false,
): Promise<CloseQuestionResult> {
  if (!Number.isInteger(expectedIndex) || expectedIndex < 0) return { status: "noop" };
  const roomCode = normalizeCode(code);
  await authorizePacingToken(getServiceClient(), token, force);
  const { data, error } = await getServiceClient().rpc("close_question", {
    p_token: token,
    p_code: roomCode,
    p_expected_index: expectedIndex,
    p_force: force,
  });
  if (error) throw new Error(`Could not close question: ${error.message}`);
  if (!data) return { status: "noop" };
  await broadcastToRoom(roomCode, ROOM_EVENTS.review, { index: expectedIndex });
  return { status: "reviewing", index: expectedIndex };
}
