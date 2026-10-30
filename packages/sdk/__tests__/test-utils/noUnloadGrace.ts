// Test setup (all three projects): an instance's last release tears it down at once. Production
// waits 60 s (DEFAULT_UNLOAD_GRACE_MS, SeedConfig.entityCache.unloadGraceMs). Without this, 61
// tests in 28 files that check what `unload()` tears down fail (measured 2026-10-24). Tests of the
// grace period set their own (setEntityUnloadGraceMs), and entityCacheGrace.test.ts runs the
// default with nothing configured.
import { setDefaultEntityUnloadGraceMs } from '../../src/helpers/entity/entityCache'

setDefaultEntityUnloadGraceMs(0)
