const fs = require('fs-extra');
const path = require('path');
const { JSDOM } = require('jsdom');
// plotly.js is meant for browser use, so we'll handle it client-side
const chroma = require('chroma-js');
const logger = require('./loggerService');
const vectorDatabaseService = require('./vectorDatabaseService');

class VectorVisualizationService {
  constructor() {
    this.visualizationsDir = path.join(__dirname, '../public/visualizations');
    this.ensureDirectories();
  }

  async ensureDirectories() {
    await fs.ensureDir(this.visualizationsDir);
  }

  async createVectorVisualization(options = {}) {
    try {
      const {
        type = 'scatter',
        dimensions = 2,
        maxVectors = 1000,
        colorBy = 'category',
        includeLabels = true,
        userId = null,
        filters = {}
      } = options;

      // Get vectors from database
      const vectors = await this.getVectorsForVisualization(maxVectors, userId, filters);
      
      if (vectors.length === 0) {
        throw new Error('No vectors found for visualization');
      }

      // Reduce dimensionality for visualization
      const reducedVectors = await this.reduceDimensionality(vectors, dimensions);
      
      // Create visualization based on type
      let visualization;
      switch (type) {
        case 'scatter':
          visualization = await this.createScatterPlot(reducedVectors, options);
          break;
        case 'cluster':
          visualization = await this.createClusterVisualization(reducedVectors, options);
          break;
        case 'heatmap':
          visualization = await this.createHeatmap(reducedVectors, options);
          break;
        case 'network':
          visualization = await this.createNetworkGraph(reducedVectors, options);
          break;
        case 'timeline':
          visualization = await this.createTimelineVisualization(reducedVectors, options);
          break;
        default:
          throw new Error(`Unsupported visualization type: ${type}`);
      }

      const visualizationId = `viz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const filePath = path.join(this.visualizationsDir, `${visualizationId}.html`);
      
      await fs.writeFile(filePath, visualization.html);
      
      const result = {
        id: visualizationId,
        type,
        filePath,
        url: `/visualizations/${visualizationId}.html`,
        metadata: {
          vectorCount: vectors.length,
          dimensions,
          colorBy,
          createdAt: new Date().toISOString(),
          ...visualization.metadata
        }
      };

      logger.info(`Created ${type} visualization with ${vectors.length} vectors`);
      return result;
    } catch (error) {
      logger.error('Failed to create vector visualization:', error);
      throw error;
    }
  }

  async getVectorsForVisualization(maxVectors, userId, filters) {
    try {
      // Get all vectors (in a real implementation, you'd want pagination)
      const allVectors = await vectorDatabaseService.getAllVectors();
      
      // Apply filters
      let filteredVectors = allVectors;
      
      if (userId) {
        filteredVectors = filteredVectors.filter(v => v.metadata.userId === userId);
      }
      
      for (const [key, value] of Object.entries(filters)) {
        filteredVectors = filteredVectors.filter(v => v.metadata[key] === value);
      }
      
      // Limit the number of vectors
      if (filteredVectors.length > maxVectors) {
        // Sample randomly
        const step = Math.floor(filteredVectors.length / maxVectors);
        filteredVectors = filteredVectors.filter((_, index) => index % step === 0);
      }
      
      return filteredVectors.slice(0, maxVectors);
    } catch (error) {
      logger.error('Failed to get vectors for visualization:', error);
      return [];
    }
  }

  async reduceDimensionality(vectors, targetDimensions) {
    try {
      // Simple PCA implementation for dimensionality reduction
      // In a production environment, you'd want to use a more sophisticated library
      
      if (vectors.length === 0) return [];
      
      const vectorDimensions = vectors[0].values ? vectors[0].values.length : vectors[0].vector.length;
      if (vectorDimensions <= targetDimensions) {
        // No reduction needed
        return vectors.map(v => ({
          ...v,
          reducedVector: v.values || v.vector
        }));
      }

      // Extract vector matrices
      const matrix = vectors.map(v => v.values || v.vector);
      
      // Simple dimensionality reduction using first N dimensions
      // (In practice, you'd use PCA, t-SNE, or UMAP)
      const reduced = matrix.map(vector => vector.slice(0, targetDimensions));
      
      return vectors.map((v, index) => ({
        ...v,
        reducedVector: reduced[index]
      }));
    } catch (error) {
      logger.error('Failed to reduce dimensionality:', error);
      // Fallback: return first N dimensions
      return vectors.map(v => ({
        ...v,
        reducedVector: (v.values || v.vector).slice(0, targetDimensions)
      }));
    }
  }

  async createScatterPlot(vectors, options) {
    try {
      const { colorBy = 'category', includeLabels = true, title = 'Vector Space Visualization' } = options;
      
      // Prepare data
      const traces = this.groupVectorsByColor(vectors, colorBy);
      const plotData = traces.map(trace => ({
        x: trace.vectors.map(v => v.reducedVector[0]),
        y: trace.vectors.map(v => v.reducedVector[1]),
        z: trace.vectors.length > 0 && trace.vectors[0].reducedVector.length > 2 ? 
           trace.vectors.map(v => v.reducedVector[2]) : undefined,
        mode: 'markers',
        type: trace.vectors[0]?.reducedVector.length > 2 ? 'scatter3d' : 'scatter',
        name: trace.category,
        text: includeLabels ? trace.vectors.map(v => this.createVectorLabel(v)) : undefined,
        marker: {
          size: 8,
          color: trace.color,
          opacity: 0.7
        }
      }));

      const layout = {
        title: title,
        width: 900,
        height: 600,
        xaxis: { title: 'Dimension 1' },
        yaxis: { title: 'Dimension 2' },
        hovermode: 'closest',
        showlegend: true
      };

      if (vectors[0]?.reducedVector.length > 2) {
        layout.scene = {
          xaxis: { title: 'Dimension 1' },
          yaxis: { title: 'Dimension 2' },
          zaxis: { title: 'Dimension 3' }
        };
      }

      const html = this.generatePlotlyHtml(plotData, layout, title);
      
      return {
        html,
        metadata: {
          plotType: 'scatter',
          dimensions: vectors[0]?.reducedVector.length || 2,
          categories: traces.map(t => t.category)
        }
      };
    } catch (error) {
      logger.error('Failed to create scatter plot:', error);
      throw error;
    }
  }

  async createClusterVisualization(vectors, options) {
    try {
      const { clusters = 5, title = 'Vector Clusters' } = options;
      
      // Simple k-means clustering
      const clusteredVectors = await this.performKMeansClustering(vectors, clusters);
      
      const traces = [];
      for (let i = 0; i < clusters; i++) {
        const clusterVectors = clusteredVectors.filter(v => v.cluster === i);
        if (clusterVectors.length === 0) continue;
        
        traces.push({
          x: clusterVectors.map(v => v.reducedVector[0]),
          y: clusterVectors.map(v => v.reducedVector[1]),
          mode: 'markers',
          type: 'scatter',
          name: `Cluster ${i + 1}`,
          text: clusterVectors.map(v => this.createVectorLabel(v)),
          marker: {
            size: 8,
            color: chroma.scale(['red', 'yellow', 'green', 'blue', 'purple'])(i / clusters).hex(),
            opacity: 0.7
          }
        });
      }

      const layout = {
        title: title,
        width: 900,
        height: 600,
        xaxis: { title: 'Dimension 1' },
        yaxis: { title: 'Dimension 2' },
        hovermode: 'closest',
        showlegend: true
      };

      const html = this.generatePlotlyHtml(traces, layout, title);
      
      return {
        html,
        metadata: {
          plotType: 'cluster',
          clusterCount: clusters,
          clusteredVectors: clusteredVectors.length
        }
      };
    } catch (error) {
      logger.error('Failed to create cluster visualization:', error);
      throw error;
    }
  }

  async createHeatmap(vectors, options) {
    try {
      const { title = 'Vector Similarity Heatmap', maxVectors = 100 } = options;
      
      // Limit vectors for heatmap (computational complexity)
      const limitedVectors = vectors.slice(0, maxVectors);
      
      // Calculate similarity matrix
      const similarityMatrix = [];
      const labels = limitedVectors.map(v => this.createVectorLabel(v, 20));
      
      for (let i = 0; i < limitedVectors.length; i++) {
        const row = [];
        for (let j = 0; j < limitedVectors.length; j++) {
          const similarity = this.calculateCosineSimilarity(
            limitedVectors[i].reducedVector,
            limitedVectors[j].reducedVector
          );
          row.push(similarity);
        }
        similarityMatrix.push(row);
      }

      const trace = {
        z: similarityMatrix,
        x: labels,
        y: labels,
        type: 'heatmap',
        colorscale: 'Viridis'
      };

      const layout = {
        title: title,
        width: 800,
        height: 800,
        xaxis: { 
          title: 'Vectors',
          tickangle: -45
        },
        yaxis: { 
          title: 'Vectors',
          tickangle: 0
        }
      };

      const html = this.generatePlotlyHtml([trace], layout, title);
      
      return {
        html,
        metadata: {
          plotType: 'heatmap',
          matrixSize: limitedVectors.length
        }
      };
    } catch (error) {
      logger.error('Failed to create heatmap:', error);
      throw error;
    }
  }

  async createNetworkGraph(vectors, options) {
    try {
      const { 
        title = 'Vector Network Graph',
        similarityThreshold = 0.7,
        maxNodes = 200 
      } = options;
      
      const limitedVectors = vectors.slice(0, maxNodes);
      
      // Create nodes
      const nodes = limitedVectors.map((v, index) => ({
        id: index,
        label: this.createVectorLabel(v, 30),
        x: v.reducedVector[0],
        y: v.reducedVector[1],
        size: 10,
        color: this.getNodeColor(v)
      }));
      
      // Create edges based on similarity
      const edges = [];
      for (let i = 0; i < limitedVectors.length; i++) {
        for (let j = i + 1; j < limitedVectors.length; j++) {
          const similarity = this.calculateCosineSimilarity(
            limitedVectors[i].reducedVector,
            limitedVectors[j].reducedVector
          );
          
          if (similarity > similarityThreshold) {
            edges.push({
              source: i,
              target: j,
              weight: similarity
            });
          }
        }
      }

      // Create network visualization using D3
      const html = this.generateD3NetworkHtml(nodes, edges, title);
      
      return {
        html,
        metadata: {
          plotType: 'network',
          nodeCount: nodes.length,
          edgeCount: edges.length,
          similarityThreshold
        }
      };
    } catch (error) {
      logger.error('Failed to create network graph:', error);
      throw error;
    }
  }

  async createTimelineVisualization(vectors, options) {
    try {
      const { title = 'Vector Timeline', timeField = 'timestamp' } = options;
      
      // Filter vectors that have timestamp data
      const timeVectors = vectors.filter(v => v.metadata[timeField]);
      
      // Sort by timestamp
      timeVectors.sort((a, b) => new Date(a.metadata[timeField]) - new Date(b.metadata[timeField]));
      
      const trace = {
        x: timeVectors.map(v => v.metadata[timeField]),
        y: timeVectors.map((v, index) => index),
        mode: 'markers+lines',
        type: 'scatter',
        text: timeVectors.map(v => this.createVectorLabel(v)),
        marker: {
          size: 8,
          color: timeVectors.map(v => this.getVectorColorValue(v)),
          colorscale: 'Viridis',
          showscale: true
        }
      };

      const layout = {
        title: title,
        width: 1000,
        height: 600,
        xaxis: { 
          title: 'Time',
          type: 'date'
        },
        yaxis: { title: 'Vector Index' },
        hovermode: 'closest'
      };

      const html = this.generatePlotlyHtml([trace], layout, title);
      
      return {
        html,
        metadata: {
          plotType: 'timeline',
          timeRange: {
            start: timeVectors[0]?.metadata[timeField],
            end: timeVectors[timeVectors.length - 1]?.metadata[timeField]
          }
        }
      };
    } catch (error) {
      logger.error('Failed to create timeline visualization:', error);
      throw error;
    }
  }

  groupVectorsByColor(vectors, colorBy) {
    const groups = new Map();
    
    vectors.forEach(vector => {
      let category = 'default';
      
      if (colorBy && vector.metadata[colorBy]) {
        category = vector.metadata[colorBy];
      } else if (vector.metadata.type) {
        category = vector.metadata.type;
      } else if (vector.metadata.category) {
        category = vector.metadata.category;
      }
      
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category).push(vector);
    });
    
    const colors = chroma.scale(['red', 'yellow', 'green', 'blue', 'purple', 'orange', 'pink']);
    const groupArray = Array.from(groups.entries());
    
    return groupArray.map(([category, vectors], index) => ({
      category,
      vectors,
      color: colors(index / Math.max(groupArray.length - 1, 1)).hex()
    }));
  }

  createVectorLabel(vector, maxLength = 50) {
    let label = '';
    
    if (vector.metadata.text) {
      label = vector.metadata.text;
    } else if (vector.metadata.fileName) {
      label = vector.metadata.fileName;
    } else if (vector.id) {
      label = vector.id;
    } else {
      label = 'Unknown';
    }
    
    return label.length > maxLength ? label.substring(0, maxLength) + '...' : label;
  }

  getNodeColor(vector) {
    if (vector.metadata.type === 'memory') return '#ff6b6b';
    if (vector.metadata.type === 'conversation') return '#4ecdc4';
    if (vector.metadata.type === 'document') return '#45b7d1';
    if (vector.metadata.type === 'image') return '#96ceb4';
    return '#feca57';
  }

  getVectorColorValue(vector) {
    // Return a numeric value for coloring
    if (vector.metadata.importance) return vector.metadata.importance;
    if (vector.metadata.confidence) return vector.metadata.confidence;
    return Math.random(); // Fallback to random
  }

  calculateCosineSimilarity(a, b) {
    const dotProduct = a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
  }

  async performKMeansClustering(vectors, k) {
    // Simple k-means implementation
    const points = vectors.map(v => v.reducedVector);
    
    // Initialize centroids randomly
    let centroids = [];
    for (let i = 0; i < k; i++) {
      const randomIndex = Math.floor(Math.random() * points.length);
      centroids.push([...points[randomIndex]]);
    }
    
    let assignments = new Array(points.length).fill(0);
    let changed = true;
    let iterations = 0;
    const maxIterations = 100;
    
    while (changed && iterations < maxIterations) {
      changed = false;
      
      // Assign points to nearest centroid
      for (let i = 0; i < points.length; i++) {
        let minDistance = Infinity;
        let nearestCentroid = 0;
        
        for (let j = 0; j < centroids.length; j++) {
          const distance = this.euclideanDistance(points[i], centroids[j]);
          if (distance < minDistance) {
            minDistance = distance;
            nearestCentroid = j;
          }
        }
        
        if (assignments[i] !== nearestCentroid) {
          assignments[i] = nearestCentroid;
          changed = true;
        }
      }
      
      // Update centroids
      for (let j = 0; j < centroids.length; j++) {
        const clusterPoints = points.filter((_, i) => assignments[i] === j);
        if (clusterPoints.length > 0) {
          const dimensions = clusterPoints[0].length;
          for (let d = 0; d < dimensions; d++) {
            centroids[j][d] = clusterPoints.reduce((sum, p) => sum + p[d], 0) / clusterPoints.length;
          }
        }
      }
      
      iterations++;
    }
    
    return vectors.map((vector, index) => ({
      ...vector,
      cluster: assignments[index]
    }));
  }

  euclideanDistance(a, b) {
    return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - (b[i] || 0), 2), 0));
  }

  generatePlotlyHtml(data, layout, title) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .info {
            margin-bottom: 20px;
            padding: 10px;
            background-color: #e8f4f8;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="info">
            <h3>${title}</h3>
            <p>Interactive vector visualization. Hover over points for details.</p>
        </div>
        <div id="plot"></div>
    </div>
    
    <script>
        Plotly.newPlot('plot', ${JSON.stringify(data)}, ${JSON.stringify(layout)}, {
            responsive: true,
            displayModeBar: true
        });
    </script>
</body>
</html>`;
  }

  generateD3NetworkHtml(nodes, edges, title) {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .info {
            margin-bottom: 20px;
            padding: 10px;
            background-color: #e8f4f8;
            border-radius: 4px;
        }
        .links line {
            stroke: #999;
            stroke-opacity: 0.6;
        }
        .nodes circle {
            stroke: #fff;
            stroke-width: 1.5px;
        }
        .node-label {
            font-size: 10px;
            fill: #333;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="info">
            <h3>${title}</h3>
            <p>Network graph showing vector relationships. Drag nodes to interact.</p>
            <p>Nodes: ${nodes.length}, Edges: ${edges.length}</p>
        </div>
        <svg id="network" width="900" height="600"></svg>
    </div>
    
    <script>
        const svg = d3.select("#network");
        const width = +svg.attr("width");
        const height = +svg.attr("height");
        
        const nodes = ${JSON.stringify(nodes)};
        const edges = ${JSON.stringify(edges)};
        
        const simulation = d3.forceSimulation(nodes)
            .force("link", d3.forceLink(edges).id(d => d.id).distance(50))
            .force("charge", d3.forceManyBody().strength(-200))
            .force("center", d3.forceCenter(width / 2, height / 2));
        
        const link = svg.append("g")
            .attr("class", "links")
            .selectAll("line")
            .data(edges)
            .enter().append("line")
            .attr("stroke-width", d => Math.sqrt(d.weight) * 2);
        
        const node = svg.append("g")
            .attr("class", "nodes")
            .selectAll("g")
            .data(nodes)
            .enter().append("g");
        
        node.append("circle")
            .attr("r", d => d.size)
            .attr("fill", d => d.color)
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
        
        node.append("text")
            .attr("class", "node-label")
            .attr("dx", 12)
            .attr("dy", ".35em")
            .text(d => d.label.substring(0, 20));
        
        node.append("title")
            .text(d => d.label);
        
        simulation.on("tick", () => {
            link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
            
            node
                .attr("transform", d => \`translate(\${d.x},\${d.y})\`);
        });
        
        function dragstarted(event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        }
        
        function dragged(event, d) {
            d.fx = event.x;
            d.fy = event.y;
        }
        
        function dragended(event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
        }
    </script>
</body>
</html>`;
  }

  async getAvailableVisualizations() {
    try {
      const files = await fs.readdir(this.visualizationsDir);
      const visualizations = [];
      
      for (const file of files) {
        if (file.endsWith('.html')) {
          const filePath = path.join(this.visualizationsDir, file);
          const stats = await fs.stat(filePath);
          
          visualizations.push({
            id: file.replace('.html', ''),
            filename: file,
            url: `/visualizations/${file}`,
            createdAt: stats.birthtime,
            size: stats.size
          });
        }
      }
      
      return visualizations.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (error) {
      logger.error('Failed to get available visualizations:', error);
      return [];
    }
  }

  async deleteVisualization(visualizationId) {
    try {
      const filePath = path.join(this.visualizationsDir, `${visualizationId}.html`);
      if (await fs.pathExists(filePath)) {
        await fs.unlink(filePath);
        logger.info(`Deleted visualization: ${visualizationId}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to delete visualization:', error);
      return false;
    }
  }
}

module.exports = new VectorVisualizationService();
