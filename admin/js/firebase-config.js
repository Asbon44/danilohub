/* ==========================================================
   DataHub — Firebase (Realtime Database) REST helper
   ==========================================================
   We talk to Firebase using its plain REST API (no SDK needed).
   That means the ONLY thing required to connect is the database
   URL below. Every read/write is a normal fetch() call.

   IMPORTANT — Database rules:
   For this to work your Firebase Realtime Database rules must
   allow read/write. For quick testing, in the Firebase console
   go to Realtime Database > Rules and use:

   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }

   This is fine for a test/demo project but is NOT secure for a
   real production app (anyone could read/write your orders).
   Before going live, lock this down with proper Firebase Auth
   based rules.
   ========================================================== */

const FIREBASE_DB_URL = "https://ghana-ambulance-60a8d-default-rtdb.firebaseio.com";

const FirebaseDB = {
  // Turns a failed response into an error message that actually explains
  // what went wrong (e.g. Firebase's own "Permission denied" text),
  // instead of a generic "request failed".
  async _explainError(res) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body && body.error ? body.error : JSON.stringify(body);
    } catch (_) {
      detail = res.statusText;
    }
    return `Firebase ${res.status}: ${detail || "unknown error"}`;
  },

  // Create a new record under a path (Firebase generates the id)
  async push(path, data) {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await this._explainError(res));
    return res.json(); // { name: "<generated id>" }
  },

  // Read everything at a path (returns null if empty)
  async get(path) {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
    if (!res.ok) throw new Error(await this._explainError(res));
    return res.json();
  },

  // Update specific fields at a path without overwriting the rest
  async update(path, data) {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await this._explainError(res));
    return res.json();
  },

  // Overwrite everything at a path
  async set(path, data) {
    const res = await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await this._explainError(res));
    return res.json();
  },
};
