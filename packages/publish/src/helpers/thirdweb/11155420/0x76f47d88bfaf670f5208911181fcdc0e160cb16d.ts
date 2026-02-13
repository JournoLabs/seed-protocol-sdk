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
 * Represents the filters for the "AccountCreated" event.
 */
export type AccountCreatedEventFilters = Partial<{
  account: AbiParameterToPrimitiveType<{"type":"address","name":"account","indexed":true}>
accountAdmin: AbiParameterToPrimitiveType<{"type":"address","name":"accountAdmin","indexed":true}>
}>;

/**
 * Creates an event object for the AccountCreated event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { accountCreatedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  accountCreatedEvent({
 *  account: ...,
 *  accountAdmin: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function accountCreatedEvent(filters: AccountCreatedEventFilters = {}) {
  return prepareEvent({
    signature: "event AccountCreated(address indexed account, address indexed accountAdmin)",
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
 * Represents the filters for the "ExtensionAdded" event.
 */
export type ExtensionAddedEventFilters = Partial<{
  name: AbiParameterToPrimitiveType<{"type":"string","name":"name","indexed":true}>
implementation: AbiParameterToPrimitiveType<{"type":"address","name":"implementation","indexed":true}>
}>;

/**
 * Creates an event object for the ExtensionAdded event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { extensionAddedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  extensionAddedEvent({
 *  name: ...,
 *  implementation: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function extensionAddedEvent(filters: ExtensionAddedEventFilters = {}) {
  return prepareEvent({
    signature: "event ExtensionAdded(string indexed name, address indexed implementation, ((string name, string metadataURI, address implementation) metadata, (bytes4 functionSelector, string functionSignature)[] functions) extension)",
    filters,
  });
};
  

/**
 * Represents the filters for the "ExtensionRemoved" event.
 */
export type ExtensionRemovedEventFilters = Partial<{
  name: AbiParameterToPrimitiveType<{"type":"string","name":"name","indexed":true}>
}>;

/**
 * Creates an event object for the ExtensionRemoved event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { extensionRemovedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  extensionRemovedEvent({
 *  name: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function extensionRemovedEvent(filters: ExtensionRemovedEventFilters = {}) {
  return prepareEvent({
    signature: "event ExtensionRemoved(string indexed name, ((string name, string metadataURI, address implementation) metadata, (bytes4 functionSelector, string functionSignature)[] functions) extension)",
    filters,
  });
};
  

/**
 * Represents the filters for the "ExtensionReplaced" event.
 */
export type ExtensionReplacedEventFilters = Partial<{
  name: AbiParameterToPrimitiveType<{"type":"string","name":"name","indexed":true}>
implementation: AbiParameterToPrimitiveType<{"type":"address","name":"implementation","indexed":true}>
}>;

/**
 * Creates an event object for the ExtensionReplaced event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { extensionReplacedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  extensionReplacedEvent({
 *  name: ...,
 *  implementation: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function extensionReplacedEvent(filters: ExtensionReplacedEventFilters = {}) {
  return prepareEvent({
    signature: "event ExtensionReplaced(string indexed name, address indexed implementation, ((string name, string metadataURI, address implementation) metadata, (bytes4 functionSelector, string functionSignature)[] functions) extension)",
    filters,
  });
};
  

/**
 * Represents the filters for the "FunctionDisabled" event.
 */
export type FunctionDisabledEventFilters = Partial<{
  name: AbiParameterToPrimitiveType<{"type":"string","name":"name","indexed":true}>
functionSelector: AbiParameterToPrimitiveType<{"type":"bytes4","name":"functionSelector","indexed":true}>
}>;

/**
 * Creates an event object for the FunctionDisabled event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { functionDisabledEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  functionDisabledEvent({
 *  name: ...,
 *  functionSelector: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function functionDisabledEvent(filters: FunctionDisabledEventFilters = {}) {
  return prepareEvent({
    signature: "event FunctionDisabled(string indexed name, bytes4 indexed functionSelector, (string name, string metadataURI, address implementation) extMetadata)",
    filters,
  });
};
  

/**
 * Represents the filters for the "FunctionEnabled" event.
 */
