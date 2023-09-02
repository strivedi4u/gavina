// Advanced Memory Service with Reinforcement Learning
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { getRedisClient, getRedisStatus } = require('./redisClient');

class AdvancedMemoryService {
  constructor() {
    this.memoryPath = path.join(__dirname, '..', 'data', 'memory.json');
    this.behaviorPath = path.join(__dirname, '..', 'data', 'behavior.json');
    this.contextPath = path.join(__dirname, '..', 'data', 'context.json');
    this.feedbackPath = path.join(__dirname, '..', 'data', 'feedback.json');
    
    // In-memory caches
    this.conversationHistory = [];
    this.userBehavior = {
      questionPatterns: {},
      topicPreferences: {},
      responseQuality: {},
      sessionData: {},
      learningMetrics: {}
    };
    this.contextMemory = {
      activeTopics: [],
      semanticClusters: {},
      documentSummaries: {},
      keyEntities: {}
    };
    this.feedbackData = {
      ratings: [],
      corrections: [],
      preferences: {},
      modelPerformance: {}
    };

    this.initialize();
  }

  async initialize() {
    try {
      await this.loadMemory();
      await this.loadBehaviorData();
      await this.loadContextData();
      await this.loadFeedbackData();
      console.log('🧠 Advanced Memory System initialized');
    } catch (error) {
      console.log('📝 Creating new memory system...');
      await this.saveAllData();
    }
  }

  // === CONVERSATION MEMORY ===
  
  async recordConversation(sessionId, question, answer, metadata = {}) {
    if (!Array.isArray(this.conversationHistory)) {
      console.warn('conversationHistory corrupted; reinitializing as []');
      this.conversationHistory = [];
    }
    const conversation = {
      id: this.generateId(),
      sessionId,
      timestamp: new Date().toISOString(),
      question: question.trim(),
      answer,
      metadata: {
        ...metadata,
        questionType: this.analyzeQuestionType(question),
        questionLength: question.length,
        answerLength: answer.length,
        complexity: this.calculateComplexity(question),
        topics: this.extractTopics(question + ' ' + answer)
      }
    };
    try { this.conversationHistory.push(conversation); } catch(e) { console.error('Failed to push conversation, resetting array', e); this.conversationHistory = [conversation]; }

    // Redis persistence (list per session + global list)
    try {
      const redis = getRedisClient();
      if (redis && getRedisStatus() === 'connected') {
        await redis.lPush(`conv:${sessionId}`, JSON.stringify(conversation));
        await redis.lTrim(`conv:${sessionId}`, 0, 999);
        await redis.lPush(`conv:global`, JSON.stringify(conversation));
        await redis.lTrim(`conv:global`, 0, 4999);
      }
    } catch (e) { console.warn('Redis conversation store failed:', e.message); }
    
    // Update behavior patterns
    await this.updateBehaviorPatterns(conversation);
    
    // Update context memory
    await this.updateContextMemory(conversation);
    
    // Keep only last 1000 conversations in memory
    if (this.conversationHistory.length > 1000) {
      this.conversationHistory = this.conversationHistory.slice(-1000);
    }

    await this.saveMemory();
    return conversation.id;
  }

  // === BEHAVIOR LEARNING ===
  
  async updateBehaviorPatterns(conversation) {
    const { question, metadata, sessionId } = conversation;
    
    // Track question patterns
    const questionType = metadata.questionType;
    this.userBehavior.questionPatterns[questionType] = 
      (this.userBehavior.questionPatterns[questionType] || 0) + 1;

    // Track topic preferences
    metadata.topics.forEach(topic => {
      this.userBehavior.topicPreferences[topic] = 
        (this.userBehavior.topicPreferences[topic] || 0) + 1;
    });

    // Update session data
    if (!this.userBehavior.sessionData[sessionId]) {
      this.userBehavior.sessionData[sessionId] = {
        startTime: new Date().toISOString(),
        questionCount: 0,
        avgQuestionLength: 0,
        topics: new Set(),
        patterns: []
      };
    }

    const session = this.userBehavior.sessionData[sessionId];
    session.questionCount++;
    session.avgQuestionLength = (session.avgQuestionLength * (session.questionCount - 1) + question.length) / session.questionCount;
    metadata.topics.forEach(topic => session.topics.add(topic));
    session.patterns.push(questionType);

    await this.saveBehaviorData();
  }

  // === REINFORCEMENT LEARNING ===
  
