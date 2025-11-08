import { createComponentLogger } from '../../utils/logger.js'
import { SessionState } from './state.js'
import { Boom } from '@hapi/boom'

const logger = createComponentLogger('WEB_SESSION_MANAGER')
// Prevent socket cleanup on handoff
const HANDOFF_SESSIONS = new Set()

/**
 * SessionManager for Web Server - Handles ONLY connections, NO event handlers
 * Event handlers will be set up by the main server after detection
 */
export class SessionManager {
  constructor(sessionDir = './sessions') {
    // Core dependencies
    this.sessionDir = sessionDir

    // Component instances (lazy loaded)
    this.storage = null
    this.connectionManager = null
    this.fileManager = null

    // Session tracking
    this.activeSockets = new Map()
    this.sessionState = new SessionState()

    // Session flags
    this.initializingSessions = new Set()
    this.voluntarilyDisconnected = new Set()

    // Configuration
    this.maxSessions = 50
    this.concurrencyLimit = 5
    this.isInitialized = false

    logger.info('Web session manager created (connections only)')
  }

  /**
   * Initialize dependencies and components
   */
  async initialize() {
    try {
      logger.info('Initializing web session manager...')

      // Initialize storage
      await this._initializeStorage()

      // Initialize connection manager
      await this._initializeConnectionManager()

      // Wait for MongoDB connection
      await this._waitForMongoDB()

      logger.info('Web session manager initialization complete')
      return true

    } catch (error) {
      logger.error('Web session manager initialization failed:', error)
      throw error
    }
  }

  /**
   * Initialize storage layer
   * @private
   */
  async _initializeStorage() {
    const { SessionStorage } = await import('../storage/index.js')
    this.storage = new SessionStorage()
    logger.info('Storage initialized')
  }

  /**
   * Initialize connection manager
   * @private
   */
  async _initializeConnectionManager() {
    const { ConnectionManager } = await import('../core/index.js')
    const { FileManager } = await import('../storage/index.js')

    this.fileManager = new FileManager(this.sessionDir)
    this.connectionManager = new ConnectionManager()
    this.connectionManager.initialize(
      this.fileManager,
      this.storage.isMongoConnected ? this.storage.client : null
    )

    logger.info('Connection manager initialized')
  }