export type FunctionEnabledEventFilters = Partial<{
  name: AbiParameterToPrimitiveType<{"type":"string","name":"name","indexed":true}>
functionSelector: AbiParameterToPrimitiveType<{"type":"bytes4","name":"functionSelector","indexed":true}>
}>;

/**
 * Creates an event object for the FunctionEnabled event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { functionEnabledEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  functionEnabledEvent({
 *  name: ...,
 *  functionSelector: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function functionEnabledEvent(filters: FunctionEnabledEventFilters = {}) {
  return prepareEvent({
    signature: "event FunctionEnabled(string indexed name, bytes4 indexed functionSelector, (bytes4 functionSelector, string functionSignature) extFunction, (string name, string metadataURI, address implementation) extMetadata)",
    filters,
  });
};
  

/**
 * Represents the filters for the "RoleAdminChanged" event.
 */
export type RoleAdminChangedEventFilters = Partial<{
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role","indexed":true}>
previousAdminRole: AbiParameterToPrimitiveType<{"type":"bytes32","name":"previousAdminRole","indexed":true}>
newAdminRole: AbiParameterToPrimitiveType<{"type":"bytes32","name":"newAdminRole","indexed":true}>
}>;

/**
 * Creates an event object for the RoleAdminChanged event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { roleAdminChangedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  roleAdminChangedEvent({
 *  role: ...,
 *  previousAdminRole: ...,
 *  newAdminRole: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function roleAdminChangedEvent(filters: RoleAdminChangedEventFilters = {}) {
  return prepareEvent({
    signature: "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
    filters,
  });
};
  

/**
 * Represents the filters for the "RoleGranted" event.
 */
export type RoleGrantedEventFilters = Partial<{
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role","indexed":true}>
account: AbiParameterToPrimitiveType<{"type":"address","name":"account","indexed":true}>
sender: AbiParameterToPrimitiveType<{"type":"address","name":"sender","indexed":true}>
}>;

/**
 * Creates an event object for the RoleGranted event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { roleGrantedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  roleGrantedEvent({
 *  role: ...,
 *  account: ...,
 *  sender: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function roleGrantedEvent(filters: RoleGrantedEventFilters = {}) {
  return prepareEvent({
    signature: "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
    filters,
  });
};
  

/**
 * Represents the filters for the "RoleRevoked" event.
 */
export type RoleRevokedEventFilters = Partial<{
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role","indexed":true}>
account: AbiParameterToPrimitiveType<{"type":"address","name":"account","indexed":true}>
sender: AbiParameterToPrimitiveType<{"type":"address","name":"sender","indexed":true}>
}>;

/**
 * Creates an event object for the RoleRevoked event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { roleRevokedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  roleRevokedEvent({
 *  role: ...,
 *  account: ...,
 *  sender: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function roleRevokedEvent(filters: RoleRevokedEventFilters = {}) {
  return prepareEvent({
    signature: "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
    filters,
  });
};
  

/**
 * Represents the filters for the "SignerAdded" event.
 */
export type SignerAddedEventFilters = Partial<{
  account: AbiParameterToPrimitiveType<{"type":"address","name":"account","indexed":true}>
signer: AbiParameterToPrimitiveType<{"type":"address","name":"signer","indexed":true}>
}>;

/**
 * Creates an event object for the SignerAdded event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { signerAddedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  signerAddedEvent({
 *  account: ...,
 *  signer: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function signerAddedEvent(filters: SignerAddedEventFilters = {}) {
  return prepareEvent({
    signature: "event SignerAdded(address indexed account, address indexed signer)",
    filters,
  });
};
  

/**
 * Represents the filters for the "SignerRemoved" event.
 */
