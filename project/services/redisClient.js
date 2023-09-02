const { createClient } = require('redis');
const logger = require('./loggerService');

let client = null;
let status = 'disabled';

async function initRedis() {
  if (!process.env.REDIS_URL) {
    status = 'not_configured';
    logger.info('Redis not configured (REDIS_URL missing); using local in-memory storage');
    return null;
  }
  try {
    client = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD || undefined,
      socket: { reconnectStrategy: (retries) => Math.min(retries * 50, 1000) }
    });

    client.on('error', err => {
      status = 'error';
      logger.error('Redis error:', err.message);
    });
    client.on('reconnecting', () => { status = 'reconnecting'; });
    client.on('end', () => { status = 'disconnected'; });
    client.on('connect', () => { status = 'connected'; logger.info('✅ Redis connected'); });

    await client.connect();
    status = 'connected';
    return client;
  } catch (e) {
    status = 'failed';
    logger.error('Failed to connect to Redis, falling back to local memory:', e.message);
    client = null;
    return null;
  }
}

function getRedisClient() { return client; }
function getRedisStatus() { return status; }

module.exports = { initRedis, getRedisClient, getRedisStatus };