  async recordFeedback(conversationId, rating, feedback = '', correction = '') {
    const feedbackEntry = {
      id: this.generateId(),
      conversationId,
      timestamp: new Date().toISOString(),
      rating: parseInt(rating), // 1-5 scale
      feedback: feedback.trim(),
      correction: correction.trim()
    };

    this.feedbackData.ratings.push(feedbackEntry);
    
    if (correction) {
      this.feedbackData.corrections.push({
        conversationId,
        original: this.getConversationById(conversationId)?.answer,
        corrected: correction,
        timestamp: new Date().toISOString()
      });
    }

    // Update learning metrics
    await this.updateLearningMetrics(feedbackEntry);
    await this.saveFeedbackData();
    
    return feedbackEntry.id;
  }

  async updateLearningMetrics(feedbackEntry) {
    const conversation = this.getConversationById(feedbackEntry.conversationId);
    if (!conversation) return;

    const questionType = conversation.metadata.questionType;
    const model = conversation.metadata.model || 'unknown';

    // Update model performance
    if (!this.feedbackData.modelPerformance[model]) {
      this.feedbackData.modelPerformance[model] = { ratings: [], avgRating: 0 };
    }
    
    this.feedbackData.modelPerformance[model].ratings.push(feedbackEntry.rating);
    this.feedbackData.modelPerformance[model].avgRating = 
      this.feedbackData.modelPerformance[model].ratings.reduce((a, b) => a + b, 0) / 
      this.feedbackData.modelPerformance[model].ratings.length;

    // Update learning metrics for question types
    if (!this.userBehavior.learningMetrics[questionType]) {
      this.userBehavior.learningMetrics[questionType] = { 
        count: 0, avgRating: 0, improvements: [] 
      };
    }

    const metrics = this.userBehavior.learningMetrics[questionType];
    metrics.count++;
    metrics.avgRating = (metrics.avgRating * (metrics.count - 1) + feedbackEntry.rating) / metrics.count;

    if (feedbackEntry.correction) {
      metrics.improvements.push({
        timestamp: new Date().toISOString(),
        improvement: feedbackEntry.correction
      });
    }
  }

  // === CONTEXT MANAGEMENT ===
  
  async updateContextMemory(conversation) {
    const { question, answer, metadata } = conversation;
    
    // Update active topics
    this.contextMemory.activeTopics = [...new Set([
      ...this.contextMemory.activeTopics,
      ...metadata.topics
    ])].slice(-20); // Keep last 20 topics

    // Group topics into semantic clusters
    metadata.topics.forEach(topic => {
      if (!this.contextMemory.semanticClusters[topic]) {
        this.contextMemory.semanticClusters[topic] = {
          count: 0,
          relatedQuestions: [],
          contexts: []
        };
      }
      
      const cluster = this.contextMemory.semanticClusters[topic];
      cluster.count++;
      cluster.relatedQuestions.push(question);
      cluster.contexts.push(answer.substring(0, 200) + '...');
      
      // Keep only recent entries
      if (cluster.relatedQuestions.length > 10) {
        cluster.relatedQuestions = cluster.relatedQuestions.slice(-10);
        cluster.contexts = cluster.contexts.slice(-10);
      }
    });

    await this.saveContextData();
  }

  // === INTELLIGENT QUERY ENHANCEMENT ===
  
  async enhanceQuery(query, sessionId) {
    const enhancement = {
      originalQuery: query,
      enhancedQuery: query,
      context: [],
      suggestions: [],
      relatedTopics: []
    };

    // Get conversation history for context
    const recentConversations = this.getRecentConversations(sessionId, 5);
    
    // Extract context from recent conversations
    const recentTopics = recentConversations.flatMap(conv => conv.metadata.topics);
    enhancement.context = [...new Set(recentTopics)];

    // Find related topics from semantic clusters
    const queryTopics = this.extractTopics(query);
    queryTopics.forEach(topic => {
      if (this.contextMemory.semanticClusters[topic]) {
        const cluster = this.contextMemory.semanticClusters[topic];
        enhancement.relatedTopics.push(...cluster.relatedQuestions.slice(-3));
      }
    });

    // Generate suggestions based on user behavior
    const userPatterns = this.userBehavior.questionPatterns;
    const preferredQuestionType = Object.keys(userPatterns).reduce((a, b) => 
      userPatterns[a] > userPatterns[b] ? a : b
    );

    enhancement.suggestions = this.generateQuerySuggestions(query, preferredQuestionType);

    // Enhance query with context if available
    if (enhancement.context.length > 0) {
      enhancement.enhancedQuery = `Context: ${enhancement.context.join(', ')}. Question: ${query}`;
    }

    return enhancement;
  }

  // === RESPONSE PERSONALIZATION ===
  
