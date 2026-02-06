import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect } from 'react'
import { type Config, useConnect, WagmiProvider } from 'wagmi'

const Connect = () => {
  const { connectors, connect } = useConnect()

  useEffect(() => {
    if (connectors[0] === undefined) {
      return undefined
    }

    connect({ connector: connectors[0] })
  }, [connect, connectors])

  return <></>
}

export const ReactTestWrapper = ({
  children,
  wagmiConfig,
}: {
  children?: ReactNode
  wagmiConfig: Config
}) => {
  const testQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={testQueryClient}>
        <>
          <Connect />
          {children}
        </>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
