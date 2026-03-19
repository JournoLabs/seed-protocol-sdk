# Schema Relationships: One-to-Many

This document describes how to define One-to-Many relationships in Seed Protocol schemas, and the recommended patterns for Publication/Post-style models.

## Recommended: Define the Relation on the "Many" Side

**Put the relation property on the child model (the "many" side), not on the parent.**

Example: For a Publication that has many Posts, define `publication` on Post, not `posts` on Publication.

### How Relations Work in the SDK

1. **Relation property** – A single foreign key from child to parent:

   ```json
   "publication": { "type": "Relation", "model": "Publication", "required": true }
   ```

   Stored as `publicationId` in metadata with the related item's seed UID.

2. **List of relations** – Multiple foreign keys from child to parents (e.g. `authors: List('Relation', 'Identity')`):

   ```json
   "authors": { "type": "List", "refValueType": "Relation", "ref": "Identity" }
   ```

   Stored as an array of seed UIDs.

3. **Storage** – Relations are always stored on the **child** side. Each Post stores its `publicationId`; there is no schema support for storing "all posts" on Publication.

### Why Not Put `posts` on Publication?

- **Scale** – A `posts: List(ref: 'Post')` on Publication would require storing thousands of UIDs on one item.
- **Duplication** – The same relationship would be stored twice (Post.publication and Publication.posts).
- **No virtual/computed relations** – The SDK has no support for computed inverse relations; they would need to be stored and kept in sync.

### Example Schema

```json
{
  "Publication": {
    "properties": {
      "name": { "type": "Text" },
      "description": { "type": "Text" }
    }
  },
  "Post": {
    "properties": {
      "title": { "type": "Text" },
      "publication": { "type": "Relation", "model": "Publication", "required": true }
    }
  }
}
```

### Getting Posts for a Publication

Load Posts and filter by the `publication` property value:

```typescript
const posts = await useItems({ modelName: 'Post' })
const publicationPosts = posts.filter(p => p.publication === publicationUid)
```

Or implement a custom query layer if you need filtering by relation value at the database level.

### The `accessor` Field on Relation

The `accessor` field in the schema (e.g. `"accessor": "ImageSrc"`) is used for **Image** relations. It describes how the referenced property is exposed when the Image model is used as a relation target (e.g. when used as a cover image). It is not used for inverse relations.

## Summary

| Approach | Recommendation |
| -------- | -------------- |
| Post has `publication` (Relation) | ✅ **Recommended** |
| Publication has `posts` (List) | ❌ Avoid – doesn't scale, duplicates data |
| Both | ❌ Avoid – redundant and hard to keep in sync |

**Define the relation on the "many" side only.** To get "posts for a publication," query or filter Posts where `publication` equals the publication's UID.
