const admin = require('firebase-admin');
const path = require('path');

const hasExplicitCredentials = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

const hasServiceAccount = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);

let app;
if (admin.apps.length) {
  app = admin.app();
} else {
  if (hasExplicitCredentials) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    // Resolve the path properly for Windows
    const credPath = path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    app = admin.initializeApp({
      credential: admin.credential.cert(credPath),
    });
  } else {
    app = admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
}

module.exports = {
  admin: require('firebase-admin'),
  app,
  auth: admin.auth(),
  firestore: admin.firestore(),
};
