const socket = (typeof io === 'function') ? io() : { on: () => {}, emit: () => {} };
let screenId = null, currentRoomId = null, currentPin = null, slideTimer = null, currentPlaylist = [], currentSlideIndex = 0, currentFitClass = 'fit-contain', currentlyPlayingSrc = null, activeBlobUrl = null;
let unpairListenerUnsub = null, activeRtcStreamUnsub = null;

const setupOverlay = document.getElementById('setup-overlay'), pinDisplayEl = document.getElementById('display-pin-code');
const badgeEl = document.getElementById('tv-badge'), badgeIdEl = document.getElementById('badge-id'), emptyIdEl = document.getElementById('empty-id');
const screenContainer = document.getElementById('screen-container'), imgEl = document.getElementById('display-image'), videoEl = document.getElementById('display-video');
const streamCanvasEl = document.getElementById('display-stream-canvas'), frameEl = document.getElementById('display-frame'), textEl = document.getElementById('display-text'), emptyEl = document.getElementById('empty-state');
const streamBufferImg = new Image();

function getDisplaySpecs() {
  const w = window.innerWidth || screen.width, h = window.innerHeight || screen.height, gcd = (a, b) => b === 0 ? a : gcd(b, a % b), d = gcd(w, h);
  return { width: w, height: h, resLabel: `${w}x${h}`, aspect: `${w/d}:${h/d}` };
}

async function initDisplay() {
  const urlParams = new URLSearchParams(window.location.search);
  const paramId = urlParams.get('id'), paramRoom = urlParams.get('room');
  const savedId = localStorage.getItem('tv_screen_id'), savedRoom = localStorage.getItem('tv_screen_room');

  if (paramId && paramRoom) { onTvPaired(paramId, paramRoom); return; }
  if (savedId && savedRoom && typeof checkDisplayExists === 'function') {
    const exists = await checkDisplayExists(savedId, savedRoom);
    if (exists) { onTvPaired(savedId, savedRoom); return; }
  }
  unpairThisTv();
}

function showPairingScreen() {
  hideAllMedia();
  if (badgeEl) badgeEl.style.display = 'none';
  if (emptyEl) emptyEl.style.display = 'none';
  if (setupOverlay) setupOverlay.style.display = 'flex';

  currentPin = Math.floor(100000 + Math.random() * 900000).toString();
  if (pinDisplayEl) pinDisplayEl.textContent = `${currentPin.slice(0, 3)} - ${currentPin.slice(3)}`;
  if (typeof listenTvPinPairing === 'function') {
    listenTvPinPairing(currentPin, (assignedId, roomId) => { onTvPaired(assignedId, roomId); });
  }
}

function onTvPaired(assignedId, roomId) {
  screenId = parseInt(assignedId, 10);
  currentRoomId = roomId;

  localStorage.setItem('tv_screen_id', screenId);
  localStorage.setItem('tv_screen_room', currentRoomId);
  if (badgeIdEl) badgeIdEl.textContent = `${screenId} (${roomId.replace('sala_', '#')})`;
  if (badgeEl) badgeEl.style.display = 'flex';
  if (emptyIdEl) emptyIdEl.textContent = screenId;
  if (setupOverlay) setupOverlay.style.display = 'none';
  if (emptyEl) emptyEl.style.display = 'flex';

  registerDisplay();
  if (typeof listenDisplayActive === 'function') {
    if (unpairListenerUnsub) { unpairListenerUnsub(); unpairListenerUnsub = null; }
    unpairListenerUnsub = listenDisplayActive(screenId, currentRoomId, () => unpairThisTv());
  }

  if (typeof listenFirebaseState === 'function') {
    listenFirebaseState(currentRoomId, (state) => { if (state) renderState(state); });
  }
}

function unpairThisTv() {
  if (unpairListenerUnsub) { unpairListenerUnsub(); unpairListenerUnsub = null; }
  if (activeRtcStreamUnsub) { activeRtcStreamUnsub(); activeRtcStreamUnsub = null; }
  if (screenId && currentRoomId && typeof unpairTv === 'function') unpairTv(screenId);
  localStorage.removeItem('tv_screen_id');
  localStorage.removeItem('tv_screen_room');
  screenId = null;
  currentRoomId = null;
  currentlyPlayingSrc = null;
  cleanActiveLocalBlob();
  showPairingScreen();
}

function cleanActiveLocalBlob() {
  if (activeBlobUrl) { try { URL.revokeObjectURL(activeBlobUrl); } catch (e) {} activeBlobUrl = null; }
}

function registerDisplay() {
  const specs = getDisplaySpecs();
  if (typeof reportFirebaseSpecs === 'function' && screenId && currentRoomId) {
    reportFirebaseSpecs(screenId, specs, currentRoomId);
  }
}

