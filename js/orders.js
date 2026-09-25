/* ==========================================================
   DataHub — My Orders page
   ----------------------------------------------------------
   Reads orders straight from this device's local storage (the
   durable record — see js/app.js). Firebase is only used as a
   best-effort check to pull in status updates the admin has
   made (e.g. "Sent"); if it can't be reached, the local list
   still shows fine on its own.
   ========================================================== */

const ordersBody = document.getElementById("ordersBody");
const searchInput = document.getElementById("searchInput");
const syncNote = document.getElementById("syncNote");

function getLocalOrders() {
  return JSON.parse(localStorage.getItem("datahub_orders") || "[]");
}
function setLocalOrders(list) {
  localStorage.setItem("datahub_orders", JSON.stringify(list));
}

function statusBadge(status) {
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

function renderOrders(list) {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? list.filter((o) =>
        (o.customerName || "").toLowerCase().includes(q) ||
        (o.phone || "").toLowerCase().includes(q) ||
        (o.network || "").toLowerCase().includes(q))
    : list;

  if (filtered.length === 0) {
    ordersBody.innerHTML = `<tr><td colspan="5" class="empty-state">
      ${list.length === 0 ? "No orders on this device yet. Buy a bundle from the homepage to see it here." : "No orders match that search."}
    </td></tr>`;
    return;
  }

  ordersBody.innerHTML = filtered.map((o) => `
    <tr>
      <td>${formatDate(o.createdAt)}</td>
      <td>${o.network || "-"}</td>
      <td>${o.bundleVolume || "-"}</td>
      <td>GH₵${Number(o.amount || 0).toFixed(2)}</td>
      <td>${statusBadge(o.status || "Pending")} ${o.syncStatus === "pending" ? '<span style="font-size:.72rem;color:var(--gray-500);">· syncing…</span>' : ""}</td>
    </tr>
  `).join("");
}

async function refreshFromFirebase() {
  let orders = getLocalOrders();
  renderOrders(orders); // show the local, always-available copy immediately

  if (orders.length === 0) return;

  try {
    const remote = await FirebaseDB.get("orders");
    if (!remote) return;
    const remoteList = Object.values(remote);
    let changed = false;

    orders = orders.map((o) => {
      const match = remoteList.find((r) => r.reference && r.reference === o.reference);
      if (match) {
        if (match.status && match.status !== o.status) { o.status = match.status; changed = true; }
        if (o.syncStatus !== "synced") { o.syncStatus = "synced"; changed = true; }
      }
      return o;
    });

    if (changed) {
      setLocalOrders(orders);
      renderOrders(orders);
    }
    syncNote.textContent = "";
  } catch (e) {
    console.warn("Couldn't refresh order status from the shop right now:", e);
    syncNote.textContent = "Showing orders saved on this device (couldn't reach the shop to refresh status).";
  }
}

searchInput.addEventListener("input", () => renderOrders(getLocalOrders()));

refreshFromFirebase();
