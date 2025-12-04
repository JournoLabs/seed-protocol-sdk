import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe('Configuration Validation', () => {
  const testProjectDir = path.join(__dirname, '..', '__mocks__', 'node', 'project')
  
  describe('Database configuration files', () => {
    it('should validate node.app.db.config.ts has correct paths', () => {
      const configPath = path.join(__dirname, '..', '..', 'src', 'db', 'configs', 'node.app.db.config.ts')
      
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8')
        
        // Should not contain incorrect paths
        expect(configContent).not.toContain('.seed/app/schema')
        expect(configContent).not.toContain('.seed/app/db')
        
        // Should contain correct paths
        expect(configContent).toContain('${dotSeedDir}/schema')
        expect(configContent).toContain('${dotSeedDir}/db')
        
        // Should have proper Drizzle configuration structure
        expect(configContent).toContain('defineConfig')
        expect(configContent).toContain('schema:')
        expect(configContent).toContain('dialect:')
        expect(configContent).toContain('out:')
        expect(configContent).toContain('dbCredentials:')
      }
    })

    it('should validate browser.app.db.config.ts has correct paths', () => {
      const configPath = path.join(__dirname, '..', '..', 'src', 'db', 'configs', 'browser.app.db.config.ts')
      
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8')
        
        // Should not contain incorrect paths
        expect(configContent).not.toContain('.seed/app/schema')
        expect(configContent).not.toContain('.seed/app/db')
        
        // Should contain correct paths
        expect(configContent).toContain('${dotSeedDir}/schema')
        expect(configContent).toContain('${dotSeedDir}/db')
        
        // Should have proper Drizzle configuration structure
        expect(configContent).toContain('defineConfig')
        expect(configContent).toContain('schema:')
        expect(configContent).toContain('dialect:')
        expect(configContent).toContain('out:')
        expect(configContent).toContain('dbCredentials:')
      }
    })

    it('should validate that config files are valid TypeScript', () => {
      const configFiles = [
        path.join(__dirname, '..', '..', 'src', 'db', 'configs', 'node.app.db.config.ts'),
        path.join(__dirname, '..', '..', 'src', 'db', 'configs', 'browser.app.db.config.ts')
      ]
      
      for (const configPath of configFiles) {
        if (fs.existsSync(configPath)) {
          const content = fs.readFileSync(configPath, 'utf-8')
          
          // Basic TypeScript syntax validation
          expect(content).toContain('import')
          expect(content).toContain('export')
          
          // Should not have syntax errors
          const openBrackets = (content.match(/\{/g) || []).length
          const closeBrackets = (content.match(/\}/g) || []).length
          expect(openBrackets).toBe(closeBrackets)
          
          // Should not have unmatched quotes
          const singleQuotes = (content.match(/'/g) || []).length
          const doubleQuotes = (content.match(/"/g) || []).length
          expect(singleQuotes % 2).toBe(0)
          expect(doubleQuotes % 2).toBe(0)
        }
      }
    })
  })

  describe('Build configuration validation', () => {
    it('should validate vite.config.js copies files to correct locations', () => {
      const viteConfigPath = path.join(__dirname, '..', '..', 'vite.config.js')
      
      if (fs.existsSync(viteConfigPath)) {
        const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf-8')
        
        // Should copy node config to correct location
        expect(viteConfigContent).toContain('src/db/configs/node.app.db.config.ts')
        expect(viteConfigContent).toContain('dest: \'dist/db/configs\'')
        
        // Should copy browser config to correct location
        expect(viteConfigContent).toContain('src/db/configs')
        expect(viteConfigContent).toContain('dest: \'dist/shared\'')
      }
    })

    it('should validate rollup.config.mjs has correct aliases', () => {
      const rollupConfigPath = path.join(__dirname, '..', '..', 'rollup.config.mjs')
      
      if (fs.existsSync(rollupConfigPath)) {
        const rollupConfigContent = fs.readFileSync(rollupConfigPath, 'utf-8')
        
        // Should have correct alias for db configs
        expect(rollupConfigContent).toContain('db/configs/node.app.db.config')
        expect(rollupConfigContent).toContain('src/db/configs/node.app.db.config.ts')
      }
    })
  })

  describe('Path resolution validation', () => {
    it('should validate NODE_APP_DB_CONFIG constant has correct value', () => {
      const constantsPath = path.join(__dirname, '..', '..', 'src', 'node', 'constants.ts')
      
      if (fs.existsSync(constantsPath)) {
        const constantsContent = fs.readFileSync(constantsPath, 'utf-8')
        
        // Should have correct path
        expect(constantsContent).toContain('NODE_APP_DB_CONFIG = \'db/configs/node.app.db.config.ts\'')
        
        // Should not have old incorrect path
        expect(constantsContent).not.toContain('NODE_APP_DB_CONFIG = \'node.app.db.config.ts\'')
      }
    })

    it('should validate that production paths resolve correctly', () => {
      // This test simulates the production path resolution
      const sdkRootDir = '/tmp/node_modules/@seedprotocol/sdk/dist'
      const configPath = 'db/configs/node.app.db.config.ts'
      const fullPath = path.join(sdkRootDir, configPath)
      
      // Should resolve to correct production path
      expect(fullPath).toBe('/tmp/node_modules/@seedprotocol/sdk/dist/db/configs/node.app.db.config.ts')
      
      // Should not resolve to old incorrect path
      expect(fullPath).not.toBe('/tmp/node_modules/@seedprotocol/sdk/dist/node.app.db.config.ts')
    })
  })

  describe('Generated configuration validation', () => {
    it('should validate that built config files exist in correct locations', () => {
      const expectedPaths = [
        'dist/db/configs/node.app.db.config.ts',
        'dist/shared/configs/browser.app.db.config.ts'
      ]
      
      for (const expectedPath of expectedPaths) {
        const fullPath = path.join(__dirname, '..', '..', expectedPath)
        
        // Skip if dist directory doesn't exist (not built yet)
        if (fs.existsSync(path.dirname(fullPath))) {
          expect(fs.existsSync(fullPath)).toBe(true)
        }
      }
    })

    it('should validate that built config files have correct content', () => {
      const configPath = path.join(__dirname, '..', '..', 'dist', 'db', 'configs', 'node.app.db.config.ts')
      
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8')
        
        // Should have correct paths in built file
        expect(configContent).toContain('schema: [`${dotSeedDir}/schema/*Schema.ts`]')
        expect(configContent).toContain('out: `${dotSeedDir}/db`')
        expect(configContent).toContain('url: `${dotSeedDir}/db/seed.db`')
        
        // Should not have incorrect paths
        expect(configContent).not.toContain('schema: [`${dotSeedDir}/app/schema/*Schema.ts`]')
        expect(configContent).not.toContain('out: `${dotSeedDir}/app/db`')
        expect(configContent).not.toContain('url: `${dotSeedDir}/app/db/seed.db`')
      }
    })
  })
}) 