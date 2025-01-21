export interface SeedProtocolSdk {

  getCorrectId: typeof import('@/helpers').getCorrectId;

  // Exported constants
  eventEmitter: typeof import('@/eventBus').eventEmitter;

  // Exported types
  Model: typeof import('@/schema').Model;
  Property: typeof import('@/schema').Property;
  ImageSrc: typeof import('@/schema').ImageSrc;
  List: typeof import('@/schema').List;
  Text: typeof import('@/schema').Text;
  Json: typeof import('@/schema').Json;
  Relation: typeof import('@/schema').Relation;

  // Node-specific exports
  withSeed?: typeof import('@/node').withSeed;
} 