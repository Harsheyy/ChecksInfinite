// frontend/src/chargeCredits.ts
import { supabase } from './supabaseClient'

export interface ChargeResult {
  success: boolean
  newBalance: number | null
  message: string
}

// idempotencyKey should be generated ONCE per logical charge attempt (e.g.
// once at the start of a single handleSubmit/openLayout/chargeForRecipeView
// invocation) and passed through here. If the RPC's response is lost to the
// client (network drop, timeout) and the SAME invocation is retried with the
// SAME key, charge_credits (migration 038/039) replays the original result
// instead of charging twice. A fresh manual re-click/re-submit is a new
// logical attempt and should get a new key — that's expected, not a gap:
// it protects specifically against response loss, not against the user
// intentionally trying again.
export async function chargeCredits(
  walletAddress: string,
  sessionToken: string,
  actionType: 'search_query' | 'recipe_view',
  idempotencyKey?: string
): Promise<ChargeResult> {
  if (!supabase) return { success: false, newBalance: null, message: 'no_supabase' }

  const { data, error } = await supabase
    .rpc('charge_credits', {
      p_wallet_address: walletAddress.toLowerCase(),
      p_action_type: actionType,
      p_session_token: sessionToken,
      p_idempotency_key: idempotencyKey ?? null,
    })
    .single()

  if (error || !data) {
    return { success: false, newBalance: null, message: error?.message ?? 'charge_failed' }
  }

  // Credits are small enough magnitudes (max realistic balance ~50, in
  // 0.5 increments) that a plain JS number has no precision concern the
  // way wei amounts did — charge_credits returns numeric directly.
  const row = data as { success: boolean; new_balance: number | null; message: string }
  return {
    success: row.success,
    newBalance: row.new_balance,
    message: row.message,
  }
}
