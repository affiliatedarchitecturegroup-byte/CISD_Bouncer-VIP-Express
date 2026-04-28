import express from "express";
const app = express();
app.use(express.json());
app.get("/api/sensors", (r, s) => s.json({ data: [] }));
app.get("/api/beacons", (r, s) => s.json({ beacons: [] }));
app.get("/health", (r, s) => s.json({ status: "healthy" }));
const PORT = 6105;
app.listen(PORT, () => console.log("IoTDevices on " + PORT));
export default app;