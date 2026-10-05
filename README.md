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
