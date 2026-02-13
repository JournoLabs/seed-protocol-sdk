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
 * Represents the filters for the "AdminUpdated" event.
 */
export type AdminUpdatedEventFilters = Partial<{
  signer: AbiParameterToPrimitiveType<{"type":"address","name":"signer","indexed":true}>
}>;

/**
 * Creates an event object for the AdminUpdated event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { adminUpdatedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  adminUpdatedEvent({
 *  signer: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function adminUpdatedEvent(filters: AdminUpdatedEventFilters = {}) {
  return prepareEvent({
    signature: "event AdminUpdated(address indexed signer, bool isAdmin)",
    filters,
  });
};
  



/**
 * Creates an event object for the Initialized event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { initializedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  initializedEvent()
 * ],
 * });
 * ```
 */ 
export function initializedEvent() {
  return prepareEvent({
    signature: "event Initialized(uint8 version)",
  });
};
  

/**
 * Represents the filters for the "SignerPermissionsUpdated" event.
 */
export type SignerPermissionsUpdatedEventFilters = Partial<{
  authorizingSigner: AbiParameterToPrimitiveType<{"type":"address","name":"authorizingSigner","indexed":true}>
targetSigner: AbiParameterToPrimitiveType<{"type":"address","name":"targetSigner","indexed":true}>
}>;

/**
 * Creates an event object for the SignerPermissionsUpdated event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { signerPermissionsUpdatedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  signerPermissionsUpdatedEvent({
 *  authorizingSigner: ...,
 *  targetSigner: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function signerPermissionsUpdatedEvent(filters: SignerPermissionsUpdatedEventFilters = {}) {
  return prepareEvent({
    signature: "event SignerPermissionsUpdated(address indexed authorizingSigner, address indexed targetSigner, (address signer, uint8 isAdmin, address[] approvedTargets, uint256 nativeTokenLimitPerTransaction, uint128 permissionStartTimestamp, uint128 permissionEndTimestamp, uint128 reqValidityStartTimestamp, uint128 reqValidityEndTimestamp, bytes32 uid) permissions)",
    filters,
  });
};
  



/**
 * Creates an event object for the ContractURIUpdated event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { contractURIUpdatedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  contractURIUpdatedEvent()
 * ],
 * });
 * ```
 */ 
export function contractURIUpdatedEvent() {
  return prepareEvent({
    signature: "event ContractURIUpdated(string prevURI, string newURI)",
  });
};
  



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
 * Creates an event object for the EIP712DomainChanged event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { eIP712DomainChangedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  eIP712DomainChangedEvent()
 * ],
 * });
 * ```
 */ 
export function eIP712DomainChangedEvent() {
  return prepareEvent({
    signature: "event EIP712DomainChanged()",
  });
};
  



/**
 * Creates an event object for the Log event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { logEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  logEvent()
 * ],
 * });
 * ```
 */ 
export function logEvent() {
  return prepareEvent({
    signature: "event Log(string message)",
  });
};
  

/**
 * Represents the filters for the "OwnershipTransferred" event.
 */
export type OwnershipTransferredEventFilters = Partial<{
  previousOwner: AbiParameterToPrimitiveType<{"type":"address","name":"previousOwner","indexed":true}>
newOwner: AbiParameterToPrimitiveType<{"type":"address","name":"newOwner","indexed":true}>
}>;

/**
 * Creates an event object for the OwnershipTransferred event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { ownershipTransferredEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  ownershipTransferredEvent({
 *  previousOwner: ...,
 *  newOwner: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function ownershipTransferredEvent(filters: OwnershipTransferredEventFilters = {}) {
  return prepareEvent({
    signature: "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
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
    signature: "event SeedPublished(bytes returnedDataFromEAS)",
  });
};
  

/**
* Contract read functions
*/



/**
 * Calls the "entryPoint" function on the contract.
 * @param options - The options for the entryPoint function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { entryPoint } from "TODO";
 * 
 * const result = await entryPoint();
 * 
 * ```
 */
