// frontend/src/useEthUsdPrice.ts
//
// Reads the live ETH/USD price from Chainlink's price feed (same contracts
// credits-webhook reads server-side, confirmed against Chainlink's docs)
// directly via the connected wagmi client — no backend round-trip needed
// just to show a package's ETH equivalent in FundingPrompt.
import { useReadContract, useChainId } from 'wagmi'
import { mainnet, sepolia } from '@reown/appkit/networks'

const MAINNET_ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
const SEPOLIA_ETH_USD_FEED = '0x694AA1769357215DE4FAC081bf1f309aDC325306'
const PRICE_FEED_DECIMALS = 8

const AGGREGATOR_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

// Returns the live ETH/USD price, or null while loading/unavailable.
export function useEthUsdPrice(): number | null {
  const chainId = useChainId()
  const feedAddress = chainId === sepolia.id ? SEPOLIA_ETH_USD_FEED : MAINNET_ETH_USD_FEED
  const targetChainId = chainId === sepolia.id ? sepolia.id : mainnet.id

  const { data } = useReadContract({
    address: feedAddress,
    abi: AGGREGATOR_ABI,
    functionName: 'latestRoundData',
    chainId: targetChainId,
  })

  if (!data) return null
  const answer = data[1] as bigint
  return Number(answer) / 10 ** PRICE_FEED_DECIMALS
}
