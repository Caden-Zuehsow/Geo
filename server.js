// Existing code...

// Preset list of names for player name generation
const playerNames = ["Alice", "Bob", "Charlie", "Diana", "Ethan", "Fiona"];

// Object to track player names
const names = {};

// Function to generate a random player name
function getRandomPlayerName() {
    const randomIndex = Math.floor(Math.random() * playerNames.length);
    return playerNames[randomIndex];
}

// Example socket event where names are used
socket.on('playerJoined', () => {
    const newPlayerName = getRandomPlayerName();
    names[socket.id] = newPlayerName;
    console.log(`${newPlayerName} has joined the game!`);
    
    // Emit to other players
    socket.broadcast.emit("playerJoined", newPlayerName);
});

// Existing code...