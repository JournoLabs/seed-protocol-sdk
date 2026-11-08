/** An error and its causes, outermost first, at most 8. */
export const errorChain = (err: unknown): unknown[] => {
  const chain: unknown[] = []
  for (let cur = err; cur && chain.length < 8; cur = (cur as { cause?: unknown }).cause) chain.push(cur)
  return chain
}
