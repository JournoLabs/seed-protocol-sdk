import { IItem, IItemProperty } from '@/interfaces';
import type { ArweaveTransaction, TransactionTag } from '@/types/arweave';
import { PublishUpload } from '@/types/publish';
export type GetPublishUploadsOptions = {
    arweaveUploadTags?: TransactionTag[];
};
export declare const prepareArweaveTransaction: (data: string | Uint8Array, contentHash: string | undefined, contentType?: string, additionalTags?: TransactionTag[]) => Promise<ArweaveTransaction>;
export type UploadProperty = {
    itemProperty: IItemProperty<any>;
    childProperties: IItemProperty<any>[];
};
export declare const getPublishUploads: (item: IItem<any>, uploads?: PublishUpload[], relatedItemProperty?: IItemProperty<any>, options?: GetPublishUploadsOptions) => Promise<PublishUpload[]>;
export declare function itemHasPublishUploadCandidates(item: IItem<any>, relatedItemProperty?: IItemProperty<any>): Promise<boolean>;
//# sourceMappingURL=getPublishUploads.d.ts.map