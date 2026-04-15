/**
 * Tests for relation property resolution in feed output.
 * Verifies that when feed items have resolved relation properties (e.g. image_id -> Arweave URL),
 * the RSS/XML output correctly serializes them. Supports type-based detection (image, coverImage)
 * and legacy naming convention (image_id).
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createFeed, loadFeedConfig } from '@seedprotocol/feed'

describe('Feed relation resolution', () => {
  describe('RSS output with resolved image relation', () => {
    it('serializes singular image relation as <image> URL in RSS', async () => {
      const items = [
        {
          seedUid: '0xtweet123',
          title: 'Test Tweet',
          text: 'Hello world',
          image: 'https://arweave.net/abc123',
          timeCreated: Math.floor(Date.now() / 1000),
        },
      ]

      const rss = await createFeed(items, 'tweet', 'rss')

      expect(rss).toContain('<image>')
      expect(rss).toContain('https://arweave.net/abc123')
      expect(rss).toContain('</image>')
      expect(rss).not.toContain('<image_id>')
    })

    it('serializes coverImage relation as <coverImage> in RSS (type-based naming)', async () => {
      const items = [
        {
          seedUid: '0xtweet789',
          title: 'Tweet with cover',
          text: 'Content',
          coverImage: 'https://arweave.net/cover123',
          timeCreated: Math.floor(Date.now() / 1000),
        },
      ]

      const rss = await createFeed(items, 'tweet', 'rss')

      expect(rss).toContain('<coverImage>')
      expect(rss).toContain('https://arweave.net/cover123')
      expect(rss).toContain('</coverImage>')
    })

    it('serializes list of images as multiple <image> elements in RSS', async () => {
      const items = [
        {
          seedUid: '0xtweet456',
          title: 'Tweet with multiple images',
          text: 'Gallery post',
          images: [
            'https://arweave.net/url1',
            'https://arweave.net/url2',
          ],
          timeCreated: Math.floor(Date.now() / 1000),
        },
      ]

      const rss = await createFeed(items, 'tweet', 'rss')

      expect(rss).toContain('https://arweave.net/url1')
      expect(rss).toContain('https://arweave.net/url2')
      const imageTags = rss.match(/<image>[\s\S]*?<\/image>/g) || []
      expect(imageTags.length).toBeGreaterThanOrEqual(2)
    })

    it('nested featureImage object sets RSS enclosure from arweaveUrl (not object string)', async () => {
      const url = 'https://arweave.net/JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
      const items = [
        {
          seedUid: '0xpostNestedImg',
          title: 'Post',
          text: 'Body',
          timeCreated: Math.floor(Date.now() / 1000),
          featureImage: {
            seedUid: '0ximg1',
            storageTransactionId: 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY',
            arweaveUrl: url,
          },
        },
      ]

      const rss = await createFeed(items, 'post', 'rss')

      expect(rss).toContain(`enclosure url="${url}"`)
      expect(rss).not.toContain('arweave.net/[object Object]')
      expect(rss).toContain('<arweaveUrl>')
      expect(rss).toContain(url)
    })

    it('nested featureImage without arweaveUrl still gets enclosure from storageTransactionId', async () => {
      const tx = 'JYeiPzuglpwr4cMRmCDFFmROnzXwdrDZAzg8vaZZRpY'
      const items = [
        {
          seedUid: '0xpostNestedImg2',
          title: 'Post',
          text: 'Body',
          timeCreated: Math.floor(Date.now() / 1000),
          featureImage: {
            seedUid: '0ximg2',
            storageTransactionId: tx,
          },
        },
      ]

      const rss = await createFeed(items, 'post', 'rss')

      expect(rss).toContain('enclosure url="https://')
      expect(rss).toContain(tx)
      expect(rss).not.toContain('[object Object]')
    })
  })

  describe('RSS output with expanded author relation', () => {
    it('serializes expanded author object as nested XML in <author>', async () => {
      const items = [
        {
          seedUid: '0xpost123',
          title: 'Getting Started',
          text: 'Content',
          author: {
            name: 'Test User',
            seedUid: '0xf8a7e27935e0da0203e53f6bf2a698149adb3fdb3212e2145c19946f4c7ffdda',
            link: 'https://optimism-sepolia.easscan.org/attestation/view/0xf8a7e27935e0da0203e53f6bf2a698149adb3fdb3212e2145c19946f4c7ffdda',
            timeCreated: 1773361995,
          },
          timeCreated: Math.floor(Date.now() / 1000),
        },
      ]

      const rss = await createFeed(items, 'post', 'rss')

      expect(rss).toContain('<author>')
      expect(rss).toContain('<name>Test User</name>')
      expect(rss).toContain('<seedUid>0xf8a7e27935e0da0203e53f6bf2a698149adb3fdb3212e2145c19946f4c7ffdda</seedUid>')
      expect(rss).toContain('dc:creator')
    })

    it('serializes authors array with expanded objects as nested XML', async () => {
      const items = [
        {
          seedUid: '0xpost456',
          title: 'Co-authored post',
          text: 'Content',
          authors: [
            {
              name: 'Alice',
              seedUid: '0xalice123',
              link: 'https://example.com/alice',
              timeCreated: 1773361995,
            },
            {
              name: 'Bob',
              seedUid: '0xbob456',
              link: 'https://example.com/bob',
              timeCreated: 1773361995,
            },
          ],
          timeCreated: Math.floor(Date.now() / 1000),
        },
      ]

      const rss = await createFeed(items, 'post', 'rss')

      expect(rss).toContain('<name>Alice</name>')
      expect(rss).toContain('<name>Bob</name>')
      expect(rss).toContain('<seedUid>0xalice123</seedUid>')
      expect(rss).toContain('<seedUid>0xbob456</seedUid>')
    })
  })

  describe('expandRelations config', () => {
    const originalEnv = process.env.FEED_EXPAND_RELATIONS

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.FEED_EXPAND_RELATIONS = originalEnv
      } else {
        delete process.env.FEED_EXPAND_RELATIONS
      }
    })

    it('returns expandRelations: true by default', () => {
      delete process.env.FEED_EXPAND_RELATIONS
      const config = loadFeedConfig()
      expect(config.expandRelations).toBe(true)
    })

    it('returns expandRelations: false when FEED_EXPAND_RELATIONS=false', () => {
      process.env.FEED_EXPAND_RELATIONS = 'false'
      const config = loadFeedConfig()
      expect(config.expandRelations).toBe(false)
    })

    it('returns expandRelations: true when FEED_EXPAND_RELATIONS=true', () => {
      process.env.FEED_EXPAND_RELATIONS = 'true'
      const config = loadFeedConfig()
      expect(config.expandRelations).toBe(true)
    })
  })
})
