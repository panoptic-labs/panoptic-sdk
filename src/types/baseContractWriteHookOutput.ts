import type { Abi, ContractFunctionArgs, ContractFunctionName } from 'viem'
import type {
  Config,
  UseSimulateContractReturnType,
  UseWaitForTransactionReceiptReturnType,
  UseWriteContractReturnType,
} from 'wagmi'

export type BaseContractWriteHookOutput = {
  actionLabel: string
  act: () => void
  isLoading: boolean
  error: Error | undefined
  simulate: UseSimulateContractReturnType<
    Abi,
    ContractFunctionName<Abi, 'nonpayable' | 'payable'>,
    ContractFunctionArgs<Abi, 'nonpayable' | 'payable'>,
    Config,
    number,
    unknown
  >
  write: UseWriteContractReturnType<Config, unknown>
  wait: UseWaitForTransactionReceiptReturnType
}
