// Sincronización ultrarrápida mediante Firebase Realtime Database
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

let rtdb = null;
let storage = null;
let isFirebaseReady = false;

if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    rtdb = firebase.database();
    storage = firebase.storage();
    isFirebaseReady = true;
    console.log('[FIREBASE RTDB] Conectado a Realtime Database');
  } catch (err) {
    console.warn('[FIREBASE RTDB] Error inicializando SDK:', err);
  }
}

// Escuchar cambios de estado en tiempo real (Latencia < 50ms)
function listenFirebaseState(callback) {
  if (!isFirebaseReady || !rtdb) return;
  rtdb.ref('tv_streamer/state').on('value', (snapshot) => {
    const val = snapshot.val();
    if (val) callback(val);
  });
}

// Guardar cambios desde el Panel de Control a Realtime Database
function updateFirebaseState(newState) {
  if (!isFirebaseReady || !rtdb) return;
  rtdb.ref('tv_streamer/state').set(newState).catch((err) => {
    console.warn('[FIREBASE RTDB] Error actualizando estado:', err);
  });
}

// Subir archivo a Firebase Storage
async function uploadToFirebaseStorage(file) {
  if (!isFirebaseReady || !storage) throw new Error('Firebase Storage no disponible');
  const filename = `media_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const ref = storage.ref().child(`uploads/${filename}`);
  const snapshot = await ref.put(file);
  const downloadUrl = await snapshot.ref.getDownloadURL();
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  return { url: downloadUrl, type: isVideo ? 'video' : 'image' };
}

// Registrar presencia y especificaciones de TV (Detección de conexión en vivo)
function reportFirebaseSpecs(screenId, specs) {
  if (!isFirebaseReady || !rtdb || !screenId) return;
  const tvRef = rtdb.ref(`tv_streamer/displays/${screenId}`);
  
  // Guardar specs y marcar online
  tvRef.set({
    screenId,
    specs,
    online: true,
    lastSeen: firebase.database.ServerValue.TIMESTAMP
  });

  // Si la TV se desconecta o apaga, marcar offline automáticamente en Firebase
  tvRef.onDisconnect().update({ online: false, lastSeen: firebase.database.ServerValue.TIMESTAMP });
}

// Escuchar lista de pantallas conectadas en vivo para el panel Admin
function listenFirebaseDisplays(callback) {
  if (!isFirebaseReady || !rtdb) return;
  rtdb.ref('tv_streamer/displays').on('value', (snapshot) => {
    const val = snapshot.val() || {};
    const list = Object.values(val);
    callback(list);
  });
}
