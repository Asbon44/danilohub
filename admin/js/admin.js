/* ==========================================================
   DataHub — Admin panel logic
   ==========================================================
   Login is a client-side check (no server). The password can be
   changed from Settings and is stored hashed, but because the
   database is open, this is still NOT strong security. For real
   protection use Firebase Authentication. See README.
   ========================================================== */

const DEFAULT_ADMIN_USERNAME = "Danilo";
const DEFAULT_ADMIN_PASSWORD = "Datahub";
const SESSION_KEY = "datahub_admin_session";
const AUTH_PATH = "adminAuth";                    // where the login lives in Firebase
const AUTH_CACHE_KEY = "datahub_admin_auth_cache"; // offline copy of the login

/* ---------------- Credentials (hashed, changeable) ---------------- */
// Until the admin changes them, the defaults above work. After a change,
// the username + a salted SHA-256 hash of the password are stored in
// Firebase (so the change applies on every device) and cached locally.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function makeAuthRecord(username, password) {
  const salt = randomSalt();
  return { username, salt, hash: await sha256Hex(salt + password) };
}
// Returns the stored record, or null when the admin never changed the
// defaults. Throws only if Firebase is unreachable AND nothing is cached.
async function loadAuthRecord() {
  try {
    const rec = await FirebaseDB.get(AUTH_PATH);
    if (rec && rec.hash) localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(rec));
    else localStorage.removeItem(AUTH_CACHE_KEY);
    return rec && rec.hash ? rec : null;
  } catch (e) {
    const cached = localStorage.getItem(AUTH_CACHE_KEY);
    if (cached) return JSON.parse(cached);
    throw e;
  }
}
async function checkCredentials(username, password) {
  const rec = await loadAuthRecord();
  if (!rec) return username === DEFAULT_ADMIN_USERNAME && password === DEFAULT_ADMIN_PASSWORD;
  return username === rec.username && (await sha256Hex(rec.salt + password)) === rec.hash;
}

/* ---------------- Login page ---------------- */
const loginBtn = document.getElementById("loginBtn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value;
    const err = document.getElementById("loginError");
    loginBtn.disabled = true;
    try {
      if (await checkCredentials(u, p)) {
        sessionStorage.setItem(SESSION_KEY, "true");
        window.location.href = "dashboard.html";
        return;
      }
      err.textContent = "Incorrect username or password.";
    } catch (e) {
      err.textContent = "Can't reach the server to check your login. Check your internet and try again.";
    }
    err.style.display = "block";
    loginBtn.disabled = false;
  });
  document.getElementById("password").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginBtn.click();
  });
}

/* ---------------- Mobile sidebar (hamburger) ---------------- */
// The sidebar is off-canvas below 860px (see admin-style.css) so it
// doesn't just disappear on phones with no way back in — this opens
// and closes it as a slide-in drawer.
const hamburgerBtn = document.getElementById("hamburgerBtn");
const sidebarEl = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
if (hamburgerBtn && sidebarEl && sidebarOverlay) {
  const openSidebar = () => { sidebarEl.classList.add("open"); sidebarOverlay.classList.add("open"); };
  const closeSidebar = () => { sidebarEl.classList.remove("open"); sidebarOverlay.classList.remove("open"); };
  hamburgerBtn.addEventListener("click", openSidebar);
  sidebarOverlay.addEventListener("click", closeSidebar);
  sidebarEl.querySelectorAll("nav a").forEach((link) => link.addEventListener("click", closeSidebar));
}

