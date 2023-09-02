// Free embedding service using TF-IDF and simple text vectorization
// No external API calls required

const crypto = require('crypto');

class FreeEmbedding {
  constructor() {
    this.vocabulary = new Map();
    this.idf = new Map();
    this.documentCount = 0;
    this.embeddingDim = 300; // Standard embedding dimension
  }

  // Create a simple hash-based word vector
  createWordVector(word) {
    const hash = crypto.createHash('md5').update(word.toLowerCase()).digest('hex');
    const vector = new Array(this.embeddingDim);
    
    // Convert hash to numbers and normalize
    for (let i = 0; i < this.embeddingDim; i++) {
      const charIndex = i % hash.length;
      vector[i] = (parseInt(hash[charIndex], 16) / 15) - 0.5; // Normalize to [-0.5, 0.5]
    }
    
    // Normalize the vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / (magnitude || 1));
  }

  // Preprocess text: tokenize and clean
  preprocessText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !this.isStopWord(word));
  }

  // Simple stop words list
  isStopWord(word) {
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'are', 'as', 'was', 
      'will', 'an', 'be', 'by', 'this', 'that', 'it', 'with', 'for', 'of', 
      'in', 'from', 'or', 'but', 'not', 'have', 'has', 'had', 'can', 'could',
      'would', 'should', 'may', 'might', 'must', 'shall', 'will', 'do', 'does',
      'did', 'get', 'got', 'go', 'went', 'come', 'came', 'see', 'saw', 'say',
      'said', 'tell', 'told', 'know', 'knew', 'think', 'thought', 'take', 'took'
    ]);
    return stopWords.has(word);
  }

  // Calculate TF-IDF for words in text
  calculateTfIdf(words) {
    const tf = new Map();
    const totalWords = words.length;

    // Calculate term frequency
    words.forEach(word => {
      tf.set(word, (tf.get(word) || 0) + 1);
    });

    // Convert to TF-IDF
    const tfidf = new Map();
    tf.forEach((count, word) => {
      const termFreq = count / totalWords;
      const inverseDocFreq = this.idf.get(word) || 1;
      tfidf.set(word, termFreq * inverseDocFreq);
    });

    return tfidf;
  }

  // Create embedding vector from text
  createEmbedding(text) {
    try {
      const words = this.preprocessText(text);
      if (words.length === 0) {
        // Return zero vector for empty text
        return new Array(this.embeddingDim).fill(0);
      }

      const tfidf = this.calculateTfIdf(words);
      const embedding = new Array(this.embeddingDim).fill(0);

      // Combine word vectors weighted by TF-IDF
      let totalWeight = 0;
      tfidf.forEach((weight, word) => {
        const wordVector = this.createWordVector(word);
        totalWeight += weight;
        
        for (let i = 0; i < this.embeddingDim; i++) {
          embedding[i] += wordVector[i] * weight;
        }
      });

      // Normalize by total weight
      if (totalWeight > 0) {
        for (let i = 0; i < this.embeddingDim; i++) {
          embedding[i] /= totalWeight;
        }
      }

      // Final normalization
      const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
      return embedding.map(val => val / (magnitude || 1));

    } catch (err) {
      console.error('Error creating embedding:', err);
      // Return random normalized vector as fallback
      const fallback = Array.from({length: this.embeddingDim}, () => Math.random() - 0.5);
      const magnitude = Math.sqrt(fallback.reduce((sum, val) => sum + val * val, 0));
      return fallback.map(val => val / (magnitude || 1));
    }
  }

  // Update vocabulary and IDF from documents (call this when processing documents)
  updateVocabulary(texts) {
    this.documentCount = texts.length;
    const documentWordSets = texts.map(text => new Set(this.preprocessText(text)));

    // Build vocabulary and calculate IDF
    documentWordSets.forEach(wordSet => {
      wordSet.forEach(word => {
        this.vocabulary.set(word, (this.vocabulary.get(word) || 0) + 1);
      });
    });

    // Calculate IDF for each word
    this.vocabulary.forEach((docFreq, word) => {
      this.idf.set(word, Math.log(this.documentCount / docFreq));
    });
  }
}

// Create global instance
const freeEmbedding = new FreeEmbedding();

const getEmbeddings = async (text) => {
  try {
    // For consistency with OpenAI API, we return the embedding directly
    return freeEmbedding.createEmbedding(text);
  } catch (err) {
    console.error('Error generating embedding:', err);
    throw err;
  }
};

// Export additional utility for updating vocabulary when processing documents
const updateVocabulary = (texts) => {
  freeEmbedding.updateVocabulary(texts);
};

module.exports = { getEmbeddings, updateVocabulary };