function hideAllMedia() {
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
  if (activeRtcStreamUnsub) { activeRtcStreamUnsub(); activeRtcStreamUnsub = null; }
  if (imgEl) imgEl.style.display = 'none';
  if (streamCanvasEl) streamCanvasEl.style.display = 'none';
  if (videoEl) {
    videoEl.style.display = 'none';
    if (videoEl.srcObject) { videoEl.srcObject.getTracks().forEach(t => t.stop()); videoEl.srcObject = null; }
    videoEl.removeAttribute('src');
    videoEl.src = '';
    try { videoEl.pause(); } catch (e) {}
  }
  if (frameEl) frameEl.style.display = 'none';
  if (textEl) { textEl.style.display = 'none'; textEl.textContent = ''; }
  currentlyPlayingSrc = null;
  cleanActiveLocalBlob();
}

function isVideoUrl(url) {
  return /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(url) || (url && (url.startsWith('data:video') || url.startsWith('tvvideo://') || url.startsWith('chunked://')));
}

async function playVideoWithAudio(src, isLoop = true) {
  if (!videoEl || !src) return;
  if (currentlyPlayingSrc === src && !videoEl.paused) return;

  let finalSrc = src;
  if (src.startsWith('tvvideo://') && typeof loadVideoFromFirestore === 'function') {
    cleanActiveLocalBlob();
    finalSrc = await loadVideoFromFirestore(src, currentRoomId);
    activeBlobUrl = finalSrc;
  }
  if (!finalSrc) return;
  currentlyPlayingSrc = src;

  hideAllMedia();
  if (emptyEl) emptyEl.style.display = 'none';

  videoEl.style.display = 'block';
  videoEl.className = `media-elem ${currentFitClass}`;
  videoEl.loop = isLoop;
  videoEl.volume = 1.0;
  videoEl.muted = false;
  videoEl.src = finalSrc;
  videoEl.load();

  const p = videoEl.play();
  if (p !== undefined) {
    p.catch(() => { videoEl.muted = true; videoEl.play().then(() => { setTimeout(() => { videoEl.muted = false; }, 300); }).catch(() => {}); });
  }
}

async function showNextSlide() {
  if (!currentPlaylist || currentPlaylist.length === 0) return;
  if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
  const url = currentPlaylist[currentSlideIndex];
  if (isVideoUrl(url)) {
    if (imgEl) imgEl.style.display = 'none';
    await playVideoWithAudio(url, false);
    videoEl.onended = () => { currentSlideIndex = (currentSlideIndex + 1) % currentPlaylist.length; showNextSlide(); };
  } else {
    if (videoEl) { videoEl.style.display = 'none'; try { videoEl.pause(); } catch (e) {} }
    let finalImg = url;
    if (url.startsWith('tvvideo://') && typeof loadVideoFromFirestore === 'function') finalImg = await loadVideoFromFirestore(url, currentRoomId);
    if (imgEl) {
      imgEl.style.display = 'block'; imgEl.className = `media-elem ${currentFitClass}`;
      if (imgEl.src !== finalImg) imgEl.src = finalImg;
      if (currentPlaylist.length > 1) {
        slideTimer = setTimeout(() => { currentSlideIndex = (currentSlideIndex + 1) % currentPlaylist.length; showNextSlide(); }, Math.max(1, currentInterval || 5) * 1000);
      }
    }
  }
}

function startSlideshow(items, intervalSeconds, fitClass) {
  currentPlaylist = items || []; currentInterval = intervalSeconds || 5; currentFitClass = fitClass; currentSlideIndex = 0; showNextSlide();
}

