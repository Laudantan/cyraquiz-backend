console.log("🔥 VERSIÓN NUEVA CARGADA - SI LEES ESTO, YA FUNCIONA");

if (process.env.NODE_ENV !== 'production') {
  require("dotenv").config();
}
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quizzes');
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-extraction");
const OpenAI = require("openai");

const app = express();

app.use(cors({
  origin: "https://cyraquiz.vercel.app",
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/quizzes', quizRoutes);

// ==========================================
// 🤖 CONFIGURACIÓN DE DEEPSEEK (IA)
// ==========================================
const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

// Configuración de carpeta uploads
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: uploadDir });

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// Memoria del juego (TUS SOCKETS ORIGINALES)
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  // 1. CREAR SALA (Profesor)
  socket.on("create_room", (roomCode) => {
    // Inicializamos la sala con preguntas vacías (se llenarán al iniciar)
   rooms.set(roomCode, { players: [], currentQuestion: 0, scores: {}, answerCounts: [0, 0, 0, 0] });
    socket.join(roomCode);
    console.log(`Sala creada: ${roomCode}`);
  });

  // 2. UNIRSE A SALA (Alumno)
  socket.on("join_room", ({ roomCode, playerName, avatar }) => {
if (!rooms.has(roomCode)) {
       console.log(`♻️ Recuperando sala ${roomCode} para ${playerName}`);
       rooms.set(roomCode, { players: [], currentQuestion: 0, scores: {}, answerCounts: [0, 0, 0, 0] });
    }
    if (rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      // Evitamos duplicados básicos (opcional)
      const existingPlayer = room.players.find(p => p.id === socket.id);
      
      if (!existingPlayer) {
        // Guardamos el avatar junto con el nombre y score
        room.players.push({ 
          id: socket.id, 
          name: playerName, 
          avatar: avatar || "https://api.dicebear.com/9.x/notionists/svg?seed=default", // Default por si acaso
          score: 0 
        });
      }

      socket.join(roomCode);
      // Avisamos al Host que alguien entró
      io.to(roomCode).emit("player_joined", { name: playerName, avatar });
      console.log(`${playerName} entró a la sala ${roomCode}`);
    } else {
      socket.emit("error", "Sala no encontrada");
    }
  });

  // 3. INICIAR JUEGO (ESTO ES LO QUE FALTABA) <--- AGREGA ESTO
  socket.on("start_game", (roomCode) => {
    const roomStr = roomCode.toString();
    console.log(`🚀 Intentando iniciar juego en sala: ${roomStr}`);

    if (rooms.has(roomStr)) {
      // A. AVISAR A TODOS LOS ALUMNOS (Grito General)
      // Usamos io.to() para asegurarnos que le llegue a todos los sockets en la sala
      io.to(roomStr).emit("game_started");
      
      console.log(`🎮 Juego iniciado en sala ${roomStr} (Señal enviada a todos)`);
    } else {
      console.log("❌ No se encontró la sala para iniciar");
    }
  });

  // 4. EL PROFE ENVÍA PREGUNTA (Y LA RESPUESTA CORRECTA PARA QUE EL SERVER SEPA)
  socket.on("send_question", ({ roomCode, question, time }) => {
    // Guardamos la respuesta correcta en la memoria de la sala
    const roomStr = roomCode.toString();
    if (rooms.has(roomStr)) {
      const room = rooms.get(roomStr);
      room.currentCorrectAnswer = question.answer; // Guardamos la clave
      room.currentPoints = question.points || 100; // Puntos de esta pregunta
      room.currentQuestionType = question.type;
      room.currentOptions = question.options; // Guardamos las opciones para saber cuál es cuál
      room.answerCounts = [0, 0, 0, 0]; // [Votos Opción A, Votos B, Votos C, Votos D]
    }

    // A los alumnos SOLO les enviamos las opciones (sin la respuesta correcta obvio)
    io.to(roomStr).emit("new_question", { 
      type: question.type, 
      options: question.options, 
      time: time 
    });
    console.log(`📡 Pregunta enviada a sala ${roomStr} (Tipo: ${question.type})`);
  });

  // 5. EL ALUMNO ENVÍA RESPUESTA -> SERVER CALIFICA -> RESPONDE RESULTADO
  socket.on("submit_answer", ({ roomCode, playerName, answer }) => {
    const roomStr = roomCode.toString();
    if (!rooms.has(roomStr)) return;

    const room = rooms.get(roomStr);
    const player = room.players.find(p => p.name === playerName);

    if (player) {
      // --- NUEVO: CONTAR EL VOTO PARA LA GRÁFICA ---
      if (room.currentOptions) {
        // Convertimos la respuesta en array (por si es selección múltiple)
        const answersArray = Array.isArray(answer) ? answer : [answer];
        
        answersArray.forEach(ans => {
          // Buscamos en qué índice está la respuesta (0, 1, 2 o 3)
          const cleanAns = typeof ans === 'string' ? ans.trim() : ans;
          const index = room.currentOptions.findIndex(opt => opt.trim() === cleanAns);
          
          if (index !== -1 && index < 4) {
            room.answerCounts[index] += 1; // Sumamos 1 a la barrita correspondiente
          }
        });

        io.to(roomStr).emit("update_stats", room.answerCounts);
        }

      // Lógica de calificación
      let isCorrect = false;
      if (room.currentQuestionType === "multi") {
        // Para selección múltiple, comparamos arrays (ordenados para evitar errores)
        // Ejemplo: Si la respuesta es ["A", "B"] y el alumno manda ["B", "A"], es correcto.
        const correctArr = Array.isArray(room.currentCorrectAnswer) ? room.currentCorrectAnswer.sort() : [];
        const answerArr = Array.isArray(answer) ? answer.sort() : [];
        
        // Comparamos longitudes y contenido
        isCorrect = JSON.stringify(correctArr) === JSON.stringify(answerArr);
      } else {
        // Para Single o True/False
        isCorrect = room.currentCorrectAnswer === answer;
      }

      // Sumar Puntos
      const pointsEarned = isCorrect ? room.currentPoints : 0;
      player.score += pointsEarned;

      // Avisamos al Host (para el contador de respuestas)
      io.to(roomStr).emit("player_answered", { playerName });

      // Avisamos AL ALUMNO su resultado personal (Privado)
      io.to(player.id).emit("answer_result", { 
        isCorrect, 
        pointsEarned, 
        totalScore: player.score 
      });

      console.log(`📝 ${playerName} respondió. Correcto: ${isCorrect}. Puntos: ${player.score}`);
    }
  });
  
socket.on("show_results", (roomCode) => {
    const roomStr = roomCode.toString();
    io.to(roomStr).emit("reveal_results");
  });

  // 6. FIN DEL JUEGO (Host entra al Podio)
  socket.on("game_over", (roomCode) => {
    const roomStr = roomCode.toString();
    if (rooms.has(roomStr)) {
      const room = rooms.get(roomStr);
      // Ordenamos por puntaje de mayor a menor
      const sortedPlayers = room.players.sort((a, b) => b.score - a.score);
      
      // Enviamos la lista final a TODOS (Host y Alumnos)
      io.to(roomStr).emit("final_results", sortedPlayers);
      console.log(`🏁 Juego terminado en sala ${roomStr}`);
    }
  });

  socket.on("cancel_game", (roomCode) => {
    const roomStr = roomCode.toString();
    // Le avisamos a todos los alumnos de esa sala
    io.to(roomStr).emit("game_cancelled");
    
    // Limpiamos la sala de la memoria del servidor
    rooms.delete(roomStr);
    console.log(`🛑 Partida cancelada en sala ${roomStr}`);
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado:", socket.id);
  });
});

