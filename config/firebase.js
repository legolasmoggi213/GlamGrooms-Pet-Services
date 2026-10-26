const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const hasExplicitCredentials = Boolean(
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
);

const getServiceAccountPath = () => {
  const rawValue = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!rawValue) return null;

  const resolved = path.resolve(rawValue);
  return fs.existsSync(resolved) ? resolved : null;
};

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
  } else {
    const serviceAccountPath = getServiceAccountPath();
    if (serviceAccountPath) {
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.warn(
        `[firebase] GOOGLE_APPLICATION_CREDENTIALS points to a missing file: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}. Continuing without Firebase credentials.`
      );
      app = admin.initializeApp();
    } else {
      try {
        app = admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } catch (error) {
        console.warn('[firebase] No default credentials found; continuing without Firebase initialization.', error.message);
        app = admin.initializeApp();
      }
    }
  }
}

module.exports = {
  admin: require('firebase-admin'),
  app,
  auth: admin.auth(),
  firestore: admin.firestore(),
};
