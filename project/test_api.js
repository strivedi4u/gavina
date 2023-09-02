// Test script for the advanced RAG system
const axios = require('axios');

async function testAPI() {
  try {
    console.log('🧪 Testing Advanced RAG API...\n');

    // Test 1: General question without documents
    console.log('Test 1: General question without documents');
    const response1 = await axios.post('http://localhost:5000/api/ask', {
      question: 'Hello, what can you help me with?',
      sessionId: 'test_session_' + Date.now()
    });
    
    console.log('✅ Response received:');
    console.log('Answer:', response1.data.answer.substring(0, 200) + '...');
    console.log('Model:', response1.data.metadata.model);
    console.log('Session ID:', response1.data.metadata.sessionId);
    console.log('');

    // Test 2: Another general question
    console.log('Test 2: Topic-specific question');
    const response2 = await axios.post('http://localhost:5000/api/ask', {
      question: 'What is artificial intelligence?',
      sessionId: response1.data.metadata.sessionId
    });
    
    console.log('✅ Response received:');
    console.log('Answer:', response2.data.answer.substring(0, 200) + '...');
    console.log('Model:', response2.data.metadata.model);
    console.log('');

    // Test 3: Check analytics
    console.log('Test 3: Analytics overview');
    const analytics = await axios.get('http://localhost:5000/api/analytics/overview');
    console.log('✅ Analytics received:');
    console.log('Total conversations:', analytics.data.overview.totalConversations);
    console.log('');

    console.log('🎉 All tests passed! The advanced RAG system is working correctly.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testAPI();
