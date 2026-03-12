export class AttestationVerificationError extends Error {
  constructor(
    message: string,
    public readonly seedLocalId: string,
    public readonly expectedSchemas: string[],
    public readonly foundSchemas: string[],
    public readonly code: 'METADATA_PROPERTIES_MISSING' = 'METADATA_PROPERTIES_MISSING',
  ) {
    super(message)
    this.name = 'AttestationVerificationError'
  }
}