export async function entryPoint(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xb0d691fe",
  [],
  [
    {
      "type": "address"
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "factory" function on the contract.
 * @param options - The options for the factory function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { factory } from "TODO";
 * 
 * const result = await factory();
 * 
 * ```
 */
export async function factory(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xc45a0155",
  [],
  [
    {
      "type": "address"
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "getAllActiveSigners" function on the contract.
 * @param options - The options for the getAllActiveSigners function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAllActiveSigners } from "TODO";
 * 
 * const result = await getAllActiveSigners();
 * 
 * ```
 */
export async function getAllActiveSigners(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x8b52d723",
  [],
  [
    {
      "type": "tuple[]",
      "name": "signers",
      "components": [
        {
          "type": "address",
          "name": "signer"
        },
        {
          "type": "address[]",
          "name": "approvedTargets"
        },
        {
          "type": "uint256",
          "name": "nativeTokenLimitPerTransaction"
        },
        {
          "type": "uint128",
          "name": "startTimestamp"
        },
        {
          "type": "uint128",
          "name": "endTimestamp"
        }
      ]
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "getAllAdmins" function on the contract.
 * @param options - The options for the getAllAdmins function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAllAdmins } from "TODO";
 * 
 * const result = await getAllAdmins();
 * 
 * ```
 */
export async function getAllAdmins(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xe9523c97",
  [],
  [
    {
      "type": "address[]"
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "getAllExtensions" function on the contract.
 * @param options - The options for the getAllExtensions function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAllExtensions } from "TODO";
 * 
 * const result = await getAllExtensions();
 * 
 * ```
 */
export async function getAllExtensions(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x4a00cc48",
  [],
  [
    {
      "type": "tuple[]",
      "components": [
        {
          "type": "tuple",
          "name": "metadata",
          "components": [
            {
              "type": "string",
              "name": "name"
            },
            {
              "type": "string",
              "name": "metadataURI"
            },
            {
              "type": "address",
              "name": "implementation"
            }
          ]
        },
        {
          "type": "tuple[]",
          "name": "functions",
          "components": [
            {
              "type": "bytes4",
              "name": "functionSelector"
            },
            {
              "type": "string",
              "name": "functionSignature"
            }
          ]
        }
      ]
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "getAllSigners" function on the contract.
 * @param options - The options for the getAllSigners function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAllSigners } from "TODO";
 * 
 * const result = await getAllSigners();
 * 
 * ```
 */
export async function getAllSigners(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xd42f2f35",
  [],
  [
    {
      "type": "tuple[]",
      "name": "signers",
      "components": [
        {
          "type": "address",
          "name": "signer"
        },
        {
          "type": "address[]",
          "name": "approvedTargets"
        },
        {
          "type": "uint256",
          "name": "nativeTokenLimitPerTransaction"
        },
        {
          "type": "uint128",
          "name": "startTimestamp"
        },
        {
          "type": "uint128",
          "name": "endTimestamp"
        }
      ]
    }
  ]
],
    params: []
  });
};


/**
 * Represents the parameters for the "getImplementationForFunction" function.
 */
export type GetImplementationForFunctionParams = {
  functionSelector: AbiParameterToPrimitiveType<{"type":"bytes4","name":"_functionSelector"}>
};

/**
 * Calls the "getImplementationForFunction" function on the contract.
 * @param options - The options for the getImplementationForFunction function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getImplementationForFunction } from "TODO";
 * 
 * const result = await getImplementationForFunction({
 *  functionSelector: ...,
 * });
 * 
 * ```
 */
export async function getImplementationForFunction(
  options: BaseTransactionOptions<GetImplementationForFunctionParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xce0b6013",
  [
    {
      "type": "bytes4",
      "name": "_functionSelector"
    }
  ],
  [
    {
      "type": "address"
    }
  ]
],
    params: [options.functionSelector]
  });
};




/**
 * Calls the "getNonce" function on the contract.
 * @param options - The options for the getNonce function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getNonce } from "TODO";
 * 
 * const result = await getNonce();
 * 
 * ```
 */
export async function getNonce(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xd087d288",
  [],
  [
    {
      "type": "uint256"
    }
  ]
],
    params: []
  });
};


/**
 * Represents the parameters for the "getPermissionsForSigner" function.
 */
export type GetPermissionsForSignerParams = {
  signer: AbiParameterToPrimitiveType<{"type":"address","name":"signer"}>
};

/**
 * Calls the "getPermissionsForSigner" function on the contract.
 * @param options - The options for the getPermissionsForSigner function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getPermissionsForSigner } from "TODO";
 * 
 * const result = await getPermissionsForSigner({
 *  signer: ...,
 * });
 * 
 * ```
 */
export async function getPermissionsForSigner(
  options: BaseTransactionOptions<GetPermissionsForSignerParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xf15d424e",
  [
    {
      "type": "address",
      "name": "signer"
    }
  ],
  [
    {
      "type": "tuple",
      "components": [
        {
          "type": "address",
          "name": "signer"
        },
        {
          "type": "address[]",
          "name": "approvedTargets"
        },
        {
          "type": "uint256",
          "name": "nativeTokenLimitPerTransaction"
        },
        {
          "type": "uint128",
          "name": "startTimestamp"
        },
        {
          "type": "uint128",
          "name": "endTimestamp"
        }
      ]
    }
  ]
],
    params: [options.signer]
  });
};


/**
 * Represents the parameters for the "isActiveSigner" function.
 */
export type IsActiveSignerParams = {
  signer: AbiParameterToPrimitiveType<{"type":"address","name":"signer"}>
};

/**
 * Calls the "isActiveSigner" function on the contract.
 * @param options - The options for the isActiveSigner function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { isActiveSigner } from "TODO";
 * 
 * const result = await isActiveSigner({
 *  signer: ...,
 * });
 * 
 * ```
 */
export async function isActiveSigner(
  options: BaseTransactionOptions<IsActiveSignerParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x7dff5a79",
  [
    {
      "type": "address",
      "name": "signer"
    }
  ],
  [
    {
      "type": "bool"
    }
  ]
],
    params: [options.signer]
  });
};


/**
 * Represents the parameters for the "isAdmin" function.
 */
export type IsAdminParams = {
  account: AbiParameterToPrimitiveType<{"type":"address","name":"_account"}>
};

/**
 * Calls the "isAdmin" function on the contract.
 * @param options - The options for the isAdmin function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { isAdmin } from "TODO";
 * 
 * const result = await isAdmin({
 *  account: ...,
 * });
 * 
 * ```
 */
