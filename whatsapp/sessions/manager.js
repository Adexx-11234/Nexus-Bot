import { createComponentLogger } from '../../utils/logger.js'
import { SessionState } from './state.js'

const logger = createComponentLogger('WEB_SESSION_MANAGER')

/**
 * SessionManager for Web Server - Handles ONLY connections, NO event handlers
 * Creates connections and hands them off to main server for event handling
 */
export class SessionManager {
  constructor(sessionDir = './sessions') {
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
    this.handoffComplete = new Set() // Track sessions handed off to main server

    // Configuration
    this.maxSessions = 300
    this.concurrencyLimit = 20
    this.isInitialized = false
    this.handoffTimeout = 15000 // 15 seconds for main server detection

    logger.info('Web session manager created (connections only)')
  }

  /**
   * Initialize dependencies and components
   */
  async initialize() {
    try {
      logger.info('Initializing web session manager...')

      await this._initializeStorage()
      await this._initializeConnectionManager()
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
      this.storage.isMongoConnected ? this.storage.client : null,
      this.storage.mongoStorage || null
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
        this.connectionManager.mongoClient = this.storage.client
        this.connectionManager.mongoStorage = this.storage.mongoStorage
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    logger.warn('MongoDB not ready after waiting')
    return false
  }

  /**
   * Create a new session (CONNECTIONS ONLY - NO EVENT HANDLERS)
   * Creates connection, waits for pairing, then hands off to main server
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

      // Check if already handed off
      if (this.handoffComplete.has(sessionId)) {
        logger.info(`Session ${sessionId} already handed off to main server`)
        return null
      }

      // Only return existing session if it's actually connected
      if (this.activeSockets.has(sessionId) && !isReconnect) {
        const existingSocket = this.activeSockets.get(sessionId)
        const isConnected = existingSocket?.user && existingSocket?.readyState === existingSocket?.ws?.OPEN
        
        if (isConnected) {
          logger.info(`Session ${sessionId} already exists and is connected`)
          return existingSocket
        } else {
          logger.warn(`Session ${sessionId} exists but not connected - cleaning up`)
          await this._cleanupSocketOnly(sessionId, existingSocket)
          this.activeSockets.delete(sessionId)
          this.sessionState.delete(sessionId)
        }
      }

      // Check session limit
      if (this.activeSockets.size >= this.maxSessions) {
        throw new Error(`Maximum sessions limit (${this.maxSessions}) reached`)
      }

      this.initializingSessions.add(sessionId)
      logger.info(`Creating web session ${sessionId} (source: ${source})`)

      // Cleanup stale auth if new pairing
      if (!isReconnect && allowPairing) {
        const authAvailability = await this.connectionManager.checkAuthAvailability(sessionId)
        
        if (authAvailability.preferred !== 'none') {
          logger.info(`Cleaning up stale auth for new pairing: ${sessionId}`)
          await this.performCompleteUserCleanup(sessionId)
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      // Create socket connection with store
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

      // Setup basic connection handler (waits for pairing, then hands off)
      this._setupConnectionHandler(sock, sessionId, callbacks)

      // Save to database - mark as NOT detected yet
      await this.storage.saveSession(sessionId, {
        userId: userIdStr,
        telegramId: userIdStr,
        phoneNumber,
        isConnected: false,
        connectionStatus: 'connecting',
        reconnectAttempts: 0,
        source: source,
        detected: false // Main server will detect and take over
      })

      logger.info(`Web session ${sessionId} created - awaiting connection`)
      return sock

    } catch (error) {
      logger.error(`Failed to create web session ${sessionId}:`, error)
      throw error
    } finally {
      this.initializingSessions.delete(sessionId)
    }
  }

  /**
   * Setup connection handler - Hands off to main server after pairing
   * @private
   */
  _setupConnectionHandler(sock, sessionId, callbacks = {}) {
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update

      if (connection === 'open') {
        logger.info(`✅ Web session ${sessionId} paired successfully - preparing handoff to main server`)
        
        // Update database - mark as connected but NOT detected
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

        // Call onConnected callback
        if (callbacks.onConnected) {
          callbacks.onConnected()
        }

        // Schedule handoff to main server
        logger.info(`Scheduling handoff for ${sessionId} in ${this.handoffTimeout}ms`)
        setTimeout(async () => {
          await this._handoffToMainServer(sessionId, sock)
        }, this.handoffTimeout)

      } else if (connection === 'close') {
        // Check if already handed off - ignore close events after handoff
        if (this.handoffComplete.has(sessionId)) {
          logger.debug(`Session ${sessionId} close ignored - already handed off to main server`)
          return
        }

        const statusCode = lastDisconnect?.error?.output?.statusCode
        const reason = lastDisconnect?.error?.output?.payload?.message || 'Unknown'

        logger.info(`Web session ${sessionId} closed: ${reason} (${statusCode})`)

        // Handle 401 (Logout) - Complete cleanup
        if (statusCode === 401) {
          logger.warn(`Web session ${sessionId} logged out (401) - cleaning up`)
          
          await this.storage.updateSession(sessionId, {
            isConnected: false,
            connectionStatus: 'disconnected'
          })

          await this.connectionManager.cleanupAuthState(sessionId)
          await this._cleanupSocketOnly(sessionId, sock)
          
          this.activeSockets.delete(sessionId)
          this.sessionState.delete(sessionId)

          if (callbacks.onError) {
            callbacks.onError(lastDisconnect?.error)
          }

          logger.info(`Session ${sessionId} requires new pairing after logout`)
          return
        }

        // Handle 515 (Restart Required) - Normal after pairing
        if (statusCode === 515) {
          logger.info(`Web session ${sessionId} restart required (515) - reconnecting...`)
          
          await this.storage.updateSession(sessionId, {
            isConnected: false,
            connectionStatus: 'reconnecting',
            detected: false
          })

          if (callbacks.onError) {
            callbacks.onError(lastDisconnect?.error)
          }

          // Reconnect after 3 seconds
          setTimeout(async () => {
            try {
              logger.info(`Reconnecting ${sessionId} after 515...`)
              
              const session = await this.storage.getSession(sessionId)
              if (!session?.phoneNumber) {
                logger.error(`No phone number found for ${sessionId}`)
                
                await this.storage.updateSession(sessionId, {
                  isConnected: false,
                  connectionStatus: 'disconnected'
                })
                return
              }

              // Create new connection without pairing
              const newSock = await this.connectionManager.createConnection(
                sessionId,
                session.phoneNumber,
                callbacks,
                false
              )

              if (newSock) {
                this.activeSockets.set(sessionId, newSock)
                newSock.connectionCallbacks = callbacks
                
                this._setupConnectionHandler(newSock, sessionId, callbacks)
                
                logger.info(`Reconnection initiated for ${sessionId}`)
              } else {
                logger.error(`Failed to reconnect ${sessionId}`)
                
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
          }, 3000)

          return
        }

        // Handle 428 (Connection Replaced)
        if (statusCode === 428) {
          logger.warn(`Web session ${sessionId} connection replaced (428)`)
          
          await this.storage.updateSession(sessionId, {
            isConnected: false,
            connectionStatus: 'disconnected'
          })

          await this.connectionManager.cleanupAuthState(sessionId)
          await this._cleanupSocketOnly(sessionId, sock)
          
          this.activeSockets.delete(sessionId)
          this.sessionState.delete(sessionId)

          if (callbacks.onError) {
            callbacks.onError(lastDisconnect?.error)
          }

          return
        }

        // Handle other disconnects
        await this.storage.updateSession(sessionId, {
          isConnected: false,
          connectionStatus: 'disconnected'
        })

        await this._cleanupSocketOnly(sessionId, sock)
        this.activeSockets.delete(sessionId)
        this.sessionState.delete(sessionId)

        if (callbacks.onError) {
          callbacks.onError(lastDisconnect?.error)
        }

        logger.info(`Web session ${sessionId} disconnected (${statusCode})`)
      }
    })
  }

  /**
   * Hand off session to main server - COMPLETE SOCKET CLEANUP
   * Main server will create its own connection using existing auth
   * @private
   */
  async _handoffToMainServer(sessionId, sock) {
    try {
      logger.info(`🤝 Handing off ${sessionId} to main server - closing web server socket`)

      // Check if session is still connected
      if (!sock || !sock.user || sock.readyState !== sock.ws?.OPEN) {
        logger.warn(`Session ${sessionId} no longer connected - aborting handoff`)
        return
      }

      // Mark handoff complete BEFORE cleanup to prevent close events from triggering
      this.handoffComplete.add(sessionId)

      // ✅ COMPLETELY cleanup the socket on web server side
      await this._cleanupSocketOnly(sessionId, sock)

      // Remove from active tracking
      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)

      // ✅ DO NOT touch database - main server will handle it
      logger.info(`✅ Session ${sessionId} handed off - web server socket closed, auth preserved for main server`)

    } catch (error) {
      logger.error(`Handoff failed for ${sessionId}:`, error)
      this.handoffComplete.delete(sessionId) // Allow retry on failure
    }
  }

