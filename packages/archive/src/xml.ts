// XML 1.0 forbids these code points even as character references.
const INVALID_XML_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g

/** `text` escaped for XML element content and double-quoted attribute values. */
export const escapeXml = (text: string): string =>
  text
    .replace(INVALID_XML_CHARACTER, '�')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export type XmlAttributes = Record<string, string | undefined>

const attributes = (attrs: XmlAttributes | undefined): string =>
  Object.entries(attrs ?? {})
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join('')

/** An element with text content, or nothing when `text` is undefined. */
export const textElement = (indent: string, name: string, text: string | undefined, attrs?: XmlAttributes): string =>
  text === undefined ? '' : `${indent}<${name}${attributes(attrs)}>${escapeXml(text)}</${name}>\n`

/** An element wrapping already-rendered children, or nothing when they are empty. */
export const parentElement = (indent: string, name: string, children: string, attrs?: XmlAttributes): string =>
  children === '' ? '' : `${indent}<${name}${attributes(attrs)}>\n${children}${indent}</${name}>\n`

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n'
