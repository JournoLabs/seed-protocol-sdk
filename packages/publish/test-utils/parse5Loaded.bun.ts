// jsdom require()s parse5, which is ESM, and the SDK imports it. When a test file loads both,
// Bun can reach the require() while the ESM load of parse5 is still in progress and throw
// "require() async module ... is unsupported" (Release #125). Loading it here first means
// every later require() gets the finished module.
await import('parse5')
