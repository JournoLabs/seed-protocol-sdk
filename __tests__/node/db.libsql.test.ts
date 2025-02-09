import { describe, it, beforeAll, afterAll } from 'vitest'
import { drizzle } from 'drizzle-orm/libsql/node'
import appDbConfig from '../../src/db/configs/node.app.db.config'


describe('Drizzle ORM with better-sqlite3', () => {
  let db: ReturnType<typeof drizzle>

  beforeAll(() => {

    // console.log('appDbConfig', appDbConfig)

    // Set up the database connection
    // db = drizzle(appDbConfig);
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
