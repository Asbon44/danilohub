/* ==========================================================
   Default bundle pricing.
   The admin's "Manage Bundles" screen can overwrite this data
   in Firebase (path: "bundles"). The site always tries Firebase
   first and falls back to these defaults if Firebase has
   nothing yet (e.g. first time the site is deployed).
   ========================================================== */

const DEFAULT_BUNDLES = {
  mtn: {
    label: "MTN",
    color: "#ffcc00",
    textColor: "#1a1a1a",
    bundles: [
      { volume: "1GB", price: 6 },
      { volume: "2GB", price: 12 },
      { volume: "3GB", price: 17 },
      { volume: "4GB", price: 22 },
      { volume: "5GB", price: 27 },
      { volume: "6GB", price: 30 },
      { volume: "8GB", price: 40 },
      { volume: "10GB", price: 49 },
      { volume: "15GB", price: 72 },
      { volume: "20GB", price: 95 },
      { volume: "25GB", price: 115 },
      { volume: "30GB", price: 135 },
      { volume: "40GB", price: 172 },
      { volume: "50GB", price: 220 },
    ],
  },
  airteltigo: {
    label: "AirtelTigo",
    color: "#0057b8",
    textColor: "#ffffff",
    bundles: [
      { volume: "1GB", price: 5 },
      { volume: "2GB", price: 12 },
      { volume: "5GB", price: 27 },
      { volume: "8GB", price: 40 },
      { volume: "10GB", price: 47 },
      { volume: "25GB", price: 110 },
      { volume: "30GB", price: 135 },
      { volume: "40GB", price: 170 },
      { volume: "50GB", price: 220 },
    ],
  },
  telecel: {
    label: "Telecel",
    color: "#e4032e",
    textColor: "#ffffff",
    bundles: [
      { volume: "10GB", price: 45 },
      { volume: "15GB", price: 65 },
      { volume: "20GB", price: 90 },
      { volume: "25GB", price: 115 },
      { volume: "30GB", price: 140 },
      { volume: "45GB", price: 190 },
      { volume: "50GB", price: 210 },
    ],
  },
};

// Loads bundle data: tries Firebase first, seeds it with the
// defaults if nothing is there yet, then returns the data.
async function loadBundles() {
  try {
    const remote = await FirebaseDB.get("bundles");
    if (remote) return remote;
    await FirebaseDB.set("bundles", DEFAULT_BUNDLES);
    return DEFAULT_BUNDLES;
  } catch (e) {
    console.warn("Could not reach Firebase, using local bundle data.", e);
    return DEFAULT_BUNDLES;
  }
}
