import express from "express"
import dotenv from "dotenv"
import { createComponentLogger } from "./utils/logger.js"
import { testConnection, closePool } from "./config/database.js"
import { WebInterface } from "./web/index.js"
import cookieParser from 'cookie-parser'

dotenv.config()

// GUARD: Prevent multiple instances
if (global.__APP_INSTANCE_RUNNING__) {
  console.log('[GUARD] Application instance already running, exiting...')
  process.exit(0)
}
global.__APP_INSTANCE_RUNNING__ = true


const logger = createComponentLogger("WEB_SERVER")
const PORT = process.env.WEB_PORT || 3000
const app = express()

// NO Telegram Bot
// NO Event Handlers
// NO Message Processing
// ONLY: Connection + Pairing + Auth

let webInterface = null
let server = null
let isInitialized = false
let mongoStorage = null

// Setup middleware
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))
app.use(express.static("public"))
app.use(cookieParser())

// Setup web interface routes
//webInterface = new WebInterface()
//app.use('/', webInterface.router)

// Health endpoints
app.get("/health", async (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    initialized: isInitialized,
    components: {
      database: true,
      webInterface: !!webInterface,
      mongoConnected: mongoStorage?.isConnected || false
    }
  }
  res.json(health)
})

app.get("/api/status", async (req, res) => {
  res.json({
    platform: "WhatsApp Web Connection Server",
    status: isInitialized ? "operational" : "initializing",
    role: "connection_only",
    eventHandlers: false,
    messageProcessing: false
  })
})

// Initialize web server
async function initializeWebServer() {
  if (isInitialized) {
    logger.warn("Web server already initialized")
    return
  }

  logger.info("Starting Web Connection Server...")
  
  try {
    // 1. Database - MongoDB ONLY (for shared session storage)
    logger.info("Connecting to database...")
    await testConnection()
    
    // Warmup MongoDB connection pool
    for (let i = 0; i < 3; i++) {
      await testConnection()
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    logger.info("Initializing web interface...")
    webInterface = new WebInterface()
    app.use('/', webInterface.router)
    logger.info("Web interface routes configured")

    // 3. HTTP Server
    server = app.listen(PORT, () => {
      logger.info(`Web Connection Server running on port ${PORT}`)
      logger.info(`Web Interface: http://localhost:${PORT}`)
      logger.info(`Health Check: http://localhost:${PORT}/health`)
      logger.info(`Role: Connection + Pairing ONLY`)
      logger.info(`Event Handlers: DISABLED`)
      logger.info(`Message Processing: DISABLED`)
    })

    isInitialized = true
    logger.info("Web server initialization completed successfully!")

    // 4. Maintenance tasks (connection cleanup only)
    setupMaintenanceTasks()

  } catch (error) {
    logger.error("Web server initialization failed:", error)
    process.exit(1)
  }
}

// Maintenance tasks (minimal - just cleanup)
function setupMaintenanceTasks() {
  let maintenanceRunning = false

  setInterval(async () => {
    if (maintenanceRunning) return
    
    maintenanceRunning = true
    
    try {
      if (mongoStorage?.isConnected) {
        await testConnection()
      }
    } catch (error) {
      logger.error("Maintenance error:", error.message)
    } finally {
      maintenanceRunning = false
    }
  }, 600000) // 10 minutes
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`Shutting down (${signal})...`)
  
  try {
    if (server) {
      server.close()
    }

    // Close storage
    if (mongoStorage) {
      await mongoStorage.close()
    }

    await closePool()
    
    logger.info("Shutdown completed")
    process.exit(0)
  } catch (error) {
    logger.error("Shutdown error:", error)
    process.exit(1)
  }
}

// Signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error)
  gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason)
})

// Start web server
initializeWebServer().catch((error) => {
  logger.error("Failed to start:", error)
  process.exit(1)
})
