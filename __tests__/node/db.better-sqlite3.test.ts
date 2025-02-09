import { describe, it, beforeAll, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
// import Database from 'better-sqlite3'
// import path from 'path'
// import fsAsync from 'fs/promises'


describe('Drizzle ORM with better-sqlite3', () => {
  let db: ReturnType<typeof drizzle>

  beforeAll(async () => {

    // const workingDir = path.join('.working')
    //
    // const dbDir = path.join(workingDir, 'better-sqlite3')
    //
    // await fsAsync.rm(dbDir, { recursive: true, force: true })
    //
    // await fsAsync.mkdir(dbDir, { recursive: true })
    //
    // const dbPath = path.join(dbDir, 'app_db.sqlite3')
    //
    // const client = new Database(dbPath)
    // db = drizzle(client)
  })

  afterAll(() => {
    // Clean up the database connection
  })

  it('should connect to the database and create a table', async ({expect}) => {
    // expect(db).toBeDefined()
  })

  it('should insert and retrieve data', async ({expect}) => {
    // Insert data into the table

  })
}) 
