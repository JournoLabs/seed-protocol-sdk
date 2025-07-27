# Script Tests

This directory contains comprehensive tests that would have caught the issues we encountered during development.

## Test Files

### 1. `codegen.test.ts` - Code Generation Tests
**Would have caught**: Missing `tagSchema` module error

**Tests include**:
- Validates that code generation doesn't create imports for non-existent schema files
- Ensures List properties with primitive types don't generate invalid imports
- Validates that generated schema files are valid TypeScript

**How it would have caught the issue**:
The test `should not generate imports for non-existent schema files` would have failed when the header template tried to import `./tagSchema` for a List property referencing a non-existent "Tag" model.

### 2. `database.test.ts` - Database Operation Tests
**Would have caught**: Database constructor error

**Tests include**:
- Validates correct Database constructor syntax
- Tests database connection error handling
- Validates seeding operations with various data types
- Tests file operations and permissions

**How it would have caught the issue**:
The test `should use correct Database constructor syntax` would have failed when the code tried to use `new Database(dbPath)` instead of `new Database.default(dbPath)`.

### 3. `config-validation.test.ts` - Configuration Validation Tests
**Would have caught**: Incorrect paths in config files

**Tests include**:
- Validates that config files have correct paths (not `.seed/app/schema`)
- Ensures build configuration copies files to correct locations
- Validates path resolution in production environment
- Checks that built config files have correct content

**How it would have caught the issue**:
The tests `should validate node.app.db.config.ts has correct paths` and `should validate browser.app.db.config.ts has correct paths` would have failed when the config files contained `.seed/app/schema` instead of `.seed/schema`.

### 4. `integration.test.ts` - End-to-End Integration Tests
**Would have caught**: All issues in real-world scenarios

**Tests include**:
- Full `seed init` command execution
- Schema file generation validation
- Database creation and seeding
- Build process validation
- Production environment path resolution

**How it would have caught the issues**:
- `should complete without module resolution errors` would have caught the tagSchema import error
- `should seed database without constructor errors` would have caught the Database constructor error
- `should create valid database configuration` would have caught the path issues

## Running the Tests

```bash
# Run all script tests
npm test -- __tests__/scripts/

# Run specific test file
npm test -- __tests__/scripts/codegen.test.ts
npm test -- __tests__/scripts/database.test.ts
npm test -- __tests__/scripts/config-validation.test.ts
npm test -- __tests__/scripts/integration.test.ts
```

## Test Categories

### Unit Tests
- **Code Generation**: Tests the schema generation logic in isolation
- **Database Operations**: Tests database constructor and seeding logic
- **Configuration Validation**: Tests config file content and build process

### Integration Tests
- **End-to-End**: Tests the complete `seed init` workflow
- **Build Process**: Tests that the build process works correctly
- **Production Environment**: Tests path resolution in production scenarios

## Prevention Strategy

These tests implement a multi-layered approach to catch issues:

1. **Static Analysis**: Configuration validation tests check file content
2. **Unit Testing**: Individual components are tested in isolation
3. **Integration Testing**: Full workflows are tested end-to-end
4. **Build Validation**: Ensures the build process works correctly

By running these tests as part of the CI/CD pipeline, we can catch these types of issues before they reach production. 