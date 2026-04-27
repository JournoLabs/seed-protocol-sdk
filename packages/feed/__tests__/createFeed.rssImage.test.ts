import { describe, expect, it } from 'vitest'
import { createFeed } from '../src/index'
import { getArweaveUrlForTransaction } from '../src/utils/arweaveUrl'

describe('createFeed rss image tags', () => {
  it('emits enclosure, media:content, and media:thumbnail from _imageMetadata', async () => {
    const xml = await createFeed(
      [
        {
          id: 'post-1',
          title: 'Post 1',
          description: 'Post 1 description',
          _hasImage: true,
          _imageMetadata: {
            isImage: true,
            url: 'https://arweave.net/meta-image',
            mimeType: 'image/webp',
            width: 1200,
            height: 630,
            size: 12345,
          },
        } as any,
      ],
      'post',
      'rss'
    )

    expect(xml).toContain('<enclosure url="https://arweave.net/meta-image" type="image/webp" length="12345"/>')
    expect(xml).toContain('<media:content url="https://arweave.net/meta-image" type="image/webp" medium="image" width="1200" height="630" fileSize="12345"/>')
    expect(xml).toContain('<media:thumbnail url="https://arweave.net/meta-image" width="1200" height="630"/>')
  })

  it('emits RSS image tags from relation object arweaveUrl', async () => {
    const xml = await createFeed(
      [
        {
          id: 'post-2',
          title: 'Post 2',
          image: {
            arweaveUrl: 'https://arweave.net/relation-object',
            mimeType: 'image/png',
            width: 600,
            height: 400,
          },
        } as any,
      ],
      'post',
      'rss'
    )

    expect(xml).toContain('<enclosure url="https://arweave.net/relation-object" type="image/png"/>')
    expect(xml).toContain('<media:content url="https://arweave.net/relation-object" type="image/png" medium="image" width="600" height="400"/>')
    expect(xml).toContain('<media:thumbnail url="https://arweave.net/relation-object" width="600" height="400"/>')
  })

  it('resolves tx id image string and emits RSS image tags', async () => {
    const txId = 'txid-from-image-field'
    const expectedUrl = getArweaveUrlForTransaction(txId)
    const xml = await createFeed(
      [
        {
          id: 'post-3',
          title: 'Post 3',
          feature_image: txId,
        } as any,
      ],
      'post',
      'rss'
    )

    expect(xml).toContain(`<enclosure url="${expectedUrl}" type="image/jpeg"/>`)
    expect(xml).toContain(`<media:content url="${expectedUrl}" type="image/jpeg" medium="image"/>`)
    expect(xml).toContain(`<media:thumbnail url="${expectedUrl}"/>`)
  })

  it('uses first valid relation image from image array', async () => {
    const expectedUrl = getArweaveUrlForTransaction('txid-array-image')
    const xml = await createFeed(
      [
        {
          id: 'post-4',
          title: 'Post 4',
          images: [{ notImage: true }, 'txid-array-image', { arweaveUrl: 'https://arweave.net/ignored' }],
        } as any,
      ],
      'post',
      'rss'
    )

    expect(xml).toContain(`<enclosure url="${expectedUrl}" type="image/jpeg"/>`)
    expect(xml).toContain(`<media:thumbnail url="${expectedUrl}"/>`)
    expect(xml).not.toContain('https://arweave.net/ignored')
  })

  it('does not emit image tags when no image fields are present', async () => {
    const xml = await createFeed(
      [
        {
          id: 'post-5',
          title: 'Post 5',
          description: 'No image here',
        } as any,
      ],
      'post',
      'rss'
    )

    expect(xml).not.toContain('<enclosure ')
    expect(xml).not.toContain('<media:content ')
    expect(xml).not.toContain('<media:thumbnail ')
  })
})
