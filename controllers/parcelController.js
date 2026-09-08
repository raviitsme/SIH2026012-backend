const pool = require("../config/db");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");

// 1. GET ALL PARCELS AS GEOJSON (Returns latest auditor comments & surveyor notes)
const getParcelGeoJSON = async (req, res) => {
  try {
    // Spatial GeoJSON Query with NULL and Empty table safety
    const query = `
      SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(geom)::jsonb,
              'properties', to_jsonb(p) - 'geom'
            )
          ) FILTER (WHERE geom IS NOT NULL),
          '[]'::jsonb
        )
      ) AS geojson
      FROM parcels p;
    `;

    const { rows } = await pool.query(query);

    // Safety fallback for empty features
    const geojson = rows[0]?.geojson || { type: 'FeatureCollection', features: [] };

    res.status(200).json(geojson);
  } catch (err) {
    // VS Code Terminal par Exact Error log print hoga
    console.error('❌ SPATIAL QUERY FAILED:', err.stack || err.message);
    res.status(500).json({ 
      error: 'Internal server spatial query error', 
      details: err.message 
    });
  }
};

// 2. ADMIN: Create Parcel & Upload Satellite/Drone Reference Image
const createAdminTask = async (req, res) => {
  const { parcel_id, owner_name, land_use } = req.body;
  const imageUrl = req.file
    ? `/uploads/${req.file.filename || "uploaded_image"}`
    : null;

  if (!parcel_id) {
    return res.status(400).json({ error: "Parcel ID is required." });
  }

  try {
    let targetGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [77.209, 28.6139],
          [77.2095, 28.6139],
          [77.2095, 28.6144],
          [77.209, 28.6144],
          [77.209, 28.6139],
        ],
      ],
    };

    if (req.file) {
      try {
        const formData = new FormData();

        if (req.file.path && fs.existsSync(req.file.path)) {
          formData.append("file", fs.createReadStream(req.file.path), {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
          });
        } else if (req.file.buffer) {
          formData.append("file", req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype,
          });
        }

        const aiResponse = await axios.post(
          "http://127.0.0.1:8000/extract-boundary",
          formData,
          {
            headers: { ...formData.getHeaders() },
            timeout: 30000,
          },
        );

        if (aiResponse.data && aiResponse.data.geometry) {
          targetGeometry = aiResponse.data.geometry;
          console.log("AI Auto-Boundary Extraction Successful!");
        }
      } catch (err) {
        console.error("❌ SPATIAL QUERY ERROR:", err.stack || err);
        res
          .status(500)
          .json({
            error: "Internal server spatial query error",
            message: err.message,
          });
      }
    }

    const query = `
      INSERT INTO parcels (parcel_id, owner_name, land_use, image_url, status, geom)
      VALUES ($1, $2, $3, $4, 'Pending Survey', ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))
      ON CONFLICT (parcel_id) DO UPDATE SET
        owner_name = EXCLUDED.owner_name,
        land_use = EXCLUDED.land_use,
        image_url = COALESCE(EXCLUDED.image_url, parcels.image_url),
        geom = EXCLUDED.geom,
        status = 'Pending Survey',
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, parcel_id, status;
    `;

    const values = [
      parcel_id,
      owner_name || "N/A",
      land_use || "Residential",
      imageUrl,
      JSON.stringify(targetGeometry),
    ];

    const result = await pool.query(query, values);

    return res.json({
      message: "Task created with AI Boundary extraction successfully!",
      parcel: result.rows[0],
    });
  } catch (err) {
    console.error("❌ SPATIAL QUERY ERROR:", err.stack || err);
    res
      .status(500)
      .json({
        error: "Internal server spatial query error",
        message: err.message,
      });
  }
};

// 3. SURVEYOR: Resubmit / Update Geometry & Send back to Auditor
const updateParcelGeometry = async (req, res) => {
  const { parcel_id, geometry, land_use, surveyor_notes } = req.body;

  if (!parcel_id || !geometry) {
    return res.status(400).json({
      error: "parcel_id and geometry are required.",
    });
  }

  try {
    // Check current status first
    const checkQuery = `SELECT status FROM parcels WHERE parcel_id = $1;`;
    const checkResult = await pool.query(checkQuery, [parcel_id]);

    if (checkResult.rowCount === 0) {
      return res.status(404).json({ error: "Parcel not found." });
    }

    if (checkResult.rows[0].status === "Approved") {
      return res.status(403).json({
        error:
          "Forbidden: Approved parcel boundaries are locked and cannot be modified.",
      });
    }

    const query = `
      UPDATE parcels
      SET
          geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
          land_use = COALESCE($2, land_use),
          surveyor_notes = COALESCE($3, surveyor_notes),
          status = 'Pending Audit',
          updated_at = CURRENT_TIMESTAMP
      WHERE parcel_id = $4
      RETURNING id, parcel_id, status, land_use, surveyor_notes; 
    `;

    const values = [
      JSON.stringify(geometry),
      land_use,
      surveyor_notes,
      parcel_id,
    ];
    const result = await pool.query(query, values);

    return res.json({
      message: "Parcel boundary updated & resubmitted to Auditor.",
      updatesParcel: result.rows[0],
    });
  } catch (err) {
    console.error("❌ SPATIAL QUERY ERROR:", err.stack || err);
    res
      .status(500)
      .json({
        error: "Internal server spatial query error",
        message: err.message,
      });
  }
};

