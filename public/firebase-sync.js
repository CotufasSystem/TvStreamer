const firebaseConfig = {
  apiKey: "AIzaSyBc-USadbOqE8pWBsTvkkUW5yUTS53JloQ",
  authDomain: "tvstreamer-57955.firebaseapp.com",
  projectId: "tvstreamer-57955",
  storageBucket: "tvstreamer-57955.firebasestorage.app",
  messagingSenderId: "109918885056",
  appId: "1:109918885056:web:4221829d527f76c4edc925",
  measurementId: "G-7M2LLSD5G6"
};

let db = null;

function getDb() {
  if (db) return db;
  if (typeof firebase !== 'undefined') {
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      return db;
    } catch (e) { console.warn('Firebase init:', e); }
  }
  return null;
}
getDb();

function compressImage(file, maxDimension = 960, quality = 0.65) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDimension || h > maxDimension) {
          if (w > h) { h = Math.round((h * maxDimension) / w); w = maxDimension; }
          else { w = Math.round((w * maxDimension) / h); h = maxDimension; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// 1. PIN EN TV
function listenTvPinPairing(pin, onPairedCallback) {
  const fdb = getDb(); if (!fdb || !pin) return;
  const cleanPin = pin.toString().trim().replace(/\D/g, '');
  const pinDoc = fdb.collection('tv_pins').doc(cleanPin);
  pinDoc.set({ pin: cleanPin, paired: false, createdAt: Date.now() }).catch(() => {});
  const unsub = pinDoc.onSnapshot((snap) => {
    if (!snap.exists) return;
    const data = snap.data();
    if (data && data.assignedScreenId) {
      unsub(); pinDoc.delete().catch(() => {});
      onPairedCallback(data.assignedScreenId);
    }
  }, () => {});
}

// 2. VINCULAR PIN
async function pairTvWithPin(pin, targetScreenId, tvName) {
  const fdb = getDb(); if (!fdb) throw new Error('Firestore no disponible');
  const cleanPin = pin.toString().trim().replace(/\D/g, ''), screenNum = parseInt(targetScreenId, 10);
  await fdb.collection('tv_pins').doc(cleanPin).set({
    pin: cleanPin, assignedScreenId: screenNum, tvName: tvName || `TV ${screenNum}`, paired: true, pairedAt: Date.now()
  }, { merge: true });
  await fdb.collection('tv_streamer').doc('displays').set({
    [screenNum]: { screenId: screenNum, tvName: tvName || `TV ${screenNum}`, online: true, lastSeen: Date.now() }
  }, { merge: true });
  return true;
}

// 3. DESVINCULAR
function unpairTv(screenId) {
  const fdb = getDb(); if (!fdb || !screenId) return;
  fdb.collection('tv_streamer').doc('displays').update({ [`${screenId}.online`]: false }).catch(() => {});
  fdb.collection('tv_unpair').doc(screenId.toString()).set({ timestamp: Date.now() }).catch(() => {});
}

function listenUnpairSignal(screenId, callback) {
  const fdb = getDb(); if (!fdb || !screenId) return;
  fdb.collection('tv_unpair').doc(screenId.toString()).onSnapshot((doc) => { if (doc.exists) callback(); }, () => {});
}

// 4. ESTADO MULTIMEDIA
function listenFirebaseState(callback) {
  const fdb = getDb(); if (!fdb) return;
  fdb.collection('tv_streamer').doc('state').onSnapshot((doc) => {
    if (!doc.exists) return;
    const data = doc.data();
    if (data && data.payload) {
      try { callback(JSON.parse(data.payload)); } catch (e) {}
    } else if (data) callback(data);
  }, (err) => console.error('Error state:', err));
}

function updateFirebaseState(newState) {
  const fdb = getDb(); if (!fdb) return;
  try {
    fdb.collection('tv_streamer').doc('state').set({
      payload: JSON.stringify(newState),
      updatedAt: Date.now()
    }).catch((e) => console.error('Error actualizando estado:', e));
  } catch (err) { console.error('Error serializando:', err); }
}

// 5. SUBIDA ULTRARRÁPIDA PARALELA
function readChunkAsBase64(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1] || r.result);
    r.readAsDataURL(blob);
  });
}

async function uploadMediaFile(file) {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  if (!isVideo) {
    const compressedUrl = await compressImage(file, 960, 0.65);
    return { url: compressedUrl, type: 'image' };
  }

  // Si el video pesa menos de 800KB, enviar como Data URL directo sin chunking
  if (file.size < 800 * 1024) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ url: r.result, type: 'video' });
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Videos mayores: subida paralela simultánea con chunks de 850KB
  const fdb = getDb();
  if (!fdb) throw new Error('Firestore no disponible');
  const CHUNK_SIZE = 850 * 1024;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const mediaId = `vid_${Date.now()}_${Math.floor(Math.random()*1000)}`;


  const uploadPromises = [];
  for (let i = 0; i < totalChunks; i++) {
    const slice = file.slice(i * CHUNK_SIZE, Math.min(file.size, (i + 1) * CHUNK_SIZE));
    uploadPromises.push((async (idx, sl) => {
      const base64Chunk = await readChunkAsBase64(sl);
      await fdb.collection('tv_chunks').doc(`${mediaId}_${idx}`).set({
        data: base64Chunk, index: idx, total: totalChunks, type: file.type || 'video/mp4'
      });
    })(i, slice));
  }

  await Promise.all(uploadPromises);
  const chunkedUri = `chunked://${mediaId}?total=${totalChunks}&type=${encodeURIComponent(file.type || 'video/mp4')}`;
  return { url: chunkedUri, type: 'video' };
}

async function resolveChunkedMedia(chunkedUrl) {
  const fdb = getDb();
  if (!fdb || !chunkedUrl || !chunkedUrl.startsWith('chunked://')) return chunkedUrl;
  const match = chunkedUrl.match(/chunked:\/\/([^?]+)\?total=(\d+)&type=([^&]+)/);
  if (!match) return chunkedUrl;

  const mediaId = match[1], total = parseInt(match[2], 10), mimeType = decodeURIComponent(match[3]);
  const promises = [];
  for (let i = 0; i < total; i++) {
    promises.push(fdb.collection('tv_chunks').doc(`${mediaId}_${i}`).get());
  }

  const docs = await Promise.all(promises);
  const arrayBuffers = await Promise.all(docs.map(async (doc) => {
    if (!doc.exists) throw new Error('Chunk not found');
    const b64 = doc.data().data;
    const res = await fetch(`data:${mimeType};base64,${b64}`);
    return await res.arrayBuffer();
  }));

  const blob = new Blob(arrayBuffers, { type: mimeType });
  return URL.createObjectURL(blob);
}

function reportFirebaseSpecs(screenId, specs) {
  const fdb = getDb(); if (!fdb || !screenId) return;
  fdb.collection('tv_streamer').doc('displays').set({
    [screenId]: { screenId: parseInt(screenId, 10), specs, online: true, lastSeen: Date.now() }
  }, { merge: true }).catch(() => {});
}

function listenFirebaseDisplays(callback) {
  const fdb = getDb(); if (!fdb) return;
  fdb.collection('tv_streamer').doc('displays').onSnapshot((doc) => {
    if (doc.exists) callback(Object.values(doc.data() || {}));
  }, () => {});
}
