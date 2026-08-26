const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e8 });

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function transcodeVideo(inputPath, outputPath) {
  return new Promise((resolve) => {
    if (!ffmpegPath) return resolve(false);
    const proc = spawn(ffmpegPath, [
      '-i', inputPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', '-y', outputPath
    ]);
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

app.get('/uploads/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Archivo no encontrado');
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(req.params.filename).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/mp4',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  if (range && contentType.startsWith('video/')) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': (end - start) + 1,
      'Content-Type': contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  }
});

app.get('/tv', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/c', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/:id([1-7])', (req, res) => res.redirect(`/display.html?id=${req.params.id}`));

let state = {
  mode: 'individual',
  mirrorConfig: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false },
  splitConfig: { rows: 1, cols: 7, layout: [[1, 2, 3, 4, 5, 6, 7]], type: 'empty', src: null, text: '', fit: 'cover', muted: false },
  screens: {
    1: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false },
    2: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false },
    3: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false },
    4: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false },
    5: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false },
    6: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false },
    7: { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false }
  }
};

const activeDisplays = new Map(); // socketId -> { screenId, pin, specs: { res, w, h, ratio } }
const pinRegistry = new Map();

app.post('/api/upload-base64', async (req, res) => {
  try {
    const { data, filename, isVideo } = req.body;
    if (!data) return res.status(400).json({ error: 'Sin datos' });
    const base64Idx = data.indexOf(';base64,');
    const rawData = base64Idx !== -1 ? data.substring(base64Idx + 8) : data;
    const ext = isVideo ? '.mp4' : (filename ? path.extname(filename) : '.jpg') || '.jpg';
    const tempName = `raw_${Date.now()}${ext}`;
    const tempPath = path.join(UPLOADS_DIR, tempName);

    fs.writeFileSync(tempPath, Buffer.from(rawData, 'base64'));
    let finalFilename = tempName;
    if (isVideo) {
      finalFilename = `tv_audio_${Date.now()}.mp4`;
      const finalPath = path.join(UPLOADS_DIR, finalFilename);
      const success = await transcodeVideo(tempPath, finalPath);
      if (success) { try { fs.unlinkSync(tempPath); } catch (e) {} } else { finalFilename = tempName; }
    }
    res.json({ url: `/uploads/${finalFilename}`, type: isVideo ? 'video' : 'image' });
  } catch (err) {
    res.status(500).json({ error: 'Error procesando archivo' });
  }
});

app.get('/api/state', (req, res) => res.json({ state, displays: Array.from(activeDisplays.values()) }));

function broadcastState() { io.emit('state-update', state); }
function broadcastDisplays() { io.emit('displays-update', Array.from(activeDisplays.values())); }

function generateUniquePin() {
  let pin;
  do { pin = Math.floor(100000 + Math.random() * 900000).toString(); } while (pinRegistry.has(pin));
  return pin;
}

io.on('connection', (socket) => {
  socket.on('register-display', ({ screenId, requestPin, specs }) => {
    let sId = parseInt(screenId, 10);
    let pin = null;
    if (!sId || sId < 1 || sId > 7 || requestPin) {
      pin = generateUniquePin();
      pinRegistry.set(pin, { socketId: socket.id, generatedAt: Date.now() });
      socket.emit('assigned-pin', pin);
    }
    activeDisplays.set(socket.id, { socketId: socket.id, screenId: sId || null, pin, specs: specs || null });
    socket.emit('state-update', state);
    broadcastDisplays();
  });

  socket.on('report-specs', ({ screenId, specs }) => {
    if (activeDisplays.has(socket.id)) {
      activeDisplays.get(socket.id).specs = specs;
      broadcastDisplays();
    }
  });

  socket.on('pair-pin', ({ pin, targetScreenId }, callback) => {
    const sId = parseInt(targetScreenId, 10);
    if (!pinRegistry.has(pin) || !sId || sId < 1 || sId > 7) {
      return callback && callback({ success: false, message: 'PIN no válido' });
    }
    const { socketId: tvSocketId } = pinRegistry.get(pin);
    pinRegistry.delete(pin);
    if (activeDisplays.has(tvSocketId)) {
      activeDisplays.get(tvSocketId).screenId = sId;
      activeDisplays.get(tvSocketId).pin = null;
    }
    io.to(tvSocketId).emit('paired-success', sId);
    broadcastDisplays();
    broadcastState();
    if (callback) callback({ success: true, screenId: sId });
  });

  socket.on('set-mode', (mode) => {
    if (['mirror', 'split', 'individual'].includes(mode)) {
      state.mode = mode;
      broadcastState();
    }
  });

  socket.on('update-mirror', (config) => {
    state.mirrorConfig = { ...state.mirrorConfig, ...config };
    broadcastState();
  });

  socket.on('update-split', (config) => {
    state.splitConfig = { ...state.splitConfig, ...config };
    broadcastState();
  });

  socket.on('update-screen', ({ screenId, ...data }) => {
    const id = parseInt(screenId, 10);
    if (state.screens[id]) {
      state.screens[id] = { ...state.screens[id], ...data };
      broadcastState();
    }
  });

  socket.on('clear-screens', (target) => {
    if (target === 'all') {
      state.mirrorConfig = { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false };
      state.splitConfig = { ...state.splitConfig, type: 'empty', src: null, text: '', fit: 'cover', muted: false };
      Object.keys(state.screens).forEach(id => {
        state.screens[id] = { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false };
      });
    } else {
      const id = parseInt(target, 10);
      if (state.screens[id]) state.screens[id] = { type: 'empty', src: null, items: [], interval: 5, text: '', fit: 'contain', muted: false };
    }
    broadcastState();
  });

  socket.on('reload-displays', () => io.emit('force-reload'));

  socket.on('disconnect', () => {
    if (activeDisplays.has(socket.id)) {
      const data = activeDisplays.get(socket.id);
      if (data.pin) pinRegistry.delete(data.pin);
      activeDisplays.delete(socket.id);
      broadcastDisplays();
    }
  });
});

function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`[TV-STREAM] Servidor listo en http://localhost:${port}`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') startServer(port + 1);
    else console.error(err);
  });
}

startServer(PORT);
