const express = require('express');
const multer = require('multer');
const { extractTextFromPDF } = require('../services/pdfService');
const { extractTextFromURL } = require('../services/urlService');
const { getEmbeddings, updateVocabulary } = require('../services/embedService');
const { askQuestion } = require('../services/openaiService');
const memoryService = require('../services/memoryService');
const analyticsService = require('../services/analyticsService');
const responseFormatter = require('../services/responseFormatter');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const knowledgeBaseService = require('../services/knowledgeBaseService');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

let memory = []; // { chunk, embedding }

// Simple helper functions that don't depend on external services
function extractTopicsSimple(text) {
  const topicKeywords = {
    'artificial intelligence': /\b(ai|artificial intelligence|machine learning|deep learning)\b/gi,
    'technology': /\b(technology|tech|digital|software|hardware|computer)\b/gi,
    'science': /\b(science|research|study|analysis|scientific)\b/gi,
    'business': /\b(business|company|market|finance|economy)\b/gi,
    'general': /\b(what|how|why|when|where|who)\b/gi
  };
  
  const topics = [];
  Object.entries(topicKeywords).forEach(([topic, pattern]) => {
    if (pattern.test(text)) {
      topics.push(topic);
    }
  });
  
  return topics.length > 0 ? topics : ['general'];
}

function calculateComplexitySimple(text) {
  const words = text.split(/\s+/).length;
  if (words > 20) return 'high';
  if (words > 10) return 'medium';
  return 'low';
}

function analyzeQuestionTypeSimple(question) {
  const q = question.toLowerCase();
  if (q.startsWith('what')) return 'definition';
  if (q.startsWith('how')) return 'process';
  if (q.startsWith('why')) return 'reasoning';
  if (q.startsWith('when')) return 'temporal';
  if (q.startsWith('where')) return 'location';
  if (q.startsWith('who')) return 'person';
  return 'general';
}

// Create text chunks for processing
function createTextChunks(text, maxChunkSize = 1000) {
  const chunks = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (currentChunk.length + trimmedSentence.length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = trimmedSentence;
      } else {
        // If single sentence is too long, split it further
        const words = trimmedSentence.split(' ');
        for (let i = 0; i < words.length; i += 100) {
          chunks.push(words.slice(i, i + 100).join(' '));
        }
      }
    } else {
      currentChunk += (currentChunk ? '. ' : '') + trimmedSentence;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(chunk => chunk.length > 50); // Filter out very short chunks
}

// Cosine similarity function
function cosineSimilarity(a, b) {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Handle general questions without documents
async function handleGeneralQuestion(question, sessionId) {
  console.log('🔧 Handling general question without documents');
  
  try {
    console.log('🎯 Trying free AI service...');
    
    // Use the free AI service to answer general questions
    const freeAiService = require('../services/freeAiService');
    
    const generalContext = `This is a general question without specific document context. 
    Provide a helpful, informative response based on general knowledge.
    Question: ${question}`;
    
    console.log('📞 Calling freeAiService.generateResponse...');
    const answer = await freeAiService.generateResponse(generalContext, question);
    console.log('✅ Free AI service successful, answer length:', answer?.length || 0);
    
    return {
      answer: answer || `I understand you're asking about "${question}". While I don't have specific documents loaded, I'd be happy to help if you upload a document or scrape a URL first. This will give me specific context to provide more accurate and detailed answers.`,
      model: 'General Assistant'
    };
  } catch (error) {
    console.log('❌ General question handling failed:', error.message);
    console.log('🔄 Using fallback response');
    
    return {
      answer: `Hello! I'm Gavina AI. I understand you're asking about "${question}". 

To provide the most accurate and detailed answers, I recommend:

1. **Upload a PDF document** - I can analyze and answer questions about any PDF content
2. **Scrape a webpage** - Provide a URL and I'll extract and analyze the content
3. **Ask specific questions** - Once I have documents to work with, I can provide detailed, contextual answers

I have advanced features including:
- 🧠 **Memory & Learning** - I remember our conversations and learn from your feedback
- 📊 **Analytics** - I track my performance and continuously improve  
- 🎯 **Personalization** - I adapt to your communication style and preferences
- 💬 **Structured Responses** - I provide well-formatted, comprehensive answers

Would you like to upload a document or scrape a URL to get started?`,
      model: 'Gavina AI Assistant'
    };
  }
}

router.post('/upload-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const text = await extractTextFromPDF(filePath);
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text extracted from PDF' });
    }

    const chunks = text.match(/.{1,1000}/g) || [text]; // split into ~1k char chunks

    // Update vocabulary for better embeddings
    updateVocabulary(chunks);

    memory = await Promise.all(
      chunks.map(async chunk => ({
        chunk,
        embedding: await getEmbeddings(chunk)
      }))
    );

    fs.unlinkSync(filePath); // cleanup
    res.json({ message: 'PDF processed and embeddings stored', chunks: chunks.length });
  } catch (error) {
    console.error('Error processing PDF:', error);
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path); // cleanup on error
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }
    res.status(500).json({ error: 'Failed to process PDF' });
  }
});

