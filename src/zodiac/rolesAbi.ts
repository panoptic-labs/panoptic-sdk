/** Minimal Zodiac Roles v2 modifier ABI used by the scoping/apply flows. */
export const rolesV2Abi = [
  {
    type: 'function',
    name: 'assignRoles',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'module', type: 'address' },
      { name: 'roleKeys', type: 'bytes32[]' },
      { name: 'memberOf', type: 'bool[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'scopeTarget',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roleKey', type: 'bytes32' },
      { name: 'targetAddress', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'scopeFunction',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roleKey', type: 'bytes32' },
      { name: 'targetAddress', type: 'address' },
      { name: 'selector', type: 'bytes4' },
      {
        name: 'conditions',
        type: 'tuple[]',
        components: [
          { name: 'parent', type: 'uint8' },
          { name: 'paramType', type: 'uint8' },
          { name: 'operator', type: 'uint8' },
          { name: 'compValue', type: 'bytes' },
        ],
      },
      { name: 'options', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'allowFunction',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roleKey', type: 'bytes32' },
      { name: 'targetAddress', type: 'address' },
      { name: 'selector', type: 'bytes4' },
      { name: 'options', type: 'uint8' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setTransactionUnwrapper',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'selector', type: 'bytes4' },
      { name: 'adapter', type: 'address' },
    ],
    outputs: [],
  },
] as const
