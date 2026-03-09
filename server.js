import express from "express";
import fs from "fs";
import path from "path";

// -----------------------------
// Constants
// -----------------------------
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913".toLowerCase();
const TREASURY = "0x2AFE5FFe043C1c45843076E65BF93517d37d1Ed7".toLowerCase();
const TRANSFER_SELECTOR = "0xa9059cbb"; // transfer(address,uint256)
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // keccak256("Transfer(address,address,uint256)")

// -----------------------------
// User storage
// -----------------------------
const USERS_FILE = path.join(process.cwd(), "data", "users.json");

function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// -----------------------------
// Express app
// -----------------------------
const app = express();
app.use(express.json());

// -----------------------------
// /pay → pricing + USDC calldata (API)
// -----------------------------
app.get("/pay", (req, res) => {
  const { product, ref = "", wallet, telegramId } = req.query;

  if (product !== "GROUPCHAT_EARLY") {
    return res.status(400).json({ error: "Unknown product" });
  }

  // Identify user
  let userKey = null;
  if (wallet) userKey = String(wallet).toLowerCase();
  else if (telegramId) userKey = `tg_${telegramId}`;
  else return res.status(400).json({ error: "Missing user identifier" });

  const users = loadUsers();
  let user = users[userKey];

  if (!user) {
    user = {
      wallet: wallet ? String(wallet).toLowerCase() : null,
      telegramId: telegramId ? Number(telegramId) : null,
      referralCredits: 0,
      isEarlyContributor: false,
      subscriptionExpires: null
    };
    users[userKey] = user;
  }

  // Pricing logic
  const basePrice = 24.99;
  let price = basePrice;
  let discountReason = null;
  let discountPercent = "0%";

  const now = new Date();
  const earlyBirdDeadline = new Date("2026-03-14T23:59:59Z");

  if (now < earlyBirdDeadline) {
    price = 12.49;
    discountReason = "Early bird discount (50%)";
    discountPercent = "50%";
  }

  if (user.isEarlyContributor) {
    price = 12.49;
    discountReason = "Early contributor (lifetime 50%)";
    discountPercent = "50%";
  }

  if (user.referralCredits > 0) {
    price = 12.49;
    discountReason = "Referral credit (50% off this month)";
    discountPercent = "50%";
    user.referralCredits -= 1;
  }

  users[userKey] = user;
  saveUsers(users);

  // Convert price → USDC units (6 decimals)
  const amountUnits = Math.round(price * 1e6);
  const amountHex = amountUnits.toString(16).padStart(64, "0");
  const treasuryPadded = TREASURY.replace("0x", "").padStart(64, "0");

  const data = TRANSFER_SELECTOR + treasuryPadded + amountHex;

  res.json({
    priceUSD: price.toFixed(2),
    discount: discountPercent,
    discountReason,
    referralCreditsRemaining: user.referralCredits,
    isEarlyContributor: user.isEarlyContributor,
    chainId: 8453,
    to: USDC,
    value: "0x0",
    data,
    productId:
      "0x47524f5550434841545f4541524c590000000000000000000000000000000000",
    ref
  });
});

