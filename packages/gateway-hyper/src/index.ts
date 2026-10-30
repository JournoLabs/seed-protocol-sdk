export { encodePublicKeyZ32, decodePublicKey, loadOrCreateOperatorKeypair } from './keys'

export { serveTunnel } from './tunnel/serve'
export { createAllowlist } from './tunnel/allowlist'
export { serveRawTunnel, DEFAULT_RAW_OPERATOR_KEY_FILE } from './tunnel/rawServe'
export {
  connectRawTunnel,
  DEFAULT_MAX_RAW_CONNECTIONS,
  DEFAULT_RAW_PORT,
} from './tunnel/rawConnect'
export { RAW_CLOSE_GRACE_MS } from './tunnel/rawPipe'
export { formatTunnelEvent } from './tunnel/events'
export type {
  RawClientEvent,
  RawClientEventListener,
  RawTunnelEvent,
  RawTunnelEventListener,
  TunnelEvent,
  TunnelEventListener,
  TunnelEventName,
  UpstreamPhase,
} from './tunnel/events'
export type {
  Allowlist,
  AllowlistOptions,
  AllowlistStream,
  AllowlistVerdict,
  AllowedBy,
} from './tunnel/allowlist'
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
export { DEFAULT_UPSTREAM_TIMEOUT_MS, upstreamRequestHeaders } from './tunnel/proxy'
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
  DhtBootstrapNode,
  TunnelMeta,
  TunnelResponseMeta,
  ServeTunnelOptions,
  ServeTunnelResult,
  ConnectTunnelOptions,
  ConnectTunnelResult,
  ServeRawTunnelOptions,
  ServeRawTunnelResult,
  ConnectRawTunnelOptions,
  ConnectRawTunnelResult,
  OperatorKeyPair,
  CreateGatewayProxyOptions,
  GatewayProxy,
} from './types'

export { DEFAULT_SEED_GATEWAY_HYPER_KEY } from './constants'
