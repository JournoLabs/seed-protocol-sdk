# Schema Test Timeout Analysis

## Summary

The `schema.test.tsx` tests have several characteristics that can cause timeouts:

- **Config**: `testTimeout: 30000` (30s), `hookTimeout: 60000` (60s)
- **25+ tests** with heavy `beforeEach` setup
- **Multiple sequential `waitFor`** calls in individual tests

## Likely Timeout Sources

### 1. Heavy `beforeEach` (runs before every test)

Each of the 25+ tests triggers:

- DB deletes for 6 schema names
- Schema file cleanup (3 files)
- `Schema.clearCache()`
- `importJsonSchema` for 2 schemas
- `waitFor(loadAllSchemasFromDb)` with **15s timeout**
- 100ms delay

**Impact**: If `loadAllSchemasFromDb` is slow (OPFS/IndexedDB in browser), setup alone can approach 15s per test. 25 tests × 15s ≈ 375s worst case.

### 2. Test: "should load schema by name" (lines 446–502)

- `waitFor` status `'loaded'` (10s)
- `waitFor` `modelsCount > 0` (30s)

Models come from `liveQuery` updating `Schema.models`. If:

- Schema machine never reaches `idle`, or
- `liveQuery` never populates models,

the second `waitFor` can hit the 30s timeout.

### 3. Test: "should automatically update when a new schema is created" (lines 697–834)

- Initial load: 20s
- 300ms + 100ms delays
- Schema import
- `waitFor` count increase: 15s

Total: ~35s+ of waits in one test.

### 4. Test: "should display empty models list initially and show new model after creation" (lines 957–1065)

- Multiple `waitFor` calls: 10s + 10s + 15s + 5s + 15s ≈ 55s
- Plus 200ms delay

### 5. `useSchemas` and `Schema.all({ waitForReady: true })`

- `Schema.all` uses `readyTimeout: 5000` per schema
- If a schema never reaches `idle`, `waitForEntityIdle` times out
- In browser, schema loading can be slower than in Node

### 6. `beforeAll` client init

- `client.init()` + `waitFor(client.isInitialized)` with 30s timeout
- If client never reaches idle (e.g. DB init issues), this can time out

## Recommendations

1. **Increase timeouts for schema tests**  
   Add per-file overrides in `vite.config.js` or use `describe.configure()` in the test file.

2. **Reduce `beforeEach` work**  
   - Import schemas once in `beforeAll` instead of per test  
   - Or only re-import when a test mutates schemas

3. **Relax or isolate the models wait**  
   For "should load schema by name", consider:
   - Increasing the models `waitFor` timeout
   - Or making the models assertion optional if the main behavior (schema load) is verified

4. **Run a single test to pinpoint the failure**  
   Use `it.only('should load schema by name', ...)` to see if that test alone times out.

5. **Increase `Schema.all` `readyTimeout` in tests**  
   Pass a larger `readyTimeout` when calling `Schema.all` in test-related code paths.