export async function isAdmin(
  options: BaseTransactionOptions<IsAdminParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x24d7806c",
  [
    {
      "type": "address",
      "name": "_account"
    }
  ],
  [
    {
      "type": "bool"
    }
  ]
],
    params: [options.account]
  });
};


/**
 * Represents the parameters for the "isValidSigner" function.
 */
export type IsValidSignerParams = {
  signer: AbiParameterToPrimitiveType<{"type":"address","name":"_signer"}>
userOp: AbiParameterToPrimitiveType<{"type":"tuple","name":"_userOp","components":[{"type":"address","name":"sender"},{"type":"uint256","name":"nonce"},{"type":"bytes","name":"initCode"},{"type":"bytes","name":"callData"},{"type":"uint256","name":"callGasLimit"},{"type":"uint256","name":"verificationGasLimit"},{"type":"uint256","name":"preVerificationGas"},{"type":"uint256","name":"maxFeePerGas"},{"type":"uint256","name":"maxPriorityFeePerGas"},{"type":"bytes","name":"paymasterAndData"},{"type":"bytes","name":"signature"}]}>
};

/**
 * Calls the "isValidSigner" function on the contract.
 * @param options - The options for the isValidSigner function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { isValidSigner } from "TODO";
 * 
 * const result = await isValidSigner({
 *  signer: ...,
 *  userOp: ...,
 * });
 * 
 * ```
 */
export async function isValidSigner(
  options: BaseTransactionOptions<IsValidSignerParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x1dd756c5",
  [
    {
      "type": "address",
      "name": "_signer"
    },
    {
      "type": "tuple",
      "name": "_userOp",
      "components": [
        {
          "type": "address",
          "name": "sender"
        },
        {
          "type": "uint256",
          "name": "nonce"
        },
        {
          "type": "bytes",
          "name": "initCode"
        },
        {
          "type": "bytes",
          "name": "callData"
        },
        {
          "type": "uint256",
          "name": "callGasLimit"
        },
        {
          "type": "uint256",
          "name": "verificationGasLimit"
        },
        {
          "type": "uint256",
          "name": "preVerificationGas"
        },
        {
          "type": "uint256",
          "name": "maxFeePerGas"
        },
        {
          "type": "uint256",
          "name": "maxPriorityFeePerGas"
        },
        {
          "type": "bytes",
          "name": "paymasterAndData"
        },
        {
          "type": "bytes",
          "name": "signature"
        }
      ]
    }
  ],
  [
    {
      "type": "bool"
    }
  ]
],
    params: [options.signer, options.userOp]
  });
};


/**
 * Represents the parameters for the "verifySignerPermissionRequest" function.
 */
export type VerifySignerPermissionRequestParams = {
  req: AbiParameterToPrimitiveType<{"type":"tuple","name":"req","components":[{"type":"address","name":"signer"},{"type":"uint8","name":"isAdmin"},{"type":"address[]","name":"approvedTargets"},{"type":"uint256","name":"nativeTokenLimitPerTransaction"},{"type":"uint128","name":"permissionStartTimestamp"},{"type":"uint128","name":"permissionEndTimestamp"},{"type":"uint128","name":"reqValidityStartTimestamp"},{"type":"uint128","name":"reqValidityEndTimestamp"},{"type":"bytes32","name":"uid"}]}>
signature: AbiParameterToPrimitiveType<{"type":"bytes","name":"signature"}>
};

/**
 * Calls the "verifySignerPermissionRequest" function on the contract.
 * @param options - The options for the verifySignerPermissionRequest function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { verifySignerPermissionRequest } from "TODO";
 * 
 * const result = await verifySignerPermissionRequest({
 *  req: ...,
 *  signature: ...,
 * });
 * 
 * ```
 */
export async function verifySignerPermissionRequest(
  options: BaseTransactionOptions<VerifySignerPermissionRequestParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xa9082d84",
  [
    {
      "type": "tuple",
      "name": "req",
      "components": [
        {
          "type": "address",
          "name": "signer"
        },
        {
          "type": "uint8",
          "name": "isAdmin"
        },
        {
          "type": "address[]",
          "name": "approvedTargets"
        },
        {
          "type": "uint256",
          "name": "nativeTokenLimitPerTransaction"
        },
        {
          "type": "uint128",
          "name": "permissionStartTimestamp"
        },
        {
          "type": "uint128",
          "name": "permissionEndTimestamp"
        },
        {
          "type": "uint128",
          "name": "reqValidityStartTimestamp"
        },
        {
          "type": "uint128",
          "name": "reqValidityEndTimestamp"
        },
        {
          "type": "bytes32",
          "name": "uid"
        }
      ]
    },
    {
      "type": "bytes",
      "name": "signature"
    }
  ],
  [
    {
      "type": "bool",
      "name": "success"
    },
    {
      "type": "address",
      "name": "signer"
    }
  ]
],
    params: [options.req, options.signature]
  });
};




/**
 * Calls the "contractURI" function on the contract.
 * @param options - The options for the contractURI function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { contractURI } from "TODO";
 * 
 * const result = await contractURI();
 * 
 * ```
 */
export async function contractURI(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xe8a3d485",
  [],
  [
    {
      "type": "string"
    }
  ]
],
    params: []
  });
};


/**
 * Represents the parameters for the "getMessageHash" function.
 */
