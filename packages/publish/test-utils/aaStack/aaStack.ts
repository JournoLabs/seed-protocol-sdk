import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  toHex,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { entryPoint06Address, entryPoint08Address } from 'viem/account-abstraction'
import { optimismSepolia } from 'viem/chains'
import { ACCEPT_ALL_PAYMASTER_BYTECODE } from './acceptAllPaymaster'
import { startRecordedRpc, type RecordedRpc } from './recordedRpc'

/** OP Sepolia block the fork is pinned to. Changing it means recording the fixture again. */
export const AA_STACK_FORK_BLOCK = 51084622
const UPSTREAM = 'https://sepolia.optimism.io'
const FIXTURE = join(import.meta.dir, 'opSepoliaFork.json')

// Anvil's default dev keys: the bundler's executor and utility keys, and the paymaster's deployer.
const BUNDLER_EXECUTOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const BUNDLER_UTILITY_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const DEPLOYER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'

export type PaymasterCall = { method: string; entryPoint: Address }

export type AaStack = {
  /** Anvil, forked from OP Sepolia at {@link AA_STACK_FORK_BLOCK}. */
  rpcUrl: string
  /** Alto (EntryPoint v0.6 and v0.8), through a proxy that records sent UserOps. */
  bundlerUrl: string
  /** ERC-7677 service for the accept-all paymaster. */
  paymasterUrl: string
  paymaster: Address
  sentUserOps: Record<string, unknown>[]
  /** The bundler's `eth_estimateUserOperationGas` answers, in order. */
  gasEstimates: Record<string, unknown>[]
  paymasterCalls: PaymasterCall[]
  setBalance: (address: Address, wei: bigint) => Promise<void>
  stop: () => Promise<void>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function rpcAnswers(url: string, method: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
    })
    return 'result' in ((await res.json()) as object)
  } catch {
    return false
  }
}

async function waitFor(label: string, url: string, method: string, child: ChildProcess, log: string[]) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`${label} exited (${child.exitCode}):\n${log.join('').slice(-2000)}`)
    if (await rpcAnswers(url, method)) return
    await sleep(250)
  }
  throw new Error(`${label} did not start:\n${log.join('').slice(-2000)}`)
}

function freePort(): number {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response() })
  const port = server.port!
  server.stop(true)
  return port
}

function startProcess(command: string, args: string[]): { child: ChildProcess; log: string[] } {
  const log: string[] = []
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (d) => log.push(String(d)))
  child.stderr?.on('data', (d) => log.push(String(d)))
  return { child, log }
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null) return
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(5000)])
  if (child.exitCode === null) child.kill('SIGKILL')
}

/** Throws with install instructions when anvil (Foundry) isn't on PATH. */
export function assertAnvilInstalled() {
  const probe = spawnSync('anvil', ['--version'], { encoding: 'utf8' })
  if (probe.status !== 0) {
    throw new Error(
      'These tests need anvil from Foundry (https://getfoundry.sh): curl -L https://foundry.paradigm.xyz | bash && foundryup',
    )
  }
}

/**
 * A local ERC-4337 stack with no network: anvil forked from OP Sepolia, whose upstream is a
 * replay of `opSepoliaFork.json`; Alto bundling for the canonical EntryPoint v0.6 and v0.8; and an
 * accept-all paymaster behind an ERC-7677 service. The fork has the real ManagedAccount factory,
 * EntryPoints and Simple7702Account at their OP Sepolia addresses.
 *
 * With `SEED_AA_STACK_RECORD=1` (and `SEED_LIVE_NETWORK_TESTS=1` to lift the network guard) the
 * fork reads OP Sepolia and rewrites the fixture. Record again after changing the pinned block or
 * when a test reaches state the fixture lacks; replay reports those reads in `misses`.
 */
