let screenId = null;
let currentPin = null;
let slideTimer = null;
let currentSlideIndex = 0;
let currentPlaylist = [];
let currentInterval = 5;
let currentFitClass = 'fit-contain';
const socket = io();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

const imgEl = document.getElementById('display-image');
const videoEl = document.getElementById('display-video');
const frameEl = document.getElementById('display-frame');
const textEl = document.getElementById('display-text');
const emptyEl = document.getElementById('empty-state');
const badgeIdEl = document.getElementById('badge-id');
const emptyIdEl = document.getElementById('empty-id');
const statusDot = document.getElementById('status-dot');
const setupOverlay = document.getElementById('setup-overlay');
const pinDisplayEl = document.getElementById('display-pin-code');
const screenContainer = document.getElementById('screen-container');

function getDisplaySpecs() {
  const dpr = window.devicePixelRatio || 1;
  const rw = Math.round((window.screen.width || window.innerWidth) * dpr);
  const rh = Math.round((window.screen.height || window.innerHeight) * dpr);
  function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
  const div = gcd(rw, rh);
  const aspect = `${rw / div}:${rh / div}`;
  return { width: rw, height: rh, aspect: ['16:9', '8:5', '4:3'].includes(aspect) ? aspect : '16:9', resLabel: `${rw}x${rh}` };
}

function initDisplay() {
  const p = new URLSearchParams(window.location.search);
  const urlId = p.get('id');
  const storedId = localStorage.getItem('tv_screen_id');

  if (urlId) {
    screenId = parseInt(urlId, 10);
    localStorage.setItem('tv_screen_id', screenId);
  } else if (storedId) {
    screenId = parseInt(storedId, 10);
  }

  if (screenId && screenId >= 1 && screenId <= 7) {
    setupOverlay.style.display = 'none';
    badgeIdEl.textContent = screenId;
    emptyIdEl.textContent = screenId;
    registerDisplay();
    if (typeof listenUnpairSignal === 'function') {
      listenUnpairSignal(screenId, () => unpairThisTv());
    }
  } else {
    showPairingScreen();
  }
}

function showPairingScreen() {
  setupOverlay.style.display = 'flex';
  // Generar código PIN de 6 dígitos único para esta TV
  currentPin = Math.floor(100000 + Math.random() * 900000).toString();
  pinDisplayEl.textContent = `${currentPin.slice(0, 3)} - ${currentPin.slice(3)}`;

  // Escuchar vinculación en Firebase RTDB y WebSockets
  if (typeof listenTvPinPairing === 'function') {
    listenTvPinPairing(currentPin, (assignedId) => {
      onTvPaired(assignedId);
    });
  }
  socket.emit('register-display', { screenId: null, requestPin: true, specs: getDisplaySpecs() });
}

function onTvPaired(assignedId) {
  screenId = parseInt(assignedId, 10);
  localStorage.setItem('tv_screen_id', screenId);
  badgeIdEl.textContent = screenId;
  emptyIdEl.textContent = screenId;
  setupOverlay.style.display = 'none';
  registerDisplay();
  if (typeof listenUnpairSignal === 'function') {
    listenUnpairSignal(screenId, () => unpairThisTv());
  }
}

function unpairThisTv() {
  localStorage.removeItem('tv_screen_id');
  screenId = null;
  hideAllMedia();
  showPairingScreen();
}

function registerDisplay() {
  const specs = getDisplaySpecs();
  socket.emit('register-display', { screenId, specs });
  if (typeof reportFirebaseSpecs === 'function' && screenId) {
    reportFirebaseSpecs(screenId, specs);
  }
}

socket.on('assigned-pin', (pin) => {
  if (!screenId) {
    currentPin = pin;
    pinDisplayEl.textContent = `${pin.slice(0, 3)} - ${pin.slice(3)}`;
  }
});
socket.on('paired-success', (id) => onTvPaired(id));
socket.on('connect', () => { statusDot.className = 'dot online'; if (screenId) registerDisplay(); });
socket.on('disconnect', () => statusDot.className = 'dot offline');
socket.on('force-reload', () => window.location.reload());
socket.on('state-update', (state) => renderState(state));

if (typeof listenFirebaseState === 'function') {
  listenFirebaseState((state) => { if (state) renderState(state); });
}

window.addEventListener('resize', () => {
  if (screenId) {
    socket.emit('report-specs', { screenId, specs: getDisplaySpecs() });
    if (typeof reportFirebaseSpecs === 'function') reportFirebaseSpecs(screenId, getDisplaySpecs());
  }
});

function hideAllMedia() {
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
  imgEl.style.display = 'none';
  if (!videoEl.paused) videoEl.pause();
  videoEl.style.display = 'none';
  frameEl.style.display = 'none';
  textEl.style.display = 'none';
}

function isVideoUrl(url) {
  return /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(url) || url.includes('/uploads/tv_audio_') || url.includes('/uploads/h264_');
}

