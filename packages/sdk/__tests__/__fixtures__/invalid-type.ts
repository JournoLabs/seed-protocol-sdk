// This is a test fixture file with invalid TypeScript syntax
// Used to test error handling in the rollup plugin

export interface InvalidType {
  // Missing type annotation - this should cause an error
  invalidProperty
  // Invalid syntax
  anotherProperty: string: number
  // Missing closing brace
  brokenProperty: {
    nested: string
    // Missing closing brace
} 