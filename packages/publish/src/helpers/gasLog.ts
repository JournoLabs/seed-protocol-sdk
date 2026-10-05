/**
 * Console logging for UserOp gas limits, to tell whether a gas problem starts in our code or in
 * thirdweb. Filter the console on `[seed:gas]`. Bigints print as decimal strings.
 */
export function logGas(stage: string, data: Record<string, unknown>): void {
  const printable = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]),
  )
  console.info(`[seed:gas] ${stage}`, printable)
}

/** The gas fields of a UserOp (or paymaster result), with `paymasterAndData` shortened. */
export function gasFields(op: Record<string, any>): Record<string, unknown> {
  const pad = op.paymasterAndData as string | undefined
  return {
    callGasLimit: op.callGasLimit,
    verificationGasLimit: op.verificationGasLimit,
    preVerificationGas: op.preVerificationGas,
    ...(pad !== undefined ? { paymasterAndData: pad.length > 20 ? `${pad.slice(0, 20)}… (${(pad.length - 2) / 2} bytes)` : pad } : {}),
  }
}
