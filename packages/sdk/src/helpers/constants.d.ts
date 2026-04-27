import { AttestationRequestData } from '@ethereum-attestation-service/eas-sdk';
export declare const ZERO_ADDRESS: string;
export declare const ZERO_BYTES = "0x";
export declare const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export declare const SCHEMA_NJK = "schema.njk";
export declare const SEED_CONFIG_FILE = "seed.config.ts";
export declare const SEED_CONFIG_FALLBACKS: string[];
export declare const SCHEMA_TS = "seed.config.ts";
export declare const INTERNAL_DATA_TYPES: {
    Text: {
        eas: string;
    };
    Number: {
        eas: string;
    };
    Image: {
        eas: string;
    };
    Relation: {
        eas: string;
    };
    List: {
        eas: string;
    };
    File: {
        eas: string;
    };
    Json: {
        eas: string;
    };
    Blob: {
        eas: string;
    };
    Boolean: {
        eas: string;
    };
    Date: {
        eas: string;
    };
    Html: {
        eas: string;
    };
};
export declare const PROPERTY_NAMES_EXEMPT_FROM_ID_SUFFIX_STRIP: Set<string>;
export declare const INTERNAL_PROPERTY_NAMES: string[];
export declare const VERSION_SCHEMA_UID_OPTIMISM_SEPOLIA = "0x13c0fd59d69dbce40501a41f8b37768d26dd2e2bb0cad64615334d84f7b9bdf6";
export declare const defaultAttestationData: AttestationRequestData;
export declare enum ImageSize {
    EXTRA_SMALL = 480,
    SMALL = 760,
    MEDIUM = 1024,
    LARGE = 1440,
    EXTRA_LARGE = 1920
}
export declare const CLIENT_NOT_INITIALIZED = "ClientManager is not initialized. Please call init() first.";
export declare const INIT_SCRIPT_SUCCESS_MESSAGE = "[Seed Protocol] Finished running init script";
export declare enum SeedModels {
    Seed = "Seed",
    Metadata = "Metadata",
    Version = "Version"
}
export declare const SEED_PROTOCOL_SCHEMA_NAME = "Seed Protocol";
export declare const INTERNAL_SCHEMA_IDS: readonly ["SEEDPROTOCOL"];
/** Default Arweave gateway host used across all packages */
export declare const DEFAULT_ARWEAVE_HOST = "ar.seedprotocol.io";
/** Default Arweave gateway GraphQL endpoint */
export declare const DEFAULT_ARWEAVE_GRAPHQL_URL = "https://ar.seedprotocol.io/graphql";
/** Default Arweave gateways for fallback / metadata fetching (ordered by preference) */
export declare const DEFAULT_ARWEAVE_GATEWAYS: readonly ["ar.seedprotocol.io", "arweave.net", "g8way.io"];
export declare function getDefaultArweaveReadGatewayHostsOrdered(): string[];
export declare function mergePrimaryHostWithDefaults(primary: string, defaults: readonly string[]): string[];
export declare function isKnownArweaveGatewayHostname(hostname: string): boolean;
/**
 * Check if a schema is an internal SDK schema that should not be created in app files
 */
export declare function isInternalSchema(schemaName: string, schemaId?: string): boolean;
//# sourceMappingURL=constants.d.ts.map