const firebaseConfig = {
  apiKey: "AIzaSyBc-USadbOqE8pWBsTvkkUW5yUTS53JloQ",
  authDomain: "tvstreamer-57955.firebaseapp.com",
  projectId: "tvstreamer-57955",
  storageBucket: "tvstreamer-57955.firebasestorage.app",
  messagingSenderId: "109918885056",
  appId: "1:109918885056:web:4221829d527f76c4edc925",
  measurementId: "G-7M2LLSD5G6"
};

let db = null, storage = null, isFirebaseReady = false;

if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
    isFirebaseReady = true;
    console.log('[FIREBASE] Firestore Cloud inicializado.');
  } catch (err) {
    console.error('[FIREBASE] Error inicializando SDK:', err);
  }
}

// 1. ESCUCHAR VINCULACIÓN DE PIN EN LA TV
function listenTvPinPairing(pin, onPairedCallback) {
  if (!isFirebaseReady || !db || !pin) return;
  const cleanPin = pin.trim().replace(/\D/g, '');

  try {
    // Registrar PIN activo en Firestore
    db.collection('tv_pins').doc(cleanPin).set({
      pin: cleanPin,
      status: 'waiting',
      createdAt: Date.now()
    }, { merge: true });

    // Escuchar en tiempo real si el emisor asigna una pantalla
    const unsubscribe = db.collection('tv_pins').doc(cleanPin).onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        if (data && data.assignedScreenId) {
          unsubscribe();
          db.collection('tv_pins').doc(cleanPin).delete().catch(() => {});
          onPairedCallback(data.assignedScreenId);
        }
      }
    }, (err) => console.error('[FIREBASE] Error escuchando PIN:', err));
  } catch (e) {
    console.error('[FIREBASE] Excepción al registrar PIN:', e);
  }
}

// 2. VINCULAR PIN DESDE EL EMISOR (CELULAR)
async function pairTvWithPin(pin, targetScreenId, tvName) {
  if (!isFirebaseReady || !db) throw new Error('Firebase Firestore no está conectado');
  const cleanPin = pin.trim().replace(/\D/g, '');
  const screenNum = parseInt(targetScreenId, 10);

  // Escribir asignación de pantalla en el documento del PIN
  await db.collection('tv_pins').doc(cleanPin).set({
    assignedScreenId: screenNum,
    tvName: tvName || `TV ${screenNum}`,
    pairedAt: Date.now(),
    status: 'paired'
  }, { merge: true });

  // Registrar TV activa en la lista global de pantallas
  await db.collection('tv_streamer').doc('displays').set({
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
  if (!isFirebaseReady || !db || !screenId) return;
  const idStr = screenId.toString();
  db.collection('tv_streamer').doc('displays').update({
    [`${idStr}.online`]: false
  }).catch(() => {});
  db.collection('tv_unpair').doc(idStr).set({ timestamp: Date.now() }).catch(() => {});
}

function listenUnpairSignal(screenId, callback) {
  if (!isFirebaseReady || !db || !screenId) return;
  db.collection('tv_unpair').doc(screenId.toString()).onSnapshot((doc) => {
    if (doc.exists) callback();
  }, () => {});
}

// 4. ESTADO DE TRANSMISIÓN MULTIMEDIA
function listenFirebaseState(callback) {
  if (!isFirebaseReady || !db) return;
  db.collection('tv_streamer').doc('state').onSnapshot((doc) => {
    if (doc.exists) callback(doc.data());
  }, (err) => console.error('[FIREBASE] Error escuchando state:', err));
}

function updateFirebaseState(newState) {
  if (!isFirebaseReady || !db) return;
  db.collection('tv_streamer').doc('state').set(newState, { merge: true }).catch((err) => {
    console.error('[FIREBASE] Error guardando state:', err);
  });
}

// 5. SUBIDA A FIREBASE STORAGE
async function uploadToFirebaseStorage(file) {
  if (!isFirebaseReady || !storage) throw new Error('Storage no disponible');
  const filename = `media_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const snap = await storage.ref().child(`uploads/${filename}`).put(file);
  const url = await snap.ref.getDownloadURL();
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  return { url, type: isVideo ? 'video' : 'image' };
}

// 6. ESPECIFICACIONES DE PANTALLA Y PRESENCIA
function reportFirebaseSpecs(screenId, specs) {
  if (!isFirebaseReady || !db || !screenId) return;
  db.collection('tv_streamer').doc('displays').set({
    [screenId]: {
      screenId: parseInt(screenId, 10),
      specs,
      online: true,
      lastSeen: Date.now()
    }
  }, { merge: true }).catch(() => {});
}

function listenFirebaseDisplays(callback) {
  if (!isFirebaseReady || !db) return;
  db.collection('tv_streamer').doc('displays').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data() || {};
      callback(Object.values(data));
    }
  }, () => {});
}
