/**
 * Test utility to validate that all fromCallback actors follow the correct pattern:
 * 1. They send explicit event types via sendBack (not relying on onDone)
 * 2. All sendBack calls include a 'type' property
 * 3. Error handling sends explicit error events
 * 
 * This utility can be used to test all fromCallback actors in the codebase.
 */

import { readdir, readFile } from 'fs/promises'
import { stat } from 'fs/promises'
import * as path from 'path'

export type ValidationResult = {
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

/** Blank out comments (keeping newlines so line numbers stay right). */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (_m, pre) => pre)
}

/**
 * Finds actual `sendBack(...)` calls (not the `({ sendBack })` destructuring) and returns each call's
 * argument text, matching parentheses so multi-line event objects are captured whole.
 */
function findSendBackCalls(code: string): SendBackCall[] {
  const calls: SendBackCall[] = []
  const re = /\bsendBack\s*\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(code))) {
    let i = match.index + match[0].length
    let depth = 1
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth++
      else if (code[i] === ')') depth--
      i++
    }
    const args = code.slice(match.index + match[0].length, i - 1).trim()
    calls.push({
      line: code.slice(0, match.index).split('\n').length,
      code: `sendBack(${args})`,
      // `{ type: ... }` or a spread of an existing event object (`{ ...event }`)
      hasType: /\btype\s*:/.test(args) || /^\{\s*\.\.\./.test(args),
      typeValue: extractTypeValue(args),
    })
  }
  return calls
}

/**
 * Validates a single fromCallback actor file
 */
export function validateFromCallbackActor(
  filePath: string,
  sourceCode: string
): ValidationResult {
  const issues: string[] = []
  const actorName = path.basename(filePath, path.extname(filePath))
  const actorCode = stripComments(sourceCode)

  // Check if file contains fromCallback
  if (!actorCode.includes('fromCallback')) {
    return {
      file: filePath,
      actorName,
      issues: [],
      isValid: true, // Not a fromCallback actor, skip
    }
  }

  for (const call of findSendBackCalls(actorCode)) {
    if (!call.hasType) {
      issues.push(
        `Line ${call.line}: sendBack call missing 'type' property. Callback actors must send explicit event types.`
      )
    } else if (call.typeValue && /^(done|complete)$/i.test(call.typeValue)) {
      // A bare 'done' event reads like onDone, which callback actors never trigger.
      issues.push(
        `Line ${call.line}: sendBack uses '${call.typeValue}' which might be confused with onDone. Use explicit success/error event types.`
      )
    }
  }

  // Check for onDone usage in the file (would indicate incorrect pattern)
  if (actorCode.includes('onDone')) {
    issues.push(
      'File contains both fromCallback and onDone. Callback actors do not support onDone - use explicit event handlers instead.'
    )
  }

  // Check for error.platform pattern (should use explicit error events)
  if (actorCode.includes('error.platform')) {
    issues.push(
      'File uses error.platform pattern. Callback actors should send explicit error event types via sendBack.'
    )
  }

  // Check that all async operations have error handling
  const hasAsync = [/\.then\(/, /async\s+\(/, /await\s+/].some((pattern) => pattern.test(actorCode))

  if (hasAsync) {
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
  // Match patterns like: type: 'eventName' or type: "eventName"
  const typeMatch = code.match(/type\s*:\s*['"`]([^'"`]+)['"`]/)
  if (typeMatch) {
    return typeMatch[1]
  }

  // Match patterns like: type: SomeConstant or type: Events.SOME_EVENT
  const constMatch = code.match(/type\s*:\s*([A-Za-z_][\w.]*)/)
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
