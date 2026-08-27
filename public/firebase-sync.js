// Sincronización en la nube mediante Firebase
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
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
    isFirebaseReady = true;
    console.log('[FIREBASE] Conectado a la nube de Google Firebase');
  } catch (err) {
    console.warn('[FIREBASE] Error inicializando SDK:', err);
  }
}

// Escuchar cambios en la TV desde la nube de Firebase
function listenFirebaseState(callback) {
  if (!isFirebaseReady || !db) return;
  db.collection('tv_streamer').doc('state').onSnapshot((doc) => {
    if (doc.exists) {
      const data = doc.data();
      callback(data);
    }
  }, (err) => console.warn('[FIREBASE] Snapshot error:', err));
}

// Guardar cambios desde el Panel de Control a la nube de Firebase
async function updateFirebaseState(newState) {
  if (!isFirebaseReady || !db) return;
  try {
    await db.collection('tv_streamer').doc('state').set(newState, { merge: true });
  } catch (err) {
    console.warn('[FIREBASE] Error actualizando estado:', err);
  }
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

// Registrar especificaciones de pantalla en Firebase
function reportFirebaseSpecs(screenId, specs) {
  if (!isFirebaseReady || !db || !screenId) return;
  db.collection('tv_streamer').doc('displays').set({
    [screenId]: {
      screenId,
      specs,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }
  }, { merge: true }).catch(() => {});
}
