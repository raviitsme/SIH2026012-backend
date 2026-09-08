const { Pool } = require("pg");
require("dotenv").config();

const isLocal =
  process.env.DB_HOST === "localhost" ||
  process.env.DB_HOST === "127.0.0.1" ||
  !process.env.DB_HOST;

// Prioritize connectionString for Supabase Pooler SNI resolution
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ RENDER DB CONNECTION ERROR:", err.message);
  } else {
    console.log("✅ RENDER CONNECTED TO SUPABASE POSTGIS (TRANSACTION POOLER)!");
    release();
  }
});

module.exports = pool;