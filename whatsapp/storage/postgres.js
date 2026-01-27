import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('WEB_POSTGRES_STORAGE')

/**
 * PostgreSQL Storage for Web - SIMPLIFIED
 * Only basic session operations
 */
export class PostgreSQLStorage {
  constructor() {
    this.pool = null
    this.isConnected = false
    this._initConnection()
  }

  /**
   * Initialize PostgreSQL connection
   * @private
   */
  async _initConnection() {
    try {
      const { pool } = await import('../../config/database.js')
      this.pool = pool

      const client = await this.pool.connect()
      await client.query('SELECT 1 as test')
      client.release()

      this.isConnected = true
      logger.info('Web PostgreSQL connected successfully')

    } catch (error) {
      this.isConnected = false
      logger.error('Web PostgreSQL connection failed:', error.message)
    }
  }

  /**
   * Save session
   */
  async saveSession(sessionId, sessionData) {
    if (!this.isConnected) return false

    try {
      await this.pool.query(`
        INSERT INTO users (
          telegram_id, session_id, phone_number, is_connected,
          connection_status, reconnect_attempts, source, detected,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          session_id = EXCLUDED.session_id,
          phone_number = COALESCE(EXCLUDED.phone_number, users.phone_number),
          is_connected = EXCLUDED.is_connected,
          connection_status = EXCLUDED.connection_status,
          reconnect_attempts = EXCLUDED.reconnect_attempts,
          source = EXCLUDED.source,
          detected = EXCLUDED.detected,
          updated_at = NOW()
      `, [
        parseInt(sessionData.telegramId || sessionData.userId),
        sessionId,
        sessionData.phoneNumber,
        Boolean(sessionData.isConnected),
        sessionData.connectionStatus || 'disconnected',
        parseInt(sessionData.reconnectAttempts || 0),
        sessionData.source || 'web',
        Boolean(sessionData.detected !== false)
      ])

      return true

    } catch (error) {
      logger.error(`PostgreSQL save error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get session
   */
  async getSession(sessionId) {
    if (!this.isConnected) return null

    try {
      const result = await this.pool.query(
        'SELECT * FROM users WHERE session_id = $1',
        [sessionId]
      )

      if (!result.rows.length) return null

      const row = result.rows[0]
      return {
        sessionId: row.session_id,
        userId: row.telegram_id,
        telegramId: row.telegram_id,
        phoneNumber: row.phone_number,
        isConnected: row.is_connected,
        connectionStatus: row.connection_status || 'disconnected',
        reconnectAttempts: row.reconnect_attempts || 0,
        source: row.source || 'web',
        detected: row.detected !== false,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }

    } catch (error) {
      logger.error(`PostgreSQL get error for ${sessionId}:`, error.message)
      return null
    }
  }

  /**
   * Update session
   */
  async updateSession(sessionId, updates) {
    if (!this.isConnected) return false

    try {
      const setParts = []
      const values = [sessionId]
      let paramIndex = 2

      if (updates.isConnected !== undefined) {
        setParts.push(`is_connected = $${paramIndex++}`)
        values.push(Boolean(updates.isConnected))
      }
      if (updates.connectionStatus) {
        setParts.push(`connection_status = $${paramIndex++}`)
        values.push(updates.connectionStatus)
      }
      if (updates.phoneNumber !== undefined) {
        setParts.push(`phone_number = $${paramIndex++}`)
        values.push(updates.phoneNumber)
      }
      if (updates.reconnectAttempts !== undefined) {
        setParts.push(`reconnect_attempts = $${paramIndex++}`)
        values.push(updates.reconnectAttempts)
      }
      if (updates.detected !== undefined) {
        setParts.push(`detected = $${paramIndex++}`)
        values.push(Boolean(updates.detected))
      }

      if (setParts.length > 0) {
        const query = `
          UPDATE users
          SET ${setParts.join(', ')}, updated_at = NOW()
          WHERE session_id = $1
        `

        const result = await this.pool.query(query, values)
        return result.rowCount > 0
      }

      return false

    } catch (error) {
      logger.error(`PostgreSQL update error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Completely delete session
   */
  async completelyDeleteSession(sessionId) {
    if (!this.isConnected) return false

    try {
      const result = await this.pool.query(
        'DELETE FROM users WHERE session_id = $1',
        [sessionId]
      )

      return result.rowCount > 0

    } catch (error) {
      logger.error(`PostgreSQL complete delete error for ${sessionId}:`, error.message)
      return false
    }
  }

  /**
   * Get all sessions
   */
  async getAllSessions() {
    if (!this.isConnected) return []

    try {
      const result = await this.pool.query(`
        SELECT telegram_id, session_id, phone_number, is_connected,
               connection_status, reconnect_attempts, source, detected,
               created_at, updated_at
        FROM users
        WHERE session_id IS NOT NULL
        ORDER BY updated_at DESC
      `)

      return result.rows.map(row => ({
        sessionId: row.session_id,
        userId: row.telegram_id,
        telegramId: row.telegram_id,
        phoneNumber: row.phone_number,
        isConnected: row.is_connected,
        connectionStatus: row.connection_status || 'disconnected',
        reconnectAttempts: row.reconnect_attempts || 0,
        source: row.source || 'web',
        detected: row.detected !== false,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))

    } catch (error) {
      logger.error('PostgreSQL get all sessions error:', error.message)
      return []
    }
  }

  /**
   * Close connection
   */
  async close() {
    try {
      if (this.pool && this.isConnected) {
        await this.pool.end()
        this.isConnected = false
        logger.info('Web PostgreSQL connection closed')
      }
    } catch (error) {
      logger.error('PostgreSQL close error:', error.message)
    }
  }
}