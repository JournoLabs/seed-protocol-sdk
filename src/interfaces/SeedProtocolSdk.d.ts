export interface SeedProtocolSdk {
  // Exported classes
  Item: typeof import('@/browser/Item/Item').Item;
  ItemProperty: typeof import('@/browser/property/ItemProperty').ItemProperty;

  // Exported hooks
  useItems: typeof import('@/browser').useItems;
  useItem: typeof import('@/browser').useItem;
  useItemProperties: typeof import('@/browser').useItemProperties;
  useCreateItem: typeof import('@/browser').useCreateItem;
  useItemProperty: typeof import('@/browser').useItemProperty;
  useDeleteItem: typeof import('@/browser').useDeleteItem;
  useGlobalServiceStatus: typeof import('@/browser').useGlobalServiceStatus;
  useServices: typeof import('@/browser').useServices;

  // Exported functions
  getGlobalService: typeof import('@/browser').getGlobalService;
  getCorrectId: typeof import('@/helpers').getCorrectId;

  // Exported constants
  eventEmitter: typeof import('@/eventBus').eventEmitter;

  // Exported types
  Model: typeof import('@/browser/schema').Model;
  Property: typeof import('@/browser/schema').Property;
  ImageSrc: typeof import('@/browser/schema').ImageSrc;
  List: typeof import('@/browser/schema').List;
  Text: typeof import('@/browser/schema').Text;
  Json: typeof import('@/browser/schema').Json;
  Relation: typeof import('@/browser/schema').Relation;

  // Node-specific exports
  withSeed?: typeof import('@/node').withSeed;
} 