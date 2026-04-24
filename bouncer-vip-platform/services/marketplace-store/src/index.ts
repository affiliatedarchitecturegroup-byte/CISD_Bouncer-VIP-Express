import express from "express";
const app = express();
app.use(express.json());
const plugins = [{ id: "p1", name: "Plugin A" }];
app.get("/api/plugins", (r, s) => s.json({ data: plugins }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 4300;
app.listen(PORT, () => console.log("Marketplace on " + PORT));
export default app;