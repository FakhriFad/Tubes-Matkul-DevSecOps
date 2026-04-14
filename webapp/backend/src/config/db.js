const { Pool } = require('pg');
const logger   = require('./logger');

const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'postgres',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB       || 'ecommerce',
  user:     process.env.POSTGRES_USER     || 'ecom_user',
  password: process.env.POSTGRES_PASSWORD || 'ecom_pass',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected PG pool error', { message: err.message });
});

module.exports = pool;
