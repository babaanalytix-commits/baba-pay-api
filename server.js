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
    value: "0x0", // replace with real price later
    productId: "0x47524f5550434841545f4541524c590000000000000000000000000000000000",
    ref
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

