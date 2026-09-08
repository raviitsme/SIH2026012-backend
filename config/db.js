const { Pool } = require('pg');
const { parse } = require('pg-connection-string');
require('dotenv').config();

// Direct URL parse karke clean config object banayenge
const dbConfig = parse(process.env.DATABASE_URL || '');

const pool = new Pool({
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password,
  ssl: {
    rejectUnauthorized: false // Direct property assignment ab override nahi ho sakti
  }
});

module.exports = pool;