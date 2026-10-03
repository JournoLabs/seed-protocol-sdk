import pluralize from 'pluralize'

export type ParsedEasRelationPropertyName = {
  propertyName: string
  modelName: string
  isList: boolean
}

/**
 * Parse EAS relation property naming: `{singular}_{model}_id` or `{singular}_{model}_ids`.
 * Lists map back to the plural schema key the same way publicListRelationPropertyKey does
 * (`author_identity_ids` → `authors`, `staff_identity_ids` → `staff`); single relations keep the singular.
 * Returns null when the name does not match the expected shape.
 */
export function parseEasRelationPropertyName(
  easPropertyName: string,
): ParsedEasRelationPropertyName | null {
  const [singularProperty, modelName, idSegment] = easPropertyName.split('_')
  if (!singularProperty || !modelName) return null
  const isList = idSegment === 'ids'
  const propertyName = !isList
    ? singularProperty
    : singularProperty.endsWith('s')
      ? singularProperty
      : pluralize(singularProperty)
  return { propertyName, modelName, isList }
}
