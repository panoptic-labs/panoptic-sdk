import type { CodegenConfig } from '@graphql-codegen/cli'

import {
  CHAIN_DEPLOYMENTS,
  isSupportedChain,
  requireChainDeployment,
  SEPOLIA_CHAIN_ID,
} from './src/hypoVault/chainDeployments'

function resolveCodegenChainId(envValue: string | undefined): number {
  const trimmed = envValue?.trim() ?? ''
  if (trimmed.length === 0) {
    return SEPOLIA_CHAIN_ID
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(
      `Invalid HYPOVAULT_CODEGEN_CHAIN_ID "${trimmed}". Expected an integer chain id.`,
    )
  }

  if (!isSupportedChain(parsed)) {
    const supported = Object.keys(CHAIN_DEPLOYMENTS)
      .map((value) => Number(value))
      .sort((left, right) => left - right)
      .join(', ')
    throw new Error(
      `Unsupported HYPOVAULT_CODEGEN_CHAIN_ID "${trimmed}". Supported chain ids: ${supported}.`,
    )
  }

  return parsed
}

const getConfig = async (): Promise<CodegenConfig> => {
  // const PANOPTIC_GRAPHQL_API =
  // 'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-base/dev/gn'

  const chainId = resolveCodegenChainId(process.env.HYPOVAULT_CODEGEN_CHAIN_ID)
  const HYPOVAULT_GRAPHQL_API = requireChainDeployment(chainId).subgraphs.hypovault

  return {
    overwrite: true,
    generates: {
      // 'graphql/types.generated.ts': {
      //   schema: PANOPTIC_GRAPHQL_API,
      //   documents: ['graphql/panoptic/**/*.graphql'],
      //   plugins: ['typescript', 'typescript-operations'],
      //   config: {
      //     emitLegacyCommonJSImports: false,
      //     avoidOptionals: {
      //       object: false,
      //       inputValue: false,
      //     },
      //     declarationKind: 'interface',
      //     scalars: {
      //       BigInt: 'string',
      //       BigDecimal: 'string',
      //     },
      //   },
      // },
      // 'graphql/sdk.generated.ts': {
      //   schema: PANOPTIC_GRAPHQL_API,
      //   documents: ['graphql/panoptic/**/*.graphql'],
      //   preset: 'import-types',
      //   presetConfig: {
      //     typesPath: './types.generated',
      //   },
      //   plugins: ['typescript-graphql-request'],
      //   config: {
      //     emitLegacyCommonJSImports: false,
      //     avoidOptionals: false,
      //   },
      // },
      './src/graphql/hypoVault-types.generated.ts': {
        schema: HYPOVAULT_GRAPHQL_API,
        documents: ['./src/graphql/hypoVault/**/*.graphql'],
        plugins: ['typescript', 'typescript-operations'],
        config: {
          emitLegacyCommonJSImports: false,
          avoidOptionals: {
            object: false,
            inputValue: false,
          },
          declarationKind: 'interface',
          scalars: {
            BigInt: 'string',
            BigDecimal: 'string',
            Bytes: 'string',
            ID: 'string',
          },
        },
      },
      './src/graphql/hypoVault-sdk.generated.ts': {
        schema: HYPOVAULT_GRAPHQL_API,
        documents: ['./src/graphql/hypoVault/**/*.graphql'],
        preset: 'import-types',
        presetConfig: {
          typesPath: './hypoVault-types.generated',
        },
        plugins: ['typescript-graphql-request'],
        config: {
          emitLegacyCommonJSImports: false,
          avoidOptionals: false,
        },
      },
    },
    // hooks: {
    //   afterAllFileWrite: ['eslint --fix'],
    // },
  }
}

export default getConfig()
