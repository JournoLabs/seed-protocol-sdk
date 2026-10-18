/**
 * A cached entity instance and the number of holds on it. An instance cached under several keys
 * (a name and an id) stores the same entry object under each, so all keys share one count.
 */
export interface CacheEntry<T> {
  instance: T
  refCount: number
}
