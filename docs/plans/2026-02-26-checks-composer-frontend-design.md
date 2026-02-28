# Checks Composer Frontend — Design Doc
**Date:** 2026-02-26
**Status:** Approved

## Overview

A React + Vite SPA that lets users preview the result of compositing two Checks Originals NFTs by entering their token IDs. Reads directly from the deployed on-chain contract — no wallet required, read-only.

---

## Architecture

### Stack
- **React 18 + Vite** — frontend framework and bundler
- **viem** — Ethereum client for contract reads (no wallet, no signing)
- **Env var:** `VITE_ALCHEMY_API_KEY` — Ethereum mainnet RPC key
- **State:** plain `useState` / `useReducer`, no external state library

### Contract
- **Name:** Checks Originals
- **Address:** `0x036721e5a769cc48b3189efbb9cce4471e8a48b1`
- **Network:** Ethereum Mainnet

### Contract Calls
| Function | Signature | Purpose |
|----------|-----------|---------|
| `tokenURI` | `tokenURI(uint256) → string` | Fetch base64 JSON for each input token; decode to get SVG + trait attributes |
| `simulateCompositeSVG` | `simulateCompositeSVG(uint256, uint256) → string` | Get the SVG of the merged result |
| `simulateComposite` | `simulateComposite(uint256, uint256) → Check` | Get the Check struct for the merged result; map to display attributes |

---

## Component Structure

```
App
├── InputPanel          — Alchemy key field, two token ID inputs, Preview button
├── CheckCard           — Reusable: SVG + attributes for a single token
│   ├── SVG display (dangerouslySetInnerHTML)
│   └── AttributeList (Checks count, Color Band, Gradient, Speed, Shift, Day)
├── CompositeResult     — Center panel: merged SVG + derived attributes
│   ├── SVG display
│   └── AttributeList (same fields, derived from simulateComposite struct)
└── ErrorBanner         — Inline error messages per panel
```

---

## UI Layout

```
┌──────────────────────────────────────────────────────┐
│  ◆ CHECKS COMPOSER                                   │
│  Alchemy Key: [___________________]                  │
│  Token ID:   [_____]  Burn ID: [_____]  [Preview →] │
├──────────────┬─────────────────┬─────────────────────┤
│  Check #A    │  → Composite →  │  Check #B (burned)  │
│  [SVG]       │  [SVG result]   │  [SVG]              │
│              │                 │                     │
│  Checks: 80  │  Checks: 40     │  Checks: 80         │
│  Band: Sixty │  Band: Forty    │  Band: Forty        │
│  Gradient:…  │  Gradient:…     │  Gradient:…         │
│  Speed: 1x   │  Speed: 1x      │  Speed: 2x          │
│  Shift: IR   │  Shift: UV      │  Shift: IR          │
└──────────────┴─────────────────┴─────────────────────┘
```

---

## Data Flow

1. User enters Alchemy key, tokenId (A), burnId (B)
2. Click "Preview" → fire 3 parallel RPC calls:
   - `tokenURI(A)` — base64 decode → parse JSON → extract `image` (SVG) + `attributes`
   - `tokenURI(B)` — same
   - `simulateCompositeSVG(A, B)` + `simulateComposite(A, B)` — composite SVG + raw Check struct
3. Map `Check` struct fields to human-readable attributes:
   - `checksCount` via `DIVISORS[divisorIndex]` = `[80, 40, 20, 10, 5, 4, 1, 0][divisorIndex]`
   - `colorBand` → `['Eighty','Sixty','Forty','Twenty','Ten','Five','One'][colorBand]`
   - `gradient` → `['None','Linear','Double Linear','Reflected','Double Angled','Angled','Linear Z'][gradient]`
   - `speed` → `speed == 4 ? '2x' : speed == 2 ? '1x' : '0.5x'`
   - `direction` → `direction == 0 ? 'IR' : 'UV'`
4. Render three panels: left (A), center (composite), right (B)

---

## Error Handling

| Error Condition | Behavior |
|----------------|----------|
| Token not minted | Show "Token #X not found" in that panel |
| Same tokenId for both fields | Show "Token IDs must be different" before calling |
| Mismatched divisorIndex | Contract reverts; show "Tokens must have same check count to composite" |
| Invalid Alchemy key | RPC fails; show "RPC error — check your API key" |
| Network error | Show "Network error — try again" |

---

## File Structure

```
/
├── .env.example           (VITE_ALCHEMY_API_KEY=)
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── viem.ts            (public client setup)
│   ├── checksAbi.ts       (minimal ABI for needed functions)
│   ├── utils.ts           (attribute mapping helpers)
│   ├── components/
│   │   ├── InputPanel.tsx
│   │   ├── CheckCard.tsx
│   │   └── CompositeResult.tsx
│   └── index.css
├── index.html
├── vite.config.ts
└── package.json
```

---

## Out of Scope

- Wallet connection / signing (this is read-only)
- Executing actual composites on-chain
- Multi-composite (compositeMany)
- Infinity (64-check black check)
- Mobile-optimized layout (desktop-first)
