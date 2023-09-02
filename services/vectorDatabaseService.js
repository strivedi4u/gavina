const { Pinecone } = require('@pinecone-database/pinecone');
const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./loggerService');
const { HfInference } = require('@huggingface/inference');

// Advanced Vector Database Features
class VectorClusteringService {
  constructor() {
    this.clusters = new Map();
    this.clusterCentroids = new Map();
  }

  // K-means clustering for vector organization
  async performKMeansClustering(vectors, k = 5, maxIterations = 100) {
    if (vectors.length < k) return vectors.map((v, i) => ({ ...v, cluster: i }));

    // Initialize centroids randomly
    const centroids = [];
    for (let i = 0; i < k; i++) {
      const randomVector = vectors[Math.floor(Math.random() * vectors.length)];
      centroids.push([...randomVector.values]);
    }

    let assignments = new Array(vectors.length).fill(0);
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let changed = false;

      // Assign vectors to nearest centroid
      vectors.forEach((vector, idx) => {
        let minDist = Infinity;
        let closestCentroid = 0;

        centroids.forEach((centroid, centroidIdx) => {
          const dist = this.euclideanDistance(vector.values, centroid);
          if (dist < minDist) {
            minDist = dist;
            closestCentroid = centroidIdx;
          }
        });

        if (assignments[idx] !== closestCentroid) {
          assignments[idx] = closestCentroid;
          changed = true;
        }
      });

      if (!changed) break;

      // Update centroids
      for (let i = 0; i < k; i++) {
        const clusterVectors = vectors.filter((_, idx) => assignments[idx] === i);
        if (clusterVectors.length > 0) {
          const dimension = clusterVectors[0].values.length;
          const newCentroid = new Array(dimension).fill(0);
          
          clusterVectors.forEach(vector => {
            vector.values.forEach((val, dimIdx) => {
              newCentroid[dimIdx] += val / clusterVectors.length;
            });
          });
          
          centroids[i] = newCentroid;
        }
      }
    }

    // Return vectors with cluster assignments
    return vectors.map((vector, idx) => ({
      ...vector,
      cluster: assignments[idx]
    }));
  }

  euclideanDistance(a, b) {
    return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
  }

  // Hierarchical clustering for better organization
  async performHierarchicalClustering(vectors, threshold = 0.7) {
    const clusters = vectors.map((v, i) => ({ id: i, vectors: [v], centroid: [...v.values] }));
    
    while (clusters.length > 1) {
      let maxSimilarity = -1;
      let mergeIndices = [0, 1];

      // Find most similar clusters
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const similarity = this.cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
          if (similarity > maxSimilarity) {
            maxSimilarity = similarity;
            mergeIndices = [i, j];
          }
        }
      }

      if (maxSimilarity < threshold) break;

      // Merge clusters
      const [i, j] = mergeIndices;
      const mergedCluster = {
        id: `${clusters[i].id}_${clusters[j].id}`,
        vectors: [...clusters[i].vectors, ...clusters[j].vectors],
        centroid: this.calculateCentroid([...clusters[i].vectors, ...clusters[j].vectors])
      };

      clusters.splice(Math.max(i, j), 1);
      clusters.splice(Math.min(i, j), 1);
      clusters.push(mergedCluster);
    }

    return clusters;
  }

  calculateCentroid(vectors) {
    if (vectors.length === 0) return [];
    const dimension = vectors[0].values.length;
    const centroid = new Array(dimension).fill(0);
    
    vectors.forEach(vector => {
      vector.values.forEach((val, idx) => {
        centroid[idx] += val / vectors.length;
      });
    });
    
    return centroid;
  }

  cosineSimilarity(a, b) {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }
}

