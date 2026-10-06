import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import {
  parseMarkdownFrontmatter,
  processSeedConfig,
  saveModelsFromMarkdown,
} from '@/imports/markdown'
import { models, properties } from '@/seedSchema'
import { BaseDb } from '@/db/Db/BaseDb'
import { eq } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type { ModelDefinitions } from '@/types'
import { setupTestEnvironment } from '../test-utils/client-init'
import { cleanupTestSchemaData } from '../test-utils/cleanupTestDb'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// processSeedConfig returns lightweight stand-ins (not real Model instances) that carry the property
// definitions on `schema`.
const propertyDefs = (result: ModelDefinitions, modelName: string): Record<string, any> =>
  (result[modelName] as unknown as { schema: Record<string, any> }).schema

describe('processMarkdownFrontmatter', () => {
  let tempDir: string

  // saveModelsFromMarkdown writes through addModelsToDb, which always uses the app DB (BaseDb.getAppDb());
  // its `db` argument is unused. So these tests set up the client and read back from the app DB.
  // (Typed as the drizzle SQLite DB saveModelsFromMarkdown accepts; BaseDb.getAppDb() returns any.)
  let db: BetterSQLite3Database<any>

  beforeAll(async () => {
    // Create a temporary directory for test files
    tempDir = path.join(__dirname, '..', '..', '.test-temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }
    await setupTestEnvironment({
      testFileUrl: import.meta.url,
      timeout: 30000,
    })
    db = BaseDb.getAppDb()!
  }, 30000)

  afterAll(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  afterEach(async () => {
    await cleanupTestSchemaData()
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
      expect(propertyDefs(result, 'Post')).toHaveProperty('title')
      expect(propertyDefs(result, 'Post')).toHaveProperty('views')
      expect(propertyDefs(result, 'Post')).toHaveProperty('isPublished')
      expect(propertyDefs(result, 'Post')).toHaveProperty('publishedAt')
      expect(propertyDefs(result, 'Post').title.dataType).toBe('Text')
      expect(propertyDefs(result, 'Post').views.dataType).toBe('Number')
      expect(propertyDefs(result, 'Post').isPublished.dataType).toBe('Boolean')
      expect(propertyDefs(result, 'Post').publishedAt.dataType).toBe('Date')
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

      expect(propertyDefs(result, 'Post').author.dataType).toBe('Relation')
      expect(propertyDefs(result, 'Post').author.ref).toBe('Identity')
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

      expect(propertyDefs(result, 'Post').tags.dataType).toBe('List')
      expect(propertyDefs(result, 'Post').tags.ref).toBe('Tag')
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

      expect(propertyDefs(result, 'Post').text.dataType).toBe('Text')
      expect(propertyDefs(result, 'Post').number.dataType).toBe('Number')
      expect(propertyDefs(result, 'Post').boolean.dataType).toBe('Boolean')
      expect(propertyDefs(result, 'Post').date.dataType).toBe('Date')
      expect(propertyDefs(result, 'Post').image.dataType).toBe('Image')
      expect(propertyDefs(result, 'Post').json.dataType).toBe('Json')
      expect(propertyDefs(result, 'Post').file.dataType).toBe('File')
      expect(propertyDefs(result, 'Post').relation.dataType).toBe('Relation')
      expect(propertyDefs(result, 'Post').list.dataType).toBe('List')
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

      expect(propertyDefs(result, 'Post').keywords.dataType).toBe('List')
      expect(propertyDefs(result, 'Post').keywords.refValueType).toBe('Text')
      expect(propertyDefs(result, 'Post').keywords.ref).toBeUndefined()
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
      expect(propertyDefs(result, 'Article')).toHaveProperty('title')
      expect(propertyDefs(result, 'Article')).toHaveProperty('body')

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
      expect(savedModels.filter((m) => m.name === 'Article')).toHaveLength(1)
      expect(savedModels.filter((m) => m.name === 'BlogPost')).toHaveLength(1)

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
