const { Pool } = require('pg');
require('dotenv').config();

// Explicit Fallback for Supabase Pooler
const host = process.env.DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com';
const user = process.env.DB_USER || 'postgres.ncdjagphgggtydrpbxar';
const password = process.env.DB_PASSWORD || ''; // Ensure your password is set in Render
const database = process.env.DB_NAME || 'postgres';
const port = Number(process.env.DB_PORT) || 6543;

const pool = new Pool({
  host,
  port,
  database,
  user,
  password,
  ssl: {
    rejectUnauthorized: false
  }
});

// Initial Connection Test to print error directly on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ DB CONNECTION FAILURE ON STARTUP:', err.message);
  } else {
    console.log('✅ DATABASE CONNECTED SUCCESSFULLY!');
    release();
  }
});

module.exports = pool;