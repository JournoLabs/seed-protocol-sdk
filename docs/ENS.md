# ENS names

`@seedprotocol/query/ens` reads ENS names: a name's contenthash, the Seed publication it points
at, and primary names for attester addresses. It is read-only; setting records needs a wallet and
is not in the SDK yet. [ADR 0032](adr/0032-ens-reads-live-in-query.md) records why it lives in
query.

Every function takes a viem client on the chain that holds the ENS registry, usually mainnet.
Seeds can be attested on another chain; the client here is only for ENS.

```ts
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { getSeedPublication } from '@seedprotocol/query/ens'
import { queryBySchema } from '@seedprotocol/query'

const ens = createPublicClient({ chain: mainnet, transport: http(RPC_URL) })

const pub = await getSeedPublication(ens, { name: 'alice.eth' })
if (pub) {
  const { items } = await queryBySchema(pub.schemaName, { attesters: [pub.publisher] })
}
```

Names go through UTS-46 normalization (viem's `normalize`) before lookup, so `Alice.ETH` and
`alice.eth` resolve the same. Lookups go through the ENS Universal Resolver, which handles
wildcard names (ENSIP-10) and offchain resolvers (CCIP-Read, EIP-3668). Pass `gatewayUrls` or
`universalResolverAddress` to override viem's defaults.

## The publication record

A name points at a Seed publication with the ENSIP-5 text record `io.seedprotocol.publication`
(exported as `SEED_PUBLICATION_TEXT_KEY`). Its value is a JSON object:

```json
{
  "schema": "Blog",
  "publisher": "0x2222222222222222222222222222222222222222",
  "feed": "https://alice.example/feed.xml",
  "chainId": 11155420
}
```

| Key | Required | Meaning |
|-----|----------|---------|
| `schema` | yes | Schema name the Seeds are listed under; becomes `schemaName`. |
| `publisher` | no | Attester of the Seeds. Absent: the name's ETH address. |
| `feed` | no | Absolute URL of a feed, for readers that don't query EAS; becomes `feedUrl`. |
| `chainId` | no | Chain the Seeds are attested on. |

Other keys are ignored. Set it in the ENS manager app or any tool that writes text records.

`getSeedPublication(client, { name })` reads the record and the contenthash in parallel. It
returns `null` when the name has no record, and throws when the record isn't valid JSON of the
shape above or when there is neither a `publisher` nor an ETH address for the name.
`parseSeedPublicationRecord(text)` parses a record you have already fetched.

The returned `publisher` is lower case. `contenthash` is the decoded contenthash, or `null`.

## Contenthash

`getEnsContenthash(client, { name })` returns the decoded EIP-1577 contenthash, or `null` when the
name has no resolver or no contenthash. `decodeContenthash(hexOrBytes)` decodes one you already
have.

| Codec | `protocol` | `value` | `uri` |
|-------|-----------|---------|-------|
| `0xe3` | `ipfs` | CIDv1, base32 (a CIDv0 record is converted) | `ipfs://bafy…` |
| `0xe5` | `ipns` | IPNS key as a base36 CID, or the domain for a DNSLink record | `ipns://k51…` |
| `0xe4` | `swarm` | 32-byte hash, hex | `bzz://…` |
| `0xb29910` | `arweave` | Arweave id, base64url | `ar://…` |

Any other codec throws a `TypeError`, as does a content id that isn't a CID.

## Attester names

`getEnsNames(client, addresses)` returns a `Map` from each address (lower case) to its primary
name, or `null` when it has none. The Universal Resolver only returns a name whose forward
address matches, so a name someone set as a reverse record for an address they don't control
isn't returned. Duplicate addresses are looked up once; entries that aren't 20-byte hex are
skipped.

```ts
const names = await getEnsNames(ens, items.flatMap((item) => item.attester ?? []))
```

`queryBySchema({ attesters })` takes addresses only. To filter by name, resolve it first with
viem's `getEnsAddress`.
