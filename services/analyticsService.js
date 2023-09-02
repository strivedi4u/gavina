// Advanced Analytics and Learning Service
const fs = require('fs').promises;
const path = require('path');

class AnalyticsService {
  constructor() {
    this.analyticsPath = path.join(__dirname, '..', 'data', 'analytics.json');
    this.performancePath = path.join(__dirname, '..', 'data', 'performance.json');
    
    this.analytics = {
      sessions: {},
      globalMetrics: {
        totalQuestions: 0,
        avgResponseTime: 0,
        userSatisfaction: 0,
        topicDistribution: {},
        modelUsage: {},
        errorRate: 0
      },
      learningMetrics: {
        improvementRate: 0,
        feedbackUtilization: 0,
        adaptationScore: 0
      }
    };

    this.performance = {
      modelComparisons: {},
      responseQuality: {},
      userEngagement: {},
      systemHealth: {}
    };

    this.initialize();
  }

  async initialize() {
    try {
      await this.loadAnalytics();
      await this.loadPerformance();
      console.log('📊 Analytics Service initialized');
    } catch (error) {
      console.log('📈 Creating new analytics system...');
      await this.saveAllData();
    }
  }

  // === SESSION ANALYTICS ===
  
  trackSession(sessionId, event, data = {}) {
    if (!this.analytics.sessions[sessionId]) {
      this.analytics.sessions[sessionId] = {
        startTime: new Date().toISOString(),
        events: [],
        metrics: {
          questionCount: 0,
          avgResponseTime: 0,
          satisfaction: 0,
          topics: new Set(),
          models: new Set()
        }
      };
    }

    const session = this.analytics.sessions[sessionId];
    session.events.push({
      type: event,
      timestamp: new Date().toISOString(),
      data
    });

    this.updateSessionMetrics(sessionId, event, data);
  }

  updateSessionMetrics(sessionId, event, data) {
    const session = this.analytics.sessions[sessionId];
    
    switch (event) {
      case 'question_asked':
        session.metrics.questionCount++;
        if (data.topics) {
          data.topics.forEach(topic => session.metrics.topics.add(topic));
        }
        break;
        
      case 'response_generated':
        if (data.responseTime) {
          const count = session.metrics.questionCount;
          session.metrics.avgResponseTime = 
            (session.metrics.avgResponseTime * (count - 1) + data.responseTime) / count;
        }
        if (data.model) {
          session.metrics.models.add(data.model);
        }
        break;
        
      case 'feedback_received':
        if (data.rating) {
          session.metrics.satisfaction = data.rating;
        }
        break;
    }

    this.updateGlobalMetrics(event, data);
  }

  updateGlobalMetrics(event, data) {
    const global = this.analytics.globalMetrics;
    
    switch (event) {
      case 'question_asked':
        global.totalQuestions++;
        if (data.topics) {
          data.topics.forEach(topic => {
            global.topicDistribution[topic] = (global.topicDistribution[topic] || 0) + 1;
          });
        }
        break;
        
      case 'response_generated':
        if (data.model) {
          global.modelUsage[data.model] = (global.modelUsage[data.model] || 0) + 1;
        }
        if (data.responseTime) {
          global.avgResponseTime = 
            (global.avgResponseTime * (global.totalQuestions - 1) + data.responseTime) / global.totalQuestions;
        }
        break;
        
      case 'error_occurred':
        global.errorRate = (global.errorRate * global.totalQuestions + 1) / (global.totalQuestions + 1);
        break;
    }
  }

  // === PERFORMANCE MONITORING ===
  
  recordModelPerformance(model, metrics) {
    if (!this.performance.modelComparisons[model]) {
      this.performance.modelComparisons[model] = {
        totalUsage: 0,
        avgResponseTime: 0,
        successRate: 0,
        avgRating: 0,
        ratings: [],
        errors: 0
      };
    }

    const perf = this.performance.modelComparisons[model];
    perf.totalUsage++;
    
    if (metrics.responseTime) {
      perf.avgResponseTime = 
        (perf.avgResponseTime * (perf.totalUsage - 1) + metrics.responseTime) / perf.totalUsage;
    }
    
    if (metrics.rating) {
      perf.ratings.push(metrics.rating);
      perf.avgRating = perf.ratings.reduce((a, b) => a + b, 0) / perf.ratings.length;
    }
    
    if (metrics.success !== undefined) {
      perf.successRate = 
        (perf.successRate * (perf.totalUsage - 1) + (metrics.success ? 1 : 0)) / perf.totalUsage;
    }
    
    if (metrics.error) {
      perf.errors++;
    }
  }