export type SignerRemovedEventFilters = Partial<{
  account: AbiParameterToPrimitiveType<{"type":"address","name":"account","indexed":true}>
signer: AbiParameterToPrimitiveType<{"type":"address","name":"signer","indexed":true}>
}>;

/**
 * Creates an event object for the SignerRemoved event.
 * @param filters - Optional filters to apply to the event.
 * @returns The prepared event object.
 * @example
 * ```
 * import { getContractEvents } from "thirdweb";
 * import { signerRemovedEvent } from "TODO";
 * 
 * const events = await getContractEvents({
 * contract,
 * events: [
 *  signerRemovedEvent({
 *  account: ...,
 *  signer: ...,
 * })
 * ],
 * });
 * ```
 */ 
export function signerRemovedEvent(filters: SignerRemovedEventFilters = {}) {
  return prepareEvent({
    signature: "event SignerRemoved(address indexed account, address indexed signer)",
    filters,
  });
};
  

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
 * Calls the "DEFAULT_ADMIN_ROLE" function on the contract.
 * @param options - The options for the DEFAULT_ADMIN_ROLE function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { DEFAULT_ADMIN_ROLE } from "TODO";
 * 
 * const result = await DEFAULT_ADMIN_ROLE();
 * 
 * ```
 */
export async function DEFAULT_ADMIN_ROLE(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xa217fddf",
  [],
  [
    {
      "type": "bytes32"
    }
  ]
],
    params: []
  });
};




/**
 * Calls the "accountImplementation" function on the contract.
 * @param options - The options for the accountImplementation function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { accountImplementation } from "TODO";
 * 
 * const result = await accountImplementation();
 * 
 * ```
 */
export async function accountImplementation(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x11464fbe",
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
 * Calls the "defaultExtensions" function on the contract.
 * @param options - The options for the defaultExtensions function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { defaultExtensions } from "TODO";
 * 
 * const result = await defaultExtensions();
 * 
 * ```
 */
export async function defaultExtensions(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x463c4864",
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
 * Calls the "entrypoint" function on the contract.
 * @param options - The options for the entrypoint function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { entrypoint } from "TODO";
 * 
 * const result = await entrypoint();
 * 
 * ```
 */
export async function entrypoint(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xa65d69d4",
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
 * Represents the parameters for the "getAccounts" function.
 */
export type GetAccountsParams = {
  start: AbiParameterToPrimitiveType<{"type":"uint256","name":"_start"}>
end: AbiParameterToPrimitiveType<{"type":"uint256","name":"_end"}>
};

/**
 * Calls the "getAccounts" function on the contract.
 * @param options - The options for the getAccounts function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAccounts } from "TODO";
 * 
 * const result = await getAccounts({
 *  start: ...,
 *  end: ...,
 * });
 * 
 * ```
 */
export async function getAccounts(
  options: BaseTransactionOptions<GetAccountsParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xe68a7c3b",
  [
    {
      "type": "uint256",
      "name": "_start"
    },
    {
      "type": "uint256",
      "name": "_end"
    }
  ],
  [
    {
      "type": "address[]",
      "name": "accounts"
    }
  ]
],
    params: [options.start, options.end]
  });
};


/**
 * Represents the parameters for the "getAccountsOfSigner" function.
 */
export type GetAccountsOfSignerParams = {
  signer: AbiParameterToPrimitiveType<{"type":"address","name":"signer"}>
};

/**
 * Calls the "getAccountsOfSigner" function on the contract.
 * @param options - The options for the getAccountsOfSigner function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAccountsOfSigner } from "TODO";
 * 
 * const result = await getAccountsOfSigner({
 *  signer: ...,
 * });
 * 
 * ```
 */
export async function getAccountsOfSigner(
  options: BaseTransactionOptions<GetAccountsOfSignerParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x0e6254fd",
  [
    {
      "type": "address",
      "name": "signer"
    }
  ],
  [
    {
      "type": "address[]",
      "name": "accounts"
    }
  ]
],
    params: [options.signer]
  });
};


