import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { addCustomBuilding, getCustomBuildingsAsGeoJSON, clearCustomBuildings, deleteCustomBuilding, getCustomBuildings } from './tile-utils.js';
import { analyzeBuildingPlacement, analyzeBuildingsBatch, getAnalysisSummary, decodeBuilding } from './analysis.js';
import type { RoadNetwork } from './analysis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file
config({ path: join(__dirname, '../.env') });

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Load road network data
let roadNetwork: RoadNetwork | null = null;
try {
  const roadPath = join(__dirname, '../public/data/roads_downtown.geojson');
  const roadData = readFileSync(roadPath, 'utf-8');
  roadNetwork = JSON.parse(roadData);
  console.log(`✅ Loaded road network: ${roadNetwork?.features.length} roads`);
} catch (error) {
  console.error('⚠️  Failed to load road network:', error);
}

// API tokens (from environment)
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_ACCESS_TOKEN || '';
const BACKBOARD_API_KEY = process.env.VITE_BACKBOARD_API_KEY || '';

// Debug: Log API key status (but not the actual key!)
console.log(`🔑 API Keys Status:`);
console.log(`   - MAPBOX_TOKEN: ${MAPBOX_TOKEN ? '✅ Set (' + MAPBOX_TOKEN.substring(0, 10) + '...)' : '❌ Missing'}`);
console.log(`   - BACKBOARD_API_KEY: ${BACKBOARD_API_KEY ? '✅ Set (' + BACKBOARD_API_KEY.substring(0, 10) + '...)' : '❌ Missing'}`);

/**
 * Proxy tiles from Mapbox
 */
