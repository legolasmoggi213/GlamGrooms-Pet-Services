const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const warnFirebaseUnavailable = (reason) => {
  console.warn(`[firebase] ${reason}`);
};

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
      warnFirebaseUnavailable(
        `GOOGLE_APPLICATION_CREDENTIALS points to a missing file: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}. Continuing without Firebase credentials.`
      );
      app = admin.initializeApp();
    } else {
      try {
        app = admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      } catch (error) {
        warnFirebaseUnavailable(`No default credentials found; continuing without Firebase initialization. ${error.message}`);
        app = admin.initializeApp();
      }
    }
  }
}

const fallbackAuth = {
  verifyIdToken: async () => {
    throw new Error('Firebase Authentication is not configured for this environment.');
  },
  updateUser: async () => {},
  getUserByEmail: async () => {
    throw new Error('Firebase Authentication is not configured for this environment.');
  },
  revokeRefreshTokens: async () => {},
  deleteUser: async () => {},
};

const fallbackCollection = () => ({
  doc: () => ({
    get: async () => ({ exists: false }),
    set: async () => {},
    update: async () => {},
    delete: async () => {},
  }),
  where: () => fallbackCollection(),
  orderBy: () => fallbackCollection(),
  limit: () => fallbackCollection(),
  get: async () => ({ docs: [] }),
});

const fallbackFirestore = {
  collection: fallbackCollection,
  runTransaction: async (handler) => handler({
    get: async () => ({ exists: false }),
    create: async () => {},
    update: async () => {},
    delete: async () => {},
  }),
};

let firestoreClient;
let authClient;
try {
  authClient = admin.auth();
  firestoreClient = admin.firestore();
} catch (error) {
  warnFirebaseUnavailable(`Firestore unavailable: ${error.message}`);
  authClient = fallbackAuth;
  firestoreClient = fallbackFirestore;
}

module.exports = {
  admin: require('firebase-admin'),
  app,
  auth: authClient,
  firestore: firestoreClient,
};
