import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SeedMediaAudio } from '../src/SeedMediaAudio'
import { SeedMediaVideo } from '../src/SeedMediaVideo'

describe('SeedMediaAudio', () => {
  it('renders audio with resolved https src', async () => {
    render(
      <SeedMediaAudio
        value="https://cdn.example/ep.mp3"
        data-testid="audio"
      />,
    )
    const el = await screen.findByTestId('audio')
    expect(el.tagName.toLowerCase()).toBe('audio')
    expect(el).toHaveAttribute('src', 'https://cdn.example/ep.mp3')
    expect(el).toHaveAttribute('controls')
  })

  it('uses render prop when provided', async () => {
    render(
      <SeedMediaAudio
        value="https://a.test/a.ogg"
        render={(p) => <audio data-testid="custom" {...p} className="av" />}
      />,
    )
    const el = await screen.findByTestId('custom')
    expect(el).toHaveClass('av')
    expect(el).toHaveAttribute('src', 'https://a.test/a.ogg')
  })
})

describe('SeedMediaVideo', () => {
  it('renders video with resolved https src', async () => {
    render(
      <SeedMediaVideo
        value="https://cdn.example/clip.mp4"
        data-testid="video"
      />,
    )
    const el = await screen.findByTestId('video')
    expect(el.tagName.toLowerCase()).toBe('video')
    expect(el).toHaveAttribute('src', 'https://cdn.example/clip.mp4')
    expect(el).toHaveAttribute('controls')
  })
})
