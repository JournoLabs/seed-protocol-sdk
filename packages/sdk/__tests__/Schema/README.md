# Schema Models Integration Tests

This directory contains comprehensive integration tests to debug why `schema.models` returns an empty array.

## Test Files

1. **`schema-models-integration.test.ts`** - Full integration test suite with multiple scenarios
2. **`debug-schema-models.ts`** - Standalone debug script for quick testing

## Running the Tests

### Option 1: Run the integration test suite
```bash
npm test -- __tests__/Schema/schema-models-integration.test.ts
```

### Option 2: Run the debug script
```bash
npx tsx __tests__/Schema/debug-schema-models.ts
```

## Test Scenarios

The tests cover:

1. **Loading from internal schema file** - Tests that models are loaded when importing the schema
2. **Loading from database schemaData** - Tests that models are loaded from stored schemaData when file doesn't exist
3. **Loading without schemaData** - Tests fallback to internal schema when schemaData is missing
4. **Model instances update** - Tests that modelInstances are updated when context changes

## What to Check

When running the tests, check:

1. **Database state**: Does `schemaData` contain models?
2. **Schema context**: Does `context.models` have the 4 models (Seed, Version, Metadata, Image)?
3. **Model instances**: Does `schema.models` return an array of 4 Model instances?
4. **Timing**: Are models populated immediately or after a delay?

## Debugging Tips

If models are still empty:

1. Check if `context.models` is populated in the schema machine context
2. Check if liveQuery is updating models automatically
3. Check if `liveQueryModelIds` is populated in instanceState
4. Check if Model instances are being retrieved from static cache
5. Check if the Proxy's `getContext` is returning the correct models array

## Expected Output

The debug script should show:
- ✓ Schema imported successfully
- ✓ Database has schemaData with models
- ✓ Context has 4 models
- ✓ schema.models returns array of 4 Model instances

