# Circular Dependencies Analysis

## Overview
The build process identified 4 circular dependency cycles that need to be resolved.

---

## Cycle 1: Global → Publish → Item → Events → Global
**Path:** 
```
globalMachine.ts → publishMachine.ts → preparePublishRequestData.ts → BaseItem.ts → 
itemMachineSingle.ts → hydrateExistingItem.ts → events/index.ts → events/item/index.ts → 
events/item/publish.ts → globalMachine.ts
```

### Root Cause
- `events/item/publish.ts` imports `getGlobalService` from `globalMachine.ts`
- `globalMachine.ts` imports `publishMachine` which eventually leads back to events

### Solution
**Break the cycle by using dependency injection or event-based communication:**

1. **Option A (Recommended):** Move `publishItemRequestHandler` to a separate file that doesn't import from `globalMachine.ts` directly. Use the event bus pattern that's already in place.

2. **Option B:** Create a `services/global/getGlobalService.ts` file that exports `getGlobalService` without importing the machine itself. The machine can register itself.

3. **Option C:** Use a lazy import pattern in `events/item/publish.ts`:
   ```typescript
   const getGlobalService = () => {
     return (await import('@/services/global/globalMachine')).getGlobalService()
   }
   ```

**Recommended Fix:** Option A - Refactor `publishItemRequestHandler` to use only the event bus, removing the direct import of `getGlobalService`.

---

## Cycle 2: BaseItem ↔ getPublishUploads
**Path:**
```
BaseItem.ts → getPublishUploads.ts → BaseItem.ts
```

### Root Cause
- `BaseItem.ts` imports `getPublishUploads` (line 28)
- `getPublishUploads.ts` imports `BaseItem` (line 9) to call `BaseItem.find()`

### Solution
**Extract the dependency:**

1. **Option A (Recommended):** Move `getPublishUploads` to be a method on `BaseItem` class, making it an instance method instead of a static utility.

2. **Option B:** Create a separate `ItemPublishHelpers.ts` file that takes an `IItem` interface instead of `BaseItem`, breaking the concrete dependency.

3. **Option C:** Use dynamic import in `BaseItem.ts`:
   ```typescript
   getPublishUploads = async () => {
     const { getPublishUploads } = await import('@/db/read/getPublishUploads')
     return await getPublishUploads(this)
   }
   ```

**Recommended Fix:** Option C - Use dynamic import since `getPublishUploads` is already called as an instance method.

---

## Cycle 3: BaseItem → getPublishPayload → getItem → BaseItem
**Path:**
```
BaseItem.ts → getPublishPayload.ts → getItem.ts → BaseItem.ts
```

### Root Cause
- `BaseItem.ts` imports `getPublishPayload` (line 29)
- `getPublishPayload.ts` imports `getItem` (line 1) to fetch related items
- `getItem.ts` imports `BaseItem` (line 3) to create instances

### Solution
**Break the cycle at the getItem level:**

1. **Option A (Recommended):** Make `getItem` accept a factory function or use the `IItem` interface instead of `BaseItem` directly. However, since `getItem` needs to create instances, this is tricky.

2. **Option B:** Use dynamic import in `getPublishPayload.ts`:
   ```typescript
   const getItem = async (props) => {
     const { getItem } = await import('@/db/read/getItem')
     return await getItem(props)
   }
   ```

3. **Option C:** Extract item creation logic to a separate factory file that both `getItem` and `BaseItem` can use.

**Recommended Fix:** Option B - Use dynamic import in `getPublishPayload.ts` for `getItem`.

---

## Cycle 4: Global → Internal → Events/Files → Global
**Path:**
```
globalMachine.ts → internalMachine.ts → configureFs.ts → events/files/index.ts → 
events/files/download.ts → globalMachine.ts
```

### Root Cause
- `events/files/download.ts` imports `getGlobalService` from `globalMachine.ts` (line 12)
- `globalMachine.ts` imports `internalMachine` which eventually leads to events/files

### Solution
**Break the cycle by removing direct dependency:**

1. **Option A (Recommended):** Refactor `downloadAllFilesBinaryRequestHandler` to not directly import `getGlobalService`. Instead, pass the service as a parameter or use the event bus.

2. **Option B:** Use dynamic import in `events/files/download.ts`:
   ```typescript
   const getGlobalService = async () => {
     return (await import('@/services/global/globalMachine')).getGlobalService()
   }
   ```

3. **Option C:** Create a service registry pattern where services register themselves without circular imports.

**Recommended Fix:** Option B - Use dynamic import for `getGlobalService` in `events/files/download.ts`.

---

## Implementation Priority

1. **High Priority:** Cycles 1 and 4 (both involve `globalMachine.ts` and events)
2. **Medium Priority:** Cycle 2 (`BaseItem` ↔ `getPublishUploads`)
3. **Medium Priority:** Cycle 3 (`BaseItem` → `getPublishPayload` → `getItem`)

## General Strategy

The recommended approach is to use **dynamic imports** for cases where:
- The import is only needed at runtime (not for type checking)
- The circular dependency is between modules that don't need each other at module initialization time

For cases where the dependency is structural (like `BaseItem` needing `getPublishUploads`), consider:
- Moving functionality into the class as methods
- Using interfaces to break concrete dependencies
- Dependency injection patterns

