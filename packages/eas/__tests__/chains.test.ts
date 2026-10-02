import { describe, expect, it } from 'vitest'
import {
  EAS_CHAIN_DEPLOYMENTS,
  OP_STACK_EAS_CONTRACT_ADDRESS,
  getEasAttestationExplorerUrl,
  resolveEasChainDeployment,
} from '../src/chains'

describe('EAS chain deployments', () => {
  it('keys every deployment by its own chain id', () => {
    for (const [id, deployment] of Object.entries(EAS_CHAIN_DEPLOYMENTS)) {
      expect(deployment.chainId).toBe(Number(id))
    }
  })

  it('resolves OP Stack predeploys for Optimism Sepolia', () => {
    const d = resolveEasChainDeployment(11155420)
    expect(d.easContractAddress).toBe(OP_STACK_EAS_CONTRACT_ADDRESS)
    expect(d.indexerUrl).toBe('https://optimism-sepolia.easscan.org/graphql')
  })

  it('resolves non-OP addresses for Sepolia', () => {
    const d = resolveEasChainDeployment(11155111)
    expect(d.easContractAddress).toBe('0xC2679fBD37d54388Ce493F1DB75320D236e1815e')
    expect(d.schemaRegistryAddress).toBe('0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0')
  })

  it('applies overrides and ignores undefined ones', () => {
    const d = resolveEasChainDeployment(8453, {
      easContractAddress: '0x0000000000000000000000000000000000000001',
      schemaRegistryAddress: undefined,
    })
    expect(d.easContractAddress).toBe('0x0000000000000000000000000000000000000001')
    expect(d.schemaRegistryAddress).toBe(EAS_CHAIN_DEPLOYMENTS[8453]!.schemaRegistryAddress)
  })

  it('throws for unknown chains without addresses, accepts them with addresses', () => {
    expect(() => resolveEasChainDeployment(999_999)).toThrow(/No known EAS deployment/)
    const d = resolveEasChainDeployment(999_999, {
      easContractAddress: '0x0000000000000000000000000000000000000001',
      schemaRegistryAddress: '0x0000000000000000000000000000000000000002',
    })
    expect(d.name).toBe('chain 999999')
    expect(d.indexerUrl).toBeUndefined()
  })

  it('builds explorer attestation URLs', () => {
    expect(getEasAttestationExplorerUrl({ explorerUrl: 'https://base.easscan.org/' }, '0xabc')).toBe(
      'https://base.easscan.org/attestation/view/0xabc',
    )
    expect(getEasAttestationExplorerUrl({}, '0xabc')).toBeUndefined()
  })
})
