const traceBoundary = async (req, res) => {
  try {
    const { prompt, parcel_id, bbox } = req.body; 
    // bbox expected as JSON string or array: [minLng, minLat, maxLng, maxLat] from Map canvas
    const file = req.file;

    let aiMessage = "";
    let generatedGeoJSON = null;
    const apiKey = process.env.NVIDIA_API_KEY;

    // Parse incoming map bounding box or fallback to Delhi default
    let spatialBounds = [77.2085, 28.6135, 77.2105, 28.6150];
    if (bbox) {
      try {
        spatialBounds = typeof bbox === "string" ? JSON.parse(bbox) : bbox;
      } catch (e) {
        console.warn("Invalid bbox format, using fallback bounds.");
      }
    }

    const [mapMinLng, mapMinLat, mapMaxLng, mapMaxLat] = spatialBounds;

    if (apiKey && file) {
      try {
        const base64Image = file.buffer.toString("base64");
        const mimeType = file.mimetype || "image/jpeg";
        const dataUrl = `data:${mimeType};base64,${base64Image}`;

        const promptText = `You are a high-precision Web-GIS Spatial Segmentation Engine for parcel ${parcel_id || "P-101"}.
Analyze the provided aerial/drone image.
Task: Detect the exact spatial extent for: "${prompt || "main building, road, or plot boundary"}".

STRICT OUTPUT REQUIREMENT:
Return ONLY a JSON object (no explanations, no markdown wrapping, no extra text) with this format:
{
  "description": "2-sentence summary of identified plot structure",
  "bounding_box": [ymin, xmin, ymax, xmax]
}
Note: Coordinates ymin, xmin, ymax, xmax must be integers scaled strictly from 0 to 100 based on image pixel dimensions.`;

        const response = await fetch(
          "https://integrate.api.nvidia.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              model: "meta/llama-3.2-11b-vision-instruct",
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: promptText },
                    { type: "image_url", image_url: { url: dataUrl } },
                  ],
                },
              ],
              max_tokens: 300,
              temperature: 0.05, // Lower temperature for strict JSON output
            }),
          }
        );

        const data = await response.json();

        if (response.ok && data.choices && data.choices.length > 0) {
          const rawContent = data.choices[0].message.content.trim();
          
          // Clean possible markdown code fences if AI returns ```json
          const cleanedJsonString = rawContent.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleanedJsonString);

          if (parsed.bounding_box && Array.isArray(parsed.bounding_box)) {
            const [ymin, xmin, ymax, xmax] = parsed.bounding_box.map(Number);
            
            aiMessage = `[NVIDIA AI Agent]: ${parsed.description || "Boundary successfully extracted."}`;

            // Map 0-100 normalized coordinates into actual Map Spatial Bounding Box
            const lngSpan = mapMaxLng - mapMinLng;
            const latSpan = mapMaxLat - mapMinLat;

            const calcMinLng = mapMinLng + (xmin / 100) * lngSpan;
            const calcMaxLng = mapMinLng + (xmax / 100) * lngSpan;
            // Latitude inverts on image Y-axis (Top = maxLat, Bottom = minLat)
            const calcMaxLat = mapMaxLat - (ymin / 100) * latSpan;
            const calcMinLat = mapMaxLat - (ymax / 100) * latSpan;

            generatedGeoJSON = {
              type: "Feature",
              geometry: {
                type: "Polygon",
                coordinates: [[
                  [calcMinLng, calcMinLat],
                  [calcMaxLng, calcMinLat],
                  [calcMaxLng, calcMaxLat],
                  [calcMinLng, calcMaxLat],
                  [calcMinLng, calcMinLat]
                ]]
              },
              properties: { 
                parcel_id: parcel_id || "P-AI-AUTO", 
                traced_by: "NVIDIA-Llama-3.2-Vision",
                confidence: "High"
              }
            };
          }
        }
      } catch (nvidiaError) {
        console.warn("NVIDIA Vision Parsing/API Error:", nvidiaError.message);
      }
    }

    // Dynamic Fallback in case AI detection fails
    if (!generatedGeoJSON) {
      const midLng = (mapMinLng + mapMaxLng) / 2;
      const midLat = (mapMinLat + mapMaxLat) / 2;
      const offsetLng = (mapMaxLng - mapMinLng) * 0.2;
      const offsetLat = (mapMaxLat - mapMinLat) * 0.2;

      generatedGeoJSON = {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [midLng - offsetLng, midLat - offsetLat],
            [midLng + offsetLng, midLat - offsetLat],
            [midLng + offsetLng, midLat + offsetLat],
            [midLng - offsetLng, midLat + offsetLat],
            [midLng - offsetLng, midLat - offsetLat]
          ]]
        },
        properties: { parcel_id: parcel_id || "P-AI-AUTO", traced_by: "GIS-Spatial-Fallback" }
      };

      if (!aiMessage) {
        aiMessage = `[GIS Engine]: Generated estimated bounding polygon for current parcel focus area.`;
      }
    }

    return res.json({
      message: aiMessage,
      geojson: generatedGeoJSON,
      status: "success",
    });

  } catch (error) {
    console.error("TraceBoundary Error:", error);
    return res.status(500).json({ error: error.message });
  }
};

module.exports = { traceBoundary };