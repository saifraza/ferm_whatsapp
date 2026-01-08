const express = require('express');
const axios = require('axios');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = 3000;

app.use(express.json());

// --- CSV Setup ---
const csvFile = 'fermentation_data.csv';
const csvHeader = 'timestamp,fermenter_number,specific_gravity,temperature,ph\n';
if (!fs.existsSync(csvFile)) {
    fs.writeFileSync(csvFile, csvHeader);
}

// --- AI Parsing Endpoint ---
app.post('/parse', async (req, res) => {
    const { message } = req.body;
    console.log('Received message to parse:', message.body);

    try {
        // 1. Get API Key from environment
        const apiKey = process.env.gemin_key;
        if (!apiKey) {
            throw new Error("API key not found in environment variables.");
        }

        // 2. Initialize Google AI
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // 3. Create a prompt
        const prompt = `
            You are an expert at parsing fermentation data from text messages.
            Extract the following information from the message below:
            - fermenterNumber (integer)
            - specificGravity (float)
            - temperature (float)
            - ph (float)

            If a value is not present, set it to null.
            Return the data as a single, minified JSON object with no other text or explanation.

            Message: "${message.body}"
        `;

        // 4. Call the AI
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        // 5. Parse the JSON response
        const data = JSON.parse(text);
        console.log('-- AI Extracted Data:', data);

        // 6. Save to CSV
        if (data.fermenterNumber !== null || data.specificGravity !== null || data.temperature !== null || data.ph !== null) {
            const timestamp = message.timestamp;
            const csvRow = `${timestamp},${data.fermenterNumber || ''},${data.specificGravity || ''},${data.temperature || ''},${data.ph || ''}\n`;
            fs.appendFileSync(csvFile, csvRow);
            console.log('--- Saved data to CSV ---');
        }

        res.status(200).send('Message processed by AI');

    } catch (error) {
        console.error('Error processing message with AI:', error);
        res.status(500).send('Error processing message');
    }
});

// --- WhatsApp Bot ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
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
