declare global {
  interface Window {
    __SEED_INVALIDATE_ITEM_PROPERTIES__?: ((canonicalId: string) => void) | null;
  }
}

export {};
