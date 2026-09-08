const { Pool } = require("pg");
require("dotenv").config();

// Direct host check to disable SSL locally, enable on Render/Supabase
const isLocal =
  process.env.DB_HOST === "localhost" ||
  process.env.DB_HOST === "127.0.0.1" ||
  !process.env.DB_HOST;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 6543,
  database: process.env.DB_NAME || "postgres",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.connect((err, client, release) => {
  if (err) {
    console.error("❌ RENDER DB CONNECTION ERROR:", err.message);
  } else {
    console.log("✅ RENDER CONNECTED TO SUPABASE POSTGIS!");
    release();
  }
});

module.exports = pool;