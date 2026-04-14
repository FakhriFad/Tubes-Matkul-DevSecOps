const Redis  = require('ioredis');
const logger = require('./logger');

const redis = new Redis({
  host:     process.env.REDIS_HOST || 'redis',
  port:     parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => Math.min(times * 50, 2000),
});

redis.on('error',   (err) => logger.error('Redis error', { message: err.message }));
redis.on('connect', ()    => logger.info('Redis connected'));

module.exports = redis;
