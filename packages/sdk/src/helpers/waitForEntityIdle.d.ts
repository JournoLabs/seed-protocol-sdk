/** Any entity that exposes an xstate actor via getService(). Loosely typed so Schema/Model/Item/ModelProperty (different machine contexts) are all accepted. */
interface EntityWithService {
    getService(): any;
}
/**
 * Wait for an entity's state machine to reach 'idle' state
 * @param entity - Entity instance with getService() method
 * @param options - Configuration options
 * @returns Promise that resolves when entity reaches idle, or rejects on error/timeout
 */
export declare function waitForEntityIdle(entity: EntityWithService, options?: {
    timeout?: number;
    throwOnError?: boolean;
}): Promise<void>;
export {};
//# sourceMappingURL=waitForEntityIdle.d.ts.map