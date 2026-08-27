const defaultState = {
  mode: 'individual',
  mirrorConfig: { type: 'empty', src: null, fit: 'contain', interval: 5, items: [], text: '' },
  splitConfig: { type: 'empty', src: null, rows: 1, cols: 7, layout: [[1, 2, 3, 4, 5, 6, 7]], fit: 'cover', text: '' },
  screens: { 1: { type: 'empty', fit: 'contain' }, 2: { type: 'empty', fit: 'contain' }, 3: { type: 'empty', fit: 'contain' }, 4: { type: 'empty', fit: 'contain' }, 5: { type: 'empty', fit: 'contain' }, 6: { type: 'empty', fit: 'contain' }, 7: { type: 'empty', fit: 'contain' } }
};
let currentState = JSON.parse(JSON.stringify(defaultState)), currentDisplays = [], targetSlideshowScreenId = null, tempIndividualPlaylist = [], tempMirrorPlaylist = [], deferredInstallPrompt = null;
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstallPrompt = e; const btn = document.getElementById('btn-install-app'); if (btn) btn.style.display = 'inline-flex'; });
function triggerPWAInstall() {
  if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); deferredInstallPrompt.userChoice.then(() => { deferredInstallPrompt = null; document.getElementById('btn-install-app').style.display = 'none'; }); }
  else alert('Abre el menú del navegador y selecciona "Instalar Aplicación".');
}
const statusContainer = document.getElementById('displays-status-container');
const tabMirror = document.getElementById('tab-mirror'), tabSplit = document.getElementById('tab-split'), tabIndividual = document.getElementById('tab-individual');
const viewMirror = document.getElementById('view-mirror'), viewSplit = document.getElementById('view-split'), viewIndividual = document.getElementById('view-individual');
const individualContainer = document.getElementById('individual-screens-container');

if (typeof listenFirebaseDisplays === 'function') listenFirebaseDisplays((d) => { if (d && d.length) { currentDisplays = d; renderDisplaysStatus(); } });
if (typeof listenFirebaseState === 'function') listenFirebaseState((s) => { if (s) { currentState = Object.assign(currentState, s); renderUI(); } });

function renderUI() {
  [tabMirror, tabSplit, tabIndividual].forEach(t => t.classList.remove('active'));
  [viewMirror, viewSplit, viewIndividual].forEach(v => v.style.display = 'none');
  if (currentState.mode === 'mirror') { tabMirror.classList.add('active'); viewMirror.style.display = 'block'; renderMirrorView(); }
  else if (currentState.mode === 'split') { tabSplit.classList.add('active'); viewSplit.style.display = 'block'; renderSplitView(); }
  else { tabIndividual.classList.add('active'); viewIndividual.style.display = 'block'; renderIndividualView(); }
  renderDisplaysStatus();
}
function switchMode(mode) { currentState.mode = mode; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }

function renderDisplaysStatus() {
  const displayMap = new Map();
  currentDisplays.forEach(d => { if (d && d.screenId) displayMap.set(d.screenId, d); });
  statusContainer.innerHTML = '';
  for (let id = 1; id <= 7; id++) {
    const disp = displayMap.get(id), isOnline = disp ? (disp.online !== undefined ? disp.online : true) : false, specs = disp && disp.specs ? disp.specs : null;
    const chip = document.createElement('a'); chip.className = 'status-chip'; chip.href = `/display.html?id=${id}`; chip.target = '_blank';
    let specHtml = isOnline ? (specs ? `${specs.resLabel} (${specs.aspect})` : 'Conectada 🟢') : 'Sin vincular ⚪';
    chip.innerHTML = `<div class="status-chip-header"><span>📺 TV ${id}</span><div style="display:flex; align-items:center; gap:6px;"><span class="chip-status-dot ${isOnline ? 'online' : ''}"></span>${isOnline ? `<button class="thumb-remove-btn" style="position:static; width:16px; height:16px;" onclick="handleUnpairTv(${id}, event)">✕</button>` : ''}</div></div><span class="spec-tag">${specHtml}</span>`;
    statusContainer.appendChild(chip);
  }
}

function handleUnpairTv(screenId, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (confirm(`¿Desvincular TV ${screenId}?`)) {
    if (typeof unpairTv === 'function') unpairTv(screenId);
    currentDisplays = currentDisplays.filter(d => d.screenId !== screenId);
    renderDisplaysStatus();
  }
}

