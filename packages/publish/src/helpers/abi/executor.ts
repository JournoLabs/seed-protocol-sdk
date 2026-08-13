/**
 * Modular executor module events (0x043462…).
 * CreatedAttestation matches publisher; SeedPublished uses typed bytes32 args.
 */
export const executorEventsAbi = [
  {
    type: 'event',
    name: 'CreatedAttestation',
    inputs: [
      {
        name: 'result',
        type: 'tuple',
        indexed: false,
        components: [
          { name: 'schemaUid', type: 'bytes32' },
          { name: 'attestationUid', type: 'bytes32' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'SeedPublished',
    inputs: [
      { name: 'seedUid', type: 'bytes32', indexed: false },
      { name: 'versionUid', type: 'bytes32', indexed: false },
    ],
  },
] as const