  /**
   * Wait for MongoDB to be ready
   * @private
   */
  async _waitForMongoDB(maxWaitTime = 10000) {
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      if (this.storage.isMongoConnected && this.storage.sessions) {
        // Update connection manager with mongo client
        this.connectionManager.mongoClient = this.storage.client
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    logger.warn('MongoDB not ready after waiting')
    return false
  }

  /**
   * Create a new session (CONNECTIONS ONLY - NO EVENT HANDLERS)
   */
  async createSession(
    userId,
    phoneNumber = null,
    callbacks = {},
    isReconnect = false,
    source = 'web',
    allowPairing = true
  ) {
    const userIdStr = String(userId)
    const sessionId = userIdStr.startsWith('session_') ? userIdStr : `session_${userIdStr}`

    try {
      // Prevent duplicate session creation
      if (this.initializingSessions.has(sessionId)) {
        logger.warn(`Session ${sessionId} already initializing`)
        return this.activeSockets.get(sessionId)
      }

      // Only return existing session if it's actually connected
      if (this.activeSockets.has(sessionId) && !isReconnect) {
        const existingSocket = this.activeSockets.get(sessionId)
        const isConnected = existingSocket?.user && existingSocket?.readyState === existingSocket?.ws?.OPEN
        
        if (isConnected) {
          logger.info(`Session ${sessionId} already exists and is connected`)
          return existingSocket
        } else {
          logger.warn(`Session ${sessionId} exists but not connected - allowing recreate`)
          // Clean up the disconnected session
          await this._cleanupExistingSession(sessionId)
        }
      }

      // Check session limit
      if (this.activeSockets.size >= this.maxSessions) {
        throw new Error(`Maximum sessions limit (${this.maxSessions}) reached`)
      }

      this.initializingSessions.add(sessionId)
      logger.info(`Creating web session ${sessionId} (source: ${source})`)

      // Cleanup existing session if reconnecting
      if (isReconnect) {
        await this._cleanupExistingSession(sessionId)
      } else if (allowPairing) {
        // Check if there's stale auth that needs cleanup
        const existingSocket = this.activeSockets.has(sessionId)
        const authAvailability = await this.connectionManager.checkAuthAvailability(sessionId)
        
        // Only cleanup if there's BOTH old auth AND no active socket (stale session)
        if (authAvailability.preferred !== 'none' && !existingSocket) {
          logger.info(`Cleaning up stale auth for new pairing: ${sessionId}`)
          await this.performCompleteUserCleanup(sessionId)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      // Create socket connection
      const sock = await this.connectionManager.createConnection(
        sessionId,
        phoneNumber,
        callbacks,
        allowPairing
      )

      if (!sock) {
        throw new Error('Failed to create socket connection')
      }

      // Store socket and state
      this.activeSockets.set(sessionId, sock)
      sock.connectionCallbacks = callbacks

      this.sessionState.set(sessionId, {
        userId: userIdStr,
        phoneNumber,
        source,
        isConnected: false,
        connectionStatus: 'connecting',
        callbacks: callbacks
      })

      // Setup BASIC connection handler (no event handlers)
      this._setupBasicConnectionHandler(sock, sessionId, callbacks)

      // Save to database
      await this.storage.saveSession(sessionId, {
        userId: userIdStr,
        telegramId: userIdStr,
        phoneNumber,
        isConnected: false,
        connectionStatus: 'connecting',
        reconnectAttempts: 0,
        source: source,
        detected: false // Will be set to true by main server
      })

      logger.info(`Web session ${sessionId} created successfully (awaiting detection by main server)`)
      return sock

    } catch (error) {
      logger.error(`Failed to create web session ${sessionId}:`, error)
      throw error
    } finally {
      this.initializingSessions.delete(sessionId)
    }
  }

/**
 * Setup basic connection handler (NO EVENT HANDLERS)
 * FIXED: Proper 401 logout handling
 * @private
 */
_setupBasicConnectionHandler(sock, sessionId, callbacks = {}) {
  // Track reconnection after 515
  let awaitingReconnection = false
  
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      logger.info(`Web session ${sessionId} connected - keeping socket alive for main server`)
      
      // Mark for handoff
      HANDOFF_SESSIONS.add(sessionId)
      
      // Update database - mark as connected
      await this.storage.updateSession(sessionId, {
        isConnected: true,
        connectionStatus: 'connected',
        phoneNumber: sock.user?.id?.split('@')[0] || null,
        detected: false // Main server will detect it
      })

      // Update session state
      this.sessionState.update(sessionId, {
        isConnected: true,
        connectionStatus: 'connected'
      })

      // Call onConnected callback if provided
      if (callbacks.onConnected) {
        callbacks.onConnected()
      }

      // Keep socket alive for main server detection (increased delay)
      setTimeout(() => {
        this.activeSockets.delete(sessionId)
        this.sessionState.delete(sessionId)
        logger.info(`Web session ${sessionId} handed off to main server (socket still active)`)
      }, 10000) // 10 seconds for main server to detect

    } else if (connection === 'close') {
      // Skip handling if session is being handed off
      if (HANDOFF_SESSIONS.has(sessionId)) {
        logger.info(`Web session ${sessionId} close event ignored - already handed off to main server`)
        HANDOFF_SESSIONS.delete(sessionId)
        return
      }

      const statusCode = lastDisconnect?.error?.output?.statusCode
      const reason = lastDisconnect?.error?.output?.payload?.message || 'Unknown'
      const errorData = lastDisconnect?.error?.data

      logger.info(`Web session ${sessionId} closed: ${reason} (${statusCode})`)

      // ===== CRITICAL: Handle 401 (Logout/Unauthorized) =====
      if (statusCode === 401) {
        logger.warn(`Web session ${sessionId} logged out (401) - cleaning up auth state`)
        
        // Update database - mark as disconnected
        await this.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: 'disconnected'
        })

        // Cleanup auth state completely
        try {
          await this.connectionManager.cleanupAuthState(sessionId)
          logger.info(`Auth state cleaned up for ${sessionId}`)
        } catch (cleanupError) {
          logger.error(`Failed to cleanup auth for ${sessionId}:`, cleanupError)
        }

        // Cleanup local tracking
        this.activeSockets.delete(sessionId)
        this.sessionState.delete(sessionId)

        // Call onError callback
        if (callbacks.onError) {
          callbacks.onError(lastDisconnect?.error)
        }

        // DO NOT attempt reconnection for 401
        logger.info(`Session ${sessionId} requires new pairing after logout`)
        return
      }

      // ===== Handle 515 (Restart Required) - Normal after pairing =====
      if (statusCode === 515) {
        logger.info(`Web session ${sessionId} restart required after pairing - reconnecting...`)
        
        // Mark as awaiting reconnection
        awaitingReconnection = true
        
        // Update database - mark as reconnecting (not disconnected!)
        await this.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: 'reconnecting'
        })

        // Update session state
        this.sessionState.update(sessionId, {
          connectionStatus: 'reconnecting'
        })

        // Call onError callback but don't cleanup
        if (callbacks.onError) {
          callbacks.onError(lastDisconnect?.error)
        }

        // Wait 3 seconds then reconnect
        setTimeout(async () => {
          try {
            logger.info(`Reconnecting ${sessionId} after 515...`)
            
            // Get the phone number from storage
            const session = await this.storage.getSession(sessionId)
            if (!session?.phoneNumber) {
              logger.error(`No phone number found for ${sessionId} reconnection`)
              
              // Mark as failed
              await this.storage.updateSession(sessionId, {
                isConnected: false,
                connectionStatus: 'disconnected'
              })
              return
            }

            // Create new connection (reconnect without pairing)
            const newSock = await this.connectionManager.createConnection(
              sessionId,
              session.phoneNumber,
              callbacks,
              false // Don't allow pairing
            )

            if (newSock) {
              // Replace the old socket
              this.activeSockets.set(sessionId, newSock)
              newSock.connectionCallbacks = callbacks
              
              // Setup connection handler for the new socket
              this._setupBasicConnectionHandler(newSock, sessionId, callbacks)
              
              logger.info(`Reconnection initiated for ${sessionId}`)
            } else {
              logger.error(`Failed to create reconnection socket for ${sessionId}`)
              
              // Mark as failed
              await this.storage.updateSession(sessionId, {
                isConnected: false,
                connectionStatus: 'disconnected'
              })
            }
          } catch (error) {
            logger.error(`Reconnection error for ${sessionId}:`, error)
            
            await this.storage.updateSession(sessionId, {
              isConnected: false,
              connectionStatus: 'disconnected'
            })
          }
        }, 3000) // Wait 3 seconds before reconnecting

        return
      }

