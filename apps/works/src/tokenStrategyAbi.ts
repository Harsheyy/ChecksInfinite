export const TOKEN_STRATEGY_ADDRESS = '0x2090Dc81F42f6ddD8dEaCE0D3C3339017417b0Dc' as const

export const tokenStrategyAbi = [
  {
    name: 'nftForSale',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'sellTargetNFT',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'payableAmount', type: 'uint256' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const
