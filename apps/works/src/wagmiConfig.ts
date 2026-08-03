import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, sepolia } from '@reown/appkit/networks'
import { http } from 'wagmi'
import type { AppKitNetwork } from '@reown/appkit/networks'

export const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined
if (!projectId) {
  // AppKit's WalletConnect flows silently no-op without a project ID —
  // fail loud so a missing env var is obvious in every environment.
  console.error(
    'VITE_WALLETCONNECT_PROJECT_ID is not set — WalletConnect (mobile) connections will not work'
  )
}

// Sepolia is opt-in (VITE_ENABLE_TESTNET=true) so testing the monetization
// flow with free testnet ETH doesn't change what production offers —
// unset or false, the app behaves exactly as it did mainnet-only.
const testnetEnabled = import.meta.env.VITE_ENABLE_TESTNET === 'true'
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = testnetEnabled
  ? [mainnet, sepolia]
  : [mainnet]

const transports: Record<number, ReturnType<typeof http>> = {
  [mainnet.id]: http(
    import.meta.env.VITE_ALCHEMY_API_KEY
      ? `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
      : undefined
  ),
}
if (testnetEnabled) {
  transports[sepolia.id] = http(
    import.meta.env.VITE_ALCHEMY_API_KEY
      ? `https://eth-sepolia.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
      : undefined
  )
}

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: projectId ?? 'MISSING_PROJECT_ID',
  transports,
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
