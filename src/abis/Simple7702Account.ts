import { parseAbi } from 'viem'

export const Simple7702AccountAbi = parseAbi([
  'function executeBatch((address target,uint256 value,bytes data)[] calls)',
  'error ExecuteError(uint256 callIndex, bytes revertData)',
])
