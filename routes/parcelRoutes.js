const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

// Fixed typo: authenticateToken
const { authenticateToken, authorizeRoles } = require('../middlware/auth');
const { 
  getParcelGeoJSON, 
  updateParcelGeometry, 
  createAdminTask, 
  auditDecision, 
  autoTraceParcels 
} = require('../controllers/parcelController');

// Disk Storage configuration for multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

// Public / Common Routes
router.get('/geojson', getParcelGeoJSON);

// Admin Routes (Supports both field names 'image' or 'file' via upload.single)
router.post('/admin/create', upload.single('image'), createAdminTask);
router.post('/admin/auto-trace-all', upload.single('image'), autoTraceParcels);

// Surveyor Routes
router.post('/save', updateParcelGeometry);
router.post('/surveyor/submit', updateParcelGeometry);

// Auditor Routes
router.post('/auditor/decide', auditDecision);

module.exports = router;