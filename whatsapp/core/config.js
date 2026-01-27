import { createComponentLogger } from '../../utils/logger.js'
const logger = createComponentLogger('CORE_CONFIG')

/**
 * Re-export everything from the main baileys config
 * This allows core modules to import from ./config.js instead of ../../config/baileys.js
 */
export {
  baileysConfig,
  createBaileysSocket,  // ✅ Added this
  setupSocketDefaults,
  getBaileysConfig
} from '../../config/baileys.js'

// No logging needed - this is just a re-export module