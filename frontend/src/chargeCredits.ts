// frontend/src/chargeCredits.ts
import { supabase } from './supabaseClient'

export interface ChargeResult {
  success: boolean
  newBalanceWei: bigint | null
  message: string
}

export async function chargeCredits(
  walletAddress: string,
  sessionToken: string,
  actionType: 'search_query' | 'recipe_view'
): Promise<ChargeResult> {
  if (!supabase) return { success: false, newBalanceWei: null, message: 'no_supabase' }

  const { data, error } = await supabase
    .rpc('charge_credits', {
      p_wallet_address: walletAddress.toLowerCase(),
      p_action_type: actionType,
      p_session_token: sessionToken,
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
