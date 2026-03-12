type CreateVersionProps = {
    seedLocalId?: string;
    seedUid?: string;
    seedType?: string;
    uid?: string;
};
type CreateVersion = (props: CreateVersionProps) => Promise<string>;
export declare const createVersion: CreateVersion;
export {};
//# sourceMappingURL=createVersion.d.ts.map