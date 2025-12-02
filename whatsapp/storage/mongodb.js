import { MongoClient } from 'mongodb'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('WEB_MONGODB_STORAGE')

/**
 * MongoDBStorage for Web - SIMPLIFIED
 * Only basic session operations, no complex queries
 */
export class MongoDBStorage {
  constructor() {
    this.client = null
    this.db = null
    this.sessions = null
    this.isConnected = false
    this.retryCount = 0
    this.maxRetries = 3
    this.connectionTimeout = 30000

    this._initConnection()
  }

  /**
   * Initialize MongoDB connection
   * @private
   */
  async _initConnection() {
    try {
      const mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_bot'

      const options = {
        maxPoolSize: 30, // Lower for web server
        minPoolSize: 2,
        maxIdleTimeMS: 60000,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        retryWrites: true,
        retryReads: true
      }

      this.client = new MongoClient(mongoUrl, options)

      await Promise.race([
        this.client.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('MongoDB connection timeout')), this.connectionTimeout)
        )
      ])

      await this.client.db('admin').command({ ping: 1 })

      this.db = this.client.db()
      this.sessions = this.db.collection('sessions')

      this.isConnected = true
      this.retryCount = 0

      logger.info('Web MongoDB connected successfully')

    } catch (error) {
      this.isConnected = false
      logger.error('Web MongoDB connection failed:', error.message)

      if (this.retryCount < this.maxRetries) {
        this.retryCount++
        const delay = Math.min(30000, 5000 * Math.pow(2, this.retryCount - 1))
        logger.info(`Retrying MongoDB in ${delay}ms (${this.retryCount}/${this.maxRetries})`)
        setTimeout(() => this._initConnection(), delay)
      }
    }
  }

  /**
   * Save session
   */
  async saveSession(sessionId, sessionData) {
    if (!this.isConnected) return false

    try {
      const document = {
        sessionId,
        telegramId: sessionData.telegramId || sessionData.userId,
        phoneNumber: sessionData.phoneNumber,
        isConnected: sessionData.isConnected !== undefined ? sessionData.isConnected : false,
        connectionStatus: sessionData.connectionStatus || 'disconnected',
        reconnectAttempts: sessionData.reconnectAttempts || 0,
        source: sessionData.source || 'web',
        detected: sessionData.detected !== false,
        createdAt: sessionData.createdAt || new Date(),
        updatedAt: new Date()
      }

      await this.sessions.replaceOne({ sessionId }, document, { upsert: true })
      return true

    } catch (error) {
      logger.error(`MongoDB save error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get session
   */
  async getSession(sessionId) {
    if (!this.isConnected) return null

    try {
      const session = await this.sessions.findOne({ sessionId })
      if (!session) return null

      return {
        sessionId: session.sessionId,
        userId: session.telegramId,
        telegramId: session.telegramId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        reconnectAttempts: session.reconnectAttempts,
        source: session.source || 'web',
        detected: session.detected !== false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }

    } catch (error) {
      logger.error(`MongoDB get error for ${sessionId}:`, error.message)
      return null
    }
  }

  /**
   * Update session
   */
  async updateSession(sessionId, updates) {
    if (!this.isConnected) return false

    try {
      const updateDoc = { updatedAt: new Date() }
      const allowedFields = [
        'isConnected', 'connectionStatus', 'phoneNumber',
        'reconnectAttempts', 'source', 'detected'
      ]

      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          updateDoc[field] = updates[field]
        }
      }

      const result = await this.sessions.updateOne(
        { sessionId },
        { $set: updateDoc }
      )

      return result.modifiedCount > 0 || result.matchedCount > 0

    } catch (error) {
      logger.error(`MongoDB update error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    if (!this.isConnected) return false

    try {
      const result = await this.sessions.deleteOne({ sessionId })
      return result.deletedCount > 0

    } catch (error) {
      logger.error(`MongoDB delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Delete auth state
   */
  async deleteAuthState(sessionId) {
    if (!this.isConnected) return false

    try {
      const authCollection = this.db.collection('auth_baileys')
      const result = await authCollection.deleteMany({ sessionId })
      logger.info(`Deleted ${result.deletedCount} auth documents for ${sessionId}`)
      return result.deletedCount > 0

    } catch (error) {
      logger.error(`MongoDB auth delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get all sessions
   */
  async getAllSessions() {
    if (!this.isConnected) return []

    try {
      const sessions = await this.sessions.find({})
        .sort({ updatedAt: -1 })
        .toArray()

      return sessions.map(session => ({
        sessionId: session.sessionId,
        userId: session.telegramId,
        telegramId: session.telegramId,
        phoneNumber: session.phoneNumber,
        isConnected: session.isConnected,
        connectionStatus: session.connectionStatus,
        reconnectAttempts: session.reconnectAttempts,
        source: session.source || 'web',
        detected: session.detected !== false,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }))

    } catch (error) {
      logger.error('MongoDB get all sessions error:', error.message)
      return []
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.client && this.isConnected) {
        await this.client.close()
        this.isConnected = false
        logger.info('Web MongoDB connection closed')
      }
    } catch (error) {
      logger.error('MongoDB close error:', error.message)
    }
  }
}