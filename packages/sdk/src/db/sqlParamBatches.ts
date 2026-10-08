import { getTableColumns, type Table } from 'drizzle-orm'

/**
 * SQLite builds before 3.32 (and builds that keep the old default) allow at most 999 bound
 * parameters per statement (SQLITE_MAX_VARIABLE_NUMBER). sqlite-wasm and libsql allow 32766, but a
 * statement that binds one parameter per synced item still has to stay under 999 to work everywhere.
 */
export const SQLITE_DEFAULT_MAX_VARIABLE_NUMBER = 999

/**
 * Values per `IN (...)` list. Leaves room under {@link SQLITE_DEFAULT_MAX_VARIABLE_NUMBER} for the
 * statement's other parameters (a second list, `SET` values, other conditions).
 */
export const IN_LIST_BATCH = 400

/**
 * Rows per multi-row INSERT into `table` so the statement binds at most
 * {@link SQLITE_DEFAULT_MAX_VARIABLE_NUMBER} parameters even with every column set.
 */
export const rowsPerInsert = (table: Table): number =>
  Math.max(
    1,
    Math.floor(SQLITE_DEFAULT_MAX_VARIABLE_NUMBER / Object.keys(getTableColumns(table)).length),
  )

/** Splits `values` into chunks of at most `size` (one empty list gives no chunks). */
export const chunkValues = <T>(values: readonly T[], size: number = IN_LIST_BATCH): T[][] => {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`chunkValues: size must be a positive integer, got ${size}`)
  }
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size))
  }
  return chunks
}

/**
 * Runs `query` once per chunk of `values` (see {@link chunkValues}), one after another, and
 * concatenates the rows. Use it for `inArray(column, values)` reads whose list can be large.
 */
export const selectInBatches = async <T, R>(
  values: readonly T[],
  query: (chunk: T[]) => Promise<R[]>,
  size: number = IN_LIST_BATCH,
): Promise<R[]> => {
  const rows: R[] = []
  for (const chunk of chunkValues(values, size)) {
    rows.push(...(await query(chunk)))
  }
  return rows
}

/** Runs `write` once per chunk of `values`, one after another (deletes / updates with an `IN` list). */
export const writeInBatches = async <T>(
  values: readonly T[],
  write: (chunk: T[]) => Promise<unknown>,
  size: number = IN_LIST_BATCH,
): Promise<void> => {
  for (const chunk of chunkValues(values, size)) {
    await write(chunk)
  }
}
