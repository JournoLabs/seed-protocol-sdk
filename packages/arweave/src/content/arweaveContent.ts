/**
 * Read-side seam for Arweave content: every place the SDK packages read an upload's bytes from a
 * gateway passes them through {@link transformArweaveContent} before using them. Today nothing is
 * registered and content is used as fetched (public publishing). A future private-publish option
 * would register a transform here (e.g. decrypt using keys from the client config) instead of
 * patching each reader.
 *
 * Readers routed through it:
 * - {@link fetchArweaveRawTextAcrossGateways} (`readBaseUrls.ts`): the SDK's Html storage-seed
 *   fallback (`readHtmlBodyForStorageSeed`) and other text reads.
 * - `BaseArweaveClient.getTransactionData` (every platform client; `decode: false` reads are left
 *   alone, they are not content bytes).
 * - `@seedprotocol/query`'s `hydrateArweaveRichTextInItems` (also re-exported by `@seedprotocol/feed`).
 *
 * Not routed (they cannot be, as things stand):
 * - The SDK's OPFS download worker runs from a string and cannot import this module; it has its own
 *   `transformDownloadedContent` hook.
 * - Places that hand a gateway URL straight to the browser (`SeedImage` / `useEnsureLocalImage`'s
 *   progressive `gatewayHref`, `mediaRef` hrefs, feed image URLs). Encrypted content would need
 *   those to fetch, transform and use a blob URL instead.
 */

export type ArweaveContent = {
  bytes: Uint8Array
  /** Media type without parameters, lowercased (from the response, i.e. the upload's Content-Type tag). */
  contentType?: string
}

export type ArweaveContentReadContext = {
  transactionId: string
}

/** @experimental Signature may change when private publishing lands. */
export type ArweaveContentReadTransform = (
  content: ArweaveContent,
  context: ArweaveContentReadContext,
) => ArweaveContent | Promise<ArweaveContent>

let readTransform: ArweaveContentReadTransform | undefined

/**
 * Register (or clear, with `undefined`) the transform applied to Arweave content after it is
 * fetched. @experimental Groundwork for private publishing; nothing in the SDK registers one yet.
 */
export function setArweaveContentReadTransform(transform: ArweaveContentReadTransform | undefined): void {
  readTransform = transform
}

/** True when a read transform is registered. Lets readers skip work on the common, public path. */
export function hasArweaveContentReadTransform(): boolean {
  return readTransform !== undefined
}

/** Content as the app should see it: the registered transform's result, or `content` unchanged. */
export async function transformArweaveContent(
  content: ArweaveContent,
  context: ArweaveContentReadContext,
): Promise<ArweaveContent> {
  return readTransform ? readTransform(content, context) : content
}

/** `Content-Type` header without parameters, lowercased; undefined when absent. */
export function getResponseMediaType(response: Response): string | undefined {
  const raw = response.headers?.get('content-type')
  const mediaType = raw?.split(';')[0]?.trim().toLowerCase()
  return mediaType || undefined
}

/** Read a gateway response's body through {@link transformArweaveContent}. */
export async function readArweaveContentResponse(
  response: Response,
  context: ArweaveContentReadContext,
): Promise<ArweaveContent> {
  const bytes = new Uint8Array(await response.arrayBuffer())
  return transformArweaveContent({ bytes, contentType: getResponseMediaType(response) }, context)
}
