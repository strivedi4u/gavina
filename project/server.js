const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const cron = require('node-cron');
require('dotenv').config();

const ragRoutes = require('./routes/rag');
const logger = require('./services/loggerService');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve visualizations
app.use('/visualizations', express.static(path.join(__dirname, 'public/visualizations')));

// Routes
app.use('/api', ragRoutes);

// Fuzzy Q&A search endpoint using fuse.js
const Fuse = require('fuse.js');
const qaData = require('./data.json');
const fuse = new Fuse(qaData, {
  keys: ['question'],
  threshold: 0.4,
});

app.get('/api/search', (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ llm_answer: '' });
  }
  const openaiApiKey = process.env.OPENAI_API_KEY || '';
  const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o';
  const groqApiKey = process.env.GROQ_API_KEY || '';
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  (async () => {
    let llmAnswer = '';
    let usedFallback = false;
    try {
      logger.info(`[LLM] Sending request to OpenAI: model=${openaiModel}, query="${query}"`);
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`
        },
        body: JSON.stringify({
          model: openaiModel,
          messages: [
            { role: 'system', content: 'You are an expert AI assistant. Answer the user question clearly and concisely.' },
            { role: 'user', content: query }
          ],
          max_tokens: 512
        })
      });
      const data = await response.json();
      logger.info(`[LLM] OpenAI response: ${JSON.stringify(data)}`);
      if (data.choices && data.choices.length > 0 && data.choices[0].message && typeof data.choices[0].message.content === 'string') {
        llmAnswer = data.choices[0].message.content;
      } else if (data.error && data.error.code === 'insufficient_quota') {
        logger.warn('[LLM] OpenAI quota exceeded, using Groq fallback.');
        usedFallback = true;
      } else {
        logger.warn('[LLM] No answer returned from OpenAI.');
      }
    } catch (err) {
      logger.error(`[LLM] Exception: ${err.message}`);
    }
    // Fallback to Groq if OpenAI quota exceeded or no answer
    if ((usedFallback || !llmAnswer) && groqApiKey) {
      try {
        logger.info(`[LLM] Sending request to Groq: query="${query}"`);
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groqApiKey}`
          },
          body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            messages: [
              { role: 'system', content: 'You are an expert AI assistant. Answer the user question clearly and concisely.' },
              { role: 'user', content: query }
            ],
            max_tokens: 512
          })
        });
        const groqData = await groqResponse.json();
        logger.info(`[LLM] Groq response: ${JSON.stringify(groqData)}`);
        if (groqData.choices && groqData.choices.length > 0 && groqData.choices[0].message && typeof groqData.choices[0].message.content === 'string') {
          llmAnswer = groqData.choices[0].message.content;
        }
      } catch (groqErr) {
        logger.error(`[LLM] Groq Exception: ${groqErr.message}`);
      }
    }
    res.json({ llm_answer: llmAnswer });
  })();
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '2.0.0'
  });
});
// API status endpoint
app.get('/api/status', async (req, res) => {
  try {
    const vectorDatabaseService = require('./services/vectorDatabaseService');
    const vectorStats = await vectorDatabaseService.getVectorStats();
    
    res.json({
      status: 'operational',
      services: {
        vectorDatabase: vectorStats.totalVectors > 0 ? 'connected' : 'empty',
        openai: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
        memory: process.env.ENABLE_MEMORY === 'true' ? 'enabled' : 'disabled',
        vision: process.env.ENABLE_VISION === 'true' ? 'enabled' : 'disabled',
        audio: process.env.ENABLE_AUDIO === 'true' ? 'enabled' : 'disabled'
      },
      vectorStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get API status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve system status'
    });
  }
});

// Socket.IO for real-time features
io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  socket.on('join_user_room', (userId) => {
    socket.join(`user_${userId}`);
    logger.info(`User ${userId} joined room`);
  });
  
  socket.on('start_processing', (data) => {
    socket.to(`user_${data.userId}`).emit('processing_started', {
      type: data.type,
      message: 'Processing started...'
    });
  });
  
  socket.on('processing_progress', (data) => {
    socket.to(`user_${data.userId}`).emit('progress_update', data);
  });
  
  socket.on('processing_complete', (data) => {
    socket.to(`user_${data.userId}`).emit('processing_completed', data);
  });
  
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Make io available to routes
app.set('io', io);

// Scheduled tasks
cron.schedule('0 2 * * *', async () => {
  // Daily cleanup at 2 AM
  logger.info('Running daily cleanup tasks...');
  try {
    const advancedMemoryService = require('./services/advancedMemoryService');
    await advancedMemoryService.cleanupOldMemories();
    logger.info('Daily cleanup completed');
  } catch (error) {
    logger.error('Daily cleanup failed:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`🚀 Advanced RAG Server running on port ${PORT}`);
  logger.info(`📊 Dashboard: http://localhost:${PORT}`);
  logger.info(`🔍 API Health: http://localhost:${PORT}/health`);
  logger.info(`📈 API Status: http://localhost:${PORT}/api/status`);
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════════╗
║                                🤖 ADVANCED RAG CHATBOT 🤖                                  ║
║                                                                                           ║
║  🌟 Features:                                                                            ║
║    • GPT-4/GPT-5 Integration with Memory Management                                     ║
║    • Multimodal Processing (Text, Images, Audio, Video, Documents)                     ║
║    • Vector Database with Semantic Search                                              ║
║    • Real-time Vector Visualizations                                                   ║
║    • Persistent Memory & Learning                                                      ║
║    • Web Scraping & URL Processing                                                     ║
║    • Advanced Analytics & Insights                                                     ║
║                                                                                           ║
║  🔗 Access Points:                                                                       ║
║    • Main Dashboard: http://localhost:${PORT}                                              ║
║    • API Health: http://localhost:${PORT}/health                                           ║
║    • System Status: http://localhost:${PORT}/api/status                                    ║
║                                                                                           ║
║  📁 Supported Formats:                                                                  ║
║    • Documents: PDF, DOCX, TXT, MD, CSV, XLSX                                          ║
║    • Images: JPG, PNG, GIF, BMP, TIFF, WEBP                                           ║
║    • Audio: MP3, WAV, M4A, OGG, FLAC                                                   ║
║    • Video: MP4, AVI, MOV, WMV, FLV, WEBM                                             ║
║    • Web: URLs, HTML, JSON                                                             ║
║                                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝
  `);
});
