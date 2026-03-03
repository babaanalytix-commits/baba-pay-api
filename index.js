import express from "express";
const app = express();

app.get("/pay", (req, res) => {
  const { product, ref = "" } = req.query;

  if (product !== "GROUPCHAT_EARLY") {
    return res.status(400).json({ error: "Unknown product" });
  }

  res.json({
    chainId: 8453,
    to: "0xeE9E4BF09bf3CAB442EB0aD5730caE511F76BF1B",
    value: "0x0",
    productId: "0x47524f5550434841545f4541524c590000000000000000000000000000000000",
    ref
  });
});

// Render requires listening on process.env.PORT
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});

