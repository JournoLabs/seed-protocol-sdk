---
seed:
  model: Post
  properties:
    # Basic types
    title:
      type: Text
    summary:
      type: Text
    content:
      type: Text
    views:
      type: Number
    isPublished:
      type: Boolean
    publishedAt:
      type: Date
    coverImage:
      type: Image
    metadata:
      type: Json
    attachment:
      type: File
    
    # Relation types
    author:
      type: Relation
      target: Identity
    category:
      type: Relation
      target: Category
    
    # List types
    tags:
      type: List
      target: Tag
    comments:
      type: List
      target: Comment
    authors:
      type: List
      target: Identity
    
    # Edge cases: nested relations
    featuredImage:
      type: Relation
      target: Image
    relatedPosts:
      type: List
      target: Post
---

# Post Content

This is the markdown content that comes after the frontmatter.

It can contain:
- Multiple paragraphs
- **Bold text**
- *Italic text*
- [Links](https://example.com)
- Code blocks
- And more markdown features

The frontmatter parser should ignore all of this content and only parse the YAML between the `---` delimiters.
