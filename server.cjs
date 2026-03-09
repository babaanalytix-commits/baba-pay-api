// server.cjs
// BABA Analytics — Professional Trader Edition (Updated Pricing + Payment Address)

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// ============================================================================
// PAYMENT ADDRESS (UPDATED)
// ============================================================================
const PAYMENT_ADDRESS = "0x2AFE5FFe043C1c45843076E65BF93517d37d1Ed7".toLowerCase();

// ============================================================================
// ON-CHAIN CONFIG
// ============================================================================
const USDC_CONTRACT = (process.env.USDC_CONTRACT || "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913").toLowerCase();
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// ============================================================================
// TELEGRAM CONFIG
// ============================================================================
const BABA_BOT_TOKEN = process.env.BABA_BOT_TOKEN;
const GROUPCHAT_ID = process.env.BABA_GROUP_ID || "-1001234567891";
const GROUPCHAT_INVITE = process.env.BABA_GROUP_INVITE || "https://t.me/+Q_rFuWD-TSE3Yzk8";
const BMI_CHANNEL_ID = process.env.BMI_CHANNEL_ID || "-1003760311302";
const BMI_CHANNEL_INVITE = process.env.BMI_CHANNEL_INVITE || "https://t.me/+UcwflfIClUAwMzQ8";

// ============================================================================
// PRODUCT CONFIG (UPDATED PRICING)
// Full price: 24.99
// Discounted price: 12.49 until March 14
// ============================================================================
const DISCOUNT_PRICE = 12.49;
const FULL_PRICE = 24.99;
const DISCOUNT_END = "2025-03-14";

const PRODUCTS = {
  GROUPCHAT_EARLY: {
    id: "GROUPCHAT_EARLY",
    name: "BABA Analytics — Educational Group Chat",
    priceUsdc: DISCOUNT_PRICE,
    fullPriceUsdc: FULL_PRICE,
    discountEnds: DISCOUNT_END,
    durationDays: 30,
    type: "groupchat",
    features: [
      "Structured market discussions",
      "Research‑driven insights",
      "Mentorship‑style guidance",
      "On‑chain tooling literacy",
      "Execution frameworks and process thinking",
      "Community knowledge‑sharing"
    ]
  },

  BMI: {
    id: "BMI",
    name: "BABA Analytics — BMI Research Channel",
    priceUsdc: DISCOUNT_PRICE,
    fullPriceUsdc: FULL_PRICE,
    discountEnds: DISCOUNT_END,
    durationDays: 30,
    type: "bmi",
    features: [
      "Narrative‑driven market context",
      "Structural shifts and macro themes",
      "Key levels for educational framing",
      "On‑chain observations",
      "Research‑oriented commentary"
    ]
  }
};

// ============================================================================
// USER STORE
// ============================================================================
const USERS_FILE = path.join(__dirname, "users.json");

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let users = loadUsers();

// ============================================================================
// HELPERS
// ============================================================================
function usdcToBaseUnits(amount) {
  return BigInt(Math.round(amount * 1_000_000));
}

function encodeErc20Transfer(to, amountBigInt) {
  const selector = "0xa9059cbb";
  const addr = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const value = amountBigInt.toString(16).padStart(64, "0");
  return selector + addr + value;
}

async function rpcCall(method, params) {
  const res = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function sendTelegram(chatId, text, markdown = false) {
  if (!BABA_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BABA_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: markdown ? "Markdown" : undefined,
      disable_web_page_preview: true
    })
  });
}

