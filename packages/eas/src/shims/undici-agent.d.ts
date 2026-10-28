// undici ships types for its index only. easDispatcher.ts imports the Agent module on its own
// (`module.exports = Agent`) so undici's index doesn't install a global dispatcher.
declare module 'undici/lib/dispatcher/agent.js' {
  import type { Agent } from 'undici'
  const AgentClass: typeof Agent
  export default AgentClass
}
