export interface SeedProtocolSdk {

  getCorrectId: typeof import('@/helpers').getCorrectId;

  // Exported constants
  eventEmitter: typeof import('@/eventBus').eventEmitter;

  // Exported types
  Model: typeof import('@/Schema').Model;
  Property: typeof import('@/Schema').Property;
  Image: typeof import('@/Schema').Image;
  List: typeof import('@/Schema').List;
  Text: typeof import('@/Schema').Text;
  Json: typeof import('@/Schema').Json;
  Relation: typeof import('@/Schema').Relation;

  // Node-specific exports
  withSeed?: typeof import('@/node').withSeed;
} 
