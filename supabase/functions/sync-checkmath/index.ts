/**
 * sync-checkmath — Supabase Edge Function
 *
 * Hourly: compute the Checkmath numbers (cheapest single, optimal
 * combination, sweep prices for Checks VV, Checks Editions, and Token
 * Works) and insert one row into checkmath_snapshots.
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
 * Checks Editions (a separate, non-mergeable collection) are treated as
 * economically equivalent to a checks_count=80 Checks VV token — weight 1 —
 * and pooled together with real 80-count tokens in the combination DP's
 * cheapest-first ordering, so the algorithm picks whichever is actually
 * cheaper. This is a cost-comparison convenience only: Editions can't really
 * be composited on-chain with Checks VV tokens, so every combination item
 * carries a `collection` tag ('checks-vv' | 'editions') and the frontend
 * must always show which collection an item actually came from.
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
const EDITIONS_TIER_CHECKS_COUNT = 80 // Editions are pooled into the weight-1 tier
const TARGET = 64
const SWEEP_SIZE = 64
const PAGE_SIZE = 900 // PostgREST caps rows per request at ~1000; page under that

type Collection = 'checks-vv' | 'editions'

interface PricedToken {
  tokenId: number
  ethPrice: number
  collection: Collection
}

type SupabaseLike = ReturnType<typeof createClient>

interface CombinationItem {
  tokenId: number
  checksCount: number
  ethPrice: number
  collection: Collection
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
    // is_tokenstr=false excludes TokenStrategy-held tokens: their price comes
    // from the TokenStrategy contract's nftForSale() (a separate acquisition
    // path, synced by sync-tokenstr), not a real OpenSea listing, and the
    // frontend links every Checkmath token to OpenSea — so a tokenstr-held
    // token surfacing here would point users at a dead/wrong listing. Mirrors
    // sync-market-prices, which treats is_tokenstr as a separate channel.
    // Ordered + paged (PAGE_SIZE=900) to stay under PostgREST's ~1000-row cap —
    // an unbounded .select() would silently truncate to an arbitrary unordered
    // slice instead of erroring if listings ever exceed the cap. token_id is a
    // secondary sort key so page boundaries are deterministic even though many
    // listings share the same eth_price — without it, a tied-price token could
    // land on two consecutive pages (duplicated) or neither (dropped), since
    // each page is an independent query and Postgres doesn't guarantee stable
    // ordering among ties across separate ORDER BY ... LIMIT ... OFFSET calls.
    const checksRows = await fetchAllPaged<{ token_id: number; checks_count: number; eth_price: number }>(
      (from, to) =>
        supabase
          .from('all_checks')
          .select('token_id, checks_count, eth_price')
          .eq('is_listed', true)
          .eq('is_burned', false)
          .eq('is_tokenstr', false)
          .not('eth_price', 'is', null)
          .order('eth_price', { ascending: true })
          .order('token_id', { ascending: true })
          .range(from, to),
    )

    const checksTokens: (PricedToken & { checksCount: number })[] = checksRows.map(r => ({
      tokenId: r.token_id,
      checksCount: r.checks_count,
      ethPrice: r.eth_price,
      collection: 'checks-vv' as const,
    }))

    // ── 2. Load listed Editions tokens ──────────────────────────────────────────
    const editionsRows = await fetchAllPaged<{ token_id: number; eth_price: number }>((from, to) =>
      supabase
        .from('editions_checks')
        .select('token_id, eth_price')
        .eq('is_listed', true)
        .not('eth_price', 'is', null)
        .order('eth_price', { ascending: true })
        .order('token_id', { ascending: true })
        .range(from, to),
    )

    const editionsTokens: PricedToken[] = editionsRows.map(r => ({
      tokenId: r.token_id,
      ethPrice: r.eth_price,
      collection: 'editions' as const,
    }))

    // ── 2b. Load listed Token Works (TokenStrategy-held) tokens ─────────────────
    // Same is_listed semantics as market rows (sync-tokenstr sets it true only
    // when nftForSale() returns a real, non-zero price) — a genuine sweep
    // target via the TokenStrategy contract's own buy flow, just not an
    // OpenSea listing. Sweep-only: not part of the combination DP or
    // cheapest-single (those stay OpenSea-linkable, per the is_tokenstr
    // exclusion below them).
    const tokenworksRows = await fetchAllPaged<{ token_id: number; eth_price: number }>((from, to) =>
      supabase
        .from('all_checks')
        .select('token_id, eth_price')
        .eq('is_listed', true)
        .eq('is_burned', false)
        .eq('is_tokenstr', true)
        .not('eth_price', 'is', null)
        .order('eth_price', { ascending: true })
        .order('token_id', { ascending: true })
        .range(from, to),
    )

    const tokenworksTokens: PricedToken[] = tokenworksRows.map(r => ({
      tokenId: r.token_id,
      ethPrice: r.eth_price,
      collection: 'checks-vv' as const, // Token Works tokens are Checks VV, just held by TokenStrategy
    }))

    // ── 3. Cheapest single ──────────────────────────────────────────────────────
    // Always a real Checks VV token — Editions have no checks_count/merge
    // concept, so "a single" only ever means a genuine checks_count=1 token.
    const singles = checksTokens.filter(t => t.checksCount === 1).sort((a, b) => a.ethPrice - b.ethPrice)
    const cheapestSingle = singles[0] ?? null

    // ── 4. Optimal combination ──────────────────────────────────────────────────
    // Only builds tiers 80/40/20/10/5/4 (COMBINATION_TIERS) — checks_count=1 is
    // deliberately excluded from the DP's own pool; see header comment. The
    // weight-1 (checks_count=80) tier pools BOTH real 80-count Checks VV
    // tokens AND Editions tokens together, sorted by price — Editions count
    // as an 80-check for this purpose (see header comment on the economic
    // equivalence). Every other tier is Checks VV only, since Editions have
    // no smaller-tier equivalent to merge into.
    const byChecksCount = new Map<number, PricedToken[]>()
    for (const count of COMBINATION_TIERS) {
      const checksVVPool = checksTokens.filter(t => t.checksCount === count)
      const pool = count === EDITIONS_TIER_CHECKS_COUNT ? [...checksVVPool, ...editionsTokens] : checksVVPool
      byChecksCount.set(count, pool.sort((a, b) => a.ethPrice - b.ethPrice))
    }
    const optimal = computeOptimalCombination(byChecksCount)

    // ── 5. Sweep prices ─────────────────────────────────────────────────────────
    const checksSweep = computeSweep(checksTokens)
    const editionsSweep = computeSweep(editionsTokens)
    const tokenworksSweep = computeSweep(tokenworksTokens)

    // ── 6. Insert snapshot ──────────────────────────────────────────────────────
    const { error: insertErr } = await supabase.from('checkmath_snapshots').insert({
      cheapest_single_price: cheapestSingle?.ethPrice ?? null,
      cheapest_single_token_id: cheapestSingle?.tokenId ?? null,
      optimal_combination_cost: optimal.totalCost,
      optimal_combination: optimal.totalCost !== null ? { items: optimal.items } : null,
      checks_sweep_cost: checksSweep.cost,
      checks_sweep_count: checksSweep.count,
      editions_sweep_cost: editionsSweep.cost,
      editions_sweep_count: editionsSweep.count,
      tokenworks_sweep_cost: tokenworksSweep.cost,
      tokenworks_sweep_count: tokenworksSweep.count,
    })
    if (insertErr) throw insertErr

    // ── 7. Event markers ────────────────────────────────────────────────────────
    // Best-effort: these annotate the history chart, and a failure to reach
    // OpenSea's event feed must not cost us the snapshot that was just
    // written. Errors are logged and reported in the response, not thrown.
    const events = { sales: 0, composites: 0, errors: [] as string[] }

    try {
      events.sales = await recordSingleSales(supabase)
    } catch (err) {
      console.error('sync-checkmath: sale events failed:', err)
      events.errors.push(`sales: ${errMsg(err)}`)
    }

    try {
      events.composites = await recordNewSingles(supabase)
    } catch (err) {
      console.error('sync-checkmath: composite events failed:', err)
      events.errors.push(`composites: ${errMsg(err)}`)
    }

    // ── 8. Roll up today ────────────────────────────────────────────────────────
    // Runs after the events above so today's sale count and sale low are
    // included rather than picked up an hour late. The rollup recomputes the
    // whole day from scratch, so re-running it is always safe.
    //
    // Best-effort for the same reason as the events: checkmath_daily is a
    // derived cache, and a nightly cron re-rolls yesterday regardless — so a
    // failure here costs at most one hour of freshness on today's point, never
    // the snapshot itself.
    let rolledUp = true
    const today = new Date().toISOString().slice(0, 10) // UTC, matches the rollup's bucketing
    const { error: rollupErr } = await supabase.rpc('rollup_checkmath_day', { p_day: today })
    if (rollupErr) {
      console.error('sync-checkmath: daily rollup failed:', rollupErr)
      rolledUp = false
      events.errors.push(`rollup: ${rollupErr.message}`)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        cheapestSingle: cheapestSingle?.ethPrice ?? null,
        optimalCombinationCost: optimal.totalCost,
        checksSweep,
        editionsSweep,
        tokenworksSweep,
        events,
        rolledUp,
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
// COMBINATION_TIERS (checks_count 80/40/20/10/5/4 — weights 1/2/4/8/16/32,
// with the weight-1 tier's pool mixing in Editions tokens too). checks_count=1
// (weight 64) is deliberately excluded from this DP's own candidate pool —
// see the header comment for why. Any multiset of these six tiers' weights
// summing to exactly TARGET is still mechanically valid (no partial/leftover
// merge pieces) and 64 is still always reachable from them in principle
// (e.g. two weight-32 tokens, or four weight-16, etc.), so this DP finds the
// true minimum-cost combination, not an approximation — it just isn't
// allowed to shortcut to "buy an existing single" anymore.
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
      items.push({ tokenId: token.tokenId, checksCount: count, ethPrice: token.ethPrice, collection: token.collection })
    }
    remaining -= k * weight
  }

  return { totalCost: dp[TARGET], items }
}

function computeSweep(tokens: PricedToken[], n = SWEEP_SIZE): { cost: number | null; count: number } {
  if (tokens.length === 0) return { cost: null, count: 0 }
  const sorted = [...tokens].sort((a, b) => a.ethPrice - b.ethPrice)
  const selected = sorted.slice(0, n)
  return { cost: selected.reduce((sum, t) => sum + t.ethPrice, 0), count: selected.length }
}

// ─── Event markers ────────────────────────────────────────────────────────────
//
// Two different questions from two different sources, both landing in
// checkmath_events:
//
//   sale      — a checks_count=1 token actually changed hands. OpenSea's
//               event feed, filtered to tokens we know to be singles.
//   composite — a token became a single. Derived by diffing the set of
//               checks_count=1 token ids against checkmath_singles rather
//               than reading the contract's Composite event, because
//               eth_getLogs is capped at a 10-block range on our Alchemy
//               plan. The set is ~70 rows, so the diff is cheap, and it is
//               exact for anything that happens after migration 050 seeded
//               the table — it just can't see backwards.
//
// Both write with ignoreDuplicates on event_key, so re-running is harmless.

/**
 * Pulls recent sales from OpenSea and records the ones that were singles.
 *
 * Paging stops at the newest sale already recorded — the first sync after
 * deploy walks back SALE_BACKFILL_PAGES worth of history, and every sync
 * after that reads a page or two.
 *
 * Caveat worth knowing: "was a single" is judged from the token's CURRENT
 * checks_count. Singles are terminal (a checks_count=1 token can only leave
 * that state by being burned into an Infinity), so this can't misjudge
 * recent sales — but a token sold years ago as a 4-check and composed up
 * since would be tagged wrongly. Hence the page cap: this is a recent-events
 * feed, not an archive.
 */