/**
 * Represents the parameters for the "getAddress" function.
 */
export type GetAddressParams = {
  adminSigner: AbiParameterToPrimitiveType<{"type":"address","name":"_adminSigner"}>
data: AbiParameterToPrimitiveType<{"type":"bytes","name":"_data"}>
};

/**
 * Calls the "getAddress" function on the contract.
 * @param options - The options for the getAddress function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAddress } from "TODO";
 * 
 * const result = await getAddress({
 *  adminSigner: ...,
 *  data: ...,
 * });
 * 
 * ```
 */
export async function getAddress(
  options: BaseTransactionOptions<GetAddressParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x8878ed33",
  [
    {
      "type": "address",
      "name": "_adminSigner"
    },
    {
      "type": "bytes",
      "name": "_data"
    }
  ],
  [
    {
      "type": "address"
    }
  ]
],
    params: [options.adminSigner, options.data]
  });
};




/**
 * Calls the "getAllAccounts" function on the contract.
 * @param options - The options for the getAllAccounts function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getAllAccounts } from "TODO";
 * 
 * const result = await getAllAccounts();
 * 
 * ```
 */
export async function getAllAccounts(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x08e93d0a",
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
      "name": "allExtensions",
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
 * Represents the parameters for the "getExtension" function.
 */
export type GetExtensionParams = {
  extensionName: AbiParameterToPrimitiveType<{"type":"string","name":"extensionName"}>
};

/**
 * Calls the "getExtension" function on the contract.
 * @param options - The options for the getExtension function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getExtension } from "TODO";
 * 
 * const result = await getExtension({
 *  extensionName: ...,
 * });
 * 
 * ```
 */
export async function getExtension(
  options: BaseTransactionOptions<GetExtensionParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xc22707ee",
  [
    {
      "type": "string",
      "name": "extensionName"
    }
  ],
  [
    {
      "type": "tuple",
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
    params: [options.extensionName]
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
 * Represents the parameters for the "getMetadataForFunction" function.
 */
export type GetMetadataForFunctionParams = {
  functionSelector: AbiParameterToPrimitiveType<{"type":"bytes4","name":"functionSelector"}>
};

/**
 * Calls the "getMetadataForFunction" function on the contract.
 * @param options - The options for the getMetadataForFunction function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getMetadataForFunction } from "TODO";
 * 
 * const result = await getMetadataForFunction({
 *  functionSelector: ...,
 * });
 * 
 * ```
 */
export async function getMetadataForFunction(
  options: BaseTransactionOptions<GetMetadataForFunctionParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xa0dbaefd",
  [
    {
      "type": "bytes4",
      "name": "functionSelector"
    }
  ],
  [
    {
      "type": "tuple",
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
    }
  ]
],
    params: [options.functionSelector]
  });
};


/**
 * Represents the parameters for the "getRoleAdmin" function.
 */
export type GetRoleAdminParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
};

/**
 * Calls the "getRoleAdmin" function on the contract.
 * @param options - The options for the getRoleAdmin function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getRoleAdmin } from "TODO";
 * 
 * const result = await getRoleAdmin({
 *  role: ...,
 * });
 * 
 * ```
 */
export async function getRoleAdmin(
  options: BaseTransactionOptions<GetRoleAdminParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x248a9ca3",
  [
    {
      "type": "bytes32",
      "name": "role"
    }
  ],
  [
    {
      "type": "bytes32"
    }
  ]
],
    params: [options.role]
  });
};


/**
 * Represents the parameters for the "getRoleMember" function.
 */
export type GetRoleMemberParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
index: AbiParameterToPrimitiveType<{"type":"uint256","name":"index"}>
};