function renderMirrorView() {
  const conf = currentState.mirrorConfig || {}, box = document.getElementById('mirror-preview-box'), content = document.getElementById('mirror-preview-content');
  if (conf.type && conf.type !== 'empty' && (conf.src || conf.text || (conf.items && conf.items.length))) {
    box.style.display = 'flex';
    if (conf.type === 'image') content.innerHTML = `<img src="${conf.src}">`;
    else if (conf.type === 'slideshow') content.innerHTML = `🎠 Playlist (${conf.items.length} items, ${conf.interval}s)`;
    else if (conf.type === 'video') content.innerHTML = `<video src="${conf.src}" muted autoplay loop></video>`;
    else if (conf.type === 'url') content.innerHTML = `🌐 ${conf.src}`;
    else if (conf.type === 'text') content.innerHTML = `📢 ${conf.text}`;
  } else box.style.display = 'none';
}

function renderSplitView() {
  const conf = currentState.splitConfig || { cols: 7, layout: [[1,2,3,4,5,6,7]] };
  document.getElementById('split-fit').value = conf.fit || 'cover';
  const grid = document.getElementById('wall-matrix-grid'); grid.style.gridTemplateColumns = `repeat(${conf.cols || 7}, 1fr)`; grid.innerHTML = '';
  (conf.layout || [[1,2,3,4,5,6,7]]).forEach(row => row.forEach(num => {
    const cell = document.createElement('div'); cell.className = 'matrix-cell'; cell.textContent = num ? `TV ${num}` : '-'; grid.appendChild(cell);
  }));
  const box = document.getElementById('split-preview-box'), content = document.getElementById('split-preview-content');
  if (conf.type && conf.type !== 'empty' && (conf.src || conf.text)) {
    box.style.display = 'flex';
    if (conf.type === 'image') content.innerHTML = `<img src="${conf.src}">`;
    else if (conf.type === 'video') content.innerHTML = `<video src="${conf.src}" muted autoplay loop></video>`;
    else if (conf.type === 'url') content.innerHTML = `🌐 ${conf.src}`;
    else if (conf.type === 'text') content.innerHTML = `📢 ${conf.text}`;
  } else box.style.display = 'none';
}

function renderIndividualView() {
  individualContainer.innerHTML = '';
  for (let id = 1; id <= 7; id++) {
    const data = (currentState.screens && currentState.screens[id]) ? currentState.screens[id] : { type: 'empty', fit: 'contain' };
    const card = document.createElement('div'); card.className = 'screen-card';
    let previewHtml = `<span class="no-img-text">Sin contenido</span>`;
    if (data.type === 'image') previewHtml = `<img src="${data.src}">`;
    else if (data.type === 'slideshow') previewHtml = `<span style="font-weight:bold;color:#38bdf8;padding:8px;">🎠 Playlist (${(data.items || []).length} items / ${data.interval || 5}s)</span>`;
    else if (data.type === 'video') previewHtml = `<video src="${data.src}" muted autoplay loop></video>`;
    else if (data.type === 'url') previewHtml = `<span class="no-img-text">🌐 ${data.src}</span>`;
    else if (data.type === 'text') previewHtml = `<span style="font-weight:bold;color:#fbbf24;padding:8px;">${data.text}</span>`;
    card.innerHTML = `
      <div class="screen-card-header"><span class="screen-title">Pantalla ${id}</span>
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
        ${data.type && data.type !== 'empty' ? `<button class="btn-remove" onclick="clearScreenMedia(${id})">🗑</button>` : ''}
      </div>`;
    individualContainer.appendChild(card);
  }
}

function readFileAsBase64(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); }); }
function checkIsVideo(f) { return (f.type && f.type.startsWith('video/')) || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(f.name || ''); }
async function uploadMedia(file) {
  if (typeof uploadMediaFile === 'function') return await uploadMediaFile(file);
  const isVideo = (file.type && file.type.startsWith('video/')) || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name || '');
  const r = new FileReader();
  return new Promise((res) => { r.onload = () => res({ url: r.result, type: isVideo ? 'video' : 'image' }); r.readAsDataURL(file); });
}


