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
let storage = null;

function getDb() {
  if (db) return db;
  if (typeof firebase !== 'undefined') {
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      return db;
    } catch (e) {
      console.warn('Firebase init:', e);
    }
  }
  return null;
}

function getStorage() {
  if (storage) return storage;
  if (typeof firebase !== 'undefined') {
    try {
      if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
      storage = firebase.storage();
      return storage;
    } catch (e) {}
  }
  return null;
}

// Inicializar de inmediato si SDK ya cargó
getDb();
getStorage();

// 1. ESCUCHAR CÓDIGO PIN EN LA PANTALLA DE TV
function listenTvPinPairing(pin, onPairedCallback) {
  const fdb = getDb();
  if (!fdb || !pin) return;
  const cleanPin = pin.toString().trim().replace(/\D/g, '');

  console.log(`[TV] Registrando PIN ${cleanPin} en Firestore...`);
  const pinDoc = fdb.collection('tv_pins').doc(cleanPin);

  pinDoc.set({
    pin: cleanPin,
    paired: false,
    assignedScreenId: null,
    createdAt: Date.now()
  }).catch((e) => console.error('Error creando PIN:', e));

  const unsubscribe = pinDoc.onSnapshot((snapshot) => {
    if (!snapshot.exists) return;
    const data = snapshot.data();
    if (data && data.assignedScreenId) {
      console.log(`[TV] PIN ${cleanPin} vinculado a TV ${data.assignedScreenId}`);
      unsubscribe();
      pinDoc.delete().catch(() => {});
      onPairedCallback(data.assignedScreenId);
    }
  }, (err) => console.error('Error escuchando PIN:', err));
}

// 2. VINCULAR PIN DESDE EL PANEL DE CONTROL (CELULAR)
async function pairTvWithPin(pin, targetScreenId, tvName) {
  const fdb = getDb();
  if (!fdb) throw new Error('Firestore no está disponible en este navegador');
  const cleanPin = pin.toString().trim().replace(/\D/g, '');
  const screenNum = parseInt(targetScreenId, 10);

  console.log(`[EMISOR] Vinculando PIN ${cleanPin} a TV ${screenNum}...`);
  const pinDoc = fdb.collection('tv_pins').doc(cleanPin);

  await pinDoc.set({
    pin: cleanPin,
    assignedScreenId: screenNum,
    tvName: tvName || `TV ${screenNum}`,
    paired: true,
    pairedAt: Date.now()
  }, { merge: true });

  await fdb.collection('tv_streamer').doc('displays').set({
    [screenNum]: {
      screenId: screenNum,
      tvName: tvName || `TV ${screenNum}`,
      online: true,
      lastSeen: Date.now()
    }
  }, { merge: true });

  return true;
}

// 3. DESVINCULAR TV
function unpairTv(screenId) {
  const fdb = getDb();
  if (!fdb || !screenId) return;
  const idStr = screenId.toString();
  fdb.collection('tv_streamer').doc('displays').update({
    [`${idStr}.online`]: false
  }).catch(() => {});
  fdb.collection('tv_unpair').doc(idStr).set({ timestamp: Date.now() }).catch(() => {});
}

function listenUnpairSignal(screenId, callback) {
  const fdb = getDb();
  if (!fdb || !screenId) return;
  fdb.collection('tv_unpair').doc(screenId.toString()).onSnapshot((doc) => {
    if (doc.exists) callback();
  }, () => {});
}

// 4. ESTADO DE TRANSMISIÓN
function listenFirebaseState(callback) {
  const fdb = getDb();
  if (!fdb) return;
  fdb.collection('tv_streamer').doc('state').onSnapshot((doc) => {
    if (doc.exists) callback(doc.data());
  }, (err) => console.error('Error state:', err));
}

function updateFirebaseState(newState) {
  const fdb = getDb();
  if (!fdb) return;
  fdb.collection('tv_streamer').doc('state').set(newState, { merge: true }).catch((e) => {
    console.error('Error guardando state:', e);
  });
}

// 5. STORAGE & SPECS
async function uploadToFirebaseStorage(file) {
  const fstorage = getStorage();
  if (!fstorage) throw new Error('Storage no disponible');
  const filename = `media_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const snap = await fstorage.ref().child(`uploads/${filename}`).put(file);
  const url = await snap.ref.getDownloadURL();
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  return { url, type: isVideo ? 'video' : 'image' };
}

function reportFirebaseSpecs(screenId, specs) {
  const fdb = getDb();
  if (!fdb || !screenId) return;
  fdb.collection('tv_streamer').doc('displays').set({
    [screenId]: {
      screenId: parseInt(screenId, 10),
      specs,
      online: true,
      lastSeen: Date.now()
    }
  }, { merge: true }).catch(() => {});
}

function listenFirebaseDisplays(callback) {
  const fdb = getDb();
  if (!fdb) return;
  fdb.collection('tv_streamer').doc('displays').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data() || {};
      callback(Object.values(data));
    }
  }, () => {});
}
