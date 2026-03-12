import { IItem, IItemProperty } from '@/interfaces';
import type { ArweaveTransaction } from '@/types/arweave';
import { PublishUpload } from '@/types/publish';
export declare const prepareArweaveTransaction: (data: string | Uint8Array, contentHash: string | undefined, contentType?: string) => Promise<ArweaveTransaction>;
export type UploadProperty = {
    itemProperty: IItemProperty<any>;
    childProperties: IItemProperty<any>[];
};
export declare const getPublishUploads: (item: IItem<any>, uploads?: PublishUpload[], relatedItemProperty?: IItemProperty<any>) => Promise<PublishUpload[]>;
//# sourceMappingURL=getPublishUploads.d.ts.map