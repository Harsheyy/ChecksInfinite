# Side Panel + Compact Tree Design

**Date:** 2026-02-28
**Status:** Approved

## Goal

Replace the centered modal with a right-anchored side panel. Move the buy button to a fixed footer so users never have to scroll to reach it. Redesign the tree layout to be more compact and visually show the two-branch merge.

## Panel Shell

- Fixed panel anchored to the right edge, full viewport height, ~380px wide
- Slides in with `transform: translateX(100%) → translateX(0)`, ~200ms ease-out transition
- No dimming overlay — grid stays fully visible and interactive behind it
- Close button (✕) top-right corner; Escape key still closes
- `z-index: 100` (same as current modal)
- Header shows the permutation label (e.g. `#253▸#294, #322▸#323`)
- Panel body is `overflow-y: auto` to handle smaller viewports

## Tree Layout

Two-branch tree converging at the final node. Visual connectors are pure CSS borders.

```
┌──────┐ ┌──────┐   ┌──────┐ ┌──────┐
│  A   │ │  B   │   │  C   │ │  D   │
│[svg] │ │[svg] │   │[svg] │ │[svg] │
│ attr │ │ attr │   │ attr │ │ attr │
└──┬───┘ └───┬──┘   └──┬───┘ └───┬──┘
   └────┬────┘          └────┬────┘
    ┌───┴───┐            ┌───┴───┐
    │  L1a  │            │  L1b  │
    │ [svg] │            │ [svg] │
    │ attr  │            │ attr  │
    └───┬───┘            └───┬───┘
        └──────────┬──────────┘
              ┌────┴────┐
              │  Final  │
              │  [svg]  │
              │  attr   │
              └─────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[ Buy All 4  (0.08 ETH)       ]
```

- Top row: 4 leaf cards in 2 pairs (A+B left, C+D right)
- Middle row: 2 L1 composite cards side-by-side
- Bottom: 1 final result card centered
- CSS border connectors join pairs to L1 nodes, then L1 nodes to Final

## Card Detail (compact)

Each card shows:
1. Label row (e.g. "Keeper #253", "Burn #294", "#253+#294", "Final Composite") + price sublabel for leaf cards
2. SVG artwork (full width of card)
3. Two key attributes only: **Checks** count and **Color Band**

No full attributes list — reduces vertical height significantly.

## Fixed Footer

- `position: sticky; bottom: 0` inside the panel's scrollable body
- Full panel width, `background: #111`, `border-top: 1px solid #333`
- Buy button spans full width
- States: loading prices → connect wallet → buy (with ETH total) → buying N/4 → done / error
- Only rendered in DB mode (same as current)

## What Changes

| File | Change |
|------|--------|
| `TreeModal.tsx` | Rename → `TreePanel.tsx`; remove overlay div; add panel shell with slide-in; restructure tree layout; move buy button to sticky footer |
| `CheckCard.tsx` | Add `compact` prop that renders only svg + 2 key attributes instead of full list |
| `InfiniteGrid.tsx` | Update import name `TreeModal` → `TreePanel` |
| `index.css` | Replace `.tree-modal-*` styles with `.tree-panel-*`; add connector CSS; add sticky footer styles |

## Out of Scope

- No animation on the grid itself (no compress/push)
- No backdrop dimming
- Mobile/responsive tweaks (panel stays full-height on all sizes for now)
