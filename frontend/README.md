# Checks Infinite

A read-only frontend for previewing recursive composites of [Checks Originals](https://checks.art) NFTs — no wallet required.

Enter four token IDs and see the full 2-level composition tree: two pairs are composited into AB and CD, then AB and CD are composited into a final ABCD result, rendered entirely client-side.

```
[A]  [B]    [C]  [D]
  [AB]          [CD]
        [ABCD]
```

## How it works

- **L1 composites (AB, CD)** — fetched directly from the on-chain `simulateComposite` and `simulateCompositeSVG` view functions
- **L2 composite (ABCD)** — computed fully in the browser via a TypeScript port of ChecksArt.sol, using a virtual token map to resolve the recursive color tree without touching the chain

## Stack

- React 18 + Vite + TypeScript
- [viem](https://viem.sh) for Ethereum reads (no wallet, no signing)
- Alchemy as the RPC provider

## Getting started

```bash
cd frontend
npm install
```

Create a `.env` file:

```
VITE_ALCHEMY_API_KEY=your_alchemy_key_here
```

Then run:

```bash
npm run dev
```

Open http://localhost:5173, enter four Checks token IDs that share the same check count, and click **Preview**.

> All four tokens must have the same check count to be compositable (e.g. all 80-check tokens, or all 40-check tokens).

## Project structure

```
frontend/src/
├── checksAbi.ts          # Minimal ABI for the Checks Originals contract
├── checksArtJS.ts        # TypeScript port of ChecksArt.sol rendering pipeline
├── client.ts             # viem public client factory
├── utils.ts              # Attribute mapping helpers + CheckStruct type
├── useTreeComposite.ts   # 3-phase data fetching hook
├── App.tsx               # Root component
└── components/
    ├── InputPanel.tsx    # Alchemy key + 4 token ID inputs
    ├── CheckCard.tsx     # SVG + attributes for a single token
    └── TreeLayout.tsx    # 7-node tree layout
```

## Contract

- **Checks Originals** — `0x036721e5a769cc48b3189efbb9cce4471e8a48b1` on Ethereum Mainnet
- Read-only — no transactions, no wallet connection
