// Original content of server.js from commit f100237c44b45e90d18fb60a495529082f2e8179
// This code does not include player name generation

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});