import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

export const CHECKS_CONTRACT = '0x036721e5a769cc48b3189efbb9cce4471e8a48b1' as const

const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined

export const checksClient = createPublicClient({
  chain: mainnet,
  transport: http(
    alchemyKey
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : 'https://eth-mainnet.g.alchemy.com/v2/'
  ),
  batch: { multicall: true },
})

export function hasAlchemyKey(): boolean {
  return Boolean(alchemyKey?.trim())
}
