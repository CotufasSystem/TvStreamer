const socket = (typeof io === 'function') ? io() : { on: () => {}, emit: () => {} };

let currentState = null, currentDisplays = [], targetSlideshowScreenId = null;
let tempIndividualPlaylist = [], tempMirrorPlaylist = [], deferredInstallPrompt = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredInstallPrompt = e;
  const btn = document.getElementById('btn-install-app');
  if (btn) btn.style.display = 'inline-flex';
});

function triggerPWAInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => { deferredInstallPrompt = null; document.getElementById('btn-install-app').style.display = 'none'; });
  } else {
    alert('Abre el menú del navegador y selecciona "Instalar Aplicación" o "Añadir a pantalla de inicio".');
  }
}

const statusContainer = document.getElementById('displays-status-container');
const tabMirror = document.getElementById('tab-mirror'), tabSplit = document.getElementById('tab-split'), tabIndividual = document.getElementById('tab-individual');
const viewMirror = document.getElementById('view-mirror'), viewSplit = document.getElementById('view-split'), viewIndividual = document.getElementById('view-individual');
const individualContainer = document.getElementById('individual-screens-container');

socket.on('state-update', (state) => { currentState = state; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(state); });
socket.on('displays-update', (displays) => { currentDisplays = displays; renderDisplaysStatus(); });

if (typeof listenFirebaseDisplays === 'function') {
  listenFirebaseDisplays((displays) => { if (displays && displays.length) { currentDisplays = displays; renderDisplaysStatus(); } });
}

function renderUI() {
  if (!currentState) return;
  [tabMirror, tabSplit, tabIndividual].forEach(t => t.classList.remove('active'));
  [viewMirror, viewSplit, viewIndividual].forEach(v => v.style.display = 'none');
  if (currentState.mode === 'mirror') { tabMirror.classList.add('active'); viewMirror.style.display = 'block'; renderMirrorView(); }
  else if (currentState.mode === 'split') { tabSplit.classList.add('active'); viewSplit.style.display = 'block'; renderSplitView(); }
  else { tabIndividual.classList.add('active'); viewIndividual.style.display = 'block'; renderIndividualView(); }
  renderDisplaysStatus();
}

function switchMode(mode) { socket.emit('set-mode', mode); }

function renderDisplaysStatus() {
  const displayMap = new Map();
  currentDisplays.forEach(d => { if (d.screenId) displayMap.set(d.screenId, d); });
  statusContainer.innerHTML = '';

  for (let id = 1; id <= 7; id++) {
    const disp = displayMap.get(id), isOnline = disp ? (disp.online !== undefined ? disp.online : true) : false, specs = disp && disp.specs ? disp.specs : null;
    const chip = document.createElement('a');
    chip.className = 'status-chip'; chip.href = `/display.html?id=${id}`; chip.target = '_blank';
    let specHtml = isOnline ? (specs ? `${specs.resLabel} (${specs.aspect})` : 'Conectada 🟢') : 'Sin vincular ⚪';
    chip.innerHTML = `
      <div class="status-chip-header">
        <span>📺 TV ${id}</span>
        <div style="display:flex; align-items:center; gap:6px;">
          <span class="chip-status-dot ${isOnline ? 'online' : ''}"></span>
          ${isOnline ? `<button class="thumb-remove-btn" style="position:static; width:16px; height:16px;" onclick="handleUnpairTv(${id}, event)" title="Desvincular TV">✕</button>` : ''}
        </div>
      </div>
      <span class="spec-tag">${specHtml}</span>
    `;
    statusContainer.appendChild(chip);
  }
}

function handleUnpairTv(screenId, e) {
  e.preventDefault(); e.stopPropagation();
  if (confirm(`¿Desvincular TV ${screenId}? La pantalla volverá a mostrar un código nuevo.`)) {
    if (typeof unpairTv === 'function') unpairTv(screenId);
    socket.emit('clear-screens', screenId);
  }
}

