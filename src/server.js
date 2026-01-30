require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-extraction");
const OpenAI = require("openai"); // <--- Importamos la librería

const app = express();

app.use(cors());
app.use(express.json());

// ==========================================
// 🤖 CONFIGURACIÓN DE DEEPSEEK (IA)
// ==========================================
const deepseek = new OpenAI({
  baseURL: 'https://api.deepseek.com', // La dirección de DeepSeek
  apiKey: process.env.DEEPSEEK_API_KEY// <--- ¡PON TU KEY AQUÍ!
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

// Memoria del juego
const rooms = new Map();

// ==========================================
// 🔌 SOCKETS
// ==========================================
io.on("connection", (socket) => {
  console.log("✅ Socket conectado:", socket.id);

  socket.on("create_room", ({ roomCode }) => {
    if (!roomCode) return;
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.role = "host";

    if (rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      room.hostId = socket.id;
      const currentPlayers = Array.from(room.players.values());
      socket.emit("update_players", currentPlayers);
    } else {
      rooms.set(roomCode, { hostId: socket.id, players: new Map(), questions: [] });
      socket.emit("room_created", { roomCode });
    }
  });

  socket.on("join_room", ({ roomCode, name }) => {
    const rc = (roomCode || "").trim();
    const nm = (name || "").trim();

    if (!rooms.has(rc)) {
      socket.emit("join_error", { message: "Sala no encontrada" });
      return;
    }

    const room = rooms.get(rc);
    socket.join(rc);
    socket.data.roomCode = rc;
    socket.data.name = nm;
    socket.data.role = "player";

    const playerData = { id: socket.id, name: nm, score: 0 };
    room.players.set(socket.id, playerData);

    socket.emit("joined_ok", { roomCode: rc });

    const allPlayers = Array.from(room.players.values());
    io.to(rc).emit("update_players", allPlayers);
    if (room.hostId) io.to(room.hostId).emit("update_players", allPlayers);
  });

  socket.on("disconnect", () => {
    const { roomCode, role, name } = socket.data;
    if (roomCode && rooms.has(roomCode)) {
      const room = rooms.get(roomCode);
      if (role === "player") {
        room.players.delete(socket.id);
        const allPlayers = Array.from(room.players.values());
        io.to(roomCode).emit("update_players", allPlayers);
        if (room.hostId) io.to(room.hostId).emit("update_players", allPlayers);
      }
    }
  });
});

// ==========================================
// 🧠 RUTA: LEER PDF + GENERAR PREGUNTAS (IA)
// ==========================================
app.post("/upload", upload.single("pdfFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No hay archivo" });

    console.log("📂 Procesando PDF con DeepSeek...");

    // 1. Extraer texto del PDF
    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdf(dataBuffer);
    const text = pdfData.text.trim().substring(0, 3000); // Limitamos a 3000 caracteres para no gastar tanto token

    // 2. Preguntar a la IA (DeepSeek)
    console.log("🤖 Consultando a DeepSeek...");
    
    const prompt = `
      Actúa como un profesor experto. Analiza el siguiente texto extraído de un documento:
      "${text}"
      
      Genera 5 preguntas de opción múltiple basadas en este texto.
      El formato DEBE ser un JSON puro (array de objetos), sin texto extra ni formato markdown.
      Estructura esperada:
      [
        {
          "question": "¿Pregunta?",
          "options": ["A", "B", "C", "D"],
          "answer": "La respuesta correcta exacta"
        }
      ]
    `;

    const completion = await deepseek.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "deepseek-chat", // Modelo de DeepSeek
      temperature: 0.7
    });

    // 3. Limpiar la respuesta de la IA
    let aiContent = completion.choices[0].message.content;
    
    // A veces la IA devuelve "```json ... ```", hay que limpiarlo
    aiContent = aiContent.replace(/```json/g, "").replace(/```/g, "").trim();

    const questions = JSON.parse(aiContent);

    console.log("✅ ¡Preguntas generadas!", questions.length);

    fs.unlinkSync(req.file.path); // Borrar temporal

    res.json({ 
      success: true, 
      textPreview: text.substring(0, 100) + "...",
      questions: questions // Enviamos las preguntas al Frontend
    });

  } catch (error) {
    console.error("❌ Error IA:", error);
    res.status(500).json({ error: "Error generando preguntas: " + error.message });
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor IA corriendo en http://localhost:${PORT}`);
});