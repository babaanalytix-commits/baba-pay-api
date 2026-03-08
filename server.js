import express from "express";

const app = express();
app.use(express.json());

// -----------------------------
// /pay  → returns payment intent
// -----------------------------
app.get("/pay", (req, res) => {
  const { product, ref = "" } = req.query;

  if (product !== "GROUPCHAT_EARLY") {
    return res.status(400).json({ error: "Unknown product" });
  }

  res.json({
    chainId: 8453,
    to: "0x2AFE5FFe043C1c45843076E65BF93517d37d1Ed7",
    value: "0x0",
    productId:
      "0x47524f5550434841545f4541524c590000000000000000000000000000000000",
    ref
  });
});

// --------------------------------------------
// /verify  → checks a Base transaction by hash
// --------------------------------------------
app.get("/verify", async (req, res) => {
  try {
    const { txHash } = req.query;

    if (!txHash) {
      return res.status(400).json({ ok: false, error: "Missing txHash" });
    }

    const rpc = "https://mainnet.base.org";

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

    if (!tx.result) {
      return res.status(404).json({ ok: false, error: "Transaction not found" });
    }

    const t = tx.result;

    if (t.chainId !== "0x2105") {
      return res.status(400).json({ ok: false, error: "Wrong chain" });
    }

    if (
      t.to.toLowerCase() !==
      "0x2afe5ffe043c1c45843076e65bf93517d37d1ed7".toLowerCase()
    ) {
      return res.status(400).json({ ok: false, error: "Wrong recipient" });
    }

    const data = t.input;

    const productId = data.slice(10, 74);
    const ref = data.slice(74, 138);

    return res.json({
      ok: true,
      productId: "0x" + productId,
      ref: "0x" + ref,
      from: t.from
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
  console.log("Telegram update received:", req.body);

  const msg = req.body.message;
  if (!msg || !msg.text) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text.trim();

  const isTxHash = /^0x[a-fA-F0-9]{64}$/.test(text);

  if (!isTxHash) {
    await fetch(`https://api.telegram.org/bot${process.env.BABA_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "Send your Base transaction hash to unlock access."
      })
    });
    return res.sendStatus(200);
  }

  const verifyUrl = `https://baba-pay-api.onrender.com/verify?txHash=${text}`;

  let result;
  try {
    result = await fetch(verifyUrl).then((r) => r.json());
  } catch (err) {
    console.error("Verify error:", err);
    await fetch(`https://api.telegram.org/bot${process.env.BABA_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "⚠️ Verification server error. Try again shortly."
      })
    });
    return res.sendStatus(200);
  }

  if (!result.ok) {
    await fetch(`https://api.telegram.org/bot${process.env.BABA_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `❌ ${result.error || "Transaction invalid"}`
      })
    });
    return res.sendStatus(200);
  }

  await fetch(`https://api.telegram.org/bot${process.env.BABA_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "✅ Transaction verified!\n\nWelcome to the group. Here is your access link:\n\n<YOUR_GROUP_LINK>"
    })
  });

  res.sendStatus(200);
});

// -----------------------------
// Start server
// -----------------------------
const port = process.env.PORT;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