app.get('/tiles/:z/:x/:y.mvt', async (req, res) => {
  const { z, x, y } = req.params;
  
  try {
    // Fetch tile from Mapbox
    const mapboxUrl = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${z}/${x}/${y}.mvt?access_token=${MAPBOX_TOKEN}`;
    const response = await fetch(mapboxUrl);
    
    if (!response.ok) {
      return res.status(response.status).send('Tile not found');
    }

    const buffer = await response.buffer();
    
    // For now, just proxy the original tile
    // Custom buildings will be handled as a separate GeoJSON layer
    res.setHeader('Content-Type', 'application/x-protobuf');
    res.setHeader('Content-Encoding', 'gzip');
    res.send(buffer);
  } catch (error) {
    console.error('Error fetching tile:', error);
    res.status(500).send('Error fetching tile');
  }
});

/**
 * Get custom buildings as GeoJSON
 */
app.get('/api/buildings', (req, res) => {
  const geojson = getCustomBuildingsAsGeoJSON();
  res.json(geojson);
});

/**
 * Add a custom building
 */
app.post('/api/buildings', (req, res) => {
  const { coordinates, height, properties } = req.body;
  
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
    return res.status(400).json({ error: 'Invalid coordinates. Need at least 3 points [lng, lat]' });
  }

  const building = {
    id: `custom-${Date.now()}`,
    coordinates,
    height: height || 20,
    properties: properties || {}
  };

  addCustomBuilding(building);
  
  res.json({ 
    success: true, 
    building,
    geojson: getCustomBuildingsAsGeoJSON()
  });
});

/**
 * Get list of all buildings (with metadata)
 */
app.get('/api/buildings/list', (req, res) => {
  const buildings = getCustomBuildings();
  res.json(buildings);
});

/**
 * Delete a specific building by ID
 */
app.delete('/api/buildings/:id', (req, res) => {
  const { id } = req.params;
  const deleted = deleteCustomBuilding(id);
  
  if (deleted) {
    res.json({ success: true, message: `Building ${id} deleted` });
  } else {
    res.status(404).json({ error: `Building ${id} not found` });
  }
});

/**
 * Clear all custom buildings
 */
app.delete('/api/buildings', (req, res) => {
  clearCustomBuildings();
  res.json({ success: true });
});

/**
 * Analyze a specific building's placement relative to roads
 */
app.post('/api/buildings/analyze', (req, res) => {
  if (!roadNetwork) {
    return res.status(503).json({ error: 'Road network not loaded' });
  }

  const { buildingId, coordinates, radiusMeters } = req.body;

  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 3) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  try {
    const building = {
      id: buildingId || `temp-${Date.now()}`,
      coordinates,
      height: 20
    };

    const radius = radiusMeters || 500;
    const analysis = analyzeBuildingPlacement(building, roadNetwork, radius);
    const summary = getAnalysisSummary(analysis);

    res.json({
      success: true,
      analysis,
      summary
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed', message: (error as Error).message });
  }
});

/**
 * Analyze all custom buildings
 */
app.get('/api/buildings/analyze-all', (req, res) => {
  if (!roadNetwork) {
    return res.status(503).json({ error: 'Road network not loaded' });
  }

  const radiusMeters = parseInt(req.query.radius as string) || 500;
  
  try {
    const buildings = getCustomBuildings();
    const analyses = analyzeBuildingsBatch(buildings, roadNetwork, radiusMeters);
    const summaries = analyses.map(getAnalysisSummary);

    res.json({
      success: true,
      count: analyses.length,
      analyses,
      summaries
    });
  } catch (error) {
    console.error('Batch analysis error:', error);
    res.status(500).json({ error: 'Batch analysis failed', message: (error as Error).message });
  }
});

/**
 * Decode a building from Base64 encoding
 */
app.post('/api/buildings/decode', (req, res) => {
  const { encoded } = req.body;

  if (!encoded || typeof encoded !== 'string') {
    return res.status(400).json({ error: 'Invalid encoded data' });
  }

  try {
    const coordinates = decodeBuilding(encoded);
    res.json({
      success: true,
      coordinates
    });
  } catch (error) {
    console.error('Decode error:', error);
    res.status(400).json({ error: 'Failed to decode', message: (error as Error).message });
  }
});

/**
 * Get road network statistics
 */
app.get('/api/roads/stats', (req, res) => {
  if (!roadNetwork) {
    return res.status(503).json({ error: 'Road network not loaded' });
  }

  const stats = {
    totalRoads: roadNetwork.features.length,
    roadsByType: {} as Record<string, number>,
    namedRoads: 0,
    totalLength: 0
  };

  for (const road of roadNetwork.features) {
    // Count by highway type
    const highway = road.properties.highway;
    const highwayStr = Array.isArray(highway) ? highway[0] : highway || 'unknown';
    stats.roadsByType[highwayStr] = (stats.roadsByType[highwayStr] || 0) + 1;

    // Count named roads
    if (road.properties.name) {
      stats.namedRoads++;
    }
  }

  res.json(stats);
});

/**
 * Proxy for Backboard AI analysis (to avoid CORS)
 * Handles thread and assistant creation automatically
 */

// Cache for Backboard assistant and thread
let cachedAssistant: { assistant_id: string } | null = null;
let cachedThread: { thread_id: string } | null = null;

async function getOrCreateBackboardThread(): Promise<{ thread_id: string }> {
  if (cachedThread) {
    return cachedThread;
  }

  try {
    // Step 1: Get or create assistant
    if (!cachedAssistant) {
      const assistantsRes = await fetch('https://app.backboard.io/api/assistants', {
        method: 'GET',
        headers: { 'X-API-Key': BACKBOARD_API_KEY },
      });

      if (assistantsRes.ok) {
        const assistants = await assistantsRes.json();
        const existing = assistants.find((a: any) => a.name === 'UrbanSim Toronto Context Analysis');
        
        if (existing) {
          cachedAssistant = existing;
        } else {
          // Create new assistant
          const createRes = await fetch('https://app.backboard.io/api/assistants', {
            method: 'POST',
            headers: {
              'X-API-Key': BACKBOARD_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'UrbanSim Toronto Context Analysis',
              description: 'Analyzes construction impact based on nearby building context',
              system_prompt: 'You are an expert on Toronto urban planning and construction impact analysis. Focus on business competition, feasibility concerns, community impact, and opportunities when analyzing new construction near existing buildings.'
            }),
          });

          if (createRes.ok) {
            cachedAssistant = await createRes.json();
          } else {
            throw new Error(`Failed to create assistant: ${createRes.status}`);
          }
        }
      }
    }

    // Step 2: Get or create thread under assistant
    if (cachedAssistant) {
      const threadsRes = await fetch(`https://app.backboard.io/api/assistants/${cachedAssistant.assistant_id}/threads`, {
        method: 'GET',
        headers: { 'X-API-Key': BACKBOARD_API_KEY },
      });

      if (threadsRes.ok) {
        const threads = await threadsRes.json();
        if (threads.length > 0) {
          cachedThread = threads[0];
        } else {
          // Create new thread
          const createThreadRes = await fetch(`https://app.backboard.io/api/assistants/${cachedAssistant.assistant_id}/threads`, {
            method: 'POST',
            headers: {
              'X-API-Key': BACKBOARD_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          });

          if (createThreadRes.ok) {
            cachedThread = await createThreadRes.json();
          }
        }
      }
    }

    if (!cachedThread) {
      throw new Error('Failed to create or retrieve thread');
    }

    console.log(`✅ Using Backboard thread: ${cachedThread.thread_id}`);
    return cachedThread;
  } catch (error) {
    console.error('Failed to initialize Backboard thread:', error);
    throw error;
  }
}

