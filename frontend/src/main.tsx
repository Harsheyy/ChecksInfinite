import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from './wagmiConfig'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

// Prefetch + init the AppKit modal off the critical path: wallet session
// auto-reconnect needs createAppKit to have run, but the ~1.6 MB UI chunk
// must not block first paint. Safari has no requestIdleCallback.
const idle: (cb: () => void) => void =
  'requestIdleCallback' in window
    ? cb => requestIdleCallback(cb)
    : cb => setTimeout(cb, 1500)
idle(() => {
  import('./appkit').then(m => m.initAppKit())
})
