# Kogi Environmental Change Monitor

A GitHub-based environmental change monitoring portal for Kogi State, Nigeria.

## Purpose

The project is designed to let a user:

1. Enter a latitude/longitude or navigate to a location.
2. Draw a polygon around a mine, factory, construction site, or other area of interest.
3. Calculate the polygon area.
4. Intersect the polygon with remote-sensing change layers.
5. Report the area of land-cover conversion inside the polygon by:
   - first change year;
   - baseline land-cover class;
   - transition to Built Area or Bare Ground;
   - broad candidate change versus strict permanent change.
6. Submit independent field/inspection evidence for later review.

## Remote-sensing evidence model

The portal will distinguish between two change layers:

- **Candidate change** — a sensitive Living Atlas annual land-cover transition layer.
- **Strict permanent change** — a conservative layer requiring a stable 2018–2020 baseline and persistent conversion to Built Area or Bare Ground through the latest available annual land-cover map.

The strict layer should be used for the main permanent-change area reported by the portal.

## Important interpretation

The remote-sensing layer establishes that land-cover conversion occurred within a selected polygon. It does **not**, by itself, prove that a particular company or activity caused the change. Attribution should use site/lease information plus independent field, inspection, photographic, drone, or documentary evidence.

## Data privacy

This repository is public. Do not commit reporter identities, private contact information, confidential inspection records, or restricted photographs. Public-safe validation summaries may be published after review.

## Planned repository structure

```text
assets/
  css/
  js/
data/
  candidate_change/
  permanent_change/
  tile_index.geojson
  mining_factory_sites.csv
metadata/
  landcover_classes.json
  transition_codes.json
  methodology.json
validation/
  README.md
notebooks/
  README.md
index.html
.nojekyll
```

## Status

Initial project scaffold. Raster products and portal functionality will be added after the strict permanent-change dataset is finalized.
