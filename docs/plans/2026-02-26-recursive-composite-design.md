# Recursive Composite (4-Token Tree) — Design Doc
**Date:** 2026-02-26
**Status:** Approved

## Overview

Extend the Checks Composer to accept 4 token IDs and simulate a 2-level composition tree:
- Level 1: composite A+B → AB, composite C+D → CD
- Level 2: composite AB+CD → ABCD (full SVG, computed client-side)

The final 7-node tree is displayed with connecting lines showing the composition hierarchy.

---

## Architecture

### New File: `src/checksArtJS.ts`

Ports the Solidity rendering pipeline to TypeScript. Used only for the level-2 SVG; level-1 SVGs still come from the contract.

**Functions ported from Solidity:**

| JS Function | Solidity Source | Notes |
|---|---|---|
| `random(seed, max)` | `Utilities.random(uint256, uint256)` | Uses viem `keccak256` |
| `randomSalted(seed, salt, max)` | `Utilities.random(uint256, string, uint256)` | |
| `avg / min / max / minGt0` | `Utilities.sol` | Operate on numbers |
| `DIVISORS / COLOR_BANDS / GRADIENTS_TABLE` | `ChecksArt.sol` constants | Static arrays |
| `colorBandIndex(check, divisorIndex)` | `ChecksArt.colorBandIndex` | |
| `gradientIndex(check, divisorIndex)` | `ChecksArt.gradientIndex` | |
| `colorIndexes(divisorIndex, check, virtualMap)` | `ChecksArt.colorIndexes` | Key recursive fn; `checks` storage → `Map<number, Check>` |
| `colors(check, virtualMap)` | `ChecksArt.colors` | |
| `collectRenderData(check, virtualMap)` | `ChecksArt.collectRenderData` | |
| `generateSVG(check, virtualMap)` | `ChecksArt.generateSVG` | Returns SVG string |
| `compositeGenesJS(keeper, burner)` | `Checks._compositeGenes` | Computes gradient + colorBand |
| `simulateCompositeJS(keeper, burner, burnerVirtualId)` | JS-only | Builds level-2 Check struct |

### Virtual Token Map

`Map<number, Check>` — replaces on-chain storage for JS rendering:

| Key | Value |
|---|---|
| `A_id` | Real Check struct from `getCheck(A)` |
| `B_id` | Real Check struct from `getCheck(B)` |
| `C_id` | Real Check struct from `getCheck(C)` |
| `D_id` | Real Check struct from `getCheck(D)` |
| `65534` | Simulated AB Check struct (from `simulateComposite(A,B)`, modified) |
| `65535` | Simulated CD Check struct (from `simulateComposite(C,D)`, modified) |

Virtual IDs `65534` and `65535` are safe — max Checks edition supply is ~16,384.

The AB check's `stored.composites[1]` is set to `65535` (the CD virtual ID) so that level-2 color resolution can recursively find CD in the map.

### ABI Update: `src/checksAbi.ts`

Add `getCheck(uint256)` view function returning the full `Check` tuple (same struct shape as `simulateComposite` output).

### New Hook: `src/useTreeComposite.ts`

Replaces `useComposite`. Three-phase execution:

**Phase 1 (parallel, 8 calls):**
- `tokenURI(A)`, `tokenURI(B)`, `tokenURI(C)`, `tokenURI(D)` → SVG + attributes for leaf nodes
- `getCheck(A)`, `getCheck(B)`, `getCheck(C)`, `getCheck(D)` → Check structs for virtual map

**Phase 2 (parallel, 4 calls, after Phase 1):**
- `simulateComposite(A, B)` → L1 AB Check struct
- `simulateCompositeSVG(A, B)` → L1 AB SVG
- `simulateComposite(C, D)` → L1 CD Check struct
- `simulateCompositeSVG(C, D)` → L1 CD SVG

**Phase 3 (JS-only, synchronous):**
- Build virtual map with all 6 Check structs
- Assign virtual IDs to AB (65534) and CD (65535)
- Set `abCheck.stored.composites[abCheck.stored.divisorIndex] = 65535` (points to CD)
- Call `simulateCompositeJS(abCheck, cdCheck, 65535)` → ABCD Check struct
- Call `generateSVGJS(abcdCheck, virtualMap)` → ABCD SVG string

### Modified Components

**`InputPanel.tsx`** — now accepts 4 IDs as two labeled pairs ("Pair 1: A, B" and "Pair 2: C, D"), same Alchemy key field.

**`App.tsx`** — switches from 3-panel grid to tree layout using `TreeLayout.tsx`.

**`TreeLayout.tsx`** (new) — positions 7 `CheckCard` nodes in a tree with CSS connecting lines:
```
Row 1:  [A]   [B]     [C]   [D]
Row 2:    [AB]           [CD]
Row 3:          [ABCD]
```

---

## Data Flow

```
User inputs: alchemyKey, A, B, C, D
     │
     ▼
Phase 1: tokenURI(A/B/C/D) + getCheck(A/B/C/D)   [8 parallel RPC calls]
     │
     ▼
Phase 2: simulateComposite + simulateCompositeSVG for (A,B) and (C,D)  [4 parallel RPC calls]
     │
     ▼
Phase 3: JS only
  - Build virtualMap
  - simulateCompositeJS(AB, CD, 65535) → abcdCheck
  - generateSVGJS(abcdCheck, virtualMap) → abcdSVG
     │
     ▼
Render 7-node tree: A, B, AB, C, D, CD, ABCD
```

---

## Error Handling

| Condition | Behavior |
|---|---|
| Token not minted | Error shown in that node's card |
| Mismatched divisorIndex for a pair | Error in that L1 composite node |
| L2 mismatched divisorIndex | Error in ABCD node |
| JS rendering error | Error in ABCD node with message |
| Any leaf fails Phase 1 | Phase 2 still fires for the unaffected pair |

---

## Out of Scope

- Deeper trees (>2 levels / >4 tokens)
- Generalising the `n`-token recursive case
- Actual on-chain execution of composites
