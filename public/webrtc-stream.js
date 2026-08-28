// WebRTC P2P Screen Sharing Helper via Firestore Signaling
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let localScreenStream = null, activePeerConnection = null, activeSignalingUnsub = null;

// Emisor (Panel de Control - Admin)
async function startAdminScreenShare(targetKey = 'screen_1', onStarted = () => {}, onStopped = () => {}) {
  try {
    if (localScreenStream) stopAdminScreenShare(targetKey);
    localScreenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: "always", displaySurface: "monitor" },
      audio: true
    });
  } catch (err) {
    if (err.name !== 'NotAllowedError') alert('Error al capturar pantalla: ' + err.message);
    return null;
  }

  const fdb = getDb(), activeRoom = getAdminRoomId();
  if (!fdb) return null;

  activePeerConnection = new RTCPeerConnection(rtcConfig);
  localScreenStream.getTracks().forEach(track => activePeerConnection.addTrack(track, localScreenStream));

  const webrtcDoc = fdb.collection('rooms').doc(activeRoom).collection('webrtc').doc(targetKey);
  await webrtcDoc.set({ offer: null, answer: null, active: true, createdAt: Date.now() });

  activePeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      webrtcDoc.collection('callerCandidates').add(event.candidate.toJSON()).catch(() => {});
    }
  };

  const offer = await activePeerConnection.createOffer();
  await activePeerConnection.setLocalDescription(offer);
  await webrtcDoc.set({ offer: { type: offer.type, sdp: offer.sdp }, active: true, updatedAt: Date.now() }, { merge: true });

  activeSignalingUnsub = webrtcDoc.onSnapshot(async (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.answer && activePeerConnection && !activePeerConnection.currentRemoteDescription) {
      const answer = new RTCSessionDescription(data.answer);
      await activePeerConnection.setRemoteDescription(answer);
    }
  });

  webrtcDoc.collection('calleeCandidates').onSnapshot((snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'added' && activePeerConnection) {
        activePeerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(() => {});
      }
    });
  });

  localScreenStream.getVideoTracks()[0].onended = () => {
    stopAdminScreenShare(targetKey);
    onStopped();
  };

  onStarted();
  return localScreenStream;
}

function stopAdminScreenShare(targetKey = 'screen_1') {
  if (localScreenStream) {
    localScreenStream.getTracks().forEach(t => t.stop());
    localScreenStream = null;
  }
  if (activePeerConnection) {
    activePeerConnection.close();
    activePeerConnection = null;
  }
  if (activeSignalingUnsub) {
    activeSignalingUnsub();
    activeSignalingUnsub = null;
  }
  const fdb = getDb(), activeRoom = getAdminRoomId();
  if (fdb && activeRoom) {
    fdb.collection('rooms').doc(activeRoom).collection('webrtc').doc(targetKey).set({ active: false }, { merge: true }).catch(() => {});
  }
}

// Receptor (Pantalla TV - Display)
function listenTvWebRtcStream(screenId, roomId, onStreamReceived, onStreamEnded) {
  const fdb = getDb(); if (!fdb || !screenId || !roomId) return () => {};
  const targetKey = screenId.toString().startsWith('screen_') ? screenId : `screen_${screenId}`;
  let tvPeerConn = null, isConnecting = false;

  const unsub = fdb.collection('rooms').doc(roomId).collection('webrtc').doc(targetKey).onSnapshot(async (snap) => {
    const data = snap.data();
    if (!data || !data.active || !data.offer) {
      if (tvPeerConn) { tvPeerConn.close(); tvPeerConn = null; }
      isConnecting = false;
      onStreamEnded();
      return;
    }

    if (isConnecting && tvPeerConn) return;
    isConnecting = true;

    tvPeerConn = new RTCPeerConnection(rtcConfig);
    const webrtcDoc = fdb.collection('rooms').doc(roomId).collection('webrtc').doc(targetKey);

    tvPeerConn.onicecandidate = (event) => {
      if (event.candidate) {
        webrtcDoc.collection('calleeCandidates').add(event.candidate.toJSON()).catch(() => {});
      }
    };

    tvPeerConn.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        onStreamReceived(event.streams[0]);
      }
    };

    await tvPeerConn.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await tvPeerConn.createAnswer();
    await tvPeerConn.setLocalDescription(answer);

    await webrtcDoc.set({ answer: { type: answer.type, sdp: answer.sdp } }, { merge: true });

    webrtcDoc.collection('callerCandidates').onSnapshot((s) => {
      s.docChanges().forEach((change) => {
        if (change.type === 'added' && tvPeerConn) {
          tvPeerConn.addIceCandidate(new RTCIceCandidate(change.doc.data())).catch(() => {});
        }
      });
    });
  });

  return () => {
    unsub();
    if (tvPeerConn) { tvPeerConn.close(); tvPeerConn = null; }
  };
}
