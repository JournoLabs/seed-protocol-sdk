export type ParsedEasRelationPropertyName = {
  propertyName: string
  modelName: string
  isList: boolean
}

/**
 * Parse EAS relation property naming: `{singular}_{model}_id` or `{singular}_{model}_ids`.
 * Returns null when the name does not match the expected shape.
 */
export function parseEasRelationPropertyName(
  easPropertyName: string,
): ParsedEasRelationPropertyName | null {
  const [singularProperty, modelName, idSegment] = easPropertyName.split('_')
  if (!singularProperty || !modelName) return null
  const isList = idSegment === 'ids'
  const propertyName = singularProperty.endsWith('s')
    ? singularProperty
    : singularProperty + 's'
  return { propertyName, modelName, isList }
}
