import { ModelValues } from '@/types';
type CreateNewItemProps = Partial<ModelValues<any>> & {
    modelName: string;
};
type CreateNewItemReturnType = {
    modelName: string;
    seedLocalId: string;
    versionLocalId: string;
};
export declare const createNewItem: ({ modelName, ...propertyData }: CreateNewItemProps) => Promise<CreateNewItemReturnType>;
export {};
//# sourceMappingURL=createNewItem.d.ts.map