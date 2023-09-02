const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

// Services
const openaiService = require('../services/openaiService');
const vectorDatabaseService = require('../services/vectorDatabaseService');
const advancedMemoryService = require('../services/advancedMemoryService');
const multimodalProcessingService = require('../services/multimodalProcessingService');
const vectorVisualizationService = require('../services/vectorVisualizationService');
const logger = require('../services/loggerService');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    await fs.ensureDir(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 10 // Max 10 files at once
  },
  fileFilter: (req, file, cb) => {
    // Accept all file types for multimodal processing
    cb(null, true);
  }
});

// Middleware to extract user ID
const getUserId = (req) => {
  return req.headers['x-user-id'] || req.body.userId || req.query.userId || 'default';
};

// Middleware to emit socket events
const emitProgress = (req, event, data) => {
  const io = req.app.get('io');
  if (io) {
    const userId = getUserId(req);
    io.to(`user_${userId}`).emit(event, data);
  }
};

// ===============================
// CHAT & QUESTION ANSWERING
// ===============================

router.post('/ask', async (req, res) => {
  try {
    const { question, context = '', options = {} } = req.body;
    const userId = getUserId(req);

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    logger.info(`Received question from user ${userId}: ${question.substring(0, 100)}...`);
    emitProgress(req, 'processing_started', { type: 'question', message: 'Processing your question...' });

    const response = await openaiService.askQuestion(question, userId, context, options);

    res.json({
      response,
      userId,
      timestamp: new Date().toISOString(),
      model: process.env.OPENAI_MODEL || 'gpt-4o-2024-08-06'
    });

    emitProgress(req, 'processing_completed', { type: 'question', success: true });

  } catch (error) {
    logger.error('Failed to process question:', error);
    emitProgress(req, 'processing_completed', { type: 'question', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to process question', details: error.message });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { message, options = {} } = req.body;
    const userId = getUserId(req);

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    emitProgress(req, 'processing_started', { type: 'chat', message: 'Thinking...' });

    const response = await openaiService.chatWithHistory(message, userId, options);

    res.json({
      response,
      userId,
      timestamp: new Date().toISOString()
    });

    emitProgress(req, 'processing_completed', { type: 'chat', success: true });

  } catch (error) {
    logger.error('Failed to process chat:', error);
    emitProgress(req, 'processing_completed', { type: 'chat', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to process chat', details: error.message });
  }
});

// ===============================
// MULTIMODAL FILE PROCESSING
// ===============================

router.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const { question = 'Analyze these files', urls = [] } = req.body;
    const userId = getUserId(req);
    const files = req.files || [];

    if (files.length === 0 && (!urls || urls.length === 0)) {
      return res.status(400).json({ error: 'At least one file or URL is required' });
    }

    logger.info(`Processing ${files.length} files and ${urls.length} URLs for user ${userId}`);
    emitProgress(req, 'processing_started', { 
      type: 'multimodal', 
      message: `Processing ${files.length} files and ${urls.length} URLs...` 
    });

    // Process the multimodal query
    const urlArray = Array.isArray(urls) ? urls : (urls ? [urls] : []);
    const result = await openaiService.processMultimodalQuery(question, files, urlArray, userId);

    res.json({
      ...result,
      userId,
      timestamp: new Date().toISOString(),
      filesProcessed: files.length,
      urlsProcessed: urlArray.length
    });

    emitProgress(req, 'processing_completed', { 
      type: 'multimodal', 
      success: true,
      filesProcessed: files.length,
      urlsProcessed: urlArray.length
    });

  } catch (error) {
    logger.error('Failed to process multimodal query:', error);
    emitProgress(req, 'processing_completed', { type: 'multimodal', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to process files', details: error.message });
  }
});

router.post('/analyze-image', upload.single('image'), async (req, res) => {
  try {
    const { question = 'What do you see in this image?' } = req.body;
    const userId = getUserId(req);

    if (!req.file) {
      return res.status(400).json({ error: 'Image file is required' });
    }

    emitProgress(req, 'processing_started', { type: 'image_analysis', message: 'Analyzing image...' });

    const result = await openaiService.analyzeImage(req.file.path, question, userId);

    res.json({
      ...result,
      userId,
      timestamp: new Date().toISOString()
    });

    emitProgress(req, 'processing_completed', { type: 'image_analysis', success: true });

  } catch (error) {
    logger.error('Failed to analyze image:', error);
    emitProgress(req, 'processing_completed', { type: 'image_analysis', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to analyze image', details: error.message });
  }
});

router.post('/process-url', async (req, res) => {
  try {
    const { url, question = 'Summarize this content', metadata = {} } = req.body;
    const userId = getUserId(req);

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    emitProgress(req, 'processing_started', { type: 'url_processing', message: 'Processing URL...' });

    const processed = await multimodalProcessingService.processUrl(url, { ...metadata, userId });

    if (processed.extractedText) {
      const response = await openaiService.askQuestion(question, userId, processed.extractedText);
      
      res.json({
        response,
        processedContent: processed,
        userId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        processedContent: processed,
        message: 'Content processed but no text extracted for analysis',
        userId,
        timestamp: new Date().toISOString()
      });
    }

    emitProgress(req, 'processing_completed', { type: 'url_processing', success: true });

  } catch (error) {
    logger.error('Failed to process URL:', error);
    emitProgress(req, 'processing_completed', { type: 'url_processing', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to process URL', details: error.message });
  }
});

// ===============================
// VECTOR DATABASE OPERATIONS
// ===============================

router.post('/vector/search', async (req, res) => {
  try {
    const { query, topK = 5, filters = {} } = req.body;
    const userId = getUserId(req);

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await vectorDatabaseService.similaritySearch(query, topK, filters);

    res.json({
      results,
      query,
      topK,
      filters,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to search vectors:', error);
    res.status(500).json({ error: 'Failed to search vectors', details: error.message });
  }
});

router.post('/vector/add', async (req, res) => {
  try {
    const { text, metadata = {} } = req.body;
    const userId = getUserId(req);

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const result = await vectorDatabaseService.createEmbedding(text, { ...metadata, userId });

    res.json({
      result,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to add vector:', error);
    res.status(500).json({ error: 'Failed to add vector', details: error.message });
  }
});

router.get('/vector/stats', async (req, res) => {
  try {
    const stats = await vectorDatabaseService.getVectorStats();
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get vector stats:', error);
    res.status(500).json({ error: 'Failed to get vector stats', details: error.message });
  }
});

// ===============================
// MEMORY MANAGEMENT
// ===============================

router.post('/memory/store', async (req, res) => {
  try {
    const { key, value, metadata = {} } = req.body;
    const userId = getUserId(req);

    if (!key || !value) {
      return res.status(400).json({ error: 'Key and value are required' });
    }

    const result = await advancedMemoryService.storeMemory(userId, key, value, metadata);

    res.json({
      result,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to store memory:', error);
    res.status(500).json({ error: 'Failed to store memory', details: error.message });
  }
});

router.get('/memory/search', async (req, res) => {
  try {
    const { query, limit = 10 } = req.query;
    const userId = getUserId(req);

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const results = await advancedMemoryService.searchMemories(userId, query, parseInt(limit));

    res.json({
      results,
      query,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to search memories:', error);
    res.status(500).json({ error: 'Failed to search memories', details: error.message });
  }
});

router.get('/memory/history', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const userId = getUserId(req);

    const history = await advancedMemoryService.getConversationHistory(userId, parseInt(limit));

    res.json({
      history,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get conversation history:', error);
    res.status(500).json({ error: 'Failed to get conversation history', details: error.message });
  }
});

router.get('/memory/profile', async (req, res) => {
  try {
    const userId = getUserId(req);
    const profile = await advancedMemoryService.getUserProfile(userId);

    res.json({
      profile,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile', details: error.message });
  }
});

router.post('/memory/profile', async (req, res) => {
  try {
    const { profileData } = req.body;
    const userId = getUserId(req);

    if (!profileData) {
      return res.status(400).json({ error: 'Profile data is required' });
    }

    const result = await advancedMemoryService.updateUserProfile(userId, profileData);

    res.json({
      result,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to update user profile:', error);
    res.status(500).json({ error: 'Failed to update user profile', details: error.message });
  }
});

router.get('/memory/stats', async (req, res) => {
  try {
    const userId = getUserId(req);
    const stats = await advancedMemoryService.getMemoryStats(userId);

    res.json({
      stats,
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get memory stats:', error);
    res.status(500).json({ error: 'Failed to get memory stats', details: error.message });
  }
});

// ===============================
// VECTOR VISUALIZATIONS
// ===============================

router.post('/visualize', async (req, res) => {
  try {
    const { 
      type = 'scatter',
      dimensions = 2,
      maxVectors = 1000,
      colorBy = 'category',
      includeLabels = true,
      filters = {}
    } = req.body;
    const userId = getUserId(req);

    emitProgress(req, 'processing_started', { type: 'visualization', message: 'Creating visualization...' });

    const result = await vectorVisualizationService.createVectorVisualization({
      type,
      dimensions,
      maxVectors,
      colorBy,
      includeLabels,
      userId,
      filters
    });

    res.json({
      visualization: result,
      userId,
      timestamp: new Date().toISOString()
    });

    emitProgress(req, 'processing_completed', { type: 'visualization', success: true });

  } catch (error) {
    logger.error('Failed to create visualization:', error);
    emitProgress(req, 'processing_completed', { type: 'visualization', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to create visualization', details: error.message });
  }
});

router.get('/visualizations', async (req, res) => {
  try {
    const visualizations = await vectorVisualizationService.getAvailableVisualizations();
    res.json({ visualizations });
  } catch (error) {
    logger.error('Failed to get visualizations:', error);
    res.status(500).json({ error: 'Failed to get visualizations', details: error.message });
  }
});

router.delete('/visualizations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await vectorVisualizationService.deleteVisualization(id);
    
    if (success) {
      res.json({ message: 'Visualization deleted successfully' });
    } else {
      res.status(404).json({ error: 'Visualization not found' });
    }
  } catch (error) {
    logger.error('Failed to delete visualization:', error);
    res.status(500).json({ error: 'Failed to delete visualization', details: error.message });
  }
});

// ===============================
// CONTENT SUMMARIZATION
// ===============================

router.post('/summarize', async (req, res) => {
  try {
    const { content, options = {} } = req.body;
    const userId = getUserId(req);

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    emitProgress(req, 'processing_started', { type: 'summarization', message: 'Summarizing content...' });

    const summary = await openaiService.summarizeContent(content, userId, options);

    res.json({
      summary,
      originalLength: content.length,
      summaryLength: summary.length,
      compressionRatio: (summary.length / content.length * 100).toFixed(2) + '%',
      userId,
      timestamp: new Date().toISOString()
    });

    emitProgress(req, 'processing_completed', { type: 'summarization', success: true });

  } catch (error) {
    logger.error('Failed to summarize content:', error);
    emitProgress(req, 'processing_completed', { type: 'summarization', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to summarize content', details: error.message });
  }
});

// ===============================
// ANALYTICS & INSIGHTS
// ===============================

router.get('/analytics/dashboard', async (req, res) => {
  try {
    const userId = getUserId(req);
    
    // Gather analytics data
    const [vectorStats, memoryStats, processingStats] = await Promise.all([
      vectorDatabaseService.getVectorStats(),
      advancedMemoryService.getMemoryStats(userId),
      multimodalProcessingService.getProcessingStats()
    ]);

    res.json({
      analytics: {
        vectorDatabase: vectorStats,
        memory: memoryStats,
        processing: processingStats,
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: '2.0.0'
        }
      },
      userId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics', details: error.message });
  }
});

// ===============================
// BATCH OPERATIONS
// ===============================

router.post('/batch/embed', async (req, res) => {
  try {
    const { documents } = req.body;
    const userId = getUserId(req);

    if (!documents || !Array.isArray(documents)) {
      return res.status(400).json({ error: 'Documents array is required' });
    }

    emitProgress(req, 'processing_started', { 
      type: 'batch_embedding', 
      message: `Processing ${documents.length} documents...` 
    });

    const results = await vectorDatabaseService.batchInsert(documents);

    res.json({
      results,
      processed: results.length,
      userId,
      timestamp: new Date().toISOString()
    });

    emitProgress(req, 'processing_completed', { 
      type: 'batch_embedding', 
      success: true,
      processed: results.length
    });

  } catch (error) {
    logger.error('Failed to batch embed documents:', error);
    emitProgress(req, 'processing_completed', { type: 'batch_embedding', success: false, error: error.message });
    res.status(500).json({ error: 'Failed to batch embed documents', details: error.message });
  }
});

// ===============================
// ERROR HANDLING
// ===============================

router.use((error, req, res, next) => {
  logger.error('Route error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
