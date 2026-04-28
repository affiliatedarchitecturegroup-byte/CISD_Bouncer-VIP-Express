import express from "express";
const app = express();
app.use(express.json());
app.post("/api/saml", (r, s) => s.json({ assertion: "samlassertion" }));
app.get("/api/directory", (r, s) => s.json({ users: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4100;
app.listen(PORT, () => console.log("SSO on " + PORT));
export default app;