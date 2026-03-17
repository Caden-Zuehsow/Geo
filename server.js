io.on("connection", socket => {

  const playerId = socket.handshake.auth?.playerId;

  if (!playerId) {
    console.log("No playerId, disconnecting");
    socket.disconnect();
    return;
  }

  console.log("connected:", socket.id, "player:", playerId);

  // ---- Find existing room (reconnect case) ----
  let existingRoomId = null;

  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.players.includes(playerId)) {
      existingRoomId = roomId;
      break;
    }
  }

  if (existingRoomId) {
    const room = rooms[existingRoomId];

    room.sockets[playerId] = socket.id;

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

  // ---- Create room ----
  socket.on("createRoom", cb => {

    const id = makeRoomId();

    rooms[id] = {
      players: [playerId],
      sockets: { [playerId]: socket.id },
      usernames: { [playerId]: randomWord() },
      scores: { [playerId]: 0 },
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

    // Prevent duplicate joins
    if (!room.players.includes(playerId)) {
      room.players.push(playerId);
      room.scores[playerId] = 0;
      room.usernames[playerId] = uniqueUsername(room);
    }

    room.sockets[playerId] = socket.id;

    socket.join(roomId);

    io.to(roomId).emit("roomJoined", {
      players: room.players,
      usernames: room.usernames,
      scores: room.scores,
      pickerSocketId: room.sockets[room.players[room.pickerIndex]]
    });

    cb({ ok: true });

  });

  // ---- Pick location ----
  socket.on("pickLocation", (data, cb) => {

    const room = rooms[data.roomId];
    if (!room) return cb?.({ ok: false });

    const pickerId = room.players[room.pickerIndex];

    if (playerId !== pickerId)
      return cb?.({ ok: false, err: "Not picker" });

    room.currentRound = {
      lat: data.lat,
      lng: data.lng,
      pickerId,
      guesses: {}
    };

    room.players.forEach(pid => {
      if (pid !== pickerId) {
        io.to(room.sockets[pid]).emit("startGuess", {
          lat: data.lat,
          lng: data.lng,
          hint: data.hint || null
        });
      }
    });

    cb?.({ ok: true });

  });

  // ---- Make guess ----
  socket.on("makeGuess", (data, cb) => {

    const room = rooms[data.roomId];
    if (!room || !room.currentRound)
      return cb?.({ ok: false });

    const round = room.currentRound;

    if (playerId === round.pickerId) return;
    if (round.guesses[playerId]) return;

    round.guesses[playerId] = {
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

    guessers.forEach(pid => {

      const g = round.guesses[pid];

      const dist = haversineDistMeters(
        round.lat,
        round.lng,
        g.lat,
        g.lng
      );

      const points = scoreFromDistance(dist);

      room.scores[pid] = (room.scores[pid] || 0) + points;

      io.to(room.sockets[pid]).emit("roundResult", {
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

      if (!room.players.includes(playerId)) continue;

      // ONLY remove socket, NOT player yet
      delete room.sockets[playerId];

      // Give player 10 seconds to reconnect
      setTimeout(() => {

        // If they reconnected, skip removal
        if (room.sockets[playerId]) return;

        console.log("Removing inactive player:", playerId);

        room.players = room.players.filter(p => p !== playerId);

        delete room.scores[playerId];
        delete room.usernames[playerId];

        if (room.players.length === 0) {
          delete rooms[roomId];
          return;
        }

        room.pickerIndex %= room.players.length;

        io.to(roomId).emit("playerLeft", {
          playerId,
          players: room.players,
          usernames: room.usernames,
          scores: room.scores,
          pickerSocketId: room.sockets[room.players[room.pickerIndex]]
        });

      }, 10000); // reconnect window

    }

  });

});
