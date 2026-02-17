import { ClientManager } from './ClientManager'

// Export singleton client instance
// ES modules cache exports, ensuring all imports across different files
// in external projects get the same ClientManager instance
export { ClientManager as client }
