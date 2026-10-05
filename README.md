# Kogi Environmental Change Monitor

A web-based environmental land-cover change monitoring project for Kogi State, Nigeria.

## Portal objective

The portal is being built so a user can:

1. enter latitude/longitude and navigate to a site;
2. draw a polygon around a mine, factory, building/development site, or other area of interest;
3. calculate the polygon area;
4. identify annual vegetation-to-Built/Bare conversion within that polygon;
5. report **strict permanent change area**, **potential/candidate change area**, and **provisional 2025 change** separately;
6. break results down by change year, original vegetation class, transition type, and end state;
7. later submit independent field/inspection evidence for review.

## Data package currently loaded

- **92 candidate-change COG tiles** — sensitive screening layer.
- **91 strict permanent-change COG tiles** — primary layer for permanent-change reporting.
- **104-tile spatial index** — `data/tile_index.geojson`.
- Kogi processing boundary — `data/admin/kogi_state.geojson`.
- **21 Kogi LGA reference boundaries** — `data/admin/kogi_lgas.geojson`.
- Land-cover, transition, methodology, QA, raster-schema, and portal-configuration metadata.

## Strict permanent-change definition

A selected pixel must have the **same monitored vegetation class in 2018, 2019 and 2020**:

- Trees
- Flooded Vegetation
- Crops
- Rangeland

It must then convert to **Built Area or Bare Ground** and remain Built/Bare in every available annual map from its first permanent-change year through 2025.

Changes first appearing in **2025 remain provisional** until a later annual land-cover map is available.

## Important interpretation

The raster establishes that persistent land-cover conversion occurred within a selected polygon. It does **not**, by itself, prove that a specific company, mine, factory, or building caused the conversion. Attribution should use site/lease records plus independent field, inspection, photographic, drone, or documentary evidence.

LGA boundaries are a map/reference overlay and do not control the polygon change-area calculation.

## Repository structure

```text
data/
  candidate_change/
  permanent_change/
  admin/kogi_state.geojson
  admin/kogi_lgas.geojson
  tile_index.geojson

metadata/
  landcover_classes.json
  transition_codes.json
  methodology.json
  data_sources.json
  processing_qa.json
  raster_schema.json
  portal_config.json

validation/
notebooks/
assets/
index.html
```

## Current status

**Portal-ready data package complete.**

Next development stage: implement the interactive map, coordinate search, polygon drawing, COG reading, polygon-raster intersection, and downloadable change report.

Boundary provenance and licensing: see `metadata/data_sources.json`. Verified processing counts, CRS and raster checks: see `metadata/processing_summary.json`.


## Live site registry

The portal is now connected to the approved public site registry in Google Sheets through a Google Apps Script web endpoint.

- Public API: `https://script.google.com/macros/s/AKfycbxQwLQvjV591q8JUCUsgi8_lkJL2rfeWvZCqReJ8zeU5YTufUASp-m9QFNT5TFsrk8/exec`
- New-site form: `https://docs.google.com/forms/d/e/1FAIpQLSc5u0zf5JcXUL-hwrUIPJuPV2g7TZSbsUqZA0p_Ja_3NL7yMg/viewform`
- Only records with `portal_publish = Yes` and valid coordinates are exposed.
- Private submitter/reviewer fields are not exposed through the public API.
- The map consumes the feed with JSONP to avoid browser cross-origin restrictions.

The current map can show approved sites, Kogi State/LGA boundaries and coordinate navigation. Polygon drawing and raster-area analysis are the next portal module.


## Polygon change analysis

The portal now includes browser-side polygon analysis.

Workflow:

1. Navigate to a known site or enter latitude/longitude.
2. Draw a polygon with the map polygon tool.
3. The polygon is clipped to the Kogi processing boundary when necessary.
4. The portal uses `data/tile_index.geojson` to identify intersecting raster tiles.
5. Only the required COG windows are read in the browser.
6. The report separates:
   - potential/candidate conversion;
   - strict permanent conversion (status 1, first change 2021–2024);
   - provisional 2025 conversion (status 2).
7. Strict permanent change is summarized by first change year, baseline class, transition, first converted class, final 2025 class and persistence years.
8. The result can be downloaded as CSV.

Area treatment:

- selected polygon area is calculated geodesically;
- fully included raster cells use geodesic cell-polygon area;
- boundary cells use fractional polygon–cell intersection area;
- 2025 is not added to the confirmed permanent total;
- polygons extending outside Kogi are reported with a coverage percentage and analyzed only inside the processing boundary.

For browser protection, very large polygon bounding windows are rejected and should be split into smaller areas.