// --------------------------------------------
// /checkout → Human-friendly payment page (auto-pricing)
// --------------------------------------------
app.get("/checkout", async (req, res) => {
  const { product, wallet = "", ref = "" } = req.query;

  if (!product) return res.send("Missing product");

  const safeWallet = String(wallet || "").trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>BABA Analytics – Group Chat Subscription</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      max-width: 480px;
      margin: 40px auto;
      padding: 20px;
      color: #111;
      line-height: 1.5;
    }
    .card {
      border: 1px solid #ddd;
      padding: 24px;
      border-radius: 14px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.08);
      margin-top: 20px;
    }
    .price {
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .discount {
      color: #0a8f3c;
      margin-bottom: 20px;
      font-size: 15px;
    }
    button {
      background: black;
      color: white;
      padding: 14px;
      width: 100%;
      border: none;
      border-radius: 8px;
      font-size: 17px;
      cursor: pointer;
      margin-top: 10px;
    }
    input {
      width: 100%;
      padding: 12px;
      font-size: 16px;
      border: 1px solid #ccc;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    label {
      font-size: 14px;
      font-weight: 500;
    }
    ul {
      margin-top: 10px;
      padding-left: 20px;
    }
  </style>
</head>
<body>

  <h2>BABA Analytics – Group Chat Subscription</h2>
  <p>
    Access the private BABA Analytics Group Chat where Yomi shares:
  </p>
  <ul>
    <li>Daily market structure insights</li>
    <li>Real-time trade setups</li>
    <li>Macro context and risk levels</li>
    <li>Direct Q&A and mentorship</li>
    <li>Community discussion with serious traders</li>
  </ul>

  <div class="card">
    <div id="priceBlock">
      <div class="price">Paste your wallet to see price</div>
    </div>

    <label>Your Base Wallet</label>
    <input id="walletInput" value="${safeWallet}" placeholder="0x..." />

    <button onclick="payWithWallet()">Pay with Wallet</button>

    <p style="font-size: 12px; color: #666; margin-top: 14px;">
      <strong>Disclaimer:</strong> BABA Analytics provides educational market research and community discussion.
      Nothing shared in the group constitutes financial advice, investment recommendations, or trading signals.
      All subscription payments are final and non‑refundable.
    </p>
  </div>

<script>
let payData = null;

async function fetchPricing() {
  const wallet = document.getElementById("walletInput").value.trim();
  if (!wallet.startsWith("0x") || wallet.length !== 42) {
    document.getElementById("priceBlock").innerHTML =
      "<div class='price'>Paste your wallet to see price</div>";
    return;
  }

  const url = "/pay?product=${product}&wallet=" + wallet + "&ref=${ref}";
  const pay = await fetch(url).then(r => r.json());
  payData = pay;

  document.getElementById("priceBlock").innerHTML = 
    "<div class='price'>$" + pay.priceUSD + " USDC</div>" +
    "<div class='discount'>" + (pay.discountReason || "") + "</div>";
}

document.getElementById("walletInput").addEventListener("input", fetchPricing);
fetchPricing();

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

  const tx = {
    from: wallet,
    to: payData.to,
    data: payData.data,
    value: "0x0"
  };

  try {
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [tx]
    });

    window.location.href = "https://t.me/BABAANALYTIC";
  } catch (err) {
    console.error(err);
    alert("Payment failed: " + err.message);
  }
}
</script>