router.post('/scrape-url', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const text = await extractTextFromURL(url);
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text extracted from URL' });
    }

    const chunks = text.match(/.{1,1000}/g) || [text];

    // Update vocabulary for better embeddings
    updateVocabulary(chunks);

    memory = await Promise.all(
      chunks.map(async chunk => ({
        chunk,
        embedding: await getEmbeddings(chunk)
      }))
    );

    res.json({ message: 'URL processed and embeddings stored', chunks: chunks.length });
  } catch (error) {
    console.error('Error processing URL:', error);
    res.status(500).json({ error: 'Failed to process URL' });
  }
});

// Chat endpoint for frontend compatibility
router.post('/chat', async (req, res) => {
  const startTime = Date.now();
  let userId = req.headers['x-user-id'] || req.body.userId || 'default';
  
  console.log(`💬 Chat message from user ${userId}:`, req.body.message);
  
  try {
    const { message, metadata } = req.body;
    
    if (!message) {
      console.log('❌ No message provided');
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`💭 Processing chat message: "${message}"`);
    console.log(`📚 Memory chunks available: ${memory.length}`);

    // Track the chat event (safe with try-catch)
    try {
      analyticsService.trackSession(userId, 'chat_message', {
        message: message.substring(0, 100),
        topics: extractTopicsSimple(message),
        complexity: calculateComplexitySimple(message)
      });
      console.log('✅ Analytics tracking successful');
    } catch (trackingError) {
      console.log('⚠️ Analytics tracking failed:', trackingError.message);
    }

    // Handle case when no documents are processed
    if (memory.length === 0) {
      console.log('📄 No documents loaded, handling as general chat');
      
      // Still provide a helpful response without document context
      const generalResponse = await handleGeneralQuestion(message, userId);
      const responseTime = Date.now() - startTime;

      console.log('🤖 Generated general response:', generalResponse.model);

      // Try to record conversation
      try {
        await memoryService.recordConversation(userId, message, generalResponse.answer, {
          model: generalResponse.model,
          responseTime,
          type: 'general_chat'
        });
        console.log('💾 Conversation recorded in memory');
      } catch (memoryError) {
        console.log('⚠️ Memory recording failed:', memoryError.message);
      }

      return res.json({
        response: generalResponse.answer,
        model: generalResponse.model,
        responseTime,
        memoryUsed: false,
        documentsUsed: 0,
        type: 'general_chat'
      });
    }

    // Find relevant context from memory
    const questionEmbedding = await getEmbeddings(message);
    const similarities = memory.map(item => ({
      ...item,
      similarity: cosineSimilarity(questionEmbedding, item.embedding)
    }));

    // Get top relevant chunks
    const relevantChunks = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
      .filter(item => item.similarity > 0.3);

    console.log(`🔍 Found ${relevantChunks.length} relevant chunks`);

    // Prepare context
    let context = '';
    if (relevantChunks.length > 0) {
      context = relevantChunks.map(chunk => chunk.chunk).join('\n\n');
      console.log(`📖 Context length: ${context.length} characters`);
    }

    // Generate response
    const response = await askQuestion(message, context, userId);
    const responseTime = Date.now() - startTime;

    console.log(`🤖 Generated response in ${responseTime}ms`);

    // Try to record conversation with full context
    try {
      await memoryService.recordConversation(userId, message, response.answer || response, {
        model: response.model || 'unknown',
        responseTime,
        documentsUsed: relevantChunks.length,
        contextLength: context.length,
        type: 'document_chat',
        metadata
      });
      console.log('💾 Conversation recorded with context');
    } catch (memoryError) {
      console.log('⚠️ Memory recording failed:', memoryError.message);
    }

    return res.json({
      response: response.answer || response,
      model: response.model || 'gpt-4',
      responseTime,
      memoryUsed: true,
      documentsUsed: relevantChunks.length,
      contextLength: context.length,
      similarities: relevantChunks.map(chunk => ({
        text: chunk.chunk.substring(0, 100) + '...',
        similarity: chunk.similarity.toFixed(3)
      })),
      type: 'document_chat'
    });

  } catch (error) {
    console.error('💥 Error in chat:', error);
    const responseTime = Date.now() - startTime;
    
    return res.status(500).json({
      error: 'Failed to process chat message',
      details: error.message,
      responseTime,
      type: 'error'
    });
  }
});

