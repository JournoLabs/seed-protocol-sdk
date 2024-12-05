type SqliteDatabase = {
  open: (filename: string) => Promise<void>
  exec: (sql: string, params?: any[]) => any
  close: () => void
}

class SqliteConnectionManager {
  private sqliteModule: SqliteDatabase
  private idleTimeout: number
  private databases: { [key: string]: SqliteDatabase }
  private idleTimers: { [key: string]: NodeJS.Timeout }

  constructor(sqliteModule: SqliteDatabase, idleTimeout: number = 300000) {
    // Default idle timeout: 5 minutes
    this.sqliteModule = sqliteModule
    this.idleTimeout = idleTimeout
    this.databases = {}
    this.idleTimers = {}
  }

  private resetIdleTimer(dbName: string): void {
    if (this.idleTimers[dbName]) {
      clearTimeout(this.idleTimers[dbName])
    }

    this.idleTimers[dbName] = setTimeout(() => {
      this.closeConnection(dbName)
    }, this.idleTimeout)
  }

  private async getConnection(dbName: string): Promise<SqliteDatabase> {
    if (this.databases[dbName]) {
      this.resetIdleTimer(dbName)
      return this.databases[dbName]
    }

    const db = new this.sqliteModule()
    await db.open(dbName)
    this.databases[dbName] = db
    this.resetIdleTimer(dbName)
    return db
  }

  public async execute(
    dbName: string,
    sql: string,
    params: any[] = [],
  ): Promise<any> {
    const db = await this.getConnection(dbName)
    const result = db.exec(sql, params)
    this.resetIdleTimer(dbName)
    return result
  }

  public closeConnection(dbName: string): void {
    if (this.databases[dbName]) {
      this.databases[dbName].close()
      delete this.databases[dbName]
      if (this.idleTimers[dbName]) {
        clearTimeout(this.idleTimers[dbName])
        delete this.idleTimers[dbName]
      }
    }
  }
}

export { SqliteConnectionManager }
