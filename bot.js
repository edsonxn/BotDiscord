require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { OpenAI } = require('openai');
const fs = require('fs');

// Configura Discord y OpenAI
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Función para cargar la personalidad desde el archivo
const loadPersonality = () => {
    try {
        const personality = fs.readFileSync('personality.txt', 'utf8');
        return personality.trim(); // Elimina espacios en blanco innecesarios
    } catch (error) {
        console.error('Error al cargar el archivo de personalidad:', error);
        return `Eres un asistente estándar. Responde de forma genérica pero útil.`; // Personalidad por defecto
    }
};

// Archivo para guardar el historial de conversaciones
const historyFile = 'conversationHistory.json';
let conversationHistory = {};

// Cargar el historial de conversaciones desde el archivo
if (fs.existsSync(historyFile)) {
    try {
        const data = fs.readFileSync(historyFile, 'utf8');
        conversationHistory = JSON.parse(data);
    } catch (error) {
        console.error('Error al leer el archivo de historial:', error);
    }
}

// Función para guardar el historial en el archivo
const saveConversationHistory = () => {
    try {
        fs.writeFileSync(historyFile, JSON.stringify(conversationHistory, null, 2), 'utf8');
    } catch (error) {
        console.error('Error al guardar el archivo de historial:', error);
    }
};

// Mapa para rastrear el temporizador de inactividad por canal
const inactivityTimers = {};

// Función para generar un mensaje de inactividad usando OpenAI
const generateInactivityMessage = async (channelId) => {
    try {
        const personality = loadPersonality();

        // Incluye el historial de conversación en el mensaje
        const conversationContext = conversationHistory[channelId] || [];

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: personality },
                ...conversationContext,
                { role: "user", content: "No ha habido actividad en el canal durante 10 minutos. Genera un mensaje irónico, sarcástico y ácido, estas en un canal de Discord y el mensaje va para todos, mensaje corto" }
            ],
            max_tokens: 100,
        });

        const gptReply = completion.choices[0]?.message?.content || "Bueno, parece que el silencio es la respuesta...";

        // Agregar mensaje de inactividad al historial
        if (!conversationHistory[channelId]) {
            conversationHistory[channelId] = [];
        }

        conversationHistory[channelId].push({ role: "assistant", content: gptReply });

        // Limitar el historial a 20 mensajes
        if (conversationHistory[channelId].length > 20) {
            conversationHistory[channelId].shift();
        }

        saveConversationHistory(); // Guarda el historial actualizado

        return gptReply;
    } catch (error) {
        console.error('Error al generar mensaje de inactividad:', error);
        return "Hubo un error al generar el mensaje de inactividad.";
    }
};


// Función para manejar la inactividad
const startInactivityTimer = (channel) => {
    if (inactivityTimers[channel.id]) {
        clearTimeout(inactivityTimers[channel.id]);
    }

    inactivityTimers[channel.id] = setTimeout(async () => {
        const inactivityMessage = await generateInactivityMessage(channel.id);
        channel.send(inactivityMessage);
        startInactivityTimer(channel); // Reinicia el contador después de enviar el mensaje
    }, 60 * 60 * 1000); // 10 minutos en milisegundos
};

client.once('ready', () => {
    console.log(`¡Bot conectado como ${client.user.tag}!`);

    // Inicia los temporizadores de inactividad para todos los canales permitidos al arrancar
    const allowedChannelIds = ['1319559650605137963'];
    allowedChannelIds.forEach((channelId) => {
        const channel = client.channels.cache.get(channelId);
        if (channel) {
            startInactivityTimer(channel);
        }
    });
});

client.on('messageCreate', async (message) => {
    const allowedChannelIds = ['1319559650605137963']; // Lista de IDs de canales permitidos

    if (!allowedChannelIds.includes(message.channel.id) || message.author.bot) return;

    // Procesar imágenes si el mensaje contiene una
    if (message.attachments.size > 0) {
        const imageAttachment = message.attachments.first();

        if (imageAttachment.contentType && imageAttachment.contentType.startsWith('image/')) {
            try {
                const response = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "user", content: `¿Qué hay en esta imagen? Respóndelo de manera sarcástica, irónica y ácida.` },
                        { role: "user", content: `Imagen URL: ${imageAttachment.url}` }
                    ],
                    max_tokens: 300,
                });

                const reply = response.choices[0]?.message?.content || "No estoy seguro de qué es esta imagen.";
                message.reply(reply);
            } catch (error) {
                console.error('Error al procesar la imagen:', error);
                message.reply("Hubo un problema al analizar la imagen. Intenta con otra.");
            }
        } else {
            message.reply("Adjunta una imagen para que pueda analizarla.");
        }
        return;
    }

    // Reinicia el temporizador de inactividad para el canal
    startInactivityTimer(message.channel);

    // Inicializa el historial de conversación para el canal si no existe
    if (!conversationHistory[message.channel.id]) {
        conversationHistory[message.channel.id] = [];
    }

    // Agrega el mensaje del usuario al historial del canal
    conversationHistory[message.channel.id].push({
        role: "user",
        content: `${message.author.username} dijo: ${message.content}`,
    });

    // Limita el tamaño del historial a 20 mensajes por canal
    if (conversationHistory[message.channel.id].length > 20) {
        conversationHistory[message.channel.id].shift();
    }

    saveConversationHistory(); // Guarda el historial de todos los canales

    try {
        const personality = loadPersonality(); // Carga la personalidad
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: personality },
                ...conversationHistory[message.channel.id]
            ],
        });

        const gptReply = completion.choices[0]?.message?.content || 'No tengo respuesta para eso.';
        conversationHistory[message.channel.id].push({ role: "assistant", content: gptReply });

        saveConversationHistory(); // Guarda el historial actualizado
        message.channel.send(gptReply);
    } catch (error) {
        console.error(error);
        message.channel.send("Hubo un error al procesar tu mensaje. Inténtalo nuevamente más tarde.");
    }
});

// Inicia sesión en Discord con tu token
client.login(process.env.DISCORD_TOKEN);
