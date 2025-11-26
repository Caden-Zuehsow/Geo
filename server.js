// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {}; // { roomId: { players: [socketId,...], scores: {socketId:score}, turn: 0 } }

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function haversineDistMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => deg * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

io.on('connection', (socket) => {
  console.log('conn', socket.id);

  socket.on('createRoom', (cb) => {
    let id = makeRoomId();
    rooms[id] = { players: [socket.id], scores: {}, turn: 0 };
    rooms[id].scores[socket.id] = 0;
    socket.join(id);
    cb({ ok: true, roomId: id });
  });

  socket.on('joinRoom', (roomId, cb) => {
    const room = rooms[roomId];
    if (!room) { cb({ ok: false, err: 'Room not found' }); return; }
    if (room.players.length >= 2) { cb({ ok: false, err: 'Room full' }); return; }
    room.players.push(socket.id);
    room.scores[socket.id] = 0;
    socket.join(roomId);

    // notify both players who is player1/player2 and start round (picker = player0)
    io.to(roomId).emit('roomJoined', {
      players: room.players,
      scores: room.scores,
      pickerSocketId: room.players[room.turn % 2]
    });
    cb({ ok: true });
  });

  socket.on('pickLocation', (data, cb) => {
    // data: { roomId, lat, lng, imageDataUrl (optional) }
    const room = rooms[data.roomId];
    if (!room) { cb && cb({ ok:false, err:'room' }); return; }
    // only allow current picker
    const pickerId = room.players[room.turn % 2];
    if (socket.id !== pickerId) { cb && cb({ ok:false, err:'not picker' }); return; }

    // relay to the other player (guesser)
    const guesserId = room.players.find(id => id !== pickerId);
    io.to(guesserId).emit('startGuess', {
      imageDataUrl: data.imageDataUrl || null,
      hint: data.hint || null
    });

    // store correct location on server for scoring
    room._current = { lat: data.lat, lng: data.lng, picker: pickerId };
    cb && cb({ ok:true });
  });

  socket.on('makeGuess', (data, cb) => {
    // data: { roomId, lat, lng }
    const room = rooms[data.roomId];
    if (!room || !room._current) { cb && cb({ ok:false, err:'no round' }); return; }

    const correct = room._current;
    const dist = haversineDistMeters(correct.lat, correct.lng, data.lat, data.lng);
    // simple scoring: 5000 meters -> 0 pts, 0m -> 1000 pts (scale)
    const score = Math.max(0, Math.round(1000 * Math.max(0, (1 - dist / 500000)))); // adjustable
    // award to guesser
    room.scores[socket.id] = (room.scores[socket.id] || 0) + score;

    // notify both players with results
    io.to(data.roomId).emit('roundResult', {
      correct: { lat: correct.lat, lng: correct.lng },
      guess: { lat: data.lat, lng: data.lng },
      distanceMeters: Math.round(dist),
      pointsAwarded: score,
      scores: room.scores
    });

    // cleanup and advance turn for next round
    delete room._current;
    room.turn = (room.turn + 1) % 2;
    // after a short delay, notify new picker
    setTimeout(() => {
      io.to(data.roomId).emit('newRound', {
        pickerSocketId: room.players[room.turn % 2],
        scores: room.scores
      });
    }, 1500);

    cb && cb({ ok:true, dist });
  });

  socket.on('disconnect', () => {
    // remove from any room
    for (const [id, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        room.players = room.players.filter(s=>s!==socket.id);
        delete room.scores[socket.id];
        io.to(id).emit('playerLeft', { socketId: socket.id });
        // if room empty, delete
        if (room.players.length === 0) delete rooms[id];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('listening on', PORT));