export type GetMessageHashParams = {
  hash: AbiParameterToPrimitiveType<{"type":"bytes32","name":"_hash"}>
};

/**
 * Calls the "getMessageHash" function on the contract.
 * @param options - The options for the getMessageHash function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getMessageHash } from "TODO";
 * 
 * const result = await getMessageHash({
 *  hash: ...,
 * });
 * 
 * ```
 */
export async function getMessageHash(
  options: BaseTransactionOptions<GetMessageHashParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x399b77da",
  [
    {
      "type": "bytes32",
      "name": "_hash"
    }
  ],
  [
    {
      "type": "bytes32"
    }
  ]
],
    params: [options.hash]
  });
};


/**
 * Represents the parameters for the "isValidSignature" function.
 */
export type IsValidSignatureParams = {
  hash: AbiParameterToPrimitiveType<{"type":"bytes32","name":"_hash"}>
signature: AbiParameterToPrimitiveType<{"type":"bytes","name":"_signature"}>
};

/**
 * Calls the "isValidSignature" function on the contract.
 * @param options - The options for the isValidSignature function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { isValidSignature } from "TODO";
 * 
 * const result = await isValidSignature({
 *  hash: ...,
 *  signature: ...,
 * });
 * 
 * ```
 */
export async function isValidSignature(
  options: BaseTransactionOptions<IsValidSignatureParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x1626ba7e",
  [
    {
      "type": "bytes32",
      "name": "_hash"
    },
    {
      "type": "bytes",
      "name": "_signature"
    }
  ],
  [
    {
      "type": "bytes4",
      "name": "magicValue"
    }
  ]
],
    params: [options.hash, options.signature]
  });
};


/**
 * Represents the parameters for the "supportsInterface" function.
 */
export type SupportsInterfaceParams = {
  interfaceId: AbiParameterToPrimitiveType<{"type":"bytes4","name":"interfaceId"}>
};

/**
 * Calls the "supportsInterface" function on the contract.
 * @param options - The options for the supportsInterface function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { supportsInterface } from "TODO";
 * 
 * const result = await supportsInterface({
 *  interfaceId: ...,
 * });
 * 
 * ```
 */
export async function supportsInterface(
  options: BaseTransactionOptions<SupportsInterfaceParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x01ffc9a7",
  [
    {
      "type": "bytes4",
      "name": "interfaceId"
    }
  ],
  [
    {
      "type": "bool"
    }
  ]
],
    params: [options.interfaceId]
  });
};




/**
 * Calls the "eip712Domain" function on the contract.
 * @param options - The options for the eip712Domain function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { eip712Domain } from "TODO";
 * 
 * const result = await eip712Domain();
 * 
 * ```
 */
export async function eip712Domain(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x84b0196e",
  [],
  [
    {
      "type": "bytes1",
      "name": "fields"
    },
    {
      "type": "string",
      "name": "name"
    },
    {
      "type": "string",
      "name": "version"
    },
    {
      "type": "uint256",
      "name": "chainId"
    },
    {
      "type": "address",
      "name": "verifyingContract"
    },
    {
      "type": "bytes32",
      "name": "salt"
    },
    {
      "type": "uint256[]",
      "name": "extensions"
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "getEas" function on the contract.
 * @param options - The options for the getEas function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getEas } from "TODO";
 * 
 * const result = await getEas();
 * 
 * ```
 */
export async function getEas(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xd5f5127d",
  [],
  [
    {
      "type": "address"
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "owner" function on the contract.
 * @param options - The options for the owner function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { owner } from "TODO";
 * 
 * const result = await owner();
 * 
 * ```
 */
export async function owner(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x8da5cb5b",
  [],
  [
    {
      "type": "address"
    }
  ]
],
    params: []
  });
};


/**
* Contract write functions
*/

/**
 * Represents the parameters for the "initialize" function.
 */
export type InitializeParams = {
  defaultAdmin: AbiParameterToPrimitiveType<{"type":"address","name":"_defaultAdmin"}>
data: AbiParameterToPrimitiveType<{"type":"bytes","name":"_data"}>
};

/**
 * Calls the "initialize" function on the contract.
 * @param options - The options for the "initialize" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { initialize } from "TODO";
 * 
 * const transaction = initialize({
 *  defaultAdmin: ...,
 *  data: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function initialize(
  options: BaseTransactionOptions<InitializeParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xd1f57894",
  [
    {
      "type": "address",
      "name": "_defaultAdmin"
    },
    {
      "type": "bytes",
      "name": "_data"
    }
  ],
  []
],
    params: [options.defaultAdmin, options.data]
  });
};


/**
 * Represents the parameters for the "multicall" function.
 */
export type MulticallParams = {
  data: AbiParameterToPrimitiveType<{"type":"bytes[]","name":"data"}>
};

/**
 * Calls the "multicall" function on the contract.
 * @param options - The options for the "multicall" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { multicall } from "TODO";
 * 
 * const transaction = multicall({
 *  data: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function multicall(
  options: BaseTransactionOptions<MulticallParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xac9650d8",
  [
    {
      "type": "bytes[]",
      "name": "data"
    }
  ],
  [
    {
      "type": "bytes[]",
      "name": "results"
    }
  ]
],
    params: [options.data]
  });
};


/**
 * Represents the parameters for the "setEntrypointOverride" function.
 */
