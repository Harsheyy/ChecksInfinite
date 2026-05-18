export const CHECKS_RECIPE_MINTER_ADDRESS = (
  import.meta.env.VITE_CHECKS_RECIPE_MINTER_ADDRESS as `0x${string}` | undefined
)

export const checksRecipeMinterAbi = [
  {
    name: 'quote',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'k1', type: 'uint256' },
      { name: 'b1', type: 'uint256' },
      { name: 'k2', type: 'uint256' },
      { name: 'b2', type: 'uint256' },
    ],
    outputs: [
      { name: 'totalCost', type: 'uint256' },
      { name: 'tokenCost', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
  },
  {
    name: 'mintRecipe',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'k1', type: 'uint256' },
      { name: 'b1', type: 'uint256' },
      { name: 'k2', type: 'uint256' },
      { name: 'b2', type: 'uint256' },
    ],
    outputs: [],
  },
] as const
