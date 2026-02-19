const { Pool } = require('pg');
require('dotenv').config();

// Usamos Pool en lugar de Client porque es mejor para aplicaciones web
// Permite múltiples conexiones simultáneas (necesario para cuando entren muchos alumnos)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};