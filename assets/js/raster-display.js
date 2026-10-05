(function(){
  'use strict';

  const map=window.kogiMap;
  const layerControl=window.kogiLayerControl;
  if(!map||!layerControl||!window.GeoTIFF){
    console.warn('Raster display prerequisites are unavailable.');
    return;
  }

  const statusEl=document.getElementById('rasterStatus');
  const legendEl=document.getElementById('rasterLegend');
  const MIN_ZOOM=9;
  const MAX_VISIBLE_TILES=18;

  const groups={
    permanent:L.layerGroup(),
    candidate:L.layerGroup()
  };

  layerControl.addOverlay(groups.permanent,'Strict permanent change raster');
  layerControl.addOverlay(groups.candidate,'Potential / candidate change raster');

  const active={
    permanent:new Map(),
    candidate:new Map()
  };

  const renderCache=new Map();
  let tileIndexPromise=null;
  let refreshTimer=null;

  const permanentColors={
    2021:[215,48,39,215],
    2022:[252,141,89,215],
    2023:[254,224,139,220],
    2024:[145,191,219,220],
    2025:[0,188,212,225]
  };

  map.on('overlayadd',function(e){
    if(e.layer===groups.permanent){
      setLegend('permanent');
      scheduleRefresh();
    }else if(e.layer===groups.candidate){
      setLegend('candidate');
      scheduleRefresh();
    }
  });

  map.on('overlayremove',function(e){
    if(e.layer===groups.permanent||e.layer===groups.candidate){
      if(!map.hasLayer(groups.permanent)&&!map.hasLayer(groups.candidate)){
        statusEl.textContent='Choose a change raster from the layer control.';
        legendEl.innerHTML='';
      }else if(map.hasLayer(groups.permanent)){
        setLegend('permanent');
      }else{
        setLegend('candidate');
      }
    }
  });

  map.on('moveend zoomend',scheduleRefresh);

  function scheduleRefresh(){
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(refreshVisibleRasters,180);
  }

  async function getTileIndex(){
    if(!tileIndexPromise){
      tileIndexPromise=fetch('data/tile_index.geojson').then(r=>{
        if(!r.ok) throw new Error('Could not load tile index.');
        return r.json();
      });
    }
    return tileIndexPromise;
  }

  async function refreshVisibleRasters(){
    const enabled=[];
    if(map.hasLayer(groups.permanent)) enabled.push('permanent');
    if(map.hasLayer(groups.candidate)) enabled.push('candidate');
    if(!enabled.length) return;

    if(map.getZoom()<MIN_ZOOM){
      enabled.forEach(clearActive);
      statusEl.className='status';
      statusEl.innerHTML='<b>Raster display ready.</b><br>Zoom to level '+MIN_ZOOM+
        ' or closer to load change pixels.';
      return;
    }

    try{
      const index=await getTileIndex();
      for(const type of enabled){
        await refreshType(type,index);
      }
    }catch(err){
      console.error(err);
      statusEl.className='status warn';
      statusEl.innerHTML='<b>Raster display error.</b><br>'+esc(err.message||err);
    }
  }

  async function refreshType(type,index){
    const b=map.getBounds();
    const visible=index.features.filter(f=>{
      const p=f.properties||{};
      const has=type==='permanent'?p.has_permanent:p.has_candidate;
      const path=type==='permanent'?p.permanent_path:p.candidate_path;
      if(!has||!path||!p.bounds_wgs84) return false;
      const bb=p.bounds_wgs84;
      return !(bb[2]<b.getWest()||bb[0]>b.getEast()||bb[3]<b.getSouth()||bb[1]>b.getNorth());
    });

    if(visible.length>MAX_VISIBLE_TILES){
      clearActive(type);
      statusEl.className='status';
      statusEl.innerHTML='<b>'+label(type)+'</b><br>'+visible.length+
        ' tiles are visible. Zoom in further to display the raster efficiently.';
      return;
    }

    const wanted=new Set(visible.map(f=>pathFor(type,f.properties)));

    for(const [path,overlay] of active[type]){
      if(!wanted.has(path)){
        groups[type].removeLayer(overlay);
        active[type].delete(path);
      }
    }

    let loaded=0;
    for(const feature of visible){
      const path=pathFor(type,feature.properties);
      if(active[type].has(path)) continue;

      statusEl.className='status';
      statusEl.textContent='Loading '+label(type)+' '+(loaded+1)+' of '+visible.length+' visible tile(s)…';

      const overlay=await makeOverlay(type,feature);
      groups[type].addLayer(overlay);
      active[type].set(path,overlay);
      loaded++;
    }

    statusEl.className='status ok';
    statusEl.innerHTML='<b>'+label(type)+' visible.</b><br>'+
      visible.length+' change raster tile'+(visible.length===1?'':'s')+' in the current map view.';
  }

  async function makeOverlay(type,feature){
    const p=feature.properties;
    const path=pathFor(type,p);
    const resolution=map.getZoom()>=13?700:(map.getZoom()>=11?500:300);
    const cacheKey=type+'|'+path+'|'+resolution;

    let rendered=renderCache.get(cacheKey);
    if(!rendered){
      const response=await fetch(path);
      if(!response.ok) throw new Error('Could not load '+path);
      const buffer=await response.arrayBuffer();
      const tiff=await GeoTIFF.fromArrayBuffer(buffer);
      const image=await tiff.getImage();

      const samples=type==='permanent'?[0,6]:[0,5];
      const rasters=await image.readRasters({
        width:resolution,
        height:resolution,
        samples:samples,
        resampleMethod:'nearest'
      });

      const years=rasters[0];
      const statuses=rasters[1];

      const canvas=document.createElement('canvas');
      canvas.width=resolution;
      canvas.height=resolution;
      const ctx=canvas.getContext('2d');
      const img=ctx.createImageData(resolution,resolution);

      for(let i=0;i<years.length;i++){
        const year=Number(years[i]);
        const status=Number(statuses[i]);
        let rgba=null;

        if(type==='permanent'){
          if(status===1){
            rgba=permanentColors[year]||[220,38,38,215];
          }else if(status===2){
            rgba=permanentColors[2025];
          }
        }else{
          if(status===1){
            rgba=[255,140,0,205];
          }else if(status===2){
            rgba=[0,188,212,220];
          }
        }

        if(rgba){
          const o=i*4;
          img.data[o]=rgba[0];
          img.data[o+1]=rgba[1];
          img.data[o+2]=rgba[2];
          img.data[o+3]=rgba[3];
        }
      }

      ctx.putImageData(img,0,0);
      rendered={
        dataUrl:canvas.toDataURL('image/png'),
        bounds:[[p.bounds_wgs84[1],p.bounds_wgs84[0]],[p.bounds_wgs84[3],p.bounds_wgs84[2]]]
      };
      renderCache.set(cacheKey,rendered);
      trimCache();
    }

    return L.imageOverlay(rendered.dataUrl,rendered.bounds,{
      opacity:type==='permanent'?.82:.72,
      pane:'rasterPane',
      interactive:false,
      className:'change-raster-overlay'
    });
  }

  function trimCache(){
    const max=36;
    while(renderCache.size>max){
      const first=renderCache.keys().next().value;
      renderCache.delete(first);
    }
  }

  function clearActive(type){
    for(const overlay of active[type].values()){
      groups[type].removeLayer(overlay);
    }
    active[type].clear();
  }

  function pathFor(type,p){
    return type==='permanent'?p.permanent_path:p.candidate_path;
  }

  function label(type){
    return type==='permanent'?'Strict permanent change':'Potential / candidate change';
  }

  function setLegend(type){
    if(type==='permanent'){
      legendEl.innerHTML=
        '<div class="raster-legend-title">Strict permanent change</div>'+
        swatch('#d73027','2021')+
        swatch('#fc8d59','2022')+
        swatch('#fee08b','2023')+
        swatch('#91bfdb','2024')+
        swatch('#00bcd4','2025 provisional');
    }else{
      legendEl.innerHTML=
        '<div class="raster-legend-title">Potential / candidate change</div>'+
        swatch('#ff8c00','Candidate / original rule')+
        swatch('#00bcd4','2025 provisional');
    }
  }

  function swatch(color,text){
    return '<div class="legend-row"><span class="raster-swatch" style="background:'+color+'"></span>'+esc(text)+'</div>';
  }

  statusEl.textContent='Choose a change raster from the layer control.';
})();