function renderThumbnailGrid(containerId, countId, playlist, removeFnName) {
  const container = document.getElementById(containerId), countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = playlist.length;
  if (!container) return;
  if (playlist.length === 0) { container.innerHTML = `<div class="empty-playlist-msg">Lista vacía. Usa [+] para agregar.</div>`; return; }
  container.innerHTML = '';
  playlist.forEach((url, idx) => {
    const isVid = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(url) || url.startsWith('data:video');
    const card = document.createElement('div'); card.className = 'thumb-card';
    card.innerHTML = `${isVid ? `<video src="${url}" muted></video>` : `<img src="${url}">`}<span class="thumb-type-tag">${isVid ? '🎬 Video' : '🖼 Foto'}</span><button class="thumb-remove-btn" onclick="${removeFnName}(${idx})">✕</button>`;
    container.appendChild(card);
  });
}

function openSlideshowModal(screenId) {
  targetSlideshowScreenId = screenId; document.getElementById('modal-tv-id').textContent = screenId;
  const existing = currentState.screens ? currentState.screens[screenId] : null;
  tempIndividualPlaylist = (existing && existing.type === 'slideshow' && existing.items) ? [...existing.items] : [];
  if (existing && existing.interval) document.getElementById('modal-slideshow-interval').value = existing.interval;
  renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
  document.getElementById('slideshow-modal').style.display = 'flex';
}
function closeSlideshowModal() { document.getElementById('slideshow-modal').style.display = 'none'; }

async function handleAppendIndividualFiles(input) {
  if (!input.files || input.files.length === 0) return;
  for (const f of input.files) { const { url } = await uploadMedia(f); tempIndividualPlaylist.push(url); }
  input.value = ''; renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
}
function removeIndividualPlaylistItem(idx) {
  tempIndividualPlaylist.splice(idx, 1);
  renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
}
function submitIndividualSlideshow() {
  if (tempIndividualPlaylist.length === 0) return alert('Agrega fotos o videos');
  const interval = parseInt(document.getElementById('modal-slideshow-interval').value, 10) || 5;
  currentState.screens[targetSlideshowScreenId] = { type: 'slideshow', items: tempIndividualPlaylist, interval, fit: 'contain' };
  renderUI();
  if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
  closeSlideshowModal();
}

async function handleAppendMirrorFiles(input) {
  if (!input.files || input.files.length === 0) return;
  for (const f of input.files) { const { url } = await uploadMedia(f); tempMirrorPlaylist.push(url); }
  input.value = ''; renderThumbnailGrid('mirror-playlist-grid', 'mirror-playlist-count', tempMirrorPlaylist, 'removeMirrorPlaylistItem');
}
function removeMirrorPlaylistItem(idx) {
  tempMirrorPlaylist.splice(idx, 1);
  renderThumbnailGrid('mirror-playlist-grid', 'mirror-playlist-count', tempMirrorPlaylist, 'removeMirrorPlaylistItem');
}
function sendMirrorSlideshow() {
  if (tempMirrorPlaylist.length === 0) return alert('Agrega fotos o videos');
  const interval = parseInt(document.getElementById('mirror-interval-input').value, 10) || 5;
  currentState.mirrorConfig = { type: 'slideshow', items: tempMirrorPlaylist, interval, fit: 'contain' };
  renderUI();
  if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
}