export type SetEntrypointOverrideParams = {
  entrypointOverride: AbiParameterToPrimitiveType<{"type":"address","name":"_entrypointOverride"}>
};

/**
 * Calls the "setEntrypointOverride" function on the contract.
 * @param options - The options for the "setEntrypointOverride" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { setEntrypointOverride } from "TODO";
 * 
 * const transaction = setEntrypointOverride({
 *  entrypointOverride: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function setEntrypointOverride(
  options: BaseTransactionOptions<SetEntrypointOverrideParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xb76464d5",
  [
    {
      "type": "address",
      "name": "_entrypointOverride"
    }
  ],
  []
],
    params: [options.entrypointOverride]
  });
};


/**
 * Represents the parameters for the "setPermissionsForSigner" function.
 */
export type SetPermissionsForSignerParams = {
  req: AbiParameterToPrimitiveType<{"type":"tuple","name":"_req","components":[{"type":"address","name":"signer"},{"type":"uint8","name":"isAdmin"},{"type":"address[]","name":"approvedTargets"},{"type":"uint256","name":"nativeTokenLimitPerTransaction"},{"type":"uint128","name":"permissionStartTimestamp"},{"type":"uint128","name":"permissionEndTimestamp"},{"type":"uint128","name":"reqValidityStartTimestamp"},{"type":"uint128","name":"reqValidityEndTimestamp"},{"type":"bytes32","name":"uid"}]}>
signature: AbiParameterToPrimitiveType<{"type":"bytes","name":"_signature"}>
};

/**
 * Calls the "setPermissionsForSigner" function on the contract.
 * @param options - The options for the "setPermissionsForSigner" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { setPermissionsForSigner } from "TODO";
 * 
 * const transaction = setPermissionsForSigner({
 *  req: ...,
 *  signature: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function setPermissionsForSigner(
  options: BaseTransactionOptions<SetPermissionsForSignerParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x5892e236",
  [
    {
      "type": "tuple",
      "name": "_req",
      "components": [
        {
          "type": "address",
          "name": "signer"
        },
        {
          "type": "uint8",
          "name": "isAdmin"
        },
        {
          "type": "address[]",
          "name": "approvedTargets"
        },
        {
          "type": "uint256",
          "name": "nativeTokenLimitPerTransaction"
        },
        {
          "type": "uint128",
          "name": "permissionStartTimestamp"
        },
        {
          "type": "uint128",
          "name": "permissionEndTimestamp"
        },
        {
          "type": "uint128",
          "name": "reqValidityStartTimestamp"
        },
        {
          "type": "uint128",
          "name": "reqValidityEndTimestamp"
        },
        {
          "type": "bytes32",
          "name": "uid"
        }
      ]
    },
    {
      "type": "bytes",
      "name": "_signature"
    }
  ],
  []
],
    params: [options.req, options.signature]
  });
};


/**
 * Represents the parameters for the "validateUserOp" function.
 */
export type ValidateUserOpParams = {
  userOp: AbiParameterToPrimitiveType<{"type":"tuple","name":"userOp","components":[{"type":"address","name":"sender"},{"type":"uint256","name":"nonce"},{"type":"bytes","name":"initCode"},{"type":"bytes","name":"callData"},{"type":"uint256","name":"callGasLimit"},{"type":"uint256","name":"verificationGasLimit"},{"type":"uint256","name":"preVerificationGas"},{"type":"uint256","name":"maxFeePerGas"},{"type":"uint256","name":"maxPriorityFeePerGas"},{"type":"bytes","name":"paymasterAndData"},{"type":"bytes","name":"signature"}]}>
userOpHash: AbiParameterToPrimitiveType<{"type":"bytes32","name":"userOpHash"}>
missingAccountFunds: AbiParameterToPrimitiveType<{"type":"uint256","name":"missingAccountFunds"}>
};

/**
 * Calls the "validateUserOp" function on the contract.
 * @param options - The options for the "validateUserOp" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { validateUserOp } from "TODO";
 * 
 * const transaction = validateUserOp({
 *  userOp: ...,
 *  userOpHash: ...,
 *  missingAccountFunds: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function validateUserOp(
  options: BaseTransactionOptions<ValidateUserOpParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x3a871cdd",
  [
    {
      "type": "tuple",
      "name": "userOp",
      "components": [
        {
          "type": "address",
          "name": "sender"
        },
        {
          "type": "uint256",
          "name": "nonce"
        },
        {
          "type": "bytes",
          "name": "initCode"
        },
        {
          "type": "bytes",
          "name": "callData"
        },
        {
          "type": "uint256",
          "name": "callGasLimit"
        },
        {
          "type": "uint256",
          "name": "verificationGasLimit"
        },
        {
          "type": "uint256",
          "name": "preVerificationGas"
        },
        {
          "type": "uint256",
          "name": "maxFeePerGas"
        },
        {
          "type": "uint256",
          "name": "maxPriorityFeePerGas"
        },
        {
          "type": "bytes",
          "name": "paymasterAndData"
        },
        {
          "type": "bytes",
          "name": "signature"
        }
      ]
    },
    {
      "type": "bytes32",
      "name": "userOpHash"
    },
    {
      "type": "uint256",
      "name": "missingAccountFunds"
    }
  ],
  [
    {
      "type": "uint256",
      "name": "validationData"
    }
  ]
],
    params: [options.userOp, options.userOpHash, options.missingAccountFunds]
  });
};




/**
 * Calls the "addDeposit" function on the contract.
 * @param options - The options for the "addDeposit" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { addDeposit } from "TODO";
 * 
 * const transaction = addDeposit();
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function addDeposit(
  options: BaseTransactionOptions
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x4a58db19",
  [],
  []
],
    params: []
  });
};


/**
 * Represents the parameters for the "execute" function.
 */