app.post('/api/ai/analyze', async (req, res) => {
  if (!BACKBOARD_API_KEY) {
    return res.status(503).json({ error: 'Backboard API key not configured' });
  }

  const { query, options } = req.body;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Query is required' });
  }

  try {
    // Get or create thread (with caching)
    const thread = await getOrCreateBackboardThread();

    const formData = new URLSearchParams();
    formData.append('content', query);
    if (options?.llm_provider) formData.append('llm_provider', options.llm_provider);
    if (options?.model_name) formData.append('model_name', options.model_name);

    const backboardUrl = `https://app.backboard.io/api/threads/${thread.thread_id}/messages`;
    
    const response = await fetch(backboardUrl, {
      method: 'POST',
      headers: {
        'X-API-Key': BACKBOARD_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backboard API error:', response.status, errorText);
      return res.status(response.status).json({ error: 'Backboard API error', details: errorText });
    }

    let result = await response.json();
    const messageId = result.message_id;
    console.log(`📥 Backboard initial response: ${result.status || 'no status'} (message: ${messageId})`);
    
    // Poll for completion if status is IN_PROGRESS
    if (result.status === 'IN_PROGRESS' && messageId) {
      const maxAttempts = 15; // 30 seconds max
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        
        // Get specific message status
        const statusRes = await fetch(`https://app.backboard.io/api/threads/${result.thread_id}/messages/${messageId}`, {
          method: 'GET',
          headers: { 'X-API-Key': BACKBOARD_API_KEY },
        });
        
        if (statusRes.ok) {
          const updatedMessage = await statusRes.json();
          
          if (updatedMessage.status === 'COMPLETED') {
            console.log(`✅ Analysis completed after ${(attempt + 1) * 2} seconds`);
            result = updatedMessage;
            break;
          } else if (updatedMessage.status === 'FAILED') {
            console.log('❌ Analysis failed');
            result = updatedMessage;
            break;
          }
          console.log(`⏳ Attempt ${attempt + 1}: Still processing...`);
        }
      }
    }
    
    // Return the final result (completed or last IN_PROGRESS state)
    res.json(result);
  } catch (error) {
    console.error('AI analysis proxy error:', error);
    res.status(500).json({ error: 'AI analysis failed', message: (error as Error).message });
  }
});

/**
 * Find roads near a point
 */
app.post('/api/roads/nearby', (req, res) => {
  if (!roadNetwork) {
    return res.status(503).json({ error: 'Road network not loaded' });
  }

  const { lng, lat, radiusMeters } = req.body;

  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  const radius = radiusMeters || 500;
  
  try {
    // Create a temporary building at the point
    const tempBuilding = {
      id: 'temp',
      coordinates: [[lng, lat]]
    };

    const analysis = analyzeBuildingPlacement(tempBuilding, roadNetwork, radius);

    res.json({
      success: true,
      location: [lng, lat],
      radiusMeters: radius,
      nearbyRoads: analysis.nearbyRoads
    });
  } catch (error) {
    console.error('Nearby roads error:', error);
    res.status(500).json({ error: 'Failed to find nearby roads', message: (error as Error).message });
  }
});

// =====================================================================
// Moorcheh Memory Service Proxy
// Routes requests to the Python FastAPI service running on port 8000
// =====================================================================

const MOORCHEH_SERVICE_URL = process.env.MOORCHEH_SERVICE_URL || 'http://localhost:8000';

async function moorchehProxy(path: string, body: unknown) {
  const response = await fetch(`${MOORCHEH_SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Moorcheh ${path} failed (${response.status}): ${errText}`);
  }
  return response.json();
}