function setMirrorTab(type) {
  document.querySelectorAll('#view-mirror .subtab-btn').forEach(b => b.classList.remove('active'));
  if (event && event.target) event.target.classList.add('active');
  document.getElementById('mirror-panel-file').style.display = type === 'file' ? 'block' : 'none';
  document.getElementById('mirror-panel-slideshow').style.display = type === 'slideshow' ? 'block' : 'none';
  document.getElementById('mirror-panel-url').style.display = type === 'url' ? 'block' : 'none';
  document.getElementById('mirror-panel-text').style.display = type === 'text' ? 'block' : 'none';
}
document.getElementById('mirror-file-input').addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    const { url, type } = await uploadMedia(e.target.files[0]);
    currentState.mirrorConfig = { type, src: url, fit: 'contain' };
    renderUI();
    if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
  }
});
function sendMirrorUrl() {
  const s = document.getElementById('mirror-url-input').value.trim();
  if (s) { currentState.mirrorConfig = { type: 'url', src: s, fit: 'contain' }; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
}
function sendMirrorText() {
  const t = document.getElementById('mirror-text-input').value.trim();
  if (t) { currentState.mirrorConfig = { type: 'text', text: t, fit: 'contain' }; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
}
function clearMirrorMedia() {
  currentState.mirrorConfig = { type: 'empty', src: null, items: [], text: '' }; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
}

document.getElementById('split-file-input').addEventListener('change', async (e) => {
  if (e.target.files.length > 0) {
    const { url, type } = await uploadMedia(e.target.files[0]);
    currentState.splitConfig.type = type; currentState.splitConfig.src = url;
    renderUI();
    if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
  }
});
function clearSplitMedia() {
  currentState.splitConfig.type = 'empty'; currentState.splitConfig.src = null; currentState.splitConfig.text = '';
  renderUI();
  if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
}
function applySplitPreset() {
  const p = document.getElementById('split-layout-preset').value;
  let rows = 1, cols = 7, layout = [[1, 2, 3, 4, 5, 6, 7]];
  if (p === '7x1') { rows = 7; cols = 1; layout = [[1], [2], [3], [4], [5], [6], [7]]; }
  else if (p === '2x4') { rows = 2; cols = 4; layout = [[1, 2, 3, 4], [5, 6, 7, null]]; }
  currentState.splitConfig.rows = rows; currentState.splitConfig.cols = cols; currentState.splitConfig.layout = layout;
  renderUI();
  if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
}
function updateSplitConfig() {
  currentState.splitConfig.fit = document.getElementById('split-fit').value;
  renderUI();
  if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
}

async function uploadScreenMedia(screenId, input) {
  if (input.files.length > 0) {
    const { url, type } = await uploadMedia(input.files[0]);
    currentState.screens[screenId] = { type, src: url, fit: 'contain' };
    renderUI();
    if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
  }
}
function promptScreenUrl(screenId) {
  const u = prompt('URL:');
  if (u) { currentState.screens[screenId] = { type: 'url', src: u.trim(), fit: 'contain' }; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
}
function promptScreenText(screenId) {
  const t = prompt('Mensaje:');
  if (t) { currentState.screens[screenId] = { type: 'text', text: t.trim(), fit: 'contain' }; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
}
function changeScreenFit(screenId, fit) {
  if (currentState.screens[screenId]) { currentState.screens[screenId].fit = fit; if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
}
function clearScreenMedia(screenId) {
  if (currentState.screens[screenId]) { currentState.screens[screenId] = { type: 'empty', src: null, text: '' }; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
}

function openPairModal() { document.getElementById('pair-modal').style.display = 'flex'; }
function closePairModal() { document.getElementById('pair-modal').style.display = 'none'; }

async function submitPairPin() {
  const pinInput = document.getElementById('pin-input');
  const cleanPin = (pinInput ? pinInput.value : '').replace(/\D/g, '');
  const selectEl = document.getElementById('pair-target-select');
  const targetScreenId = selectEl ? selectEl.value : '1';
  const btn = document.getElementById('btn-submit-pair');

  if (!cleanPin || cleanPin.length !== 6) return alert('Ingresa los 6 dígitos del código PIN de la TV.');
  if (btn) { btn.textContent = '⏳ Vinculando...'; btn.disabled = true; }

  try {
    if (typeof pairTvWithPin === 'function') {
      await pairTvWithPin(cleanPin, targetScreenId, `TV ${targetScreenId}`);
      alert(`🎉 ¡TV ${targetScreenId} vinculada con éxito!`);
      closePairModal();
      if (pinInput) pinInput.value = '';
    }
  } catch (err) {
    console.error('Pair error:', err);
    alert('Error al vincular: ' + (err.message || 'Verifica tu conexión'));
  } finally {
    if (btn) { btn.textContent = 'Vincular Ahora'; btn.disabled = false; }
  }
}

document.getElementById('btn-reload-all').addEventListener('click', () => { if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); window.location.reload(); });
document.getElementById('btn-clear-all').addEventListener('click', () => {
  currentState = JSON.parse(JSON.stringify(defaultState));
  renderUI();
  if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
});

// Renderizar interfaz inmediatamente al cargar
renderUI();