</body>
</html>
  `;

  res.send(html);
});

// -----------------------------
// /verify → USDC Transfer log verification
// -----------------------------
app.get("/verify", async (req, res) => {
  try {
    const { txHash } = req.query;
    if (!txHash) return res.status(400).json({ ok: false, error: "Missing txHash" });

    const rpc = "https://mainnet.base.org";

    // Fetch transaction
    const tx = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_getTransactionByHash",
        params: [txHash]
      })
    }).then((r) => r.json());

    if (!tx.result) return res.status(404).json({ ok: false, error: "Transaction not found" });

    const t = tx.result;

    // Must be sent to USDC contract
    if (!t.to || t.to.toLowerCase() !== USDC) {
      return res.status(400).json({ ok: false, error: "Not a USDC transfer" });
    }

    // Fetch receipt for logs
    const receipt = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash]
      })
    }).then((r) => r.json());

    if (!receipt.result) {
      return res.status(400).json({ ok: false, error: "Receipt not found" });
    }

    const logs = receipt.result.logs || [];
    const from = t.from.toLowerCase();

    // Find Transfer event
    let amountUnits = null;
    let validTransfer = false;

    for (const log of logs) {
      if (
        log.address.toLowerCase() === USDC &&
        log.topics[0].toLowerCase() === TRANSFER_TOPIC &&
        log.topics[1].toLowerCase().endsWith(from.slice(2)) &&
        log.topics[2].toLowerCase().endsWith(TREASURY.slice(2))
      ) {
        amountUnits = parseInt(log.data, 16);
        validTransfer = true;
        break;
      }
    }

    if (!validTransfer) {
      return res.status(400).json({ ok: false, error: "No valid USDC transfer found" });
    }

    // Subscription lifecycle
    const users = loadUsers();
    let user = users[from] || {
      wallet: from,
      telegramId: null,
      referralCredits: 0,
      isEarlyContributor: false,
      subscriptionExpires: null
    };

    const now = new Date();
    const oneMonthMs = 30 * 24 * 60 * 60 * 1000;

    let newExpiry;
    if (user.subscriptionExpires) {
      const current = new Date(user.subscriptionExpires);
      newExpiry = current > now ? new Date(current.getTime() + oneMonthMs) : new Date(now.getTime() + oneMonthMs);
    } else {
      newExpiry = new Date(now.getTime() + oneMonthMs);
    }

    user.subscriptionExpires = newExpiry.toISOString();

    // Referral crediting
    const data = t.input || "0x";
    const refRaw = data.length >= 138 ? data.slice(74, 138) : null;
    let refAddress = null;

    if (refRaw && refRaw !== "".padStart(64, "0")) {
      const addr = "0x" + refRaw.slice(24);
      if (addr.toLowerCase() !== from) {
        refAddress = addr.toLowerCase();
        let refUser = users[refAddress] || {
          wallet: refAddress,
          telegramId: null,
          referralCredits: 0,
          isEarlyContributor: false,
          subscriptionExpires: null
        };
        refUser.referralCredits += 1;
        users[refAddress] = refUser;
      }
    }

    users[from] = user;
    saveUsers(users);

    return res.json({
      ok: true,
      from,
      amountUnits,
      subscriptionExpires: user.subscriptionExpires,
      ref: refAddress
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --------------------------------------------
// Telegram Webhook
// --------------------------------------------
app.post(`/telegram/webhook/${process.env.BABA_BOT_TOKEN}`, async (req, res) => {
  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // /status
  if (text === "/status") {
    const users = loadUsers();
    let user = Object.values(users).find((u) => u.telegramId === chatId);

    if (!user) {
      await sendTelegram(
        chatId,
        "ℹ️ You don't have an active subscription yet.\n\nSubscribe here:\nhttps://baba-pay-api.onrender.com/checkout?product=GROUPCHAT_EARLY"
      );
      return res.sendStatus(200);
    }

    const expiry = user.subscriptionExpires
      ? new Date(user.subscriptionExpires).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric"
        })
      : "No active subscription";

    const referralLink = user.wallet
      ? `https://baba-pay-api.onrender.com/checkout?product=GROUPCHAT_EARLY&ref=${user.wallet}`
      : "No wallet linked";

    const early = user.isEarlyContributor ? "Yes (lifetime 50% off)" : "No";

    await sendTelegram(
      chatId,
      `📊 *Your Subscription Status*\n\n` +
        `🗓 *Expires:* ${expiry}\n` +
        `💎 *Early Contributor:* ${early}\n` +
        `🎁 *Referral Credits:* ${user.referralCredits}\n\n` +
        `🔗 *Your Referral Link:*\n${referralLink}`,
      true
    );

    return res.sendStatus(200);
  }

  // Tx hash flow
  const isTxHash = /^0x[a-fA-F0-9]{64}$/.test(text);
  if (!isTxHash) {
    await sendTelegram(chatId, "Send your Base transaction hash to unlock access.");
    return res.sendStatus(200);
  }

  const verifyUrl = `https://baba-pay-api.onrender.com/verify?txHash=${text}`;
  const result = await fetch(verifyUrl).then((r) => r.json());

  if (!result.ok) {
    await sendTelegram(chatId, `❌ ${result.error || "Transaction invalid"}`);
    return res.sendStatus(200);
  }

  const users = loadUsers();
  let user = users[result.from] || {
    wallet: result.from,
    telegramId: chatId,
    referralCredits: 0,
    isEarlyContributor: false,
    subscriptionExpires: result.subscriptionExpires
  };
  user.telegramId = chatId;
  users[result.from] = user;
  saveUsers(users);

  const expiryStr = new Date(result.subscriptionExpires).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const referralLink = `https://baba-pay-api.onrender.com/checkout?product=GROUPCHAT_EARLY&ref=${result.from}`;

  await sendTelegram(
    chatId,
    `🎉 *Subscription Activated!*\n\n` +
      `Your access is active until *${expiryStr}*.\n\n` +
      `🔗 *Group Access Link:*\nhttps://t.me/BABAANALYTIC\n\n` +
      `💡 *Earn 50% off next month for each friend you invite!*\n` +
      `Share your referral link:\n${referralLink}`,
    true
  );

  res.sendStatus(200);
});

// -----------------------------
// Helper: Telegram send
// -----------------------------
async function sendTelegram(chatId, text, markdown = false) {
  await fetch(`https://api.telegram.org/bot${process.env.BABA_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: markdown ? "Markdown" : undefined
    })
  });
}

// -----------------------------
// Start server
// -----------------------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

