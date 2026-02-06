/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from '@testing-library/react'
import React, { type ReactNode } from 'react'
import invariant from 'tiny-invariant'
import { createTestClient, http, publicActions, walletActions } from 'viem'
import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { dealActions } from 'viem-deal'
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createConfig, mock } from 'wagmi'

import { Erc20Abi } from '../../../abis/erc20ABI'
import { HypoVaultAbi } from '../../../abis/HypoVault'
import { getAlchemyRpcUrl } from '../../../rpc'
import { killAnvilProcess, ReactTestWrapper, spawnAnvil } from '../../../test'
import { useRequestDeposit } from './use-request-deposit'

function getAnvilPort(): number {
  const basePort = Number(process.env.ANVIL_PORT ?? 8546)
  const workerId = Number(process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? 0)
  return Number.isFinite(workerId) ? basePort + workerId : basePort
}

const buildTestWagmiConfig = ({
  anvilPort,
  anvilMnemonic,
}: {
  anvilPort: number
  anvilMnemonic: string
}) => {
  const account = mnemonicToAccount(anvilMnemonic)

  return createConfig({
    chains: [sepolia],
    client: () => {
      return createTestClient({
        account,
        chain: sepolia,
        mode: 'anvil',
        transport: http(`http://127.0.0.1:${anvilPort}`),
        pollingInterval: 100,
      })
        .extend(publicActions)
        .extend(walletActions)
        .extend(dealActions)
    },
    connectors: [
      mock({
        accounts: [account.address],
        features: {
          // TODO: this option doesn't actually work, wtf? need to connect on wrapper mount
          // defaultConnected: true,
        },
      }),
    ],
  })
}

describe('useRequestDeposit', () => {
  let alchemyApiKey: string
  let anvilMnemonic: string

  beforeAll(() => {
    invariant(process.env.ALCHEMY_API_KEY !== undefined, 'Must have ALCHEMY_API_KEY set')
    alchemyApiKey = process.env.ALCHEMY_API_KEY
  })

  beforeEach(async () => {
    const anvilPort = getAnvilPort()
    await killAnvilProcess(anvilPort)

    anvilMnemonic = generateMnemonic(english)

    await spawnAnvil({
      forkUrl: getAlchemyRpcUrl(sepolia.id, alchemyApiKey),
      mnemonic: anvilMnemonic,
      chainId: sepolia.id,
      noCors: true,
      autoImpersonate: true,
      port: anvilPort,
      hardfork: 'Cancun',
    })
  })

  afterEach(async () => {
    const resetClient = createTestClient({
      transport: http(`http://127.0.0.1:${getAnvilPort()}`),
      chain: sepolia,
      mode: 'anvil',
    })

    await resetClient.reset({
      jsonRpcUrl: getAlchemyRpcUrl(sepolia.id, alchemyApiKey),
    })
  })

  test('should request deposit', async () => {
    // Arrange
    const assets = 100n
    const wethLendVaultAddress = '0x03eb72230f5a582ba4b0fa92b912f5d39705fe4b'
    const anvilPort = getAnvilPort()
    const account = mnemonicToAccount(anvilMnemonic)
    const testClient = createTestClient({
      transport: http(`http://127.0.0.1:${anvilPort}`),
      chain: sepolia,
      mode: 'anvil',
      account,
    })
      .extend(publicActions)
      .extend(walletActions)
      .extend(dealActions)

    const underlyingToken = await testClient.readContract({
      address: wethLendVaultAddress,
      abi: HypoVaultAbi,
      functionName: 'underlyingToken',
    })

    const dealAmount = assets * 10n
    await testClient.deal({
      erc20: underlyingToken,
      account: account.address,
      amount: dealAmount,
    })

    await testClient.writeContract({
      address: underlyingToken,
      abi: Erc20Abi,
      functionName: 'approve',
      args: [wethLendVaultAddress, dealAmount],
      account,
    })

    // Act
    const wagmiConfig = buildTestWagmiConfig({ anvilPort, anvilMnemonic })
    const wrapper = ({ children }: { children?: ReactNode }) => (
      <ReactTestWrapper wagmiConfig={wagmiConfig}>{children}</ReactTestWrapper>
    )

    const { result } = renderHook(
      () =>
        useRequestDeposit({
          vaultAddress: wethLendVaultAddress,
          assets,
          tokenAddress: underlyingToken,
        }),
      {
        wrapper,
      },
    )

    // Assert
    await waitFor(
      () => {
        expect(result.current.simulate.isLoading).toBeFalsy()
        expect(result.current.simulate.isSuccess).toBeTruthy()
      },
      { timeout: 15_000 },
    )
  }, 20_000)
})
