import { useQuery } from '@tanstack/react-query'

import { getWithdrawalPreview } from '../../reads/withdrawalPreview'
import { getClientCacheScopeKey } from '../cacheScopes'
import { usePanopticContext } from '../provider'

export function useWithdrawalPreview(
  params: Omit<Parameters<typeof getWithdrawalPreview>[0], 'client'>,
  enabled = true,
) {
  const { publicClient, clientScope, chainId } = usePanopticContext()
  return useQuery({
    queryKey: [
      'withdrawalPreview',
      chainId,
      getClientCacheScopeKey(publicClient, clientScope),
      params,
    ],
    queryFn: () => getWithdrawalPreview({ ...params, client: publicClient }),
    enabled: enabled && params.assets > 0n,
    staleTime: 0,
    refetchInterval: 15_000,
    retry: false,
  })
}