async function autoJoinGroup(telegramId) {
  if (!BABA_BOT_TOKEN || !GROUPCHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BABA_BOT_TOKEN}/addChatMember`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: GROUPCHAT_ID, user_id: telegramId })
  });
}

function normalizeAddress(addr) {
  return addr.toLowerCase();
}

function hexToBigInt(hex) {
  return BigInt(hex);
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function inferProductByAmount(amount) {
  let best = null;
  let bestDiff = null;

  for (const id of Object.keys(PRODUCTS)) {
    const target = usdcToBaseUnits(PRODUCTS[id].priceUsdc);
    const diff = amount > target ? amount - target : target - amount;
    if (bestDiff === null || diff < bestDiff) {
      bestDiff = diff;
      best = id;
    }
  }

  const tolerance = usdcToBaseUnits(0.01);
  return bestDiff !== null && bestDiff <= tolerance ? best : null;
}

function extendSubscription(wallet, productId) {
  const product = PRODUCTS[productId];
  const now = Date.now();
  const user = users[wallet] || { wallet, telegramId: null, subscriptions: {} };

  const sub = user.subscriptions[productId] || { expiresAt: 0 };
  const base = sub.expiresAt > now ? sub.expiresAt : now;
  const newExpiry = base + product.durationDays * 24 * 60 * 60 * 1000;

  user.subscriptions[productId] = { productId, expiresAt: newExpiry };
  users[wallet] = user;
  saveUsers(users);

  return newExpiry;
}

function findUserByTelegramId(id) {
  return Object.values(users).find(u => u.telegramId === id) || null;
}
// ============================================================================
// PRICING ROUTE (UPDATED PRICING + PAYMENT ADDRESS)
// ============================================================================
app.get("/pricing", (req, res) => {
  const productId = req.query.product;
  const product = PRODUCTS[productId];

  if (!product) return res.status(400).json({ error: "Unknown product" });

  const amount = usdcToBaseUnits(product.priceUsdc);
  const data = encodeErc20Transfer(PAYMENT_ADDRESS, amount);

  res.json({
    productId,
    priceUsdc: product.priceUsdc,
    fullPriceUsdc: product.fullPriceUsdc,
    discountEnds: product.discountEnds,
    to: USDC_CONTRACT,
    paymentAddress: PAYMENT_ADDRESS,
    data
  });
});

// ============================================================================
// PREMIUM CHECKOUT PAGE (UPDATED PRICING + PAYMENT ADDRESS + DISCOUNT)
// ============================================================================
app.get("/checkout", (req, res) => {
  const productId = req.query.product || "GROUPCHAT_EARLY";
  const product = PRODUCTS[productId];

  if (!product) return res.status(400).send("Unknown product");

  const featureList = product.features.map(f => `<li>${f}</li>`).join("");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${product.name}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body {
    margin: 0;
    padding: 0;
    background: #0B0E11;
    color: #E5E7EB;
    font-family: Inter, system-ui, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
  }
  .card {
    background: #111418;
    border: 1px solid #1F2937;
    border-radius: 12px;
    padding: 28px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  h1 {
    font-size: 1.4rem;
    margin-bottom: 6px;
    color: #F3F4F6;
  }
  .subtitle {
    font-size: 0.9rem;
    color: #9CA3AF;
    margin-bottom: 16px;
  }
  ul {
    margin: 0 0 16px 0;
    padding-left: 18px;
    color: #D1D5DB;
    font-size: 0.85rem;
  }
  .price-box {
    margin-bottom: 16px;
  }
  .full-price {
    text-decoration: line-through;
    color: #6B7280;
    font-size: 0.9rem;
  }
  .discount-price {
    font-size: 1.6rem;
    font-weight: 600;
    color: #16A34A;
  }
  .discount-note {
    font-size: 0.75rem;
    color: #9CA3AF;
    margin-top: 4px;
  }
  .label {
    font-size: 0.8rem;
    color: #9CA3AF;
    margin-bottom: 4px;
  }
  .wallet-box {
    background: #0F1317;
    border: 1px solid #1F2937;
    padding: 10px 12px;
    border-radius: 8px;
    font-size: 0.8rem;
    margin-bottom: 12px;
    word-break: break-all;
  }
  .input {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #374151;
    background: #0F1317;
    color: #F3F4F6;
    margin-bottom: 16px;
    font-size: 0.9rem;
  }
  .button {
    width: 100%;
    padding: 12px;
    border-radius: 8px;
    background: #16A34A;
    color: #0B0E11;
    font-weight: 600;
    border: none;
    cursor: pointer;
    margin-bottom: 12px;
  }
  .button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .disclaimer {
    font-size: 0.7rem;
    color: #6B7280;
    line-height: 1.4;
    border-top: 1px solid #1F2937;
    padding-top: 12px;
    margin-top: 12px;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>${product.name}</h1>
    <div class="subtitle">Educational access for independent traders.</div>

    <ul>${featureList}</ul>

    <div class="price-box">
      <div class="full-price">${product.fullPriceUsdc.toFixed(2)} USDC</div>
      <div class="discount-price">${product.priceUsdc.toFixed(2)} USDC</div>
      <div class="discount-note">50% off until March 14</div>
    </div>

    <div class="label">Payment Address</div>
    <div class="wallet-box">${PAYMENT_ADDRESS}</div>

    <input id="walletInput" class="input" placeholder="Your Base wallet (0x...)" />

    <button id="payButton" class="button">Pay with Wallet</button>

    <div class="disclaimer">
      BABA Analytics provides educational content and market research focused on blockchain‑based tools and on‑chain market structure. Nothing provided constitutes financial advice, investment recommendations, or trading signals. Members are responsible for their own decisions.
    </div>
  </div>

<script>
  const productId = ${JSON.stringify(product.id)};

  async function loadPricing() {
    try {
      const res = await fetch("/pricing?product=" + productId);
      if (!res.ok) return;
      window.payData = await res.json();
    } catch (e) {
      console.error(e);
    }
  }

  loadPricing();

  document.getElementById("payButton").onclick = async () => {
    const wallet = document.getElementById("walletInput").value.trim();
    if (!wallet.startsWith("0x") || wallet.length !== 42) {
      alert("Enter a valid Base wallet address.");
      return;
    }

    if (!window.ethereum) {
      alert("No wallet detected.");
      return;
    }

    const button = document.getElementById("payButton");
    button.disabled = true;
    button.textContent = "Waiting for wallet...";

    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });

      const tx = {
        from: wallet,
        to: window.payData.to,
        data: window.payData.data,
        value: "0x0"
      };

      await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [tx]
      });

      window.location.href = "https://t.me/BABAANALYTIC";
    } catch (err) {
      console.error(err);
      alert("Transaction cancelled.");
      button.disabled = false;
      button.textContent = "Pay with Wallet";
    }
  };
</script>

</body>
</html>
`;

  res.send(html);
});
// ============================================================================
// VERIFY PAYMENT (UPDATED FOR NEW PAYMENT ADDRESS + PRICING)
// ============================================================================
app.post("/verify", async (req, res) => {
  try {
    const { txHash, telegramId } = req.body;
    if (!txHash || !telegramId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Fetch transaction + receipt
    const tx = await rpcCall("eth_getTransactionByHash", [txHash]);
    const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);

    if (!tx || !receipt || receipt.status !== "0x1") {
      return res.status(400).json({ error: "Transaction failed" });
    }

    // Must be a USDC transfer
    if (!tx.to || normalizeAddress(tx.to) !== USDC_CONTRACT) {
      return res.status(400).json({ error: "Not a USDC transfer" });
    }

    // Parse logs to find transfer to PAYMENT_ADDRESS
    let payer = null;
    let amount = null;

    for (const log of receipt.logs || []) {
      if (!log.topics || log.topics.length < 3) continue;
      if (log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
      if (normalizeAddress(log.address) !== USDC_CONTRACT) continue;

      const from = "0x" + log.topics[1].slice(26);
      const to = "0x" + log.topics[2].slice(26);
      const value = hexToBigInt(log.data);

      if (normalizeAddress(to) === PAYMENT_ADDRESS) {
        payer = normalizeAddress(from);
        amount = value;
        break;
      }
    }

    if (!payer || !amount) {
      return res.status(400).json({ error: "No USDC transfer to payment address" });
    }

    // Infer product by amount (12.49 USDC)
    const productId = inferProductByAmount(amount);
    if (!productId) {
      return res.status(400).json({ error: "Amount does not match any product" });
    }

    // Extend subscription
    const expiry = extendSubscription(payer, productId);

    // Attach Telegram ID
    const user = users[payer];
    user.telegramId = telegramId;
    saveUsers(users);

    // Deliver access
    if (productId === "GROUPCHAT_EARLY") {
      await autoJoinGroup(telegramId);
      await sendTelegram(
        telegramId,
        `Access granted.\n\nGroup Chat: ${GROUPCHAT_INVITE}`
      );
    } else {
      await sendTelegram(
        telegramId,
        `Access granted.\n\nBMI Research Channel: ${BMI_CHANNEL_INVITE}`
      );
    }

    res.json({ success: true, productId, expiresAt: expiry });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ============================================================================
// LINK WALLET TO TELEGRAM
// ============================================================================
app.post("/link_wallet", (req, res) => {
  const { wallet, telegramId } = req.body;
  if (!wallet || !telegramId) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const w = wallet.toLowerCase();
  const user = users[w] || { wallet: w, telegramId: null, subscriptions: {} };
  user.telegramId = telegramId;
  users[w] = user;
  saveUsers(users);

  res.json({ success: true });
});

// ============================================================================
// STATUS — GROUP CHAT
// ============================================================================
app.get("/status", (req, res) => {
  const wallet = req.query.wallet?.toLowerCase();
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  const user = users[wallet];
  if (!user) return res.json({ active: false });

  const sub = user.subscriptions["GROUPCHAT_EARLY"];
  if (!sub) return res.json({ active: false });

  res.json({
    active: sub.expiresAt > Date.now(),
    expiresAt: sub.expiresAt
  });
});

// ============================================================================
// STATUS — BMI CHANNEL
// ============================================================================
app.get("/status_bmi", (req, res) => {
  const wallet = req.query.wallet?.toLowerCase();
  if (!wallet) return res.status(400).json({ error: "Missing wallet" });

  const user = users[wallet];
  if (!user) return res.json({ active: false });

  const sub = user.subscriptions["BMI"];
  if (!sub) return res.json({ active: false });

  res.json({
    active: sub.expiresAt > Date.now(),
    expiresAt: sub.expiresAt
  });
});
// ============================================================================
// TELEGRAM WEBHOOK (LIGHTWEIGHT + SAFE)
// ============================================================================
app.post("/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    const chatId = update.message.chat.id;
    const text = (update.message.text || "").trim();

    // Basic onboarding
    if (text === "/start") {
      await sendTelegram(
        chatId,
        "Welcome to BABA Analytics.\n\n" +
        "This bot helps you verify your subscription after paying in USDC on Base.\n\n" +
        "After completing payment, send your transaction hash here."
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Telegram webhook error:", err);
    res.sendStatus(200);
  }
});

// ============================================================================
// START SERVER
// ============================================================================
app.listen(PORT, () => {
  console.log(`BABA Analytics server running on port ${PORT}`);
});

