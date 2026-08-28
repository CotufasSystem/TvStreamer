// Live Screen Streaming Engine via Firestore Real-Time Frame Sync (Zero NAT / Zero TURN dependency)
let localScreenStream = null, streamIntervalId = null, hiddenVideoEl = null, hiddenCanvasEl = null;

// Emisor (Panel de Control - Admin)
async function startAdminScreenShare(targetKey = 'screen_1', onStarted = () => {}, onStopped = () => {}) {
  try {
    if (localScreenStream) stopAdminScreenShare(targetKey);
    try {
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 20 } },
        audio: false
      });
    } catch (e1) {
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    }
  } catch (err) {
    if (err.name !== 'NotAllowedError') alert('Error al capturar pantalla: ' + err.message);
    return null;
  }

  const fdb = getDb(), activeRoom = getAdminRoomId();
  if (!fdb || !activeRoom) return null;

  if (!hiddenVideoEl) {
    hiddenVideoEl = document.createElement('video');
    hiddenVideoEl.autoplay = true;
    hiddenVideoEl.muted = true;
    hiddenVideoEl.playsInline = true;
  }
  hiddenVideoEl.srcObject = localScreenStream;
  await hiddenVideoEl.play().catch(() => {});

  if (!hiddenCanvasEl) hiddenCanvasEl = document.createElement('canvas');
  const ctx = hiddenCanvasEl.getContext('2d', { alpha: false });

  const streamDoc = fdb.collection('rooms').doc(activeRoom).collection('live_stream').doc(targetKey);
  await streamDoc.set({ active: true, updatedAt: Date.now() });

  let isSending = false;
  streamIntervalId = setInterval(async () => {
    if (isSending || !localScreenStream || hiddenVideoEl.videoWidth === 0) return;
    isSending = true;

    try {
      const maxW = 854;
      let w = hiddenVideoEl.videoWidth || 1280;
      let h = hiddenVideoEl.videoHeight || 720;
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }
      hiddenCanvasEl.width = w;
      hiddenCanvasEl.height = h;

      ctx.drawImage(hiddenVideoEl, 0, 0, w, h);
      const frameData = hiddenCanvasEl.toDataURL('image/jpeg', 0.55);

      await streamDoc.set({
        frame: frameData,
        active: true,
        ts: Date.now()
      });
    } catch (e) {
      console.warn('Frame sync error:', e);
    } finally {
      isSending = false;
    }
  }, 100); // ~10 FPS ultra-smooth real-time

  localScreenStream.getVideoTracks()[0].onended = () => {
    stopAdminScreenShare(targetKey);
    onStopped();
  };

  onStarted();
  return localScreenStream;
}

function stopAdminScreenShare(targetKey = 'screen_1') {
  if (streamIntervalId) {
    clearInterval(streamIntervalId);
    streamIntervalId = null;
  }
  if (localScreenStream) {
    localScreenStream.getTracks().forEach(t => t.stop());
    localScreenStream = null;
  }
  if (hiddenVideoEl) {
    hiddenVideoEl.srcObject = null;
  }
  const fdb = getDb(), activeRoom = getAdminRoomId();
  if (fdb && activeRoom) {
    fdb.collection('rooms').doc(activeRoom).collection('live_stream').doc(targetKey).set({
      active: false,
      frame: null,
      ts: Date.now()
    }).catch(() => {});
  }
}

// Receptor (Pantalla TV - Display)
function listenTvWebRtcStream(screenId, roomId, onFrameReceived, onStreamEnded) {
  const fdb = getDb(); if (!fdb || !screenId || !roomId) return () => {};
  const targetKey = screenId.toString().startsWith('screen_') ? screenId : `screen_${screenId}`;

  const unsub = fdb.collection('rooms').doc(roomId).collection('live_stream').doc(targetKey).onSnapshot((snap) => {
    if (!snap.exists) {
      onStreamEnded();
      return;
    }
    const data = snap.data();
    if (!data || !data.active || !data.frame) {
      onStreamEnded();
      return;
    }
    onFrameReceived(data.frame);
  }, (err) => console.warn('Stream listener error:', err));

  return unsub;
}
