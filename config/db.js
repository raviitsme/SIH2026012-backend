const { Pool } = require('pg');
require('dotenv').config();

// Explicit check: Render environment mein NODE_ENV 'production' hota hai ya DB_HOST explicitly remote host hota hai
const isProduction = process.env.NODE_ENV === 'production' || process.env.DB_HOST?.includes('supabase.co');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

module.exports = pool;