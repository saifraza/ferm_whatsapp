const express = require('express');
const axios = require('axios');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const app = express();
const port = 3000;

app.use(express.json());

// --- CSV Setup ---
const csvFile = 'fermentation_data.csv';
const csvHeader = 'timestamp,specific_gravity,temperature\n';
if (!fs.existsSync(csvFile)) {
    fs.writeFileSync(csvFile, csvHeader);
}

// --- AI Parsing Endpoint ---
app.post('/parse', (req, res) => {
    const { message } = req.body;
    console.log('Received message to parse:', message.body);

    // This is where we will call the AI in the future.
    // For now, we will use our existing regex-based parsing logic.

    const messageBody = message.body.toLowerCase();
    const sgRegex = /(?:specific gravity|spgr|sp gre|sp ger)\.?\s*=?\s*(\d+\.\d+)/;
    const tempRegex = /(?:temperature|temp|tamp)\.?\s*=?\s*(-)?\s*(\d+(\.\d+)?)/;

    const sgMatch = messageBody.match(sgRegex);
    const tempMatch = messageBody.match(tempRegex);

    let specificGravity = null;
    let temperature = null;

    if (sgMatch) {
        specificGravity = parseFloat(sgMatch[1]);
        console.log(`-- Extracted Specific Gravity: ${specificGravity}`);
    }

    if (tempMatch) {
        const sign = tempMatch[1] ? -1 : 1;
        const number = parseFloat(tempMatch[2]);
        temperature = sign * number;
        console.log(`-- Extracted Temperature: ${temperature}`);
    }

    if (specificGravity !== null || temperature !== null) {
        const timestamp = message.timestamp;
        const csvRow = `${timestamp},${specificGravity || ''},${temperature || ''}\n`;
        fs.appendFileSync(csvFile, csvRow);
        console.log('--- Saved data to CSV ---');
    }

    res.status(200).send('Message processed');
});

// --- WhatsApp Bot ---
const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
});

client.on('ready', async () => {
    console.log('WhatsApp client is ready!');

    const groupName = "MSPIL fermentation & liquification";
    let groupChat = null;

    const chats = await client.getChats();
    for (const chat of chats) {
        if (chat.isGroup && chat.name === groupName) {
            groupChat = chat;
            break;
        }
    }

    if (groupChat) {
        console.log(`Found group: ${groupChat.name}`);

        // We are not processing old messages in this new architecture for now.
        // We can add that back later if needed.

        client.on('message', async (message) => {
            const chat = await message.getChat();
            if (chat.id._serialized === groupChat.id._serialized) {
                // Send the message to our own parsing service
                axios.post('http://localhost:3000/parse', { message })
                    .catch(err => {
                        console.error('Error sending message to parsing service:', err.message);
                    });
            }
        });
    } else {
        console.log(`Group "${groupName}" not found.`);
    }
});

// --- Start Server and Bot ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    client.initialize();
});
