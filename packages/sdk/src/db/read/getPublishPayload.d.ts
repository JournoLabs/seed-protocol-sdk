import { AttestationRequest, AttestationRequestData } from '@ethereum-attestation-service/eas-sdk';
import { Item } from '@/Item/Item';
type PublishPayload = {
    localId: string;
    seedIsRevocable: boolean;
    seedSchemaUid: string;
    seedUid: string;
    versionSchemaUid: string;
    versionUid: string;
    listOfAttestations: (Omit<AttestationRequest, 'data'> & {
        data: AttestationRequestData[];
        _propertyName?: string;
        _schemaDef?: string;
        _unresolvedValue?: string;
    })[];
    propertiesToUpdate: any[];
};
type MultiPublishPayload = PublishPayload[];
/** Map of seed localId -> attestation uid for resolving relation/image property values after dependent seeds are published */
export type ResolvedSeedUids = Record<string, string>;
type UploadedTransaction = {
    txId: string;
    itemPropertyLocalId?: string;
    seedLocalId?: string;
    versionLocalId?: string;
    itemPropertyName?: string;
};
export declare const getPublishPayload: (item: Item<any>, uploadedTransactions: UploadedTransaction[]) => Promise<MultiPublishPayload>;
/**
 * Resolves relation/image property values (seedLocalId) to attestation uids after dependent seeds are published.
 * Call after each payload is published, passing the returned attestation uid for that seed's localId.
 * Returns an updated multiPayload with re-encoded attestations where resolution was applied.
 */
export declare const resolvePublishPayloadValues: (multiPayload: MultiPublishPayload, resolvedUids: ResolvedSeedUids) => Promise<MultiPublishPayload>;
export {};
//# sourceMappingURL=getPublishPayload.d.ts.map