// Multi-file upload endpoint for frontend compatibility
router.post('/upload', upload.array('files'), async (req, res) => {
  console.log('📁 Multi-file upload request received');
  
  try {
    const files = req.files || [];
    const question = req.body.question || 'Analyze these files and provide insights.';
    const userId = req.headers['x-user-id'] || req.body.userId || 'default';
    
    console.log(`📎 Processing ${files.length} files for user ${userId}`);
    
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    let totalChunks = 0;
    let processedFiles = 0;
    let analysisResults = [];

    // Process each file
    for (const file of files) {
      try {
        console.log(`📄 Processing file: ${file.originalname}`);
        
        // Only process PDF files for now (can be extended)
        if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
          const text = await extractTextFromPDF(file.path);
          
          if (text && text.trim()) {
            // Create chunks and embeddings
            const chunks = createTextChunks(text);
            
            for (const chunk of chunks) {
              try {
                const embedding = await getEmbeddings(chunk);
                memory.push({
                  chunk,
                  embedding,
                  source: file.originalname,
                  timestamp: new Date().toISOString(),
                  userId
                });
                totalChunks++;
              } catch (embeddingError) {
                console.warn('Failed to create embedding for chunk:', embeddingError.message);
              }
            }

            // Enhance: persist vectors in vector DB
            try {
              const vectorDatabaseService = require('../services/vectorDatabaseService');
              
              // INSERT: helper to safely create embedding in vector DB
              async function safeStoreVectorChunk(vectorDatabaseService, chunk, fileName, userId) {
                try {
                  await vectorDatabaseService.createEmbedding(chunk, { source: fileName, fileName, type: 'document', userId });
                } catch (e) {
                  console.warn('Vector DB store failed (non-fatal):', e.message);
                }
              }
              
              await Promise.all(chunks.map(chunk => safeStoreVectorChunk(vectorDatabaseService, chunk, file.originalname, userId)));
              
              console.log(`✅ Vectors stored in DB for file: ${file.originalname}`);
            } catch (dbError) {
              console.error('Failed to store vectors in DB:', dbError.message);
            }

            analysisResults.push({
              filename: file.originalname,
              chunks: chunks.length,
              preview: text.substring(0, 200) + '...'
            });
            
            processedFiles++;
          }
        } else {
          console.log(`⚠️ Unsupported file type: ${file.mimetype}`);
          analysisResults.push({
            filename: file.originalname,
            error: 'Unsupported file type'
          });
        }

        // Clean up uploaded file
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          console.warn('Failed to clean up file:', unlinkError.message);
        }

      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        analysisResults.push({
          filename: file.originalname,
          error: fileError.message
        });
      }
    }

    // Generate analysis response if files were processed
    let response = null;
    if (totalChunks > 0) {
      try {
        console.log(`🤖 Generating analysis for ${processedFiles} files`);
        const context = memory.slice(-10).map(item => item.chunk).join('\n\n');
        response = await askQuestion(question, context, userId);
      } catch (analysisError) {
        console.error('Failed to generate analysis:', analysisError.message);
        response = 'Files processed successfully, but analysis generation failed.';
      }
    }

    console.log(`✅ Upload complete: ${processedFiles} files, ${totalChunks} chunks`);

    res.json({
      success: true,
      filesProcessed: processedFiles,
      totalChunks,
      response: response?.answer || response,
      model: response?.model || 'gpt-4',
      analysisResults,
      message: `Processed ${processedFiles} files with ${totalChunks} text chunks`
    });

  } catch (error) {
    console.error('💥 Upload error:', error);
    res.status(500).json({
      error: 'Failed to process uploaded files',
      details: error.message
    });
  }
});

