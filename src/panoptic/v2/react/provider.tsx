/**
 * React context provider for the Panoptic v2 SDK.
 * @module v2/react/provider
 */

import { type ReactNode, createContext, useContext } from 'react'
import type { Address, PublicClient, WalletClient } from 'viem'

import type { StorageAdapter } from '../storage'

/**
 * Panoptic SDK context value.
 */
export interface PanopticContextValue {
  /** viem PublicClient for reading chain state */
  publicClient: PublicClient
  /**
   * Optional cache scope for read/simulation query keys.
   * Use this when multiple environments share the same QueryClient.
   */
  clientScope?: string
  /** Optional viem WalletClient for write operations */
  walletClient?: WalletClient
  /** Optional account address for write operations */
  account?: Address
  /** Chain ID */
  chainId: bigint
  /** Optional storage adapter for position tracking */
  storage?: StorageAdapter
  /**
   * Optional cache scope for storage-backed query keys.
   * Set this when swapping storage adapters at runtime.
   */
  storageScope?: string
}

const PanopticContext = createContext<PanopticContextValue | null>(null)

/**
 * Props for PanopticProvider.
 */
export interface PanopticProviderProps extends PanopticContextValue {
  children: ReactNode
}

/**
 * Context provider for Panoptic v2 SDK hooks.
 *
 * Wraps children with shared publicClient, walletClient, account, chainId, and storage.
 * Does NOT include QueryClientProvider — you must provide your own.
 *
 * @example
 * ```tsx
 * <QueryClientProvider client={queryClient}>
 *   <PanopticProvider
 *     publicClient={publicClient}
 *     walletClient={walletClient}
 *     account={address}
 *     chainId={1n}
 *   >
 *     <App />
 *   </PanopticProvider>
 * </QueryClientProvider>
 * ```
 */
export function PanopticProvider({ children, ...value }: PanopticProviderProps) {
  return <PanopticContext.Provider value={value}>{children}</PanopticContext.Provider>
}

/**
 * Access the Panoptic SDK context.
 *
 * @throws Error if used outside PanopticProvider
 * @returns PanopticContextValue
 */
export function usePanopticContext(): PanopticContextValue {
  const ctx = useContext(PanopticContext)
  if (!ctx) {
    throw new Error('usePanopticContext must be used within a PanopticProvider')
  }
  return ctx
}

/**
 * Internal hook that requires walletClient and account.
 *
 * @throws Error if walletClient or account not provided in context
 * @returns { walletClient, account } guaranteed non-undefined
 */
export function useRequireWallet(): { walletClient: WalletClient; account: Address } {
  const { walletClient, account } = usePanopticContext()
  if (!walletClient || !account) {
    throw new Error('walletClient and account are required. Provide them via PanopticProvider.')
  }
  return { walletClient, account }
}

/**
 * Internal hook that requires storage adapter.
 *
 * @throws Error if storage not provided in context
 * @returns StorageAdapter guaranteed non-undefined
 */
export function useRequireStorage(): StorageAdapter {
  const { storage } = usePanopticContext()
  if (!storage) {
    throw new Error('storage is required. Provide a StorageAdapter via PanopticProvider.')
  }
  return storage
}
