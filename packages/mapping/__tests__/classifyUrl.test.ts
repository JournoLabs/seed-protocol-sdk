import { describe, expect, it } from 'vitest'
import { classifyUrl, looksLikeUrl } from '../src/classifyUrl'

describe('classifyUrl', () => {
  it('prefers contentType over extension', () => {
    expect(
      classifyUrl({
        url: 'https://cdn.example/ep.bin',
        contentType: 'audio/mpeg',
      }),
    ).toBe('audio')
    expect(
      classifyUrl({
        url: 'https://cdn.example/pic.mp3',
        contentType: 'image/png',
      }),
    ).toBe('image')
  })

  it('classifies from path extension', () => {
    expect(classifyUrl({ url: 'https://ex.com/a.png' })).toBe('image')
    expect(classifyUrl({ url: 'https://ex.com/a.mp3' })).toBe('audio')
    expect(classifyUrl({ url: 'https://ex.com/a.mp4' })).toBe('video')
    expect(classifyUrl({ url: 'https://ex.com/post.html' })).toBe('html')
    expect(classifyUrl({ url: 'https://ex.com/doc.pdf' })).toBe('unknown')
  })

  it('handles empty and mime with charset', () => {
    expect(classifyUrl({ url: '' })).toBe('unknown')
    expect(
      classifyUrl({
        url: 'https://ex.com/x',
        contentType: 'text/html; charset=utf-8',
      }),
    ).toBe('html')
  })
})

describe('looksLikeUrl', () => {
  it('detects absolute URLs', () => {
    expect(looksLikeUrl('https://a.com')).toBe(true)
    expect(looksLikeUrl('http://a.com')).toBe(true)
    expect(looksLikeUrl('blob:xyz')).toBe(true)
    expect(looksLikeUrl('not a url')).toBe(false)
  })
})
