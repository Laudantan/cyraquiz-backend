const router = require("express").Router();
const db = require("../db"); // Tu conexión a Supabase
const authorization = require("../middleware/authorization"); // El guardia

// 1. GUARDAR UN NUEVO QUIZ (Solo profes logueados)
router.post("/", authorization, async (req, res) => {
  try {
    const { title, description, questions } = req.body;
    
    // El middleware ya desencriptó el token y puso los datos en req.user
    const userId = req.user.id; 

    // Guardamos en la BD
    const newQuiz = await db.query(
      "INSERT INTO quizzes (user_id, title, description, questions) VALUES ($1, $2, $3, $4) RETURNING *",
      [userId, title, description || "", JSON.stringify(questions)]
    );

    console.log("💾 Quiz guardado:", newQuiz.rows[0].title);
    res.json(newQuiz.rows[0]);
    
  } catch (err) {
    cconsole.error("SAVE QUIZ ERROR:", err); // <- importante
  res.status(500).json({ error: "Error al guardar Quiz" });
  }
});

// 2. OBTENER MIS QUIZZES (Para el Dashboard del Profe)
router.get("/", authorization, async (req, res) => {
  try {
    const userId = req.user.id;

    const allQuizzes = await db.query(
      "SELECT * FROM quizzes WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    res.json(allQuizzes.rows);
  } catch (err) {
    console.error("SAVE QUIZ ERROR:", err); // <- importante
  res.status(500).json({ error: "Error al guardar Quiz" });
  }
});

// 3. OBTENER UN QUIZ POR ID (Público - Para jugar)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // OJO: Postgres a veces devuelve el ID como string o number, ambos funcionan
    const quiz = await db.query("SELECT * FROM quizzes WHERE id = $1", [id]);

    if (quiz.rows.length === 0) {
      return res.status(404).json("Quiz no encontrado");
    }

    const data = quiz.rows[0];
    
    // Devolvemos en el formato que le gusta a tu Frontend
    res.json({
      id: data.id,
      title: data.title,
      description: data.description,
      questionsData: data.questions // Postgres ya lo convierte a objeto solito
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Error del servidor");
  }
});

// 4. ACTUALIZAR UN QUIZ EXISTENTE (PUT)
router.put("/:id", authorization, async (req, res) => {
  try {
    const { id } = req.params; // El ID del quiz a editar
    const { title, questions } = req.body; // Los nuevos datos
    const userId = req.user.id; // El ID del profe (seguridad)

    // Solo actualizamos si el ID del quiz coincide Y si pertenece al usuario logueado
    const updateQuiz = await db.query(
      "UPDATE quizzes SET title = $1, questions = $2 WHERE id = $3 AND user_id = $4 RETURNING *",
      [title, JSON.stringify(questions), id, userId]
    );

    if (updateQuiz.rows.length === 0) {
      return res.status(404).json("No se encontró el quiz o no es tuyo");
    }

    console.log("✏️ Quiz actualizado:", updateQuiz.rows[0].title);
    res.json(updateQuiz.rows[0]);

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Error al actualizar Quiz");
  }
});

// 5. ELIMINAR UN QUIZ (DELETE)
router.delete("/:id", authorization, async (req, res) => {
  try {
    const { id } = req.params; // ID del quiz a borrar
    const userId = req.user.id; // ID del profe que lo intenta borrar

    // Eliminamos solo si el ID coincide Y es del usuario logueado
    const deleteQuiz = await db.query(
      "DELETE FROM quizzes WHERE id = $1 AND user_id = $2 RETURNING *",
      [id, userId]
    );

    // Si no borró nada, es porque no existía o no era suyo
    if (deleteQuiz.rows.length === 0) {
      return res.status(404).json("No se encontró el examen o no tienes permiso para eliminarlo");
    }

    console.log("🗑️ Quiz eliminado exitosamente:", id);
    res.json({ message: "Examen eliminado correctamente" });

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Error al eliminar el Quiz");
  }
});


module.exports = router;