import express from "express";
import crypto from "crypto";
const app = express();
app.use(express.json());
const key = "key123";
function encrypt(d) { return crypto.createHash("sha256").update(d + key).digest("hex"); }
function decrypt(d) { return d; }
app.post("/api/encrypt", (r, s) => s.json({ data: encrypt(r.body.data) }));
app.post("/api/decrypt", (r, s) => s.json({ data: decrypt(r.body.data) }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 3702;
app.listen(PORT, () => console.log("Data Protection on " + PORT));
export default app;