  /**
   * Cleanup socket ONLY - Does NOT touch database or auth state
   * Used during handoff to main server
   * @private
   */
  async _cleanupSocketOnly(sessionId, sock) {
    try {
      logger.debug(`Cleaning up socket for ${sessionId} (preserving auth and database)`)

      if (sock?.ev?.isBuffering?.()) {
        try {
          sock.ev.flush()
        } catch {}
      }

      // Remove event listeners
      if (sock.ev && typeof sock.ev.removeAllListeners === 'function') {
        sock.ev.removeAllListeners()
      }

      // Close WebSocket connection
      if (sock.ws?.socket && sock.ws.socket._readyState === 1) {
        sock.ws.close(1000, 'Handoff to main server')
      }

      // Clear socket properties
      sock.user = null
      sock.connectionCallbacks = null

      logger.debug(`Socket closed for ${sessionId} - auth and database preserved`)
      return true

    } catch (error) {
      logger.error(`Failed to cleanup socket for ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Disconnect a session
   */
  async disconnectSession(sessionId, forceCleanup = false) {
    try {
      logger.info(`Disconnecting web session ${sessionId} (force: ${forceCleanup})`)

      if (forceCleanup) {
        return await this.performCompleteUserCleanup(sessionId)
      }

      this.initializingSessions.delete(sessionId)
      this.voluntarilyDisconnected.add(sessionId)
      this.handoffComplete.delete(sessionId)

      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        await this._cleanupSocketOnly(sessionId, sock)
      }

      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)

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
   * Perform complete user cleanup (logout) - Full cleanup including auth
   */
  async performCompleteUserCleanup(sessionId) {
    const results = { socket: false, database: false, authState: false }

    try {
      logger.info(`Performing complete cleanup for web session ${sessionId}`)

      const sock = this.activeSockets.get(sessionId)
      if (sock) {
        results.socket = await this._cleanupSocketOnly(sessionId, sock)
      }

      this.activeSockets.delete(sessionId)
      this.sessionState.delete(sessionId)
      this.initializingSessions.delete(sessionId)
      this.voluntarilyDisconnected.add(sessionId)
      this.handoffComplete.delete(sessionId)

      results.database = await this.storage.completelyDeleteSession(sessionId)

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
   * Check if session is really connected
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
      stateInfo,
      handedOff: this.handoffComplete.has(sessionId)
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
        handedOffSessions: this.handoffComplete.size,
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

      const disconnectPromises = []
      for (const sessionId of this.activeSockets.keys()) {
        disconnectPromises.push(this.disconnectSession(sessionId))
      }

      await Promise.allSettled(disconnectPromises)

      if (this.storage) {
        await this.storage.close()
      }

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

