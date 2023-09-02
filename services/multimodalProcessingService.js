const OpenAI = require('openai');
const fs = require('fs-extra');
const path = require('path');
// Optional sharp for image processing (requires newer Node.js version)
let sharp;
try {
  sharp = require('sharp');
} catch (error) {
  console.warn('Sharp image processing not available - requires Node.js ^18.17.0 || ^20.3.0 || >=21.0.0');
  sharp = null;
}
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const logger = require('./loggerService');
const vectorDatabaseService = require('./vectorDatabaseService');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

class MultimodalProcessingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    this.supportedImageFormats = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
    this.supportedDocFormats = ['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.xls'];
    this.supportedAudioFormats = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
    this.supportedVideoFormats = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'];
    
    this.uploadsDir = path.join(__dirname, '../uploads');
    this.processedDir = path.join(__dirname, '../processed');
    
    this.ensureDirectories();
  }

  async ensureDirectories() {
    await fs.ensureDir(this.uploadsDir);
    await fs.ensureDir(this.processedDir);
  }

  async processFile(filePath, originalName, metadata = {}) {
    try {
      const ext = path.extname(originalName).toLowerCase();
      const processId = uuidv4();
      
      logger.info(`Processing file: ${originalName} (${ext})`);
      
      let result = {
        id: processId,
        originalName,
        filePath,
        extension: ext,
        metadata,
        processed: false,
        content: '',
        extractedText: '',
        analysis: {},
        timestamp: new Date().toISOString()
      };

      if (this.supportedImageFormats.includes(ext)) {
        result = await this.processImage(filePath, result);
      } else if (this.supportedDocFormats.includes(ext)) {
        result = await this.processDocument(filePath, result);
      } else if (this.supportedAudioFormats.includes(ext)) {
        result = await this.processAudio(filePath, result);
      } else if (this.supportedVideoFormats.includes(ext)) {
        result = await this.processVideo(filePath, result);
      } else {
        // Try to process as text
        result = await this.processTextFile(filePath, result);
      }

      // Store extracted content in vector database
      if (result.extractedText) {
        await vectorDatabaseService.createEmbedding(result.extractedText, {
          fileId: processId,
          fileName: originalName,
          fileType: ext,
          processedAt: result.timestamp,
          ...metadata
        });
      }

      logger.info(`Successfully processed file: ${originalName}`);
      return result;
    } catch (error) {
      logger.error(`Failed to process file ${originalName}:`, error);
      throw error;
    }
  }

  async processImage(filePath, result) {
    try {
      // Get image metadata (only if sharp is available)
      if (sharp) {
        const imageInfo = await sharp(filePath).metadata();
        result.analysis.imageInfo = {
          width: imageInfo.width,
          height: imageInfo.height,
          format: imageInfo.format,
          size: imageInfo.size,
          channels: imageInfo.channels
        };

        // Create thumbnail
        const thumbnailPath = path.join(this.processedDir, `thumb_${result.id}.jpg`);
        await sharp(filePath)
          .resize(300, 300, { fit: 'inside' })
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath);
        
        result.thumbnailPath = thumbnailPath;
      } else {
        // Use basic file info when sharp is not available
        const stats = await fs.stat(filePath);
        result.analysis.imageInfo = {
          size: stats.size,
          format: path.extname(filePath).substring(1).toLowerCase()
        };
        logger.warn('Image thumbnails and detailed metadata not available without sharp package');
      }

      // Extract text using OCR
      const ocrResult = await Tesseract.recognize(filePath, 'eng', {
        logger: m => logger.debug(`OCR Progress: ${m.progress * 100}%`)
      });
      
      result.extractedText = ocrResult.data.text;
      result.analysis.ocrConfidence = ocrResult.data.confidence;

      // Analyze image with GPT-4 Vision (if enabled and API key available)
      if (process.env.ENABLE_VISION === 'true' && process.env.OPENAI_API_KEY) {
        try {
          const imageBuffer = await fs.readFile(filePath);
          const base64Image = imageBuffer.toString('base64');
          
          const visionResponse = await this.openai.chat.completions.create({
            model: process.env.VISION_MODEL || 'gpt-4o',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Please analyze this image and describe what you see in detail. Include any text, objects, people, scenes, colors, and other relevant information.'
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:image/jpeg;base64,${base64Image}`,
                      detail: 'high'
                    }
                  }
                ]
              }
            ],
            max_tokens: 1000
          });

          result.analysis.visionDescription = visionResponse.choices[0].message.content;
          result.extractedText += '\n\nAI Vision Analysis:\n' + result.analysis.visionDescription;
        } catch (visionError) {
          logger.warn('Vision analysis failed:', visionError.message);
        }
      }

      result.processed = true;
      return result;
    } catch (error) {
      logger.error('Failed to process image:', error);
      throw error;
    }
  }

  async processDocument(filePath, result) {
    try {
      const ext = result.extension;
      
      if (ext === '.pdf') {
        const pdfBuffer = await fs.readFile(filePath);
        const pdfData = await pdfParse(pdfBuffer);
        result.extractedText = pdfData.text;
        result.analysis.pageCount = pdfData.numpages;
        result.analysis.info = pdfData.info;
      } else if (ext === '.docx') {
        const docBuffer = await fs.readFile(filePath);
        const docResult = await mammoth.extractRawText({ buffer: docBuffer });
        result.extractedText = docResult.value;
        result.analysis.warnings = docResult.messages;
      } else if (['.xlsx', '.xls'].includes(ext)) {
        const workbook = XLSX.readFile(filePath);
        const sheets = [];
        
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          sheets.push({
            name: sheetName,
            content: csv
          });
        });
        
        result.extractedText = sheets.map(s => `Sheet: ${s.name}\n${s.content}`).join('\n\n');
        result.analysis.sheets = sheets.map(s => ({ name: s.name, rows: s.content.split('\n').length }));
      } else if (['.txt', '.md', '.csv'].includes(ext)) {
        result.extractedText = await fs.readFile(filePath, 'utf8');
      }

      // Analyze document structure and content
      if (result.extractedText) {
        result.analysis.wordCount = result.extractedText.split(/\s+/).length;
        result.analysis.charCount = result.extractedText.length;
        result.analysis.lineCount = result.extractedText.split('\n').length;
        
        // Extract key topics using GPT
        if (process.env.OPENAI_API_KEY && result.extractedText.length > 100) {
          try {
            const topicsResponse = await this.openai.chat.completions.create({
              model: 'gpt-4',
              messages: [
                {
                  role: 'user',
                  content: `Extract the main topics, keywords, and key information from this document:\n\n${result.extractedText.substring(0, 3000)}...`
                }
              ],
              max_tokens: 500
            });
            
            result.analysis.keyTopics = topicsResponse.choices[0].message.content;
          } catch (topicsError) {
            logger.warn('Failed to extract topics:', topicsError.message);
          }
        }
      }

      result.processed = true;
      return result;
    } catch (error) {
      logger.error('Failed to process document:', error);
      throw error;
    }
  }

  async processAudio(filePath, result) {
    try {
      // Convert audio to wav if needed for better processing
      const wavPath = path.join(this.processedDir, `audio_${result.id}.wav`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .toFormat('wav')
          .on('end', resolve)
          .on('error', reject)
          .save(wavPath);
      });

      // Get audio metadata
      await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) reject(err);
          else {
            result.analysis.duration = metadata.format.duration;
            result.analysis.bitrate = metadata.format.bit_rate;
            result.analysis.audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');
            resolve();
          }
        });
      });

      // Transcribe audio using OpenAI Whisper (if enabled)
      if (process.env.ENABLE_AUDIO === 'true' && process.env.OPENAI_API_KEY) {
        try {
          const audioBuffer = await fs.readFile(wavPath);
          
          // OpenAI Whisper has a 25MB limit, so we might need to chunk large files
          if (audioBuffer.length < 25 * 1024 * 1024) {
            const transcription = await this.openai.audio.transcriptions.create({
              file: fs.createReadStream(wavPath),
              model: 'whisper-1',
              language: 'en'
            });
            
            result.extractedText = transcription.text;
            result.analysis.transcriptionMethod = 'whisper';
          } else {
            logger.warn('Audio file too large for Whisper API, skipping transcription');
            result.analysis.transcriptionMethod = 'skipped - file too large';
          }
        } catch (transcriptionError) {
          logger.warn('Audio transcription failed:', transcriptionError.message);
        }
      }

      result.processedAudioPath = wavPath;
      result.processed = true;
      return result;
    } catch (error) {
      logger.error('Failed to process audio:', error);
      throw error;
    }
  }

  async processVideo(filePath, result) {
    try {
      // Extract video metadata
      await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) reject(err);
          else {
            result.analysis.duration = metadata.format.duration;
            result.analysis.bitrate = metadata.format.bit_rate;
            result.analysis.videoStreams = metadata.streams.filter(s => s.codec_type === 'video');
            result.analysis.audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');
            resolve();
          }
        });
      });

      // Extract frames for analysis
      const framesDir = path.join(this.processedDir, `frames_${result.id}`);
      await fs.ensureDir(framesDir);
      
      // Extract 5 frames at different intervals
      const frameTimes = [0.1, 0.3, 0.5, 0.7, 0.9]; // Percentage of video duration
      const duration = result.analysis.duration;
      
      for (let i = 0; i < frameTimes.length; i++) {
        const timeInSeconds = duration * frameTimes[i];
        const framePath = path.join(framesDir, `frame_${i + 1}.jpg`);
        
        await new Promise((resolve, reject) => {
          ffmpeg(filePath)
            .seekInput(timeInSeconds)
            .frames(1)
            .output(framePath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });
      }

      // Extract audio track for transcription
      const audioPath = path.join(this.processedDir, `video_audio_${result.id}.wav`);
      
      await new Promise((resolve, reject) => {
        ffmpeg(filePath)
          .noVideo()
          .audioCodec('pcm_s16le')
          .toFormat('wav')
          .on('end', resolve)
          .on('error', reject)
          .save(audioPath);
      });

      // Process extracted audio
      if (await fs.pathExists(audioPath)) {
        const audioResult = await this.processAudio(audioPath, {
          ...result,
          id: `${result.id}_audio`,
          extension: '.wav'
        });
        
        result.extractedText = audioResult.extractedText || '';
        result.analysis.audioAnalysis = audioResult.analysis;
      }

      // Analyze key frames with vision if enabled
      if (process.env.ENABLE_VISION === 'true' && process.env.OPENAI_API_KEY) {
        try {
          const frameAnalyses = [];
          const frameFiles = await fs.readdir(framesDir);
          
          for (const frameFile of frameFiles.slice(0, 3)) { // Analyze first 3 frames
            const framePath = path.join(framesDir, frameFile);
            const frameBuffer = await fs.readFile(framePath);
            const base64Frame = frameBuffer.toString('base64');
            
            const visionResponse = await this.openai.chat.completions.create({
              model: process.env.VISION_MODEL || 'gpt-4o',
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'Describe what you see in this video frame. Include details about people, objects, scene, actions, and any text visible.'
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:image/jpeg;base64,${base64Frame}`,
                        detail: 'high'
                      }
                    }
                  ]
                }
              ],
              max_tokens: 300
            });

            frameAnalyses.push({
              frame: frameFile,
              description: visionResponse.choices[0].message.content
            });
          }
          
          result.analysis.frameAnalyses = frameAnalyses;
          result.extractedText += '\n\nVideo Frame Analysis:\n' + 
            frameAnalyses.map(f => `${f.frame}: ${f.description}`).join('\n\n');
        } catch (visionError) {
          logger.warn('Video frame analysis failed:', visionError.message);
        }
      }

      result.framesDir = framesDir;
      result.processedAudioPath = audioPath;
      result.processed = true;
      return result;
    } catch (error) {
      logger.error('Failed to process video:', error);
      throw error;
    }
  }

  async processTextFile(filePath, result) {
    try {
      result.extractedText = await fs.readFile(filePath, 'utf8');
      result.analysis.wordCount = result.extractedText.split(/\s+/).length;
      result.analysis.charCount = result.extractedText.length;
      result.analysis.lineCount = result.extractedText.split('\n').length;
      result.processed = true;
      return result;
    } catch (error) {
      // If we can't read as text, try as binary and convert
      try {
        const buffer = await fs.readFile(filePath);
        result.extractedText = buffer.toString('utf8', 0, Math.min(buffer.length, 10000)); // First 10KB
        result.analysis.binaryFile = true;
        result.analysis.fileSize = buffer.length;
        result.processed = true;
        return result;
      } catch (binaryError) {
        logger.error('Failed to process as text or binary:', error);
        throw error;
      }
    }
  }

  async processUrl(url, metadata = {}) {
    try {
      const { default: fetch } = await import('node-fetch');
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const processId = uuidv4();
      
      let result = {
        id: processId,
        url,
        contentType,
        metadata,
        processed: false,
        content: '',
        extractedText: '',
        analysis: {},
        timestamp: new Date().toISOString()
      };

      if (contentType.includes('text/html')) {
        // Process as webpage
        const html = await response.text();
        const { JSDOM } = require('jsdom');
        const dom = new JSDOM(html);
        const document = dom.window.document;
        
        // Extract text content
        result.extractedText = document.body.textContent || '';
        
        // Extract metadata
        result.analysis.title = document.title;
        result.analysis.metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        result.analysis.metaKeywords = document.querySelector('meta[name="keywords"]')?.content || '';
        
        // Extract links
        const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: a.textContent?.trim(),
          href: a.href
        }));
        result.analysis.links = links;
        
        // Extract images
        const images = Array.from(document.querySelectorAll('img[src]')).map(img => ({
          alt: img.alt,
          src: img.src
        }));
        result.analysis.images = images;
        
      } else if (contentType.includes('application/json')) {
        const jsonData = await response.json();
        result.extractedText = JSON.stringify(jsonData, null, 2);
        result.analysis.jsonStructure = this.analyzeJsonStructure(jsonData);
        
      } else if (contentType.includes('text/')) {
        result.extractedText = await response.text();
        
      } else {
        // Try to download and process as file
        const buffer = await response.buffer();
        const tempPath = path.join(this.uploadsDir, `url_download_${processId}`);
        await fs.writeFile(tempPath, buffer);
        
        // Determine file type and process
        const extension = this.guessFileExtension(contentType, url);
        const fileResult = await this.processFile(tempPath, `url_download${extension}`, metadata);
        
        result = { ...result, ...fileResult };
        await fs.unlink(tempPath); // Clean up temp file
      }

      // Store in vector database
      if (result.extractedText) {
        await vectorDatabaseService.createEmbedding(result.extractedText, {
          urlId: processId,
          url,
          contentType,
          processedAt: result.timestamp,
          ...metadata
        });
      }

      result.processed = true;
      logger.info(`Successfully processed URL: ${url}`);
      return result;
    } catch (error) {
      logger.error(`Failed to process URL ${url}:`, error);
      throw error;
    }
  }

  guessFileExtension(contentType, url) {
    // Try to get extension from URL first
    const urlExt = path.extname(new URL(url).pathname);
    if (urlExt) return urlExt;
    
    // Guess from content type
    const typeMap = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-excel': '.xls',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'video/mp4': '.mp4',
      'video/avi': '.avi'
    };
    
    return typeMap[contentType] || '.bin';
  }

  analyzeJsonStructure(obj, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return 'max_depth_reached';
    
    if (Array.isArray(obj)) {
      return {
        type: 'array',
        length: obj.length,
        elementTypes: obj.length > 0 ? [this.analyzeJsonStructure(obj[0], depth + 1, maxDepth)] : []
      };
    } else if (obj !== null && typeof obj === 'object') {
      const keys = Object.keys(obj);
      return {
        type: 'object',
        keys: keys,
        structure: keys.slice(0, 10).reduce((acc, key) => {
          acc[key] = this.analyzeJsonStructure(obj[key], depth + 1, maxDepth);
          return acc;
        }, {})
      };
    } else {
      return typeof obj;
    }
  }

  async searchProcessedFiles(query, fileTypes = [], limit = 10) {
    try {
      const filters = {};
      if (fileTypes.length > 0) {
        // This would need to be implemented based on your vector database filtering capabilities
        filters.fileType = fileTypes;
      }
      
      const results = await vectorDatabaseService.similaritySearch(query, limit, filters);
      return results.map(result => ({
        id: result.id,
        relevance: result.score,
        content: result.text,
        metadata: result.metadata
      }));
    } catch (error) {
      logger.error('Failed to search processed files:', error);
      return [];
    }
  }

  async getProcessingStats() {
    try {
      const uploadsFiles = await fs.readdir(this.uploadsDir);
      const processedFiles = await fs.readdir(this.processedDir);
      
      const stats = {
        totalUploads: uploadsFiles.length,
        totalProcessed: processedFiles.length,
        supportedFormats: {
          images: this.supportedImageFormats,
          documents: this.supportedDocFormats,
          audio: this.supportedAudioFormats,
          video: this.supportedVideoFormats
        }
      };
      
      return stats;
    } catch (error) {
      logger.error('Failed to get processing stats:', error);
      return {
        totalUploads: 0,
        totalProcessed: 0,
        supportedFormats: {}
      };
    }
  }
}

module.exports = new MultimodalProcessingService();
