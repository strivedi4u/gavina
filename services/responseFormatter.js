// Advanced Response Formatter with Structured Output
class ResponseFormatter {
  constructor() {
    this.templates = {
      definition: this.formatDefinition.bind(this),
      process: this.formatProcess.bind(this),
      reasoning: this.formatReasoning.bind(this),
      comparison: this.formatComparison.bind(this),
      enumeration: this.formatEnumeration.bind(this),
      general: this.formatGeneral.bind(this)
    };
  }

  formatResponse(answer, questionType, metadata = {}) {
    const formatter = this.templates[questionType] || this.templates.general;
    return formatter(answer, metadata);
  }

  formatDefinition(answer, metadata) {
    const sections = this.extractSections(answer);
    
    return `
## 📖 Definition

**Main Concept**: ${this.extractMainConcept(answer)}

### Overview
${sections.overview || this.extractFirstSentence(answer)}

${sections.details ? `### Key Characteristics
${this.formatBulletPoints(sections.details)}` : ''}

${sections.examples ? `### Examples
${this.formatBulletPoints(sections.examples)}` : ''}

${metadata.relatedTopics ? `### Related Topics
${metadata.relatedTopics.slice(0, 3).map(topic => `• ${topic}`).join('\n')}` : ''}

---
*Source: ${metadata.model || 'AI Assistant'} | Confidence: ${metadata.confidence || 'Medium'}*
    `.trim();
  }

  formatProcess(answer, metadata) {
    const steps = this.extractSteps(answer);
    
    return `
## ⚙️ Process Explanation

### How It Works

${steps.length > 0 ? steps.map((step, i) => `**Step ${i + 1}**: ${step}`).join('\n\n') : answer}

### Key Points
${this.extractKeyPoints(answer).map(point => `• ${point}`).join('\n')}

${metadata.prerequisites ? `### Prerequisites
${metadata.prerequisites.map(req => `• ${req}`).join('\n')}` : ''}

---
*Process Analysis | ${metadata.model || 'AI Assistant'}*
    `.trim();
  }

  formatReasoning(answer, metadata) {
    return `
## 🤔 Reasoning & Analysis

### Primary Explanation
${this.extractMainReasoning(answer)}

### Supporting Factors
${this.extractSupportingFactors(answer).map(factor => `• ${factor}`).join('\n')}

### Implications
${this.extractImplications(answer)}

---
*Analytical Response | ${metadata.model || 'AI Assistant'}*
    `.trim();
  }

  formatComparison(answer, metadata) {
    const comparisons = this.extractComparisons(answer);
    
    return `
## 📊 Comparison Analysis

### Key Differences
${comparisons.differences.map(diff => `• ${diff}`).join('\n')}

### Similarities
${comparisons.similarities.map(sim => `• ${sim}`).join('\n')}

### Summary
${this.extractSummary(answer)}

---
*Comparative Analysis | ${metadata.model || 'AI Assistant'}*
    `.trim();
  }

  formatEnumeration(answer, metadata) {
    const items = this.extractListItems(answer);
    
    return `
## 📝 Detailed List

### Items Overview
${items.map((item, i) => `**${i + 1}. ${item.title}**\n   ${item.description}`).join('\n\n')}

### Summary
${this.extractSummary(answer)}

---
*Enumerated Response | ${metadata.model || 'AI Assistant'}*
    `.trim();
  }

  formatGeneral(answer, metadata) {
    return `
## 💡 Response

### Main Information
${this.cleanAnswer(answer)}

${metadata.keyPoints ? `### Key Points
${metadata.keyPoints.map(point => `• ${point}`).join('\n')}` : ''}

${metadata.context ? `### Context
${metadata.context}` : ''}

---
*General Response | ${metadata.model || 'AI Assistant'} | ${new Date().toLocaleString()}*
    `.trim();
  }

  // Utility methods for extracting information

  extractSections(text) {
    const sections = {};
    
    // Try to identify different sections
    const overviewMatch = text.match(/^([^.]*\.)/);
    if (overviewMatch) {
      sections.overview = overviewMatch[1];
    }

    // Look for detailed information
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 30);
    if (sentences.length > 2) {
      sections.details = sentences.slice(1, 4).join('. ') + '.';
    }

