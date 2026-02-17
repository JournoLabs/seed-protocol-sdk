---
seed:
  model: Post
  properties:
    title:
      type: Text
    customField:
      type: UnknownType
---

This has an unknown property type that should throw an error.
