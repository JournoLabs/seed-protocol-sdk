import { parentElement, textElement, XML_DECLARATION } from './xml'

/**
 * PREMIS 3.0 preservation metadata (https://www.loc.gov/standards/premis/v3/): the objects in a
 * bag, the events in their history and the agents behind those events. Event and agent types use
 * the Library of Congress preservation vocabularies, written with their id.loc.gov value URIs.
 */

export type PremisIdentifier = { type: string; value: string }

/** The thing a bag preserves, such as a Seed: identifiers only. */
export type PremisIntellectualEntity = {
  kind: 'intellectualEntity'
  identifiers: PremisIdentifier[]
}

/** One payload file, with its fixity and format. */
export type PremisFile = {
  kind: 'file'
  identifiers: PremisIdentifier[]
  /** Hex digests by algorithm name, e.g. `{ 'SHA-256': '…' }`. */
  fixity: Record<string, string>
  size: number
  /** A MIME type, or another format name. */
  formatName: string
  /** The file's name where it came from, e.g. its Arweave transaction id. */
  originalName?: string
}

export type PremisObject = PremisIntellectualEntity | PremisFile

/** Event types from https://id.loc.gov/vocabulary/preservation/eventType, by label. */
export const PREMIS_EVENT_TYPES = {
  creation: 'cre',
  modification: 'mod',
  'metadata modification': 'mem',
  'message digest calculation': 'mes',
  'information package creation': 'ipc',
  'fixity check': 'fix',
  validation: 'val',
  'digital signature generation': 'dsg',
  capture: 'cap',
  replication: 'rep',
} as const
export type PremisEventType = keyof typeof PREMIS_EVENT_TYPES

export type PremisEvent = {
  identifier: PremisIdentifier
  type: PremisEventType
  /** ISO 8601. */
  dateTime: string
  detail?: string
  outcome?: 'success' | 'failure'
  outcomeNote?: string
  agents?: (PremisIdentifier & { role?: string })[]
  objects?: (PremisIdentifier & { role?: string })[]
}

/** Agent types from https://id.loc.gov/vocabulary/preservation/agentType. */
export const PREMIS_AGENT_TYPES = { person: 'per', organization: 'org', software: 'sof', hardware: 'har' } as const
export type PremisAgentType = keyof typeof PREMIS_AGENT_TYPES

export type PremisAgent = {
  identifiers: PremisIdentifier[]
  name?: string
  type: PremisAgentType
  version?: string
  note?: string
}

export type Premis = { objects: PremisObject[]; events?: PremisEvent[]; agents?: PremisAgent[] }

const VOCABULARY = 'http://id.loc.gov/vocabulary/preservation'

const identifier = (indent: string, element: string, id: PremisIdentifier): string =>
  parentElement(
    indent,
    element,
    textElement(`${indent}  `, `premis:${element.replace('premis:', '')}Type`, id.type) +
      textElement(`${indent}  `, `premis:${element.replace('premis:', '')}Value`, id.value),
  )

const linking = (indent: string, element: 'linkingAgentIdentifier' | 'linkingObjectIdentifier', id: PremisIdentifier & { role?: string }) => {
  const role = element === 'linkingAgentIdentifier' ? 'linkingAgentRole' : 'linkingObjectRole'
  return parentElement(
    indent,
    `premis:${element}`,
    textElement(`${indent}  `, `premis:${element}Type`, id.type) +
      textElement(`${indent}  `, `premis:${element}Value`, id.value) +
      textElement(`${indent}  `, `premis:${role}`, id.role),
  )
}

function objectXml(object: PremisObject): string {
  const i = '    '
  const ids = object.identifiers.map((id) => identifier(i, 'premis:objectIdentifier', id)).join('')
  if (object.kind === 'intellectualEntity') {
    return parentElement('  ', 'premis:object', ids, { 'xsi:type': 'premis:intellectualEntity' })
  }
  const fixity = Object.entries(object.fixity)
    .map(([algorithm, digest]) =>
      parentElement(
        `${i}  `,
        'premis:fixity',
        textElement(`${i}    `, 'premis:messageDigestAlgorithm', algorithm) +
          textElement(`${i}    `, 'premis:messageDigest', digest),
      ),
    )
    .join('')
  const characteristics = parentElement(
    i,
    'premis:objectCharacteristics',
    textElement(`${i}  `, 'premis:compositionLevel', '0') +
      fixity +
      textElement(`${i}  `, 'premis:size', String(object.size)) +
      parentElement(
        `${i}  `,
        'premis:format',
        parentElement(`${i}    `, 'premis:formatDesignation', textElement(`${i}      `, 'premis:formatName', object.formatName)),
      ),
  )
  return parentElement(
    '  ',
    'premis:object',
    ids + characteristics + textElement(i, 'premis:originalName', object.originalName),
    { 'xsi:type': 'premis:file' },
  )
}

function eventXml(event: PremisEvent): string {
  const i = '    '
  const code = PREMIS_EVENT_TYPES[event.type]
  return parentElement(
    '  ',
    'premis:event',
    identifier(i, 'premis:eventIdentifier', event.identifier) +
      textElement(i, 'premis:eventType', event.type, {
        authority: 'eventType',
        authorityURI: `${VOCABULARY}/eventType`,
        valueURI: `${VOCABULARY}/eventType/${code}`,
      }) +
      textElement(i, 'premis:eventDateTime', event.dateTime) +
      parentElement(i, 'premis:eventDetailInformation', textElement(`${i}  `, 'premis:eventDetail', event.detail)) +
      parentElement(
        i,
        'premis:eventOutcomeInformation',
        textElement(`${i}  `, 'premis:eventOutcome', event.outcome) +
          parentElement(
            `${i}  `,
            'premis:eventOutcomeDetail',
            textElement(`${i}    `, 'premis:eventOutcomeDetailNote', event.outcomeNote),
          ),
      ) +
      (event.agents ?? []).map((agent) => linking(i, 'linkingAgentIdentifier', agent)).join('') +
      (event.objects ?? []).map((object) => linking(i, 'linkingObjectIdentifier', object)).join(''),
  )
}

function agentXml(agent: PremisAgent): string {
  const i = '    '
  return parentElement(
    '  ',
    'premis:agent',
    agent.identifiers.map((id) => identifier(i, 'premis:agentIdentifier', id)).join('') +
      textElement(i, 'premis:agentName', agent.name) +
      textElement(i, 'premis:agentType', agent.type, {
        authority: 'agentType',
        authorityURI: `${VOCABULARY}/agentType`,
        valueURI: `${VOCABULARY}/agentType/${PREMIS_AGENT_TYPES[agent.type]}`,
      }) +
      textElement(i, 'premis:agentVersion', agent.version) +
      textElement(i, 'premis:agentNote', agent.note),
  )
}

/** `premis` as a PREMIS 3.0 XML document. PREMIS requires at least one object. */
export function premisXml(premis: Premis): string {
  if (premis.objects.length === 0) throw new Error('PREMIS needs at least one object')
  return (
    XML_DECLARATION +
    '<premis:premis xmlns:premis="http://www.loc.gov/premis/v3"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
    ' xsi:schemaLocation="http://www.loc.gov/premis/v3 https://www.loc.gov/standards/premis/premis.xsd"' +
    ' version="3.0">\n' +
    premis.objects.map(objectXml).join('') +
    (premis.events ?? []).map(eventXml).join('') +
    (premis.agents ?? []).map(agentXml).join('') +
    '</premis:premis>\n'
  )
}
