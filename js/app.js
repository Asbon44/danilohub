/* ==========================================================
   DataHub — client app logic
   ========================================================== */

// Paystack PUBLIC key only. The SECRET key must never be placed
// in any file that runs in the browser — see README for why.
const PAYSTACK_PUBLIC_KEY = "pk_test_d21507286e63c3bd4d5efbbded7a6047f7c5b228";

let bundlesData = {};
let currentNetwork = "mtn";
let currentBundle = null; // { volume, price }
let currentPayMethod = "mobile_money";

const networkTabsEl = document.getElementById("networkTabs");
const bundleGridEl = document.getElementById("bundleGrid");
const bundleGridTitle = document.getElementById("bundleGridTitle");

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function renderNetworkTabs() {
  networkTabsEl.innerHTML = Object.keys(bundlesData).map((key) => {
    const n = bundlesData[key];
    const active = key === currentNetwork ? "active" : "";
    return `
      <div class="network-tab ${active}" data-network="${key}">
        <span class="dot" style="background:${n.color};color:${n.textColor};">${n.label.slice(0,2).toUpperCase()}</span>
        ${n.label}
      </div>`;
  }).join("");

  networkTabsEl.querySelectorAll(".network-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      currentNetwork = tab.dataset.network;
      renderNetworkTabs();
      renderBundleGrid();
    });
  });
}

function renderBundleGrid() {
  const network = bundlesData[currentNetwork];
  bundleGridTitle.textContent = `Popular Bundles (${network.label})`;
  bundleGridEl.innerHTML = network.bundles.map((b, i) => `
    <div class="bundle-card">
      <div class="volume">${b.volume}</div>
      <div class="price">GH₵${Number(b.price).toFixed(2)}</div>
      <div class="validity">Valid for 90 days</div>
      <button class="btn btn-primary btn-block btn-sm" data-index="${i}">Buy Now</button>
    </div>
  `).join("");

  bundleGridEl.querySelectorAll("button[data-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const bundle = network.bundles[btn.dataset.index];
      openPurchaseModal(currentNetwork, bundle);
    });
  });
}

/* ---------------- Purchase modal ---------------- */
const purchaseModal = document.getElementById("purchaseModal");
const selectedBundleBox = document.getElementById("selectedBundleBox");

function openPurchaseModal(networkKey, bundle) {
  const network = bundlesData[networkKey];
  currentBundle = { networkKey, networkLabel: network.label, ...bundle };

  selectedBundleBox.innerHTML = `
    <span class="dot" style="background:${network.color};color:${network.textColor};">${network.label.slice(0,2).toUpperCase()}</span>
    <div>
      <strong>${network.label} Data Bundle</strong>
      <span>${bundle.volume} · GH₵${Number(bundle.price).toFixed(2)} · Valid for 90 days</span>
    </div>
  `;

  document.getElementById("customerName").value = "";
  document.getElementById("recipientPhone").value = "";
  document.getElementById("customerEmail").value = "";
  document.getElementById("formError").style.display = "none";
  purchaseModal.classList.add("open");
}

document.querySelectorAll("[data-close]").forEach((btn) =>
  btn.addEventListener("click", () => purchaseModal.classList.remove("open"))
);
purchaseModal.addEventListener("click", (e) => {
  if (e.target === purchaseModal) purchaseModal.classList.remove("open");
});

document.querySelectorAll(".pay-method").forEach((el) => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".pay-method").forEach((p) => p.classList.remove("active"));
    el.classList.add("active");
    currentPayMethod = el.dataset.method;
  });
});

/* ---------------- Payment (Paystack) ---------------- */
const statusModal = document.getElementById("statusModal");

