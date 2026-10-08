# Portal data

This directory contains public-safe spatial data used by the Kogi Environmental Change Monitor.

## Raster layers

### `candidate_change/`
92 Cloud-Optimized GeoTIFF tiles containing the broader vegetation-to-Built/Bare screening result.

Use this layer for **potential/candidate change**, not as the primary permanent-change figure.

### `permanent_change/`
91 Cloud-Optimized GeoTIFF tiles containing the strict permanent-change result.

This is the **primary raster layer** for the portal's permanent-change area calculation.

## Vector/index files

- `admin/kogi_state.geojson` — WGS84 web version of the Kogi processing boundary.
- `admin/kogi_lgas.geojson` — 21-LGA reference overlay.
- `tile_index.geojson` — 104 processing-tile footprints with relative paths to available candidate/permanent COGs.

Tiles absent from a change folder represent processing tiles in which that workflow found no selected pixels; the tile index retains those footprints so the portal can distinguish a valid zero-change result from missing coverage.

## 2025

2025-only change is stored as **provisional** and must be reported separately from strict confirmed permanent change.

## Privacy

Do not commit private reporter identities, contact information, confidential inspection records, or restricted photographs to this public repository.

Boundary provenance and licensing: see `metadata/data_sources.json`. Verified processing counts, CRS and raster checks: see `metadata/processing_summary.json`.
