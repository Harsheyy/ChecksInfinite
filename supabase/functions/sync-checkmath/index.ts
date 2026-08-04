/**
 * sync-checkmath — Supabase Edge Function
 *
 * Hourly: compute the Checkmath numbers (cheapest single, optimal
 * combination, sweep prices for both Checks VV and Checks Editions) and
 * insert one row into checkmath_snapshots.
 *
 * Merge-cost model: Checks VV composites are a strict binary tree — every
 * composite burns two same-tier tokens and produces one token at the next
 * tier (verified against Source/checks.sol's _composite, and matching
 * backend/lib/engine.ts's DIVISORS constant). Reaching one checks_count=1
 * token therefore always costs exactly 2^6 = 64 base (checks_count=80)
 * tokens, regardless of what checksCount label each tier carries. So the
 * per-tier weight is 2^divisorIndex, not 80/checksCount (the bug in the
 * original Checkmath, which also — because of it — excluded checks_count=1
 * tokens from ever being selected as part of a combination, since weight 80
 * could never fit a target of 64).
 *
 * Deploy:   supabase functions deploy sync-checkmath
 * Schedule: supabase/migrations/045_checkmath_cron.sql (pg_cron, hourly at :30 —
 *           after sync-market-prices at :15 and sync-editions-prices at :20)
 * Manual:   POST /functions/v1/sync-checkmath with header x-cron-secret: <CRON_SECRET>
 *
 * Required secrets (set in Supabase dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DIVISORS = [80, 40, 20, 10, 5, 4, 1] as const
const WEIGHT_BY_CHECKS_COUNT: Record<number, number> = Object.fromEntries(
  DIVISORS.map((count, i) => [count, 2 ** i]),
) // {80:1, 40:2, 20:4, 10:8, 5:16, 4:32, 1:64}
const TARGET = 64
const SWEEP_SIZE = 64

interface PricedToken {
  tokenId: number
  ethPrice: number
}

interface CombinationItem {
  tokenId: number
  checksCount: number
  ethPrice: number
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('CRON_SECRET not set — rejecting request')
    return new Response('CRON_SECRET not configured', { status: 500 })
  }
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', cronSecret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    // ── 1. Load listed, non-burned Checks VV tokens ────────────────────────────
    const { data: checksRows, error: checksErr } = await supabase
      .from('all_checks')
      .select('token_id, checks_count, eth_price')
      .eq('is_listed', true)
      .eq('is_burned', false)
      .not('eth_price', 'is', null)
    if (checksErr) throw checksErr

    const checksTokens: (PricedToken & { checksCount: number })[] = (checksRows ?? []).map(
      (r: { token_id: number; checks_count: number; eth_price: number }) => ({
        tokenId: r.token_id,
        checksCount: r.checks_count,
        ethPrice: r.eth_price,
      }),
    )

    // ── 2. Load listed Editions tokens ──────────────────────────────────────────
    const { data: editionsRows, error: editionsErr } = await supabase
      .from('editions_checks')
      .select('token_id, eth_price')
      .eq('is_listed', true)
      .not('eth_price', 'is', null)
    if (editionsErr) throw editionsErr

    const editionsTokens: PricedToken[] = (editionsRows ?? []).map(
      (r: { token_id: number; eth_price: number }) => ({ tokenId: r.token_id, ethPrice: r.eth_price }),
    )

    // ── 3. Cheapest single ──────────────────────────────────────────────────────
    const singles = checksTokens.filter(t => t.checksCount === 1).sort((a, b) => a.ethPrice - b.ethPrice)
    const cheapestSingle = singles[0] ?? null

    // ── 4. Optimal combination ──────────────────────────────────────────────────
    const byChecksCount = new Map<number, PricedToken[]>()
    for (const count of DIVISORS) {
      byChecksCount.set(
        count,
        checksTokens.filter(t => t.checksCount === count).sort((a, b) => a.ethPrice - b.ethPrice),
      )
    }
    const optimal = computeOptimalCombination(byChecksCount)

    // ── 5. Sweep prices ─────────────────────────────────────────────────────────
    const checksSweepCost = computeSweep(checksTokens)
    const editionsSweepCost = computeSweep(editionsTokens)

    // ── 6. Insert snapshot ──────────────────────────────────────────────────────
    const { error: insertErr } = await supabase.from('checkmath_snapshots').insert({
      cheapest_single_price: cheapestSingle?.ethPrice ?? null,
      cheapest_single_token_id: cheapestSingle?.tokenId ?? null,
      optimal_combination_cost: optimal.totalCost,
      optimal_combination: optimal.totalCost !== null ? { items: optimal.items } : null,
      checks_sweep_cost: checksSweepCost,
      editions_sweep_cost: editionsSweepCost,
    })
    if (insertErr) throw insertErr

    return new Response(
      JSON.stringify({
        ok: true,
        cheapestSingle: cheapestSingle?.ethPrice ?? null,
        optimalCombinationCost: optimal.totalCost,
        checksSweepCost,
        editionsSweepCost,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('sync-checkmath error:', err)
    return new Response(JSON.stringify({ error: errMsg(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ─── Corrected combination algorithm ─────────────────────────────────────────
//
// Same DP-with-shared-pool structure the original Checkmath used (process
// weight-units 1..64 in order; at each step, for each tier whose weight
// fits, try substituting that tier's current cheapest still-unused token;
// once a token is used to improve any dp[i], it's removed from the pool).
// This is a heuristic, not an exhaustive proof of global optimality — but
// it's the same approach the original tool used, now with the corrected
// weight table, and now able to select "just buy an existing single" as one
// of its own candidate paths (previously structurally impossible — see the
// header comment above).

function computeOptimalCombination(
  byChecksCount: Map<number, PricedToken[]>,
): { totalCost: number | null; items: CombinationItem[] } {
  const pools = new Map<number, PricedToken[]>()
  for (const [count, tokens] of byChecksCount) pools.set(count, [...tokens])

  const dp: number[] = new Array(TARGET + 1).fill(Infinity)
  dp[0] = 0
  const chosen: (CombinationItem[] | null)[] = new Array(TARGET + 1).fill(null)
  chosen[0] = []

  for (let i = 1; i <= TARGET; i++) {
    for (const count of DIVISORS) {
      const weight = WEIGHT_BY_CHECKS_COUNT[count]
      if (weight > i) continue
      const pool = pools.get(count)
      if (!pool || pool.length === 0) continue
      const prevCost = dp[i - weight]
      if (prevCost === Infinity) continue
      const token = pool[0]
      const candidateCost = prevCost + token.ethPrice
      if (candidateCost < dp[i]) {
        dp[i] = candidateCost
        chosen[i] = [...(chosen[i - weight] ?? []), { tokenId: token.tokenId, checksCount: count, ethPrice: token.ethPrice }]
        pool.shift()
      }
    }
  }

  if (dp[TARGET] === Infinity) return { totalCost: null, items: [] }
  return { totalCost: dp[TARGET], items: chosen[TARGET] ?? [] }
}

function computeSweep(tokens: PricedToken[], n = SWEEP_SIZE): number | null {
  if (tokens.length === 0) return null
  const sorted = [...tokens].sort((a, b) => a.ethPrice - b.ethPrice)
  return sorted.slice(0, n).reduce((sum, t) => sum + t.ethPrice, 0)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab  = enc.encode(a)
  const bb  = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}
