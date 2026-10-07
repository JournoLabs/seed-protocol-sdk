# Script Tests

Tests for the SDK's Node-side database and script helpers.

## Test Files

### `database.test.ts` - Database Operation Tests
**Would have caught**: Database constructor error

**Tests include**:
- Validates correct Database constructor syntax
- Tests database connection error handling
- Validates seeding operations with various data types
- Tests file operations and permissions

**How it would have caught the issue**:
The test `should use correct Database constructor syntax` would have failed when the code tried to use `new Database(dbPath)` instead of `new Database.default(dbPath)`.

## Running the Tests

```bash
# From the repo root
npx vitest run --project=NodeJS packages/sdk/__tests__/scripts/
```
