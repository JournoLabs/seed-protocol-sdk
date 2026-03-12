import { IQueryClient } from "@/interfaces/IQueryClient";
export declare abstract class BaseQueryClient {
    static PlatformClass: typeof BaseQueryClient;
    static setPlatformClass(platformClass: typeof BaseQueryClient): void;
    static getQueryClient(): IQueryClient;
}
//# sourceMappingURL=BaseQueryClient.d.ts.map