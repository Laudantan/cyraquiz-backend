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

const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const upload = multer({ dest: uploadDir });

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  // CREAR SALA
  socket.on("create_room", (roomCode) => {
   rooms.set(roomCode, { players: [], currentQuestion: 0, scores: {}, answerCounts: [0, 0, 0, 0] });
    socket.join(roomCode);
    console.log(`Sala creada: ${roomCode}`);
  });

  // UNIRSE A SALA
  socket.on("join_room", ({ roomCode, playerName, avatar }) => {
if (!rooms.has(roomCode)) {
       console.log(`Recuperando sala ${roomCode} para ${playerName}`);
       rooms.set(roomCode, { players: [], currentQuestion: 0, scores: {}, answerCounts: [0, 0, 0, 0] });
    }
    
      const room = rooms.get(roomCode);
      const existingPlayer = room.players.find(p => p.name === playerName);
      
      if (!existingPlayer) {
        room.players.push({ 
          id: socket.id, 
          name: playerName, 
          avatar: avatar || "https://api.dicebear.com/9.x/notionists/svg?seed=default",
          score: 0,
          timeAccumulated: 0
        });
      }else {
        existingPlayer.id = socket.id;
        console.log(`Jugador ${playerName} recuperó su sesión con nuevo ID.`);
      }

      socket.join(roomCode);
      io.to(roomCode).emit("player_joined", { name: playerName, avatar });
      console.log(`${playerName} entró a la sala ${roomCode}`);
      if (room.isAnswering && room.currentOptions) {
      console.log(`Rescatando a ${playerName}: Enviando pregunta en curso.`);
      socket.emit("new_question", {
        type: room.currentQuestionType,
        options: room.currentOptions,
        time: room.currentTimeLimit 
      });
    }
  });

  socket.on("start_game", (roomCode) => {
    const roomStr = roomCode.toString();
    console.log(`Intentando iniciar juego en sala: ${roomStr}`);

    if (rooms.has(roomStr)) {
      io.to(roomStr).emit("game_started");
      
      console.log(`Juego iniciado en sala ${roomStr} (Señal enviada a todos)`);
    } else {
      console.log("No se encontró la sala para iniciar");
    }
  });

  socket.on("send_question", ({ roomCode, question, time }) => {
    const roomStr = roomCode.toString();
    if (rooms.has(roomStr)) {
      const room = rooms.get(roomStr);
      room.currentCorrectAnswer = question.answer; 
      room.currentPoints = question.points || 100; 
      room.currentQuestionType = question.type;
      room.currentOptions = question.options;
      room.answerCounts = [0, 0, 0, 0]; 
      room.questionStartTime = Date.now();
      room.currentTimeLimit = time; 
      room.isAnswering = true;
    }

    io.to(roomStr).emit("new_question", { 
      type: question.type, 
      options: question.options, 
      time: time 
    });
    console.log(`Pregunta enviada a sala ${roomStr} (Tipo: ${question.type})`);
  });

  socket.on("submit_answer", ({ roomCode, playerName, answer }) => {
    const roomStr = roomCode.toString();
    if (!rooms.has(roomStr)) return;

    const room = rooms.get(roomStr);
    const player = room.players.find(p => p.name === playerName);

    if (player) {
      if (room.currentOptions) {
        const answersArray = Array.isArray(answer) ? answer : [answer];
        
        answersArray.forEach(ans => {
          const cleanAns = typeof ans === 'string' ? ans.trim() : ans;
          const index = room.currentOptions.findIndex(opt => opt.trim() === cleanAns);
          
          if (index !== -1 && index < 4) {
            room.answerCounts[index] += 1; 
          }
        });

        io.to(roomStr).emit("update_stats", room.answerCounts);
        }

      let isCorrect = false;
      if (room.currentQuestionType === "multi") {
        const correctArr = Array.isArray(room.currentCorrectAnswer) ? room.currentCorrectAnswer.sort() : [];
        const answerArr = Array.isArray(answer) ? answer.sort() : [];
        
        isCorrect = JSON.stringify(correctArr) === JSON.stringify(answerArr);
      } else {
        isCorrect = room.currentCorrectAnswer === answer;
      }

      const timeTaken = Date.now() - room.questionStartTime;

      const pointsEarned = isCorrect ? room.currentPoints : 0;
      player.score += pointsEarned;

      if (isCorrect) {
        player.timeAccumulated += timeTaken;
      }

      io.to(roomStr).emit("player_answered", { playerName });

      io.to(player.id).emit("answer_result", { 
        isCorrect, 
        pointsEarned, 
        totalScore: player.score 
      });

      console.log(`${playerName} respondió. Correcto: ${isCorrect}. Puntos: ${player.score}`);
    }
  });
  
