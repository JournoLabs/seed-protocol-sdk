export { encodePublicKeyZ32, decodePublicKey, loadOrCreateOperatorKeypair } from './keys'

export { serveTunnel } from './tunnel/serve'
export { connectTunnel, localGatewayUrl } from './tunnel/connect'
export { createGatewayProxy } from './tunnel/proxyApp'
export { stripMountPath } from './tunnel/mountPath'
export {
  createTunnelSession,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_MAX_STREAMS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './tunnel/session'
export type { TunnelRequestOptions, TunnelSession, TunnelSessionOptions } from './tunnel/session'
export { DEFAULT_UPSTREAM_TIMEOUT_MS } from './tunnel/proxy'
export {
  TunnelConnectTimeoutError,
  TunnelTimeoutError,
  UpstreamTimeoutError,
} from './tunnel/errors'

export {
  writeFrame,
  readFrame,
  writeTunnelRequest,
  readTunnelRequest,
  writeTunnelResponse,
  readTunnelResponse,
  flattenRequestHeaders,
  filterResponseHeaders,
  MAX_FRAME_BYTES,
} from './tunnel/protocol'

export type {
  TunnelMeta,
  TunnelResponseMeta,
  ServeTunnelOptions,
  ServeTunnelResult,
  ConnectTunnelOptions,
  ConnectTunnelResult,
  OperatorKeyPair,
  CreateGatewayProxyOptions,
  GatewayProxy,
} from './types'

export { DEFAULT_SEED_GATEWAY_HYPER_KEY } from './constants'
