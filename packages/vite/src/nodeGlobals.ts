import path from 'node:path'
import { parseAst } from 'vite'
import { attachScopes, type AttachedScope } from '@rollup/pluginutils'

// Node.js globals that are undefined in browsers and will throw at runtime.
const BROWSER_DANGEROUS_GLOBALS = new Set(['global', 'process', 'Buffer', '__dirname', '__filename'])

export interface GlobalHit {
  global: string
  /** zero-based character offset in the chunk */
  offset: number
  /** 1-based line number */
  line: number
  /** surrounding raw source for context */
  context: string
}

// Loose ESTree node: we only read type, positions and child nodes.
type AstNode = { type: string; start: number; end: number; [key: string]: unknown }
type AstPath = { node: AstNode; key: string; parent: AstPath | null }

function isAstNode(value: unknown): value is AstNode {
  return !!value && typeof value === 'object' && typeof (value as AstNode).type === 'string'
}

/** Whether an Identifier at `key` of `parent` reads a variable (not a property name or label). */
function isVariableReference(parent: AstNode, key: string): boolean {
  switch (parent.type) {
    case 'MemberExpression':
      return key !== 'property' || !!parent.computed
    case 'Property':
    case 'MethodDefinition':
    case 'PropertyDefinition':
    case 'AccessorProperty':
      return key !== 'key' || !!parent.computed
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'MetaProperty':
      return false
    case 'ImportSpecifier':
      return key !== 'imported'
    case 'ExportSpecifier':
      return key !== 'exported'
    default:
      return true
  }
}

function containsTypeofOf(node: AstNode, name: string): boolean {
  if (
    node.type === 'UnaryExpression' &&
    node.operator === 'typeof' &&
    isAstNode(node.argument) &&
    node.argument.type === 'Identifier' &&
    node.argument.name === name
  ) {
    return true
  }
  for (const key of Object.keys(node)) {
    const child = node[key]
    if (Array.isArray(child)) {
      if (child.some((c) => isAstNode(c) && containsTypeofOf(c, name))) return true
    } else if (isAstNode(child) && containsTypeofOf(child, name)) {
      return true
    }
  }
  return false
}

/**
 * Whether the reference only runs behind a guard: the consequent of a
 * `typeof name` test (`if`, `?:`, `&&`/`||`), or a try block.
 */
function isGuarded(path: AstPath, name: string): boolean {
  for (let child = path; child.parent; child = child.parent) {
    const ancestor = child.parent.node
    const viaKey = child.key
    if (
      (ancestor.type === 'IfStatement' || ancestor.type === 'ConditionalExpression') &&
      viaKey !== 'test' &&
      containsTypeofOf(ancestor.test as AstNode, name)
    ) {
      return true
    }
    if (
      ancestor.type === 'LogicalExpression' &&
      viaKey === 'right' &&
      containsTypeofOf(ancestor.left as AstNode, name)
    ) {
      return true
    }
    if (ancestor.type === 'TryStatement' && viaKey === 'block') return true
  }
  return false
}

/**
 * Find free references to Node-only globals in a bundled chunk. Skips names
 * the chunk declares itself (e.g. the process polyfill's own `var process`),
 * `typeof` checks, property names, and uses behind a `typeof` guard or `try`.
 * Best-effort: a chunk that fails to parse reports nothing.
 */
export function findDangerousGlobals(code: string): GlobalHit[] {
  let program: AstNode
  let rootScope: AttachedScope
  try {
    program = parseAst(code) as unknown as AstNode
    rootScope = attachScopes(program as never, 'scope')
  } catch {
    return []
  }

  const hits: GlobalHit[] = []
  const lineStarts = [0]
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) lineStarts.push(i + 1)
  const lineIndexOf = (offset: number) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  // Iterative walk: bundled chunks can nest deeper than the call stack allows.
  const stack: Array<{ path: AstPath; scope: AttachedScope }> = [
    { path: { node: program, key: '', parent: null }, scope: rootScope },
  ]
  while (stack.length > 0) {
    const { path, scope: outerScope } = stack.pop()!
    const { node } = path
    const scope = (node.scope as AttachedScope | undefined) ?? outerScope

    if (
      node.type === 'Identifier' &&
      BROWSER_DANGEROUS_GLOBALS.has(node.name as string) &&
      path.parent
    ) {
      const name = node.name as string
      const parent = path.parent.node
      const isTypeofOperand = parent.type === 'UnaryExpression' && parent.operator === 'typeof'
      if (
        !isTypeofOperand &&
        isVariableReference(parent, path.key) &&
        !scope.contains(name) &&
        !isGuarded(path, name)
      ) {
        const lineIndex = lineIndexOf(node.start)
        const lineStart = lineStarts[lineIndex]!
        const lineEnd = lineStarts[lineIndex + 1] ?? code.length
        const context = code
          .slice(Math.max(lineStart, node.start - 40), Math.min(lineEnd, node.end + 40))
          .trim()
        hits.push({ global: name, offset: node.start, line: lineIndex + 1, context })
      }
      continue
    }

    const children: AstPath[] = []
    for (const key of Object.keys(node)) {
      if (key === 'scope') continue
      const value = node[key]
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) children.push({ node: item, key, parent: path })
        }
      } else if (isAstNode(value)) {
        children.push({ node: value, key, parent: path })
      }
    }
    // Reverse so hits come out in source order.
    for (let i = children.length - 1; i >= 0; i--) stack.push({ path: children[i]!, scope })
  }

  return hits
}

const SEED_PACKAGE_PATH = /[\\/]node_modules[\\/]@seedprotocol[\\/]/

/**
 * Warn about free references to Node-only globals in the bundle's chunks (`debug: true`). A chunk
 * made only of Seed packages' modules (under `seedPackageDirs`, or `node_modules/@seedprotocol/`)
 * is skipped: their guarded uses (`Buffer` in drizzle, `process.cwd` on Node paths) aren't the
 * app's to fix.
 */
export function warnAboutNodeGlobals(
  bundle: Record<string, { type: string; code?: string; moduleIds?: readonly string[] }>,
  seedPackageDirs: readonly string[] = [],
): void {
  const isSeedModule = (id: string) =>
    SEED_PACKAGE_PATH.test(id) || seedPackageDirs.some((dir) => id.startsWith(dir + path.sep) || id.startsWith(dir + '/'))
  const allHits: Array<{ chunk: string } & GlobalHit> = []
  for (const [chunkName, asset] of Object.entries(bundle)) {
    if (asset.type !== 'chunk' || asset.code === undefined) continue
    const ids = asset.moduleIds ?? []
    if (ids.length > 0 && ids.every((id) => isSeedModule(id.replace(/^\0/, '')))) continue
    for (const hit of findDangerousGlobals(asset.code)) allHits.push({ chunk: chunkName, ...hit })
  }
  if (allHits.length === 0) return

  console.warn(
    '\n[seed-vite-plugin] Bare Node.js globals in browser chunks. They throw ReferenceError at ' +
      'runtime if that code runs; set includeNodePolyfills: true if it does.\n',
  )
  const byChunk = new Map<string, typeof allHits>()
  for (const hit of allHits) {
    const list = byChunk.get(hit.chunk) ?? []
    list.push(hit)
    byChunk.set(hit.chunk, list)
  }
  for (const [chunk, hits] of byChunk) {
    console.warn(`  ${chunk}`)
    for (const h of hits) console.warn(`    line ${h.line}: \`${h.global}\`  — ${h.context}`)
  }
  console.warn('')
}
