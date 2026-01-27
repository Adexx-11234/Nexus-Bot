import { createComponentLogger } from '../../utils/logger.js'
import { MongoDBStorage } from './mongodb.js'
import { PostgreSQLStorage } from './postgres.js'

const logger = createComponentLogger('WEB_SESSION_STORAGE')

/**
 * SessionStorage for Web Server - NO CACHING
 * Only coordinates pairing, then hands off to main server
 */
export class SessionStorage {
  constructor() {
    this.mongoStorage = new MongoDBStorage()
    this.postgresStorage = new PostgreSQLStorage()
    
    logger.info('Web session storage coordinator initialized (no caching)')
  }

  get isConnected() {
    return this.mongoStorage.isConnected || this.postgresStorage.isConnected
  }

  get isMongoConnected() {
    return this.mongoStorage.isConnected
  }

  get isPostgresConnected() {
    return this.postgresStorage.isConnected
  }

  get client() {
    return this.mongoStorage.client
  }

  get sessions() {
    return this.mongoStorage.sessions
  }

  /**
   * Save session - NO CACHE (temporary pairing session)
   */
  async saveSession(sessionId, sessionData) {
    try {
      let saved = false

      // Try MongoDB first
      if (this.mongoStorage.isConnected) {
        saved = await this.mongoStorage.saveSession(sessionId, sessionData)
      }

      // Try PostgreSQL
      if (this.postgresStorage.isConnected) {
        const pgSaved = await this.postgresStorage.saveSession(sessionId, sessionData)
        saved = saved || pgSaved
      }

      return saved

    } catch (error) {
      logger.error(`Error saving session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Get session - NO CACHE (read directly from DB)
   */
  async getSession(sessionId) {
    try {
      let sessionData = null

      // Try MongoDB
      if (this.mongoStorage.isConnected) {
        sessionData = await this.mongoStorage.getSession(sessionId)
      }

      // Try PostgreSQL
      if (!sessionData && this.postgresStorage.isConnected) {
        sessionData = await this.postgresStorage.getSession(sessionId)
      }

      return sessionData ? this._formatSessionData(sessionData) : null

    } catch (error) {
      logger.error(`Error retrieving session ${sessionId}:`, error)
      return null
    }
  }

  /**
   * Update session - Direct write, NO BUFFERING
   */
  async updateSession(sessionId, updates) {
    try {
      updates.updatedAt = new Date()
      let updated = false

      // Try MongoDB
      if (this.mongoStorage.isConnected) {
        updated = await this.mongoStorage.updateSession(sessionId, updates)
      }

      // Try PostgreSQL
      if (this.postgresStorage.isConnected) {
        const pgUpdated = await this.postgresStorage.updateSession(sessionId, updates)
        updated = updated || pgUpdated
      }

      return updated

    } catch (error) {
      logger.error(`Error updating session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Delete session completely
   */
  async completelyDeleteSession(sessionId) {
    try {
      const deletePromises = []

      if (this.mongoStorage.isConnected) {
        deletePromises.push(this.mongoStorage.deleteSession(sessionId))
        deletePromises.push(this.mongoStorage.deleteAuthState(sessionId))
      }

      if (this.postgresStorage.isConnected) {
        deletePromises.push(this.postgresStorage.completelyDeleteSession(sessionId))
      }

      const results = await Promise.allSettled(deletePromises)
      const success = results.some(r => r.status === 'fulfilled' && r.value)

      logger.info(`Complete deletion for ${sessionId}: ${success}`)
      return success

    } catch (error) {
      logger.error(`Error completely deleting session ${sessionId}:`, error)
      return false
    }
  }

  /**
   * Get all sessions
   */
  async getAllSessions() {
    try {
      let sessions = []

      if (this.postgresStorage.isConnected) {
        sessions = await this.postgresStorage.getAllSessions()
      } else if (this.mongoStorage.isConnected) {
        sessions = await this.mongoStorage.getAllSessions()
      }

      return sessions.map(session => this._formatSessionData(session))

    } catch (error) {
      logger.error('Error retrieving all sessions:', error)
      return []
    }
  }

  _formatSessionData(sessionData) {
    if (!sessionData) return null

    return {
      sessionId: sessionData.sessionId,
      userId: sessionData.userId || sessionData.telegramId,
      telegramId: sessionData.telegramId || sessionData.userId,
      phoneNumber: sessionData.phoneNumber,
      isConnected: Boolean(sessionData.isConnected),
      connectionStatus: sessionData.connectionStatus || 'disconnected',
      reconnectAttempts: sessionData.reconnectAttempts || 0,
      source: sessionData.source || 'web',
      detected: sessionData.detected !== false,
      createdAt: sessionData.createdAt,
      updatedAt: sessionData.updatedAt
    }
  }

  getConnectionStatus() {
    return {
      mongodb: this.mongoStorage.isConnected,
      postgresql: this.postgresStorage.isConnected,
      overall: this.isConnected
    }
  }

  async close() {
    try {
      logger.info('Closing web session storage...')

      await Promise.allSettled([
        this.mongoStorage.close(),
        this.postgresStorage.close()
      ])

      logger.info('Web session storage closed')

    } catch (error) {
      logger.error('Storage close error:', error)
    }
  }

  getStats() {
    return {
      connections: {
        mongodb: this.mongoStorage.isConnected,
        postgresql: this.postgresStorage.isConnected,
        overall: this.isConnected
      }
    }
  }
}

// Singleton
let storageInstance = null

export function getSessionStorage() {
  if (!storageInstance) {
    storageInstance = new SessionStorage()
  }
  return storageInstance
}