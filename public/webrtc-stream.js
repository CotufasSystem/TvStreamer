// WebRTC P2P Screen Sharing Helper via Firestore Signaling
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};
let localScreenStream = null, activePeerConnection = null, activeSignalingUnsub = null;

// Emisor (Panel de Control - Admin)
async function startAdminScreenShare(targetKey = 'screen_1', onStarted = () => {}, onStopped = () => {}) {
  try {
    if (localScreenStream) stopAdminScreenShare(targetKey);
    try {
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: false
      });
    } catch (e1) {
      localScreenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    }
  } catch (err) {
    if (err.name !== 'NotAllowedError') alert('Error al capturar pantalla: ' + err.message);
    return null;
  }

  const fdb = getDb(), activeRoom = getAdminRoomId();
  if (!fdb) return null;

  activePeerConnection = new RTCPeerConnection(rtcConfig);
  localScreenStream.getTracks().forEach(track => activePeerConnection.addTrack(track, localScreenStream));

  const sessionId = Date.now().toString();
  const webrtcDoc = fdb.collection('rooms').doc(activeRoom).collection('webrtc').doc(targetKey);

  activePeerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      webrtcDoc.update({
        callerCandidates: firebase.firestore.FieldValue.arrayUnion(JSON.stringify(event.candidate.toJSON()))
      }).catch(() => {});
    }
  };

  const offer = await activePeerConnection.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
  await activePeerConnection.setLocalDescription(offer);

  await webrtcDoc.set({
    sessionId,
    active: true,
    offer: { type: offer.type, sdp: offer.sdp },
    answer: null,
    callerCandidates: [],
    calleeCandidates: [],
    updatedAt: Date.now()
  });

  let processedCalleeCount = 0;
  activeSignalingUnsub = webrtcDoc.onSnapshot(async (snap) => {
    const data = snap.data();
    if (!data || data.sessionId !== sessionId) return;

    if (data.answer && activePeerConnection && !activePeerConnection.currentRemoteDescription) {
      const answer = new RTCSessionDescription(data.answer);
      await activePeerConnection.setRemoteDescription(answer);
    }

    if (data.calleeCandidates && Array.isArray(data.calleeCandidates)) {
      while (processedCalleeCount < data.calleeCandidates.length) {
        const raw = data.calleeCandidates[processedCalleeCount];
        processedCalleeCount++;
        try {
          const cand = JSON.parse(raw);
          if (activePeerConnection && activePeerConnection.remoteDescription) {
            activePeerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        } catch (e) {}
      }
    }
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
    fdb.collection('rooms').doc(activeRoom).collection('webrtc').doc(targetKey).set({ active: false, sessionId: null }, { merge: true }).catch(() => {});
  }
}

// Receptor (Pantalla TV - Display)
function listenTvWebRtcStream(screenId, roomId, onStreamReceived, onStreamEnded) {
  const fdb = getDb(); if (!fdb || !screenId || !roomId) return () => {};
  const targetKey = screenId.toString().startsWith('screen_') ? screenId : `screen_${screenId}`;
  let tvPeerConn = null, currentSessionId = null, processedCallerCount = 0;

  const unsub = fdb.collection('rooms').doc(roomId).collection('webrtc').doc(targetKey).onSnapshot(async (snap) => {
    const data = snap.data();
    if (!data || !data.active || !data.offer || !data.sessionId) {
      if (tvPeerConn) { tvPeerConn.close(); tvPeerConn = null; }
      currentSessionId = null;
      processedCallerCount = 0;
      onStreamEnded();
      return;
    }

    if (currentSessionId === data.sessionId && tvPeerConn) {
      if (data.callerCandidates && Array.isArray(data.callerCandidates)) {
        while (processedCallerCount < data.callerCandidates.length) {
          const raw = data.callerCandidates[processedCallerCount];
          processedCallerCount++;
          try {
            const cand = JSON.parse(raw);
            if (tvPeerConn && tvPeerConn.remoteDescription) {
              tvPeerConn.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
          } catch (e) {}
        }
      }
      return;
    }

    currentSessionId = data.sessionId;
    processedCallerCount = 0;
    if (tvPeerConn) tvPeerConn.close();
    tvPeerConn = new RTCPeerConnection(rtcConfig);

    const webrtcDoc = fdb.collection('rooms').doc(roomId).collection('webrtc').doc(targetKey);

    tvPeerConn.onicecandidate = (event) => {
      if (event.candidate) {
        webrtcDoc.update({
          calleeCandidates: firebase.firestore.FieldValue.arrayUnion(JSON.stringify(event.candidate.toJSON()))
        }).catch(() => {});
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

    if (data.callerCandidates && Array.isArray(data.callerCandidates)) {
      while (processedCallerCount < data.callerCandidates.length) {
        const raw = data.callerCandidates[processedCallerCount];
        processedCallerCount++;
        try {
          const cand = JSON.parse(raw);
          tvPeerConn.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        } catch (e) {}
      }
    }
  });

  return () => {
    unsub();
    if (tvPeerConn) { tvPeerConn.close(); tvPeerConn = null; }
  };
}