  async personalizeResponse(answer, sessionId, questionType) {
    const userPreferences = this.getUserPreferences(sessionId);
    const behavioral = this.userBehavior.sessionData[sessionId];

    let personalizedAnswer = answer;

    // Add personalization based on user behavior
    if (behavioral) {
      // If user asks many "what" questions, provide more definitions
      if (userPreferences.preferredStyle === 'detailed' && questionType === 'what') {
        personalizedAnswer = this.addDetailedExplanation(answer);
      }
      
      // If user prefers brief answers
      if (userPreferences.preferredStyle === 'brief') {
        personalizedAnswer = this.summarizeAnswer(answer);
      }
      
      // Add related topics based on user interests
      const userTopics = Array.from(behavioral.topics).slice(-3);
      if (userTopics.length > 0) {
        personalizedAnswer += `\n\n**Related to your interests**: ${userTopics.join(', ')}`;
      }
    }

    // Add learning-based improvements
    const improvements = this.getLearningImprovements(questionType);
    if (improvements.length > 0) {
      personalizedAnswer += `\n\n**💡 Enhanced based on previous feedback**: ${improvements[0]}`;
    }

    return personalizedAnswer;
  }

  // === ANALYTICS & INSIGHTS ===
  
  getAnalytics() {
    const totalConversations = this.conversationHistory.length;
    const totalFeedback = this.feedbackData.ratings.length;
    
    const analytics = {
      overview: {
        totalConversations,
        totalFeedback,
        avgRating: totalFeedback > 0 ? 
          this.feedbackData.ratings.reduce((sum, f) => sum + f.rating, 0) / totalFeedback : 0,
        activeTopics: this.contextMemory.activeTopics.length
      },
      
      questionPatterns: this.userBehavior.questionPatterns,
      topicPreferences: Object.entries(this.userBehavior.topicPreferences)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10),
      
      modelPerformance: this.feedbackData.modelPerformance,
      
      learningProgress: Object.entries(this.userBehavior.learningMetrics)
        .map(([type, metrics]) => ({
          questionType: type,
          avgRating: metrics.avgRating,
          improvements: metrics.improvements.length
        })),
      
      recentTrends: this.getRecentTrends()
    };

