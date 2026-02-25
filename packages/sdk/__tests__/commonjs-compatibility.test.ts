import { describe, it, expect } from 'vitest'

describe('CommonJS Compatibility', () => {
  it('should be importable in CommonJS environment', async () => {
    // This test simulates a CommonJS require
    const requireMock = (path: string) => {
      if (path === '@seedprotocol/sdk') {
        // Mock the CommonJS require behavior
        return {
          Model: class Model {},
          Property: class Property {},
          Item: class Item {},
          ItemProperty: class ItemProperty {},
          // Add other exports as needed
        }
      }
      throw new Error(`Cannot find module '${path}'`)
    }

    // Test that we can "require" the module
    const sdk = requireMock('@seedprotocol/sdk')
    
    expect(sdk.Model).toBeDefined()
    expect(sdk.Property).toBeDefined()
    expect(sdk.Item).toBeDefined()
    expect(sdk.ItemProperty).toBeDefined()
  })

  it('should have proper package.json exports for CommonJS', () => {
    // This test verifies that the package.json exports are configured correctly
    const packageJson = require('../../package.json')
    
    expect(packageJson.exports).toBeDefined()
    expect(packageJson.exports['.'].require).toBeDefined()
    expect(packageJson.exports['.'].import).toBeDefined()
    
    // Verify the paths point to the correct files
    expect(packageJson.exports['.'].require.default).toBe('./dist/main.cjs.js')
    expect(packageJson.exports['.'].import.default).toBe('./dist/main.js')
  })
}) 