// 4. AUDITOR: Final Decision (Approved -> 'Approved', Rejected -> 'Pending Survey' for Surveyor fix)
const auditDecision = async (req, res) => {
  const { parcel_id, decision, auditor_comments } = req.body;

  if (!parcel_id || !["Approved", "Rejected"].includes(decision)) {
    return res.status(400).json({
      error:
        "Valid parcel_id and decision ('Approved' or 'Rejected') are required.",
    });
  }

  try {
    // Decision Reject hone par status automatically 'Pending Survey' hoga taaki Surveyor correction kar sake
    const targetStatus =
      decision === "Approved" ? "Approved" : "Pending Survey";

    const query = `
      UPDATE parcels
      SET
        status = $1,
        auditor_comments = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE parcel_id = $3
      RETURNING id, parcel_id, status, auditor_comments;
    `;

    const result = await pool.query(query, [
      targetStatus,
      auditor_comments || "",
      parcel_id,
    ]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Parcel not found." });
    }

    return res.json({
      message:
        decision === "Approved"
          ? `Parcel ${parcel_id} successfully approved.`
          : `Parcel ${parcel_id} rejected and returned to Surveyor for boundary corrections.`,
      parcel: result.rows[0],
    });
  } catch (e) {
    console.error("Failed to process audit decision : ", e);
    return res
      .status(500)
      .json({ error: "Internal server audit processing error." });
  }
};

// 5. AUTO TRACE PARCELS
const autoTraceParcels = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Image file is required." });
  }

  try {
    const formData = new FormData();

    if (req.file.path && fs.existsSync(req.file.path)) {
      formData.append("file", fs.createReadStream(req.file.path), {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });
    } else if (req.file.buffer) {
      formData.append("file", req.file.buffer, {
        filename: req.file.originalname || "upload.tif",
        contentType: req.file.mimetype || "image/tiff",
      });
    } else {
      return res.status(400).json({ error: "Invalid file buffer or path." });
    }

    const aiResponse = await axios.post(
      "http://127.0.0.1:8000/extract-all-parcels",
      formData,
      {
        headers: { ...formData.getHeaders() },
        timeout: 180000,
      },
    );

    if (req.file.path && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Temp file cleanup error:", err);
      });
    }

    const features = aiResponse.data.features || [];

    if (features.length === 0) {
      return res
        .status(400)
        .json({ error: "No traceable boundaries found in image." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const insertQuery = `
        INSERT INTO parcels (parcel_id, owner_name, land_use, status, geom)
        VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))
        ON CONFLICT (parcel_id) DO UPDATE SET
          geom = EXCLUDED.geom,
          status = 'Pending Survey',
          updated_at = CURRENT_TIMESTAMP;
      `;

      for (const feat of features) {
        await client.query(insertQuery, [
          feat.properties.parcel_id,
          "Unassigned",
          feat.properties.land_use || "AI Traced Building",
          feat.properties.status || "Pending Survey",
          JSON.stringify(feat.geometry),
        ]);
      }

      await client.query("COMMIT");
    } catch (dbErr) {
      await client.query("ROLLBACK");
      console.error("Database Transaction Error:", dbErr.message);
      throw dbErr;
    } finally {
      client.release();
    }

    return res.json({
      message: `Successfully traced and saved ${features.length} parcels/structures!`,
      count: features.length,
      features: features,
    });
  } catch (err) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.error("Cleanup error:", cleanupErr);
      }
    }

    console.error(
      "Auto trace backend error:",
      err.response?.data || err.message,
    );
    return res.status(500).json({
      error: "Failed to auto-trace image boundaries.",
      details: err.response?.data?.message || err.message,
    });
  }
};

module.exports = {
  getParcelGeoJSON,
  createAdminTask,
  updateParcelGeometry,
  auditDecision,
  autoTraceParcels,
};