// ==========================================
// 📤 RUTA: SUBIR PDF Y GENERAR MIX DE PREGUNTAS
// ==========================================
app.post('/upload', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se subió ningún archivo PDF" });
    }

    console.log("📂 Procesando archivo:", req.file.originalname);

    // 1. Leer el PDF
    const dataBuffer = fs.readFileSync(req.file.path);
    const data = await pdf(dataBuffer);
    const text = data.text;

    console.log("📊 Solicitando un borrador de 2' preguntas variadas a la IA...");
    
    // 3. Prompt Dinámico para los 3 Tipos
    const prompt = `
      Actúa como un profesor experto. Basado en el siguiente texto: 
      "${text.substring(0, 60000)}"

      Genera un examen de EXACTAMENTE 20 preguntas distribuidas así.
      Mezcla los tipos de preguntas como tú creas conveniente para evaluar bien el texto.

      Reglas para los tipos de preguntas:
      1. "single" (Opción múltiple): 4 opciones en el arreglo "options". La "answer" es un string con la opción correcta.
      2. "multi" (Doble respuesta): 4 opciones. EXACTAMENTE 2 correctas. La "answer" es un ARRAY con las dos opciones.
      3. "tf" (Verdadero/Falso): "options" debe ser exactamente ["Verdadero", "Falso"]. La "answer" es un string.

      IMPORTANTE:
      - Devuelve SOLAMENTE un JSON puro (array de objetos).
      - No uses markdown (\`\`\`).

      Ejemplo de estructura JSON esperada:
      [
        { 
          "type": "single", 
          "question": "¿Capital de Francia?", 
          "options": ["Madrid", "París", "Roma", "Berlin"], 
          "answer": "París" 
        },
        { 
          "type": "multi", 
          "question": "¿Cuáles son frutas? (Elige 2)", 
          "options": ["Manzana", "Coche", "Plátano", "Silla"], 
          "answer": ["Manzana", "Plátano"] 
        },
        { 
          "type": "tf", 
          "question": "El sol es frío.", 
          "options": ["Verdadero", "Falso"], 
          "answer": "Falso" 
        }
      ]
    `;

    // 4. Llamar a DeepSeek
    const completion = await deepseek.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "deepseek-chat",
      temperature: 0.7
    });

    // 5. Limpiar respuesta
    let aiResponse = completion.choices[0].message.content;
    aiResponse = aiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const questions = JSON.parse(aiResponse);

    // 6. Limpiar archivo temporal
    fs.unlinkSync(req.file.path);

    res.json({ 
      success: true, 
      questions: questions 
    });

  } catch (error) {
    console.error("❌ Error generando preguntas:", error);
    res.status(500).json({ error: "Error procesando el examen con IA." });
  }
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server listening on port ${PORT}`);
});