const OPENSEA_COLLECTION = 'vv-checks-originals'
const SALE_PAGE_LIMIT = 50
const SALE_BACKFILL_PAGES = 20

interface OpenSeaSaleEvent {
  event_type: string
  event_timestamp: number
  transaction?: string
  nft?: { identifier?: string }
  payment?: { quantity?: string; decimals?: number; symbol?: string }
}

async function recordSingleSales(supabase: SupabaseLike): Promise<number> {
  const apiKey = Deno.env.get('OPENSEA_API_KEY')
  if (!apiKey) throw new Error('OPENSEA_API_KEY secret not set')

  // The set of token ids that are singles right now — the filter for which
  // sales are interesting. ~70 rows.
  const { data: singleRows, error: singlesErr } = await supabase
    .from('all_checks')
    .select('token_id')
    .eq('checks_count', 1)
    .eq('is_burned', false)
  if (singlesErr) throw singlesErr
  const singleIds = new Set((singleRows ?? []).map((r: TokenIdRow) => r.token_id))
  if (singleIds.size === 0) return 0

  // Where to stop paging: the most recent sale we already have.
  const { data: latest, error: latestErr } = await supabase
    .from('checkmath_events')
    .select('occurred_at')
    .eq('kind', 'sale')
    .order('occurred_at', { ascending: false })
    .limit(1)
  if (latestErr) throw latestErr
  const latestAt = (latest as { occurred_at: string }[] | null)?.[0]?.occurred_at
  const stopAt = latestAt ? Date.parse(latestAt) / 1000 : 0

  const rows: EventRow[] = []
  let cursor: string | null = null

  for (let page = 0; page < SALE_BACKFILL_PAGES; page++) {
    const url = new URL(`https://api.opensea.io/api/v2/events/collection/${OPENSEA_COLLECTION}`)
    url.searchParams.set('event_type', 'sale')
    url.searchParams.set('limit', String(SALE_PAGE_LIMIT))
    if (cursor) url.searchParams.set('next', cursor)

    const res = await fetch(url, { headers: { 'x-api-key': apiKey } })
    if (!res.ok) throw new Error(`OpenSea events ${res.status}: ${await res.text()}`)
    const body = await res.json() as { asset_events?: OpenSeaSaleEvent[]; next?: string }

    const batch = body.asset_events ?? []
    if (batch.length === 0) break

    let reachedKnown = false
    for (const ev of batch) {
      if (ev.event_timestamp <= stopAt) { reachedKnown = true; continue }
      const tokenId = Number(ev.nft?.identifier)
      if (!Number.isFinite(tokenId) || !singleIds.has(tokenId)) continue
      const tx = ev.transaction
      if (!tx) continue

      rows.push({
        kind: 'sale',
        token_id: tokenId,
        occurred_at: new Date(ev.event_timestamp * 1000).toISOString(),
        eth_price: parsePaymentEth(ev.payment),
        event_key: `sale:${tx}:${tokenId}`,
      })
    }

    cursor = body.next ?? null
    if (reachedKnown || !cursor) break
  }

  return await insertEvents(supabase, rows)
}

