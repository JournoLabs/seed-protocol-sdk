import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  parseMarkdownFrontmatter,
  processSeedConfig,
  saveModelsFromMarkdown,
} from '@/imports/markdown'
import { models, properties } from '@/seedSchema'
import * as schema from '@/seedSchema'
import { eq } from 'drizzle-orm'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('processMarkdownFrontmatter', () => {
  let db: ReturnType<typeof drizzle>
  let sqlite: Database
  let dbPath: string
  let tempDir: string

  beforeAll(() => {
    // Create a temporary directory for test databases
    tempDir = path.join(__dirname, '..', '..', '.test-temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
  })

  afterAll(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    // Create a fresh database for each test
    dbPath = path.join(tempDir, `test-${Date.now()}.db`)
    sqlite = new Database(dbPath)
    db = drizzle(sqlite, { schema })
  })

  afterEach(() => {
    // Close database connection
    if (sqlite) {
      sqlite.close()
    }
    // Remove test database file
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath)
      } catch (e) {
        // Ignore errors if file is already deleted
      }
    }
  })

  describe('parseMarkdownFrontmatter', () => {
    it('should parse valid frontmatter from markdown file', () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'minimal-test.md',
      )
      const result = parseMarkdownFrontmatter(filePath)

      expect(result).not.toBeNull()
      expect(result).toHaveProperty('seed')
      expect(result?.seed).toHaveProperty('model', 'Article')
      expect(result?.seed).toHaveProperty('properties')
      expect(result?.seed.properties).toHaveProperty('title')
      expect(result?.seed.properties).toHaveProperty('body')
    })

    it('should parse comprehensive frontmatter with all property types', () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'comprehensive-test.md',
      )
      const result = parseMarkdownFrontmatter(filePath)

      expect(result).not.toBeNull()
      expect(result?.seed.model).toBe('Post')
      expect(result?.seed.properties).toHaveProperty('title')
      expect(result?.seed.properties).toHaveProperty('views')
      expect(result?.seed.properties).toHaveProperty('isPublished')
      expect(result?.seed.properties).toHaveProperty('author')
      expect(result?.seed.properties).toHaveProperty('tags')
    })

    it('should return null for file without frontmatter', () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'no-frontmatter.md',
      )
      const result = parseMarkdownFrontmatter(filePath)

      expect(result).toBeNull()
    })

    it('should throw error for invalid YAML syntax', () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'invalid-yaml.md',
      )

      expect(() => parseMarkdownFrontmatter(filePath)).toThrow(
        'Failed to parse YAML frontmatter',
      )
    })

    it('should handle frontmatter with extra whitespace', () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'minimal-test.md',
      )
      const result = parseMarkdownFrontmatter(filePath)

      expect(result).not.toBeNull()
      expect(result?.seed.model).toBe('Article')
    })
  })

  describe('processSeedConfig', () => {
    it('should convert valid seed config to ModelDefinitions', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            title: { type: 'Text' },
            views: { type: 'Number' },
            isPublished: { type: 'Boolean' },
            publishedAt: { type: 'Date' },
          },
        },
      }

      const result = processSeedConfig(config as any)

      expect(result).toHaveProperty('Post')
      expect(result.Post.schema).toHaveProperty('title')
      expect(result.Post.schema).toHaveProperty('views')
      expect(result.Post.schema).toHaveProperty('isPublished')
      expect(result.Post.schema).toHaveProperty('publishedAt')
      expect(result.Post.schema.title.dataType).toBe('Text')
      expect(result.Post.schema.views.dataType).toBe('Number')
      expect(result.Post.schema.isPublished.dataType).toBe('Boolean')
      expect(result.Post.schema.publishedAt.dataType).toBe('Date')
    })

    it('should handle Relation type with target', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            author: { type: 'Relation', target: 'Identity' },
          },
        },
      }

      const result = processSeedConfig(config as any)

      expect(result.Post.schema.author.dataType).toBe('Relation')
      expect(result.Post.schema.author.ref).toBe('Identity')
    })

    it('should handle List type with target', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            tags: { type: 'List', target: 'Tag' },
          },
        },
      }

      const result = processSeedConfig(config as any)

      expect(result.Post.schema.tags.dataType).toBe('List')
      expect(result.Post.schema.tags.ref).toBe('Tag')
    })

    it('should handle all property types', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            text: { type: 'Text' },
            number: { type: 'Number' },
            boolean: { type: 'Boolean' },
            date: { type: 'Date' },
            image: { type: 'Image' },
            json: { type: 'Json' },
            file: { type: 'File' },
            relation: { type: 'Relation', target: 'Model' },
            list: { type: 'List', target: 'Model' },
          },
        },
      }

      const result = processSeedConfig(config as any)

      expect(result.Post.schema.text.dataType).toBe('Text')
      expect(result.Post.schema.number.dataType).toBe('Number')
      expect(result.Post.schema.boolean.dataType).toBe('Boolean')
      expect(result.Post.schema.date.dataType).toBe('Date')
      expect(result.Post.schema.image.dataType).toBe('Image')
      expect(result.Post.schema.json.dataType).toBe('Json')
      expect(result.Post.schema.file.dataType).toBe('File')
      expect(result.Post.schema.relation.dataType).toBe('Relation')
      expect(result.Post.schema.list.dataType).toBe('List')
    })

    it('should throw error when seed config is missing', () => {
      const config = {}

      expect(() => processSeedConfig(config as any)).toThrow(
        'No seed configuration found in frontmatter',
      )
    })

    it('should throw error when model name is missing', () => {
      const config = {
        seed: {
          properties: {
            title: { type: 'Text' },
          },
        },
      }

      expect(() => processSeedConfig(config as any)).toThrow(
        'Model name is required in seed configuration',
      )
    })

    it('should throw error when properties are empty', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {},
        },
      }

      expect(() => processSeedConfig(config as any)).toThrow(
        'Properties are required in seed configuration',
      )
    })

    it('should throw error when property type is missing', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            title: {},
          },
        },
      }

      expect(() => processSeedConfig(config as any)).toThrow(
        'Property type is required for title',
      )
    })

    it('should throw error when Relation type is missing target', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            author: { type: 'Relation' },
          },
        },
      }

      expect(() => processSeedConfig(config as any)).toThrow(
        'Target model is required for Relation property author',
      )
    })

    it('should throw error when List type is missing both itemsType and target', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            tags: { type: 'List' },
          },
        },
      }

      expect(() => processSeedConfig(config as any)).toThrow(
        'List property tags requires either itemsType',
      )
    })

    it('should handle List type with itemsType for list of primitives', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            keywords: { type: 'List', itemsType: 'Text' },
          },
        },
      }

      const result = processSeedConfig(config as any)

      expect(result.Post.schema.keywords.dataType).toBe('List')
      expect(result.Post.schema.keywords.refValueType).toBe('Text')
      expect(result.Post.schema.keywords.ref).toBeUndefined()
    })

    it('should throw error for unknown property type', () => {
      const config = {
        seed: {
          model: 'Post',
          properties: {
            custom: { type: 'UnknownType' },
          },
        },
      }

      expect(() => processSeedConfig(config as any)).toThrow(
        'Unknown property type: UnknownType for property custom',
      )
    })
  })

  describe('saveModelsFromMarkdown', () => {
    it('should save model and properties to database', async () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'minimal-test.md',
      )

      const result = await saveModelsFromMarkdown(filePath, db)

      expect(result).toHaveProperty('Article')
      expect(result.Article.schema).toHaveProperty('title')
      expect(result.Article.schema).toHaveProperty('body')

      // Verify model was saved to database
      const savedModels = await db.select().from(models)
      expect(savedModels.length).toBeGreaterThan(0)
      const articleModel = savedModels.find((m) => m.name === 'Article')
      expect(articleModel).toBeDefined()

      // Verify properties were saved
      if (articleModel) {
        const savedProperties = await db
          .select()
          .from(properties)
          .where(eq(properties.modelId, articleModel.id))
        expect(savedProperties.length).toBe(2)
        expect(savedProperties.some((p) => p.name === 'title')).toBe(true)
        expect(savedProperties.some((p) => p.name === 'body')).toBe(true)
      }
    })

    it('should save comprehensive model with all property types', async () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'comprehensive-test.md',
      )

      const result = await saveModelsFromMarkdown(filePath, db)

      expect(result).toHaveProperty('Post')

      // Verify model was saved
      const savedModels = await db.select().from(models)
      const postModel = savedModels.find((m) => m.name === 'Post')
      expect(postModel).toBeDefined()

      // Verify all properties were saved
      if (postModel) {
        const savedProperties = await db
          .select()
          .from(properties)
          .where(eq(properties.modelId, postModel.id))

        // Should have all properties from the comprehensive test
        expect(savedProperties.length).toBeGreaterThan(10)

        // Check specific property types
        const titleProp = savedProperties.find((p) => p.name === 'title')
        expect(titleProp?.dataType).toBe('Text')

        const viewsProp = savedProperties.find((p) => p.name === 'views')
        expect(viewsProp?.dataType).toBe('Number')

        const isPublishedProp = savedProperties.find(
          (p) => p.name === 'isPublished',
        )
        expect(isPublishedProp?.dataType).toBe('Boolean')

        // Check relation properties
        const authorProp = savedProperties.find((p) => p.name === 'author')
        expect(authorProp?.dataType).toBe('Relation')
        expect(authorProp?.refModelId).toBeDefined()

        // Check list properties
        const tagsProp = savedProperties.find((p) => p.name === 'tags')
        expect(tagsProp?.dataType).toBe('List')
        expect(tagsProp?.refModelId).toBeDefined()
      }
    })

    it('should create referenced models for Relation and List types', async () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'comprehensive-test.md',
      )

      await saveModelsFromMarkdown(filePath, db)

      const savedModels = await db.select().from(models)

      // Should have created Post and all referenced models
      const modelNames = savedModels.map((m) => m.name)
      expect(modelNames).toContain('Post')
      expect(modelNames).toContain('Identity')
      expect(modelNames).toContain('Category')
      expect(modelNames).toContain('Tag')
      expect(modelNames).toContain('Comment')
      expect(modelNames).toContain('Image')
    })

    it('should throw error when file has no frontmatter', async () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'no-frontmatter.md',
      )

      await expect(saveModelsFromMarkdown(filePath, db)).rejects.toThrow(
        'No frontmatter found',
      )
    })

    it('should handle duplicate model names (update existing)', async () => {
      const filePath = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'minimal-test.md',
      )

      // Save first time
      await saveModelsFromMarkdown(filePath, db)
      const firstSave = await db.select().from(models)
      const firstModelId = firstSave.find((m) => m.name === 'Article')?.id

      // Save second time (should update, not create duplicate)
      await saveModelsFromMarkdown(filePath, db)
      const secondSave = await db.select().from(models)
      const articleModels = secondSave.filter((m) => m.name === 'Article')

      // Should still have only one Article model
      expect(articleModels.length).toBe(1)
      expect(articleModels[0].id).toBe(firstModelId)
    })

    it('should handle properties with same name across different models', async () => {
      // Create first model
      const filePath1 = path.join(
        __dirname,
        '..',
        '__fixtures__',
        'minimal-test.md',
      )
      await saveModelsFromMarkdown(filePath1, db)

      // Create a second markdown file with different model but same property name
      const tempFilePath = path.join(tempDir, 'second-model.md')
      fs.writeFileSync(
        tempFilePath,
        `---
seed:
  model: BlogPost
  properties:
    title:
      type: Text
    content:
      type: Text
---
`,
      )

      await saveModelsFromMarkdown(tempFilePath, db)

      const savedModels = await db.select().from(models)
      expect(savedModels.length).toBe(2)

      const articleModel = savedModels.find((m) => m.name === 'Article')
      const blogPostModel = savedModels.find((m) => m.name === 'BlogPost')

      expect(articleModel).toBeDefined()
      expect(blogPostModel).toBeDefined()

      // Both should have title property
      if (articleModel && blogPostModel) {
        const articleProps = await db
          .select()
          .from(properties)
          .where(eq(properties.modelId, articleModel.id))
        const blogPostProps = await db
          .select()
          .from(properties)
          .where(eq(properties.modelId, blogPostModel.id))

        expect(articleProps.some((p) => p.name === 'title')).toBe(true)
        expect(blogPostProps.some((p) => p.name === 'title')).toBe(true)
      }

      // Clean up temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle frontmatter with only whitespace after closing delimiter', () => {
      const tempFilePath = path.join(tempDir, 'whitespace-test.md')
      fs.writeFileSync(
        tempFilePath,
        `---
seed:
  model: Test
  properties:
    title:
      type: Text
---   
   
Content here
`,
      )

      const result = parseMarkdownFrontmatter(tempFilePath)
      expect(result).not.toBeNull()
      expect(result?.seed.model).toBe('Test')

      fs.unlinkSync(tempFilePath)
    })

    it('should handle frontmatter at end of file', () => {
      const tempFilePath = path.join(tempDir, 'end-frontmatter.md')
      fs.writeFileSync(
        tempFilePath,
        `---
seed:
  model: Test
  properties:
    title:
      type: Text
---`,
      )

      const result = parseMarkdownFrontmatter(tempFilePath)
      expect(result).not.toBeNull()
      expect(result?.seed.model).toBe('Test')

      fs.unlinkSync(tempFilePath)
    })

    it('should handle complex nested YAML structures', () => {
      const tempFilePath = path.join(tempDir, 'complex-yaml.md')
      fs.writeFileSync(
        tempFilePath,
        `---
seed:
  model: ComplexModel
  properties:
    metadata:
      type: Json
    tags:
      type: List
      target: Tag
    author:
      type: Relation
      target: Author
---
Content
`,
      )

      const result = parseMarkdownFrontmatter(tempFilePath)
      expect(result).not.toBeNull()
      expect(result?.seed.properties.metadata.type).toBe('Json')
      expect(result?.seed.properties.tags.target).toBe('Tag')

      fs.unlinkSync(tempFilePath)
    })
  })
})
