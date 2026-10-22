import { textElement, XML_DECLARATION } from './xml'

/**
 * Simple Dublin Core (the 15 DCMI elements), written as an `oai_dc:dc` record, the format every
 * OAI-PMH repository must support. Each element may repeat; leave a field out rather than
 * guessing a value.
 */
export type DublinCore = Partial<
  Record<
    | 'title'
    | 'creator'
    | 'subject'
    | 'description'
    | 'publisher'
    | 'contributor'
    | 'date'
    | 'type'
    | 'format'
    | 'identifier'
    | 'source'
    | 'language'
    | 'relation'
    | 'coverage'
    | 'rights',
    string | string[]
  >
>

const ELEMENT_ORDER: (keyof DublinCore)[] = [
  'title',
  'creator',
  'subject',
  'description',
  'publisher',
  'contributor',
  'date',
  'type',
  'format',
  'identifier',
  'source',
  'language',
  'relation',
  'coverage',
  'rights',
]

/** `record` as an `oai_dc:dc` XML document. Empty strings are left out. */
export function dublinCoreXml(record: DublinCore): string {
  let body = ''
  for (const element of ELEMENT_ORDER) {
    const value = record[element]
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value]
    for (const v of values) if (v !== '') body += textElement('  ', `dc:${element}`, v)
  }
  return (
    XML_DECLARATION +
    '<oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
    ' xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">\n' +
    body +
    '</oai_dc:dc>\n'
  )
}
