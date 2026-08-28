const defaultState = {
  mode: 'individual',
  mirrorConfig: { type: 'empty', src: null, fit: 'contain', interval: 5, items: [], text: '' },
  splitConfig: { type: 'empty', src: null, rows: 1, cols: 7, layout: [[1, 2, 3, 4, 5, 6, 7]], fit: 'cover', text: '' },
  screens: { 1: { type: 'empty', fit: 'contain' }, 2: { type: 'empty', fit: 'contain' }, 3: { type: 'empty', fit: 'contain' }, 4: { type: 'empty', fit: 'contain' }, 5: { type: 'empty', fit: 'contain' }, 6: { type: 'empty', fit: 'contain' }, 7: { type: 'empty', fit: 'contain' } }
};
let currentState = JSON.parse(JSON.stringify(defaultState)), currentDisplays = [], targetSlideshowScreenId = null, tempIndividualPlaylist = [], tempMirrorPlaylist = [];
let activeStreamScreenId = null;

if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => { regs.forEach(r => r.unregister()); });

function renderUI() {
  const tM = document.getElementById('tab-mirror'), tS = document.getElementById('tab-split'), tI = document.getElementById('tab-individual');
  const vM = document.getElementById('view-mirror'), vS = document.getElementById('view-split'), vI = document.getElementById('view-individual');
  if (tM && tS && tI) { [tM, tS, tI].forEach(t => t.classList.remove('active')); if (currentState.mode === 'mirror') tM.classList.add('active'); else if (currentState.mode === 'split') tS.classList.add('active'); else tI.classList.add('active'); }
  if (vM && vS && vI) { vM.style.display = currentState.mode === 'mirror' ? 'block' : 'none'; vS.style.display = currentState.mode === 'split' ? 'block' : 'none'; vI.style.display = currentState.mode === 'individual' ? 'block' : 'none'; }
  if (currentState.mode === 'mirror') renderMirrorView(); else if (currentState.mode === 'split') renderSplitView(); else renderIndividualView();
  renderDisplaysStatus();
}
function switchMode(mode) { currentState.mode = mode; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
function resetMyRoom() {
  const n = prompt('Ingresa código de sala (vacío para generar una nueva):');
  if (n !== null) {
    if (n.trim()) setAdminRoomId(n);
    else { localStorage.removeItem('tv_admin_room_id'); window.location.reload(); }
  }
}
function renderDisplaysStatus() {
  const container = document.getElementById('displays-status-container'); if (!container) return;
  const myRoom = (typeof getAdminRoomId === 'function') ? getAdminRoomId() : '';
  const displayMap = new Map();
  currentDisplays.forEach(d => { if (d && d.screenId && d.roomId === myRoom) displayMap.set(d.screenId, d); });
  container.innerHTML = '';
  const roomBadge = document.getElementById('header-room-badge');
  if (roomBadge && myRoom) roomBadge.textContent = `🔒 Sala: ${myRoom.replace('sala_', '#')}`;

  for (let id = 1; id <= 7; id++) {
    const disp = displayMap.get(id), isOnline = Boolean(disp && disp.online === true && disp.roomId === myRoom), specs = disp && disp.specs ? disp.specs : null;
    const chip = document.createElement('div');
    chip.className = `status-chip ${isOnline ? 'connected' : 'unpaired'}`;
    chip.style.cursor = isOnline ? 'default' : 'pointer';
    chip.onclick = () => { if (!isOnline) openPairModal(id); };
    let specHtml = isOnline ? (specs ? `${specs.resLabel} (${specs.aspect})` : 'Conectada 🟢') : 'Sin vincular ⚪ (Toca para vincular)';
    chip.innerHTML = `<div class="status-chip-header"><span>📺 TV ${id}</span><div style="display:flex; align-items:center; gap:6px;"><span class="chip-status-dot ${isOnline ? 'online' : ''}"></span>${isOnline ? `<button class="thumb-remove-btn" style="position:static; width:16px; height:16px;" onclick="handleUnpairTv(${id}, event)">✕</button>` : ''}</div></div><span class="spec-tag">${specHtml}</span>`;
    container.appendChild(chip);
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
function getMediaPreviewHtml(src, type) {
  if (type === 'stream') return '<div style="color:#10b981; font-weight:bold; padding:10px;">🔴 Transmitiendo Pantalla en Vivo</div>';
  if (!src) return '<span class="no-img-text">Sin contenido</span>';
  if (src.startsWith('tvvideo://') || src.startsWith('chunked://')) return '<div style="color:#38bdf8; font-weight:bold; padding:10px;">🎬 Video Cargado</div>';
  if (type === 'video' || src.startsWith('data:video')) return `<video src="${src}" muted autoplay loop></video>`;
  return `<img src="${src}">`;
}
function renderMirrorView() {
  const conf = currentState.mirrorConfig || {}, box = document.getElementById('mirror-preview-box'), content = document.getElementById('mirror-preview-content');
  if (!box || !content) return;
  if (conf.type && conf.type !== 'empty' && (conf.src || conf.text || conf.type === 'stream' || (conf.items && conf.items.length))) {
    box.style.display = 'flex';
    if (conf.type === 'slideshow') content.innerHTML = `🎠 Playlist (${(conf.items || []).length} items, ${conf.interval || 5}s)`;
    else if (conf.type === 'url') content.innerHTML = `🌐 ${conf.src}`;
    else if (conf.type === 'text') content.innerHTML = `📢 ${conf.text}`;
    else content.innerHTML = getMediaPreviewHtml(conf.src, conf.type);
  } else box.style.display = 'none';
}
function renderSplitView() {
  const conf = currentState.splitConfig || { cols: 7, layout: [[1,2,3,4,5,6,7]] }, fitSelect = document.getElementById('split-fit');
  if (fitSelect) fitSelect.value = conf.fit || 'cover';
  const grid = document.getElementById('wall-matrix-grid');
  if (grid) {
    grid.style.gridTemplateColumns = `repeat(${conf.cols || 7}, 1fr)`; grid.innerHTML = '';
    (conf.layout || [[1,2,3,4,5,6,7]]).forEach(row => row.forEach(num => {
      const cell = document.createElement('div'); cell.className = 'matrix-cell'; cell.textContent = num ? `TV ${num}` : '-'; grid.appendChild(cell);
    }));
  }
  const box = document.getElementById('split-preview-box'), content = document.getElementById('split-preview-content');
  if (!box || !content) return;
  if (conf.type && conf.type !== 'empty' && (conf.src || conf.text || conf.type === 'stream')) {
    box.style.display = 'flex';
    if (conf.type === 'url') content.innerHTML = `🌐 ${conf.src}`;
    else if (conf.type === 'text') content.innerHTML = `📢 ${conf.text}`;
    else content.innerHTML = getMediaPreviewHtml(conf.src, conf.type);
  } else box.style.display = 'none';
}
function renderIndividualView() {
  const container = document.getElementById('individual-screens-container'); if (!container) return;
  container.innerHTML = '';
  for (let id = 1; id <= 7; id++) {
    const data = (currentState.screens && currentState.screens[id]) ? currentState.screens[id] : { type: 'empty', fit: 'contain' };
    const card = document.createElement('div'); card.className = 'screen-card';
    let previewHtml = `<span class="no-img-text">Sin contenido</span>`;
    if (data.type === 'stream') previewHtml = `<span style="font-weight:bold;color:#10b981;padding:8px;">🔴 Pantalla en Vivo</span>`;
    else if (data.type === 'slideshow') previewHtml = `<span style="font-weight:bold;color:#38bdf8;padding:8px;">🎠 Playlist (${(data.items || []).length} items / ${data.interval || 5}s)</span>`;
    else if (data.type === 'url') previewHtml = `<span class="no-img-text">🌐 ${data.src}</span>`;
    else if (data.type === 'text') previewHtml = `<span style="font-weight:bold;color:#fbbf24;padding:8px;">${data.text}</span>`;
    else if (data.type && data.type !== 'empty') previewHtml = getMediaPreviewHtml(data.src, data.type);

    const isStreaming = data.type === 'stream';
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
        <button class="btn ${isStreaming ? 'btn-danger' : 'btn-primary'}" style="flex:100%;" onclick="toggleScreenShare(${id})">${isStreaming ? '🛑 Detener Transmisión' : '📡 Transmitir Pantalla en Vivo'}</button>
        <input type="file" id="file-screen-${id}" accept="image/*,video/*" style="display:none" onchange="uploadScreenMedia(${id}, this)">
        <button id="btn-file-${id}" class="btn btn-outline" style="flex:1" onclick="document.getElementById('file-screen-${id}').click()">🎬 Archivo</button>
        <button class="btn btn-outline" onclick="openSlideshowModal(${id})">🎠 Playlist [+]</button>
        <button class="btn btn-outline" onclick="promptScreenUrl(${id})">🌐 URL</button>
        <button class="btn btn-outline" onclick="promptScreenText(${id})">📢 Texto</button>
        ${data.type && data.type !== 'empty' ? `<button class="btn-remove" onclick="clearScreenMedia(${id})">🗑</button>` : ''}
      </div>`;
    container.appendChild(card);
  }
}

async function toggleScreenShare(screenId) {
  const targetKey = `screen_${screenId}`;
  if (activeStreamScreenId === screenId) {
    if (typeof stopAdminScreenShare === 'function') stopAdminScreenShare(targetKey);
    activeStreamScreenId = null;
    currentState.screens[screenId] = { type: 'empty', fit: 'contain' };
    renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
    return;
  }
  if (typeof startAdminScreenShare === 'function') {
    const s = await startAdminScreenShare(targetKey, () => {
      activeStreamScreenId = screenId;
      currentState.screens[screenId] = { type: 'stream', targetKey, fit: 'contain' };
      renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
    }, () => {
      activeStreamScreenId = null;
      currentState.screens[screenId] = { type: 'empty', fit: 'contain' };
      renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
    });
  }
}

async function uploadMedia(file, targetKey = 'screen_1', onProgress = () => {}) {
  if (typeof uploadMediaFile === 'function') return await uploadMediaFile(file, targetKey, onProgress);
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
    const isVid = /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(url) || (url && (url.startsWith('data:video') || url.startsWith('tvvideo://') || url.startsWith('chunked://')));
    const card = document.createElement('div'); card.className = 'thumb-card';
    let thumbInner = isVid ? (url.startsWith('tvvideo://') || url.startsWith('chunked://') ? '<span style="font-size:24px;">🎬</span>' : `<video src="${url}" muted></video>`) : `<img src="${url}">`;
    card.innerHTML = `${thumbInner}<span class="thumb-type-tag">${isVid ? '🎬 Video' : '🖼 Foto'}</span><button class="thumb-remove-btn" onclick="${removeFnName}(${idx})">✕</button>`;
    container.appendChild(card);
  });
}
function openSlideshowModal(screenId) {
  targetSlideshowScreenId = screenId;
  const tEl = document.getElementById('modal-tv-id'); if (tEl) tEl.textContent = screenId;
  const existing = currentState.screens ? currentState.screens[screenId] : null;
  tempIndividualPlaylist = (existing && existing.type === 'slideshow' && existing.items) ? [...existing.items] : [];
  const inEl = document.getElementById('modal-slideshow-interval'); if (inEl && existing && existing.interval) inEl.value = existing.interval;
  renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
  const m = document.getElementById('slideshow-modal'); if (m) m.style.display = 'flex';
}
function closeSlideshowModal() { const m = document.getElementById('slideshow-modal'); if (m) m.style.display = 'none'; }
async function handleAppendIndividualFiles(input) {
  if (!input.files || input.files.length === 0) return;
  for (const f of input.files) { const { url } = await uploadMedia(f, `screen_${targetSlideshowScreenId}`); tempIndividualPlaylist.push(url); }
  input.value = ''; renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
}
function removeIndividualPlaylistItem(idx) {
  tempIndividualPlaylist.splice(idx, 1);
  renderThumbnailGrid('modal-playlist-grid', 'modal-playlist-count', tempIndividualPlaylist, 'removeIndividualPlaylistItem');
}
function submitIndividualSlideshow() {
  if (tempIndividualPlaylist.length === 0) return alert('Agrega fotos o videos');
  const inEl = document.getElementById('modal-slideshow-interval'), interval = parseInt(inEl ? inEl.value : '5', 10) || 5;
  currentState.screens[targetSlideshowScreenId] = { type: 'slideshow', items: tempIndividualPlaylist, interval, fit: 'contain' };
  renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
  closeSlideshowModal();
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
  if (activeStreamScreenId === screenId && typeof stopAdminScreenShare === 'function') stopAdminScreenShare(`screen_${screenId}`);
  if (typeof deleteVideoFromFirestore === 'function') deleteVideoFromFirestore(`screen_${screenId}`);
  if (currentState.screens[screenId]) { currentState.screens[screenId] = { type: 'empty', src: null, text: '' }; renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState); }
}
function clearAllScreens() {
  for (let id = 1; id <= 7; id++) { if (typeof deleteVideoFromFirestore === 'function') deleteVideoFromFirestore(`screen_${id}`); }
  if (typeof deleteVideoFromFirestore === 'function') { deleteVideoFromFirestore('mirror'); deleteVideoFromFirestore('split'); }
  currentState = JSON.parse(JSON.stringify(defaultState)); renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
}
function openPairModal(preSelectedTv = '1') {
  const m = document.getElementById('pair-modal'), s = document.getElementById('pair-target-select');
  if (s && preSelectedTv) s.value = preSelectedTv.toString();
  if (m) m.style.display = 'flex';
}
function closePairModal() { const m = document.getElementById('pair-modal'); if (m) m.style.display = 'none'; }
async function submitPairPin() {
  const pinInput = document.getElementById('pin-input'), selectEl = document.getElementById('pair-target-select'), btn = document.getElementById('btn-submit-pair');
  const cleanPin = (pinInput ? pinInput.value : '').replace(/\D/g, ''), targetScreenId = selectEl ? selectEl.value : '1';
  if (!cleanPin || cleanPin.length !== 6) return alert('Ingresa los 6 dígitos del PIN.');
  if (btn) { btn.textContent = '⏳ Vinculando...'; btn.disabled = true; }
  try {
    if (typeof pairTvWithPin === 'function') {
      await pairTvWithPin(cleanPin, targetScreenId, `TV ${targetScreenId}`);
      alert(`🎉 ¡TV ${targetScreenId} vinculada a tu sala!`);
      closePairModal(); if (pinInput) pinInput.value = '';
    }
  } catch (err) { alert('Error: ' + (err.message || 'Fallo')); }
  finally { if (btn) { btn.textContent = 'Vincular Ahora'; btn.disabled = false; } }
}
async function uploadScreenMedia(screenId, input) {
  if (input.files.length > 0) {
    const btn = document.getElementById(`btn-file-${screenId}`);
    if (btn) { btn.textContent = '⏳ 0%...'; btn.disabled = true; }
    try {
      const { url, type } = await uploadMedia(input.files[0], `screen_${screenId}`, (percent) => {
        if (btn) btn.textContent = `⏳ ${percent}%...`;
      });
      currentState.screens[screenId] = { type, src: url, fit: 'contain' };
      renderUI(); if (typeof updateFirebaseState === 'function') updateFirebaseState(currentState);
    } catch (err) { alert('Error al subir: ' + err.message); }
    finally { if (btn) { btn.textContent = '🎬 Archivo'; btn.disabled = false; } input.value = ''; }
  }
}
const myActiveRoom = (typeof getAdminRoomId === 'function') ? getAdminRoomId() : null;
if (typeof listenFirebaseDisplays === 'function' && myActiveRoom) listenFirebaseDisplays(myActiveRoom, (d) => { if (d) { currentDisplays = d; renderDisplaysStatus(); } });
if (typeof listenFirebaseState === 'function' && myActiveRoom) listenFirebaseState(myActiveRoom, (s) => { if (s) { currentState = Object.assign(currentState, s); renderUI(); } });
renderUI();
