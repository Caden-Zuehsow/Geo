import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const MAX_PLAYERS = 10;

// ---- Helpers ----
function makeRoomId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function randomWord() {
  const words = ["Tiger", "Eagle", "Shark", "Wolf", "Panda", "Falcon"];
  return words[Math.floor(Math.random() * words.length)];
}

function uniqueUsername(room) {
  let name;
  do {
    name = randomWord();
  } while (Object.values(room.usernames).includes(name));
  return name;
}

function haversineDistMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreFromDistance(d) {
  return Math.max(0, Math.round(5000 * Math.exp(-d / 2000000)));
}

// ---- Socket Logic ----
io.on("connection", socket => {

  const pid = socket.handshake.auth?.playerId || socket.id;

  console.log("connected:", socket.id, "player:", pid);

  // ---- Reconnect ----
  let existingRoomId = null;

  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.players.includes(pid)) {
      existingRoomId = roomId;
      break;
    }
  }

  if (existingRoomId) {
    const room = rooms[existingRoomId];

    room.sockets[pid] = socket.id;
    socket.join(existingRoomId);

    console.log("Reconnected to room:", existingRoomId);

    socket.emit("rejoinedRoom", {
      roomId: existingRoomId,
      players: room.players,
      usernames: room.usernames,
      scores: room.scores,
      pickerSocketId: room.sockets[room.players[room.pickerIndex]]
    });
  }

  // ---- Create Room ----
  socket.on("createRoom", cb => {

    const id = makeRoomId();

    rooms[id] = {
      players: [pid],
      sockets: { [pid]: socket.id },
      usernames: { [pid]: randomWord() },
      scores: { [pid]: 0 },
      pickerIndex: 0,
      currentRound: null
    };

    socket.join(id);

    console.log("Room created:", id);

    cb({ ok: true, roomId: id });

  });

  // ---- Join Room ----
  socket.on("joinRoom", (roomId, cb) => {

    const room = rooms[roomId];

    if (!room) return cb({ ok: false, err: "Room not found" });

    if (room.players.length >= MAX_PLAYERS)
      return cb({ ok: false, err: "Room full" });

    if (!room.players.includes(pid)) {
      room.players.push(pid);
      room.scores[pid] = 0;
      room.usernames[pid] = uniqueUsername(room);
    }

    room.sockets[pid] = socket.id;

    socket.join(roomId);

    io.to(roomId).emit("roomJoined", {
      players: room.players,
      usernames: room.usernames,
      scores: room.scores,
      pickerSocketId: room.sockets[room.players[room.pickerIndex]]
    });

    cb({ ok: true });

  });

  // ---- Pick Location ----
  socket.on("pickLocation", (data, cb) => {

    const room = rooms[data.roomId];
    if (!room) return cb?.({ ok: false });

    const pickerId = room.players[room.pickerIndex];

    if (pid !== pickerId)
      return cb?.({ ok: false, err: "Not picker" });

    room.currentRound = {
      lat: data.lat,
      lng: data.lng,
      pickerId,
      guesses: {}
    };

    room.players.forEach(id => {
      if (id !== pickerId) {
        io.to(room.sockets[id]).emit("startGuess", {
          lat: data.lat,
          lng: data.lng,
          hint: data.hint || null
        });
      }
    });

    cb?.({ ok: true });

  });

  // ---- Make Guess ----
  socket.on("makeGuess", (data, cb) => {

    const room = rooms[data.roomId];
    if (!room || !room.currentRound)
      return cb?.({ ok: false });

    const round = room.currentRound;

    if (pid === round.pickerId) return;
    if (round.guesses[pid]) return;

    round.guesses[pid] = {
      lat: data.lat,
      lng: data.lng
    };

    const guessers = room.players.filter(
      id => id !== round.pickerId
    );

    if (Object.keys(round.guesses).length < guessers.length) {
      cb?.({ ok: true, waiting: true });
      return;
    }

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

      io.to(room.sockets[id]).emit("roundResult", {
        correct: { lat: round.lat, lng: round.lng },
        distanceMeters: Math.round(dist),
        pointsAwarded: points,
        scores: room.scores
      });

    });

    room.currentRound = null;

    room.pickerIndex =
      (room.pickerIndex + 1) % room.players.length;

    setTimeout(() => {
      io.to(data.roomId).emit("newRound", {
        pickerSocketId: room.sockets[room.players[room.pickerIndex]],
        scores: room.scores
      });
    }, 1500);

    cb?.({ ok: true });

  });

  // ---- Disconnect ----
  socket.on("disconnect", reason => {

    console.log("disconnect:", socket.id, reason);

    for (const [roomId, room] of Object.entries(rooms)) {

      if (!room.players.includes(pid)) continue;

      delete room.sockets[pid];

      setTimeout(() => {

        if (room.sockets[pid]) return;

        console.log("Removing inactive player:", pid);

        room.players = room.players.filter(p => p !== pid);

        delete room.scores[pid];
        delete room.usernames[pid];

        if (room.players.length === 0) {
          delete rooms[roomId];
          return;
        }

        room.pickerIndex %= room.players.length;

        io.to(roomId).emit("playerLeft", {
          playerId: pid,
          players: room.players,
          usernames: room.usernames,
          scores: room.scores,
          pickerSocketId: room.sockets[room.players[room.pickerIndex]]
        });

      }, 10000);

    }

  });

});

// ---- Start Server ----
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