function renderMirrorView() {
  const conf = currentState.mirrorConfig, box = document.getElementById('mirror-preview-box'), content = document.getElementById('mirror-preview-content');
  if (conf.type !== 'empty' && (conf.src || conf.text || (conf.items && conf.items.length))) {
    box.style.display = 'flex';
    if (conf.type === 'image') content.innerHTML = `<img src="${conf.src}">`;
    else if (conf.type === 'slideshow') content.innerHTML = `🎠 Playlist (${conf.items.length} items, ${conf.interval}s)`;
    else if (conf.type === 'video') content.innerHTML = `<video src="${conf.src}" muted autoplay loop></video>`;
    else if (conf.type === 'url') content.innerHTML = `🌐 ${conf.src}`;
    else if (conf.type === 'text') content.innerHTML = `📢 ${conf.text}`;
  } else { box.style.display = 'none'; }
}

function renderSplitView() {
  const conf = currentState.splitConfig;
  document.getElementById('split-fit').value = conf.fit || 'cover';
  const grid = document.getElementById('wall-matrix-grid');
  grid.style.gridTemplateColumns = `repeat(${conf.cols}, 1fr)`;
  grid.innerHTML = '';
  conf.layout.forEach(row => row.forEach(num => {
    const cell = document.createElement('div');
    cell.className = 'matrix-cell'; cell.textContent = num ? `TV ${num}` : '-';
    grid.appendChild(cell);
  }));
  const box = document.getElementById('split-preview-box'), content = document.getElementById('split-preview-content');
  if (conf.type !== 'empty' && (conf.src || conf.text)) {
    box.style.display = 'flex';
    if (conf.type === 'image') content.innerHTML = `<img src="${conf.src}">`;
    else if (conf.type === 'video') content.innerHTML = `<video src="${conf.src}" muted autoplay loop></video>`;
    else if (conf.type === 'url') content.innerHTML = `🌐 ${conf.src}`;
    else if (conf.type === 'text') content.innerHTML = `📢 ${conf.text}`;
  } else { box.style.display = 'none'; }
}

function renderIndividualView() {
  individualContainer.innerHTML = '';
  for (let id = 1; id <= 7; id++) {
    const data = currentState.screens[id] || { type: 'empty', fit: 'contain' };
    const card = document.createElement('div');
    card.className = 'screen-card';
    let previewHtml = `<span class="no-img-text">Sin contenido</span>`;
    if (data.type === 'image') previewHtml = `<img src="${data.src}">`;
    else if (data.type === 'slideshow') previewHtml = `<span style="font-weight:bold;color:#38bdf8;padding:8px;">🎠 Playlist (${data.items.length} items / ${data.interval}s)</span>`;
    else if (data.type === 'video') previewHtml = `<video src="${data.src}" muted autoplay loop></video>`;
    else if (data.type === 'url') previewHtml = `<span class="no-img-text">🌐 ${data.src}</span>`;
    else if (data.type === 'text') previewHtml = `<span style="font-weight:bold;color:#fbbf24;padding:8px;">${data.text}</span>`;

    card.innerHTML = `
      <div class="screen-card-header">
        <span class="screen-title">Pantalla ${id}</span>
        <select onchange="changeScreenFit(${id}, this.value)">
          <option value="contain" ${data.fit === 'contain' ? 'selected' : ''}>Contain</option>
          <option value="cover" ${data.fit === 'cover' ? 'selected' : ''}>Cover</option>
          <option value="fill" ${data.fit === 'fill' ? 'selected' : ''}>Fill</option>
        </select>
      </div>
      <div class="screen-preview-box">${previewHtml}</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <input type="file" id="file-screen-${id}" accept="image/*,video/*" style="display:none" onchange="uploadScreenMedia(${id}, this)">
        <button class="btn btn-outline" style="flex:1" onclick="document.getElementById('file-screen-${id}').click()">🎬 Archivo</button>
        <button class="btn btn-outline" onclick="openSlideshowModal(${id})">🎠 Playlist [+]</button>
        <button class="btn btn-outline" onclick="promptScreenUrl(${id})">🌐 URL</button>
        <button class="btn btn-outline" onclick="promptScreenText(${id})">📢 Texto</button>
        ${data.type !== 'empty' ? `<button class="btn-remove" onclick="clearScreenMedia(${id})">🗑</button>` : ''}
      </div>
    `;
    individualContainer.appendChild(card);
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
  });
}
function checkIsVideo(file) { return (file.type && file.type.startsWith('video/')) || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name || ''); }
async function uploadMedia(file) {
  if (typeof uploadToFirebaseStorage === 'function') {
    try { return await uploadToFirebaseStorage(file); } catch (e) {}
  }
  const isVideo = checkIsVideo(file), base64Data = await readFileAsBase64(file);
  const res = await fetch('/api/upload-base64', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: base64Data, filename: file.name, isVideo })
  });
  if (!res.ok) throw new Error('Error subiendo');
  return await res.json();
}

