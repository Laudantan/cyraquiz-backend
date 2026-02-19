const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Conectamos con tu proyecto de Supabase
const supabaseUrl = process.env.SUPABASE_URL; 
const supabaseKey = process.env.SUPABASE_KEY; 
const supabase = createClient(supabaseUrl, supabaseKey);

// 1. REGISTRO OFICIAL CON SUPABASE
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    // Le decimos a Supabase que registre al usuario
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
    });

    // Si el correo ya existe o la contraseña es muy débil, Supabase nos avisa
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: "Usuario creado en Supabase", user: data.user });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error en el servidor al registrar");
  }
});

// 2. LOGIN OFICIAL CON SUPABASE
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Le pedimos a Supabase que intente iniciar sesión
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password,
    });

    // Si la contraseña está mal o (MÁS IMPORTANTE) si no ha confirmado su correo, da error
    if (error) {
      // Traducimos el error común de Supabase para que sea amigable
      const msj = error.message.includes("Email not confirmed") 
        ? "Por favor, confirma tu correo antes de iniciar sesión." 
        : "Credenciales incorrectas";
      return res.status(400).json({ error: msj });
    }

    // Supabase nos devuelve un Token súper seguro (access_token)
    res.json({ 
      message: "Login exitoso", 
      token: data.session.access_token, 
      user: data.user 
    });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error en el servidor al iniciar sesión");
  }
});

module.exports = router;