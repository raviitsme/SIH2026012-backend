const express = require("express");
const cors = require("cors");
const path = require("path");
const parcelRoutes = require('./routes/parcelRoutes');
const aiRoutes = require('./routes/aiRoutes'); // AI Route Import
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4321;

app.use(cors({
  origin : "*",
  credentials : true,
}));
app.use(express.json());

// Serve uploaded .tiff / GIS files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get("/", (req, res) => {
  res.send("Backend running...");
});

// Existing Parcel Routes
app.use('/api/parcels', parcelRoutes);

// AI Chatbot & Boundary Trace Routes
app.use('/api/ai', aiRoutes);

// Global Error Handler (Multer file type restriction errors capture karega)
app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: err.message || 'File upload error' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Serving the backend at http://localhost:${PORT}`);
});