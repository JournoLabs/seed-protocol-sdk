import React from 'react'
import { formatSeedJson, type FormatSeedJsonOptions } from './formatSeedJson'

type PreProps = Omit<
  React.DetailedHTMLProps<React.HTMLAttributes<HTMLPreElement>, HTMLPreElement>,
  'children' | 'dangerouslySetInnerHTML'
>

export type SeedJsonProps = PreProps & {
  value: unknown
  /** If set, replaces built-in formatting entirely */
  format?: (value: unknown) => string
  /** Options for `formatSeedJson` when `format` is not set */
  formatOptions?: FormatSeedJsonOptions
  render?: (props: { text: string }) => React.ReactNode
}

/**
 * Read-only JSON display for `Json` item properties or parsed objects. Does not execute code.
 */
export function SeedJson({
  value,
  format,
  formatOptions,
  render,
  ...preProps
}: SeedJsonProps): React.ReactNode {
  const text = format ? format(value) : formatSeedJson(value, formatOptions)
  if (render) {
    return <>{render({ text })}</>
  }
  return <pre {...preProps}>{text}</pre>
}
