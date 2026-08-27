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

// Compresión rápida de imagen (< 50KB) para transmisión instantánea en Firestore
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

// 1. ESCUCHAR PIN EN TV
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

// 2. VINCULAR PIN DESDE EL EMISOR
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
    if (doc.exists) callback(doc.data());
  }, (err) => console.error('Error state:', err));
}

function updateFirebaseState(newState) {
  const fdb = getDb(); if (!fdb) return;
  fdb.collection('tv_streamer').doc('state').set(newState, { merge: true }).catch((e) => {
    console.error('Error actualizando estado:', e);
  });
}

// 5. SUBIDA ULTRARRÁPIDA DE MEDIOS
async function uploadMediaFile(file) {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  if (!isVideo) {
    const compressedUrl = await compressImage(file, 960, 0.65);
    return { url: compressedUrl, type: 'image' };
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ url: r.result, type: 'video' });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
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