export type ExecuteParams = {
  target: AbiParameterToPrimitiveType<{"type":"address","name":"_target"}>
value: AbiParameterToPrimitiveType<{"type":"uint256","name":"_value"}>
calldata: AbiParameterToPrimitiveType<{"type":"bytes","name":"_calldata"}>
};

/**
 * Calls the "execute" function on the contract.
 * @param options - The options for the "execute" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { execute } from "TODO";
 * 
 * const transaction = execute({
 *  target: ...,
 *  value: ...,
 *  calldata: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function execute(
  options: BaseTransactionOptions<ExecuteParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xb61d27f6",
  [
    {
      "type": "address",
      "name": "_target"
    },
    {
      "type": "uint256",
      "name": "_value"
    },
    {
      "type": "bytes",
      "name": "_calldata"
    }
  ],
  []
],
    params: [options.target, options.value, options.calldata]
  });
};


/**
 * Represents the parameters for the "executeBatch" function.
 */
export type ExecuteBatchParams = {
  target: AbiParameterToPrimitiveType<{"type":"address[]","name":"_target"}>
value: AbiParameterToPrimitiveType<{"type":"uint256[]","name":"_value"}>
calldata: AbiParameterToPrimitiveType<{"type":"bytes[]","name":"_calldata"}>
};

/**
 * Calls the "executeBatch" function on the contract.
 * @param options - The options for the "executeBatch" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { executeBatch } from "TODO";
 * 
 * const transaction = executeBatch({
 *  target: ...,
 *  value: ...,
 *  calldata: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function executeBatch(
  options: BaseTransactionOptions<ExecuteBatchParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x47e1da2a",
  [
    {
      "type": "address[]",
      "name": "_target"
    },
    {
      "type": "uint256[]",
      "name": "_value"
    },
    {
      "type": "bytes[]",
      "name": "_calldata"
    }
  ],
  []
],
    params: [options.target, options.value, options.calldata]
  });
};


/**
 * Represents the parameters for the "onERC1155BatchReceived" function.
 */
export type OnERC1155BatchReceivedParams = {
  arg_0: AbiParameterToPrimitiveType<{"type":"address"}>
arg_1: AbiParameterToPrimitiveType<{"type":"address"}>
arg_2: AbiParameterToPrimitiveType<{"type":"uint256[]"}>
arg_3: AbiParameterToPrimitiveType<{"type":"uint256[]"}>
arg_4: AbiParameterToPrimitiveType<{"type":"bytes"}>
};

/**
 * Calls the "onERC1155BatchReceived" function on the contract.
 * @param options - The options for the "onERC1155BatchReceived" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onERC1155BatchReceived } from "TODO";
 * 
 * const transaction = onERC1155BatchReceived({
 *  arg_0: ...,
 *  arg_1: ...,
 *  arg_2: ...,
 *  arg_3: ...,
 *  arg_4: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function onERC1155BatchReceived(
  options: BaseTransactionOptions<OnERC1155BatchReceivedParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xbc197c81",
  [
    {
      "type": "address"
    },
    {
      "type": "address"
    },
    {
      "type": "uint256[]"
    },
    {
      "type": "uint256[]"
    },
    {
      "type": "bytes"
    }
  ],
  [
    {
      "type": "bytes4"
    }
  ]
],
    params: [options.arg_0, options.arg_1, options.arg_2, options.arg_3, options.arg_4]
  });
};


/**
 * Represents the parameters for the "onERC1155Received" function.
 */
export type OnERC1155ReceivedParams = {
  arg_0: AbiParameterToPrimitiveType<{"type":"address"}>
arg_1: AbiParameterToPrimitiveType<{"type":"address"}>
arg_2: AbiParameterToPrimitiveType<{"type":"uint256"}>
arg_3: AbiParameterToPrimitiveType<{"type":"uint256"}>
arg_4: AbiParameterToPrimitiveType<{"type":"bytes"}>
};

/**
 * Calls the "onERC1155Received" function on the contract.
 * @param options - The options for the "onERC1155Received" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onERC1155Received } from "TODO";
 * 
 * const transaction = onERC1155Received({
 *  arg_0: ...,
 *  arg_1: ...,
 *  arg_2: ...,
 *  arg_3: ...,
 *  arg_4: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function onERC1155Received(
  options: BaseTransactionOptions<OnERC1155ReceivedParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xf23a6e61",
  [
    {
      "type": "address"
    },
    {
      "type": "address"
    },
    {
      "type": "uint256"
    },
    {
      "type": "uint256"
    },
    {
      "type": "bytes"
    }
  ],
  [
    {
      "type": "bytes4"
    }
  ]
],
    params: [options.arg_0, options.arg_1, options.arg_2, options.arg_3, options.arg_4]
  });
};


/**
 * Represents the parameters for the "onERC721Received" function.
 */
