// server.js (ESM Version)
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; // { roomId: { players: [...], scores:{}, turn:0 } }

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Haversine distance in Meters
function haversineDistMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => deg * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2)**2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

io.on('connection', (socket) => {
  console.log('conn', socket.id);

  // Create room
  socket.on('createRoom', (cb) => {
    let id = makeRoomId();
    rooms[id] = { players: [socket.id], scores: {}, turn: 0 };
    rooms[id].scores[socket.id] = 0;
    socket.join(id);
    cb({ ok: true, roomId: id });
  });

  // Join room
  socket.on('joinRoom', (roomId, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok: false, err: 'Room not found' });
    if (room.players.length >= 2) return cb({ ok: false, err: 'Room full' });

    room.players.push(socket.id);
    room.scores[socket.id] = 0;
    socket.join(roomId);

    io.to(roomId).emit('roomJoined', {
      players: room.players,
      scores: room.scores,
      pickerSocketId: room.players[room.turn % 2]
    });

    cb({ ok: true });
  });

  // Picker chooses spot
  socket.on('pickLocation', (data, cb) => {
    const room = rooms[data.roomId];
    if (!room) return cb?.({ ok:false, err:'room' });

    const pickerId = room.players[room.turn % 2];
    if (socket.id !== pickerId) return cb?.({ ok:false, err:'not picker' });

    const guesserId = room.players.find(id => id !== pickerId);

    io.to(guesserId).emit('startGuess', {
      lat: data.lat,
      lng: data.lng,
      hint: data.hint || null
    });

    room._current = { lat: data.lat, lng: data.lng, picker: pickerId };
    cb?.({ ok:true });
  });

  // Guesser submits a guess
  socket.on('makeGuess', (data, cb) => {
    const room = rooms[data.roomId];
    if (!room || !room._current) return cb?.({ ok:false, err:'no round' });

    const correct = room._current;

    // Distance in meters + miles
    const distMeters = haversineDistMeters(correct.lat, correct.lng, data.lat, data.lng);
    const distMiles = distMeters / 1609.34;

    // --- NEW SCORING SYSTEM ---
    let score = 0;

    if (distMiles < 1) {
      score = 1000; // Perfect guess
    } else if (distMiles <= 1000) {
      score = Math.max(0, Math.round(1000 - distMiles));
    } else {
      score = 0; // Too far
    }

    // Update scoreboard
    room.scores[socket.id] = (room.scores[socket.id] || 0) + score;

    // Send result to both players
    io.to(data.roomId).emit('roundResult', {
      correct: { lat: correct.lat, lng: correct.lng },
      guess: { lat: data.lat, lng: data.lng },
      distanceMeters: Math.round(distMeters),
      distanceMiles: Number(distMiles.toFixed(2)),
      pointsAwarded: score,
      scores: room.scores
    });

    // Reset round & switch turn
    delete room._current;
    room.turn = (room.turn + 1) % 2;

    // Start next round
    setTimeout(() => {
      io.to(data.roomId).emit('newRound', {
        pickerSocketId: room.players[room.turn % 2],
        scores: room.scores
      });
    }, 1500);

    cb?.({ ok:true, distMeters, distMiles });
  });

  // Disconnecting
  socket.on('disconnect', () => {
    for (const [id, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        room.players = room.players.filter(s=>s!==socket.id);
        delete room.scores[socket.id];

        io.to(id).emit('playerLeft', { socketId: socket.id });

        if (room.players.length === 0) delete rooms[id];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on', PORT));

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on', PORT));
