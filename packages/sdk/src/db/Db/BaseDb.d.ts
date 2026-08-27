import type { IDb } from '@/interfaces/IDb';
import { Observable } from 'rxjs';
export declare abstract class BaseDb {
    static filesDir: string | undefined;
    private static _impl;
    static configure(impl: IDb): void;
    private static requireImpl;
    static getAppDb(): any;
    static prepareDb(filesDir: string, config?: any): Promise<any>;
    static isAppDbReady(): boolean;
    static connectToDb(pathToDir: string): Promise<unknown>;
    static migrate(pathToDbDir: string, dbName: string, dbId: string): Promise<void>;
    static liveQuery<T>(query: ((sql: any) => any) | any): Observable<T[]>;
}
