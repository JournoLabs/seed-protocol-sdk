/**
 * Node cannot load eas-sdk's ESM build: it named-imports CommonJS `lodash`.
 * Vite hides that. This script fails CI if the unhooked import starts working
 * (upstream fixed it; remove the hook) or if the hook stops loading eas-sdk.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sdkDir = path.join(root, 'packages/sdk')
const hook = path.join(sdkDir, 'src/node/easLodashRegister.js')
const importEas = "import '@ethereum-attestation-service/eas-sdk'"

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: sdkDir,
    encoding: 'utf8',
  })
}

const unhooked = run(['--input-type=module', '-e', importEas])
if (unhooked.status === 0) {
  console.error(
    'eas-sdk now imports under Node without the lodash-es hook. Remove @seedprotocol/sdk/node-eas-lodash and this check.',
  )
  process.exit(1)
}

const hooked = run(['--import', hook, '--input-type=module', '-e', importEas])
if (hooked.status !== 0) {
  console.error(hooked.stderr || hooked.stdout || 'eas-sdk import with the lodash-es hook failed')
  process.exit(1)
}

console.log('eas-sdk Node import: unhooked fails, lodash-es hook loads')
