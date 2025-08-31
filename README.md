

## 📁 Project Structure
```text
├── ADVANCED_RAG_FEATURES.md
├── BETTER_AI_SETUP.md
├── FREE_AI_SETUP.md
├── MyProfileRedme.md
├── package.json
├── project.zip
├── server.js
├── test_api.js
├── test_chat.json
├── .env
├── data/
services/
  advancedMemoryService.js
  analyticsService.js
  embedService.js
  freeAiService.js
  knowledgeBaseService.js
  loggerService.js
  memoryService.js
  multimodalProcessingService.js
├── logs/
  openaiService.js
  pdfService.js
├── processed/
├── public/
  redisClient.js
  responseFormatter.js
  urlService.js
  vectorDatabaseService.js
  vectorVisualizationService.js
├── routes/
uploads/
```

├── services/
## ✨ Key Features
- 🤖 **Advanced RAG (Retrieval-Augmented Generation)**
- 🧠 **Memory Management** (long-term, short-term, analytics)
- 🖼️ **Multimodal Processing** (text, audio, vision)
- 🗃️ **Vector Database Integration** (Pinecone)
- 🔌 **Real-time Communication** (Socket.IO)
- ⏰ **Scheduled Tasks** (node-cron)
- 📊 **Logging & Analytics**
- 🛠️ **API Endpoints for Q&A, Search, Analytics, Health**
- 🔍 **Fuzzy Q&A Search** (Fuse.js)
- 📁 **File Uploads & Processing**
- 📈 **Dashboard & Visualization**

## 🛠️ Technologies Used
- **Node.js** (Express.js, Socket.IO)
├── uploads/
└── .vscode/
- **OpenAI GPT-4o** (and other models)
```
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

## ⚙️ How It Works
1. 💬 **User Interaction**: Users interact via API endpoints or the dashboard.
2. 🧩 **Q&A Engine**: Questions are processed using RAG, leveraging memory and vector search.
3. 📊 **Memory & Analytics**: User sessions, feedback, and analytics are tracked and stored.
4. 🖼️ **Multimodal Processing**: Supports text, audio, and vision inputs.
5. 📈 **Vector Visualization**: Embeddings and search results are visualized for deeper insights.
6. ⏰ **Scheduled Maintenance**: Daily cleanup and analytics tasks run automatically.

## 🚦 Getting Started
1. 📦 **Install dependencies**:
  ```powershell
  npm install
  ```
2. 📝 **Configure environment**: Edit `.env` with your API keys and settings.
3. ▶️ **Start the server**:
  ```powershell
  npm start
  ```
4. 🌐 **Access dashboard**: Open [http://localhost:3000](http://localhost:3000)

## 📡 API Endpoints

### 🤖 Q&A
- `POST /api/ask` — Ask a question
  - **Body:** `{ question: string, sessionId?: string }`
  - **Response:** `{ answer: string, metadata: { model, sessionId } }`

### 🔍 Fuzzy Search
- `GET /api/search?q=your_query` — Search Q&A database
  - **Query:** `q` (search string)
  - **Response:** `[{ question, answer }]`

### 📊 Analytics
- `GET /api/analytics/overview` — Get analytics overview
  - **Response:** `{ overview: { totalConversations, ... } }`

### 🩺 Health & Status
- `GET /api/status` — API status
- `GET /health` — Health check
  - **Response:** `{ status, timestamp, uptime, memory, version }`

## 🖼️ Screenshot
<p align="center">
  <img src="public/screenshots/gavina-ai-chatbot.png" alt="Gavina AI Chatbot Screenshot" width="800" />
</p>

## 📄 License
This project is licensed under the ISC License. See [`LICENSE`](LICENSE) for details.

## 👤 Author
Shashank ([@strivedi4u](https://github.com/strivedi4u))
