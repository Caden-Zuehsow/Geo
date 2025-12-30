// server.js (ESM)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// --- ESM dirname fix ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- App setup ---
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// --- Game config ---
const MAX_PLAYERS = 6;

// --- In-memory rooms ---
/*
room = {
  players: [socketId],
  scores: { socketId: number },
  pickerIndex: number,
  currentRound: {
    lat,
    lng,
    pickerId,
    guesses: { socketId: { lat, lng } }
  } | null
}
*/
const rooms = {};

// --- Helpers ---
function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function haversineDistMeters(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreFromDistance(distMeters) {
  const miles = distMeters / 1609.34;
  if (miles <= 1) return 1000;
  return Math.max(0, 1000 - Math.round(miles));
}

// --- Socket logic ---
io.on("connection", socket => {
  console.log("connected:", socket.id);

  // ---- Create room ----
  socket.on("createRoom", cb => {
    const id = makeRoomId();

    rooms[id] = {
      players: [socket.id],
      scores: { [socket.id]: 0 },
      pickerIndex: 0,
      currentRound: null
    };

    socket.join(id);
    cb({ ok: true, roomId: id });
  });

  // ---- Join room ----
  socket.on("joinRoom", (roomId, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, err: "Room not found" });
    if (room.players.length >= MAX_PLAYERS)
      return cb({ ok: false, err: "Room full" });

    room.players.push(socket.id);
    room.scores[socket.id] = 0;
    socket.join(roomId);

    io.to(roomId).emit("roomJoined", {
      players: room.players,
      scores: room.scores,
      pickerSocketId: room.players[room.pickerIndex]
    });

    cb({ ok: true });
  });

  // ---- Picker chooses location ----
  socket.on("pickLocation", (data, cb) => {
    const room = rooms[data.roomId];
    if (!room) return cb?.({ ok: false });

    const pickerId = room.players[room.pickerIndex];
    if (socket.id !== pickerId)
      return cb?.({ ok: false, err: "Not picker" });

    room.currentRound = {
      lat: data.lat,
      lng: data.lng,
      pickerId,
      guesses: {}
    };

    room.players.forEach(id => {
      if (id !== pickerId) {
        io.to(id).emit("startGuess", {
          lat: data.lat,
          lng: data.lng,
          hint: data.hint || null
        });
      }
    });

    cb?.({ ok: true });
  });

  // ---- Guesser submits guess ----
  socket.on("makeGuess", (data, cb) => {
    const room = rooms[data.roomId];
    if (!room || !room.currentRound)
      return cb?.({ ok: false });

    const round = room.currentRound;
    if (socket.id === round.pickerId) return;
    if (round.guesses[socket.id]) return; // no double guesses

    round.guesses[socket.id] = {
      lat: data.lat,
      lng: data.lng
    };

    const guessers = room.players.filter(
      id => id !== round.pickerId
    );

    // Wait until all guessers guessed
    if (Object.keys(round.guesses).length < guessers.length) {
      cb?.({ ok: true, waiting: true });
      return;
    }

    // --- Score round ---
    guessers.forEach(id => {
      const g = round.guesses[id];
      const dist = haversineDistMeters(
        round.lat,
        round.lng,
        g.lat,
        g.lng
      );
      const points = scoreFromDistance(dist);

      room.scores[id] = (room.scores[id] || 0) + points;

      io.to(id).emit("roundResult", {
        correct: { lat: round.lat, lng: round.lng },
        distanceMeters: Math.round(dist),
        pointsAwarded: points,
        scores: room.scores
      });
    });

    // Advance picker
    room.currentRound = null;
    room.pickerIndex =
      (room.pickerIndex + 1) % room.players.length;

    setTimeout(() => {
      io.to(data.roomId).emit("newRound", {
        pickerSocketId: room.players[room.pickerIndex],
        scores: room.scores
      });
    }, 1500);

    cb?.({ ok: true });
  });

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    for (const [roomId, room] of Object.entries(rooms)) {
      if (!room.players.includes(socket.id)) continue;

      room.players = room.players.filter(id => id !== socket.id);
      delete room.scores[socket.id];

      // Cancel round if picker left
      if (
        room.currentRound &&
        room.currentRound.pickerId === socket.id
      ) {
        room.currentRound = null;
      }

      if (room.players.length === 0) {
        delete rooms[roomId];
        continue;
      }

      room.pickerIndex %= room.players.length;

      io.to(roomId).emit("playerLeft", {
        socketId: socket.id,
        players: room.players,
        scores: room.scores,
        pickerSocketId: room.players[room.pickerIndex]
      });
    }
  });
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log("Server listening on", PORT)
);
