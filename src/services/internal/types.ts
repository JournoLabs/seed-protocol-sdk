type SqliteWasmResult = {
  type: string | null
  row: string[] | null
  rowNumber: number | null
  columnNames: string[]
}
type SqliteWasmCallback = (result: SqliteWasmResult) => void

type ReturnObj = {
  database: string
  [key: string]: string | number | null | undefined | string[]
}