export type OnERC721ReceivedParams = {
  arg_0: AbiParameterToPrimitiveType<{"type":"address"}>
arg_1: AbiParameterToPrimitiveType<{"type":"address"}>
arg_2: AbiParameterToPrimitiveType<{"type":"uint256"}>
arg_3: AbiParameterToPrimitiveType<{"type":"bytes"}>
};

/**
 * Calls the "onERC721Received" function on the contract.
 * @param options - The options for the "onERC721Received" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onERC721Received } from "TODO";
 * 
 * const transaction = onERC721Received({
 *  arg_0: ...,
 *  arg_1: ...,
 *  arg_2: ...,
 *  arg_3: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function onERC721Received(
  options: BaseTransactionOptions<OnERC721ReceivedParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x150b7a02",
  [
    {
      "type": "address"
    },
    {
      "type": "address"
    },
    {
      "type": "uint256"
    },
    {
      "type": "bytes"
    }
  ],
  [
    {
      "type": "bytes4"
    }
  ]
],
    params: [options.arg_0, options.arg_1, options.arg_2, options.arg_3]
  });
};


/**
 * Represents the parameters for the "setContractURI" function.
 */
export type SetContractURIParams = {
  uri: AbiParameterToPrimitiveType<{"type":"string","name":"_uri"}>
};

/**
 * Calls the "setContractURI" function on the contract.
 * @param options - The options for the "setContractURI" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { setContractURI } from "TODO";
 * 
 * const transaction = setContractURI({
 *  uri: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function setContractURI(
  options: BaseTransactionOptions<SetContractURIParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x938e3d7b",
  [
    {
      "type": "string",
      "name": "_uri"
    }
  ],
  []
],
    params: [options.uri]
  });
};


/**
 * Represents the parameters for the "withdrawDepositTo" function.
 */
export type WithdrawDepositToParams = {
  withdrawAddress: AbiParameterToPrimitiveType<{"type":"address","name":"withdrawAddress"}>
amount: AbiParameterToPrimitiveType<{"type":"uint256","name":"amount"}>
};

/**
 * Calls the "withdrawDepositTo" function on the contract.
 * @param options - The options for the "withdrawDepositTo" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { withdrawDepositTo } from "TODO";
 * 
 * const transaction = withdrawDepositTo({
 *  withdrawAddress: ...,
 *  amount: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function withdrawDepositTo(
  options: BaseTransactionOptions<WithdrawDepositToParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x4d44560d",
  [
    {
      "type": "address",
      "name": "withdrawAddress"
    },
    {
      "type": "uint256",
      "name": "amount"
    }
  ],
  []
],
    params: [options.withdrawAddress, options.amount]
  });
};


/**
 * Represents the parameters for the "createSeed" function.
 */
export type CreateSeedParams = {
  schemaUid: AbiParameterToPrimitiveType<{"type":"bytes32","name":"schemaUid"}>
revocable: AbiParameterToPrimitiveType<{"type":"bool","name":"revocable"}>
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
      "type": "bytes32",
      "name": "schemaUid"
    },
    {
      "type": "bool",
      "name": "revocable"
    }
  ],
  [
    {
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
  seedUid: AbiParameterToPrimitiveType<{"type":"bytes32","name":"seedUid"}>
versionSchemaUid: AbiParameterToPrimitiveType<{"type":"bytes32","name":"versionSchemaUid"}>
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
      "type": "bytes32",
      "name": "seedUid"
    },
    {
      "type": "bytes32",
      "name": "versionSchemaUid"
    }
  ],
  [
    {
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
  requests: AbiParameterToPrimitiveType<{"type":"tuple[]","name":"requests","components":[{"type":"string","name":"localId"},{"type":"bytes32","name":"seedUid"},{"type":"bytes32","name":"seedSchemaUid"},{"type":"bytes32","name":"versionUid"},{"type":"bytes32","name":"versionSchemaUid"},{"type":"bool","name":"seedIsRevocable"},{"type":"tuple[]","name":"listOfAttestations","components":[{"type":"bytes32","name":"schema"},{"type":"tuple[]","name":"data","components":[{"type":"address","name":"recipient"},{"type":"uint64","name":"expirationTime"},{"type":"bool","name":"revocable"},{"type":"bytes32","name":"refUID"},{"type":"bytes","name":"data"},{"type":"uint256","name":"value"}]}]},{"type":"tuple[]","name":"propertiesToUpdate","components":[{"type":"string","name":"publishLocalId"},{"type":"bytes32","name":"propertySchemaUid"}]}]}>
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
  "0x31e19cb8",
  [
    {
      "type": "tuple[]",
      "name": "requests",
      "components": [
        {
          "type": "string",
          "name": "localId"
        },
        {
          "type": "bytes32",
          "name": "seedUid"
        },
        {
          "type": "bytes32",
          "name": "seedSchemaUid"
        },
        {
          "type": "bytes32",
          "name": "versionUid"
        },
        {
          "type": "bytes32",
          "name": "versionSchemaUid"
        },
        {
          "type": "bool",
          "name": "seedIsRevocable"
        },
        {
          "type": "tuple[]",
          "name": "listOfAttestations",
          "components": [
            {
              "type": "bytes32",
              "name": "schema"
            },
            {
              "type": "tuple[]",
              "name": "data",
              "components": [
                {
                  "type": "address",
                  "name": "recipient"
                },
                {
                  "type": "uint64",
                  "name": "expirationTime"
                },
                {
                  "type": "bool",
                  "name": "revocable"
                },
                {
                  "type": "bytes32",
                  "name": "refUID"
                },
                {
                  "type": "bytes",
                  "name": "data"
                },
                {
                  "type": "uint256",
                  "name": "value"
                }
              ]
            }
          ]
        },
        {
          "type": "tuple[]",
          "name": "propertiesToUpdate",
          "components": [
            {
              "type": "string",
              "name": "publishLocalId"
            },
            {
              "type": "bytes32",
              "name": "propertySchemaUid"
            }
          ]
        }
      ]
    }
  ],
  [
    {
      "type": "bytes32[]"
    }
  ]
],
    params: [options.requests]
  });
};


