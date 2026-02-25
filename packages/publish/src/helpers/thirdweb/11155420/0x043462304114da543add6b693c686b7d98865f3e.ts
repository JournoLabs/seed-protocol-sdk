import {
  prepareEvent,
  prepareContractCall,
  readContract,
  type BaseTransactionOptions,
  type AbiParameterToPrimitiveType,
} from "thirdweb";

/**
* Contract events
*/



/**
 * Creates an event object for the CreatedAttestation event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { createdAttestationEvent } from "TODO";
 *
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  createdAttestationEvent()
 * ],
 * });
 * ```
 */
export function createdAttestationEvent() {
  return prepareEvent({
    signature: "event CreatedAttestation((bytes32 schemaUid, bytes32 attestationUid) result)",
  });
};
  

/**
 * Represents the filters for the "ModuleInitialized" event.
 */
export type ModuleInitializedEventFilters = Partial<{
  account: AbiParameterToPrimitiveType<{"indexed":true,"internalType":"address","name":"account","type":"address"}>
eas: AbiParameterToPrimitiveType<{"indexed":true,"internalType":"address","name":"eas","type":"address"}>
}>;

/**
 * Creates an event object for the ModuleInitialized event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { moduleInitializedEvent } from "TODO";
 *
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  moduleInitializedEvent({
 *  account: ...,
 *  eas: ...,
 * })
 * ],
 * });
 * ```
 */
export function moduleInitializedEvent(filters: ModuleInitializedEventFilters = {}) {
  return prepareEvent({
    signature: "event ModuleInitialized(address indexed account, address indexed eas)",
    filters,
  });
};
  

/**
 * Represents the filters for the "ModuleUninitialized" event.
 */
export type ModuleUninitializedEventFilters = Partial<{
  account: AbiParameterToPrimitiveType<{"indexed":true,"internalType":"address","name":"account","type":"address"}>
}>;

/**
 * Creates an event object for the ModuleUninitialized event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { moduleUninitializedEvent } from "TODO";
 *
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  moduleUninitializedEvent({
 *  account: ...,
 * })
 * ],
 * });
 * ```
 */
export function moduleUninitializedEvent(filters: ModuleUninitializedEventFilters = {}) {
  return prepareEvent({
    signature: "event ModuleUninitialized(address indexed account)",
    filters,
  });
};
  



/**
 * Creates an event object for the SeedPublished event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { seedPublishedEvent } from "TODO";
 *
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  seedPublishedEvent()
 * ],
 * });
 * ```
 */
export function seedPublishedEvent() {
  return prepareEvent({
    signature: "event SeedPublished(bytes32 seedUid, bytes32 versionUid)",
  });
};
  

/**
* Contract read functions
*/

/**
 * Represents the parameters for the "getEAS" function.
 */
export type GetEASParams = {
  account: AbiParameterToPrimitiveType<{"internalType":"address","name":"account","type":"address"}>
};

/**
 * Calls the "getEAS" function on the contract.
 * @param options - The options for the getEAS function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getEAS } from "TODO";
 *
 * const result = await getEAS({
 *  account: ...,
 * });
 *
 * ```
 */
export async function getEAS(
  options: BaseTransactionOptions<GetEASParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x7dda06c4",
  [
    {
      "internalType": "address",
      "name": "account",
      "type": "address"
    }
  ],
  [
    {
      "internalType": "address",
      "name": "",
      "type": "address"
    }
  ]
],
    params: [options.account]
  });
};


/**
 * Represents the parameters for the "isInitialized" function.
 */
export type IsInitializedParams = {
  account: AbiParameterToPrimitiveType<{"internalType":"address","name":"account","type":"address"}>
};

/**
 * Calls the "isInitialized" function on the contract.
 * @param options - The options for the isInitialized function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { isInitialized } from "TODO";
 *
 * const result = await isInitialized({
 *  account: ...,
 * });
 *
 * ```
 */
export async function isInitialized(
  options: BaseTransactionOptions<IsInitializedParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xd60b347f",
  [
    {
      "internalType": "address",
      "name": "account",
      "type": "address"
    }
  ],
  [
    {
      "internalType": "bool",
      "name": "",
      "type": "bool"
    }
  ]
],
    params: [options.account]
  });
};


