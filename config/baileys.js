import { createRequire } from 'module'
import NodeCache from "node-cache"
import { jidNormalizedUser, makeWASocket, makeInMemoryStore, Browsers, fetchLatestBaileysVersion, DEFAULT_CONNECTION_CONFIG } from "@nexustechpro/baileys"
import { logger } from "../utils/logger.js"
import pino from "pino"

// ✅ CRITICAL FIX: Make require available for Baileys internals
// Baileys uses CommonJS internally, so we need to provide require in ES modules
const require = createRequire(import.meta.url)
globalThis.require = require

// ==================== BAILEYS SILENT LOGGER ====================
const baileysLogger = pino({ 
  level: process.env.BAILEYS_LOG_LEVEL || 'silent'
})
// ==================== END BAILEYS SILENT LOGGER ====================

// Smart group cache with invalidation on updates
const groupCache = new NodeCache({ 
  stdTTL: 1800,      // 30 minutes default
  checkperiod: 300,  // Check every 5 minutes
  useClones: false   // Performance optimization
})

// ✅ CRITICAL: Store instances per session
const sessionStores = new Map()

// ✅ Default getMessage function
const defaultGetMessage = async (key) => {
  return undefined
}

export const baileysConfig = {
  ...DEFAULT_CONNECTION_CONFIG,
  logger: pino({ level: 'fatal' }), 
  generateHighQualityLinkPreview: true,
}

export const eventTypes = [
  "messages.upsert",
  "groups.update", 
  "group-participants.update",
  "messages.update",
  "contacts.update",
  "call",
]

// ==================== SOCKET CREATION ====================

/**
 * Create Baileys socket with custom config and getMessage function
 */
export function createBaileysSocket(authState, sessionId) {
  try {
    const sock = makeWASocket({
      ...baileysConfig,
      auth: authState
    })
    
    // Setup default socket properties
    setupSocketDefaults(sock)
    
    // ✅ CRITICAL FIX: Override sendMessage to always include ephemeralExpiration
    // This prevents "old WhatsApp version" warning for ALL messages
    const originalSendMessage = sock.sendMessage.bind(sock)
    sock.sendMessage = async (jid, content, options = {}) => {
      // Always add ephemeralExpiration if not present
      // 0 = persistent message (never expires)
      if (!options.ephemeralExpiration) {
        options.ephemeralExpiration = 0
      }
      
      return await originalSendMessage(jid, content, options)
    }
    
    return sock
    
  } catch (error) {
    logger.error('Failed to create Baileys socket:', error)
    throw error
  }
}

/**
 * Setup default properties and utilities on socket
 */
export function setupSocketDefaults(sock) {
  try {
    // Set max listeners to prevent memory leak warnings
    if (sock.ev && typeof sock.ev.setMaxListeners === 'function') {
      sock.ev.setMaxListeners(900)
    }

    // Add session tracking properties
    sock.sessionId = null
    sock.eventHandlersSetup = false
    sock.connectionCallbacks = null

    logger.debug('Socket defaults configured')

  } catch (error) {
    logger.error('Failed to setup socket defaults:', error)
  }
}

/**
 * Get Baileys socket configuration
 */
export function getBaileysConfig() {
  return { ...baileysConfig }
}





