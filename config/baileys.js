import NodeCache from "node-cache"
import { Browsers } from "@whiskeysockets/baileys"
import { logger } from "../utils/logger.js"
import pino from "pino"

// Smart group cache with invalidation on updates
const groupCache = new NodeCache({ 
  stdTTL: 1800, // 30 minutes default TTL
  checkperiod: 300, // Check for expired entries every 5 minutes
  useClones: false
})

export const baileysConfig = {
  logger: pino({ level: "silent" }),
  printQRInTerminal: false,
  msgRetryCounterMap: {},
    browser: Browsers.windows('safari'),
  retryRequestDelayMs: 250,
  markOnlineOnConnect: false,
    version: [2, 3000, 1025190524],
  emitOwnEvents: true,
  patchMessageBeforeSending: (msg) => {
      if (msg.contextInfo) delete msg.contextInfo.mentionedJid;
          return msg;
        },
  appStateSyncInitialTimeoutMs: 10000,
  generateHighQualityLinkPreview: true
}