// Process URL endpoint
router.post('/process-url', async (req, res) => {
  console.log('🌐 URL processing request received');
  
  try {
    const { url, question } = req.body;
    const userId = req.headers['x-user-id'] || req.body.userId || 'default';
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log(`🔗 Processing URL: ${url}`);
    
    // Extract text from URL
    const text = await extractTextFromURL(url);
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No text content found at URL' });
    }

    // Create chunks and embeddings
    const chunks = createTextChunks(text);
    let totalChunks = 0;

    for (const chunk of chunks) {
      try {
        const embedding = await getEmbeddings(chunk);
        memory.push({
          chunk,
          embedding,
          source: url,
          timestamp: new Date().toISOString(),
          userId
        });
        totalChunks++;
      } catch (embeddingError) {
        console.warn('Failed to create embedding for chunk:', embeddingError.message);
      }
    }

    // Generate analysis response
    let response = null;
    if (totalChunks > 0 && question) {
      try {
        console.log('🤖 Generating URL analysis');
        const context = chunks.join('\n\n');
        response = await askQuestion(question, context, userId);
      } catch (analysisError) {
        console.error('Failed to generate analysis:', analysisError.message);
        response = 'URL processed successfully, but analysis generation failed.';
      }
    }

    console.log(`✅ URL processing complete: ${totalChunks} chunks`);

    res.json({
      success: true,
      urlsProcessed: 1,
      totalChunks,
      response: response?.answer || response,
      model: response?.model || 'gpt-4',
      url,
      preview: text.substring(0, 200) + '...',
      message: `Processed URL with ${totalChunks} text chunks`
    });

  } catch (error) {
    console.error('💥 URL processing error:', error);
    res.status(500).json({
      error: 'Failed to process URL',
      details: error.message
    });
  }
});