async function renderMediaElement(data, fitClass, isMuted = false, customStyle = {}) {
  const { type, src, items, interval, text, targetKey } = data || {};
  currentFitClass = fitClass;

  if (type === 'stream') {
    if (imgEl) imgEl.style.display = 'none';
    if (videoEl) videoEl.style.display = 'none';
    if (frameEl) frameEl.style.display = 'none';
    if (textEl) textEl.style.display = 'none';

    if (streamCanvasEl) {
      streamCanvasEl.style.display = 'block';
      streamCanvasEl.className = `media-elem ${fitClass}`;
    }

    const streamKey = targetKey || `screen_${screenId}`;
    if (!activeRtcStreamUnsub && typeof listenTvWebRtcStream === 'function') {
      activeRtcStreamUnsub = listenTvWebRtcStream(streamKey, currentRoomId, (frameData) => {
        if (!frameData) return;
        streamBufferImg.onload = () => {
          if (!streamCanvasEl) return;
          if (streamCanvasEl.width !== streamBufferImg.naturalWidth) streamCanvasEl.width = streamBufferImg.naturalWidth;
          if (streamCanvasEl.height !== streamBufferImg.naturalHeight) streamCanvasEl.height = streamBufferImg.naturalHeight;
          const ctx = streamCanvasEl.getContext('2d');
          ctx.drawImage(streamBufferImg, 0, 0);
          streamCanvasEl.style.display = 'block';
          if (emptyEl) emptyEl.style.display = 'none';
        };
        streamBufferImg.src = frameData;
      }, () => {
        hideAllMedia();
        if (emptyEl) emptyEl.style.display = 'flex';
      });
    }
    return;
  }

  if (activeRtcStreamUnsub) { activeRtcStreamUnsub(); activeRtcStreamUnsub = null; }
  hideAllMedia();

  if (type === 'image' && src) {
    let finalSrc = src;
    if (src.startsWith('tvvideo://') && typeof loadVideoFromFirestore === 'function') finalSrc = await loadVideoFromFirestore(src, currentRoomId);
    if (imgEl) { imgEl.style.display = 'block'; imgEl.className = `media-elem ${fitClass}`; Object.assign(imgEl.style, customStyle); if (imgEl.src !== finalSrc) imgEl.src = finalSrc; }
  } else if (type === 'slideshow') {
    if (imgEl) Object.assign(imgEl.style, customStyle);
    if (videoEl) Object.assign(videoEl.style, customStyle);
    startSlideshow(items, interval, fitClass);
  } else if (type === 'video' && src) {
    Object.assign(videoEl.style, customStyle);
    await playVideoWithAudio(src, true);
    if (isMuted) videoEl.muted = true;
  } else if (type === 'url' && src) {
    if (frameEl) { frameEl.style.display = 'block'; frameEl.className = 'media-elem'; Object.assign(frameEl.style, customStyle); if (frameEl.src !== src) frameEl.src = src; }
  } else if (type === 'text' && text) {
    if (textEl) { textEl.style.display = 'flex'; textEl.textContent = text; }
  }
}

function renderState(state) {
  if (!screenId || !state) return;
  const numId = parseInt(screenId, 10);
  if (state.mode === 'mirror') renderMirrorMode(state.mirrorConfig);
  else if (state.mode === 'split') renderSplitMode(state.splitConfig);
  else {
    const screens = state.screens || {};
    const screenData = screens[numId] || screens[String(numId)] || { type: 'empty' };
    renderIndividualMode(screenData);
  }
}

function renderMirrorMode(mirrorConfig) {
  if (screenContainer) screenContainer.className = 'screen-container mode-mirror';
  if (!mirrorConfig || mirrorConfig.type === 'empty' || (!mirrorConfig.src && !mirrorConfig.text && (!mirrorConfig.items || !mirrorConfig.items.length) && mirrorConfig.type !== 'stream')) {
    hideAllMedia(); if (emptyEl) emptyEl.style.display = 'flex'; return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  renderMediaElement(mirrorConfig, `fit-${mirrorConfig.fit || 'contain'}`, mirrorConfig.muted || false, { width: '100vw', height: '100vh', transform: 'none' });
}

function renderSplitMode(splitConfig) {
  if (screenContainer) screenContainer.className = 'screen-container mode-split';
  if (!splitConfig || splitConfig.type === 'empty' || (!splitConfig.src && !splitConfig.text && splitConfig.type !== 'stream')) {
    hideAllMedia(); if (emptyEl) emptyEl.style.display = 'flex'; return;
  }
  const { rows, cols, layout, fit, muted } = splitConfig;
  let targetRow = -1, targetCol = -1;
  for (let r = 0; r < (layout || []).length; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      if (layout[r][c] === screenId) { targetRow = r; targetCol = c; break; }
    }
    if (targetRow !== -1) break;
  }
  if (targetRow === -1 || targetCol === -1) { hideAllMedia(); if (emptyEl) emptyEl.style.display = 'flex'; return; }
  if (emptyEl) emptyEl.style.display = 'none';
  const posX = -(targetCol * 100), posY = -(targetRow * 100);
  renderMediaElement(splitConfig, `fit-${fit || 'cover'}`, (targetRow === 0 && targetCol === 0 ? (muted || false) : true), {
    width: `${cols * 100}vw`, height: `${rows * 100}vh`, transform: `translate(${posX}vw, ${posY}vh)`
  });
}

function renderIndividualMode(screenData) {
  if (screenContainer) screenContainer.className = 'screen-container mode-individual';
  if (!screenData || screenData.type === 'empty' || (!screenData.src && !screenData.text && (!screenData.items || !screenData.items.length) && screenData.type !== 'stream')) {
    hideAllMedia(); if (emptyEl) emptyEl.style.display = 'flex'; return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  renderMediaElement(screenData, `fit-${screenData.fit || 'contain'}`, screenData.muted || false, { width: '100vw', height: '100vh', transform: 'none' });
}

window.addEventListener('click', () => { if (videoEl) { videoEl.muted = false; videoEl.volume = 1.0; } });
window.addEventListener('keydown', () => { if (videoEl) { videoEl.muted = false; videoEl.volume = 1.0; } });

initDisplay();
