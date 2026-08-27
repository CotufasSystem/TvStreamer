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

let db = null, rtdb = null, storage = null, isFirebaseReady = false;

if (typeof firebase !== 'undefined') {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    try { db = firebase.firestore(); } catch (e) {}
    try { rtdb = firebase.database(); } catch (e) {}
    try { storage = firebase.storage(); } catch (e) {}
    isFirebaseReady = true;
    console.log('[FIREBASE] Inicializado con éxito');
  } catch (err) {
    console.warn('[FIREBASE] Error de inicialización:', err);
  }
}

// 1. ESCUCHAR VINCULACIÓN DE PIN EN LA TV (Firestore + RTDB Dual)
function listenTvPinPairing(pin, onPairedCallback) {
  if (!isFirebaseReady || !pin) return;
  const cleanPin = pin.trim().replace(/\D/g, '');

  // A. Vía Firestore
  if (db) {
    try {
      db.collection('tv_pins').doc(cleanPin).set({ pin: cleanPin, active: true, createdAt: Date.now() });
      const unsub = db.collection('tv_pins').doc(cleanPin).onSnapshot((doc) => {
        if (doc.exists) {
          const data = doc.data();
          if (data && data.assignedScreenId) {
            unsub();
            db.collection('tv_pins').doc(cleanPin).delete().catch(() => {});
            onPairedCallback(data.assignedScreenId);
          }
        }
      }, (e) => console.warn('Firestore PIN listen err:', e));
    } catch (e) {}
  }

  // B. Vía Realtime Database
  if (rtdb) {
    try {
      const pinRef = rtdb.ref(`tv_streamer/pins/${cleanPin}`);
      pinRef.set({ pin: cleanPin, active: true, created: Date.now() });
      pinRef.onDisconnect().remove();
      pinRef.on('value', (snap) => {
        const val = snap.val();
        if (val && val.assignedScreenId) {
          pinRef.off();
          pinRef.remove();
          onPairedCallback(val.assignedScreenId);
        }
      });
    } catch (e) {}
  }
}

// 2. VINCULAR PIN DESDE EL EMISOR (Firestore + RTDB Dual)
async function pairTvWithPin(pin, targetScreenId, tvName) {
  if (!isFirebaseReady) throw new Error('Firebase no está inicializado.');
  const cleanPin = pin.trim().replace(/\D/g, '');
  const screenNum = parseInt(targetScreenId, 10);
  let paired = false;

  // A. Intentar por Firestore
  if (db) {
    try {
      await db.collection('tv_pins').doc(cleanPin).set({
        assignedScreenId: screenNum,
        tvName: tvName || `TV ${screenNum}`,
        pairedAt: Date.now()
      }, { merge: true });
      paired = true;
    } catch (e) {
      console.warn('Firestore pair error:', e);
    }
  }

  // B. Intentar por RTDB
  if (rtdb) {
    try {
      await rtdb.ref(`tv_streamer/pins/${cleanPin}`).update({
        assignedScreenId: screenNum,
        tvName: tvName || `TV ${screenNum}`,
        pairedAt: Date.now()
      });
      paired = true;
    } catch (e) {
      console.warn('RTDB pair error:', e);
    }
  }

  // Registrar pantalla activa
  if (db) {
    db.collection('tv_displays').doc(screenNum.toString()).set({
      screenId: screenNum, online: true, lastSeen: Date.now()
    }, { merge: true }).catch(() => {});
  }
  if (rtdb) {
    rtdb.ref(`tv_streamer/displays/${screenNum}`).set({
      screenId: screenNum, online: true, lastSeen: Date.now()
    }).catch(() => {});
  }

  if (!paired) throw new Error('No se pudo enviar la señal a Firebase. Verifica tu conexión.');
  return true;
}

// 3. DESVINCULAR
function unpairTv(screenId) {
  if (!isFirebaseReady || !screenId) return;
  if (db) {
    db.collection('tv_displays').doc(screenId.toString()).delete().catch(() => {});
    db.collection('tv_unpair').doc(screenId.toString()).set({ timestamp: Date.now() }).catch(() => {});
  }
  if (rtdb) {
    rtdb.ref(`tv_streamer/displays/${screenId}`).remove().catch(() => {});
    rtdb.ref(`tv_streamer/unpair_signal/${screenId}`).set(Date.now()).catch(() => {});
  }
}

function listenUnpairSignal(screenId, callback) {
  if (!isFirebaseReady || !screenId) return;
  if (db) {
    db.collection('tv_unpair').doc(screenId.toString()).onSnapshot((doc) => {
      if (doc.exists) callback();
    }, () => {});
  }
  if (rtdb) {
    rtdb.ref(`tv_streamer/unpair_signal/${screenId}`).on('value', (snap) => {
      if (snap.exists()) callback();
    });
  }
}

// 4. ESTADO MULTIMEDIA
function listenFirebaseState(callback) {
  if (!isFirebaseReady) return;
  if (db) {
    db.collection('tv_streamer').doc('state').onSnapshot((doc) => {
      if (doc.exists) callback(doc.data());
    }, () => {});
  }
  if (rtdb) {
    rtdb.ref('tv_streamer/state').on('value', (s) => { if (s.val()) callback(s.val()); });
  }
}

function updateFirebaseState(newState) {
  if (!isFirebaseReady) return;
  if (db) db.collection('tv_streamer').doc('state').set(newState, { merge: true }).catch(() => {});
  if (rtdb) rtdb.ref('tv_streamer/state').set(newState).catch(() => {});
}

// 5. STORAGE & SPECS
async function uploadToFirebaseStorage(file) {
  if (!isFirebaseReady || !storage) throw new Error('Storage no disponible');
  const filename = `media_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
  const snap = await storage.ref().child(`uploads/${filename}`).put(file);
  const url = await snap.ref.getDownloadURL();
  const isVideo = file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(file.name);
  return { url, type: isVideo ? 'video' : 'image' };
}

function reportFirebaseSpecs(screenId, specs) {
  if (!isFirebaseReady || !screenId) return;
  if (db) db.collection('tv_displays').doc(screenId.toString()).set({ screenId, specs, online: true, lastSeen: Date.now() }, { merge: true }).catch(() => {});
  if (rtdb) rtdb.ref(`tv_streamer/displays/${screenId}`).set({ screenId, specs, online: true, lastSeen: Date.now() }).catch(() => {});
}

function listenFirebaseDisplays(callback) {
  if (!isFirebaseReady) return;
  if (db) {
    db.collection('tv_displays').onSnapshot((snap) => {
      const list = [];
      snap.forEach(d => list.push(d.data()));
      callback(list);
    }, () => {});
  }
  if (rtdb) {
    rtdb.ref('tv_streamer/displays').on('value', (s) => {
      const val = s.val() || {};
      callback(Object.values(val));
    });
  }
}