/**
 * Represents the parameters for the "isModuleType" function.
 */
export type IsModuleTypeParams = {
  moduleTypeId: AbiParameterToPrimitiveType<{"internalType":"uint256","name":"moduleTypeId","type":"uint256"}>
};

/**
 * Calls the "isModuleType" function on the contract.
 * @param options - The options for the isModuleType function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { isModuleType } from "TODO";
 *
 * const result = await isModuleType({
 *  moduleTypeId: ...,
 * });
 *
 * ```
 */
export async function isModuleType(
  options: BaseTransactionOptions<IsModuleTypeParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xecd05961",
  [
    {
      "internalType": "uint256",
      "name": "moduleTypeId",
      "type": "uint256"
    }
  ],
  [
    {
      "internalType": "bool",
      "name": "",
      "type": "bool"
    }
  ]
],
    params: [options.moduleTypeId]
  });
};


/**
* Contract write functions
*/

/**
 * Represents the parameters for the "createSeed" function.
 */
export type CreateSeedParams = {
  schemaUid: AbiParameterToPrimitiveType<{"internalType":"bytes32","name":"schemaUid","type":"bytes32"}>
revocable: AbiParameterToPrimitiveType<{"internalType":"bool","name":"revocable","type":"bool"}>
};

/**
 * Calls the "createSeed" function on the contract.
 * @param options - The options for the "createSeed" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { createSeed } from "TODO";
 *
 * const transaction = createSeed({
 *  schemaUid: ...,
 *  revocable: ...,
 * });
 *
 * // Send the transaction
 * ...
 *
 * ```
 */
export function createSeed(
  options: BaseTransactionOptions<CreateSeedParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x6240d6d9",
  [
    {
      "internalType": "bytes32",
      "name": "schemaUid",
      "type": "bytes32"
    },
    {
      "internalType": "bool",
      "name": "revocable",
      "type": "bool"
    }
  ],
  [
    {
      "internalType": "bytes32",
      "name": "",
      "type": "bytes32"
    }
  ]
],
    params: [options.schemaUid, options.revocable]
  });
};


/**
 * Represents the parameters for the "createVersion" function.
 */
export type CreateVersionParams = {
  seedUid: AbiParameterToPrimitiveType<{"internalType":"bytes32","name":"seedUid","type":"bytes32"}>
versionSchemaUid: AbiParameterToPrimitiveType<{"internalType":"bytes32","name":"versionSchemaUid","type":"bytes32"}>
};

/**
 * Calls the "createVersion" function on the contract.
 * @param options - The options for the "createVersion" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { createVersion } from "TODO";
 *
 * const transaction = createVersion({
 *  seedUid: ...,
 *  versionSchemaUid: ...,
 * });
 *
 * // Send the transaction
 * ...
 *
 * ```
 */
export function createVersion(
  options: BaseTransactionOptions<CreateVersionParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x13e0c263",
  [
    {
      "internalType": "bytes32",
      "name": "seedUid",
      "type": "bytes32"
    },
    {
      "internalType": "bytes32",
      "name": "versionSchemaUid",
      "type": "bytes32"
    }
  ],
  [
    {
      "internalType": "bytes32",
      "name": "",
      "type": "bytes32"
    }
  ]
],
    params: [options.seedUid, options.versionSchemaUid]
  });
};


/**
 * Represents the parameters for the "multiPublish" function.
 */
export type MultiPublishParams = {
  requests: AbiParameterToPrimitiveType<{"components":[{"internalType":"string","name":"localId","type":"string"},{"internalType":"bytes32","name":"seedUid","type":"bytes32"},{"internalType":"bytes32","name":"versionUid","type":"bytes32"},{"internalType":"bytes32","name":"seedSchemaUid","type":"bytes32"},{"internalType":"bytes32","name":"versionSchemaUid","type":"bytes32"},{"internalType":"bool","name":"seedIsRevocable","type":"bool"},{"components":[{"internalType":"bytes32","name":"schema","type":"bytes32"},{"components":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint64","name":"expirationTime","type":"uint64"},{"internalType":"bool","name":"revocable","type":"bool"},{"internalType":"bytes32","name":"refUID","type":"bytes32"},{"internalType":"bytes","name":"data","type":"bytes"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct AttestationRequestData[]","name":"data","type":"tuple[]"}],"internalType":"struct MultiAttestationRequest[]","name":"listOfAttestations","type":"tuple[]"},{"components":[{"internalType":"uint256","name":"publishIndex","type":"uint256"},{"internalType":"bytes32","name":"propertySchemaUid","type":"bytes32"}],"internalType":"struct PropertyToUpdateWithSeed[]","name":"propertiesToUpdate","type":"tuple[]"}],"internalType":"struct PublishRequestData[]","name":"requests","type":"tuple[]"}>
};

