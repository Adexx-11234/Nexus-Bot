import NodeCache from "node-cache"
import { jidNormalizedUser, makeInMemoryStore, makeWASocket, Browsers, fetchLatestBaileysVersion } from "@whiskeysockets/baileys"
import { logger } from "../utils/logger.js"
import pino from "pino"

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

const { version, isLatest } = await fetchLatestBaileysVersion();
export const baileysConfig = {
  version,
  logger: pino({ level: "silent" }), // Shows EVERYTHING
  printQRInTerminal: false,
  browser: ['Ubuntu', 'Chrome', '20.0.0'],
  getMessage: defaultGetMessage,
  // version: [2, 3000, 1025190524], // remove comments if connection open but didn't connect on WhatsApp
  generateHighQualityLinkPreview: true,
  syncFullHistory: false,
  defaultQueryTimeoutMs: undefined,
  markOnlineOnConnect: true,
}

export const eventTypes = [
  "messages.upsert",
  "groups.update", 
  "group-participants.update",
  "messages.update",
  "contacts.update",
  "call",
]

// ==================== STORE MANAGEMENT ====================

/**
 * Create in-memory store for a session
 */
export function createSessionStore(sessionId) {
  // Return existing store if already created
  if (sessionStores.has(sessionId)) {
    return sessionStores.get(sessionId)
  }
  
  const store = makeInMemoryStore({ 
    logger: baileysLogger 
  })
  
  // Store it for later retrieval
  sessionStores.set(sessionId, store)
  
  logger.debug(`[Store] Created in-memory store for ${sessionId}`)
  
  return store
}

/**
 * Get existing store for a session
 */
export function getSessionStore(sessionId) {
  return sessionStores.get(sessionId)
}

/**
 * Delete store on cleanup
 */
export function deleteSessionStore(sessionId) {
  if (sessionStores.has(sessionId)) {
    sessionStores.delete(sessionId)
    logger.debug(`[Store] Deleted store for ${sessionId}`)
    return true
  }
  return false
}

/**
 * Bind store to socket and setup getMessage
 */
export function bindStoreToSocket(sock, sessionId) {
  try {
    const store = getSessionStore(sessionId)
    
    if (!store) {
      logger.warn(`[Store] No store found for ${sessionId}, creating new one`)
      const newStore = createSessionStore(sessionId)
      newStore.bind(sock.ev)
      
      // Set getMessage function
      sock.getMessage = async (key) => {
        if (newStore) {
          const msg = await newStore.loadMessage(key.remoteJid, key.id)
          return msg?.message || undefined
        }
        return undefined
      }
      
      return newStore
    }
    
    // Bind store to socket events
    store.bind(sock.ev)
    
    // ✅ CRITICAL: Set getMessage function with store access
    sock.getMessage = async (key) => {
      if (store) {
        const msg = await store.loadMessage(key.remoteJid, key.id)
        return msg?.message || undefined
      }
      return undefined
    }
    
    logger.info(`[Store] Bound store to socket for ${sessionId}`)
    return store
    
  } catch (error) {
    logger.error(`[Store] Error binding store for ${sessionId}:`, error.message)
    return null
  }
}

// ==================== SOCKET CREATION ====================

/**
 * Create Baileys socket with custom config and getMessage function
 */
export function createBaileysSocket(authState, sessionId, getMessage = null) {
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