function showNextSlide() {
  if (!currentPlaylist || currentPlaylist.length === 0) return;
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }

  const url = currentPlaylist[currentSlideIndex];
  const isVideo = isVideoUrl(url);

  if (isVideo) {
    imgEl.style.display = 'none';
    videoEl.style.display = 'block';
    videoEl.className = `media-elem ${currentFitClass}`;
    videoEl.muted = false;
    videoEl.loop = false;
    let targetSrc = url;
    if (targetSrc.includes('/uploads/media_') && !targetSrc.includes('/uploads/tv_audio_')) {
      targetSrc = targetSrc.replace('/uploads/media_', '/uploads/tv_audio_media_');
    }
    if (videoEl.src !== targetSrc && !videoEl.src.endsWith(targetSrc)) { videoEl.src = targetSrc; videoEl.load(); }
    videoEl.play().catch(() => { videoEl.muted = true; videoEl.play().catch(() => {}); });
    videoEl.onended = () => {
      currentSlideIndex = (currentSlideIndex + 1) % currentPlaylist.length;
      showNextSlide();
    };
  } else {
    videoEl.style.display = 'none';
    if (!videoEl.paused) videoEl.pause();
    imgEl.style.display = 'block';
    imgEl.className = `media-elem ${currentFitClass}`;
    if (imgEl.src !== url && !imgEl.src.endsWith(url)) imgEl.src = url;
    if (currentPlaylist.length > 1) {
      const ms = Math.max(1, currentInterval || 5) * 1000;
      slideTimer = setTimeout(() => {
        currentSlideIndex = (currentSlideIndex + 1) % currentPlaylist.length;
        showNextSlide();
      }, ms);
    }
  }
}

function startSlideshow(items, intervalSeconds, fitClass) {
  currentPlaylist = items || [];
  currentInterval = intervalSeconds || 5;
  currentFitClass = fitClass;
  currentSlideIndex = 0;
  showNextSlide();
}

function renderMediaElement(data, fitClass, isMuted = false, customStyle = {}) {
  const { type, src, items, interval, text } = data;
  if (type === 'image') {
    imgEl.style.display = 'block'; imgEl.className = `media-elem ${fitClass}`; Object.assign(imgEl.style, customStyle);
    if (imgEl.src !== src && !imgEl.src.endsWith(src)) imgEl.src = src;
  } else if (type === 'slideshow') {
    Object.assign(imgEl.style, customStyle); Object.assign(videoEl.style, customStyle);
    startSlideshow(items, interval, fitClass);
  } else if (type === 'video') {
    videoEl.style.display = 'block'; videoEl.className = `media-elem ${fitClass}`; Object.assign(videoEl.style, customStyle);
    videoEl.loop = true; videoEl.muted = isMuted;
    let targetSrc = src;
    if (targetSrc && targetSrc.includes('/uploads/media_') && !targetSrc.includes('/uploads/tv_audio_')) {
      targetSrc = targetSrc.replace('/uploads/media_', '/uploads/tv_audio_media_');
    }
    if (videoEl.src !== targetSrc && !videoEl.src.endsWith(targetSrc)) { videoEl.src = targetSrc; videoEl.load(); }
    videoEl.play().catch(() => { videoEl.muted = true; videoEl.play().catch(() => {}); });
  } else if (type === 'url') {
    frameEl.style.display = 'block'; frameEl.className = 'media-elem'; Object.assign(frameEl.style, customStyle);
    if (frameEl.src !== src && !frameEl.src.endsWith(src)) frameEl.src = src;
  } else if (type === 'text') {
    textEl.style.display = 'flex'; textEl.textContent = text;
  }
}

function renderState(state) {
  if (!screenId) return;
  if (state.mode === 'mirror') renderMirrorMode(state.mirrorConfig);
  else if (state.mode === 'split') renderSplitMode(state.splitConfig);
  else renderIndividualMode(state.screens[screenId]);
}

function renderMirrorMode(mirrorConfig) {
  screenContainer.className = 'screen-container mode-mirror';
  hideAllMedia();
  if (!mirrorConfig || mirrorConfig.type === 'empty' || (!mirrorConfig.src && !mirrorConfig.text && (!mirrorConfig.items || !mirrorConfig.items.length))) {
    emptyEl.style.display = 'flex'; return;
  }
  emptyEl.style.display = 'none';
  renderMediaElement(mirrorConfig, `fit-${mirrorConfig.fit || 'contain'}`, mirrorConfig.muted || false, { width: '100vw', height: '100vh', transform: 'none' });
}

function renderSplitMode(splitConfig) {
  screenContainer.className = 'screen-container mode-split';
  hideAllMedia();
  if (!splitConfig || splitConfig.type === 'empty' || (!splitConfig.src && !splitConfig.text)) { emptyEl.style.display = 'flex'; return; }
  const { rows, cols, layout, fit, muted } = splitConfig;
  let targetRow = -1, targetCol = -1;
  for (let r = 0; r < layout.length; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      if (layout[r][c] === screenId) { targetRow = r; targetCol = c; break; }
    }
    if (targetRow !== -1) break;
  }
  if (targetRow === -1 || targetCol === -1) { emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';
  const posX = -(targetCol * 100), posY = -(targetRow * 100);
  const shouldMute = targetRow === 0 && targetCol === 0 ? (muted || false) : true;
  renderMediaElement(splitConfig, `fit-${fit || 'cover'}`, shouldMute, {
    width: `${cols * 100}vw`, height: `${rows * 100}vh`, transform: `translate(${posX}vw, ${posY}vh)`
  });
}

function renderIndividualMode(screenData) {
  screenContainer.className = 'screen-container mode-individual';
  hideAllMedia();
  if (!screenData || screenData.type === 'empty' || (!screenData.src && !screenData.text && (!screenData.items || !screenData.items.length))) {
    emptyEl.style.display = 'flex'; return;
  }
  emptyEl.style.display = 'none';
  renderMediaElement(screenData, `fit-${screenData.fit || 'contain'}`, screenData.muted || false, { width: '100vw', height: '100vh', transform: 'none' });
}

window.addEventListener('click', () => { if (videoEl) videoEl.muted = false; });
window.addEventListener('keydown', () => { if (videoEl) videoEl.muted = false; });

initDisplay();