  recordResponseQuality(questionType, quality) {
    if (!this.performance.responseQuality[questionType]) {
      this.performance.responseQuality[questionType] = {
        count: 0,
        avgQuality: 0,
        qualityTrend: [],
        improvements: 0
      };
    }

    const qual = this.performance.responseQuality[questionType];
    qual.count++;
    qual.avgQuality = (qual.avgQuality * (qual.count - 1) + quality) / qual.count;
    qual.qualityTrend.push({ timestamp: new Date().toISOString(), quality });
    
    // Keep only last 50 entries
    if (qual.qualityTrend.length > 50) {
      qual.qualityTrend = qual.qualityTrend.slice(-50);
    }
  }

  // === LEARNING ANALYTICS ===
  
  calculateLearningMetrics() {
    const sessions = Object.values(this.analytics.sessions);
    const models = Object.values(this.performance.modelComparisons);
    
    // Calculate improvement rate
    const recentSessions = sessions.slice(-20);
    const oldSessions = sessions.slice(-40, -20);
    
    const recentAvgSatisfaction = recentSessions.length > 0 ? 
      recentSessions.reduce((sum, s) => sum + (s.metrics.satisfaction || 0), 0) / recentSessions.length : 0;
    const oldAvgSatisfaction = oldSessions.length > 0 ? 
      oldSessions.reduce((sum, s) => sum + (s.metrics.satisfaction || 0), 0) / oldSessions.length : 0;
    
    this.analytics.learningMetrics.improvementRate = 
      oldAvgSatisfaction > 0 ? (recentAvgSatisfaction - oldAvgSatisfaction) / oldAvgSatisfaction : 0;

    // Calculate feedback utilization
    const totalFeedback = sessions.reduce((sum, s) => 
      sum + s.events.filter(e => e.type === 'feedback_received').length, 0);
    this.analytics.learningMetrics.feedbackUtilization = 
      this.analytics.globalMetrics.totalQuestions > 0 ? 
      totalFeedback / this.analytics.globalMetrics.totalQuestions : 0;

    // Calculate adaptation score based on model selection efficiency
    const modelPerformances = Object.entries(this.performance.modelComparisons)
      .map(([model, perf]) => ({ model, score: perf.avgRating || 0 }))
      .sort((a, b) => b.score - a.score);
    
    if (modelPerformances.length > 0) {
      const bestModel = modelPerformances[0];
      const usage = this.analytics.globalMetrics.modelUsage[bestModel.model] || 0;
      this.analytics.learningMetrics.adaptationScore = 
        this.analytics.globalMetrics.totalQuestions > 0 ? 
        usage / this.analytics.globalMetrics.totalQuestions : 0;
    }
  }

  // === INSIGHTS GENERATION ===
  
  generateInsights() {
    this.calculateLearningMetrics();
    
    const insights = {
      userBehavior: this.analyzeUserBehavior(),
      modelEfficiency: this.analyzeModelEfficiency(),
      topicTrends: this.analyzeTopicTrends(),
      learningProgress: this.analyzeLearningProgress(),
      recommendations: this.generateRecommendations()
    };

    return insights;
  }

  analyzeUserBehavior() {
    const sessions = Object.values(this.analytics.sessions);
    const totalSessions = sessions.length;
    
    if (totalSessions === 0) return { summary: 'No session data available' };

    const avgQuestionsPerSession = sessions.reduce((sum, s) => sum + s.metrics.questionCount, 0) / totalSessions;
    const avgSessionSatisfaction = sessions.reduce((sum, s) => sum + (s.metrics.satisfaction || 0), 0) / totalSessions;
    
    const topTopics = Object.entries(this.analytics.globalMetrics.topicDistribution)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);

