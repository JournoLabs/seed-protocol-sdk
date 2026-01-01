# Code Cleanup Analysis & Recommendations

## Executive Summary

The codebase has migrated from an eventBus-based architecture to XState actors/services for data management, but significant remnants of the old pattern remain. This analysis identifies dead code, commented-out handlers, and opportunities for refactoring to align with current patterns.

---

## 1. EventBus Usage Analysis

### Current Active Usage

The `eventBus` (eventEmitter) is still actively used in **28 files**, but many uses are legacy patterns that could be replaced with XState:

#### **Active Event Handlers:**
1. **`syncDbWithEas`** - `src/events/item/syncDbWithEas.ts` (line 634)
2. **`item.publish.request`** - `src/events/item/publish.ts` (uses XState internally)
3. **`item.publish.payload.request`** - `src/events/item/publish.ts`
4. **`inspect.globalService`** - `src/services/global/globalMachine.ts` (line 222) - Used for React dev tools
5. **`fs.downloadAll.request`** - `src/events/files/download.ts`
6. **`fs.downloadAllBinary.request`** - `src/events/files/download.ts`
7. **`fs.init`** - `src/client/actors/fileSystemInit.ts` (line 30)
8. **`service.saveState.request`** - `src/services/events.ts` (TODO: localStorage - commented out)
9. **`service.save`** - `src/events/services/index.ts`
10. **`file-saved`** - `src/browser/index.ts`, `src/ItemProperty/service/actors/saveValueToDb/saveImage.ts`
11. **`item.requestAll`** - Multiple files (legacy pattern)
12. **`item.request`** - `src/events/item/request.ts` (handler exists but not registered)
13. **`allDbsLoaded`** - `src/services/allItems/actors/initialize.ts` (line 193)

#### **React Hooks Using eventBus:**
- `src/browser/react/item.ts` - Listens to `item.requestAll` and `item.${modelName}.${seedId}.update`
- `src/browser/react/itemProperty.ts` - Listens to property update events
- `src/browser/react/services.ts` - Listens to `inspect.globalService` for dev tools
- `src/browser/react/trash.ts` - Emits `item.requestAll`

### Dead/Commented Code

#### **Commented Event Handlers in `src/events/item/index.ts`:**
```typescript
// eventEmitter.addListener('item.request', itemRequestHandler)  // Handler exists but not registered
// eventEmitter.addListener('item.requestAll', itemRequestAllHandler)  // Handler exists but not registered
// eventEmitter.addListener('item.propertyValuesForSeedUid.request', propertyValuesForSeedUid)
// eventEmitter.addListener('item.create.request', createItemRequestHandler)
// eventEmitter.addListener('item.delete.request', itemDeleteRequestHandler)
// eventEmitter.addListener('item.update', itemUpdateHandler)
```

#### **Commented Code in Other Files:**
- `src/ItemProperty/BaseItemProperty.ts` (lines 254, 257) - Property/item update events
- `src/Item/service/actors/hydrateExistingItem.ts` (lines 54-108) - Large block of commented eventBus code
- `src/services/global/globalMachine.ts` (lines 223-274) - Commented inspection event code
- `src/db/write/updateItemPropertyValue.ts` (line 16) - Commented item update event
- `src/events/item/create.ts` (line 40) - Commented `item.requestAll` emit

---

## 2. Recommendations for Code Deletion

### High Priority: Delete Dead Code

#### **A. Delete Unused Event Handlers**

**Files to delete or clean:**
1. **`src/events/item/request.ts`** - Handler exists but is never registered (commented out in `index.ts`)
2. **`src/events/item/requestAll.ts`** - Handler exists but is never registered (commented out in `index.ts`)
   - **Note:** This file is still imported/used in some places, but the handler registration is commented out
   - **Action:** Verify if `item.requestAll` events are still needed, or migrate to XState

#### **B. Remove Commented Code Blocks**

**Files to clean:**
1. **`src/Item/service/actors/hydrateExistingItem.ts`** - Remove lines 54-108 (large commented block)
2. **`src/services/global/globalMachine.ts`** - Remove lines 223-274 (commented inspection code)
3. **`src/ItemProperty/BaseItemProperty.ts`** - Remove lines 252-258 (commented event emits)
4. **`src/db/write/updateItemPropertyValue.ts`** - Remove line 16 (commented event emit)
5. **`src/events/item/create.ts`** - Remove line 40 (commented event emit)
6. **`src/events/item/index.ts`** - Remove commented handler registrations (lines 8-16, 24)

#### **C. Remove Unused Exports**

1. **`src/index.ts`** (lines 99-102) - Commented eventBus export
2. **`src/node/index.ts`** (line 40) - Consider if eventBus export is needed for external consumers

---

## 3. Recommendations for Refactoring

### High Priority: Migrate to XState Patterns

#### **A. Replace `item.requestAll` Pattern**

**Current:** React hooks listen to `item.requestAll` events and manually refresh data.

**Files affected:**
- `src/browser/react/item.ts` (lines 196-211)
- `src/browser/react/trash.ts` (line 17)
- `src/db/write/createNewItem.ts` (line 54)
- `src/services/allItems/actors/processItems.ts` (line 60)
- `src/events/item/syncDbWithEas.ts` (line 634)

**Recommendation:**
- Use XState actor subscriptions instead of eventBus
- Items should be managed through `allItemsService` context
- React hooks should subscribe to `allItemsService` snapshot changes
- Remove `item.requestAll` event emissions and listeners

#### **B. Replace Property Update Events**

**Current:** `src/browser/react/itemProperty.ts` listens to property update events.

**Files affected:**
- `src/browser/react/itemProperty.ts` (lines 98-109, 147-151)
- `src/ItemProperty/BaseItemProperty.ts` (commented emits at lines 254, 257)

