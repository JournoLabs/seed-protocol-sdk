import { SeedType } from '@/seedSchema';
type GetSeedDataProps = {
    seedLocalId?: string;
    seedUid?: string;
};
type GetSeedData = (props: GetSeedDataProps) => Promise<SeedType | undefined>;
export declare const getSeedData: GetSeedData;
export {};
//# sourceMappingURL=getSeedData.d.ts.map