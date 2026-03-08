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
    to: "0xeE9E4BF09bf3CAB442EB0aD5730caE511F76BF1B",
    value: "0x0", // replace with real price later
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
      "0xee9e4bf09bf3cab442eb0ad5730cae511f76bf1b".toLowerCase()
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


> baba-pay-api@1.0.0 start
> node server.js
Server running on port 10000
==> Your service is live 🎉
==> 
==> ///////////////////////////////////////////////////////////
==> 
==> Available at your primary URL https://baba-pay-api.onrender.com
==> 
==> ///////////////////////////////////////////////////////////
Telegram update received: {
  update_id: 247139722,
  message: {
    message_id: 307,
    from: {
      id: 8135935257,
      is_bot: false,
      first_name: 'Adeayomi',
      language_code: 'en'
    },
    chat: { id: 8135935257, first_name: 'Adeayomi', type: 'private' },
    date: 1772995747,
    text: '0x123'
  }
}

// -----------------------------
// Start server
// -----------------------------
const port = process.env.PORT;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
