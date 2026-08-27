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
let isFirebaseReady = false;

if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
    isFirebaseReady = true;
    console.log('✅ [FIREBASE] Firestore Cloud conectado correctamente.');
  } catch (err) {
    console.error('❌ [FIREBASE] Error al inicializar:', err);
  }
}

// 1. ESCUCHAR CÓDIGO PIN EN LA PANTALLA DE TV
function listenTvPinPairing(pin, onPairedCallback) {
  if (!isFirebaseReady || !db || !pin) return;
  const cleanPin = pin.toString().trim().replace(/\D/g, '');

  console.log(`📡 [TV] Registrando PIN ${cleanPin} en Firestore...`);
  const pinDoc = db.collection('tv_pins').doc(cleanPin);

  pinDoc.set({
    pin: cleanPin,
    paired: false,
    assignedScreenId: null,
    createdAt: Date.now()
  }).catch((e) => console.error('Error creando PIN en Firestore:', e));

  const unsubscribe = pinDoc.onSnapshot((snapshot) => {
    if (!snapshot.exists) return;
    const data = snapshot.data();
    if (data && data.assignedScreenId) {
      console.log(`🎉 [TV] ¡PIN ${cleanPin} vinculado a Pantalla ${data.assignedScreenId}!`);
      unsubscribe();
      pinDoc.delete().catch(() => {});
      onPairedCallback(data.assignedScreenId);
    }
  }, (err) => console.error('Error escuchando PIN:', err));
}

// 2. VINCULAR PIN DESDE EL PANEL DE CONTROL (CELULAR)
async function pairTvWithPin(pin, targetScreenId, tvName) {
  if (!isFirebaseReady || !db) throw new Error('Firestore no está conectado');
  const cleanPin = pin.toString().trim().replace(/\D/g, '');
  const screenNum = parseInt(targetScreenId, 10);

  console.log(`🔗 [EMISOR] Vinculando PIN ${cleanPin} a TV ${screenNum}...`);
  const pinDoc = db.collection('tv_pins').doc(cleanPin);

  await pinDoc.set({
    pin: cleanPin,
    assignedScreenId: screenNum,
    tvName: tvName || `TV ${screenNum}`,
    paired: true,
    pairedAt: Date.now()
  }, { merge: true });

  // Guardar en la lista de pantallas conectadas
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

// 4. SINCRONIZACIÓN DE ESTADO MULTIMEDIA GLOBAL
function listenFirebaseState(callback) {
  if (!isFirebaseReady || !db) return;
  db.collection('tv_streamer').doc('state').onSnapshot((doc) => {
    if (doc.exists) callback(doc.data());
  }, (err) => console.error('Error escuchando state:', err));
}

function updateFirebaseState(newState) {
  if (!isFirebaseReady || !db) return;
  db.collection('tv_streamer').doc('state').set(newState, { merge: true }).catch((e) => {
    console.error('Error guardando state en Firestore:', e);
  });
}

// 5. SUBIDA A STORAGE
async function uploadToFirebaseStorage(file) {
  if (!isFirebaseReady || !storage) throw new Error('Storage no disponible');
  const filename = `media_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const snap = await storage.ref().child(`uploads/${filename}`).put(file);
  const url = await snap.ref.getDownloadURL();
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  return { url, type: isVideo ? 'video' : 'image' };
}

// 6. PRESENCIA Y SPECS
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