**Recommendation:**
- Properties are already managed by XState `propertyMachine`
- React hooks should subscribe to property service snapshots directly
- Remove property update event listeners
- Remove commented event emits

#### **C. Replace `waitForEvent` Pattern**

**Current:** `waitForEvent` utility uses eventBus for request/response patterns.

**Files using `waitForEvent`:**
- `src/Item/service/actors/hydrateExistingItem.ts` (line 37)
- `src/Item/BaseItem.ts` (lines 315, 346)
- `src/services/internal/actors/configureFs.ts` (line 36)

**Recommendation:**
- Replace with XState `waitFor` or actor-to-actor communication
- Use XState's built-in event waiting mechanisms
- Consider using `sendTo` for actor communication

#### **D. File System Events**

**Current:** File system operations use eventBus (`fs.init`, `fs.downloadAll.request`, etc.)

**Files affected:**
- `src/events/files/index.ts`
- `src/events/files/download.ts`
- `src/client/actors/fileSystemInit.ts`

**Recommendation:**
- Create a `fileSystemMachine` XState actor
- Use actor events instead of eventBus
- This aligns with the XState architecture pattern

#### **E. Service State Saving**

**Current:** `service.saveState.request` event with commented localStorage code.

**Files affected:**
- `src/services/events.ts` (TODO comment at line 9)
- `src/services/allItems/itemMachineAll.ts` (line 40)

**Recommendation:**
- If state saving is needed, implement via XState persistence
- If not needed, remove the handler entirely
- Remove the TODO and commented localStorage code

---

## 4. Keep EventBus For (Temporary)

### Dev Tools / Inspection

**Keep for now:**
- `inspect.globalService` event in `src/services/global/globalMachine.ts`
- Used by `src/browser/react/services.ts` for React dev tools
- **Action:** Consider migrating to XState dev tools API when available

### File Saved Events

**Keep for now:**
- `file-saved` event in `src/browser/index.ts` and `src/ItemProperty/service/actors/saveValueToDb/saveImage.ts`
- Used for file system notifications
- **Action:** Migrate to fileSystemMachine when created

---

## 5. Code Organization Recommendations

### A. Consolidate Events Directory

**Current structure:**
```
src/events/
  - index.ts (waitForEvent utility)
  - item/ (item-related events)
  - files/ (file system events)
  - services/ (service events)
```

**Recommendation:**
- If keeping eventBus temporarily, keep structure
- If migrating fully to XState, consider:
  - Moving `waitForEvent` to `src/helpers/` or `src/client/`
  - Deprecating `src/events/` directory
  - Moving remaining handlers closer to their usage

### B. Separate Legacy Code

**Recommendation:**
- Create `src/legacy/` or `src/deprecated/` directory
- Move eventBus-dependent code there with deprecation warnings
- Add migration path documentation

---

## 6. Testing Considerations

Before deleting code:
1. **Verify test coverage** - Check if any tests rely on eventBus patterns
2. **Integration tests** - Ensure XState subscriptions work as replacements
3. **React hook tests** - Verify hooks work with XState subscriptions

---

## 7. Migration Priority

### Phase 1: Safe Deletions (Low Risk)
1. ✅ Remove all commented code blocks
2. ✅ Remove unused event handler files (`request.ts` if truly unused)
3. ✅ Clean up commented exports

### Phase 2: Pattern Migration (Medium Risk)
1. ⚠️ Migrate `item.requestAll` to XState subscriptions
2. ⚠️ Migrate property update events to XState subscriptions
3. ⚠️ Replace `waitForEvent` with XState patterns

### Phase 3: Architecture Cleanup (Higher Risk)
1. 🔴 Create `fileSystemMachine` and migrate file events
2. 🔴 Remove eventBus entirely (if possible)
3. 🔴 Update external API if eventBus is exported

---

## 8. Files Summary

### Files to Delete
- None (verify `src/events/item/request.ts` usage first)

### Files to Clean (Remove Comments)
- `src/Item/service/actors/hydrateExistingItem.ts`
- `src/services/global/globalMachine.ts`
- `src/ItemProperty/BaseItemProperty.ts`
- `src/db/write/updateItemPropertyValue.ts`
- `src/events/item/create.ts`
- `src/events/item/index.ts`
- `src/index.ts`

### Files to Refactor
- `src/browser/react/item.ts` - Migrate to XState subscriptions
- `src/browser/react/itemProperty.ts` - Migrate to XState subscriptions
- `src/browser/react/trash.ts` - Remove eventBus usage
- `src/db/write/createNewItem.ts` - Remove eventBus usage
- `src/services/allItems/actors/processItems.ts` - Remove eventBus usage
- `src/events/item/syncDbWithEas.ts` - Remove eventBus usage
- `src/Item/BaseItem.ts` - Replace `waitForEvent` calls
- `src/services/internal/actors/configureFs.ts` - Replace `waitForEvent` calls

### Files to Keep (Temporary)
- `src/eventBus.ts` - Keep until migration complete
- `src/events/index.ts` - Keep `waitForEvent` until replaced
- `src/events/files/` - Keep until `fileSystemMachine` created
- `src/services/events.ts` - Keep until state saving decision made

---

## 9. Estimated Impact

- **Lines of dead code to remove:** ~200-300 lines (commented code)
- **Files to refactor:** ~15 files
- **Breaking changes:** Low (mostly internal refactoring)
- **Migration effort:** Medium (requires careful testing of React hooks)

---

## 10. Next Steps

1. **Review this analysis** with the team
2. **Prioritize** which migrations to tackle first
3. **Create tickets** for each phase
4. **Start with Phase 1** (safe deletions)
5. **Test thoroughly** after each phase
6. **Document** new XState patterns for future development

