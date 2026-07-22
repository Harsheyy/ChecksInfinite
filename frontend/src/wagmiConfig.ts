import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet } from '@reown/appkit/networks'
import { http } from 'wagmi'

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

export const wagmiAdapter = new WagmiAdapter({
  networks: [mainnet],
  projectId: projectId ?? 'MISSING_PROJECT_ID',
  transports: {
    [mainnet.id]: http(
      import.meta.env.VITE_ALCHEMY_API_KEY
        ? `https://eth-mainnet.g.alchemy.com/v2/${import.meta.env.VITE_ALCHEMY_API_KEY}`
        : undefined
    ),
  },
})

export const wagmiConfig = wagmiAdapter.wagmiConfig
