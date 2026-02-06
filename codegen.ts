import type { CodegenConfig } from '@graphql-codegen/cli'

const getConfig = async (): Promise<CodegenConfig> => {
  // const PANOPTIC_GRAPHQL_API =
  // 'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/panoptic-subgraph-base/dev/gn'

  const HYPOVAULT_GRAPHQL_API =
    'https://api.goldsky.com/api/public/project_cl9gc21q105380hxuh8ks53k3/subgraphs/hypovault-subgraph-sepolia/prod/gn'

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
