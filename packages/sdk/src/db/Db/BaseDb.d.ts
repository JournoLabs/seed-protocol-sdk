import { IDb } from '@/interfaces/IDb';
import { Observable } from 'rxjs';
export declare abstract class BaseDb implements IDb {
    static filesDir: string | undefined;
    constructor();
    static PlatformClass: typeof BaseDb;
    static setPlatformClass(platformClass: typeof BaseDb): void;
    static getAppDb(): any;
    static prepareDb(filesDir: string): Promise<any>;
    static isAppDbReady(): boolean;
    static connectToDb(pathToDir: string): Promise<unknown>;
    static migrate(pathToDbDir: string, dbName: string, dbId: string): Promise<void>;
    /**
     * Execute a reactive query that emits new results whenever the underlying data changes.
     *
     * Supports two usage patterns:
     * 1. SQL tag function: liveQuery((sql) => sql`SELECT * FROM models`)
     * 2. Drizzle query builder (browser only): liveQuery(db.select().from(models))
     *
     * @param query - SQL query function or Drizzle query builder
     * @returns Observable that emits arrays of query results
     *
     * @example
     * ```typescript
     * // Using SQL tag function
     * const models$ = BaseDb.liveQuery<ModelRow>(
     *   (sql) => sql`SELECT * FROM models WHERE schema_file_id = ${schemaId}`
     * )
     *
     * // Using Drizzle query builder (browser only)
     * const models$ = BaseDb.liveQuery<ModelRow>(
     *   appDb.select().from(models).where(eq(models.schemaFileId, schemaId))
     * )
     *
     * models$.subscribe(models => {
     *   console.log('Models updated:', models)
     * })
     * ```
     */
    static liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]>;
}
//# sourceMappingURL=BaseDb.d.ts.map