class VectorDatabaseService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    this.pinecone = null;
    this.index = null;
    this.localVectors = new Map(); // Fallback local storage
    this.vectorFile = path.join(__dirname, '../data/local_vectors.json');
    this.clusteringService = new VectorClusteringService();
    this.vectorCache = new Map(); // Performance optimization
    this.semanticCache = new Map(); // Cache for search results
    this.batchQueue = []; // Queue for batch processing
    this.isProcessingBatch = false;
    this.vectorAnalytics = {
      totalQueries: 0,
      totalInserts: 0,
      avgResponseTime: 0,
      cacheHitRate: 0,
      clusterDistribution: new Map()
    };
    
    this.hf = process.env.HUGGINGFACE_API_KEY ? new HfInference(process.env.HUGGINGFACE_API_KEY) : null;
    this.multilingualModel = process.env.MULTILINGUAL_EMBED_MODEL || 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';
    
    this.initializeDatabase();
    this.startBatchProcessor();
  }

  async initializeDatabase() {
    try {
      if (process.env.PINECONE_API_KEY && process.env.PINECONE_API_KEY !== 'your_pinecone_api_key') {
        this.pinecone = new Pinecone({
          apiKey: process.env.PINECONE_API_KEY,
        });
        
        this.index = this.pinecone.index(process.env.PINECONE_INDEX_NAME || 'advanced-rag-index');
        
        // Advanced index configuration
        await this.configureAdvancedIndex();
        
        logger.info('🚀 Advanced Pinecone vector database initialized with clustering and optimization');
      } else {
        logger.info('🔧 Using advanced local vector storage with clustering capabilities');
        await this.loadLocalVectors();
        await this.optimizeLocalVectors();
      }
      
      // Initialize vector analytics
      await this.loadAnalytics();
      
    } catch (error) {
      logger.error('Failed to initialize vector database:', error);
      await this.loadLocalVectors();
    }
  }

  // Advanced index configuration for better performance
  async configureAdvancedIndex() {
    try {
      // Check if we need to create index with better configuration
      const stats = await this.index.describeIndexStats();
      logger.info(`📊 Vector Database Stats: ${stats.totalRecordCount} vectors, ${Math.round(stats.indexFullness * 100)}% full`);
      
      // Implement auto-scaling logic if needed
      if (stats.indexFullness > 0.8) {
        logger.warn('⚠️ Vector database approaching capacity, consider scaling');
      }
    } catch (error) {
      logger.warn('Could not get index stats:', error.message);
    }
  }

  // Optimize local vectors with clustering
  async optimizeLocalVectors() {
    if (this.localVectors.size > 100) {
      logger.info('🔄 Optimizing local vectors with clustering...');
      const vectors = Array.from(this.localVectors.values());
      
      // Perform clustering for better organization
      const clusteredVectors = await this.clusteringService.performKMeansClustering(vectors, Math.min(10, Math.floor(vectors.length / 10)));
      
      // Update cluster analytics
      clusteredVectors.forEach(vector => {
        const cluster = vector.cluster;
        this.vectorAnalytics.clusterDistribution.set(cluster, 
          (this.vectorAnalytics.clusterDistribution.get(cluster) || 0) + 1);
      });
      
      logger.info(`✅ Vectors organized into ${this.vectorAnalytics.clusterDistribution.size} clusters`);
    }
  }

  // Load and save analytics
  async loadAnalytics() {
    try {
      const analyticsFile = path.join(__dirname, '../data/vector_analytics.json');
      if (await fs.pathExists(analyticsFile)) {
        const data = await fs.readJSON(analyticsFile);
        this.vectorAnalytics = { ...this.vectorAnalytics, ...data };
      }
    } catch (error) {
      logger.error('Failed to load vector analytics:', error);
    }
  }

  async saveAnalytics() {
    try {
      const analyticsFile = path.join(__dirname, '../data/vector_analytics.json');
      await fs.writeJSON(analyticsFile, {
        ...this.vectorAnalytics,
        clusterDistribution: Object.fromEntries(this.vectorAnalytics.clusterDistribution)
      }, { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save vector analytics:', error);
    }
  }

  async loadLocalVectors() {
    try {
      if (await fs.pathExists(this.vectorFile)) {
        const data = await fs.readJSON(this.vectorFile);
        this.localVectors = new Map(Object.entries(data));
      }
    } catch (error) {
      logger.error('Failed to load local vectors:', error);
    }
  }

  async saveLocalVectors() {
    try {
      const data = Object.fromEntries(this.localVectors);
      await fs.writeJSON(this.vectorFile, data, { spaces: 2 });
    } catch (error) {
      logger.error('Failed to save local vectors:', error);
    }
  }

  // Advanced embedding creation with caching and optimization
  async createEmbedding(text, metadata = {}) {
    const startTime = Date.now();
    try {
      const language = this.detectLanguageRich(text);
      const normalized = this.normalizeText(text);
      const baseMeta = { originalText: text, text: text, normalizedText: normalized, language, ...metadata };

      let embedding;
      let provider = 'openai';
      try {
        // Try OpenAI first (original implementation)
        const cacheKey = this.generateCacheKey(text);
        if (this.vectorCache.has(cacheKey)) {
          const cached = this.vectorCache.get(cacheKey);
            return cached; }
        const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
        const response = await this.openai.embeddings.create({
          model: embeddingModel,
          input: text,
          encoding_format: 'float',
          dimensions: embeddingModel.includes('3-large') ? 3072 : 1536
        });
        embedding = response.data[0].embedding;
      } catch (err) {
        provider = 'huggingface';
        embedding = await this.createHuggingFaceEmbedding(text);
      }

      const id = uuidv4();
      const enhancedMetadata = {
        ...baseMeta,
        provider,
        embeddingLength: embedding.length,
        timestamp: new Date().toISOString(),
        semanticTags: this.extractSemanticTags(text)
      };

      const vectorData = { id, values: embedding, metadata: enhancedMetadata };
      if (this.index) { await this.index.upsert([vectorData]); } else { this.localVectors.set(id, vectorData); await this.saveLocalVectors(); }
      const result = { id, embedding, metadata: enhancedMetadata };
      this.vectorCache.set(this.generateCacheKey(text), result);
      this.vectorAnalytics.totalInserts++;
      const rt = Date.now() - startTime;
      this.vectorAnalytics.avgResponseTime = (this.vectorAnalytics.avgResponseTime + rt)/2;
      return result;
    } catch (error) {
      logger.error('Multilingual embedding failed:', error);
      throw error;
    }
  }

  async multilingualSimilaritySearch(query, topK = 5, filter = {}, options = {}) {
    // Creates embeddings for original + normalized (and optionally translated) query, then searches
    const language = this.detectLanguageRich(query);
    const normalized = this.normalizeText(query);
    let primaryResults = [];
    const collected = new Map();

    const runOne = async (q) => {
      try { const r = await this.similaritySearch(q, topK, filter, { ...options, skipCache: false }); r.forEach(item=>{ if(!collected.has(item.id) || collected.get(item.id).score < item.score) collected.set(item.id,item); }); }
      catch(e){ logger.warn('Sub-search failed for variant', e.message); }
    };

    await runOne(query);
    if (normalized !== query) await runOne(normalized);

    // If non-English and HF available try rough English translation model (best-effort)
    if (language !== 'en' && this.hf && process.env.ENABLE_TRANSLATION === 'true') {
      try {
        const translationModel = process.env.TRANSLATION_MODEL || `Helsinki-NLP/opus-mt-${language}-en`;
        const out = await this.hf.translation({ model: translationModel, inputs: query });
        if (out && out.translation_text) await runOne(out.translation_text);
      } catch (e) { logger.warn('Translation fallback skipped:', e.message); }
    }

    primaryResults = Array.from(collected.values())
      .sort((a,b)=> (b.score||0)-(a.score||0))
      .slice(0, topK)
      .map(r => ({ ...r, languageMatch: language }));
    return primaryResults;
  }

  // Patch similaritySearch to be quota-safe
  async similaritySearch(query, topK = 5, filter = {}, options = {}) {
    const startTime = Date.now();
    try {
      this.vectorAnalytics.totalQueries++;
      const cacheKey = this.generateCacheKey(query + JSON.stringify(filter) + topK);
      if (this.semanticCache.has(cacheKey) && !options.skipCache) {
        this.vectorAnalytics.cacheHitRate = (this.vectorAnalytics.cacheHitRate + 1) / this.vectorAnalytics.totalQueries;
        return this.semanticCache.get(cacheKey);
      }
      let queryEmbedding;
      let provider = 'openai';
      try {
        const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-large';
        const queryResponse = await this.openai.embeddings.create({
          model: embeddingModel,
          input: query,
          encoding_format: 'float',
          dimensions: embeddingModel.includes('3-large') ? 3072 : 1536
        });
        queryEmbedding = queryResponse.data[0].embedding;
      } catch (err) {
        provider = 'huggingface';
        if (this.hf) {
          queryEmbedding = await this.createHuggingFaceEmbedding(query);
        } else { throw err; }
      }

      let results = [];
      if (this.index && provider === 'openai') {
        const queryOptions = { vector: queryEmbedding, topK: Math.min(topK * 2, 100), includeMetadata: true, filter };
        if (options.namespace) queryOptions.namespace = options.namespace;
        const searchResults = await this.index.query(queryOptions);
        results = searchResults.matches;
      } else {
        // Local similarity
        results = await this.performLocalSemanticSearch(queryEmbedding, topK, filter);
      }

      let processedResults = results.map(match => ({
        id: match.id,
        score: match.score,
        text: match.metadata?.text || match.metadata?.originalText || '',
        metadata: match.metadata || {},
        semanticRelevance: this.calculateSemanticRelevance(query, match.metadata?.text || match.metadata?.originalText || '')
      }));
      if (options.rerank !== false) processedResults = this.rerankResults(processedResults, query);
      const finalResults = processedResults.slice(0, topK);
      this.semanticCache.set(cacheKey, finalResults);
      if (this.semanticCache.size > 1000) { const keys = Array.from(this.semanticCache.keys()); for (let i=0;i<500;i++) this.semanticCache.delete(keys[i]); }
      const responseTime = Date.now() - startTime;
      logger.info(`Multilingual semantic search (${provider}) returned ${finalResults.length} in ${responseTime}ms`);
      return finalResults;
    } catch (error) {
      logger.error('Failed multilingual similarity search:', error);
      throw error;
    }
  }

  // --- Multilingual helpers ---
  detectLanguageRich(text) {
    if (!text) return 'unknown';
    const samples = text.slice(0, 400).toLowerCase();
    const counts = {
      en: (samples.match(/\b(the|and|is|are|of|to|for|with)\b/g) || []).length,
      es: (samples.match(/\b(el|la|los|las|de|que|para|con|una|por)\b/g) || []).length,
      fr: (samples.match(/\b(le|la|les|des|une|pour|avec|est|sur)\b/g) || []).length,
      de: (samples.match(/\b(der|die|das|und|ist|mit|ein|eine|für)\b/g) || []).length,
      it: (samples.match(/\b(il|lo|la|gli|le|che|per|con|una)\b/g) || []).length,
      pt: (samples.match(/\b(o|a|os|as|de|que|para|com|uma|por)\b/g) || []).length,
      hi: (samples.match(/[\u0900-\u097F]/g) || []).length,
      zh: (samples.match(/[\u4E00-\u9FFF]/g) || []).length,
      ja: (samples.match(/[\u3040-\u30FF]/g) || []).length,
      ar: (samples.match(/[\u0600-\u06FF]/g) || []).length
    };
    const lang = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0];
    if (!lang || lang[1] === 0) return 'unknown';
    return lang[0];
  }

  normalizeText(text) {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
  }

  async createHuggingFaceEmbedding(text) {
    if (!this.hf) throw new Error('HuggingFace API key not configured');
    const resp = await this.hf.featureExtraction({ model: this.multilingualModel, inputs: text });
    // HF can return nested arrays; flatten if needed
    const embedding = Array.isArray(resp[0]) ? resp[0] : resp;
    return embedding.map(Number);
  }

  async deleteVector(id) {
    try {
      if (this.index) {
        await this.index.deleteOne(id);
      } else {
        this.localVectors.delete(id);
        await this.saveLocalVectors();
      }
      logger.info(`Deleted vector: ${id}`);
    } catch (error) {
      logger.error('Failed to delete vector:', error);
      throw error;
    }
  }

  async getVectorStats() {
    try {
      if (this.index) {
        const stats = await this.index.describeIndexStats();
        return {
          totalVectors: stats.totalRecordCount,
          dimension: stats.dimension,
          indexFullness: stats.indexFullness
        };
      } else {
        return {
          totalVectors: this.localVectors.size,
          dimension: this.localVectors.size > 0 ? 
            Array.from(this.localVectors.values())[0].values.length : 0,
          indexFullness: 0
        };
      }
    } catch (error) {
      logger.error('Failed to get vector stats:', error);
      return { totalVectors: 0, dimension: 0, indexFullness: 0 };
    }
  }

  async getAllVectors() {
    try {
      if (this.index) {
        // For Pinecone, we'll need to implement pagination
        // This is a simplified version
        const results = await this.index.query({
          vector: new Array(1536).fill(0), // Dummy vector
          topK: 10000,
          includeMetadata: true
        });
        
        return results.matches.map(match => ({
          id: match.id,
          metadata: match.metadata,
          vector: match.values || []
        }));
      } else {
        return Array.from(this.localVectors.values());
      }
    } catch (error) {
      logger.error('Failed to get all vectors:', error);
      return [];
    }
  }

  async batchInsert(documents) {
    try {
      const vectors = [];
      
      for (const doc of documents) {
        const response = await this.openai.embeddings.create({
          model: process.env.EMBEDDING_MODEL || 'text-embedding-3-large',
          input: doc.text,
          encoding_format: 'float',
        });

        const embedding = response.data[0].embedding;
        const id = uuidv4();
        
        vectors.push({
          id,
          values: embedding,
          metadata: {
            text: doc.text,
            timestamp: new Date().toISOString(),
            ...doc.metadata
          }
        });
      }

      if (this.index) {
        await this.index.upsert(vectors);
      } else {
        vectors.forEach(vector => {
          this.localVectors.set(vector.id, vector);
        });
        await this.saveLocalVectors();
      }

      logger.info(`Batch inserted ${vectors.length} vectors`);
      return vectors.map(v => ({ id: v.id, metadata: v.metadata }));
    } catch (error) {
      logger.error('Failed to batch insert vectors:', error);
      throw error;
    }
  }

  // Helper methods for advanced features
  generateCacheKey(text) {
    return require('crypto').createHash('md5').update(text).digest('hex');
  }

  detectLanguage(text) {
    // Simple language detection based on common words
    const englishWords = ['the', 'and', 'is', 'in', 'to', 'of', 'a', 'for', 'on', 'with'];
    const words = text.toLowerCase().split(/\s+/);
    const englishCount = words.filter(word => englishWords.includes(word)).length;
    return englishCount / words.length > 0.1 ? 'en' : 'unknown';
  }

  extractSemanticTags(text) {
    // Extract semantic tags using simple NLP
    const tags = [];
    const words = text.toLowerCase().split(/\s+/);
    
    // Technology terms
    const techTerms = ['ai', 'machine', 'learning', 'algorithm', 'data', 'neural', 'network', 'api', 'database', 'vector'];
    techTerms.forEach(term => {
      if (words.some(word => word.includes(term))) {
        tags.push(`tech:${term}`);
      }
    });
    
    // Document type detection
    if (text.includes('function') || text.includes('class') || text.includes('import')) {
      tags.push('type:code');
    } else if (text.includes('http') || text.includes('www')) {
      tags.push('type:url');
    } else if (text.length > 500) {
      tags.push('type:document');
    } else {
      tags.push('type:text');
    }
    
    return tags;
  }

  calculateSemanticRelevance(query, text) {
    if (!text) return 0;
    
    const queryWords = query.toLowerCase().split(/\s+/);
    const textWords = text.toLowerCase().split(/\s+/);
    
    let commonWords = 0;
    queryWords.forEach(qWord => {
      if (textWords.some(tWord => tWord.includes(qWord) || qWord.includes(tWord))) {
        commonWords++;
      }
    });
    
    return commonWords / queryWords.length;
  }

  rerankResults(results, query) {
    return results.sort((a, b) => {
      // Combine vector similarity with semantic relevance
      const scoreA = (a.score || 0) * 0.7 + (a.semanticRelevance || 0) * 0.3;
      const scoreB = (b.score || 0) * 0.7 + (b.semanticRelevance || 0) * 0.3;
      return scoreB - scoreA;
    });
  }

  applyDiversityFilter(results, threshold = 0.8) {
    const diverseResults = [];
    
    for (const result of results) {
      let isDiverse = true;
      
      for (const existing of diverseResults) {
        const similarity = this.textSimilarity(result.text, existing.text);
        if (similarity > threshold) {
          isDiverse = false;
          break;
        }
      }
      
      if (isDiverse) {
        diverseResults.push(result);
      }
    }
    
    return diverseResults;
  }

  textSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
  }

  async performLocalSemanticSearch(queryEmbedding, topK, filter) {
    const similarities = [];
    
    for (const [id, vectorData] of this.localVectors) {
      const similarity = this.cosineSimilarity(queryEmbedding, vectorData.values);
      
      // Apply filters
      let passesFilter = true;
      for (const [key, value] of Object.entries(filter)) {
        if (vectorData.metadata[key] !== value) {
          passesFilter = false;
          break;
        }
      }
      
      if (passesFilter) {
        similarities.push({
          id,
          score: similarity,
          metadata: vectorData.metadata
        });
      }
    }

    return similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // Batch processing system
  startBatchProcessor() {
    setInterval(async () => {
      if (this.batchQueue.length > 0 && !this.isProcessingBatch) {
        await this.processBatch();
      }
    }, 5000); // Process every 5 seconds
  }

  async addToBatch(document) {
    this.batchQueue.push(document);
    
    // Auto-process if batch is large enough
    if (this.batchQueue.length >= 10) {
      await this.processBatch();
    }
  }

  async processBatch() {
    if (this.isProcessingBatch || this.batchQueue.length === 0) return;
    
    this.isProcessingBatch = true;
    const batchToProcess = [...this.batchQueue];
    this.batchQueue = [];
    
    try {
      logger.info(`🔄 Processing batch of ${batchToProcess.length} documents`);
      await this.batchInsert(batchToProcess);
      logger.info(`✅ Batch processing completed`);
    } catch (error) {
      logger.error('Batch processing failed:', error);
      // Re-add failed items to queue
      this.batchQueue.unshift(...batchToProcess);
    } finally {
      this.isProcessingBatch = false;
    }
  }

  // Advanced vector analytics and insights
  async getAdvancedVectorStats() {
    try {
      const basicStats = await this.getVectorStats();
      
      // Calculate additional metrics
      const clusterStats = Object.fromEntries(this.vectorAnalytics.clusterDistribution);
      const cacheStats = {
        vectorCacheSize: this.vectorCache.size,
        semanticCacheSize: this.semanticCache.size,
        cacheHitRate: this.vectorAnalytics.cacheHitRate
      };
      
      // Performance metrics
      const performanceStats = {
        totalQueries: this.vectorAnalytics.totalQueries,
        totalInserts: this.vectorAnalytics.totalInserts,
        avgResponseTime: Math.round(this.vectorAnalytics.avgResponseTime),
        batchQueueSize: this.batchQueue.length,
        isProcessingBatch: this.isProcessingBatch
      };
      
      return {
        ...basicStats,
        clusterDistribution: clusterStats,
        cacheMetrics: cacheStats,
        performance: performanceStats,
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Failed to get advanced vector stats:', error);
      return await this.getVectorStats();
    }
  }

  // Vector similarity clustering analysis
  async analyzeSimilarityPatterns(sampleSize = 100) {
    try {
      const vectors = Array.from(this.localVectors.values()).slice(0, sampleSize);
      if (vectors.length < 2) return { error: 'Insufficient vectors for analysis' };
      
      const similarities = [];
      for (let i = 0; i < vectors.length; i++) {
        for (let j = i + 1; j < vectors.length; j++) {
          const similarity = this.cosineSimilarity(vectors[i].values, vectors[j].values);
          similarities.push(similarity);
        }
      }
      
      const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;
      const maxSimilarity = Math.max(...similarities);
      const minSimilarity = Math.min(...similarities);
      
      return {
        sampleSize: vectors.length,
        avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
        maxSimilarity: Math.round(maxSimilarity * 1000) / 1000,
        minSimilarity: Math.round(minSimilarity * 1000) / 1000,
        totalComparisons: similarities.length
      };
    } catch (error) {
      logger.error('Failed to analyze similarity patterns:', error);
      return { error: error.message };
    }
  }

  // Cleanup and optimization methods
  async optimizeVectorDatabase() {
    try {
      logger.info('🔧 Starting vector database optimization...');
      
      // Clear old cache entries
      this.vectorCache.clear();
      this.semanticCache.clear();
      
      // Re-cluster vectors if using local storage
      if (!this.index && this.localVectors.size > 50) {
        await this.optimizeLocalVectors();
      }
      
      // Save analytics
      await this.saveAnalytics();
      
      logger.info('✅ Vector database optimization completed');
      return { success: true, optimizedAt: new Date().toISOString() };
    } catch (error) {
      logger.error('Vector database optimization failed:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new VectorDatabaseService();
