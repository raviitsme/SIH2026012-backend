const { Pool } = require('pg');
require('dotenv').config();

// Direct host checking for local environment
const isLocal = process.env.DB_HOST === 'localhost' || process.env.DB_HOST === '127.0.0.1';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

module.exports = pool;