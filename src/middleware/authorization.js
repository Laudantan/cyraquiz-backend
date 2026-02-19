const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Conectamos a tu proyecto de Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = async (req, res, next) => {
  try {
    // 1. Tomamos el token ("gafete") que el frontend nos manda
    const jwtToken = req.header("token") || req.header("Authorization")?.replace("Bearer ", "");

    if (!jwtToken) {
      return res.status(403).json("No autorizado: Falta el token");
    }

    // 2. Le pedimos a Supabase que verifique si el gafete es original
    const { data: { user }, error } = await supabase.auth.getUser(jwtToken);

    if (error || !user) {
      return res.status(403).json("No autorizado: Token inválido o expirado");
    }

    // 3. ¡Todo en orden! Le pasamos el usuario (con su UUID) a tus rutas de quizzes.js
    req.user = user; 
    
    // Lo dejamos pasar a la ruta que quería entrar
    next();
    
  } catch (err) {
    console.error(err.message);
    return res.status(403).json("Error de autenticación");
  }
};