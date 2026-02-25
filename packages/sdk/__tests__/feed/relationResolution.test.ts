/**
 * Tests for relation property resolution in feed output.
 * Verifies that when feed items have resolved relation properties (e.g. image_id -> Arweave URL),
 * the RSS/XML output correctly serializes them. Supports type-based detection (image, coverImage)
 * and legacy naming convention (image_id).
 */

import { describe, it, expect } from 'vitest'
import { createFeed } from '@seedprotocol/feed'

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
  })
})