    return {
      summary: `Analyzed ${totalSessions} sessions with ${avgQuestionsPerSession.toFixed(1)} questions per session`,
      avgQuestionsPerSession,
      avgSessionSatisfaction,
      topTopics,
      engagement: avgQuestionsPerSession > 3 ? 'High' : avgQuestionsPerSession > 1 ? 'Medium' : 'Low'
    };
  }

  analyzeModelEfficiency() {
    const models = Object.entries(this.performance.modelComparisons)
      .map(([model, perf]) => ({
        model,
        avgRating: perf.avgRating || 0,
        avgResponseTime: perf.avgResponseTime || 0,
        successRate: perf.successRate || 0,
        usage: perf.totalUsage || 0
      }))
      .sort((a, b) => b.avgRating - a.avgRating);

    const bestModel = models[0];
    const efficiency = models.reduce((sum, m) => sum + m.successRate, 0) / models.length;

    return {
      bestPerforming: bestModel,
      overallEfficiency: efficiency,
      modelRankings: models,
      recommendation: bestModel ? `${bestModel.model} shows best performance` : 'Need more data'
    };
  }

  analyzeTopicTrends() {
    const topics = Object.entries(this.analytics.globalMetrics.topicDistribution)
      .sort(([,a], [,b]) => b - a);

    const totalQuestions = topics.reduce((sum, [, count]) => sum + count, 0);
    const topicPercentages = topics.map(([topic, count]) => ({
      topic,
      count,
      percentage: (count / totalQuestions * 100).toFixed(1)
    }));

    return {
      totalTopics: topics.length,
      mostPopular: topicPercentages.slice(0, 5),
      diversity: topics.length / Math.max(totalQuestions, 1),
      trends: topicPercentages
    };
  }

  analyzeLearningProgress() {
    const metrics = this.analytics.learningMetrics;
    
    return {
      improvementRate: (metrics.improvementRate * 100).toFixed(1) + '%',
      feedbackUtilization: (metrics.feedbackUtilization * 100).toFixed(1) + '%',
      adaptationScore: (metrics.adaptationScore * 100).toFixed(1) + '%',
      overallScore: ((metrics.improvementRate + metrics.feedbackUtilization + metrics.adaptationScore) / 3 * 100).toFixed(1) + '%',
      status: metrics.improvementRate > 0.1 ? 'Improving' : metrics.improvementRate < -0.1 ? 'Declining' : 'Stable'
    };
  }

  generateRecommendations() {
    const recommendations = [];
    
    // Model recommendations
    const modelPerf = Object.values(this.performance.modelComparisons);
    if (modelPerf.length > 0) {
      const avgSuccessRate = modelPerf.reduce((sum, m) => sum + (m.successRate || 0), 0) / modelPerf.length;
      if (avgSuccessRate < 0.8) {
        recommendations.push({
          type: 'model',
          priority: 'high',
          message: 'Consider upgrading AI models for better performance',
          action: 'Review model configuration and API keys'
        });
      }
    }

    // User engagement recommendations
    const userBehavior = this.analyzeUserBehavior();
    if (userBehavior.avgQuestionsPerSession < 2) {
      recommendations.push({
        type: 'engagement',
        priority: 'medium',
        message: 'Low user engagement detected',
        action: 'Improve response quality and add more interactive features'
      });
    }

    // Learning recommendations
    if (this.analytics.learningMetrics.feedbackUtilization < 0.2) {
      recommendations.push({
        type: 'feedback',
        priority: 'medium',
        message: 'Low feedback collection',
        action: 'Implement more feedback prompts and easier rating system'
      });
    }

    // Topic diversity recommendations
    const topicTrends = this.analyzeTopicTrends();
    if (topicTrends.diversity < 0.3) {
      recommendations.push({
        type: 'content',
        priority: 'low',
        message: 'Limited topic diversity',
        action: 'Expand knowledge base to cover more topics'
      });
    }

    return recommendations;
  }

  // === REPORTING ===
  
  generateReport(timeframe = '7days') {
    const insights = this.generateInsights();
    
    const report = {
      timestamp: new Date().toISOString(),
      timeframe,
      summary: {
        totalSessions: Object.keys(this.analytics.sessions).length,
        totalQuestions: this.analytics.globalMetrics.totalQuestions,
        avgSatisfaction: insights.userBehavior.avgSessionSatisfaction,
        systemHealth: this.calculateSystemHealth()
      },
      insights,
      alerts: this.generateAlerts(),
      trends: this.calculateTrends()
    };

    return report;
  }

  calculateSystemHealth() {
    const errorRate = this.analytics.globalMetrics.errorRate;
    const avgResponseTime = this.analytics.globalMetrics.avgResponseTime;
    const avgSatisfaction = this.analytics.globalMetrics.userSatisfaction;

    let health = 'excellent';
    if (errorRate > 0.1 || avgResponseTime > 5000 || avgSatisfaction < 3) {
      health = 'poor';
    } else if (errorRate > 0.05 || avgResponseTime > 3000 || avgSatisfaction < 4) {
      health = 'fair';
    } else if (errorRate > 0.02 || avgResponseTime > 2000 || avgSatisfaction < 4.5) {
      health = 'good';
    }

    return { status: health, errorRate, avgResponseTime, avgSatisfaction };
  }

  generateAlerts() {
    const alerts = [];
    const health = this.calculateSystemHealth();

    if (health.errorRate > 0.1) {
      alerts.push({
        type: 'error',
        severity: 'high',
        message: `High error rate: ${(health.errorRate * 100).toFixed(1)}%`
      });
    }

    if (health.avgResponseTime > 5000) {
      alerts.push({
        type: 'performance',
        severity: 'medium',
        message: `Slow response times: ${health.avgResponseTime}ms average`
      });
    }

    if (health.avgSatisfaction < 3) {
      alerts.push({
        type: 'satisfaction',
        severity: 'high',
        message: `Low user satisfaction: ${health.avgSatisfaction.toFixed(1)}/5`
      });
    }

    return alerts;
  }

  calculateTrends() {
    // Calculate trends based on recent vs historical data
    const sessions = Object.values(this.analytics.sessions);
    const recentSessions = sessions.slice(-10);
    const historicalSessions = sessions.slice(0, -10);

    if (recentSessions.length === 0 || historicalSessions.length === 0) {
      return { message: 'Insufficient data for trend analysis' };
    }

    const recentAvgQuestions = recentSessions.reduce((sum, s) => sum + s.metrics.questionCount, 0) / recentSessions.length;
    const historicalAvgQuestions = historicalSessions.reduce((sum, s) => sum + s.metrics.questionCount, 0) / historicalSessions.length;

    return {
      questionVolume: {
        recent: recentAvgQuestions,
        historical: historicalAvgQuestions,
        trend: recentAvgQuestions > historicalAvgQuestions ? 'increasing' : 'decreasing'
      }
    };
  }

  // === FILE OPERATIONS ===
  
  async loadAnalytics() {
    try {
      const data = await fs.readFile(this.analyticsPath, 'utf8');
      this.analytics = { ...this.analytics, ...JSON.parse(data) };
    } catch (error) {
      // Keep default structure
    }
  }

  async loadPerformance() {
    try {
      const data = await fs.readFile(this.performancePath, 'utf8');
      this.performance = { ...this.performance, ...JSON.parse(data) };
    } catch (error) {
      // Keep default structure
    }
  }

  async saveAnalytics() {
    // Convert Sets to Arrays for JSON serialization
    const analyticsToSave = JSON.parse(JSON.stringify(this.analytics, (key, value) => {
      if (value instanceof Set) {
        return Array.from(value);
      }
      return value;
    }));
    await fs.writeFile(this.analyticsPath, JSON.stringify(analyticsToSave, null, 2));
  }

  async savePerformance() {
    await fs.writeFile(this.performancePath, JSON.stringify(this.performance, null, 2));
  }

  async saveAllData() {
    await Promise.all([
      this.saveAnalytics(),
      this.savePerformance()
    ]);
  }
}

module.exports = new AnalyticsService();
