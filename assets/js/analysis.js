(function () {
  'use strict';

  const TILE_INDEX_URL = 'data/tile_index.geojson';
  const STATE_URL = 'data/admin/kogi_state.geojson';
  const MAX_WINDOW_PIXELS = 4000000;

  const CLASS_NAMES = {
    2: 'Trees',
    4: 'Flooded Vegetation',
    5: 'Crops',
    7: 'Built Area',
    8: 'Bare Ground',
    11: 'Rangeland'
  };

  const TRANSITION_NAMES = {
    1: 'Trees → Bare Ground',
    2: 'Trees → Built Area',
    3: 'Flooded Vegetation → Bare Ground',
    4: 'Flooded Vegetation → Built Area',
    5: 'Crops → Bare Ground',
    6: 'Crops → Built Area',
    7: 'Rangeland → Bare Ground',
    8: 'Rangeland → Built Area'
  };

  const drawGroup = new L.FeatureGroup().addTo(map);
  let selectedLayer = null;
  let tileIndex = null;
  let stateFeature = null;
  let currentReport = null;
  let analysisBusy = false;

  const analysisStatus = document.getElementById('analysisStatus');
  const analysisResults = document.getElementById('analysisResults');
  const analyzeBtn = document.getElementById('analyzePolygon');
  const clearBtn = document.getElementById('clearPolygon');
  const downloadBtn = document.getElementById('downloadReport');
  const startDrawBtn = document.getElementById('startDrawPolygon');

  const drawControl = new L.Control.Draw({
    position: 'topleft',
    edit: {
      featureGroup: drawGroup,
      edit: true,
      remove: true
    },
    draw: {
      polygon: {
        allowIntersection: false,
        showArea: true,
        shapeOptions: {
          color: '#dc2626',
          weight: 2,
          fillOpacity: 0.12
        }
      },
      polyline: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false
    }
  });

  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, function (e) {
    drawGroup.clearLayers();
    selectedLayer = e.layer;
    drawGroup.addLayer(selectedLayer);
    analyzeSelectedPolygon();
  });

  map.on(L.Draw.Event.EDITED, function (e) {
    e.layers.eachLayer(function (layer) {
      selectedLayer = layer;
    });
    if (selectedLayer) analyzeSelectedPolygon();
  });

  map.on(L.Draw.Event.DELETED, function () {
    selectedLayer = null;
    clearAnalysis();
  });

  startDrawBtn.addEventListener('click', function () {
    const drawer = new L.Draw.Polygon(map, {
      allowIntersection: false,
      showArea: true,
      shapeOptions: {
        color: '#dc2626',
        weight: 2,
        fillOpacity: 0.12
      }
    });
    drawer.enable();
    analysisStatus.className = 'status';
    analysisStatus.textContent = 'Click on the map to add polygon vertices; click the first point to finish.';
  });

  analyzeBtn.addEventListener('click', analyzeSelectedPolygon);
  clearBtn.addEventListener('click', function () {
    drawGroup.clearLayers();
    selectedLayer = null;
    clearAnalysis();
  });
  downloadBtn.addEventListener('click', downloadCurrentReportCsv);

  analysisResults.addEventListener('click', function (event) {
    const button = event.target.closest('.result-info-btn');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    const targetId = button.getAttribute('aria-controls');
    const target = document.getElementById(targetId);
    if (!target) return;

    const willOpen = target.hidden;
    target.hidden = !willOpen;
    button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  async function ensureAnalysisData() {
    if (tileIndex && stateFeature) return;

    analysisStatus.className = 'status';
    analysisStatus.textContent = 'Loading analysis index…';

    const responses = await Promise.all([
      fetch(TILE_INDEX_URL),
      fetch(STATE_URL)
    ]);

    if (!responses[0].ok || !responses[1].ok) {
      throw new Error('Could not load the tile index or Kogi processing boundary.');
    }

    tileIndex = await responses[0].json();
    stateFeature = await responses[1].json();

    if (!tileIndex.features || tileIndex.features.length !== 104) {
      throw new Error('Unexpected tile-index structure.');
    }

    if (stateFeature.type === 'FeatureCollection') {
      stateFeature = stateFeature.features[0];
    }
  }

  function clearAnalysis() {
    currentReport = null;
    analysisStatus.className = 'status';
    analysisStatus.textContent = 'Draw a polygon on the map to calculate land-cover change.';
    analysisResults.innerHTML = '';
    downloadBtn.disabled = true;
  }

  async function analyzeSelectedPolygon() {
    if (analysisBusy) return;

    if (!selectedLayer) {
      analysisStatus.className = 'status warn';
      analysisStatus.textContent = 'Draw a polygon first using the polygon tool on the map.';
      return;
    }

    analysisBusy = true;
    analyzeBtn.disabled = true;
    downloadBtn.disabled = true;

    try {
      await ensureAnalysisData();

      const selectedFeature = selectedLayer.toGeoJSON();
      const selectedAreaHa = turf.area(selectedFeature) / 10000;

      if (!(selectedAreaHa > 0)) {
        throw new Error('The polygon has no measurable area.');
      }

      const analysisFeature = intersectFeatures(selectedFeature, stateFeature);

      if (!analysisFeature) {
        throw new Error('The polygon does not intersect the Kogi processing boundary.');
      }

      const analysisAreaHa = turf.area(analysisFeature) / 10000;
      const coveragePercent = Math.min(100, analysisAreaHa / selectedAreaHa * 100);
      const bbox4326 = turf.bbox(analysisFeature);
      const bbox3857 = featureMercatorBbox(analysisFeature);
      const projectedGeometry = projectGeometry(analysisFeature.geometry);

      const intersectingTiles = tileIndex.features.filter(function (feature) {
        return bboxIntersects(bbox4326, feature.properties.bounds_wgs84);
      });

      if (!intersectingTiles.length) {
        throw new Error('No processing tiles intersect this polygon.');
      }

      const estimatedPixels = intersectingTiles.reduce(function (sum, feature) {
        const w = computeWindow(feature.properties, bbox3857);
        return sum + (w ? w.width * w.height : 0);
      }, 0);

      if (estimatedPixels > MAX_WINDOW_PIXELS) {
        throw new Error(
          'This polygon is too large for browser analysis (' +
          estimatedPixels.toLocaleString() +
          ' raster cells in its bounding windows). Draw a smaller site polygon or split the area.'
        );
      }

      const report = {
        generated_at: new Date().toISOString(),
        selected_polygon_area_ha: selectedAreaHa,
        analysis_area_ha: analysisAreaHa,
        coverage_percent: coveragePercent,
        processing_tiles_intersected: intersectingTiles.length,
        candidate: createCandidateMetrics(),
        permanent: createPermanentMetrics()
      };

      analysisStatus.className = 'status';
      analysisStatus.textContent =
        'Analyzing ' + intersectingTiles.length +
        ' intersecting processing tile' +
        (intersectingTiles.length === 1 ? '' : 's') + '…';

      await processCandidateLayer(
        analysisFeature,
        projectedGeometry,
        bbox3857,
        intersectingTiles,
        report.candidate
      );

      await processPermanentLayer(
        analysisFeature,
        projectedGeometry,
        bbox3857,
        intersectingTiles,
        report.permanent
      );

      report.permanent.percent_of_analysis_area =
        analysisAreaHa > 0
          ? report.permanent.confirmed_area_ha / analysisAreaHa * 100
          : 0;

      report.candidate.percent_of_analysis_area =
        analysisAreaHa > 0
          ? report.candidate.confirmed_area_ha / analysisAreaHa * 100
          : 0;

      currentReport = report;
      renderReport(report);
      downloadBtn.disabled = false;

      analysisStatus.className = 'status ok';
      analysisStatus.innerHTML =
        '<b>Analysis complete.</b><br>' +
        intersectingTiles.length +
        ' processing tile' +
        (intersectingTiles.length === 1 ? '' : 's') +
        ' checked.';

    } catch (err) {
      console.error(err);
      analysisStatus.className = 'status warn';
      analysisStatus.innerHTML =
        '<b>Analysis could not be completed.</b><br>' +
        esc(err.message || err);
    } finally {
      analysisBusy = false;
      analyzeBtn.disabled = false;
    }
  }

  function createCandidateMetrics() {
    return {
      confirmed_area_ha: 0,
      provisional_2025_area_ha: 0,
      by_year_ha: {}
    };
  }

  function createPermanentMetrics() {
    return {
      confirmed_area_ha: 0,
      provisional_2025_area_ha: 0,
      percent_of_analysis_area: 0,
      by_year_ha: {},
      by_baseline_class_ha: {},
      by_first_end_class_ha: {},
      by_final_2025_class_ha: {},
      by_transition_ha: {},
      by_persistence_years_ha: {}
    };
  }

  async function processCandidateLayer(
    polygonFeature,
    projectedGeometry,
    polygonBbox3857,
    tiles,
    metrics
  ) {
    const files = tiles.filter(function (f) {
      return f.properties.has_candidate && f.properties.candidate_path;
    });

    for (let i = 0; i < files.length; i++) {
      analysisStatus.textContent =
        'Candidate layer: tile ' + (i + 1) + ' of ' + files.length + '…';

      const tile = files[i].properties;
      const windowInfo = computeWindow(tile, polygonBbox3857);
      if (!windowInfo) continue;

      const image = await openRasterImage(tile.candidate_path);
      const rasters = await image.readRasters({
        window: windowInfo.window,
        samples: [0, 5]
      });

      const years = rasters[0];
      const statuses = rasters[1];

      await scanRasterWindow({
        tile: tile,
        windowInfo: windowInfo,
        polygonFeature: polygonFeature,
        projectedGeometry: projectedGeometry,
        acceptPixel: function (idx) {
          const status = Number(statuses[idx]);
          return status === 1 || status === 2;
        },
        consumePixel: function (idx, areaHa) {
          const status = Number(statuses[idx]);
          const year = Number(years[idx]);

          if (status === 1) {
            metrics.confirmed_area_ha += areaHa;
            addArea(metrics.by_year_ha, year, areaHa);
          } else if (status === 2) {
            metrics.provisional_2025_area_ha += areaHa;
          }
        }
      });
    }
  }

  async function processPermanentLayer(
    polygonFeature,
    projectedGeometry,
    polygonBbox3857,
    tiles,
    metrics
  ) {
    const files = tiles.filter(function (f) {
      return f.properties.has_permanent && f.properties.permanent_path;
    });

    for (let i = 0; i < files.length; i++) {
      analysisStatus.textContent =
        'Strict permanent layer: tile ' + (i + 1) + ' of ' + files.length + '…';

      const tile = files[i].properties;
      const windowInfo = computeWindow(tile, polygonBbox3857);
      if (!windowInfo) continue;

      const image = await openRasterImage(tile.permanent_path);
      const rasters = await image.readRasters({
        window: windowInfo.window,
        samples: [0, 1, 2, 3, 4, 5, 6]
      });

      const years = rasters[0];
      const baseline = rasters[1];
      const firstEnd = rasters[2];
      const finalEnd = rasters[3];
      const transition = rasters[4];
      const persistence = rasters[5];
      const status = rasters[6];

      await scanRasterWindow({
        tile: tile,
        windowInfo: windowInfo,
        polygonFeature: polygonFeature,
        projectedGeometry: projectedGeometry,
        acceptPixel: function (idx) {
          const s = Number(status[idx]);
          return s === 1 || s === 2;
        },
        consumePixel: function (idx, areaHa) {
          const s = Number(status[idx]);
          const year = Number(years[idx]);

          if (s === 2) {
            metrics.provisional_2025_area_ha += areaHa;
            return;
          }

          metrics.confirmed_area_ha += areaHa;

          addArea(metrics.by_year_ha, year, areaHa);
          addArea(
            metrics.by_baseline_class_ha,
            CLASS_NAMES[Number(baseline[idx])] || ('Class ' + baseline[idx]),
            areaHa
          );
          addArea(
            metrics.by_first_end_class_ha,
            CLASS_NAMES[Number(firstEnd[idx])] || ('Class ' + firstEnd[idx]),
            areaHa
          );
          addArea(
            metrics.by_final_2025_class_ha,
            CLASS_NAMES[Number(finalEnd[idx])] || ('Class ' + finalEnd[idx]),
            areaHa
          );
          addArea(
            metrics.by_transition_ha,
            TRANSITION_NAMES[Number(transition[idx])] ||
              ('Transition ' + transition[idx]),
            areaHa
          );
          addArea(
            metrics.by_persistence_years_ha,
            String(Number(persistence[idx])),
            areaHa
          );
        }
      });
    }
  }

  async function openRasterImage(path) {
    const url = new URL(path, document.baseURI).href;
    const tiff = await GeoTIFF.fromUrl(url);
    return tiff.getImage();
  }

  async function scanRasterWindow(options) {
    const tile = options.tile;
    const win = options.windowInfo;
    const rowAreaCache = new Map();
    let counter = 0;

    for (let row = 0; row < win.height; row++) {
      const globalRow = win.row0 + row;

      for (let col = 0; col < win.width; col++) {
        const idx = row * win.width + col;
        if (!options.acceptPixel(idx)) continue;

        const globalCol = win.col0 + col;
        const cell = cellBounds3857(tile, globalCol, globalRow);

        const areaHa = pixelPolygonOverlapAreaHa(
          cell,
          globalRow,
          tile,
          options.polygonFeature,
          options.projectedGeometry,
          rowAreaCache
        );

        if (areaHa > 0) {
          options.consumePixel(idx, areaHa);
        }

        counter++;
        if (counter % 2500 === 0) {
          await yieldToBrowser();
        }
      }
    }
  }

  function computeWindow(tile, polygonBbox3857) {
    const xmin = Number(tile.xmin_3857);
    const ymin = Number(tile.ymin_3857);
    const xmax = Number(tile.xmax_3857);
    const ymax = Number(tile.ymax_3857);
    const width = Number(tile.width);
    const height = Number(tile.height);

    const resX = (xmax - xmin) / width;
    const resY = (ymax - ymin) / height;

    const ix0 = Math.max(xmin, polygonBbox3857[0]);
    const iy0 = Math.max(ymin, polygonBbox3857[1]);
    const ix1 = Math.min(xmax, polygonBbox3857[2]);
    const iy1 = Math.min(ymax, polygonBbox3857[3]);

    if (!(ix1 > ix0 && iy1 > iy0)) return null;

    const col0 = clamp(Math.floor((ix0 - xmin) / resX), 0, width);
    const col1 = clamp(Math.ceil((ix1 - xmin) / resX), 0, width);
    const row0 = clamp(Math.floor((ymax - iy1) / resY), 0, height);
    const row1 = clamp(Math.ceil((ymax - iy0) / resY), 0, height);

    if (col1 <= col0 || row1 <= row0) return null;

    return {
      window: [col0, row0, col1, row1],
      col0: col0,
      row0: row0,
      width: col1 - col0,
      height: row1 - row0,
      resX: resX,
      resY: resY
    };
  }

  function cellBounds3857(tile, col, row) {
    const width = Number(tile.width);
    const height = Number(tile.height);
    const resX = (Number(tile.xmax_3857) - Number(tile.xmin_3857)) / width;
    const resY = (Number(tile.ymax_3857) - Number(tile.ymin_3857)) / height;

    const x0 = Number(tile.xmin_3857) + col * resX;
    const x1 = x0 + resX;
    const y1 = Number(tile.ymax_3857) - row * resY;
    const y0 = y1 - resY;

    return [x0, y0, x1, y1];
  }

  function pixelPolygonOverlapAreaHa(
    cell,
    row,
    tile,
    polygonFeature,
    projectedGeometry,
    rowAreaCache
  ) {
    const x0 = cell[0], y0 = cell[1], x1 = cell[2], y1 = cell[3];

    const corners = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1]
    ];

    const fullyInside = corners.every(function (p) {
      return pointInProjectedGeometry(p[0], p[1], projectedGeometry);
    });

    if (fullyInside) {
      if (!rowAreaCache.has(row)) {
        const sample = cellPolygonWgs84([
          Number(tile.xmin_3857),
          y0,
          Number(tile.xmin_3857) +
            (Number(tile.xmax_3857) - Number(tile.xmin_3857)) / Number(tile.width),
          y1
        ]);
        rowAreaCache.set(row, turf.area(sample) / 10000);
      }
      return rowAreaCache.get(row);
    }

    const cellFeature = cellPolygonWgs84(cell);

    try {
      const intersection = intersectFeatures(polygonFeature, cellFeature);
      return intersection ? turf.area(intersection) / 10000 : 0;
    } catch (err) {
      const center = [(x0 + x1) / 2, (y0 + y1) / 2];
      return pointInProjectedGeometry(
        center[0],
        center[1],
        projectedGeometry
      )
        ? turf.area(cellFeature) / 10000
        : 0;
    }
  }

  function cellPolygonWgs84(cell) {
    const a = mercatorToLonLat(cell[0], cell[1]);
    const b = mercatorToLonLat(cell[2], cell[1]);
    const c = mercatorToLonLat(cell[2], cell[3]);
    const d = mercatorToLonLat(cell[0], cell[3]);

    return turf.polygon([[
      a, b, c, d, a
    ]]);
  }

  function intersectFeatures(a, b) {
    if (!a || !b) return null;
    try {
      return turf.intersect(turf.featureCollection([a, b]));
    } catch (err) {
      try {
        return turf.intersect(a, b);
      } catch (legacyErr) {
        throw err;
      }
    }
  }

  function projectGeometry(geometry) {
    if (geometry.type === 'Polygon') {
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map(projectRing)
      };
    }

    if (geometry.type === 'MultiPolygon') {
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(function (polygon) {
          return polygon.map(projectRing);
        })
      };
    }

    throw new Error('Only polygon geometry is supported.');
  }

  function projectRing(ring) {
    return ring.map(function (coord) {
      return lonLatToMercator(coord[0], coord[1]);
    });
  }

  function pointInProjectedGeometry(x, y, geometry) {
    if (geometry.type === 'Polygon') {
      return pointInProjectedPolygon(x, y, geometry.coordinates);
    }

    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.some(function (polygon) {
        return pointInProjectedPolygon(x, y, polygon);
      });
    }

    return false;
  }

  function pointInProjectedPolygon(x, y, rings) {
    if (!rings.length || !pointInRing(x, y, rings[0])) return false;

    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(x, y, rings[i])) return false;
    }

    return true;
  }

  function pointInRing(x, y, ring) {
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];

      if (pointOnSegment(x, y, xi, yi, xj, yj)) return true;

      const crosses =
        ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || Number.EPSILON) + xi);

      if (crosses) inside = !inside;
    }

    return inside;
  }

  function pointOnSegment(px, py, x1, y1, x2, y2) {
    const cross = (py - y1) * (x2 - x1) - (px - x1) * (y2 - y1);
    if (Math.abs(cross) > 1e-7) return false;

    const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
    return dot <= 1e-7;
  }

  function featureMercatorBbox(feature) {
    const bbox = turf.bbox(feature);
    const sw = lonLatToMercator(bbox[0], bbox[1]);
    const ne = lonLatToMercator(bbox[2], bbox[3]);
    return [sw[0], sw[1], ne[0], ne[1]];
  }

  function lonLatToMercator(lon, lat) {
    const R = 6378137;
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const x = R * lon * Math.PI / 180;
    const y = R * Math.log(Math.tan(Math.PI / 4 + clampedLat * Math.PI / 360));
    return [x, y];
  }

  function mercatorToLonLat(x, y) {
    const R = 6378137;
    const lon = x / R * 180 / Math.PI;
    const lat =
      (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) *
      180 / Math.PI;
    return [lon, lat];
  }

  function bboxIntersects(a, b) {
    return !(
      a[2] <= b[0] ||
      a[0] >= b[2] ||
      a[3] <= b[1] ||
      a[1] >= b[3]
    );
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function addArea(object, key, areaHa) {
    if (key === undefined || key === null || key === '' || Number.isNaN(key)) {
      return;
    }

    const k = String(key);
    object[k] = (object[k] || 0) + areaHa;
  }

  function yieldToBrowser() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0);
    });
  }

  function renderReport(report) {
    const coverageWarning =
      report.coverage_percent < 99.99
        ? '<div class="analysis-note warn-note">Only ' +
          formatPercent(report.coverage_percent) +
          ' of the drawn polygon lies inside the Kogi processing boundary. Change statistics below use the covered portion only.</div>'
        : '';

    analysisResults.innerHTML =
      coverageWarning +
      '<div class="metric-grid">' +
        metricCard('Selected polygon', formatHa(report.selected_polygon_area_ha)) +
        metricCard(
          'Potential / candidate',
          formatHa(report.candidate.confirmed_area_ha),
          '',
          'candidate-total',
          'A broader screening estimate of vegetation-to-Built/Bare change that does not require every pixel to satisfy the stricter permanent-change rules.'
        ) +
        metricCard(
          'Strict permanent',
          formatHa(report.permanent.confirmed_area_ha),
          'primary-metric',
          'strict-permanent',
          'Area with a stable 2018–2020 vegetation baseline that changed to Built/Bare in 2021–2024 and remained Built/Bare through 2025.'
        ) +
        metricCard(
          'Provisional 2025',
          formatHa(report.permanent.provisional_2025_area_ha),
          '',
          'provisional-2025',
          'Area first changing to Built/Bare in 2025, kept provisional because a later annual map is not yet available to confirm persistence.'
        ) +
      '</div>' +
      '<div class="analysis-note"><b>Permanent change:</b> ' +
        formatPercent(report.permanent.percent_of_analysis_area) +
        ' of the analyzed polygon area.</div>' +

      '<details open><summary>' +
        infoLabel(
          'Permanent change by first year',
          'permanent-year',
          'Shows how much strict permanent change first began in each confirmed change year from 2021 to 2024.'
        ) +
      '</summary>' +
        breakdownTable(report.permanent.by_year_ha, function (k) { return k; }) +
      '</details>' +

      '<details><summary>' +
        infoLabel(
          'Permanent change by original land cover',
          'permanent-baseline',
          'Shows which stable baseline vegetation classes, such as Trees or Rangeland, were converted within the strict permanent-change area.'
        ) +
      '</summary>' +
        breakdownTable(report.permanent.by_baseline_class_ha) +
      '</details>' +

      '<details><summary>' +
        infoLabel(
          'Permanent change by transition',
          'permanent-transition',
          'Shows the area of each baseline-to-impact transition, such as Rangeland → Built Area or Trees → Bare Ground.'
        ) +
      '</summary>' +
        breakdownTable(report.permanent.by_transition_ha) +
      '</details>' +

      '<details><summary>First converted class</summary>' +
        breakdownTable(report.permanent.by_first_end_class_ha) +
      '</details>' +

      '<details><summary>' +
        infoLabel(
          'Final 2025 class',
          'final-2025-class',
          'Shows whether strict permanent-change pixels were classified as Built Area or Bare Ground in the 2025 annual map.'
        ) +
      '</summary>' +
        breakdownTable(report.permanent.by_final_2025_class_ha) +
      '</details>' +

      '<details><summary>' +
        infoLabel(
          'Persistence through 2025',
          'persistence-2025',
          'Shows how many annual observations each confirmed change remained continuously within Built/Bare through 2025.'
        ) +
      '</summary>' +
        breakdownTable(
          report.permanent.by_persistence_years_ha,
          function (k) { return k + ' year' + (String(k) === '1' ? '' : 's'); }
        ) +
      '</details>' +

      '<details><summary>' +
        infoLabel(
          'Candidate change by first year',
          'candidate-year',
          'Shows when the broader candidate-change pixels first met the candidate conversion rule, before applying the stricter permanence criteria.'
        ) +
      '</summary>' +
        breakdownTable(report.candidate.by_year_ha, function (k) { return k; }) +
      '</details>' +

      '<div class="analysis-note">' +
        '<b>Method:</b> 10 m COG cells are clipped against the drawn polygon. ' +
        'Interior cells use geodesic cell area; boundary cells use fractional polygon–cell intersection area. ' +
        '2025 is kept provisional and is not added to the strict permanent total.' +
      '</div>';
  }

  function metricCard(label, value, extraClass, infoKey, infoText) {
    const labelHtml = infoKey
      ? infoLabel(label, infoKey, infoText)
      : esc(label);

    return '<div class="metric-card ' + (extraClass || '') + '">' +
      '<div class="metric-label">' + labelHtml + '</div>' +
      '<div class="metric-value">' + esc(value) + '</div>' +
    '</div>';
  }

  function infoLabel(label, key, text) {
    const id = 'result-info-' + key;

    return '<span class="result-info-wrap">' +
      '<span class="result-info-label">' + esc(label) + '</span>' +
      '<button type="button" class="result-info-btn" aria-expanded="false" aria-controls="' +
        id + '" title="What does this mean?" aria-label="Explain ' + esc(label) + '">?</button>' +
      '<span id="' + id + '" class="result-info-text" hidden>' + esc(text) + '</span>' +
    '</span>';
  }

  function breakdownTable(object, labelFn) {
    const entries = Object.entries(object || {}).sort(function (a, b) {
      const an = Number(a[0]), bn = Number(b[0]);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return String(a[0]).localeCompare(String(b[0]));
    });

    if (!entries.length) {
      return '<div class="small no-data">No confirmed pixels in this category.</div>';
    }

    let html = '<table class="result-table"><thead><tr><th>Category</th><th>Area (ha)</th></tr></thead><tbody>';

    entries.forEach(function (entry) {
      const label = labelFn ? labelFn(entry[0]) : entry[0];
      html += '<tr><td>' + esc(label) + '</td><td>' +
        Number(entry[1]).toFixed(3) + '</td></tr>';
    });

    html += '</tbody></table>';
    return html;
  }

  function formatHa(value) {
    return Number(value || 0).toFixed(3) + ' ha';
  }

  function formatPercent(value) {
    return Number(value || 0).toFixed(2) + '%';
  }

  function downloadCurrentReportCsv() {
    if (!currentReport) return;

    const rows = [
      ['section', 'category', 'area_ha_or_value'],
      ['summary', 'selected_polygon_area_ha', currentReport.selected_polygon_area_ha],
      ['summary', 'analysis_area_ha', currentReport.analysis_area_ha],
      ['summary', 'coverage_percent', currentReport.coverage_percent],
      ['summary', 'candidate_change_area_ha', currentReport.candidate.confirmed_area_ha],
      ['summary', 'strict_permanent_change_area_ha', currentReport.permanent.confirmed_area_ha],
      ['summary', 'provisional_2025_change_area_ha', currentReport.permanent.provisional_2025_area_ha],
      ['summary', 'permanent_change_percent', currentReport.permanent.percent_of_analysis_area]
    ];

    appendBreakdownRows(rows, 'permanent_by_year', currentReport.permanent.by_year_ha);
    appendBreakdownRows(rows, 'permanent_by_baseline', currentReport.permanent.by_baseline_class_ha);
    appendBreakdownRows(rows, 'permanent_by_transition', currentReport.permanent.by_transition_ha);
    appendBreakdownRows(rows, 'permanent_by_first_end_class', currentReport.permanent.by_first_end_class_ha);
    appendBreakdownRows(rows, 'permanent_by_final_2025_class', currentReport.permanent.by_final_2025_class_ha);
    appendBreakdownRows(rows, 'permanent_by_persistence_years', currentReport.permanent.by_persistence_years_ha);
    appendBreakdownRows(rows, 'candidate_by_year', currentReport.candidate.by_year_ha);

    const csv = rows.map(function (row) {
      return row.map(csvEscape).join(',');
    }).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Kogi_change_polygon_report_' +
      new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function appendBreakdownRows(rows, section, object) {
    Object.keys(object || {}).forEach(function (key) {
      rows.push([section, key, object[key]]);
    });
  }

  function csvEscape(value) {
    const text = String(value === undefined || value === null ? '' : value);
    return /[",\n]/.test(text)
      ? '"' + text.replace(/"/g, '""') + '"'
      : text;
  }

  clearAnalysis();
})();