// server.js

// Complete player name generation functionality integrated throughout the game logic

const express = require('express');
const app = express();
const port = 3000;

// Function to generate player names
function generatePlayerName() {
    const firstNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
    const lastNames = ['One', 'Two', 'Three', 'Four', 'Five'];
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${firstName} ${lastName}`;
}

app.get('/create-player', (req, res) => {
    const playerName = generatePlayerName();
    res.send(`Player created with name: ${playerName}`);
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
