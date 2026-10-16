/**
 * Name of a new Image or File seed's file in the shared `images/` or `files/` folder. Uploads keep
 * their own name (and so their extension, which publish reads for the content type), prefixed with
 * the new seed's local id: two posts that each upload `photo.png` mustn't write the same file.
 */
export const storageFileNameForNewSeed = (seedLocalId: string, name: string): string =>
  `${seedLocalId}-${name}`