document.getElementById("payNowBtn").addEventListener("click", () => {
  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("recipientPhone").value.trim();
  const email = document.getElementById("customerEmail").value.trim();
  const errorEl = document.getElementById("formError");

  const phoneOk = /^[0-9+ ]{9,15}$/.test(phone);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!name || !phoneOk || !emailOk) {
    errorEl.textContent = "Please enter a valid name, phone number and email address.";
    errorEl.style.display = "block";
    return;
  }
  errorEl.style.display = "none";

  const payBtn = document.getElementById("payNowBtn");

  // If the Paystack script didn't load (ad-blocker, offline, blocked
  // domain, slow connection), PaystackPop won't exist. Without this
  // check the next line throws silently and nothing visibly happens —
  // no popup, no order, no error. Catch it and tell the customer instead.
  if (typeof PaystackPop === "undefined") {
    errorEl.textContent = "Payment couldn't start (Paystack failed to load). Check your internet connection and reload the page.";
    errorEl.style.display = "block";
    return;
  }

  payBtn.disabled = true;
  payBtn.textContent = "Opening Paystack…";

  let handler;
  try {
    handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: email,
    amount: Math.round(currentBundle.price * 100), // pesewas
    currency: "GHS",
    channels: currentPayMethod === "mobile_money" ? ["mobile_money"] : ["card"],
    metadata: {
      custom_fields: [
        { display_name: "Customer Name", variable_name: "customer_name", value: name },
        { display_name: "Network", variable_name: "network", value: currentBundle.networkLabel },
        { display_name: "Bundle", variable_name: "bundle", value: currentBundle.volume },
      ],
    },
    callback: function (response) {
      payBtn.disabled = false;
      payBtn.textContent = "🔒 Pay Now";
      purchaseModal.classList.remove("open");
      saveOrder({
        customerName: name,
        phone,
        email,
        network: currentBundle.networkLabel,
        networkKey: currentBundle.networkKey,
        bundleVolume: currentBundle.volume,
        amount: currentBundle.price,
        paymentMethod: currentPayMethod,
        reference: response.reference,
        // Payment succeeded, but the bundle hasn't been sent to the
        // customer's phone yet — that only happens once the admin marks
        // it. Starting as "Pending" is what makes the admin's
        // "Mark as Completed" action mean something.
        status: "Pending",
      });
    },
    onClose: function () {
      payBtn.disabled = false;
      payBtn.textContent = "🔒 Pay Now";
      showToast("Payment window closed.");
    },
    });
  } catch (err) {
    console.error("Paystack setup failed:", err);
    payBtn.disabled = false;
    payBtn.textContent = "🔒 Pay Now";
    errorEl.textContent = "Payment couldn't start. Please try again in a moment.";
    errorEl.style.display = "block";
    return;
  }

  try {
    handler.openIframe();
  } catch (err) {
    console.error("Paystack openIframe failed:", err);
    payBtn.disabled = false;
    payBtn.textContent = "🔒 Pay Now";
    errorEl.textContent = "Payment couldn't start. Please try again in a moment.";
    errorEl.style.display = "block";
  }
});

/* ==========================================================
   Saving an order
   ----------------------------------------------------------
   The order is always saved on THIS DEVICE first (localStorage)
   — that never fails, so the customer never loses their order
   or sees a scary error after paying. Firebase is only used as
   the pipe that carries a copy of the order to the admin
   portal. If that pipe is briefly unavailable, the order still
   exists safely on the device and is retried automatically
   until it reaches Firebase (and therefore the admin).
   ========================================================== */

function getLocalOrders() {
  return JSON.parse(localStorage.getItem("datahub_orders") || "[]");
}
function setLocalOrders(list) {
  localStorage.setItem("datahub_orders", JSON.stringify(list));
}

function saveOrderLocally(order) {
  const list = getLocalOrders();
  list.unshift(order);
  setLocalOrders(list);
}

function markLocalOrderSynced(localId) {
  const list = getLocalOrders();
  const idx = list.findIndex((o) => o.localId === localId);
  if (idx !== -1) {
    list[idx].syncStatus = "synced";
    setLocalOrders(list);
  }
}

async function saveOrder(order) {
  order.createdAt = new Date().toISOString();
  order.localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  order.syncStatus = "pending"; // becomes "synced" once it reaches Firebase

  // 1) Save on this device — this always succeeds and is what
  // "My Orders" reads from, so the customer sees it immediately.
  saveOrderLocally(order);
  localStorage.setItem("datahub_last_phone", order.phone);
  localStorage.setItem("datahub_last_email", order.email);
  showStatus(order);

  // 2) Best-effort: send a copy to Firebase so the admin sees it too.
  try {
    await FirebaseDB.push("orders", order);
    markLocalOrderSynced(order.localId);
  } catch (err) {
    console.warn("Could not reach the shop yet, will keep retrying:", err);
    queuePendingOrder(order);
  }
}

function queuePendingOrder(order) {
  const pending = JSON.parse(localStorage.getItem("datahub_pending_orders") || "[]");
  pending.push(order);
  localStorage.setItem("datahub_pending_orders", JSON.stringify(pending));
}

// On every page load, try to send along any orders that are saved on this
// device but haven't reached Firebase (the admin) yet.
async function flushPendingOrders() {
  const pending = JSON.parse(localStorage.getItem("datahub_pending_orders") || "[]");
  if (pending.length === 0) return;

  const stillPending = [];
  for (const order of pending) {
    try {
      await FirebaseDB.push("orders", order);
      markLocalOrderSynced(order.localId);
    } catch (e) {
      stillPending.push(order);
    }
  }
  localStorage.setItem("datahub_pending_orders", JSON.stringify(stillPending));
  if (stillPending.length < pending.length) {
    showToast("An earlier order has now reached the shop.");
  }
}

function showStatus(order) {
  const icon = document.getElementById("statusIcon");
  const title = document.getElementById("statusTitle");
  const msg = document.getElementById("statusMessage");

  icon.className = "status-icon success";
  icon.textContent = "✅";
  title.textContent = "Payment Successful!";
  msg.textContent = `Your ${order.bundleVolume} ${order.network} bundle order has been saved. It's on its way to ${order.phone}.`;
  statusModal.classList.add("open");
}

document.getElementById("viewOrdersBtn").addEventListener("click", () => {
  window.location.href = "orders.html";
});
document.getElementById("backHomeBtn").addEventListener("click", () => {
  statusModal.classList.remove("open");
});

/* ---------------- Init ---------------- */
(async function init() {
  bundlesData = await loadBundles();
  renderNetworkTabs();
  renderBundleGrid();
  flushPendingOrders();
})();
