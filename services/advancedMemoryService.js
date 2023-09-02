const redis = require('redis');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./loggerService');
const vectorDatabaseService = require('./vectorDatabaseService');

class AdvancedMemoryService {
  constructor() {
    this.redisClient = null;
    this.localMemory = new Map();
    this.conversationHistory = new Map();
    this.userProfiles = new Map();
    this.memoryFile = path.join(__dirname, '../data/memory.json');
    this.conversationFile = path.join(__dirname, '../data/conversations.json');
    this.profilesFile = path.join(__dirname, '../data/user_profiles.json');
    
    this.maxMemorySize = parseInt(process.env.MAX_MEMORY_SIZE) || 1000;
    this.retentionDays = parseInt(process.env.MEMORY_RETENTION_DAYS) || 30;
    
    this.initializeMemory();
    this.startCleanupScheduler();
  }

  async initializeMemory() {
    try {
      // Try to connect to Redis
      if (process.env.REDIS_URL && process.env.REDIS_URL !== 'redis://localhost:6379') {
        this.redisClient = redis.createClient({
          url: process.env.REDIS_URL,
          password: process.env.REDIS_PASSWORD || undefined
        });
        
        await this.redisClient.connect();
        logger.info('Redis memory service initialized');
      } else {
        logger.info('Using local memory storage (Redis not configured)');
        await this.loadLocalMemory();
      }
    } catch (error) {
      logger.error('Failed to connect to Redis, using local storage:', error);
      await this.loadLocalMemory();
    }
  }

  async loadLocalMemory() {
    try {
      if (await fs.pathExists(this.memoryFile)) {
        const data = await fs.readJSON(this.memoryFile);
        this.localMemory = new Map(Object.entries(data));
      }
      
      if (await fs.pathExists(this.conversationFile)) {
        const data = await fs.readJSON(this.conversationFile);
        this.conversationHistory = new Map(Object.entries(data));
      }
      
      if (await fs.pathExists(this.profilesFile)) {
        const data = await fs.readJSON(this.profilesFile);
        this.userProfiles = new Map(Object.entries(data));
      }
    } catch (error) {
      logger.error('Failed to load local memory:', error);
    }
  }

