
# GavinaAI: Advanced RAG Chatbot

<!-- GitHub Follow & Star Buttons -->
<p align="center">
  <a href="https://github.com/strivedi4u">
    <img src="https://img.shields.io/github/followers/strivedi4u?label=Follow&style=social" alt="Follow on GitHub" />
  </a>
  <a href="https://github.com/strivedi4u/gavina-ai">
    <img src="https://img.shields.io/github/stars/strivedi4u/gavina-ai?style=social" alt="Star on GitHub" />
  </a>
</p>

![Gavina AI Chatbot Screenshot](public/screenshots/gavina-ai-chatbot.png)

## Overview
GavinaAI is an advanced Retrieval-Augmented Generation (RAG) chatbot system designed for intelligent Q&A, memory management, multimodal processing, and vector visualization. It leverages state-of-the-art AI models and integrates with vector databases, analytics, and real-time features for robust enterprise and research use.

## Project Structure
```
ADVANCED_RAG_FEATURES.md
BETTER_AI_SETUP.md
FREE_AI_SETUP.md
MyProfileRedme.md
package.json
project.zip
server.js
test_api.js
test_chat.json
data/
  analytics.json
  behavior.json
  context.json
  conversations.json
  embeddings.json
  feedback.json
  memory.json
  performance.json
  user_profiles.json
logs/
  combined.log
  error.log
processed/
public/
  index_backup.html
  index_corrupted.html
  index_fixed.html
  index.html
  visualizations/
routes/
  new_rag.js
  rag_backup.js
  rag.js
services/
  advancedMemoryService.js
  analyticsService.js
  embedService.js
  freeAiService.js
  knowledgeBaseService.js
  loggerService.js
  memoryService.js
  multimodalProcessingService.js
  openaiService.js
  pdfService.js
  redisClient.js
  responseFormatter.js
  urlService.js
  vectorDatabaseService.js
  vectorVisualizationService.js
uploads/
```

## Key Features
- **Advanced RAG (Retrieval-Augmented Generation)**
- **Memory Management** (long-term, short-term, analytics)
- **Multimodal Processing** (text, audio, vision)
- **Vector Database Integration** (Pinecone)
- **Real-time Communication** (Socket.IO)
- **Scheduled Tasks** (node-cron)
- **Logging & Analytics**
- **API Endpoints for Q&A, Search, Analytics, Health**
- **Fuzzy Q&A Search** (Fuse.js)
- **File Uploads & Processing**
- **Dashboard & Visualization**

## Technologies Used
- **Node.js** (Express.js, Socket.IO)
- **OpenAI GPT-4o** (and other models)
- **Pinecone** (Vector Database)
- **Redis** (Memory Management)
- **Fuse.js** (Fuzzy Search)
- **Axios** (API Requests)
- **Cheerio, jsdom** (Web Scraping)
- **PDF-Parse, Mammoth, Tesseract.js** (Document & OCR Processing)
- **Winston** (Logging)
- **Socket.IO** (Real-time features)
- **node-cron** (Scheduled tasks)
- **Multer** (File uploads)

## How It Works
1. **User Interaction**: Users interact via API endpoints or the dashboard.
2. **Q&A Engine**: Questions are processed using RAG, leveraging memory and vector search.
3. **Memory & Analytics**: User sessions, feedback, and analytics are tracked and stored.
4. **Multimodal Processing**: Supports text, audio, and vision inputs.
5. **Vector Visualization**: Embeddings and search results are visualized for deeper insights.
6. **Scheduled Maintenance**: Daily cleanup and analytics tasks run automatically.

## Getting Started
1. **Install dependencies**:
   ```powershell
   npm install
   ```
2. **Configure environment**: Edit `.env` with your API keys and settings.
3. **Start the server**:
   ```powershell
   npm start
   ```
4. **Access dashboard**: Open [http://localhost:3000](http://localhost:3000)

## API Endpoints
- `/api/ask` — Ask questions
- `/api/search` — Fuzzy search
- `/api/analytics/overview` — Analytics
- `/api/status` — API status
- `/health` — Health check

## Screenshot
![Gavina AI Chatbot Screenshot](public/screenshots/gavina-ai-chatbot.png)

## License
This project is licensed under the ISC License. See `LICENSE` for details.

## Author
Shashank