app.post('/api/moorcheh/chat', async (req, res) => {
  const { query, history, namespaces } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });
  try {
    const result = await moorchehProxy('/chat', { query, history, namespaces });
    res.json(result);
  } catch (error) {
    console.error('Moorcheh chat error:', error);
    res.status(500).json({ error: 'Chat failed', message: (error as Error).message });
  }
});

app.post('/api/moorcheh/search', async (req, res) => {
  const { namespace, query, top_k } = req.body;
  if (!query) return res.status(400).json({ error: 'Query is required' });
  try {
    const result = await moorchehProxy('/search', { namespace, query, top_k });
    res.json(result);
  } catch (error) {
    console.error('Moorcheh search error:', error);
    res.status(500).json({ error: 'Search failed', message: (error as Error).message });
  }
});

app.post('/api/moorcheh/similar', async (req, res) => {
  const { location, building_type, height, footprint, top_k } = req.body;
  try {
    const result = await moorchehProxy('/similar', { location, building_type, height, footprint, top_k });
    res.json(result);
  } catch (error) {
    console.error('Moorcheh similar error:', error);
    res.status(500).json({ error: 'Similar search failed', message: (error as Error).message });
  }
});

app.post('/api/moorcheh/store-analysis', async (req, res) => {
  try {
    const result = await moorchehProxy('/store-analysis', req.body);
    res.json(result);
  } catch (error) {
    console.error('Moorcheh store error:', error);
    res.status(500).json({ error: 'Storage failed', message: (error as Error).message });
  }
});

app.post('/api/moorcheh/ingest', async (req, res) => {
  try {
    const result = await moorchehProxy('/ingest', req.body);
    res.json(result);
  } catch (error) {
    console.error('Moorcheh ingest error:', error);
    res.status(500).json({ error: 'Ingestion failed', message: (error as Error).message });
  }
});

app.post('/api/moorcheh/neighborhood-stats', async (req, res) => {
  const { query, top_k } = req.body;
  try {
    const result = await moorchehProxy('/neighborhood-stats', { namespace: 'analyses', query, top_k });
    res.json(result);
  } catch (error) {
    console.error('Moorcheh neighborhood stats error:', error);
    res.status(500).json({ error: 'Stats failed', message: (error as Error).message });
  }
});

app.get('/api/moorcheh/health', async (_req, res) => {
  try {
    const response = await fetch(`${MOORCHEH_SERVICE_URL}/health`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(503).json({ error: 'Moorcheh service unavailable', message: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Building Analysis Server running on http://localhost:${PORT}`);
  console.log(`\n📡 Available endpoints:`);
  console.log(`   - GET  /api/buildings - Get all buildings as GeoJSON`);
  console.log(`   - POST /api/buildings - Add a new building`);
  console.log(`   - GET  /api/buildings/list - Get buildings with metadata`);
  console.log(`   - DELETE /api/buildings/:id - Delete a specific building`);
  console.log(`   - DELETE /api/buildings - Clear all buildings`);
  console.log(`\n🔬 Analysis endpoints:`);
  console.log(`   - POST /api/buildings/analyze - Analyze a building's placement`);
  console.log(`   - GET  /api/buildings/analyze-all?radius=500 - Analyze all buildings`);
  console.log(`   - POST /api/buildings/decode - Decode Base64 building data`);
  console.log(`   - GET  /api/roads/stats - Get road network statistics`);
  console.log(`   - POST /api/roads/nearby - Find roads near a point`);
  console.log(`\n🤖 AI Analysis:`);
  console.log(`   - POST /api/ai/analyze - AI-powered context analysis`);
  console.log(`\n🧠 Moorcheh Memory (${MOORCHEH_SERVICE_URL}):`);
  console.log(`   - POST /api/moorcheh/chat - Chat with community memory`);
  console.log(`   - POST /api/moorcheh/search - Search documents`);
  console.log(`   - POST /api/moorcheh/similar - Find similar analyses`);
  console.log(`   - POST /api/moorcheh/store-analysis - Store analysis`);
  console.log(`   - POST /api/moorcheh/ingest - Ingest document`);
  console.log(`   - POST /api/moorcheh/neighborhood-stats - Aggregate stats`);
  console.log(`   - GET  /api/moorcheh/health - Service health`);
  console.log(`\n🗺️  Map tiles:`);
  console.log(`   - GET  /tiles/{z}/{x}/{y}.mvt - Mapbox vector tiles proxy\n`);
});