router.post('/ask', async (req, res) => {
  const startTime = Date.now();
  let sessionId = req.body.sessionId || 'default';
  
  console.log(`📝 Received question from session ${sessionId}:`, req.body.question);
  
  try {
    const { question } = req.body;
    
    if (!question) {
      console.log('❌ No question provided');
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log(`💭 Processing question: "${question}"`);
    console.log(`📚 Memory chunks available: ${memory.length}`);

    // Track the question event (safe with try-catch)
    try {
      analyticsService.trackSession(sessionId, 'question_asked', {
        question: question.substring(0, 100),
        topics: extractTopicsSimple(question),
        complexity: calculateComplexitySimple(question)
      });
      console.log('✅ Analytics tracking successful');
    } catch (trackingError) {
      console.log('⚠️ Analytics tracking failed:', trackingError.message);
    }

    // Handle case when no documents are processed
    if (memory.length === 0) {
      console.log('📄 No documents loaded, handling as general question');
      
      // Still provide a helpful response without document context
      const generalResponse = await handleGeneralQuestion(question, sessionId);
      const responseTime = Date.now() - startTime;

      console.log('🤖 Generated general response:', generalResponse.model);

      // Try to record conversation
      try {
        await memoryService.recordConversation(sessionId, question, generalResponse.answer, {
          model: generalResponse.model,
          responseTime,
          questionType: analyzeQuestionTypeSimple(question),
          noDocuments: true
        });
        console.log('✅ Memory recording successful');
      } catch (memoryError) {
        console.log('⚠️ Memory recording failed:', memoryError.message);
      }

      console.log(`🚀 Sending response (${responseTime}ms)`);
      return res.json({ 
        answer: generalResponse.answer,
        metadata: {
          sessionId,
          responseTime,
          model: generalResponse.model,
          questionType: analyzeQuestionTypeSimple(question),
          noDocuments: true,
          suggestions: ['Try uploading a document or scraping a URL first', 'Ask general questions about topics you\'re interested in']
        }
      });
    }

    // Enhance query with context and learning (safe with try-catch)
    let enhancement;
    try {
      enhancement = await memoryService.enhanceQuery(question, sessionId);
    } catch (enhanceError) {
      console.log('Query enhancement failed:', enhanceError.message);
      enhancement = { enhancedQuery: question, relatedTopics: [], suggestions: [], context: [] };
    }
    const queryToUse = enhancement.enhancedQuery;

    const questionEmbedding = await getEmbeddings(queryToUse);

    // cosine similarity
    const similarity = (a, b) => {
      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    };

    memory.sort((a, b) =>
      similarity(questionEmbedding, b.embedding) -
      similarity(questionEmbedding, a.embedding)
    );

    const topChunks = memory.slice(0, 3).map(m => m.chunk).join('\n');

    // Generate answer with AI service
    const rawAnswer = await askQuestion(topChunks, question);
    const responseTime = Date.now() - startTime;

    // Extract model information
    const modelMatch = rawAnswer.match(/\*\*\[Generated by ([^\]]+)\]\*\*/);
    const model = modelMatch ? modelMatch[1] : 'Unknown';
    const cleanAnswer = rawAnswer.replace(/\*\*\[Generated by [^\]]+\]\*\*\n\n/, '');

    // Determine question type for formatting
    const questionType = analyzeQuestionTypeSimple(question);

    // Format response structurally (safe with try-catch)
    let formattedAnswer;
    try {
      formattedAnswer = responseFormatter.formatResponse(cleanAnswer, questionType, {
        model,
        confidence: 'Medium',
        relatedTopics: enhancement.relatedTopics,
        context: enhancement.context.join(', ')
      });
    } catch (formatError) {
      console.log('Response formatting failed:', formatError.message);
      formattedAnswer = cleanAnswer;
    }

    // Personalize response based on user behavior (safe with try-catch)
    let personalizedAnswer;
    try {
      const userPreferences = memoryService.getUserPreferences(sessionId);
      personalizedAnswer = await memoryService.personalizeResponse(
        formattedAnswer, 
        sessionId, 
        questionType
      );
    } catch (personalizeError) {
      console.log('Response personalization failed:', personalizeError.message);
      personalizedAnswer = formattedAnswer;
    }

    // Add personalized elements (safe with try-catch)
    let finalResponse;
    try {
      const userPreferences = memoryService.getUserPreferences(sessionId);
      finalResponse = responseFormatter.addPersonalizedElements(
        personalizedAnswer,
        userPreferences,
        {
          previousQuestions: enhancement.relatedTopics,
          suggestions: enhancement.suggestions
        }
      );
    } catch (personalizeElementsError) {
      console.log('Adding personalized elements failed:', personalizeElementsError.message);
      finalResponse = personalizedAnswer;
    }

    // Record conversation in memory (safe with try-catch)
    let conversationId = null;
    try {
      conversationId = await memoryService.recordConversation(sessionId, question, finalResponse, {
        model,
        responseTime,
        questionType,
        originalQuery: question,
        enhancedQuery: queryToUse,
        chunksUsed: 3
      });
    } catch (memoryError) {
      console.log('Memory recording failed:', memoryError.message);
      conversationId = 'temp_' + Date.now();
    }

    // Track response generation (safe with try-catch)
    try {
      analyticsService.trackSession(sessionId, 'response_generated', {
        model,
        responseTime,
        conversationId,
        questionType
      });
    } catch (analyticsError) {
      console.log('Analytics tracking failed:', analyticsError.message);
    }

    res.json({ 
      answer: finalResponse,
      metadata: {
        conversationId,
        sessionId,
        responseTime,
        model,
        questionType,
        suggestions: enhancement.suggestions,
        relatedTopics: enhancement.relatedTopics
      }
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error('Error answering question:', error);
    
    // Track error (safe with try-catch)
    try {
      analyticsService.trackSession(sessionId, 'error_occurred', {
        error: error.message,
        responseTime
      });
    } catch (trackingError) {
      console.log('Error tracking failed:', trackingError.message);
    }

    res.status(500).json({ error: 'Failed to answer question' });
  }
});

// === FEEDBACK & LEARNING ENDPOINTS ===

router.post('/feedback', async (req, res) => {
  try {
    const { conversationId, rating, feedback, correction } = req.body;
    
    if (!conversationId || !rating) {
      return res.status(400).json({ error: 'Conversation ID and rating are required' });
    }

    const feedbackId = await memoryService.recordFeedback(
      conversationId, 
      rating, 
      feedback || '', 
      correction || ''
    );

    // Track feedback in analytics
    analyticsService.trackSession(req.body.sessionId || 'default', 'feedback_received', {
      rating: parseInt(rating),
      hasFeedback: !!feedback,
      hasCorrection: !!correction
    });

    res.json({ 
      message: 'Feedback recorded successfully', 
      feedbackId,
      learningStatus: 'System will improve based on your feedback'
    });

  } catch (error) {
    console.error('Error recording feedback:', error);
    res.status(500).json({ error: 'Failed to record feedback' });
  }
});

// === MEMORY & CONTEXT ENDPOINTS ===

router.get('/conversation-history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const conversations = memoryService.getRecentConversations(sessionId, limit);
    
    res.json({
      sessionId,
      conversations: conversations.map(conv => ({
        id: conv.id,
        timestamp: conv.timestamp,
        question: conv.question,
        answer: conv.answer.substring(0, 200) + '...', // Truncated for overview
        questionType: conv.metadata.questionType,
        topics: conv.metadata.topics
      })),
      totalConversations: conversations.length
    });

  } catch (error) {
    console.error('Error fetching conversation history:', error);
    res.status(500).json({ error: 'Failed to fetch conversation history' });
  }
});

