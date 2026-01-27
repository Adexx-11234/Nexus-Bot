/**
 * WhatsApp Module - Main Entry Point
 * Organized, clean, and efficient WhatsApp bot implementation
 */

// ============================================================================
// CORE - Socket, Connection, Configuration
// ============================================================================


// ============================================================================
// SESSIONS - Session Management
// ============================================================================
export {
  getSessionManager
} from './sessions/index.js'


// ============================================================================
// VERSION & INFO
// ============================================================================
export const VERSION = '2.0.0'
export const MODULE_NAME = 'WhatsApp Bot Platform'

/**
 * Get module information
 */
export function getModuleInfo() {
  return {
    name: MODULE_NAME,
    version: VERSION,
    folders: [
      'core',
      'sessions',
      'storage',
      'events',
      'messages',
      'groups',
      'contacts',
      'utils',
      'handlers'
    ],
    description: 'Organized, efficient, and maintainable WhatsApp bot implementation'
  }
}

/**
 * Initialize WhatsApp module (convenience function)
 */
export async function initializeWhatsAppModule(telegramBot = null, options = {}) {
  const {
    sessionDir = './sessions',
    enableEventHandlers = true,
    initializeSessions = true
  } = options

  // Use the singleton pattern from sessions/index.js
  const { initializeSessionManager } = await import('./sessions/index.js')
  const sessionManager = await initializeSessionManager(telegramBot, sessionDir)
  
  // Initialize the session manager components
  await sessionManager.initialize()

  // Initialize existing sessions if requested
  if (initializeSessions) {
    const result = await sessionManager.initializeExistingSessions()
    console.log(`[WhatsApp] Initialized ${result.initialized}/${result.total} sessions`)
  }

  // Enable event handlers if requested
  if (enableEventHandlers) {
    sessionManager.enableEventHandlers()
  }

  return sessionManager
}

/**
 * Quick setup for common use case
 */
export async function quickSetup(telegramBot) {
  return await initializeWhatsAppModule(telegramBot, {
    sessionDir: './sessions',
    enableEventHandlers: true,
    initializeSessions: true
  })
}

// ============================================================================
// DEFAULT EXPORT - For backward compatibility
// ============================================================================
export default {
  // Re-export everything that was already exported
  ...await (async () => {
    const sessions = await import('./sessions/index.js')
    
    return {
      ...sessions,
      VERSION,
      MODULE_NAME,
      getModuleInfo,
      initializeWhatsAppModule,
      quickSetup
    }
  })()
}