  async saveLocalMemory() {
    try {
      await fs.ensureDir(path.dirname(this.memoryFile));
      
      await fs.writeJSON(this.memoryFile, Object.fromEntries(this.localMemory), { spaces: 2 });
      await fs.writeJSON(this.conversationFile, Object.fromEntries(this.conversationHistory), { spaces: 2 });
      await fs.writeJSON(this.profilesFile, Object.fromEntries(this.userProfiles), { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save local memory:', error);
    }
  }

  async storeMemory(userId, key, value, metadata = {}) {
    try {
      const memoryItem = {
        id: uuidv4(),
        userId,
        key,
        value,
        metadata: {
          timestamp: new Date().toISOString(),
          importance: metadata.importance || 1,
          category: metadata.category || 'general',
          ...metadata
        }
      };

      const memoryKey = `memory:${userId}:${key}`;
      
      if (this.redisClient) {
        await this.redisClient.setEx(memoryKey, 60 * 60 * 24 * this.retentionDays, JSON.stringify(memoryItem));
      } else {
        this.localMemory.set(memoryKey, memoryItem);
        await this.saveLocalMemory();
      }

      // Also store in vector database for semantic search
      await vectorDatabaseService.createEmbedding(
        `${key}: ${JSON.stringify(value)}`,
        {
          userId,
          type: 'memory',
          category: metadata.category || 'general',
          importance: metadata.importance || 1
        }
      );

      logger.info(`Stored memory for user ${userId}: ${key}`);
      return memoryItem;
    } catch (error) {
      logger.error('Failed to store memory:', error);
      throw error;
    }
  }

  async retrieveMemory(userId, key) {
    try {
      const memoryKey = `memory:${userId}:${key}`;
      
      if (this.redisClient) {
        const data = await this.redisClient.get(memoryKey);
        return data ? JSON.parse(data) : null;
      } else {
        return this.localMemory.get(memoryKey) || null;
      }
    } catch (error) {
      logger.error('Failed to retrieve memory:', error);
      return null;
    }
  }

  async searchMemories(userId, query, limit = 10) {
    try {
      // Use vector similarity search for semantic memory retrieval
      const results = await vectorDatabaseService.similaritySearch(
        query,
        limit,
        { userId, type: 'memory' }
      );

      return results.map(result => ({
        id: result.id,
        relevance: result.score,
        content: result.text,
        metadata: result.metadata
      }));
    } catch (error) {
      logger.error('Failed to search memories:', error);
      return [];
    }
  }

  async storeConversation(userId, message, response, context = {}) {
    try {
      const conversationId = uuidv4();
      const conversation = {
        id: conversationId,
        userId,
        message,
        response,
        context,
        timestamp: new Date().toISOString()
      };

      const conversationKey = `conversation:${userId}:${conversationId}`;
      
      if (this.redisClient) {
        await this.redisClient.setEx(conversationKey, 60 * 60 * 24 * this.retentionDays, JSON.stringify(conversation));
        await this.redisClient.lPush(`conversations:${userId}`, conversationId);
        await this.redisClient.lTrim(`conversations:${userId}`, 0, 99); // Keep last 100 conversations
      } else {
        this.conversationHistory.set(conversationKey, conversation);
        await this.saveLocalMemory();
      }

      // Store conversation in vector database for context retrieval
      await vectorDatabaseService.createEmbedding(
        `Q: ${message} A: ${response}`,
        {
          userId,
          type: 'conversation',
          conversationId,
          timestamp: conversation.timestamp
        }
      );

      logger.info(`Stored conversation for user ${userId}`);
      return conversation;
    } catch (error) {
      logger.error('Failed to store conversation:', error);
      throw error;
    }
  }

  async getConversationHistory(userId, limit = 20) {
    try {
      if (this.redisClient) {
        const conversationIds = await this.redisClient.lRange(`conversations:${userId}`, 0, limit - 1);
        const conversations = [];
        
        for (const id of conversationIds) {
          const data = await this.redisClient.get(`conversation:${userId}:${id}`);
          if (data) {
            conversations.push(JSON.parse(data));
          }
        }
        
        return conversations;
      } else {
        const userConversations = Array.from(this.conversationHistory.values())
          .filter(conv => conv.userId === userId)
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, limit);
        
        return userConversations;
      }
    } catch (error) {
      logger.error('Failed to get conversation history:', error);
      return [];
    }
  }

  async updateUserProfile(userId, profileData) {
    try {
      const existingProfile = await this.getUserProfile(userId) || {};
      const updatedProfile = {
        ...existingProfile,
        ...profileData,
        lastUpdated: new Date().toISOString()
      };

      const profileKey = `profile:${userId}`;
      
      if (this.redisClient) {
        await this.redisClient.set(profileKey, JSON.stringify(updatedProfile));
      } else {
        this.userProfiles.set(profileKey, updatedProfile);
        await this.saveLocalMemory();
      }

      // Store profile information in vector database
      await vectorDatabaseService.createEmbedding(
        `User profile: ${JSON.stringify(profileData)}`,
        {
          userId,
          type: 'profile',
          lastUpdated: updatedProfile.lastUpdated
        }
      );

      logger.info(`Updated profile for user ${userId}`);
      return updatedProfile;
    } catch (error) {
      logger.error('Failed to update user profile:', error);
      throw error;
    }
  }

  async getUserProfile(userId) {
    try {
      const profileKey = `profile:${userId}`;
      
      if (this.redisClient) {
        const data = await this.redisClient.get(profileKey);
        return data ? JSON.parse(data) : null;
      } else {
        return this.userProfiles.get(profileKey) || null;
      }
    } catch (error) {
      logger.error('Failed to get user profile:', error);
      return null;
    }
  }

  async getContextualMemory(userId, query, limit = 5) {
    try {
      // Get relevant memories and conversations
      const memories = await this.searchMemories(userId, query, limit);
      const conversations = await this.getConversationHistory(userId, 5);
      const profile = await this.getUserProfile(userId);

      return {
        memories,
        recentConversations: conversations,
        userProfile: profile,
        summary: this.generateContextSummary(memories, conversations, profile)
      };
    } catch (error) {
      logger.error('Failed to get contextual memory:', error);
      return {
        memories: [],
        recentConversations: [],
        userProfile: null,
        summary: ''
      };
    }
  }

  generateContextSummary(memories, conversations, profile) {
    let summary = '';
    
    if (profile) {
      summary += `User preferences: ${JSON.stringify(profile)}\n`;
    }
    
    if (memories.length > 0) {
      summary += `Relevant memories: ${memories.map(m => m.content).join('; ')}\n`;
    }
    
    if (conversations.length > 0) {
      summary += `Recent conversation context: ${conversations.slice(0, 3).map(c => `Q: ${c.message} A: ${c.response}`).join('; ')}\n`;
    }
    
    return summary;
  }

  startCleanupScheduler() {
    // Clean up old memories every hour
    setInterval(async () => {
      await this.cleanupOldMemories();
    }, 60 * 60 * 1000);
  }

  async cleanupOldMemories() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      
      if (!this.redisClient) {
        // Clean up local memory
        for (const [key, item] of this.localMemory) {
          if (new Date(item.metadata.timestamp) < cutoffDate) {
            this.localMemory.delete(key);
          }
        }
        
        for (const [key, item] of this.conversationHistory) {
          if (new Date(item.timestamp) < cutoffDate) {
            this.conversationHistory.delete(key);
          }
        }
        
        await this.saveLocalMemory();
      }
      
      logger.info('Completed memory cleanup');
    } catch (error) {
      logger.error('Failed to cleanup old memories:', error);
    }
  }

  async getMemoryStats(userId) {
    try {
      let memoryCount = 0;
      let conversationCount = 0;
      
      if (this.redisClient) {
        // This would need more complex implementation for Redis
        memoryCount = await this.redisClient.keys(`memory:${userId}:*`).then(keys => keys.length);
        conversationCount = await this.redisClient.lLen(`conversations:${userId}`);
      } else {
        memoryCount = Array.from(this.localMemory.keys()).filter(key => key.includes(userId)).length;
        conversationCount = Array.from(this.conversationHistory.values()).filter(conv => conv.userId === userId).length;
      }
      
      return {
        memoryCount,
        conversationCount,
        hasProfile: !!(await this.getUserProfile(userId))
      };
    } catch (error) {
      logger.error('Failed to get memory stats:', error);
      return { memoryCount: 0, conversationCount: 0, hasProfile: false };
    }
  }
}

module.exports = new AdvancedMemoryService();
