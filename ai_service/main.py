import os
import io
import gc
import warnings

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import torch
import rasterio
from rasterio.transform import xy
from pyproj import Transformer
from shapely.geometry import Polygon
import uvicorn
from mobile_sam import sam_model_registry, SamAutomaticMaskGenerator

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT_PATH = os.path.join(BASE_DIR, "mobile_sam.pt")
MODEL_TYPE = "vit_t"

device = "cuda" if torch.cuda.is_available() else "cpu"

mobile_sam = sam_model_registry[MODEL_TYPE](checkpoint=CHECKPOINT_PATH)
mobile_sam.to(device=device)
mobile_sam.eval()

mask_generator = SamAutomaticMaskGenerator(
    model=mobile_sam,
    points_per_side=16,
    points_per_batch=32,
    pred_iou_thresh=0.78,
    stability_score_thresh=0.88,
    min_mask_region_area=50
)

def filter_overlapping_polygons(features, iou_threshold=0.25):
    clean_features = []
    shapely_polys = []

    for feat in features:
        raw_coords = feat["geometry"]["coordinates"][0]
        if len(raw_coords) < 4:
            continue
        
        poly = Polygon(raw_coords)
        if not poly.is_valid or poly.area == 0:
            continue

        overlap = False
        for existing_poly in shapely_polys:
            intersection = poly.intersection(existing_poly).area
            union = poly.union(existing_poly).area
            
            if union > 0 and (intersection / union) > iou_threshold:
                overlap = True
                break

        if not overlap:
            shapely_polys.append(poly)
            clean_features.append(feat)

    return clean_features

@app.get("/")
def home():
    return {"status": "AI microservice is operational"}

@app.post("/extract-all-parcels")
async def extract_all_parcels(
    file: UploadFile = File(...),
    bbox_str: str = Form(None)  # Format: "min_lon,min_lat,max_lon,max_lat" for standard JPGs
):
    try:
        contents = await file.read()
        has_geotiff = False

        with rasterio.open(io.BytesIO(contents)) as src:
            transform = src.transform
            orig_h, orig_w = src.height, src.width
            src_crs = src.crs

            if src_crs is not None and src_crs.to_string() != "":
                has_geotiff = True
                transformer = Transformer.from_crs(src_crs, "EPSG:4326", always_xy=True)
            else:
                transformer = None

            # Standard RGB Extraction
            if src.count >= 3:
                r, g, b = src.read(1), src.read(2), src.read(3)
                img = np.dstack((r, g, b))
            else:
                band = src.read(1)
                img = cv2.cvtColor(band, cv2.COLOR_GRAY2RGB)

        if img.dtype != np.uint8:
            img = cv2.normalize(img, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)

        # Handle Bounding Box for non-GeoTIFF standard images (PNG/JPG)
        fallback_bbox = None
        if not has_geotiff and bbox_str:
            try:
                fallback_bbox = [float(val) for val in bbox_str.split(",")] # [min_lon, min_lat, max_lon, max_lat]
            except Exception:
                fallback_bbox = None

        MAX_DIM = 800
        scale_ratio = 1.0
        
        if max(orig_h, orig_w) > MAX_DIM:
            scale_ratio = MAX_DIM / float(max(orig_h, orig_w))
            new_w = int(orig_w * scale_ratio)
            new_h = int(orig_h * scale_ratio)
            img_resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
        else:
            img_resized = img

        masks = mask_generator.generate(img_resized)

        features = []
        feature_idx = 1
        h_res, w_res = img_resized.shape[:2]
        
        min_area = (h_res * w_res) * 0.0001
        max_area = (h_res * w_res) * 0.08

        for mask_data in masks:
            mask = mask_data['segmentation'].astype(np.uint8) * 255
            area = mask_data['area']

            if min_area < area < max_area:
                contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                
                for cnt in contours:
                    epsilon = 0.018 * cv2.arcLength(cnt, True)
                    approx = cv2.approxPolyDP(cnt, epsilon, True)

                    if len(approx) >= 4:
                        coords = []
                        for pt in approx:
                            px_res, py_res = pt[0][0], pt[0][1]

                            # Rescale back to original pixel dimensions
                            orig_px = px_res / scale_ratio
                            orig_py = py_res / scale_ratio

                            if has_geotiff:
                                # Transform GeoTIFF pixels using rasterio affine matrix
                                x, y = xy(transform, orig_py, orig_px)
                                if transformer:
                                    lon, lat = transformer.transform(x, y)
                                else:
                                    lon, lat = x, y
                            elif fallback_bbox:
                                # Linear interpolation mapping for plain JPGs over current map viewport
                                min_lon, min_lat, max_lon, max_lat = fallback_bbox
                                lon = min_lon + (orig_px / orig_w) * (max_lon - min_lon)
                                lat = max_lat - (orig_py / orig_h) * (max_lat - min_lat)
                            else:
                                continue # Skip if no georeferencing info is available

                            coords.append([round(lon, 6), round(lat, 6)])

                        if len(coords) < 3:
                            continue

                        # Ensure GeoJSON Polygon Ring Closure
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])

                        features.append({
                            "type": "Feature",
                            "properties": {
                                "parcel_id": f"SAM-{1000 + feature_idx}",
                                "land_use": "AI Traced Building",
                                "status": "Pending Survey"
                            },
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [coords]
                            }
                        })
                        feature_idx += 1

        clean_features = filter_overlapping_polygons(features, iou_threshold=0.25)

        del contents, img, img_resized, masks
        gc.collect()

        return {
            "status": "success",
            "count": len(clean_features),
            "features": clean_features
        }

    except Exception as e:
        print(f"SAM Extraction Error: {e}")
        return {"status": "error", "message": str(e), "features": []}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)