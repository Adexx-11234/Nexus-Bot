import { proto, initAuthCreds } from '@whiskeysockets/baileys'
import { createComponentLogger } from '../../utils/logger.js'

const logger = createComponentLogger('AUTH_STATE')

/**
 * Buffer JSON serialization helpers
 */
const BufferJSON = {
  replacer: (k, value) => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
      return {
        type: 'Buffer',
        data: Buffer.from(value?.data || value).toString('base64')
      }
    }
    return value
  },
  reviver: (_, value) => {
    if (typeof value === 'object' && !!value && (value.buffer === true || value.type === 'Buffer')) {
      const val = value.data || value.value
      return typeof val === 'string' ? Buffer.from(val, 'base64') : Buffer.from(val || [])
    }
    return value
  }
}

/**
 * MongoDB auth state with SELECTIVE key storage - NO CACHING
 * Direct read/write operations
 */
export const useMongoDBAuthState = async (collection, sessionId) => {
  if (!sessionId || !sessionId.startsWith('session_')) {
    throw new Error(`Invalid sessionId: ${sessionId}`)
  }

  const fixFileName = (file) => file?.replace(/\//g, '__')?.replace(/:/g, '-') || ''

  /**
   * ✅ CRITICAL KEYS ONLY - Ignore most keys to save RAM/disk
   */
  const isCriticalKey = (type) => {
    // Only store these types
    const criticalTypes = [
      'creds',           // Authentication credentials
      'session',         // Session data
      'sender-key',      // Group encryption keys
      'sender-key-memory' // Group encryption memory
    ]
    return criticalTypes.some(t => type.startsWith(t))
  }

  /**
   * Read data from MongoDB - DIRECT READ, NO CACHE
   */
  const readData = async (fileName) => {
    const isCriticalFile = fileName === 'creds.json'
    const maxRetries = isCriticalFile ? 3 : 1
    let lastError = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await collection.findOne(
          { filename: fixFileName(fileName), sessionId: sessionId },
          { projection: { datajson: 1 } }
        )

        if (!result) {
          if (isCriticalFile && attempt === maxRetries) {
            logger.error(`Auth read failed for ${sessionId}:${fileName}`)
          }
          return null
        }

        const data = JSON.parse(result.datajson, BufferJSON.reviver)
        return data

      } catch (error) {
        lastError = error
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        } else if (isCriticalFile) {
          logger.error(`Auth read error for ${sessionId}:${fileName}:`, error.message)
        }
      }
    }

    return null
  }

  /**
   * Write data to MongoDB - DIRECT WRITE, NO BUFFERING
   */
  const writeData = async (datajson, fileName) => {
    try {
      const query = { filename: fixFileName(fileName), sessionId: sessionId }
      const update = {
        $set: {
          filename: fixFileName(fileName),
          sessionId: sessionId,
          datajson: JSON.stringify(datajson, BufferJSON.replacer),
          updatedAt: new Date()
        }
      }
      await collection.updateOne(query, update, { upsert: true })
    } catch (error) {
      logger.error(`Auth write error for ${sessionId}:${fileName}:`, error.message)
    }
  }

  /**
   * Remove data from MongoDB
   */
  const removeData = async (fileName) => {
    try {
      await collection.deleteOne({ filename: fixFileName(fileName), sessionId: sessionId })
    } catch (error) {
      logger.error(`Auth remove error for ${sessionId}:${fileName}:`, error.message)
    }
  }

  // Load existing credentials or create new
  const existingCreds = await readData('creds.json')
  let creds = (existingCreds && existingCreds.noiseKey && existingCreds.signedIdentityKey)
    ? existingCreds
    : initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        /**
         * ✅ OPTIMIZED: Get keys in batches, skip non-critical keys
         */
        get: async (type, ids) => {
          // ✅ Skip non-critical keys entirely
          if (!isCriticalKey(type)) {
            return {}
          }

          const data = {}
          const batchSize = 100

          for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize)
            const promises = batch.map(async (id) => {
              try {
                let value = await readData(`${type}-${id}.json`)
                if (type === 'app-state-sync-key' && value) {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value)
                }
                if (value) data[id] = value
              } catch (error) {
                // Silent error for non-critical keys
              }
            })
            await Promise.allSettled(promises)
          }
          return data
        },
        
        /**
         * ✅ OPTIMIZED: Set keys in batches, skip non-critical keys
         */
        set: async (data) => {
          const tasks = []
          for (const category in data) {
            // ✅ Skip non-critical keys entirely
            if (!isCriticalKey(category)) {
              continue
            }

            for (const id in data[category]) {
              const value = data[category][id]
              const file = `${category}-${id}.json`

              if (tasks.length >= 20) {
                await Promise.allSettled(tasks)
                tasks.length = 0
              }

              tasks.push(value ? writeData(value, file) : removeData(file))
            }
          }
          if (tasks.length > 0) {
            await Promise.allSettled(tasks)
          }
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds.json'),
    cleanup: () => {} // No cache to cleanup
  }
}

export const cleanupSessionAuthData = async (collection, sessionId) => {
  try {
    const result = await collection.deleteMany({ sessionId })
    logger.info(`Cleaned up auth data for ${sessionId}: ${result.deletedCount} documents`)
    return true
  } catch (error) {
    logger.error(`Failed to cleanup auth data for ${sessionId}:`, error)
    return false
  }
}

export const hasValidAuthData = async (collection, sessionId) => {
  const maxRetries = 3

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const creds = await collection.findOne({
        filename: 'creds.json',
        sessionId: sessionId
      }, { projection: { datajson: 1 } })

      if (!creds) {
        if (attempt === maxRetries) {
          logger.warn(`No auth credentials found for ${sessionId}`)
          return false
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        continue
      }

      const credsData = JSON.parse(creds.datajson, BufferJSON.reviver)
      const isValid = !!(credsData && credsData.noiseKey && credsData.signedIdentityKey)

      if (!isValid && attempt === maxRetries) {
        logger.error(`Invalid auth credentials structure for ${sessionId}`)
      }

      return isValid

    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`Auth validation error for ${sessionId}:`, error.message)
        return false
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }

  return false
}