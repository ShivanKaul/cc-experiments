const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

// --- IndexedDB-backed cache for large model files ---
const idbCache = (function() {
  const DB_NAME = 'transformers-cache';
  const STORE_NAME = 'models';
  const DB_VERSION = 1;

  function openDB() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function() {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
  }

  function urlKey(request) {
    return typeof request === 'string' ? request : request.url;
  }

  return {
    match: async function(request) {
      var db = await openDB();
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var store = tx.objectStore(STORE_NAME);
        var req = store.get(urlKey(request));
        req.onsuccess = function() {
          if (!req.result) { resolve(undefined); return; }
          var entry = req.result;
          resolve(new Response(entry.body, {
            headers: entry.headers,
            status: entry.status,
            statusText: entry.statusText,
          }));
        };
        req.onerror = function() { reject(req.error); };
      });
    },
    put: async function(request, response) {
      var body = await response.clone().blob();
      var headers = {};
      response.headers.forEach(function(v, k) { headers[k] = v; });
      var entry = {
        body: body,
        headers: headers,
        status: response.status,
        statusText: response.statusText,
      };
      var db = await openDB();
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var store = tx.objectStore(STORE_NAME);
        var req = store.put(entry, urlKey(request));
        req.onsuccess = function() { resolve(); };
        req.onerror = function() { reject(req.error); };
      });
    },
  };
})();

let pipelineFn = null;
let transcriber = null;
let loadedModelId = null;

// Sequential job queue — one transcription at a time
const queue = [];
let processing = false;

self.onmessage = function(e) {
  var msg = e.data;

  if (msg.type === 'reset') {
    transcriber = null;
    loadedModelId = null;
    return;
  }

  if (msg.type === 'transcribe') {
    queue.push(msg);
    if (!processing) processQueue();
  }
};

async function processQueue() {
  processing = true;
  while (queue.length > 0) {
    await doTranscribe(queue.shift());
  }
  processing = false;
}

async function doTranscribe(job) {
  var id = job.id;
  var modelId = job.modelId;
  var audio = job.audio;

  try {
    // Load library if needed
    if (!pipelineFn) {
      self.postMessage({ type: 'status', id: id, status: 'loading-library' });
      var mod = await import(LIB_URL);
      mod.env.useBrowserCache = false;
      mod.env.useCustomCache = true;
      mod.env.customCache = idbCache;
      pipelineFn = mod.pipeline;
    }

    // Load model if needed
    if (!transcriber || loadedModelId !== modelId) {
      transcriber = null;
      loadedModelId = null;
      self.postMessage({ type: 'status', id: id, status: 'loading-model' });

      transcriber = await pipelineFn(
        'automatic-speech-recognition',
        modelId,
        {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: function(progress) {
            self.postMessage({ type: 'model-progress', id: id, progress: progress });
          },
        }
      );
      loadedModelId = modelId;
    }

    // Transcribe
    var durationSecs = audio.length / 16000;
    var totalChunks = Math.ceil(durationSecs / 30);
    var chunksProcessed = 0;

    self.postMessage({ type: 'status', id: id, status: 'transcribing', totalChunks: totalChunks });

    var result = await transcriber(audio, {
      language: 'en',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      chunk_callback: function(chunk) {
        chunksProcessed++;
        self.postMessage({
          type: 'chunk',
          id: id,
          text: chunk.text.trim(),
          chunksProcessed: chunksProcessed,
          totalChunks: totalChunks,
        });
      },
    });

    self.postMessage({ type: 'result', id: id, text: result.text.trim() });
  } catch (err) {
    self.postMessage({ type: 'error', id: id, error: err.message });
  }
}