export async function startAaStack(): Promise<AaStack & { forkMisses: string[] }> {
  assertAnvilInstalled()
  const record = process.env.SEED_AA_STACK_RECORD === '1'
  const upstream: RecordedRpc = startRecordedRpc({
    fixturePath: FIXTURE,
    mode: record ? 'record' : 'replay',
    upstream: UPSTREAM,
    forkBlock: AA_STACK_FORK_BLOCK,
  })

  const anvilPort = freePort()
  const rpcUrl = `http://127.0.0.1:${anvilPort}`
  const anvil = startProcess('anvil', [
    '--port', String(anvilPort),
    '--fork-url', upstream.url,
    '--fork-block-number', String(AA_STACK_FORK_BLOCK),
    '--fork-chain-id', String(optimismSepolia.id),
    '--no-storage-caching',
    '--silent',
  ])
  const children = [anvil.child]

  const stopAll = async () => {
    for (const child of children.reverse()) await stopProcess(child)
    await upstream.stop()
  }

  try {
    await waitFor('anvil', rpcUrl, 'eth_chainId', anvil.child, anvil.log)
    // Alto looks for a UserOp's receipt in logs from about 2,000 blocks back, which on a fresh fork
    // reaches blocks before it, at the upstream. Local blocks past that keep the search local.
    await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_mine', params: [toHex(4096)] }),
    })

    const altoPort = freePort()
    const altoUrl = `http://127.0.0.1:${altoPort}/rpc`
    const altoBin = join(dirname(createRequire(import.meta.url).resolve('@pimlico/alto/package.json')), 'esm/cli/alto.js')
    const alto = startProcess('node', [
      altoBin,
      '--rpc-url', rpcUrl,
      '--entrypoints', `${entryPoint06Address},${entryPoint08Address}`,
      '--executor-private-keys', BUNDLER_EXECUTOR_KEY,
      '--utility-private-key', BUNDLER_UTILITY_KEY,
      '--chain-type', 'op-stack',
      '--safe-mode', 'false',
      '--port', String(altoPort),
    ])
    children.push(alto.child)
    await waitFor('alto', altoUrl, 'eth_supportedEntryPoints', alto.child, alto.log)

    const publicClient = createPublicClient({ chain: optimismSepolia, transport: http(rpcUrl) })
    const deployer = createWalletClient({
      account: privateKeyToAccount(DEPLOYER_KEY),
      chain: optimismSepolia,
      transport: http(rpcUrl),
    })
    const deployHash = await deployer.deployContract({
      abi: [],
      bytecode: ACCEPT_ALL_PAYMASTER_BYTECODE,
    })
    const paymaster = (await publicClient.waitForTransactionReceipt({ hash: deployHash })).contractAddress!
    for (const entryPoint of [entryPoint06Address, entryPoint08Address]) {
      const hash = await deployer.writeContract({
        address: entryPoint,
        abi: parseAbi(['function depositTo(address account) payable']),
        functionName: 'depositTo',
        args: [paymaster],
        value: parseEther('10'),
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }

    const sentUserOps: Record<string, unknown>[] = []
    const gasEstimates: Record<string, unknown>[] = []
    const bundlerProxy = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        const body = (await request.json()) as { method?: string; params?: unknown[] }
        if (body.method === 'eth_sendUserOperation') sentUserOps.push(body.params![0] as Record<string, unknown>)
        const res = await fetch(altoUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const out = (await res.json()) as { result?: Record<string, unknown> }
        if (body.method === 'eth_estimateUserOperationGas' && out.result) gasEstimates.push(out.result)
        return Response.json(out)
      },
    })

    const paymasterCalls: PaymasterCall[] = []
    const paymasterService = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: async (request) => {
        const { id, method, params } = (await request.json()) as { id: unknown; method: string; params: unknown[] }
        const entryPoint = params[1] as Address
        paymasterCalls.push({ method, entryPoint })
        const result =
          entryPoint.toLowerCase() === entryPoint06Address.toLowerCase()
            ? { paymasterAndData: paymaster }
            : {
                paymaster,
                paymasterData: '0x',
                paymasterVerificationGasLimit: toHex(100_000),
                paymasterPostOpGasLimit: toHex(50_000),
              }
        return Response.json({ jsonrpc: '2.0', id, result })
      },
    })

    return {
      rpcUrl,
      bundlerUrl: `http://127.0.0.1:${bundlerProxy.port}`,
      paymasterUrl: `http://127.0.0.1:${paymasterService.port}`,
      paymaster,
      sentUserOps,
      gasEstimates,
      paymasterCalls,
      forkMisses: upstream.misses,
      setBalance: async (address, wei) => {
        await publicClient.request({
          method: 'anvil_setBalance' as never,
          params: [address, toHex(wei)] as never,
        })
      },
      stop: async () => {
        bundlerProxy.stop(true)
        paymasterService.stop(true)
        await stopAll()
      },
    }
  } catch (err) {
    await stopAll()
    throw err
  }
}
