// server.js

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- CONFIG ----------

const PORT = process.env.PORT || 3000;

// On-chain config
const TREASURY_ADDRESS =
  (process.env.TREASURY_ADDRESS || "0x0108b8849C83f725EA434C835068c66e5A568482").toLowerCase();
const USDC_CONTRACT =
  (process.env.USDC_CONTRACT || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913").toLowerCase(); // Base USDC
const BASE_RPC_URL =
  process.env.BASE_RPC_URL || "https://mainnet.base.org";

// Telegram config
const BABA_BOT_TOKEN = process.env.BABA_BOT_TOKEN;
const BABA_GROUP_ID = process.env.BABA_GROUP_ID || "-1001234567891";
const GROUP_INVITE_LINK =
  process.env.BABA_GROUP_INVITE || "https://t.me/+Q_rFuWD-TSE3Yzk8";

// Product config
const PRODUCTS = {
  GROUPCHAT_EARLY: {
    id: "GROUPCHAT_EARLY",
    name: "BABA Analytics – Group Chat Subscription",
    // 12.49 USDC (already early-bird discounted)
    priceUsdc: 12.49,
    // 30 days access
    durationDays: 30
  }
};

// ---------- SIMPLE USER STORE ----------

const USERS_FILE = path.join(__dirname, "users.json");

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// users keyed by wallet (lowercase)
let users = loadUsers();

// ---------- HELPERS ----------

function usdcToBaseUnits(amount) {
  // USDC has 6 decimals
  return BigInt(Math.round(amount * 1_000_000));
}

function encodeErc20Transfer(to, amountBigInt) {
  // function selector: keccak256("transfer(address,uint256)") → 0xa9059cbb
  const selector = "0xa9059cbb";
  const addr = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const value = amountBigInt.toString(16).padStart(64, "0");
  return selector + addr + value;
}

async function sendTelegram(chatId, text, markdown = false) {
  if (!BABA_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${BABA_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: markdown ? "Markdown" : undefined,
    disable_web_page_preview: true
  };
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function autoJoinGroup(telegramId) {
  if (!BABA_BOT_TOKEN || !BABA_GROUP_ID) return;

  const url = `https://api.telegram.org/bot${BABA_BOT_TOKEN}/addChatMember`;
  const body = {
    chat_id: BABA_GROUP_ID,
    user_id: telegramId
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("Auto-join failed:", data);
    }
  } catch (err) {
    console.error("Auto-join error:", err);
  }
}

async function rpcCall(method, params) {
  const res = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "RPC error");
  return json.result;
}

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // keccak256(Transfer(address,address,uint256))

function hexToBigInt(hex) {
  return BigInt(hex);
}

function normalizeAddress(addr) {
  return addr.toLowerCase();
}

// Verify a USDC payment transaction
async function verifyPaymentTx(txHash, expectedProductId) {
  const product = PRODUCTS[expectedProductId];
  if (!product) throw new Error("Unknown product");

  const minAmount = usdcToBaseUnits(product.priceUsdc);

  const tx = await rpcCall("eth_getTransactionByHash", [txHash]);
  if (!tx) throw new Error("Transaction not found");

  const receipt = await rpcCall("eth_getTransactionReceipt", [txHash]);
  if (!receipt || receipt.status !== "0x1") {
    throw new Error("Transaction failed");
  }

  if (!tx.to || normalizeAddress(tx.to) !== USDC_CONTRACT) {
    throw new Error("Not a USDC contract call");
  }

  // Find Transfer event to treasury
  let payer = null;
  let amount = null;

  for (const log of receipt.logs || []) {
    if (!log.topics || log.topics.length < 3) continue;
    if (log.topics[0].toLowerCase() !== TRANSFER_TOPIC) continue;
    if (normalizeAddress(log.address) !== USDC_CONTRACT) continue;

    const from = "0x" + log.topics[1].slice(26);
    const to = "0x" + log.topics[2].slice(26);
    const value = hexToBigInt(log.data);

    if (normalizeAddress(to) === TREASURY_ADDRESS && value >= minAmount) {
      payer = normalizeAddress(from);
      amount = value;
      break;
    }
  }

  if (!payer || !amount) {
    throw new Error("No valid USDC transfer to treasury found");
  }

  return {
    from: payer,
    amount,
    productId: expectedProductId
  };
}

// Extend subscription
function extendSubscription(wallet, productId) {
  const product = PRODUCTS[productId];
  const now = Date.now();
  const current = users[wallet] || {
    wallet,
    telegramId: null,
    subscriptions: {}
  };

  const sub = current.subscriptions[productId] || { expiresAt: 0 };
  const baseTime = sub.expiresAt > now ? sub.expiresAt : now;
  const newExpiry =
    baseTime + product.durationDays * 24 * 60 * 60 * 1000;

  current.subscriptions[productId] = {
    productId,
    expiresAt: newExpiry
  };

  users[wallet] = current;
  saveUsers(users);

  return newExpiry;
}

function findUserByTelegramId(telegramId) {
  for (const wallet of Object.keys(users)) {
    const u = users[wallet];
    if (u.telegramId === telegramId) return u;
  }
  return null;
}

// ---------- CHECKOUT PAGE ----------

app.get("/checkout", (req, res) => {
  const productId = req.query.product || "GROUPCHAT_EARLY";
  const ref = req.query.ref || "";
  const product = PRODUCTS[productId];

  if (!product) {
    return res.status(400).send("Unknown product");
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>BABA Analytics – Group Chat Subscription</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #050816;
      color: #f9fafb;
      margin: 0;
      padding: 0;
      display: flex;
      min-height: 100vh;
      align-items: center;
      justify-content: center;
    }
    .card {
      background: radial-gradient(circle at top, #111827, #020617);
      border-radius: 16px;
      padding: 24px 20px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      border: 1px solid rgba(148,163,184,0.3);
    }
    h1 {
      font-size: 1.4rem;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 0.9rem;
      color: #9ca3af;
      margin-bottom: 16px;
    }
    ul {
      padding-left: 18px;
      margin: 0 0 16px 0;
      font-size: 0.9rem;
      color: #e5e7eb;
    }
    li {
      margin-bottom: 4px;
    }
    .price-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .price {
      font-size: 1.4rem;
      font-weight: 600;
    }
    .discount {
      font-size: 0.8rem;
      color: #22c55e;
      background: rgba(34,197,94,0.1);
      padding: 2px 8px;
      border-radius: 999px;
    }
    .label {
      font-size: 0.8rem;
      color: #9ca3af;
      margin-bottom: 4px;
    }
    .wallet-box {
      background: rgba(15,23,42,0.9);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.8rem;
      border: 1px solid rgba(148,163,184,0.4);
      word-break: break-all;
      margin-bottom: 12px;
    }
    .input {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(148,163,184,0.5);
      background: rgba(15,23,42,0.9);
      color: #f9fafb;
      font-size: 0.9rem;
      margin-bottom: 12px;
      box-sizing: border-box;
    }
    .input::placeholder {
      color: #6b7280;
    }
    .button {
      width: 100%;
      padding: 10px 14px;
      border-radius: 999px;
      border: none;
      background: linear-gradient(to right, #22c55e, #16a34a);
      color: #022c22;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
      margin-bottom: 10px;
    }
    .button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .disclaimer {
      font-size: 0.7rem;
      color: #9ca3af;
      line-height: 1.4;
      border-top: 1px solid rgba(31,41,55,0.9);
      padding-top: 10px;
      margin-top: 10px;
    }
    .footer-note {
      font-size: 0.75rem;
      color: #6b7280;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>BABA Analytics – Group Chat Subscription</h1>
    <div class="subtitle">
      Access the private BABA Analytics Group Chat where members share:
    </div>
    <ul>
      <li>Daily market structure insights</li>
      <li>Real-time trade setups</li>
      <li>Macro context and risk levels</li>
      <li>Direct Q&A and mentorship</li>
      <li>Community discussion with serious traders</li>
    </ul>

    <div class="price-row">
      <div class="price"><span id="priceText">$${product.priceUsdc.toFixed(2)}</span> USDC</div>
      <div class="discount">Early bird discount (50%)</div>
    </div>

    <div class="label">Your Base Wallet</div>
    <div class="wallet-box">
      0x0108b8849C83f725EA434C835068c66e5A568482
    </div>

    <input
      id="walletInput"
      class="input"
      placeholder="Paste the Base wallet you are paying from (0x...)"
    />

    <button id="payButton" class="button">Pay with Wallet</button>

    <div class="footer-note">
      After payment, you'll be redirected to Telegram to complete access.
    </div>

    <div class="disclaimer">
      Disclaimer: BABA Analytics provides educational market research and community discussion.
      Nothing shared in the group constitutes financial advice, investment recommendations, or trading signals.
      All subscription payments are final and non‑refundable.
    </div>
  </div>

  <script>
    const productId = ${JSON.stringify(product.id)};
    const ref = ${JSON.stringify(ref)};
    let payData = null;

    async function loadPricing() {
      try {
        const res = await fetch("/pricing?product=" + encodeURIComponent(productId) + (ref ? "&ref=" + encodeURIComponent(ref) : ""));
        if (!res.ok) return;
        const data = await res.json();
        payData = data;
        document.getElementById("priceText").textContent = "$" + data.priceUsdc.toFixed(2);
      } catch (e) {
        console.error(e);
      }
    }

    async function payWithWallet() {
      const wallet = document.getElementById("walletInput").value.trim();
      if (!wallet.startsWith("0x") || wallet.length !== 42) {
        alert("Please enter a valid Base wallet address.");
        return;
      }

      if (!window.ethereum) {
        alert("No wallet detected. Install MetaMask or Coinbase Wallet.");
        return;
      }

      if (!payData) {
        alert("Pricing not loaded yet.");
        return;
      }

      const button = document.getElementById("payButton");
      button.disabled = true;
      button.textContent = "Waiting for wallet...";

      try {
        await window.ethereum.request({ method: "eth_requestAccounts" });

        const tx = {
          from: wallet,
          to: payData.to,
          data: payData.data,
          value: "0x0"
        };

        const txHash = await window.ethereum.request({
          method: "eth_sendTransaction",
          params: [tx]
        });

        // Redirect to Telegram group (fallback; bot will verify tx)
        window.location.href = ${JSON.stringify(GROUP_INVITE_LINK)};
      } catch (err) {
        console.error(err);
        alert("Payment failed: " + (err && err.message ? err.message : String(err)));
      } finally {
        button.disabled = false;
        button.textContent = "Pay with Wallet";
      }
    }

    document.getElementById("payButton").addEventListener("click", payWithWallet);
    loadPricing();
  </script>
</body>
</html>
  `;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// ---------- PRICING ENDPOINT ----------

app.get("/pricing", (req, res) => {
  const productId = req.query.product || "GROUPCHAT_EARLY";
  const ref = req.query.ref || "";
  const product = PRODUCTS[productId];

  if (!product) {
    return res.status(400).json({ error: "Unknown product" });
  }

  const amount = usdcToBaseUnits(product.priceUsdc);
  const data = encodeErc20Transfer(TREASURY_ADDRESS, amount);

  res.json({
    productId,
    priceUsdc: product.priceUsdc,
    to: USDC_CONTRACT,
    data,
    ref: ref || null
  });
});

// ---------- TELEGRAM WEBHOOK ----------

app.post("/telegram/webhook/:token", async (req, res) => {
  try {
    if (!BABA_BOT_TOKEN || req.params.token !== BABA_BOT_TOKEN) {
      return res.status(403).send("Forbidden");
    }

    const update = req.body;
    const message = update.message || update.edited_message;
    if (!message) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = (message.text || "").trim();

    // /start
    if (text.startsWith("/start")) {
      await sendTelegram(
        chatId,
        "👋 Welcome to BABA Analytics.\n\n" +
          "To join the private group:\n" +
          "1. Pay your subscription in USDC on Base:\n" +
          "   https://baba-pay-api.onrender.com/checkout?product=GROUPCHAT_EARLY\n\n" +
          "2. After paying, send me your transaction hash (0x...).\n\n" +
          "I'll verify it on-chain and activate your access.",
        false
      );
      return res.sendStatus(200);
    }

    // /status
    if (text.startsWith("/status")) {
      const user = findUserByTelegramId(chatId);
      if (!user || !user.subscriptions || !user.subscriptions.GROUPCHAT_EARLY) {
        await sendTelegram(
          chatId,
          "ℹ️ You don't have an active subscription yet.\n\n" +
            "Subscribe here:\n" +
            "https://baba-pay-api.onrender.com/checkout?product=GROUPCHAT_EARLY",
          false
        );
        return res.sendStatus(200);
      }

      const sub = user.subscriptions.GROUPCHAT_EARLY;
      const expiryStr = new Date(sub.expiresAt).toUTCString();
      const referralLink = `https://baba-pay-api.onrender.com/checkout?product=GROUPCHAT_EARLY&ref=${user.wallet}`;

      await sendTelegram(
        chatId,
        `✅ *Subscription Active*\n\n` +
          `Active until *${expiryStr}*.\n\n` +
          `🔗 *Group Access Link:*\n${GROUP_INVITE_LINK}\n\n` +
          `💡 *Earn 50% off next month for each friend you invite!*\n` +
          `Share your referral link:\n${referralLink}`,
        true
      );
      return res.sendStatus(200);
    }

    // Transaction hash
    if (/^0x[0-9a-fA-F]{64}$/.test(text)) {
      const txHash = text;

      try {
        const result = await verifyPaymentTx(txHash, "GROUPCHAT_EARLY");
        const wallet = result.from;

        // Link wallet ↔ Telegram
        const nowUser = users[wallet] || {
          wallet,
          telegramId: chatId,
          subscriptions: {}
        };
        nowUser.telegramId = chatId;
        users[wallet] = nowUser;

        const newExpiry = extendSubscription(wallet, "GROUPCHAT_EARLY");
        const expiryStr = new Date(newExpiry).toUTCString();

        // Auto-join group
        await autoJoinGroup(chatId);

        const referralLink = `https://baba-pay-api.onrender.com/checkout?product=GROUPCHAT_EARLY&ref=${wallet}`;

        await sendTelegram(
          chatId,
          `🎉 *Subscription Activated!*\n\n` +
            `Your access is active until *${expiryStr}*.\n\n` +
            `🔗 *Group Access Link:*\n${GROUP_INVITE_LINK}\n\n` +
            `💡 *Earn 50% off next month for each friend you invite!*\n` +
            `Share your referral link:\n${referralLink}`,
          true
        );
      } catch (err) {
        console.error("Verification error:", err);
        await sendTelegram(
          chatId,
          "❌ Could not verify that transaction.\n\n" +
            "Make sure:\n" +
            "- You paid in USDC on Base\n" +
            "- You sent the correct transaction hash\n" +
            "- The payment was sent to the correct treasury address\n\n" +
            "If you believe this is an error, send the hash again.",
          false
        );
      }

      return res.sendStatus(200);
    }

    // Fallback
    await sendTelegram(
      chatId,
      "Send /start to see how to subscribe, or send me a transaction hash (0x...) to verify your payment.",
      false
    );
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(200);
  }
});

// ---------- HEALTH ----------

app.get("/", (req, res) => {
  res.send("BABA Analytics pay API is running.");
});

// ---------- START ----------

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