socket.on("show_results", (roomCode) => {
    const roomStr = roomCode.toString();
    if (rooms.has(roomStr)) {
      rooms.get(roomStr).isAnswering = false; 
    }
    io.to(roomStr).emit("reveal_results");
  });

  // FIN DEL JUEGO
  socket.on("game_over", (roomCode) => {
    const roomStr = roomCode.toString();
    if (rooms.has(roomStr)) {
      const room = rooms.get(roomStr);
      const sortedPlayers = room.players.sort((a, b) => {
        if (b.score === a.score) {
          return a.timeAccumulated - b.timeAccumulated;
        }
        return b.score - a.score; 
      });
      
      io.to(roomStr).emit("final_results", sortedPlayers);
      console.log(`Juego terminado en sala ${roomStr}`);
    }
  });

  socket.on("cancel_game", (roomCode) => {
    const roomStr = roomCode.toString();
    io.to(roomStr).emit("game_cancelled");
    
    rooms.delete(roomStr);
    console.log(`Partida cancelada en sala ${roomStr}`);
  });

  socket.on("disconnect", () => {
    console.log("Usuario desconectado:", socket.id);
  });
});

app.post('/upload', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No se subió ningún archivo PDF" });
    }
    
    const usarNuevoPrompt = req.body.casillaMarcada === 'true';
    
    console.log("Procesando archivo:", req.file.originalname);
    console.log("¿Usar nuevo prompt?:", usarNuevoPrompt);

    // Leer el PDF
    const dataBuffer = fs.readFileSync(req.file.path);
    const data = await pdf(dataBuffer);
    const text = data.text;

    console.log("Solicitando preguntas variadas a la IA...");

    let instruccionesEspecificas = "";

    if (usarNuevoPrompt) {
      instruccionesEspecificas = `
      El texto proporcionado es un examen o cuestionario que YA CONTIENE preguntas y respuestas. 
      Tu tarea es EXTRAER un MÁXIMO DE 40 PREGUNTAS. Si el documento tiene más, detente al llegar a 40. Si tiene menos, extrae solo las que haya.
      
      REGLAS ESTRICTAS PARA LA EXTRACCIÓN:
      1. MANTÉN EL ORDEN EXACTO en el que aparecen en el documento original. Por ningún motivo las revuelvas.
      2. NO inventes preguntas nuevas ni agregues información que no esté en el texto.
      3. Analiza el formato original de cada pregunta en el PDF y asígnale el tipo correspondiente ("single", "multi" o "tf") respetando fielmente cómo vienen estructuradas.
      `;
    } else {
      instruccionesEspecificas = `
      Genera un examen de EXACTAMENTE 20 preguntas distribuidas así.
      Mezcla los tipos de preguntas como tú creas conveniente para evaluar bien el texto.
      `;
    }
    
    const prompt = `
      Actúa como un profesor experto. Basado en el siguiente texto: 
      "${text.substring(0, 90000)}"

      ${instruccionesEspecificas}

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

    const completion = await deepseek.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "deepseek-chat",
      temperature: 0.7,
      max_tokens: 8000
    });

    let aiResponse = completion.choices[0].message.content;
    aiResponse = aiResponse.replace(/```json/g, "").replace(/```/g, "").trim();
    
    const questions = JSON.parse(aiResponse);

    fs.unlinkSync(req.file.path);

    res.json({ 
      success: true, 
      questions: questions 
    });

  } catch (error) {
    console.error("Error generando preguntas:", error);
    res.status(500).json({ error: "Error procesando el examen con IA." });
  }
});

const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});