/**
 * Calls the "getRoleMember" function on the contract.
 * @param options - The options for the getRoleMember function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getRoleMember } from "TODO";
 * 
 * const result = await getRoleMember({
 *  role: ...,
 *  index: ...,
 * });
 * 
 * ```
 */
export async function getRoleMember(
  options: BaseTransactionOptions<GetRoleMemberParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x9010d07c",
  [
    {
      "type": "bytes32",
      "name": "role"
    },
    {
      "type": "uint256",
      "name": "index"
    }
  ],
  [
    {
      "type": "address",
      "name": "member"
    }
  ]
],
    params: [options.role, options.index]
  });
};


/**
 * Represents the parameters for the "getRoleMemberCount" function.
 */
export type GetRoleMemberCountParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
};

/**
 * Calls the "getRoleMemberCount" function on the contract.
 * @param options - The options for the getRoleMemberCount function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { getRoleMemberCount } from "TODO";
 * 
 * const result = await getRoleMemberCount({
 *  role: ...,
 * });
 * 
 * ```
 */
export async function getRoleMemberCount(
  options: BaseTransactionOptions<GetRoleMemberCountParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xca15c873",
  [
    {
      "type": "bytes32",
      "name": "role"
    }
  ],
  [
    {
      "type": "uint256",
      "name": "count"
    }
  ]
],
    params: [options.role]
  });
};


/**
 * Represents the parameters for the "hasRole" function.
 */
export type HasRoleParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
account: AbiParameterToPrimitiveType<{"type":"address","name":"account"}>
};

/**
 * Calls the "hasRole" function on the contract.
 * @param options - The options for the hasRole function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { hasRole } from "TODO";
 * 
 * const result = await hasRole({
 *  role: ...,
 *  account: ...,
 * });
 * 
 * ```
 */
export async function hasRole(
  options: BaseTransactionOptions<HasRoleParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x91d14854",
  [
    {
      "type": "bytes32",
      "name": "role"
    },
    {
      "type": "address",
      "name": "account"
    }
  ],
  [
    {
      "type": "bool"
    }
  ]
],
    params: [options.role, options.account]
  });
};


/**
 * Represents the parameters for the "hasRoleWithSwitch" function.
 */
export type HasRoleWithSwitchParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
account: AbiParameterToPrimitiveType<{"type":"address","name":"account"}>
};

/**
 * Calls the "hasRoleWithSwitch" function on the contract.
 * @param options - The options for the hasRoleWithSwitch function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { hasRoleWithSwitch } from "TODO";
 * 
 * const result = await hasRoleWithSwitch({
 *  role: ...,
 *  account: ...,
 * });
 * 
 * ```
 */
export async function hasRoleWithSwitch(
  options: BaseTransactionOptions<HasRoleWithSwitchParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xa32fa5b3",
  [
    {
      "type": "bytes32",
      "name": "role"
    },
    {
      "type": "address",
      "name": "account"
    }
  ],
  [
    {
      "type": "bool"
    }
  ]
],
    params: [options.role, options.account]
  });
};


/**
 * Represents the parameters for the "isRegistered" function.
 */
export type IsRegisteredParams = {
  account: AbiParameterToPrimitiveType<{"type":"address","name":"_account"}>
};

/**
 * Calls the "isRegistered" function on the contract.
 * @param options - The options for the isRegistered function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { isRegistered } from "TODO";
 * 
 * const result = await isRegistered({
 *  account: ...,
 * });
 * 
 * ```
 */
