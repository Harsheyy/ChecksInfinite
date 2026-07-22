/**
 * The ONLY module that may statically import `@reown/appkit/react`'s
 * createAppKit — everything else must reach it via `import('./appkit')`
 * so the ~1.6 MB modal UI stays out of the entry chunk.
 */
import { createAppKit } from '@reown/appkit/react'
import { mainnet } from '@reown/appkit/networks'
import { wagmiAdapter, projectId } from './wagmiConfig'

type AppKitModal = ReturnType<typeof createAppKit>

let modal: AppKitModal | undefined

export function initAppKit(): AppKitModal {
  modal ??= createAppKit({
    adapters: [wagmiAdapter],
    networks: [mainnet],
    projectId: projectId ?? 'MISSING_PROJECT_ID',
    metadata: {
      name: 'Checks Infinite',
      description: 'Checks VV permutation browser',
      url: 'https://checksinfinite.vercel.app',
      icons: [],
    },
    themeMode: 'dark',
    themeVariables: {
      '--w3m-accent': '#ffffff',
      '--w3m-border-radius-master': '1px',
    },
    features: { analytics: false, email: false, socials: false },
  })
  return modal
}

export async function openWalletModal(view: 'Connect' | 'Account'): Promise<void> {
  await initAppKit().open({ view })
}
