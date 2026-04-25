import express from "express";
const app = express();
app.use(express.json());
app.post("/api/encrypt", (r, s) => s.json({ encrypted: "xxx" }));
app.post("/api/decrypt", (r, s) => s.json({ decrypted: "yyy" }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6401;
app.listen(PORT, () => console.log("DataEncryption on " + PORT));
export default app;