export async function isRegistered(
  options: BaseTransactionOptions<IsRegisteredParams>
) {
  return readContract({
    contract: options.contract,
    method: [
  "0xc3c5a547",
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
 * Calls the "totalAccounts" function on the contract.
 * @param options - The options for the totalAccounts function.
 * @returns The parsed result of the function call.
 * @example
 * ```
 * import { totalAccounts } from "TODO";
 * 
 * const result = await totalAccounts();
 * 
 * ```
 */
export async function totalAccounts(
  options: BaseTransactionOptions
) {
  return readContract({
    contract: options.contract,
    method: [
  "0x58451f97",
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
 * Represents the parameters for the "_disableFunctionInExtension" function.
 */
export type _disableFunctionInExtensionParams = {
  extensionName: AbiParameterToPrimitiveType<{"type":"string","name":"_extensionName"}>
functionSelector: AbiParameterToPrimitiveType<{"type":"bytes4","name":"_functionSelector"}>
};

/**
 * Calls the "_disableFunctionInExtension" function on the contract.
 * @param options - The options for the "_disableFunctionInExtension" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { _disableFunctionInExtension } from "TODO";
 * 
 * const transaction = _disableFunctionInExtension({
 *  extensionName: ...,
 *  functionSelector: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function _disableFunctionInExtension(
  options: BaseTransactionOptions<_disableFunctionInExtensionParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x429eed80",
  [
    {
      "type": "string",
      "name": "_extensionName"
    },
    {
      "type": "bytes4",
      "name": "_functionSelector"
    }
  ],
  []
],
    params: [options.extensionName, options.functionSelector]
  });
};


/**
 * Represents the parameters for the "addExtension" function.
 */
export type AddExtensionParams = {
  extension: AbiParameterToPrimitiveType<{"type":"tuple","name":"_extension","components":[{"type":"tuple","name":"metadata","components":[{"type":"string","name":"name"},{"type":"string","name":"metadataURI"},{"type":"address","name":"implementation"}]},{"type":"tuple[]","name":"functions","components":[{"type":"bytes4","name":"functionSelector"},{"type":"string","name":"functionSignature"}]}]}>
};

/**
 * Calls the "addExtension" function on the contract.
 * @param options - The options for the "addExtension" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { addExtension } from "TODO";
 * 
 * const transaction = addExtension({
 *  extension: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function addExtension(
  options: BaseTransactionOptions<AddExtensionParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xe05688fe",
  [
    {
      "type": "tuple",
      "name": "_extension",
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
  ],
  []
],
    params: [options.extension]
  });
};


/**
 * Represents the parameters for the "createAccount" function.
 */
export type CreateAccountParams = {
  admin: AbiParameterToPrimitiveType<{"type":"address","name":"_admin"}>
data: AbiParameterToPrimitiveType<{"type":"bytes","name":"_data"}>
};

/**
 * Calls the "createAccount" function on the contract.
 * @param options - The options for the "createAccount" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { createAccount } from "TODO";
 * 
 * const transaction = createAccount({
 *  admin: ...,
 *  data: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function createAccount(
  options: BaseTransactionOptions<CreateAccountParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xd8fd8f44",
  [
    {
      "type": "address",
      "name": "_admin"
    },
    {
      "type": "bytes",
      "name": "_data"
    }
  ],
  [
    {
      "type": "address"
    }
  ]
],
    params: [options.admin, options.data]
  });
};


/**
 * Represents the parameters for the "disableFunctionInExtension" function.
 */
export type DisableFunctionInExtensionParams = {
  extensionName: AbiParameterToPrimitiveType<{"type":"string","name":"_extensionName"}>
functionSelector: AbiParameterToPrimitiveType<{"type":"bytes4","name":"_functionSelector"}>
};

/**
 * Calls the "disableFunctionInExtension" function on the contract.
 * @param options - The options for the "disableFunctionInExtension" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { disableFunctionInExtension } from "TODO";
 * 
 * const transaction = disableFunctionInExtension({
 *  extensionName: ...,
 *  functionSelector: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function disableFunctionInExtension(
  options: BaseTransactionOptions<DisableFunctionInExtensionParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x512cf914",
  [
    {
      "type": "string",
      "name": "_extensionName"
    },
    {
      "type": "bytes4",
      "name": "_functionSelector"
    }
  ],
  []
],
    params: [options.extensionName, options.functionSelector]
  });
};


/**
 * Represents the parameters for the "enableFunctionInExtension" function.
 */
export type EnableFunctionInExtensionParams = {
  extensionName: AbiParameterToPrimitiveType<{"type":"string","name":"_extensionName"}>
function: AbiParameterToPrimitiveType<{"type":"tuple","name":"_function","components":[{"type":"bytes4","name":"functionSelector"},{"type":"string","name":"functionSignature"}]}>
};

/**
 * Calls the "enableFunctionInExtension" function on the contract.
 * @param options - The options for the "enableFunctionInExtension" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { enableFunctionInExtension } from "TODO";
 * 
 * const transaction = enableFunctionInExtension({
 *  extensionName: ...,
 *  function: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function enableFunctionInExtension(
  options: BaseTransactionOptions<EnableFunctionInExtensionParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x8856a113",
  [
    {
      "type": "string",
      "name": "_extensionName"
    },
    {
      "type": "tuple",
      "name": "_function",
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
  ],
  []
],
    params: [options.extensionName, options.function]
  });
};


/**
 * Represents the parameters for the "grantRole" function.
 */
export type GrantRoleParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
account: AbiParameterToPrimitiveType<{"type":"address","name":"account"}>
};

/**
 * Calls the "grantRole" function on the contract.
 * @param options - The options for the "grantRole" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { grantRole } from "TODO";
 * 
 * const transaction = grantRole({
 *  role: ...,
 *  account: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function grantRole(
  options: BaseTransactionOptions<GrantRoleParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x2f2ff15d",
  [
    {
      "type": "bytes32",
      "name": "role"
    },
    {
      "type": "address",
      "name": "account"
    }
  ],
  []
],
    params: [options.role, options.account]
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
 * Represents the parameters for the "onRegister" function.
 */
export type OnRegisterParams = {
  salt: AbiParameterToPrimitiveType<{"type":"bytes32","name":"_salt"}>
};

/**
 * Calls the "onRegister" function on the contract.
 * @param options - The options for the "onRegister" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onRegister } from "TODO";
 * 
 * const transaction = onRegister({
 *  salt: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function onRegister(
  options: BaseTransactionOptions<OnRegisterParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x83a03f8c",
  [
    {
      "type": "bytes32",
      "name": "_salt"
    }
  ],
  []
],
    params: [options.salt]
  });
};


/**
 * Represents the parameters for the "onSignerAdded" function.
 */
export type OnSignerAddedParams = {
  signer: AbiParameterToPrimitiveType<{"type":"address","name":"_signer"}>
salt: AbiParameterToPrimitiveType<{"type":"bytes32","name":"_salt"}>
};

/**
 * Calls the "onSignerAdded" function on the contract.
 * @param options - The options for the "onSignerAdded" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onSignerAdded } from "TODO";
 * 
 * const transaction = onSignerAdded({
 *  signer: ...,
 *  salt: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function onSignerAdded(
  options: BaseTransactionOptions<OnSignerAddedParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x0b61e12b",
  [
    {
      "type": "address",
      "name": "_signer"
    },
    {
      "type": "bytes32",
      "name": "_salt"
    }
  ],
  []
],
    params: [options.signer, options.salt]
  });
};


/**
 * Represents the parameters for the "onSignerRemoved" function.
 */
export type OnSignerRemovedParams = {
  signer: AbiParameterToPrimitiveType<{"type":"address","name":"_signer"}>
salt: AbiParameterToPrimitiveType<{"type":"bytes32","name":"_salt"}>
};

/**
 * Calls the "onSignerRemoved" function on the contract.
 * @param options - The options for the "onSignerRemoved" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { onSignerRemoved } from "TODO";
 * 
 * const transaction = onSignerRemoved({
 *  signer: ...,
 *  salt: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function onSignerRemoved(
  options: BaseTransactionOptions<OnSignerRemovedParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x9387a380",
  [
    {
      "type": "address",
      "name": "_signer"
    },
    {
      "type": "bytes32",
      "name": "_salt"
    }
  ],
  []
],
    params: [options.signer, options.salt]
  });
};


/**
 * Represents the parameters for the "removeExtension" function.
 */
export type RemoveExtensionParams = {
  extensionName: AbiParameterToPrimitiveType<{"type":"string","name":"_extensionName"}>
};

/**
 * Calls the "removeExtension" function on the contract.
 * @param options - The options for the "removeExtension" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { removeExtension } from "TODO";
 * 
 * const transaction = removeExtension({
 *  extensionName: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function removeExtension(
  options: BaseTransactionOptions<RemoveExtensionParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xee7d2adf",
  [
    {
      "type": "string",
      "name": "_extensionName"
    }
  ],
  []
],
    params: [options.extensionName]
  });
};


/**
 * Represents the parameters for the "renounceRole" function.
 */
export type RenounceRoleParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
account: AbiParameterToPrimitiveType<{"type":"address","name":"account"}>
};

/**
 * Calls the "renounceRole" function on the contract.
 * @param options - The options for the "renounceRole" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { renounceRole } from "TODO";
 * 
 * const transaction = renounceRole({
 *  role: ...,
 *  account: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function renounceRole(
  options: BaseTransactionOptions<RenounceRoleParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0x36568abe",
  [
    {
      "type": "bytes32",
      "name": "role"
    },
    {
      "type": "address",
      "name": "account"
    }
  ],
  []
],
    params: [options.role, options.account]
  });
};


/**
 * Represents the parameters for the "replaceExtension" function.
 */
export type ReplaceExtensionParams = {
  extension: AbiParameterToPrimitiveType<{"type":"tuple","name":"_extension","components":[{"type":"tuple","name":"metadata","components":[{"type":"string","name":"name"},{"type":"string","name":"metadataURI"},{"type":"address","name":"implementation"}]},{"type":"tuple[]","name":"functions","components":[{"type":"bytes4","name":"functionSelector"},{"type":"string","name":"functionSignature"}]}]}>
};

/**
 * Calls the "replaceExtension" function on the contract.
 * @param options - The options for the "replaceExtension" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { replaceExtension } from "TODO";
 * 
 * const transaction = replaceExtension({
 *  extension: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function replaceExtension(
  options: BaseTransactionOptions<ReplaceExtensionParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xc0562f6d",
  [
    {
      "type": "tuple",
      "name": "_extension",
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
  ],
  []
],
    params: [options.extension]
  });
};


/**
 * Represents the parameters for the "revokeRole" function.
 */
export type RevokeRoleParams = {
  role: AbiParameterToPrimitiveType<{"type":"bytes32","name":"role"}>
account: AbiParameterToPrimitiveType<{"type":"address","name":"account"}>
};

/**
 * Calls the "revokeRole" function on the contract.
 * @param options - The options for the "revokeRole" function.
 * @returns A prepared transaction object.
 * @example
 * ```
 * import { revokeRole } from "TODO";
 * 
 * const transaction = revokeRole({
 *  role: ...,
 *  account: ...,
 * });
 * 
 * // Send the transaction
 * ...
 * 
 * ```
 */
export function revokeRole(
  options: BaseTransactionOptions<RevokeRoleParams>
) {
  return prepareContractCall({
    contract: options.contract,
    method: [
  "0xd547741f",
  [
    {
      "type": "bytes32",
      "name": "role"
    },
    {
      "type": "address",
      "name": "account"
    }
  ],
  []
],
    params: [options.role, options.account]
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
 * Represents the parameters for the "initialize" function.
 */
export type InitializeParams = {
  eas: AbiParameterToPrimitiveType<{"type":"address","name":"_eas"}>
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
 *  eas: ...,
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
  "0xc4d66de8",
  [
    {
      "type": "address",
      "name": "_eas"
    }
  ],
  []
],
    params: [options.eas]
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