    return sections;
  }

  extractMainConcept(text) {
    const firstSentence = text.split(/[.!?]+/)[0];
    return firstSentence.length > 100 ? firstSentence.substring(0, 97) + '...' : firstSentence;
  }

  extractFirstSentence(text) {
    return text.split(/[.!?]+/)[0] + '.';
  }

  extractSteps(text) {
    // Look for numbered steps or process indicators
    const stepPatterns = [
      /(\d+\.\s+[^.]+\.)/g,
      /(first|second|third|then|next|finally)[^.]*\./gi,
      /(step \d+)[^.]*\./gi
    ];

    for (const pattern of stepPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 1) {
        return matches.map(step => step.trim());
      }
    }

    // Fallback: split by sentences and take first few
    return text.split(/[.!?]+/).filter(s => s.trim().length > 20).slice(0, 4);
  }

  extractKeyPoints(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences.slice(0, 3).map(s => s.trim());
  }

  extractMainReasoning(text) {
    const firstParagraph = text.split('\n\n')[0];
    return firstParagraph || this.extractFirstSentence(text);
  }

  extractSupportingFactors(text) {
    // Look for because, due to, as a result, etc.
    const factorPatterns = /because|due to|as a result|therefore|consequently|since/gi;
    const sentences = text.split(/[.!?]+/).filter(s => factorPatterns.test(s));
    return sentences.slice(0, 3).map(s => s.trim());
  }

  extractImplications(text) {
    const lastSentences = text.split(/[.!?]+/).slice(-2);
    return lastSentences.join('. ').trim() + '.';
  }

  extractComparisons(text) {
    const differences = [];
    const similarities = [];
    
    const sentences = text.split(/[.!?]+/);
    
    sentences.forEach(sentence => {
      if (/different|unlike|contrast|however|but|while/.test(sentence.toLowerCase())) {
        differences.push(sentence.trim());
      } else if (/similar|like|both|same|alike/.test(sentence.toLowerCase())) {
        similarities.push(sentence.trim());
      }
    });

    return {
      differences: differences.slice(0, 3),
      similarities: similarities.slice(0, 3)
    };
  }

  extractListItems(text) {
    // Look for numbered or bulleted lists
    const listPatterns = [
      /(\d+\.\s+)([^.]+)/g,
      /([•\-]\s+)([^.]+)/g
    ];

    for (const pattern of listPatterns) {
      const matches = Array.from(text.matchAll(pattern));
      if (matches.length > 1) {
        return matches.map(match => ({
          title: match[2].split(':')[0] || match[2].substring(0, 50),
          description: match[2].split(':')[1] || match[2].substring(50) || ''
        }));
      }
    }

    // Fallback: create items from sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences.slice(0, 5).map(sentence => ({
      title: sentence.substring(0, 30) + '...',
      description: sentence.trim()
    }));
  }

  extractSummary(text) {
    const sentences = text.split(/[.!?]+/);
    const lastSentence = sentences[sentences.length - 2] || sentences[sentences.length - 1];
    return lastSentence ? lastSentence.trim() + '.' : 'Summary not available.';
  }

  formatBulletPoints(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    return sentences.slice(0, 4).map(s => `• ${s.trim()}`).join('\n');
  }

  cleanAnswer(text) {
    // Remove model indicators and clean up text
    return text
      .replace(/\*\*\[Generated by [^\]]+\]\*\*/g, '')
      .replace(/^\s*\n+/, '')
      .trim();
  }

  addPersonalizedElements(formattedResponse, userPreferences, context) {
    let enhanced = formattedResponse;

    // Add user-specific sections
    if (userPreferences.topics && userPreferences.topics.length > 0) {
      enhanced += `\n\n### 🎯 Related to Your Interests\n`;
      enhanced += userPreferences.topics.slice(0, 3).map(topic => `• ${topic}`).join('\n');
    }

    if (context.previousQuestions && context.previousQuestions.length > 0) {
      enhanced += `\n\n### 🔗 Building on Previous Discussion\n`;
      enhanced += `This relates to your earlier questions about: ${context.previousQuestions.slice(-2).join(', ')}`;
    }

    if (context.suggestions && context.suggestions.length > 0) {
      enhanced += `\n\n### 💭 You Might Also Ask\n`;
      enhanced += context.suggestions.slice(0, 3).map(suggestion => `• ${suggestion}`).join('\n');
    }

    return enhanced;
  }

  createMetadataFooter(metadata) {
    const elements = [];
    
    if (metadata.model) elements.push(`Model: ${metadata.model}`);
    if (metadata.confidence) elements.push(`Confidence: ${metadata.confidence}`);
    if (metadata.sources) elements.push(`Sources: ${metadata.sources}`);
    if (metadata.processingTime) elements.push(`Time: ${metadata.processingTime}ms`);
    
    return elements.length > 0 ? `\n\n---\n*${elements.join(' | ')}*` : '';
  }
}

module.exports = new ResponseFormatter();