/* ---------------- Dashboard page ---------------- */
const ordersBody = document.getElementById("ordersBody");
if (ordersBody) {
  // Auth guard
  if (sessionStorage.getItem(SESSION_KEY) !== "true") {
    window.location.href = "login.html";
  }

  document.getElementById("logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.href = "login.html";
  });

  let allOrders = [];       // [{id, ...}]
  let filteredOrders = [];
  let currentPage = 1;
  const PAGE_SIZE = 8;
  let selectedOrderId = null;

  /* ---- Local cache: the admin's own durable copy of every order it has
     ever seen, plus any status changes made while offline. Firebase is
     the sync pipe between customer devices and this cache — if Firebase
     is briefly unreachable, the dashboard still works from this cache. */
  const CACHE_KEY = "datahub_admin_orders_cache";
  const PENDING_UPDATES_KEY = "datahub_admin_pending_updates";

  function loadCache() { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  function saveCache(map) { localStorage.setItem(CACHE_KEY, JSON.stringify(map)); }

  const PENDING_DELETES_KEY = "datahub_admin_pending_deletes";
  function loadPendingDeletes() { return JSON.parse(localStorage.getItem(PENDING_DELETES_KEY) || "[]"); }
  function savePendingDeletes(list) { localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(list)); }

  function queuePendingUpdate(id, patch) {
    const pending = JSON.parse(localStorage.getItem(PENDING_UPDATES_KEY) || "{}");
    pending[id] = { ...(pending[id] || {}), ...patch };
    localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(pending));
  }

  // Push any status changes made while Firebase was unreachable back up,
  // so customer devices eventually see them too.
  async function flushPendingUpdates() {
    // Retry any deletions that couldn't reach Firebase earlier.
    const pendingDeletes = loadPendingDeletes();
    if (pendingDeletes.length) {
      const stillDeleting = [];
      for (const id of pendingDeletes) {
        try { await FirebaseDB.remove(`orders/${id}`); }
        catch (e) { stillDeleting.push(id); }
      }
      savePendingDeletes(stillDeleting);
    }

    const pending = JSON.parse(localStorage.getItem(PENDING_UPDATES_KEY) || "{}");
    const ids = Object.keys(pending);
    if (ids.length === 0) return;
    const stillPending = {};
    const deleted = loadPendingDeletes();
    for (const id of ids) {
      if (deleted.includes(id)) continue; // order was deleted, drop its queued update
      try {
        await FirebaseDB.update(`orders/${id}`, pending[id]);
      } catch (e) {
        stillPending[id] = pending[id];
      }
    }
    localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(stillPending));
  }

  function showConnError(e) {
    const el = document.getElementById("connError");
    const msg = (e && e.message) || String(e);
    const isPermission = /permission denied/i.test(msg);
    el.innerHTML = isPermission
      ? `<b>⚠️ Can't load orders — Firebase is blocking read access.</b>` +
        `Go to your Firebase console → Realtime Database → Rules, and make sure ` +
        `<code>.read</code> and <code>.write</code> are set to <code>true</code> ` +
        `(or your own auth rule), then click Publish. Showing locally cached orders for now.`
      : `<b>⚠️ Can't reach the database right now.</b> ${msg}. Showing locally cached orders for now.`;
    el.style.display = "block";
  }
  function hideConnError() {
    document.getElementById("connError").style.display = "none";
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove();
    }
    showToast(`${label || "Copied"}: ${text}`);
  }

  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 3000);
  }

  function statusBadge(status) {
    // "Sent" is kept here only for orders marked before this update —
    // new orders use "Completed" going forward.
    const cls = status === "Completed" || status === "Sent" ? "badge-completed"
      : status === "Failed" ? "badge-failed" : "badge-pending";
    return `<span class="badge ${cls}">${status}</span>`;
  }

  function formatDate(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) +
      ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  async function fetchOrders() {
    await flushPendingUpdates();

    let cache = loadCache();
    try {
      const data = await FirebaseDB.get("orders");
      if (data) {
        // Merge live data into the local cache (Firebase is the source
        // of truth once reachable; the cache is the fallback otherwise).
        const deletedIds = loadPendingDeletes();
        Object.entries(data).forEach(([id, o]) => {
          if (!deletedIds.includes(id)) cache[id] = o;
        });
        saveCache(cache);
      }
      hideConnError();
    } catch (e) {
      console.warn("Couldn't reach Firebase, showing locally saved orders instead:", e);
      // Surface the real reason in the UI instead of failing silently —
      // "Permission denied" (database rules) looks very different from a
      // network/offline error, and only one of those is fixable here.
      showConnError(e);
    }

    allOrders = Object.entries(cache).map(([id, o]) => ({ id, ...o }));
    allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    applyFilters();
    updateStats();
  }

  function updateStats() {
    document.getElementById("statTotal").textContent = allOrders.length;
    document.getElementById("statCompleted").textContent =
      allOrders.filter((o) => o.status === "Completed" || o.status === "Sent").length;
    document.getElementById("statPending").textContent =
      allOrders.filter((o) => o.status === "Pending").length;
    const revenue = allOrders
      .filter((o) => o.status !== "Failed")
      .reduce((sum, o) => sum + Number(o.amount || 0), 0);
    document.getElementById("statRevenue").textContent = revenue.toFixed(2);
  }

  function applyFilters() {
    const q = document.getElementById("searchOrders").value.trim().toLowerCase();
    const status = document.getElementById("filterStatus").value;
    filteredOrders = allOrders.filter((o) => {
      const matchesQ = !q ||
        (o.customerName || "").toLowerCase().includes(q) ||
        (o.phone || "").toLowerCase().includes(q) ||
        (o.network || "").toLowerCase().includes(q);
      const matchesStatus = !status || o.status === status;
      return matchesQ && matchesStatus;
    });
    currentPage = 1;
    renderTable();
  }

  function renderTable() {
    if (filteredOrders.length === 0) {
      ordersBody.innerHTML = `<tr><td colspan="7" class="empty-state">No orders found.</td></tr>`;
      document.getElementById("pagination").innerHTML = "";
      return;
    }
    const totalPages = Math.ceil(filteredOrders.length / PAGE_SIZE);
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filteredOrders.slice(start, start + PAGE_SIZE);

    ordersBody.innerHTML = pageItems.map((o) => `
      <tr>
        <td>${o.customerName || "-"}</td>
        <td>${o.phone ? `<span class="phone-cell">${o.phone}<button class="copy-btn" title="Copy number" data-copy-phone="${o.phone}">📋 Copy</button></span>` : "-"}</td>
        <td>${o.network || "-"}</td>
        <td>${o.bundleVolume || "-"}</td>
        <td>GH₵${Number(o.amount || 0).toFixed(2)}</td>
        <td>${statusBadge(o.status || "Pending")}</td>
        <td>
          <button class="icon-btn" data-view-id="${o.id}">View</button>
          ${(o.status !== "Completed" && o.status !== "Sent") ? `<button class="icon-btn" data-sent-id="${o.id}">Mark Completed</button>` : ""}
          <button class="icon-btn icon-btn-danger" data-delete-id="${o.id}">Delete</button>
        </td>
      </tr>
    `).join("");

    let pagHtml = "";
    for (let i = 1; i <= totalPages; i++) {
      pagHtml += `<button class="${i === currentPage ? "active" : ""}" data-page="${i}">${i}</button>`;
    }
    document.getElementById("pagination").innerHTML = pagHtml;

    ordersBody.querySelectorAll("[data-view-id]").forEach((btn) =>
      btn.addEventListener("click", () => openDetails(btn.dataset.viewId))
    );
    ordersBody.querySelectorAll("[data-sent-id]").forEach((btn) =>
      btn.addEventListener("click", () => openMarkSent(btn.dataset.sentId))
    );
    ordersBody.querySelectorAll("[data-copy-phone]").forEach((btn) =>
      btn.addEventListener("click", () => copyText(btn.dataset.copyPhone, "Number copied"))
    );
    ordersBody.querySelectorAll("[data-delete-id]").forEach((btn) =>
      btn.addEventListener("click", () => openDelete(btn.dataset.deleteId))
    );
    document.getElementById("pagination").querySelectorAll("[data-page]").forEach((btn) =>
      btn.addEventListener("click", () => { currentPage = Number(btn.dataset.page); renderTable(); })
    );
  }

  document.getElementById("searchOrders").addEventListener("input", applyFilters);
  document.getElementById("filterStatus").addEventListener("change", applyFilters);

  /* ---- View details modal ---- */
  function openDetails(id) {
    const o = allOrders.find((x) => x.id === id);
    if (!o) return;
    selectedOrderId = id;
    document.getElementById("dName").textContent = o.customerName || "-";
    document.getElementById("dPhone").textContent = o.phone || "-";
    document.getElementById("dEmail").textContent = o.email || "-";
    document.getElementById("dRef").textContent = o.reference || "-";
    document.getElementById("dMethod").textContent = o.paymentMethod === "card" ? "Card" : "Mobile Money";
    document.getElementById("dStatus").innerHTML = statusBadge(o.status || "Pending");
    document.getElementById("dDate").textContent = formatDate(o.createdAt);
    document.getElementById("dNetwork").textContent = o.network || "-";
    document.getElementById("dVolume").textContent = o.bundleVolume || "-";
    document.getElementById("dAmount").textContent = "GH₵" + Number(o.amount || 0).toFixed(2);

    document.getElementById("markSentFromDetails").style.display =
      (o.status === "Completed" || o.status === "Sent") ? "none" : "inline-flex";
    document.getElementById("detailsModal").classList.add("open");
  }

  document.getElementById("markSentFromDetails").addEventListener("click", () => {
    closeModal("detailsModal");
    openMarkSent(selectedOrderId);
  });

  document.getElementById("copyPhoneFromDetails").addEventListener("click", () => {
    const o = allOrders.find((x) => x.id === selectedOrderId);
    if (o && o.phone) copyText(o.phone, "Number copied");
  });

  document.getElementById("deleteFromDetails").addEventListener("click", () => {
    closeModal("detailsModal");
    openDelete(selectedOrderId);
  });

  /* ---- Delete order modal ---- */
  function openDelete(id) {
    const o = allOrders.find((x) => x.id === id);
    if (!o) return;
    selectedOrderId = id;
    document.getElementById("deleteOrderSummary").textContent =
      `${o.customerName || "Unknown"} — ${o.network || "-"} ${o.bundleVolume || ""} (GH₵${Number(o.amount || 0).toFixed(2)})`;
    document.getElementById("deleteModal").classList.add("open");
  }

  document.getElementById("confirmDelete").addEventListener("click", async () => {
    if (!selectedOrderId) return;
    const id = selectedOrderId;

    // Remove locally right away so the order disappears from the table
    const cache = loadCache();
    delete cache[id];
    saveCache(cache);

    // Drop any queued status update for this order
    const pending = JSON.parse(localStorage.getItem(PENDING_UPDATES_KEY) || "{}");
    delete pending[id];
    localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(pending));

    closeModal("deleteModal");
    selectedOrderId = null;

    // Remember the deletion until Firebase confirms it, so a temporary
    // network failure can't bring the order back on the next refresh.
    const queue = loadPendingDeletes();
    if (!queue.includes(id)) { queue.push(id); savePendingDeletes(queue); }
    allOrders = allOrders.filter((o) => o.id !== id);
    applyFilters();
    updateStats();

    try {
      await FirebaseDB.remove(`orders/${id}`);
      savePendingDeletes(loadPendingDeletes().filter((x) => x !== id));
      showToast("Order deleted.");
    } catch (e) {
      console.warn("Couldn't delete from Firebase yet, will retry automatically:", e);
      showToast("Order removed here. Will finish deleting when the database is reachable.");
    }
  });

  /* ---- Mark as sent modal ---- */
  function openMarkSent(id) {
    selectedOrderId = id;
    document.getElementById("markSentModal").classList.add("open");
  }

  document.getElementById("confirmMarkSent").addEventListener("click", async () => {
    if (!selectedOrderId) return;

    // Update the local cache immediately — the dashboard reflects this
    // right away regardless of whether Firebase is reachable.
    const cache = loadCache();
    if (cache[selectedOrderId]) {
      cache[selectedOrderId].status = "Completed";
      saveCache(cache);
    }
    closeModal("markSentModal");
    showToast("Order marked as completed.");
    fetchOrders();

    // This write is what the customer's own "My Orders" page picks up
    // (it polls the same order by its payment reference), so this is the
    // actual moment the client sees the order flip to "Completed".
    try {
      await FirebaseDB.update(`orders/${selectedOrderId}`, { status: "Completed" });
    } catch (e) {
      console.warn("Couldn't sync 'Completed' status yet, will retry automatically:", e);
      queuePendingUpdate(selectedOrderId, { status: "Completed" });
    }
  });

  /* ---- Generic modal close ---- */
  function closeModal(id) { document.getElementById(id).classList.remove("open"); }
  document.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => closeModal(btn.dataset.close))
  );
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) =>
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) backdrop.classList.remove("open"); })
  );

  /* ---- Sidebar nav (Bundles opens the pricing modal) ---- */
  document.querySelectorAll(".sidebar nav a[data-view]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".sidebar nav a").forEach((a) => a.classList.remove("active"));
      link.classList.add("active");
      if (link.dataset.view === "bundles") openBundlesManager();
      if (link.dataset.view === "settings") openSettings();
      // "dashboard" and "orders" both show the same orders view in this build
    });
  });

  /* ---- Settings: change username / password ---- */
  async function openSettings() {
    const rec = await loadAuthRecord().catch(() => null);
    document.getElementById("setUsername").value = rec ? rec.username : DEFAULT_ADMIN_USERNAME;
    ["setCurrentPw", "setNewPw", "setConfirmPw"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("settingsError").style.display = "none";
    document.getElementById("settingsModal").classList.add("open");
  }

  document.getElementById("saveSettings").addEventListener("click", async () => {
    const errEl = document.getElementById("settingsError");
    const fail = (m) => { errEl.textContent = m; errEl.style.display = "block"; };
    const newUser = document.getElementById("setUsername").value.trim();
    const currentPw = document.getElementById("setCurrentPw").value;
    const newPw = document.getElementById("setNewPw").value;
    const confirmPw = document.getElementById("setConfirmPw").value;

    if (!newUser) return fail("Username can't be empty.");
    if (!currentPw) return fail("Enter your current password to confirm it's you.");
    if (newPw && newPw.length < 6) return fail("New password must be at least 6 characters.");
    if (newPw !== confirmPw) return fail("New password and confirmation don't match.");

    try {
      const rec = await loadAuthRecord();
      const currentUser = rec ? rec.username : DEFAULT_ADMIN_USERNAME;
      if (!(await checkCredentials(currentUser, currentPw))) return fail("Current password is incorrect.");

      // Blank new password = keep the current one, just change the username.
      const record = await makeAuthRecord(newUser, newPw || currentPw);
      await FirebaseDB.set(AUTH_PATH, record);
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(record));
      closeModal("settingsModal");
      showToast("Login details updated.");
    } catch (e) {
      console.error(e);
      fail("Couldn't save. Check your internet connection and try again.");
    }
  });

  /* ---- Manage bundles ---- */
  let bundlesData = null;
  let currentBundleNetwork = "mtn";

  async function openBundlesManager() {
    document.getElementById("bundlesModal").classList.add("open");
    if (!bundlesData) {
      bundlesData = await FirebaseDB.get("bundles");
    }
    renderBundleTabs();
    renderBundleRows();
  }

  function renderBundleTabs() {
    const tabsEl = document.getElementById("bundleNetworkTabs");
    tabsEl.innerHTML = Object.keys(bundlesData || {}).map((key) => `
      <button class="${key === currentBundleNetwork ? "active" : ""}" data-net="${key}">${bundlesData[key].label}</button>
    `).join("");
    tabsEl.querySelectorAll("button").forEach((btn) =>
      btn.addEventListener("click", () => {
        currentBundleNetwork = btn.dataset.net;
        renderBundleTabs();
        renderBundleRows();
      })
    );
  }

  function renderBundleRows() {
    const rowsEl = document.getElementById("bundleRows");
    const list = (bundlesData[currentBundleNetwork] && bundlesData[currentBundleNetwork].bundles) || [];
    rowsEl.innerHTML = list.map((b, i) => `
      <div class="bundle-row" data-i="${i}">
        <input type="text" class="b-volume" value="${b.volume}" placeholder="e.g. 5GB" />
        <input type="number" class="b-price" value="${b.price}" placeholder="Price (GH₵)" min="0" step="0.01" />
        <button class="icon-btn" data-remove="${i}">🗑</button>
      </div>
    `).join("");
    rowsEl.querySelectorAll("[data-remove]").forEach((btn) =>
      btn.addEventListener("click", () => {
        list.splice(Number(btn.dataset.remove), 1);
        renderBundleRows();
      })
    );
  }

  document.getElementById("addBundleRow").addEventListener("click", () => {
    if (!bundlesData[currentBundleNetwork].bundles) bundlesData[currentBundleNetwork].bundles = [];
    bundlesData[currentBundleNetwork].bundles.push({ volume: "", price: 0 });
    renderBundleRows();
  });

  document.getElementById("saveBundles").addEventListener("click", async () => {
    // Read current rows back into bundlesData before saving
    const rows = document.querySelectorAll("#bundleRows .bundle-row");
    const updated = [];
    rows.forEach((row) => {
      const volume = row.querySelector(".b-volume").value.trim();
      const price = Number(row.querySelector(".b-price").value);
      if (volume) updated.push({ volume, price });
    });
    bundlesData[currentBundleNetwork].bundles = updated;

    try {
      await FirebaseDB.set("bundles", bundlesData);
      showToast("Bundle pricing updated.");
      closeModal("bundlesModal");
    } catch (e) {
      console.error(e);
      showToast("Couldn't save changes. Try again.");
    }
  });

  /* ---- Init + light polling for near real-time updates ---- */
  fetchOrders();
  setInterval(fetchOrders, 6000);
}
