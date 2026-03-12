import { MetadataType } from '@/seedSchema';
import { PropertyType } from '@/types';
type CreateMetadata = (metadataValues: Partial<MetadataType> & {
    modelName?: string;
}, propertyRecordSchema?: PropertyType | undefined) => Promise<MetadataType>;
export declare const createMetadata: CreateMetadata;
export {};
//# sourceMappingURL=createMetadata.d.ts.map