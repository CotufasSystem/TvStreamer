const firebaseConfig = {
  apiKey: "AIzaSyBc-USadbOqE8pWBsTvkkUW5yUTS53JloQ",
  authDomain: "tvstreamer-57955.firebaseapp.com",
  databaseURL: "https://tvstreamer-57955-default-rtdb.firebaseio.com",
  projectId: "tvstreamer-57955",
  storageBucket: "tvstreamer-57955.firebasestorage.app",
  messagingSenderId: "109918885056",
  appId: "1:109918885056:web:4221829d527f76c4edc925",
  measurementId: "G-7M2LLSD5G6"
};

let rtdb = null, storage = null, isFirebaseReady = false;

if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    rtdb = firebase.database();
    storage = firebase.storage();
    isFirebaseReady = true;
  } catch (err) {
    console.warn('[FIREBASE RTDB] Error:', err);
  }
}

// 1. GENERAR Y ESCUCHAR VINCULACIÓN POR PIN EN LA TV
function listenTvPinPairing(pin, onPairedCallback) {
  if (!isFirebaseReady || !rtdb || !pin) return;
  const pinRef = rtdb.ref(`tv_streamer/pins/${pin}`);
  pinRef.set({ pin, created: firebase.database.ServerValue.TIMESTAMP, active: true });
  pinRef.onDisconnect().remove();

  pinRef.on('value', (snap) => {
    const val = snap.val();
    if (val && val.assignedScreenId) {
      pinRef.off();
      pinRef.remove();
      onPairedCallback(val.assignedScreenId);
    }
  });
}

// 2. VINCULAR TV DESDE EL EMISOR / CELULAR MEDIANTE PIN
async function pairTvWithPin(pin, targetScreenId, tvName) {
  if (!isFirebaseReady || !rtdb) throw new Error('Firebase no conectado');
  const cleanPin = pin.trim().replace(/\D/g, '');
  const pinRef = rtdb.ref(`tv_streamer/pins/${cleanPin}`);
  const snap = await pinRef.once('value');
  
  if (!snap.exists()) {
    throw new Error('Código PIN incorrecto o la TV no está en línea');
  }

  await pinRef.update({
    assignedScreenId: parseInt(targetScreenId, 10),
    tvName: tvName || `TV ${targetScreenId}`,
    pairedAt: firebase.database.ServerValue.TIMESTAMP
  });

  return true;
}

// 3. DESVINCULAR TV
function unpairTv(screenId) {
  if (!isFirebaseReady || !rtdb || !screenId) return;
  rtdb.ref(`tv_streamer/displays/${screenId}`).remove();
  rtdb.ref(`tv_streamer/unpair_signal/${screenId}`).set(Date.now());
}

function listenUnpairSignal(screenId, callback) {
  if (!isFirebaseReady || !rtdb || !screenId) return;
  rtdb.ref(`tv_streamer/unpair_signal/${screenId}`).on('value', (snap) => {
    if (snap.exists()) callback();
  });
}

// 4. ESTADO Y TRANSMISIÓN MULTIMEDIA
function listenFirebaseState(callback) {
  if (!isFirebaseReady || !rtdb) return;
  rtdb.ref('tv_streamer/state').on('value', (s) => { if (s.val()) callback(s.val()); });
}

function updateFirebaseState(newState) {
  if (!isFirebaseReady || !rtdb) return;
  rtdb.ref('tv_streamer/state').set(newState);
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

// 6. ESPECIFICACIONES Y PRESENCIA EN VIVO
function reportFirebaseSpecs(screenId, specs) {
  if (!isFirebaseReady || !rtdb || !screenId) return;
  const ref = rtdb.ref(`tv_streamer/displays/${screenId}`);
  ref.set({ screenId, specs, online: true, lastSeen: firebase.database.ServerValue.TIMESTAMP });
  ref.onDisconnect().update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
}

function listenFirebaseDisplays(callback) {
  if (!isFirebaseReady || !rtdb) return;
  rtdb.ref('tv_streamer/displays').on('value', (s) => {
    const val = s.val() || {};
    callback(Object.values(val));
  });
}
