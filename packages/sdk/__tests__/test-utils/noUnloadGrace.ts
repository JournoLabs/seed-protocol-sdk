// Test setup: an instance's last release tears it down at once, as tests that check `unload()`
// expect. Tests of the grace period configure their own (client.init's entityCache.unloadGraceMs).
import { setDefaultEntityUnloadGraceMs } from '../../src/helpers/entity/entityCache'

setDefaultEntityUnloadGraceMs(0)