/**
 * Represents the parameters for the "publish" function.
 */
export type PublishParams = {
  request: AbiParameterToPrimitiveType<{"type":"tuple","name":"request","components":[{"type":"string","name":"localId"},{"type":"bytes32","name":"seedUid"},{"type":"bytes32","name":"seedSchemaUid"},{"type":"bytes32","name":"versionUid"},{"type":"bytes32","name":"versionSchemaUid"},{"type":"bool","name":"seedIsRevocable"},{"type":"tuple[]","name":"listOfAttestations","components":[{"type":"bytes32","name":"schema"},{"type":"tuple[]","name":"data","components":[{"type":"address","name":"recipient"},{"type":"uint64","name":"expirationTime"},{"type":"bool","name":"revocable"},{"type":"bytes32","name":"refUID"},{"type":"bytes","name":"data"},{"type":"uint256","name":"value"}]}]},{"type":"tuple[]","name":"propertiesToUpdate","components":[{"type":"string","name":"publishLocalId"},{"type":"bytes32","name":"propertySchemaUid"}]}]}>
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
  "0xb71308c5",
  [
    {
      "type": "tuple",
      "name": "request",
      "components": [
        {
          "type": "string",
          "name": "localId"
        },
        {
          "type": "bytes32",
          "name": "seedUid"
        },
        {
          "type": "bytes32",
          "name": "seedSchemaUid"
        },
        {
          "type": "bytes32",
          "name": "versionUid"
        },
        {
          "type": "bytes32",
          "name": "versionSchemaUid"
        },
        {
          "type": "bool",
          "name": "seedIsRevocable"
        },
        {
          "type": "tuple[]",
          "name": "listOfAttestations",
          "components": [
            {
              "type": "bytes32",
              "name": "schema"
            },
            {
              "type": "tuple[]",
              "name": "data",
              "components": [
                {
                  "type": "address",
                  "name": "recipient"
                },
                {
                  "type": "uint64",
                  "name": "expirationTime"
                },
                {
                  "type": "bool",
                  "name": "revocable"
                },
                {
                  "type": "bytes32",
                  "name": "refUID"
                },
                {
                  "type": "bytes",
                  "name": "data"
                },
                {
                  "type": "uint256",
                  "name": "value"
                }
              ]
            }
          ]
        },
        {
          "type": "tuple[]",
          "name": "propertiesToUpdate",
          "components": [
            {
              "type": "string",
              "name": "publishLocalId"
            },
            {
              "type": "bytes32",
              "name": "propertySchemaUid"
            }
          ]
        }
      ]
    }
  ],
  [
    {
      "type": "bytes32"
    },
    {
      "type": "bytes32"
    }
  ]
],
    params: [options.request]
  });
};




/**
 * Calls the "renounceOwnership" function on the contract.
 * @param options - The options for the "renounceOwnership" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { renounceOwnership } from "TODO";
 * 
 * const transaction = renounceOwnership();
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function renounceOwnership(
  options: BaseTransactionOptions
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x715018a6",
  [],
  []
],
    params: []
  });
};


/**
 * Represents the parameters for the "setEas" function.
 */
export type SetEasParams = {
  eas: AbiParameterToPrimitiveType<{"type":"address","name":"_eas"}>
};

/**
 * Calls the "setEas" function on the contract.
 * @param options - The options for the "setEas" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { setEas } from "TODO";
 * 
 * const transaction = setEas({
 *  eas: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function setEas(
  options: BaseTransactionOptions<SetEasParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xb90b6e0d",
  [
    {
      "type": "address",
      "name": "_eas"
    }
  ],
  [
    {
      "type": "string"
    }
  ]
],
    params: [options.eas]
  });
};


/**
 * Represents the parameters for the "transferOwnership" function.
 */
export type TransferOwnershipParams = {
  newOwner: AbiParameterToPrimitiveType<{"type":"address","name":"newOwner"}>
};

/**
 * Calls the "transferOwnership" function on the contract.
 * @param options - The options for the "transferOwnership" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { transferOwnership } from "TODO";
 * 
 * const transaction = transferOwnership({
 *  newOwner: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function transferOwnership(
  options: BaseTransactionOptions<TransferOwnershipParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xf2fde38b",
  [
    {
      "type": "address",
      "name": "newOwner"
    }
  ],
  []
],
    params: [options.newOwner]
  });
};


