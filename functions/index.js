const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({ origin: true });
const Busboy = require('busboy');

admin.initializeApp();
const db = admin.firestore();

exports.uploadVideo = functions.https.onRequest((req, res) => {
  return cors(req, res, () => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const busboy = Busboy({ headers: req.headers });
    let fileBuffer = [];
    let fileName = '';
    let mimeType = 'video/mp4';

    busboy.on('file', (fieldname, file, info) => {
      fileName = info.filename || `video_${Date.now()}.mp4`;
      mimeType = info.mimeType || 'video/mp4';
      file.on('data', (data) => fileBuffer.push(data));
    });

    busboy.on('finish', async () => {
      try {
        const fullBuffer = Buffer.concat(fileBuffer);
        const mediaId = `vid_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const CHUNK_SIZE = 800 * 1024;
        const totalChunks = Math.ceil(fullBuffer.length / CHUNK_SIZE);

        const batchPromises = [];
        for (let i = 0; i < totalChunks; i++) {
          const slice = fullBuffer.subarray(i * CHUNK_SIZE, Math.min(fullBuffer.length, (i + 1) * CHUNK_SIZE));
          const base64Chunk = slice.toString('base64');
          batchPromises.push(
            db.collection('tv_chunks').doc(`${mediaId}_${i}`).set({
              data: base64Chunk,
              index: i,
              total: totalChunks,
              type: mimeType
            })
          );
        }

        await Promise.all(batchPromises);
        const chunkedUri = `chunked://${mediaId}?total=${totalChunks}&type=${encodeURIComponent(mimeType)}`;
        return res.status(200).json({ success: true, url: chunkedUri, type: 'video' });
      } catch (err) {
        console.error('Upload error:', err);
        return res.status(500).json({ error: err.message });
      }
    });

    busboy.end(req.rawBody);
  });
});
