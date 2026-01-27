// Core module barrel export
export { WhatsAppClient } from './client.js'
export { ConnectionManager } from './connection.js'
export { DecryptionHandler, getDecryptionHandler, resetDecryptionHandler } from './decryption-handler.js'

// Re-export everything from config for convenience
export { 
  baileysConfig,
  createBaileysSocket,  // ✅ Added this
  setupSocketDefaults,
  getBaileysConfig
} from './config.js'