router.get('/user-profile/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const preferences = memoryService.getUserPreferences(sessionId);
    const behaviorData = memoryService.userBehavior.sessionData[sessionId];
    
    const profile = {
      sessionId,
      preferences,
      behavior: behaviorData ? {
        totalQuestions: behaviorData.questionCount,
        avgQuestionLength: Math.round(behaviorData.avgQuestionLength),
        interests: Array.from(behaviorData.topics || []),
        patterns: behaviorData.patterns || [],
        sessionStarted: behaviorData.startTime
      } : null,
      recommendations: memoryService.generateQuerySuggestions('', preferences.preferredStyle || 'general')
    };

    res.json(profile);

  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// === ANALYTICS ENDPOINTS ===

router.get('/analytics/overview', async (req, res) => {
  try {
    const analytics = memoryService.getAnalytics();
    const systemReport = analyticsService.generateReport();
    
    const overview = {
      ...analytics,
      systemHealth: systemReport.summary.systemHealth,
      alerts: systemReport.alerts,
      lastUpdated: new Date().toISOString()
    };

    res.json(overview);

  } catch (error) {
    console.error('Error generating analytics:', error);
    res.status(500).json({ error: 'Failed to generate analytics' });
  }
});

router.get('/analytics/insights', async (req, res) => {
  try {
    const insights = analyticsService.generateInsights();
    
    res.json({
      insights,
      recommendations: insights.recommendations,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error generating insights:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

router.get('/analytics/report', async (req, res) => {
  try {
    const timeframe = req.query.timeframe || '7days';
    const report = analyticsService.generateReport(timeframe);
    
    res.json(report);

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// === CONTEXT & SUGGESTIONS ENDPOINTS ===

router.get('/suggestions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const query = req.query.q || '';
    
    const enhancement = await memoryService.enhanceQuery(query, sessionId);
    const userPreferences = memoryService.getUserPreferences(sessionId);
    
    const suggestions = {
      queryEnhancement: enhancement,
      personalizedSuggestions: memoryService.generateQuerySuggestions(
        query, 
        userPreferences.preferredStyle || 'general'
      ),
      relatedTopics: enhancement.relatedTopics,
      contextualHints: enhancement.context
    };

    res.json(suggestions);

  } catch (error) {
    console.error('Error generating suggestions:', error);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

router.get('/context/topics', async (req, res) => {
  try {
    const activeTopics = memoryService.contextMemory.activeTopics;
    const semanticClusters = memoryService.contextMemory.semanticClusters;
    
    const topicAnalysis = Object.entries(semanticClusters)
      .map(([topic, cluster]) => ({
        topic,
        frequency: cluster.count,
        recentQuestions: cluster.relatedQuestions.slice(-3),
        contextPreview: cluster.contexts[0]
      }))
      .sort((a, b) => b.frequency - a.frequency);

    res.json({
      activeTopics,
      topicAnalysis: topicAnalysis.slice(0, 10),
      totalTopics: Object.keys(semanticClusters).length
    });

  } catch (error) {
    console.error('Error fetching topic context:', error);
    res.status(500).json({ error: 'Failed to fetch topic context' });
  }
});

// 🚀 ADVANCED VECTOR DATABASE ENDPOINTS

// Get advanced vector database statistics
router.get('/vector-stats/advanced', async (req, res) => {
  try {
    console.log('📊 Fetching advanced vector database statistics');
    const vectorDatabaseService = require('../services/vectorDatabaseService');
    const stats = await vectorDatabaseService.getAdvancedVectorStats();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching advanced vector stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch advanced vector statistics',
      details: error.message
    });
  }
});

// Analyze vector similarity patterns
router.get('/vector-stats/similarity-analysis', async (req, res) => {
  try {
    const sampleSize = parseInt(req.query.sampleSize) || 100;
    console.log(`🔍 Analyzing vector similarity patterns with sample size: ${sampleSize}`);
    
    const vectorDatabaseService = require('../services/vectorDatabaseService');
    const analysis = await vectorDatabaseService.analyzeSimilarityPatterns(sampleSize);
    
    res.json({
      success: true,
      data: analysis,
      sampleSize,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error analyzing similarity patterns:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze similarity patterns',
      details: error.message
    });
  }
});

// Optimize vector database
router.post('/vector-database/optimize', async (req, res) => {
  try {
    console.log('🔧 Starting vector database optimization');
    
    const vectorDatabaseService = require('../services/vectorDatabaseService');
    const result = await vectorDatabaseService.optimizeVectorDatabase();
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Vector database optimization error:', error);
    res.status(500).json({
      success: false,
      error: 'Optimization failed',
      details: error.message
    });
  }
});

// Status endpoint
router.get('/status', async (req, res) => {
  try {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        vectorDatabase: 'connected',
        memory: 'enabled',
        vision: 'enabled',
        audio: 'enabled'
      },
      stats: {
        documentsLoaded: memory.length,
        uptime: process.uptime()
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// Memory stats endpoint
router.get('/memory/stats', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'default';
    
    // Get memory stats from memoryService
    let stats = {
      conversationCount: 0,
      memoryCount: memory.length,
      hasProfile: false
    };

    try {
      const conversations = await memoryService.getConversationHistory(userId, 100);
      stats.conversationCount = conversations.length;
      
      const profile = await memoryService.getUserProfile(userId);
      stats.hasProfile = profile && Object.keys(profile).length > 0;
    } catch (memoryError) {
      console.warn('Failed to get memory stats:', memoryError.message);
    }

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Vector stats endpoint
router.get('/vector/stats', async (req, res) => {
  try {
    const vectorDatabaseService = require('../services/vectorDatabaseService');
    const stats = await vectorDatabaseService.getVectorStats();
    
    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      totalVectors: memory.length,
      dimension: 1024,
      indexFullness: 0
    });
  }
});

// Visualize endpoint (deprecated simple version replaced with advanced visualization service)
// Advanced Vector Visualization Endpoints
const vectorVisualizationService = require('../services/vectorVisualizationService');

router.post('/vector/visualizations', async (req, res) => {
  try {
    const { type = 'scatter', dimensions = 2, maxVectors = 500, colorBy = 'type', includeLabels = true } = req.body;
    const result = await vectorVisualizationService.createVectorVisualization({
      type,
      dimensions: Math.min(Math.max(dimensions, 2), 3),
      maxVectors: Math.min(maxVectors, 2000),
      colorBy,
      includeLabels
    });
    res.json({ success: true, visualization: result });
  } catch (error) {
    console.error('Visualization creation failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/vector/visualizations', async (req, res) => {
  try {
    const visualizations = await vectorVisualizationService.getAvailableVisualizations();
    res.json({ success: true, visualizations });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/vector/visualizations/:id', async (req, res) => {
  try {
    const deleted = await vectorVisualizationService.deleteVisualization(req.params.id);
    res.json({ success: deleted });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Word network (co-occurrence) endpoint to visualize how words connect across stored vectors / memory
router.get('/vector/word-network', async (req, res) => {
  try {
    const vectorDatabaseService = require('../services/vectorDatabaseService');
    const vectors = await vectorDatabaseService.getAllVectors();

    // Build word frequency and co-occurrence
    const stopWords = new Set(['the','and','is','to','of','a','in','it','for','on','with','this','that','as','are','at','be','by','or','an','from']);
    const wordFreq = new Map();
    const edgeWeights = new Map(); // key: word1|word2

    vectors.forEach(v => {
      const text = (v.metadata && v.metadata.text) ? v.metadata.text.toLowerCase() : '';
      if (!text) return;
      const tokens = Array.from(new Set(text.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !stopWords.has(w)))).slice(0, 25);
      // count
      tokens.forEach(w => wordFreq.set(w, (wordFreq.get(w) || 0) + 1));
      // co-occurrence pairs
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const a = tokens[i];
            const b = tokens[j];
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          edgeWeights.set(key, (edgeWeights.get(key) || 0) + 1);
        }
      }
    });

    // Take top N words
    const topN = parseInt(req.query.top || '50');
    const topWords = Array.from(wordFreq.entries())
      .sort((a,b) => b[1]-a[1])
      .slice(0, topN)
      .map(([word, freq], idx) => ({ id: word, group: idx % 8, frequency: freq }));
    const wordSet = new Set(topWords.map(w => w.id));

    const links = [];
    edgeWeights.forEach((w, key) => {
      const [a,b] = key.split('|');
      if (wordSet.has(a) && wordSet.has(b) && w > 1) {
        links.push({ source: a, target: b, value: w });
      }
    });

    res.json({ success: true, nodes: topWords, links });
  } catch (error) {
    console.error('Word network generation failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Vector Source Listing Endpoint ---
router.get('/vector/sources', async (req, res) => {
  try {
    const vectorDatabaseService = require('../services/vectorDatabaseService');
    const vectors = await vectorDatabaseService.getAllVectors();
    const map = new Map();
    vectors.forEach(v => {
      const src = v.metadata?.source || v.metadata?.fileName || 'unknown';
      map.set(src, (map.get(src) || 0) + 1);
    });
    const sources = Array.from(map.entries()).map(([source, count]) => ({ source, count })).sort((a,b)=> b.count - a.count);
    res.json({ success: true, sources });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Visualization by Source Endpoint ---
router.post('/vector/visualizations/by-source', async (req, res) => {
  try {
    const { source = 'all', type = 'network', maxVectors = 500 } = req.body;
    const vectorVisualizationService = require('../services/vectorVisualizationService');
    const filters = source === 'all' ? {} : { source };
    const result = await vectorVisualizationService.createVectorVisualization({
      type,
      maxVectors: Math.min(maxVectors, 2000),
      dimensions: 2,
      colorBy: 'source',
      includeLabels: true,
      filters
    });
    res.json({ success: true, visualization: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Knowledge Base Q&A endpoint
router.post('/kb/ask', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.length < 3) return res.status(400).json({ error: 'Question required' });
    const results = await knowledgeBaseService.searchKB(question);
    if (results.length === 0) {
      return res.json({ success: false, answer: 'No direct answer found in the knowledge base.' });
    }
    // Return best answer and top 3 related
    res.json({
      success: true,
      answer: results[0].answer,
      question: results[0].question,
      related: results.slice(1, 4).map(r => ({ question: r.question, answer: r.answer }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