      // ===== Handle 428 (Connection Replaced) =====
      if (statusCode === 428) {
        logger.warn(`Web session ${sessionId} connection replaced - another device logged in`)
        
        await this.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: 'disconnected'
        })

        // Cleanup auth state
        try {
          await this.connectionManager.cleanupAuthState(sessionId)
        } catch (cleanupError) {
          logger.error(`Failed to cleanup auth for ${sessionId}:`, cleanupError)
        }

        // Cleanup local tracking
        this.activeSockets.delete(sessionId)
        this.sessionState.delete(sessionId)

        if (callbacks.onError) {
          callbacks.onError(lastDisconnect?.error)
        }

        return
      }

      // ===== Handle other disconnects =====
      await this.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: 'disconnected'
      })

      // Cleanup local tracking
      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)

      // Call onError callback if provided
      if (callbacks.onError) {
        callbacks.onError(lastDisconnect?.error)
      }

      logger.info(`Web session ${sessionId} disconnected (${statusCode})`)
    }
  })
}

  /**
   * Disconnect a session
   */
  async disconnectSession(sessionId, forceCleanup = false) {
    try {
      logger.info(`Disconnecting web session ${sessionId} (force: ${forceCleanup})`)

      // Full cleanup if forced
      if (forceCleanup) {
        return await this.performCompleteUserCleanup(sessionId)
      }

      // Mark as voluntary disconnect
      this.initializingSessions.delete(sessionId)
      this.voluntarilyDisconnected.add(sessionId)

      // Get and cleanup socket
      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        await this._cleanupSocket(sessionId, sock)
      }

      // Remove from tracking
      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)

      // Update database
      await this.storage.updateSession(sessionId, {
        isConnected: false,
        connectionStatus: 'disconnected'
      })

      logger.info(`Web session ${sessionId} disconnected`)
      return true

    } catch (error) {
      logger.error(`Failed to disconnect web session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Cleanup socket
   * @private
   */
  async _cleanupSocket(sessionId, sock) {
    try {
      // Remove event listeners
      if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
        sock.ev.removeAllListeners()
      }

      // Close WebSocket
      if (sock.ws && sock.ws.readyState === sock.ws.OPEN) {
        sock.ws.close(1000, 'Cleanup')
      }

      // Clear socket properties
      sock.user = null
      sock.connectionCallbacks = null

      logger.debug(`Socket cleaned up for ${sessionId}`)
      return true

    } catch (error) {
      logger.error(`Failed to cleanup socket for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Perform complete user cleanup (logout)
   */
  async performCompleteUserCleanup(sessionId) {
    const results = { socket: false, database: false, authState: false }

    try {
      logger.info(`Performing complete cleanup for web session ${sessionId}`)

      // Cleanup socket
      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        results.socket = await this._cleanupSocket(sessionId, sock)
      }

      // Clear in-memory structures
      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)
      this.initializingSessions.delete(sessionId)
      this.voluntarilyDisconnected.add(sessionId)

      // Delete from databases
      results.database = await this.storage.completelyDeleteSession(sessionId)

      // Cleanup auth state
      const authCleanupResults = await this.connectionManager.cleanupAuthState(sessionId)
      results.authState = authCleanupResults.mongodb || authCleanupResults.file

      logger.info(`Complete cleanup for web session ${sessionId}:`, results)
      return results

    } catch (error) {
      logger.error(`Complete cleanup failed for web session ${sessionId}:`, error)
      return results
    }
  }

  /**
   * Cleanup existing session before reconnect
   * @private
   */
  async _cleanupExistingSession(sessionId) {
    try {
      const existingSession = await this.storage.getSession(sessionId)
      
      if (existingSession && !existingSession.isConnected) {
        await this.disconnectSession(sessionId)
      }

    } catch (error) {
      logger.error(`Failed to cleanup existing web session ${sessionId}:`, error)
    }
  }

  /**
   * Get session socket
   */
  getSession(sessionId) {
    return this.activeSockets.get(sessionId)
  }

  /**
   * Get all sessions from database
   */
  async getAllSessions() {
    return await this.storage.getAllSessions()
  }

  /**
   * Check if session is connected
   */
  async isSessionConnected(sessionId) {
    const session = await this.storage.getSession(sessionId)
    return session?.isConnected || false
  }

  /**
   * Check if session is really connected (socket + database)
   */
  async isReallyConnected(sessionId) {
    const sock = this.activeSockets.get(sessionId)
    const session = await this.storage.getSession(sessionId)
    return !!(sock && sock.user && session?.isConnected)
  }

  /**
   * Get session information
   */
  async getSessionInfo(sessionId) {
    const session = await this.storage.getSession(sessionId)
    const hasSocket = this.activeSockets.has(sessionId)
    const stateInfo = this.sessionState.get(sessionId)

    return {
      ...session,
      hasSocket,
      stateInfo
    }
  }

  /**
   * Check if session is voluntarily disconnected
   */
  isVoluntarilyDisconnected(sessionId) {
    return this.voluntarilyDisconnected.has(sessionId)
  }

  /**
   * Clear voluntary disconnection flag
   */
  clearVoluntaryDisconnection(sessionId) {
    this.voluntarilyDisconnected.delete(sessionId)
  }

  /**
   * Get statistics
   */
  async getStats() {
    try {
      const allSessions = await this.storage.getAllSessions()
      const webSessions = allSessions.filter(s => s.source === 'web')
      const connectedSessions = webSessions.filter(s => s.isConnected)

      return {
        totalSessions: allSessions.length,
        webSessions: webSessions.length,
        connectedWebSessions: connectedSessions.length,
        activeSockets: this.activeSockets.size,
        maxSessions: this.maxSessions,
        isInitialized: this.isInitialized,
        storage: this.storage?.isConnected ? 'Connected' : 'Disconnected',
        mongoConnected: this.storage?.isMongoConnected || false,
        stateStats: this.sessionState.getStats()
      }

    } catch (error) {
      logger.error('Failed to get stats:', error)
      return {
        error: 'Failed to retrieve statistics',
        activeSockets: this.activeSockets.size
      }
    }
  }

  /**
   * Shutdown session manager
   */
  async shutdown() {
    try {
      logger.info('Shutting down web session manager...')

      // Disconnect all sessions
      const disconnectPromises = []
      for (const sessionId of this.activeSockets.keys()) {
        disconnectPromises.push(this.disconnectSession(sessionId))
      }

      await Promise.allSettled(disconnectPromises)

      // Close storage
      if (this.storage) {
        await this.storage.close()
      }

      // Cleanup connection manager
      if (this.connectionManager) {
        await this.connectionManager.cleanup()
      }

      logger.info('Web session manager shutdown complete')

    } catch (error) {
      logger.error('Shutdown error:', error)
    }
  }

  /**
   * Get connection manager instance
   */
  getConnectionManager() {
    return this.connectionManager
  }

  /**
   * Get storage instance
   */
  getStorage() {
    return this.storage
  }

  /**
   * Get session state instance
   */
  getSessionState() {
    return this.sessionState
  }
}

// Export singleton pattern functions
let sessionManagerInstance = null

/**
 * Get session manager instance
 */
export function getSessionManager() {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager('./sessions')
  }
  return sessionManagerInstance
}

/**
 * Reset session manager (for testing)
 */
export function resetSessionManager() {
  sessionManagerInstance = null
}