// frontend/src/chargeCredits.ts
import { supabase } from './supabaseClient'

export interface ChargeResult {
  success: boolean
  newBalanceWei: bigint | null
  message: string
}

// idempotencyKey should be generated ONCE per logical charge attempt (e.g.
// once at the start of a single handleSubmit/openLayout/chargeForRecipeView
// invocation) and passed through here. If the RPC's response is lost to the
// client (network drop, timeout) and the SAME invocation is retried with the
// SAME key, charge_credits (migration 038) replays the original result
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
  if (!supabase) return { success: false, newBalanceWei: null, message: 'no_supabase' }

  const { data, error } = await supabase
    .rpc('charge_credits', {
      p_wallet_address: walletAddress.toLowerCase(),
      p_action_type: actionType,
      p_session_token: sessionToken,
      p_idempotency_key: idempotencyKey ?? null,
    })
    .single()

  if (error || !data) {
    return { success: false, newBalanceWei: null, message: error?.message ?? 'charge_failed' }
  }

  // new_balance_wei comes back as text (see migration 037) — same
  // precision consideration as get_wallet_balance (migration 036):
  // a JSON number above Number.MAX_SAFE_INTEGER loses precision before
  // BigInt() ever sees it, so the RPC returns a numeric string instead.
  const row = data as { success: boolean; new_balance_wei: string | null; message: string }
  return {
    success: row.success,
    newBalanceWei: row.new_balance_wei !== null ? BigInt(row.new_balance_wei) : null,
    message: row.message,
  }
}
