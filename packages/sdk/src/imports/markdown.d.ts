import { ModelDefinitions } from '@/types';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
/**
 * Configuration structure expected in markdown frontmatter
 */
type SeedConfig = {
    seed: {
        model: string;
        properties: {
            [propertyName: string]: {
                type: string;
                target?: string;
                /** For List: element type when primitive (e.g. 'Text', 'Number'). Use target for list of relations. */
                itemsType?: string;
            };
        };
    };
};
/**
 * Parses markdown frontmatter from a file
 * @param filePath Path to the markdown file
 * @returns The parsed frontmatter as an object, or null if no frontmatter found
 */
export declare const parseMarkdownFrontmatter: (filePath: string) => Record<string, any> | null;
/**
 * Converts a seed config from frontmatter to ModelDefinitions format
 * @param config The seed configuration from frontmatter
 * @returns ModelDefinitions object ready to be saved to database
 */
export declare const processSeedConfig: (config: SeedConfig) => ModelDefinitions;
/**
 * Reads a markdown file, parses frontmatter, and saves models/properties to database
 * @param filePath Path to the markdown file
 * @param db Database instance (BetterSQLite3Database or SqliteRemoteDatabase)
 * @returns The created ModelDefinitions
 */
export declare const saveModelsFromMarkdown: (filePath: string, db: BetterSQLite3Database<any> | SqliteRemoteDatabase<any>) => Promise<ModelDefinitions>;
export {};
//# sourceMappingURL=markdown.d.ts.map