/**
 * Calls the "multiPublish" function on the contract.
 * @param options - The options for the "multiPublish" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { multiPublish } from "TODO";
 *
 * const transaction = multiPublish({
 *  requests: ...,
 * });
 *
 * // Send the transaction
 * ...
 *
 * ```
 */
export function multiPublish(
  options: BaseTransactionOptions<MultiPublishParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x2a29fadc",
  [
    {
      "components": [
        {
          "internalType": "string",
          "name": "localId",
          "type": "string"
        },
        {
          "internalType": "bytes32",
          "name": "seedUid",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "versionUid",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "seedSchemaUid",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "versionSchemaUid",
          "type": "bytes32"
        },
        {
          "internalType": "bool",
          "name": "seedIsRevocable",
          "type": "bool"
        },
        {
          "components": [
            {
              "internalType": "bytes32",
              "name": "schema",
              "type": "bytes32"
            },
            {
              "components": [
                {
                  "internalType": "address",
                  "name": "recipient",
                  "type": "address"
                },
                {
                  "internalType": "uint64",
                  "name": "expirationTime",
                  "type": "uint64"
                },
                {
                  "internalType": "bool",
                  "name": "revocable",
                  "type": "bool"
                },
                {
                  "internalType": "bytes32",
                  "name": "refUID",
                  "type": "bytes32"
                },
                {
                  "internalType": "bytes",
                  "name": "data",
                  "type": "bytes"
                },
                {
                  "internalType": "uint256",
                  "name": "value",
                  "type": "uint256"
                }
              ],
              "internalType": "struct AttestationRequestData[]",
              "name": "data",
              "type": "tuple[]"
            }
          ],
          "internalType": "struct MultiAttestationRequest[]",
          "name": "listOfAttestations",
          "type": "tuple[]"
        },
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "publishIndex",
              "type": "uint256"
            },
            {
              "internalType": "bytes32",
              "name": "propertySchemaUid",
              "type": "bytes32"
            }
          ],
          "internalType": "struct PropertyToUpdateWithSeed[]",
          "name": "propertiesToUpdate",
          "type": "tuple[]"
        }
      ],
      "internalType": "struct PublishRequestData[]",
      "name": "requests",
      "type": "tuple[]"
    }
  ],
  [
    {
      "internalType": "bytes32[]",
      "name": "",
      "type": "bytes32[]"
    }
  ]
],
    params: [options.requests]
  });
};


/**
 * Represents the parameters for the "onInstall" function.
 */
export type OnInstallParams = {
  data: AbiParameterToPrimitiveType<{"internalType":"bytes","name":"data","type":"bytes"}>
};

/**
 * Calls the "onInstall" function on the contract.
 * @param options - The options for the "onInstall" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onInstall } from "TODO";
 *
 * const transaction = onInstall({
 *  data: ...,
 * });
 *
 * // Send the transaction
 * ...
 *
 * ```
 */
export function onInstall(
  options: BaseTransactionOptions<OnInstallParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x6d61fe70",
  [
    {
      "internalType": "bytes",
      "name": "data",
      "type": "bytes"
    }
  ],
  []
],
    params: [options.data]
  });
};


/**
 * Represents the parameters for the "onUninstall" function.
 */
export type OnUninstallParams = {
  arg_0: AbiParameterToPrimitiveType<{"internalType":"bytes","name":"","type":"bytes"}>
};

/**
 * Calls the "onUninstall" function on the contract.
 * @param options - The options for the "onUninstall" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onUninstall } from "TODO";
 *
 * const transaction = onUninstall({
 *  arg_0: ...,
 * });
 *
 * // Send the transaction
 * ...
 *
 * ```
 */
