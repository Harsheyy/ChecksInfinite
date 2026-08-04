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
 * `computeOptimalCombination` is an exact bounded-knapsack DP (see its own
 * comment below) — any multiset of these powers-of-two weights summing to
 * exactly 64 is mechanically valid (no partial/leftover merge pieces), so
 * the DP finds the true minimum-cost combination, not a heuristic estimate.
 *
 * "Optimal Combination" is deliberately the cost to BUILD a checks_count=1
 * token by merging smaller pieces (tiers 80/40/20/10/5/4 only) — it excludes
 * existing checks_count=1 tokens from its own candidate pool on purpose, so
 * it stays an honest counterpart to the separately-reported "Cheapest
 * Single" number (which already covers "just buy one outright"). If the
 * combination DP were allowed to secretly answer with an existing single,
 * "buy vs. build" would stop being a real comparison.
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
// Tiers the combination DP is allowed to build FROM — deliberately excludes
// checks_count=1 (weight 64), since "Optimal Combination" answers "what does
// it cost to compose one from smaller pieces," as the counterpart to the
// separately-reported "Cheapest Single" (buy one outright). See header.
const COMBINATION_TIERS = DIVISORS.filter(count => count !== 1)
const TARGET = 64
const SWEEP_SIZE = 64
const PAGE_SIZE = 900 // PostgREST caps rows per request at ~1000; page under that

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
    // Ordered + paged (PAGE_SIZE=900) to stay under PostgREST's ~1000-row cap —
    // an unbounded .select() would silently truncate to an arbitrary unordered
    // slice instead of erroring if listings ever exceed the cap.
    const checksRows = await fetchAllPaged<{ token_id: number; checks_count: number; eth_price: number }>(
      (from, to) =>
        supabase
          .from('all_checks')
          .select('token_id, checks_count, eth_price')
          .eq('is_listed', true)
          .eq('is_burned', false)
          .not('eth_price', 'is', null)
          .order('eth_price', { ascending: true })
          .range(from, to),
    )

    const checksTokens: (PricedToken & { checksCount: number })[] = checksRows.map(r => ({
      tokenId: r.token_id,
      checksCount: r.checks_count,
      ethPrice: r.eth_price,
    }))

    // ── 2. Load listed Editions tokens ──────────────────────────────────────────
    const editionsRows = await fetchAllPaged<{ token_id: number; eth_price: number }>((from, to) =>
      supabase
        .from('editions_checks')
        .select('token_id, eth_price')
        .eq('is_listed', true)
        .not('eth_price', 'is', null)
        .order('eth_price', { ascending: true })
        .range(from, to),
    )

    const editionsTokens: PricedToken[] = editionsRows.map(r => ({ tokenId: r.token_id, ethPrice: r.eth_price }))

    // ── 3. Cheapest single ──────────────────────────────────────────────────────
    const singles = checksTokens.filter(t => t.checksCount === 1).sort((a, b) => a.ethPrice - b.ethPrice)
    const cheapestSingle = singles[0] ?? null

    // ── 4. Optimal combination ──────────────────────────────────────────────────
    // Only builds tiers 80/40/20/10/5/4 (COMBINATION_TIERS) — checks_count=1 is
    // deliberately excluded from the DP's own pool; see header comment.
    const byChecksCount = new Map<number, PricedToken[]>()
    for (const count of COMBINATION_TIERS) {
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
// Exact bounded-knapsack DP over weight-units 0..TARGET(64), built ONLY from
// COMBINATION_TIERS (checks_count 80/40/20/10/5/4 — weights 1/2/4/8/16/32).
// checks_count=1 (weight 64) is deliberately excluded from this DP's own
// candidate pool — see the header comment for why. Any multiset of these six
// tiers' weights summing to exactly TARGET is still mechanically valid (no
// partial/leftover merge pieces) and 64 is still always reachable from them
// in principle (e.g. two weight-32 tokens, or four weight-16, etc.), so this
// DP finds the true minimum-cost combination, not an approximation — it just
// isn't allowed to shortcut to "buy an existing single" anymore.
//
// Process tiers one at a time (COMBINATION_TIERS order). For each tier,
// build a prefix-sum of its sorted-ascending prices (prefix[k] = cost of the
// k cheapest available tokens at that tier). Then, using the *previous*
// tiers' complete dp array as a fixed base, try using k = 0, 1, 2, ...
// (up to what's in stock and up to what fits under TARGET) of this tier's
// cheapest tokens for every reachable weight-total so far, and take the
// best cost for each resulting total. This is the standard "grouped /
// bounded knapsack" technique: because each tier's whole dp pass reads
// only from the previous tier's finished array (never updates dp for the
// same tier in place), a tier's tokens can't be selected more than once
// per combination by construction, and every combination of counts across
// tiers is considered exhaustively — unlike the old shared-pool heuristic,
// nothing is ever consumed from a tier's pool before all candidates for a
// given weight-total have been compared.
//
// Cost: at most 6 tiers × 65 totals × up to (64/weight + 1) counts per
// tier ≈ a few thousand transitions total — cheap even worst-case.

function computeOptimalCombination(
  byChecksCount: Map<number, PricedToken[]>,
): { totalCost: number | null; items: CombinationItem[] } {
  const sortedByTier = new Map<number, PricedToken[]>()
  const prefixByTier = new Map<number, number[]>()
  for (const count of COMBINATION_TIERS) {
    const tokens = [...(byChecksCount.get(count) ?? [])].sort((a, b) => a.ethPrice - b.ethPrice)
    sortedByTier.set(count, tokens)
    const prefix = [0]
    for (const t of tokens) prefix.push(prefix[prefix.length - 1] + t.ethPrice)
    prefixByTier.set(count, prefix)
  }

  let dp: number[] = new Array(TARGET + 1).fill(Infinity)
  dp[0] = 0
  // choiceAtTier[tierIdx][n] = how many of that tier's cheapest tokens were
  // used to reach weight-total n, once tiers 0..tierIdx have been processed.
  const choiceAtTier: number[][] = []

  for (const count of COMBINATION_TIERS) {
    const weight = WEIGHT_BY_CHECKS_COUNT[count]
    const prefix = prefixByTier.get(count)!
    const available = prefix.length - 1
    const maxCount = Math.min(available, Math.floor(TARGET / weight))

    const newDp = new Array(TARGET + 1).fill(Infinity)
    const choice = new Array(TARGET + 1).fill(0)

    for (let n = 0; n <= TARGET; n++) {
      if (dp[n] === Infinity) continue
      for (let k = 0; k <= maxCount; k++) {
        const nn = n + k * weight
        if (nn > TARGET) break
        const cost = dp[n] + prefix[k]
        if (cost < newDp[nn]) {
          newDp[nn] = cost
          choice[nn] = k
        }
      }
    }

    dp = newDp
    choiceAtTier.push(choice)
  }

  if (dp[TARGET] === Infinity) return { totalCost: null, items: [] }

  // Reconstruct: walk tiers in reverse processing order to recover how many
  // tokens each tier contributed, then take that many cheapest tokens from
  // each tier's sorted list.
  const items: CombinationItem[] = []
  let remaining = TARGET
  for (let tierIdx = COMBINATION_TIERS.length - 1; tierIdx >= 0; tierIdx--) {
    const count = COMBINATION_TIERS[tierIdx]
    const weight = WEIGHT_BY_CHECKS_COUNT[count]
    const k = choiceAtTier[tierIdx][remaining]
    const tokens = sortedByTier.get(count)!
    for (let j = 0; j < k; j++) {
      const token = tokens[j]
      items.push({ tokenId: token.tokenId, checksCount: count, ethPrice: token.ethPrice })
    }
    remaining -= k * weight
  }

  return { totalCost: dp[TARGET], items }
}

function computeSweep(tokens: PricedToken[], n = SWEEP_SIZE): number | null {
  if (tokens.length === 0) return null
  const sorted = [...tokens].sort((a, b) => a.ethPrice - b.ethPrice)
  return sorted.slice(0, n).reduce((sum, t) => sum + t.ethPrice, 0)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Pages through a Supabase query in PAGE_SIZE-row batches (PostgREST caps a
// single response at ~1000 rows; an unpaged .select() would silently return
// an arbitrary truncated slice instead of erroring once listings cross that
// cap). Mirrors the .range()-based paging in
// apps/works/src/useAllChecksPermutations.ts.
async function fetchAllPaged<T>(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await queryFactory(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

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