function renderThumbnailGrid(containerId, countId, playlist, removeFnName) {
  const container = document.getElementById(containerId), countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = playlist.length;
  if (!container) return;
  if (playlist.length === 0) { container.innerHTML = `<div class="empty-playlist-msg">Lista vacía. Usa [+] para agregar.</div>`; return; }
  container.innerHTML = '';
  playlist.forEach((url, idx) => {
    const isVid = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(url) || url.includes('/uploads/tv_audio_');
    const card = document.createElement('div');
    card.className = 'thumb-card';
    card.innerHTML = `${isVid ? `<video src="${url}" muted></video>` : `<img src="${url}">`}<span class="thumb-type-tag">${isVid ? '🎬 Video' : '🖼 Foto'}</span><button class="thumb-remove-btn" onclick="${removeFnName}(${idx})">✕</button>`;
    container.appendChild(card);
  });
}

function openSlideshowModal(screenId) {
  targetSlideshowScreenId = screenId;
  document.getElementById('modal-tv-id').textContent = screenId;
  const existing = currentState.screens[screenId];
  tempIndividualPlaylist = (existing && existing.type === 'slideshow' && existing.items) ? [...existing.items] : [];
  if (existing && existing.interval) document.getElementById('modal-slideshow-interval').value = existing.interval;
  renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
  document.getElementById('slideshow-modal').style.display = 'flex';
}
function closeSlideshowModal() { document.getElementById('slideshow-modal').style.display = 'none'; }

async function handleAppendIndividualFiles(input) {
  if (!input.files || input.files.length === 0) return;
  for (const f of input.files) { const { url } = await uploadMedia(f); tempIndividualPlaylist.push(url); }
  input.value = '';
  renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
}
function removeIndividualPlaylistItem(idx) {
  tempIndividualPlaylist.splice(idx, 1);
  renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
}
function submitIndividualSlideshow() {
  if (tempIndividualPlaylist.length === 0) return alert('Agrega fotos o videos');
  const interval = parseInt(document.getElementById('modal-slideshow-interval').value, 10) || 5;
  socket.emit('update-screen', { screenId: targetSlideshowScreenId, type: 'slideshow', items: tempIndividualPlaylist, interval });
  closeSlideshowModal();
}

async function handleAppendMirrorFiles(input) {
  if (!input.files || input.files.length === 0) return;
  for (const f of input.files) { const { url } = await uploadMedia(f); tempMirrorPlaylist.push(url); }
  input.value = '';
  renderThumbnailGrid('mirror-playlist-grid', 'mirror-playlist-count', tempMirrorPlaylist, 'removeMirrorPlaylistItem');
}
function removeMirrorPlaylistItem(idx) {
  tempMirrorPlaylist.splice(idx, 1);
  renderThumbnailGrid('mirror-playlist-grid', 'mirror-playlist-count', tempMirrorPlaylist, 'removeMirrorPlaylistItem');
}
function sendMirrorSlideshow() {
  if (tempMirrorPlaylist.length === 0) return alert('Agrega fotos o videos');
  const interval = parseInt(document.getElementById('mirror-interval-input').value, 10) || 5;
  socket.emit('update-mirror', { type: 'slideshow', items: tempMirrorPlaylist, interval });
}

