// Free AI Service with multiple high-level models
const { HfInference } = require('@huggingface/inference');
const axios = require('axios');

class FreeAIService {
  constructor() {
    // Initialize Hugging Face (free tier available)
    this.hf = new HfInference(); // No API key needed for some models
    
    this.models = {
      // Free Hugging Face models (no API key required for some)
      huggingface: [
        'microsoft/DialoGPT-large',
        'facebook/blenderbot-400M-distill',
        'microsoft/DialoGPT-medium',
        'facebook/blenderbot_small-90M'
      ],
      
      // Ollama local models (if available)
      ollama: [
        'llama2',
        'codellama',
        'mistral',
        'phi'
      ],
      
      // Other free APIs
      groq: 'llama3-8b-8192', // Free tier available
      together: 'meta-llama/Llama-2-7b-chat-hf'
    };

    this.endpoints = {
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      together: 'https://api.together.xyz/v1/chat/completions',
      ollama: 'http://localhost:11434/api/generate'
    };
  }

  // Enhanced fallback response with better analysis
  generateAdvancedFallback(context, question) {
    try {
      console.log('📝 Generating enhanced response...');
      
      // Better text preprocessing
      const sentences = context
        .split(/[.!?]+/)
        .filter(s => s.trim().length > 30) // Longer sentences only
        .map(s => s.trim())
        .slice(0, 100); // Limit for performance

      const questionLower = question.toLowerCase();
      const questionWords = questionLower
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2)
        .filter(w => !this.isStopWord(w));

      console.log(`🔍 Analyzing ${sentences.length} sentences for: ${questionWords.join(', ')}`);

      // Improved scoring system
      const scoredSentences = sentences.map(sentence => {
        const sentenceLower = sentence.toLowerCase();
        let score = 0;
        
        // Exact word matches (higher weight)
        questionWords.forEach(word => {
          const regex = new RegExp(`\\b${word}\\b`, 'gi');
          const matches = (sentenceLower.match(regex) || []).length;
          score += matches * 3;
        });

        // Partial matches
        questionWords.forEach(word => {
          if (sentenceLower.includes(word.substring(0, Math.max(3, word.length - 2)))) {
            score += 1;
          }
        });

        // Question type bonuses
        if (questionLower.includes('what is') || questionLower.includes('what are')) {
          if (sentenceLower.includes(' is ') || sentenceLower.includes(' are ') || 
              sentenceLower.includes(' refers to ') || sentenceLower.includes(' means ')) {
            score += 2;
          }
        }

        if (questionLower.includes('how')) {
          if (sentenceLower.includes(' by ') || sentenceLower.includes(' through ') || 
              sentenceLower.includes(' using ') || sentenceLower.includes(' works ')) {
            score += 2;
          }
        }

        // Penalty for very short or very long sentences
        if (sentence.length < 50) score *= 0.7;
        if (sentence.length > 300) score *= 0.8;

        return { sentence, score, length: sentence.length };
      });

      // Get best sentences
      const relevantSentences = scoredSentences
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      console.log(`✅ Found ${relevantSentences.length} relevant sentences`);

      if (relevantSentences.length > 0) {
        return this.synthesizeAdvancedResponse(question, relevantSentences);
      } else {
        return this.generateBetterGenericResponse(question, context);
      }
    } catch (err) {
      console.error('Error in advanced fallback:', err);
      return "I encountered an issue analyzing the content. The text might be too complex for local processing. Consider setting up a free AI model (see BETTER_AI_SETUP.md) for better responses.";
    }
  }

  synthesizeAdvancedResponse(question, scoredSentences) {
    const questionType = this.getQuestionType(question);
    const sentences = scoredSentences.map(s => s.sentence);
    let response = "";

    // More sophisticated response generation
    switch (questionType) {
      case 'what':
        if (question.toLowerCase().includes('what is') || question.toLowerCase().includes('what are')) {
          // Definition-style response
          response = `Based on the content analysis:\n\n${sentences[0]}`;
          if (sentences.length > 1) {
            response += `\n\nKey characteristics include:\n• ${sentences.slice(1, 3).join('\n• ')}`;
          }
        } else {
          response = `According to the information provided:\n\n${sentences.slice(0, 2).join('\n\n')}`;
        }
        break;
      
      case 'how':
        response = `Here's how this works based on the content:\n\n`;
        response += sentences.slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join('\n\n');
        break;
      
      case 'why':
        response = `The reasoning appears to be:\n\n${sentences[0]}`;
        if (sentences.length > 1) {
          response += `\n\nAdditional context:\n${sentences.slice(1, 2).join('\n')}`;
        }
        break;
      
      default:
        // Better general response
        response = `Based on my analysis of the content:\n\n**Main Point**: ${sentences[0]}`;
        if (sentences.length > 1) {
          response += `\n\n**Additional Information**: ${sentences[1]}`;
        }
        if (sentences.length > 2) {
          response += `\n\n**Further Details**: ${sentences[2]}`;
        }
    }

    // Add confidence indicator
    const confidence = scoredSentences[0]?.score > 5 ? 'High' : scoredSentences[0]?.score > 2 ? 'Medium' : 'Low';
    response += `\n\n*Confidence: ${confidence} (based on ${scoredSentences.length} relevant passages)*`;

    return response;
  }

  generateBetterGenericResponse(question, context) {
    // Extract key topics from context
    const words = context.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 4)
      .filter(w => !this.isStopWord(w));
    
    // Count word frequency
    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });

    // Get top topics
    const topTopics = Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8)
      .map(([word]) => word);

    return `I couldn't find a direct answer to "${question}" in the provided content. However, the document discusses several related topics including: ${topTopics.slice(0, 5).join(', ')}.

**Suggestion**: Try asking a more specific question about one of these topics:
• ${topTopics.slice(0, 3).map(topic => `"What is ${topic}?"`).join('\n• ')}

**Note**: For much better AI responses, consider setting up a free AI model. Check the BETTER_AI_SETUP.md file for instructions!`;
  }

  synthesizeResponse(question, sentences) {
    const questionType = this.getQuestionType(question);
    let response = "";

    switch (questionType) {
      case 'what':
        response = `Based on the provided information:\n\n${sentences[0]}`;
        if (sentences.length > 1) {
          response += `\n\nAdditionally: ${sentences[1]}`;
        }
        break;
      
      case 'how':
        response = `Here's how this works according to the context:\n\n${sentences.join('. ')}.`;
        break;
      
      case 'why':
        response = `The reasoning appears to be:\n\n${sentences.join('. ')}.`;
        break;
      
      case 'when':
        response = `Regarding timing:\n\n${sentences.join('. ')}.`;
        break;
      
      case 'where':
        response = `Regarding location or context:\n\n${sentences.join('. ')}.`;
        break;
      
      default:
        response = `Based on the available information:\n\n${sentences.slice(0, 2).join('. ')}.`;
        if (sentences.length > 2) {
          response += `\n\nFurther details: ${sentences.slice(2).join('. ')}.`;
        }
    }

    return response;
  }

  getQuestionType(question) {
    const questionLower = question.toLowerCase();
    if (questionLower.startsWith('what')) return 'what';
    if (questionLower.startsWith('how')) return 'how';
    if (questionLower.startsWith('why')) return 'why';
    if (questionLower.startsWith('when')) return 'when';
    if (questionLower.startsWith('where')) return 'where';
    if (questionLower.startsWith('who')) return 'who';
    return 'general';
  }

  generateGenericResponse(question, context) {
    const contextWords = context.toLowerCase().split(/\s+/).slice(0, 100);
    const keyTerms = [...new Set(contextWords.filter(w => w.length > 4))].slice(0, 10);
    
    return `I found information related to: ${keyTerms.slice(0, 5).join(', ')}. ` +
           `While I couldn't find a direct answer to "${question}" in the provided context, ` +
           `the content discusses topics including ${keyTerms.slice(0, 3).join(', ')}. ` +
           `Please try asking a more specific question about these topics.`;
  }

  isStopWord(word) {
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'to', 'are', 'as', 'was',
      'will', 'an', 'be', 'by', 'this', 'that', 'it', 'with', 'for', 'of',
      'in', 'from', 'or', 'but', 'not', 'have', 'has', 'had', 'can', 'could',
      'would', 'should', 'may', 'might', 'must', 'shall', 'do', 'does', 'did'
    ]);
    return stopWords.has(word.toLowerCase());
  }

  // Try Groq API (free tier available)
  async tryGroq(context, question) {
    try {
      const response = await axios.post(this.endpoints.groq, {
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that answers questions based on provided context. Be concise and accurate."
          },
          {
            role: "user", 
            content: `Context: ${context}\n\nQuestion: ${question}\n\nAnswer based only on the provided context:`
          }
        ],
        model: this.models.groq,
        temperature: 0.3,
        max_tokens: 500
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY || ''}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (response.data?.choices?.[0]?.message?.content) {
        return {
          success: true,
          answer: response.data.choices[0].message.content,
          model: 'Groq Llama3'
        };
      }
    } catch (error) {
      console.log('Groq API not available:', error.message);
    }
    return { success: false };
  }

  // Try Ollama (local models)
  async tryOllama(context, question) {
    try {
      const prompt = `Context: ${context}\n\nQuestion: ${question}\n\nBased on the context above, provide a helpful and accurate answer:`;
      
      for (const model of this.models.ollama) {
        try {
          const response = await axios.post(this.endpoints.ollama, {
            model: model,
            prompt: prompt,
            stream: false,
            options: {
              temperature: 0.3,
              num_predict: 500
            }
          }, {
            timeout: 15000
          });

          if (response.data?.response) {
            return {
              success: true,
              answer: response.data.response,
              model: `Ollama ${model}`
            };
          }
        } catch (modelError) {
          console.log(`Ollama model ${model} not available:`, modelError.message);
          continue;
        }
      }
    } catch (error) {
      console.log('Ollama not available:', error.message);
    }
    return { success: false };
  }

  // Try Hugging Face models
  async tryHuggingFace(context, question) {
    try {
      // Try conversation models
      for (const model of this.models.huggingface) {
        try {
          const prompt = `Context: ${context.slice(0, 1500)}\nQuestion: ${question}\nAnswer:`;
          
          const response = await this.hf.textGeneration({
            model: model,
            inputs: prompt,
            parameters: {
              max_length: 200,
              temperature: 0.3,
              do_sample: true,
              return_full_text: false
            }
          });

          if (response?.generated_text) {
            return {
              success: true,
              answer: response.generated_text.trim(),
              model: `HuggingFace ${model.split('/')[1]}`
            };
          }
        } catch (modelError) {
          console.log(`HF model ${model} failed:`, modelError.message);
          continue;
        }
      }
    } catch (error) {
      console.log('HuggingFace API not available:', error.message);
    }
    return { success: false };
  }

  // Main method to get AI response with multiple fallbacks
  async generateResponse(context, question) {
    console.log('🤖 Trying free AI models for enhanced response...');

    // Try different AI services in order of preference
    const attempts = [
      () => this.tryGroq(context, question),
      () => this.tryOllama(context, question),
      () => this.tryHuggingFace(context, question)
    ];

    for (const attempt of attempts) {
      try {
        const result = await attempt();
        if (result.success) {
          console.log(`✅ Success with ${result.model}`);
          return `**[Generated by ${result.model}]**\n\n${result.answer}`;
        }
      } catch (error) {
        console.log('AI service attempt failed:', error.message);
        continue;
      }
    }

    // If all AI services fail, use enhanced fallback
    console.log('🔄 Using enhanced local analysis...');
    const fallbackResponse = this.generateAdvancedFallback(context, question);
    return `**[Generated by Enhanced Local Analysis]**\n\n${fallbackResponse}`;
  }
}

module.exports = new FreeAIService();
