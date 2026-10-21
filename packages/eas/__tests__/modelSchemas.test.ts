import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GraphQLClient } from 'graphql-request'
import { fetchEasModelSchemas, getEasModelSchemasForNames, matchEasModelSchemas } from '../src/modelSchemas.js'
import { BaseEasClient } from '../src/EasClient/BaseEasClient.js'
import { BaseQueryClient } from '../src/QueryClient/BaseQueryClient.js'
import type { IQueryClient } from '../src/QueryClient/IQueryClient.js'

const uid = (c: string) => `0x${c.repeat(32)}`

let schemas: Array<{ id: string; schema: string }> = []
const request = vi.fn(async () => ({ schemas }))

beforeEach(() => {
  schemas = []
  request.mockClear()
  const queryClient: IQueryClient = {
    fetchQuery: ({ queryFn }) => queryFn(),
    getQueryData: () => undefined,
    removeQueries: async () => {},
  }
  BaseQueryClient.configure({ getQueryClient: () => queryClient } as never)
  BaseEasClient.configure({ getEasClient: () => ({ request }) as unknown as GraphQLClient } as never)
})

describe('fetchEasModelSchemas', () => {
  it("asks for the names each model can match at its level, in one request", async () => {
    await fetchEasModelSchemas([
      { name: 'BlogPost', level: 'exact' },
      { name: 'HTMLPage', level: 'normalized' },
    ])
    expect(request).toHaveBeenCalledTimes(1)
    const variables = request.mock.calls[0]?.[1] as unknown as { where: { schema: { in: string[] } } }
    expect(variables.where.schema.in).toContain('bytes32 blog_post')
    expect(variables.where.schema.in).not.toContain('bytes32 blogpost')
    expect(variables.where.schema.in).toEqual(expect.arrayContaining(['bytes32 html_page', 'bytes32 htmlpage']))
  })

  it('sends no request without names', async () => {
    expect(await fetchEasModelSchemas([])).toEqual([])
    expect(request).not.toHaveBeenCalled()
  })
})

describe('matchEasModelSchemas', () => {
  it('matches each schema to the model it names, with its tier', () => {
    const matches = matchEasModelSchemas(
      [
        { id: uid('a'), schema: 'bytes32 blog_post' },
        { id: uid('b'), schema: 'bytes32 blogpost' },
        { id: uid('c'), schema: 'bytes32 unrelated' },
        { id: uid('d'), schema: 'string blog_post' },
      ] as never,
      [{ name: 'Blog Post' }],
    )
    expect(matches.map((m) => [m.schema.id, m.modelName, m.tier])).toEqual([
      [uid('a'), 'Blog Post', 'exact'],
      [uid('b'), 'Blog Post', 'normalized'],
    ])
  })

  it("drops a looser match than the model's level allows", () => {
    const matches = matchEasModelSchemas([{ id: uid('b'), schema: 'bytes32 blogpost' }] as never, [
      { name: 'BlogPost', level: 'exact' },
    ])
    expect(matches).toEqual([])
  })

  it('takes the tighter level when a name is given twice', async () => {
    schemas = [{ id: uid('b'), schema: 'bytes32 blogpost' }]
    expect(
      await getEasModelSchemasForNames([
        { name: 'BlogPost', level: 'fuzzy' },
        { name: 'BlogPost', level: 'exact' },
      ]),
    ).toEqual([])
  })
})