/**
 * Records a composite for every token that has become a single since the
 * last run, and grows checkmath_singles to match.
 *
 * The event is dated now rather than at the composite's block time: the diff
 * only tells us it happened within the last hour. Keyed by token and day so
 * a token composed, burned into an Infinity, and composed again on the same
 * day is counted once — a rare enough case that undercounting it is better
 * than the alternative of keying on the sync timestamp, where a retry would
 * double-count every time.
 */
async function recordNewSingles(supabase: SupabaseLike): Promise<number> {
  const { data: currentRows, error: currentErr } = await supabase
    .from('all_checks')
    .select('token_id')
    .eq('checks_count', 1)
    .eq('is_burned', false)
  if (currentErr) throw currentErr

  const { data: knownRows, error: knownErr } = await supabase
    .from('checkmath_singles')
    .select('token_id')
  if (knownErr) throw knownErr

  const known = new Set((knownRows ?? []).map((r: TokenIdRow) => r.token_id))
  const fresh = (currentRows ?? [])
    .map((r: TokenIdRow) => r.token_id)
    .filter((id: number) => !known.has(id))
  if (fresh.length === 0) return 0

  const now = new Date()
  const day = now.toISOString().slice(0, 10)
  const inserted = await insertEvents(
    supabase,
    fresh.map((tokenId: number) => ({
      kind: 'composite' as const,
      token_id: tokenId,
      occurred_at: now.toISOString(),
      eth_price: null,
      event_key: `composite:${tokenId}:${day}`,
    })),
  )

  // Only after the events are safely written — if this ran first and the
  // insert then failed, the tokens would be marked as seen and the
  // composites would be lost for good.
  const { error: trackErr } = await supabase
    .from('checkmath_singles')
    .upsert(fresh.map((token_id: number) => ({ token_id })), { onConflict: 'token_id', ignoreDuplicates: true })
  if (trackErr) throw trackErr

  return inserted
}

interface TokenIdRow { token_id: number }

interface EventRow {
  kind: 'sale' | 'composite'
  token_id: number
  occurred_at: string
  eth_price: number | null
  event_key: string
}

async function insertEvents(supabase: SupabaseLike, rows: EventRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { error } = await supabase
    .from('checkmath_events')
    .upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true })
  if (error) throw error
  return rows.length
}

/** OpenSea reports payment in the token's own base units. Only ETH/WETH counts. */
function parsePaymentEth(payment: OpenSeaSaleEvent['payment']): number | null {
  if (!payment?.quantity) return null
  const symbol = (payment.symbol ?? 'ETH').toUpperCase()
  if (symbol !== 'ETH' && symbol !== 'WETH') return null
  const decimals = payment.decimals ?? 18
  const value = Number(payment.quantity) / 10 ** decimals
  return Number.isFinite(value) ? value : null
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
