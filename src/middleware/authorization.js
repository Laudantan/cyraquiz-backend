const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res, next) => {
  try {
    const jwtToken = req.header("token") || req.header("Authorization")?.replace("Bearer ", "");

    if (!jwtToken) {
      return res.status(403).json("No autorizado: Falta el token");
    }

    const { data: { user }, error } = await supabase.auth.getUser(jwtToken);

    if (error || !user) {
      return res.status(403).json("No autorizado: Token inválido o expirado");
    }

    req.user = user; 
    next();
    
  } catch (err) {
    console.error(err.message);
    return res.status(403).json("Error de autenticación");
  }
};