import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { typiaProto } from '../../rollup-typia-proto'
import fs from 'fs'
import path from 'path'

describe('typiaProto rollup plugin', () => {
  const testOutDir = './__tests__/__fixtures__/proto-output'
  const testPackage = 'test.package'

  // Clean up test directory before each test
  beforeEach(() => {
    if (fs.existsSync(testOutDir)) {
      fs.rmSync(testOutDir, { recursive: true, force: true })
    }
  })

  it('should create output directory if it does not exist', () => {
    const plugin = typiaProto({
      outDir: testOutDir,
      package: testPackage,
      input: []
    })

    plugin.buildEnd()
    expect(fs.existsSync(testOutDir)).toBe(true)
  })

  it('should generate basic proto file with package definition', () => {
    const plugin = typiaProto({
      outDir: testOutDir,
      package: testPackage,
      input: []
    })

    plugin.buildEnd()
    
    const protoContent = fs.readFileSync(path.join(testOutDir, 'seed.proto'), 'utf8')
    expect(protoContent).toContain(`syntax = "proto3"`)
    expect(protoContent).toContain(`package ${testPackage}`)
  })

  it('should generate service definitions correctly', () => {
    const testService = {
      name: 'TestService',
      methods: [
        {
          name: 'TestMethod',
          inputType: 'TestInput',
          outputType: 'TestOutput'
        }
      ]
    }

    const plugin = typiaProto({
      outDir: testOutDir,
      package: testPackage,
      services: [testService],
      input: []
    })

    plugin.buildEnd()
    
    const protoContent = fs.readFileSync(path.join(testOutDir, 'seed.proto'), 'utf8')
    expect(protoContent).toContain('service TestService')
    expect(protoContent).toContain('rpc TestMethod (TestInput) returns (TestOutput)')
  })

  it('should handle multiple service methods', () => {
    const testService = {
      name: 'TestService',
      methods: [
        {
          name: 'Method1',
          inputType: 'Input1',
          outputType: 'Output1'
        },
        {
          name: 'Method2',
          inputType: 'Input2',
          outputType: 'Output2'
        }
      ]
    }

    const plugin = typiaProto({
      outDir: testOutDir,
      package: testPackage,
      services: [testService],
      input: []
    })

    plugin.buildEnd()
    
    const protoContent = fs.readFileSync(path.join(testOutDir, 'seed.proto'), 'utf8')
    expect(protoContent).toContain('rpc Method1 (Input1) returns (Output1)')
    expect(protoContent).toContain('rpc Method2 (Input2) returns (Output2)')
  })

  it('should handle errors when generating proto messages', () => {
    const consoleSpy = vi.spyOn(console, 'error')
    
    const plugin = typiaProto({
      outDir: testOutDir,
      package: testPackage,
      input: [{
        path: '__tests__/__fixtures__/invalid-type.ts',
        types: ['InvalidType']
      }]
    })

    plugin.buildEnd()
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error generating proto for type InvalidType'),
      expect.any(Error)
    )
    expect(consoleSpy).toHaveBeenCalledWith('Make sure the type is decorated with typia tags if needed')
  })

  // Clean up test directory after all tests
  afterAll(() => {
    if (fs.existsSync(testOutDir)) {
      fs.rmSync(testOutDir, { recursive: true, force: true })
    }
  })
}) 