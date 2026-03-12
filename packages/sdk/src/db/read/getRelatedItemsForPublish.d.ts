import { IItem } from '@/interfaces';
/**
 * Collects all items that will be in the publish payload (main item + related items from
 * relations and lists). Used by ensureEasSchemas to register schemas for nested items.
 * Skips items that already have seedUid (already published).
 */
export declare function getRelatedItemsForPublish(item: IItem<any>, visited?: Set<string>): Promise<IItem<any>[]>;
//# sourceMappingURL=getRelatedItemsForPublish.d.ts.map