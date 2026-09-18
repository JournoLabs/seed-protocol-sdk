import React from 'react'
import { useResolvedMediaRef, type UseResolvedMediaRefParams } from './useResolvedMediaRef'

type AudioProps = React.DetailedHTMLProps<
  React.AudioHTMLAttributes<HTMLAudioElement>,
  HTMLAudioElement
>

export type SeedMediaAudioProps = Omit<AudioProps, 'src'> & {
  value: string | undefined | null
  enabled?: boolean
  treatAs?: UseResolvedMediaRefParams['treatAs']
  /** Custom render; defaults to `<audio controls />`. */
  render?: (props: AudioProps & { src: string }) => React.ReactNode
}

/**
 * Audio from a raw feed/XML media string. Storage remains File/Image schema types;
 * this helper only picks the browser element.
 */
export function SeedMediaAudio({
  value,
  enabled,
  treatAs,
  render,
  controls = true,
  ...audioProps
}: SeedMediaAudioProps): React.ReactNode {
  const { href } = useResolvedMediaRef({ value, enabled, treatAs })
  if (!href) {
    return null
  }
  const merged = { ...audioProps, src: href, controls } as AudioProps & {
    src: string
  }
  if (render) {
    return <>{render(merged)}</>
  }
  return <audio {...merged} />
}