export function onUninstall(
  options: BaseTransactionOptions<OnUninstallParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x8a91b0e3",
  [
    {
      "internalType": "bytes",
      "name": "",
      "type": "bytes"
    }
  ],
  []
],
    params: [options.arg_0]
  });
};


/**
 * Represents the parameters for the "publish" function.
 */
export type PublishParams = {
  request: AbiParameterToPrimitiveType<{"components":[{"internalType":"string","name":"localId","type":"string"},{"internalType":"bytes32","name":"seedUid","type":"bytes32"},{"internalType":"bytes32","name":"versionUid","type":"bytes32"},{"internalType":"bytes32","name":"seedSchemaUid","type":"bytes32"},{"internalType":"bytes32","name":"versionSchemaUid","type":"bytes32"},{"internalType":"bool","name":"seedIsRevocable","type":"bool"},{"components":[{"internalType":"bytes32","name":"schema","type":"bytes32"},{"components":[{"internalType":"address","name":"recipient","type":"address"},{"internalType":"uint64","name":"expirationTime","type":"uint64"},{"internalType":"bool","name":"revocable","type":"bool"},{"internalType":"bytes32","name":"refUID","type":"bytes32"},{"internalType":"bytes","name":"data","type":"bytes"},{"internalType":"uint256","name":"value","type":"uint256"}],"internalType":"struct AttestationRequestData[]","name":"data","type":"tuple[]"}],"internalType":"struct MultiAttestationRequest[]","name":"listOfAttestations","type":"tuple[]"},{"components":[{"internalType":"uint256","name":"publishIndex","type":"uint256"},{"internalType":"bytes32","name":"propertySchemaUid","type":"bytes32"}],"internalType":"struct PropertyToUpdateWithSeed[]","name":"propertiesToUpdate","type":"tuple[]"}],"internalType":"struct PublishRequestData","name":"request","type":"tuple"}>
};

/**
 * Calls the "publish" function on the contract.
 * @param options - The options for the "publish" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { publish } from "TODO";
 *
 * const transaction = publish({
 *  request: ...,
 * });
 *
 * // Send the transaction
 * ...
 *
 * ```
 */
export function publish(
  options: BaseTransactionOptions<PublishParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x801d5ac9",
  [
    {
      "components": [
        {
          "internalType": "string",
          "name": "localId",
          "type": "string"
        },
        {
          "internalType": "bytes32",
          "name": "seedUid",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "versionUid",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "seedSchemaUid",
          "type": "bytes32"
        },
        {
          "internalType": "bytes32",
          "name": "versionSchemaUid",
          "type": "bytes32"
        },
        {
          "internalType": "bool",
          "name": "seedIsRevocable",
          "type": "bool"
        },
        {
          "components": [
            {
              "internalType": "bytes32",
              "name": "schema",
              "type": "bytes32"
            },
            {
              "components": [
                {
                  "internalType": "address",
                  "name": "recipient",
                  "type": "address"
                },
                {
                  "internalType": "uint64",
                  "name": "expirationTime",
                  "type": "uint64"
                },
                {
                  "internalType": "bool",
                  "name": "revocable",
                  "type": "bool"
                },
                {
                  "internalType": "bytes32",
                  "name": "refUID",
                  "type": "bytes32"
                },
                {
                  "internalType": "bytes",
                  "name": "data",
                  "type": "bytes"
                },
                {
                  "internalType": "uint256",
                  "name": "value",
                  "type": "uint256"
                }
              ],
              "internalType": "struct AttestationRequestData[]",
              "name": "data",
              "type": "tuple[]"
            }
          ],
          "internalType": "struct MultiAttestationRequest[]",
          "name": "listOfAttestations",
          "type": "tuple[]"
        },
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "publishIndex",
              "type": "uint256"
            },
            {
              "internalType": "bytes32",
              "name": "propertySchemaUid",
              "type": "bytes32"
            }
          ],
          "internalType": "struct PropertyToUpdateWithSeed[]",
          "name": "propertiesToUpdate",
          "type": "tuple[]"
        }
      ],
      "internalType": "struct PublishRequestData",
      "name": "request",
      "type": "tuple"
    }
  ],
  [
    {
      "internalType": "bytes32",
      "name": "",
      "type": "bytes32"
    },
    {
      "internalType": "bytes32",
      "name": "",
      "type": "bytes32"
    }
  ]
],
    params: [options.request]
  });
};


