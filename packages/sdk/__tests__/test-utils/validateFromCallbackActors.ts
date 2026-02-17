/**
 * Test utility to validate that all fromCallback actors follow the correct pattern:
 * 1. They send explicit event types via sendBack (not relying on onDone)
 * 2. All sendBack calls include a 'type' property
 * 3. Error handling sends explicit error events
 * 
 * This utility can be used to test all fromCallback actors in the codebase.
 */

import { fromCallback, EventObject } from 'xstate'
import { readdir, readFile } from 'fs/promises'
import { stat } from 'fs/promises'
import * as path from 'path'

type ValidationResult = {
  file: string
  actorName: string
  issues: string[]
  isValid: boolean
}

type SendBackCall = {
  line: number
  code: string
  hasType: boolean
  typeValue?: string
}

/**
 * Validates a single fromCallback actor file
 */
export function validateFromCallbackActor(
  filePath: string,
  actorCode: string
): ValidationResult {
  const issues: string[] = []
  const actorName = path.basename(filePath, path.extname(filePath))
  
  // Check if file contains fromCallback
  if (!actorCode.includes('fromCallback')) {
    return {
      file: filePath,
      actorName,
      issues: [],
      isValid: true, // Not a fromCallback actor, skip
    }
  }

  // Find all sendBack calls
  const sendBackCalls: SendBackCall[] = []
  const lines = actorCode.split('\n')
  
  lines.forEach((line, index) => {
    // Look for sendBack calls (can span multiple lines)
    if (line.includes('sendBack')) {
      // Try to find the complete call (may span lines)
      let fullCall = line
      let lineOffset = 0
      
      // If line doesn't end with ), try to find the closing
      while (!fullCall.includes(')') && index + lineOffset < lines.length - 1) {
        lineOffset++
        fullCall += '\n' + lines[index + lineOffset]
      }
      
      sendBackCalls.push({
        line: index + 1,
        code: fullCall.trim(),
        hasType: /type\s*[:=]/.test(fullCall),
        typeValue: extractTypeValue(fullCall),
      })
    }
  })

  // Validate each sendBack call
  sendBackCalls.forEach((call, idx) => {
    if (!call.hasType) {
      issues.push(
        `Line ${call.line}: sendBack call missing 'type' property. Callback actors must send explicit event types.`
      )
    } else if (call.typeValue) {
      // Check for common anti-patterns
      const type = call.typeValue.toLowerCase()
      if (type.includes('done') || type.includes('complete') && !type.includes('success')) {
        issues.push(
          `Line ${call.line}: sendBack uses '${call.typeValue}' which might be confused with onDone. Use explicit success/error event types.`
        )
      }
    }
  })

  // Check for onDone usage in the file (would indicate incorrect pattern)
  if (actorCode.includes('onDone') && actorCode.includes('fromCallback')) {
    issues.push(
      'File contains both fromCallback and onDone. Callback actors do not support onDone - use explicit event handlers instead.'
    )
  }

  // Check for error.platform pattern (should use explicit error events)
  if (actorCode.includes('error.platform') && actorCode.includes('fromCallback')) {
    issues.push(
      'File uses error.platform pattern. Callback actors should send explicit error event types via sendBack.'
    )
  }

  // Check that all async operations have error handling
  const asyncPatterns = [
    /\.then\(/g,
    /async\s+\(/g,
    /await\s+/g,
  ]
  
  let hasAsync = false
  asyncPatterns.forEach(pattern => {
    if (pattern.test(actorCode)) {
      hasAsync = true
    }
  })

  if (hasAsync) {
    // Check if there's error handling
    const hasErrorHandling = 
      actorCode.includes('.catch(') || 
      actorCode.includes('try {') ||
      actorCode.includes('catch (')
    
    if (!hasErrorHandling) {
      issues.push(
        'Async operations detected but no error handling found. All async operations should have .catch() handlers that send error events.'
      )
    }
  }

  return {
    file: filePath,
    actorName,
    issues,
    isValid: issues.length === 0,
  }
}

/**
 * Extracts the type value from a sendBack call
 */
function extractTypeValue(code: string): string | undefined {
  // Match patterns like: type: 'eventName' or type: "eventName" or type: EventName
  const typeMatch = code.match(/type\s*[:=]\s*['"`]([^'"`]+)['"`]/)
  if (typeMatch) {
    return typeMatch[1]
  }
  
  // Match patterns like: type: SomeConstant
  const constMatch = code.match(/type\s*[:=]\s*([A-Z_][A-Z0-9_]*)/)
  if (constMatch) {
    return constMatch[1]
  }
  
  return undefined
}

/**
 * Validates all fromCallback actors in a directory
 */
export async function validateAllFromCallbackActors(
  directory: string,
  excludePatterns: string[] = ['node_modules', 'dist', '__tests__']
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = []
  
  function shouldExclude(filePath: string): boolean {
    return excludePatterns.some(pattern => filePath.includes(pattern))
  }

  async function walkDir(dir: string): Promise<void> {
    const entries = await readdir(dir)
    
    for (const entryName of entries) {
      const fullPath = path.join(dir, entryName)
      
      if (shouldExclude(fullPath)) {
        continue
      }
      
      try {
        const entryStat = await stat(fullPath)
        
        if (entryStat.isDirectory()) {
          await walkDir(fullPath)
        } else if (entryStat.isFile() && (entryName.endsWith('.ts') || entryName.endsWith('.tsx'))) {
          try {
            const content = await readFile(fullPath, 'utf-8')
            const result = validateFromCallbackActor(fullPath, content)
            
            // Only include files that actually have fromCallback
            if (content.includes('fromCallback')) {
              results.push(result)
            }
          } catch (error) {
            // Skip files that can't be read
            console.warn(`Could not read ${fullPath}:`, error)
          }
        }
      } catch (error) {
        // Skip entries that can't be accessed
        console.warn(`Could not access ${fullPath}:`, error)
      }
    }
  }

  await walkDir(directory)
  return results
}

/**
 * Creates a test that validates all fromCallback actors
 */
export function createFromCallbackValidationTest() {
  return async () => {
    const srcDir = path.join(process.cwd(), 'src')
    const results = await validateAllFromCallbackActors(srcDir)
    
    const invalid = results.filter(r => !r.isValid)
    
    if (invalid.length > 0) {
      console.error('\n❌ Found fromCallback actors with issues:\n')
      invalid.forEach(result => {
        console.error(`\n📁 ${result.file}`)
        console.error(`   Actor: ${result.actorName}`)
        result.issues.forEach(issue => {
          console.error(`   ⚠️  ${issue}`)
        })
      })
      
      throw new Error(
        `Found ${invalid.length} fromCallback actor(s) with validation issues. ` +
        `See output above for details.`
      )
    } else {
      console.log(`✅ All ${results.length} fromCallback actors are valid!`)
    }
  }
}