function setMirrorTab(type) {
  document.querySelectorAll('#view-mirror .subtab-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.getElementById('mirror-panel-file').style.display = type === 'file' ? 'block' : 'none';
  document.getElementById('mirror-panel-slideshow').style.display = type === 'slideshow' ? 'block' : 'none';
  document.getElementById('mirror-panel-url').style.display = type === 'url' ? 'block' : 'none';
  document.getElementById('mirror-panel-text').style.display = type === 'text' ? 'block' : 'none';
}
document.getElementById('mirror-file-input').addEventListener('change', async (e) => {
  if (e.target.files.length > 0) { const { url, type } = await uploadMedia(e.target.files[0]); socket.emit('update-mirror', { type, src: url }); }
});
function sendMirrorUrl() { const s = document.getElementById('mirror-url-input').value.trim(); if (s) socket.emit('update-mirror', { type: 'url', src: s }); }
function sendMirrorText() { const t = document.getElementById('mirror-text-input').value.trim(); if (t) socket.emit('update-mirror', { type: 'text', text: t }); }
function clearMirrorMedia() { socket.emit('update-mirror', { type: 'empty', src: null, items: [], text: '' }); }

document.getElementById('split-file-input').addEventListener('change', async (e) => {
  if (e.target.files.length > 0) { const { url, type } = await uploadMedia(e.target.files[0]); socket.emit('update-split', { type, src: url }); }
});
function clearSplitMedia() { socket.emit('update-split', { type: 'empty', src: null, text: '' }); }
function applySplitPreset() {
  const p = document.getElementById('split-layout-preset').value;
  let rows = 1, cols = 7, layout = [[1, 2, 3, 4, 5, 6, 7]];
  if (p === '7x1') { rows = 7; cols = 1; layout = [[1], [2], [3], [4], [5], [6], [7]]; }
  else if (p === '2x4') { rows = 2; cols = 4; layout = [[1, 2, 3, 4], [5, 6, 7, null]]; }
  socket.emit('update-split', { rows, cols, layout });
}
function updateSplitConfig() { socket.emit('update-split', { fit: document.getElementById('split-fit').value }); }

async function uploadScreenMedia(screenId, input) {
  if (input.files.length > 0) { const { url, type } = await uploadMedia(input.files[0]); socket.emit('update-screen', { screenId, type, src: url }); }
}
function promptScreenUrl(screenId) { const u = prompt('URL:'); if (u) socket.emit('update-screen', { screenId, type: 'url', src: u.trim() }); }
function promptScreenText(screenId) { const t = prompt('Mensaje:'); if (t) socket.emit('update-screen', { screenId, type: 'text', text: t.trim() }); }
function changeScreenFit(screenId, fit) { socket.emit('update-screen', { screenId, fit }); }
function clearScreenMedia(screenId) { socket.emit('clear-screens', screenId); }

function openPairModal() { document.getElementById('pair-modal').style.display = 'flex'; }
function closePairModal() { document.getElementById('pair-modal').style.display = 'none'; }
async function submitPairPin() {
  const pinInput = document.getElementById('pin-input');
  const cleanPin = pinInput.value.replace(/\D/g, '');
  const targetScreenId = document.getElementById('pair-target-select').value;
  const btn = event.target;

  if (!cleanPin || cleanPin.length !== 6) {
    return alert('Por favor ingresa los 6 dígitos del código PIN (Ej: 211119).');
  }

  const oldText = btn.textContent;
  btn.textContent = '⏳ Vinculando...';
  btn.disabled = true;

  try {
    if (typeof pairTvWithPin === 'function') {
      await pairTvWithPin(cleanPin, targetScreenId, `TV ${targetScreenId}`);
      alert(`🎉 ¡TV ${targetScreenId} vinculada con éxito!`);
      closePairModal();
      pinInput.value = '';
      return;
    }
  } catch (err) {
    console.warn('Pair error:', err);
    alert(err.message || 'Error al vincular con Firebase');
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}


document.getElementById('btn-reload-all').addEventListener('click', () => socket.emit('reload-displays'));
document.getElementById('btn-clear-all').addEventListener('click', () => socket.emit('clear-screens', 'all'));
