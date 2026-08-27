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
  deleteVideoFromFirestore(screenId);
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

// 5. SUBIDA Y CARGA DE VIDEOS EN COLECCIÓN 'tv_videos'
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1] || r.result);
    r.readAsDataURL(blob);
  });
}

async function uploadVideoToFirestore(file, targetKey = 'screen_1', onProgress = () => {}) {
  const fdb = getDb();
  if (!fdb) throw new Error('Firestore no conectado');
  const CHUNK_SIZE = 800 * 1024;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const videoId = `vid_${Date.now()}`;

  await fdb.collection('tv_videos').doc(targetKey).set({
    videoId, totalChunks, mimeType: file.type || 'video/mp4', size: file.size, name: file.name, createdAt: Date.now()
  });

  let completed = 0;
  const uploadPromises = [];
  for (let i = 0; i < totalChunks; i++) {
    const slice = file.slice(i * CHUNK_SIZE, Math.min(file.size, (i + 1) * CHUNK_SIZE));
    uploadPromises.push((async (idx, sl) => {
      const b64 = await blobToBase64(sl);
      await fdb.collection('tv_videos').doc(targetKey).collection('chunks').doc(`part_${idx}`).set({
        data: b64, index: idx
      });
      completed++;
      onProgress(Math.round((completed / totalChunks) * 100));
    })(i, slice));
  }

  await Promise.all(uploadPromises);
  return `tvvideo://${targetKey}?id=${videoId}`;
}

async function loadVideoFromFirestore(videoUri) {
  const fdb = getDb();
  if (!fdb || !videoUri || !videoUri.startsWith('tvvideo://')) return videoUri;
  const targetKey = videoUri.replace('tvvideo://', '').split('?')[0];

  const mainDoc = await fdb.collection('tv_videos').doc(targetKey).get();
  if (!mainDoc.exists) return null;
  const meta = mainDoc.data();

  const chunkPromises = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    chunkPromises.push(fdb.collection('tv_videos').doc(targetKey).collection('chunks').doc(`part_${i}`).get());
  }

  const chunkDocs = await Promise.all(chunkPromises);
  const arrayBuffers = await Promise.all(chunkDocs.map(async (doc) => {
    if (!doc.exists) throw new Error('Fragmento no encontrado');
    const b64 = doc.data().data;
    const res = await fetch(`data:${meta.mimeType};base64,${b64}`);
    return await res.arrayBuffer();
  }));

  const blob = new Blob(arrayBuffers, { type: meta.mimeType });
  return URL.createObjectURL(blob);
}

async function deleteVideoFromFirestore(targetKey) {
  const fdb = getDb();
  if (!fdb || !targetKey) return;
  const key = targetKey.toString().startsWith('screen_') ? targetKey : `screen_${targetKey}`;
  try {
    const mainDoc = await fdb.collection('tv_videos').doc(key).get();
    if (mainDoc.exists) {
      const meta = mainDoc.data();
      const delPromises = [];
      for (let i = 0; i < (meta.totalChunks || 0); i++) {
        delPromises.push(fdb.collection('tv_videos').doc(key).collection('chunks').doc(`part_${i}`).delete());
      }
      await Promise.all(delPromises);
      await fdb.collection('tv_videos').doc(key).delete();
    }
  } catch (e) {}
}

async function uploadMediaFile(file, targetKey = 'screen_1', onProgress = () => {}) {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  if (!isVideo) {
    const compressedUrl = await compressImage(file, 960, 0.65);
    return { url: compressedUrl, type: 'image' };
  }
  const videoUri = await uploadVideoToFirestore(file, targetKey, onProgress);
  return { url: videoUri, type: 'video' };
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
