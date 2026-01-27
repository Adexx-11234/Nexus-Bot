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
    this.authBaileys = null  // ✅ Add auth collection
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
      this.authBaileys = this.db.collection('auth_baileys')  // ✅ Initialize auth collection

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
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const result = await this.authBaileys.deleteMany({ sessionId })
      logger.info(`Deleted ${result.deletedCount} auth documents for ${sessionId}`)
      return result.deletedCount > 0

    } catch (error) {
      logger.error(`MongoDB auth delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Check if session has valid auth data
   * ✅ NEW METHOD
   */
  async hasValidAuthData(sessionId) {
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const creds = await this.authBaileys.findOne(
        {
          sessionId,
          filename: "creds.json",
        },
        { 
          maxTimeMS: 5000,
          projection: { datajson: 1 }
        }
      )

      if (!creds?.datajson) return false

      const parsed = typeof creds.datajson === "string" 
        ? JSON.parse(creds.datajson) 
        : creds.datajson

      const isValid = !!(parsed?.noiseKey && parsed?.signedIdentityKey)
      
      if (isValid) {
        logger.debug(`Valid auth found for ${sessionId}`)
      } else {
        logger.debug(`Invalid/incomplete auth for ${sessionId}`)
      }

      return isValid

    } catch (error) {
      logger.debug(`Auth validation failed for ${sessionId}: ${error.message}`)
      return false
    }
  }

  /**
   * Read auth data
   * ✅ NEW METHOD (for compatibility with auth-state.js)
   */
  async readAuthData(sessionId, fileName) {
    if (!this.isConnected || !this.authBaileys) return null

    try {
      const sanitized = fileName
        .replace(/::/g, "__")
        .replace(/:/g, "-")
        .replace(/\//g, "_")
        .replace(/\\/g, "_")

      const result = await this.authBaileys.findOne(
        {
          sessionId,
          filename: sanitized,
        },
        {
          projection: { datajson: 1 },
          maxTimeMS: 5000,
        }
      )

      if (result?.datajson) {
        logger.debug(`Read auth: ${sessionId}/${fileName}`)
        return result.datajson
      }

      return null

    } catch (error) {
      logger.debug(`Auth read failed ${sessionId}/${fileName}: ${error.message}`)
      return null
    }
  }

  /**
   * Write auth data
   * ✅ NEW METHOD (for compatibility with auth-state.js)
   */
  async writeAuthData(sessionId, fileName, data) {
    if (!this.isConnected || !this.authBaileys) return false

    try {
      const sanitized = fileName
        .replace(/::/g, "__")
        .replace(/:/g, "-")
        .replace(/\//g, "_")
        .replace(/\\/g, "_")

      const result = await this.authBaileys.updateOne(
        {
          sessionId,
          filename: sanitized,
        },
        {
          $set: {
            sessionId,
            filename: sanitized,
            datajson: data,
            updatedAt: new Date(),
          },
        },
        {
          upsert: true,
          maxTimeMS: 10000,
        }
      )

      if (result.acknowledged) {
        logger.debug(`Wrote auth: ${sessionId}/${fileName}`)
      }

      return result.acknowledged

    } catch (error) {
      logger.error(`Auth write failed ${sessionId}/${fileName}: ${error.message}`)
      return false
    }
  }

  /**
   * Get all auth files for a session
   * ✅ NEW METHOD (for compatibility)
   */
  async getAllAuthFiles(sessionId) {
    if (!this.isConnected || !this.authBaileys) return []

    try {
      const files = await this.authBaileys
        .find({ sessionId })
        .project({ filename: 1 })
        .maxTimeMS(5000)
        .toArray()

      return files.map((f) => f.filename)

    } catch (error) {
      logger.error(`Failed to get auth files for ${sessionId}: ${error.message}`)
      return []
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