    return analytics;
  }

  // === UTILITY METHODS ===
  
  generateId() {
    return crypto.randomBytes(8).toString('hex');
  }

  analyzeQuestionType(question) {
    const q = question.toLowerCase();
    if (q.startsWith('what') || q.includes('define') || q.includes('explain')) return 'definition';
    if (q.startsWith('how') || q.includes('process') || q.includes('work')) return 'process';
    if (q.startsWith('why') || q.includes('reason') || q.includes('because')) return 'reasoning';
    if (q.startsWith('when') || q.includes('time') || q.includes('date')) return 'temporal';
    if (q.startsWith('where') || q.includes('location') || q.includes('place')) return 'location';
    if (q.startsWith('who') || q.includes('person') || q.includes('people')) return 'person';
    if (q.includes('compare') || q.includes('difference') || q.includes('vs')) return 'comparison';
    if (q.includes('list') || q.includes('examples') || q.includes('types')) return 'enumeration';
    return 'general';
  }

  calculateComplexity(text) {
    const words = text.split(/\s+/).length;
    const sentences = text.split(/[.!?]+/).length;
    const avgWordsPerSentence = words / Math.max(sentences, 1);
    
    if (avgWordsPerSentence > 20) return 'high';
    if (avgWordsPerSentence > 10) return 'medium';
    return 'low';
  }

  extractTopics(text) {
    // Simple topic extraction using key phrases
    const topics = [];
    const topicPatterns = {
      'artificial intelligence': /\b(ai|artificial intelligence|machine learning|deep learning)\b/gi,
      'technology': /\b(technology|tech|digital|software|hardware|computer)\b/gi,
      'science': /\b(science|research|study|analysis|scientific)\b/gi,
      'business': /\b(business|company|market|finance|economy|commercial)\b/gi,
      'health': /\b(health|medical|medicine|healthcare|disease|treatment)\b/gi,
      'education': /\b(education|learning|teaching|school|university|student)\b/gi,
      'environment': /\b(environment|climate|nature|green|sustainability)\b/gi,
      'politics': /\b(politics|government|policy|law|legal|regulation)\b/gi
    };

    Object.entries(topicPatterns).forEach(([topic, pattern]) => {
      if (pattern.test(text)) {
        topics.push(topic);
      }
    });

    return topics;
  }

  getConversationById(id) {
    return this.conversationHistory.find(conv => conv.id === id);
  }

  getRecentConversations(sessionId, limit = 10) {
    // Redis fast-path (async not needed for current interface; could add async variant)
    // Fall back to in-memory snapshot; for real async retrieval we'd refactor
    return this.conversationHistory
      .filter(conv => conv.sessionId === sessionId)
      .slice(-limit);
  }

  getUserPreferences(sessionId) {
    const session = this.userBehavior.sessionData[sessionId];
    if (!session) return { preferredStyle: 'balanced' };

    // Determine preferred style based on behavior
    const avgLength = session.avgQuestionLength;
    const questionCount = session.questionCount;

    return {
      preferredStyle: avgLength < 50 && questionCount > 5 ? 'brief' : 
                    avgLength > 100 ? 'detailed' : 'balanced',
      topics: Array.from(session.topics || []),
      patterns: session.patterns || []
    };
  }

  getLearningImprovements(questionType) {
    const metrics = this.userBehavior.learningMetrics[questionType];
    return metrics ? metrics.improvements.map(imp => imp.improvement) : [];
  }

  generateQuerySuggestions(query, preferredType) {
    const suggestions = [];
    const baseQuery = query.toLowerCase();

    switch (preferredType) {
      case 'definition':
        if (!baseQuery.includes('what is')) {
          suggestions.push(`What is ${query}?`);
        }
        break;
      case 'process':
        if (!baseQuery.includes('how')) {
          suggestions.push(`How does ${query} work?`);
        }
        break;
      case 'comparison':
        suggestions.push(`Compare ${query} with similar concepts`);
        break;
    }

    return suggestions;
  }

  addDetailedExplanation(answer) {
    return answer + '\n\n**Detailed Context**: This explanation provides comprehensive information based on the available knowledge base.';
  }

  summarizeAnswer(answer) {
    const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return sentences.slice(0, 2).join('. ') + '.';
  }

  getRecentTrends() {
    const recent = this.conversationHistory.slice(-50);
    const trends = {
      questionTypes: {},
      topics: {},
      complexity: { high: 0, medium: 0, low: 0 }
    };

    recent.forEach(conv => {
      trends.questionTypes[conv.metadata.questionType] = 
        (trends.questionTypes[conv.metadata.questionType] || 0) + 1;
      
      conv.metadata.topics.forEach(topic => {
        trends.topics[topic] = (trends.topics[topic] || 0) + 1;
      });

      trends.complexity[conv.metadata.complexity]++;
    });

    return trends;
  }

  // === FILE OPERATIONS ===
  
  async loadMemory() {
    try {
      const data = await fs.readFile(this.memoryPath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        this.conversationHistory = parsed;
      } else if (parsed && Array.isArray(parsed.conversations)) {
        this.conversationHistory = parsed.conversations;
      } else {
        console.warn('Memory file format invalid, resetting conversationHistory to []');
        this.conversationHistory = [];
      }
    } catch (error) {
      this.conversationHistory = [];
    }
    if (!Array.isArray(this.conversationHistory)) {
      this.conversationHistory = [];
    }
  }

  async loadBehaviorData() {
    try {
      const data = await fs.readFile(this.behaviorPath, 'utf8');
      this.userBehavior = { ...this.userBehavior, ...JSON.parse(data) };
    } catch (error) {
      // Keep default structure
    }
  }

  async loadContextData() {
    try {
      const data = await fs.readFile(this.contextPath, 'utf8');
      this.contextMemory = { ...this.contextMemory, ...JSON.parse(data) };
    } catch (error) {
      // Keep default structure
    }
  }

  async loadFeedbackData() {
    try {
      const data = await fs.readFile(this.feedbackPath, 'utf8');
      this.feedbackData = { ...this.feedbackData, ...JSON.parse(data) };
    } catch (error) {
      // Keep default structure
    }
  }

  async saveMemory() {
    await fs.writeFile(this.memoryPath, JSON.stringify(this.conversationHistory, null, 2));
  }

  async saveBehaviorData() {
    // Convert Sets to Arrays for JSON serialization
    const behaviorToSave = JSON.parse(JSON.stringify(this.userBehavior, (key, value) => {
      if (value instanceof Set) {
        return Array.from(value);
      }
      return value;
    }));
    await fs.writeFile(this.behaviorPath, JSON.stringify(behaviorToSave, null, 2));
  }

  async saveContextData() {
    await fs.writeFile(this.contextPath, JSON.stringify(this.contextMemory, null, 2));
  }

  async saveFeedbackData() {
    await fs.writeFile(this.feedbackPath, JSON.stringify(this.feedbackData, null, 2));
  }

  async saveAllData() {
    await Promise.all([
      this.saveMemory(),
      this.saveBehaviorData(),
      this.saveContextData(),
      this.saveFeedbackData()
    ]);
  }
}

module.exports = new AdvancedMemoryService();
