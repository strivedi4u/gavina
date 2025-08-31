

## 📁 Project Structure
```text
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

<table>
  <tr>
    <td><b>Node.js</b></td><td>Express.js, Socket.IO</td>
  </tr>
  <tr>
    <td><b>OpenAI GPT-4o</b></td><td>Advanced language models</td>
  </tr>
  <tr>
    <td><b>Pinecone</b></td><td>Vector Database</td>
  </tr>
  <tr>
    <td><b>Redis</b></td><td>Memory Management</td>
  </tr>
  <tr>
    <td><b>Fuse.js</b></td><td>Fuzzy Search</td>
  </tr>
  <tr>
    <td><b>Axios</b></td><td>API Requests</td>
  </tr>
  <tr>
    <td><b>Cheerio, jsdom</b></td><td>Web Scraping</td>
  </tr>
  <tr>
    <td><b>PDF-Parse, Mammoth, Tesseract.js</b></td><td>Document & OCR Processing</td>
  </tr>
  <tr>
    <td><b>Winston</b></td><td>Logging</td>
  </tr>
  <tr>
    <td><b>Socket.IO</b></td><td>Real-time features</td>
  </tr>
  <tr>
    <td><b>node-cron</b></td><td>Scheduled tasks</td>
  </tr>
  <tr>
    <td><b>Multer</b></td><td>File uploads</td>
  </tr>
</table>

## ⚙️ How It Works
1. 💬 **User Interaction**: Users interact via API endpoints or the dashboard.
2. 🧩 **Q&A Engine**: Questions are processed using RAG, leveraging memory and vector search.
3. 📊 **Memory & Analytics**: User sessions, feedback, and analytics are tracked and stored.
4. 🖼️ **Multimodal Processing**: Supports text, audio, and vision inputs.
5. 📈 **Vector Visualization**: Embeddings and search results are visualized for deeper insights.
6. ⏰ **Scheduled Maintenance**: Daily cleanup and analytics tasks run automatically.

## 🚦 Getting Started

<div style="border: 2px solid #2980b9; border-radius: 8px; padding: 16px; background: #f8faff;">
  <ol>
    <li>📦 <b>Install dependencies</b>:
      <pre style="background: #222; color: #fff; padding: 8px; border-radius: 4px;">npm install</pre>
    </li>
    <li>📝 <b>Configure environment</b>: Edit <code>.env</code> with your API keys and settings.</li>
    <li>▶️ <b>Start the server</b>:
      <pre style="background: #222; color: #fff; padding: 8px; border-radius: 4px;">npm start</pre>
    </li>
    <li>🌐 <b>Access dashboard</b>: Open <a href="http://localhost:3000">http://localhost:3000</a></li>
  </ol>
</div>

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
