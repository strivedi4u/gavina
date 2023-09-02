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
      answer: `Hello! I'm your advanced RAG assistant. I understand you're asking about "${question}". 

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
      model: 'Advanced RAG Assistant'
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

module.exports = router;
