const SITE_API='https://script.google.com/macros/s/AKfycbxQwLQvjV591q8JUCUsgi8_lkJL2rfeWvZCqReJ8zeU5YTufUASp-m9QFNT5TFsrk8/exec';
const SITE_FORM='https://docs.google.com/forms/d/e/1FAIpQLSc5u0zf5JcXUL-hwrUIPJuPV2g7TZSbsUqZA0p_Ja_3NL7yMg/viewform';

const map=L.map('map',{zoomControl:true}).setView([7.8,6.7],8);

map.createPane('rasterPane');
map.getPane('rasterPane').style.zIndex=350;
map.getPane('rasterPane').style.pointerEvents='none';

map.createPane('labelsPane');
map.getPane('labelsPane').style.zIndex=650;
map.getPane('labelsPane').style.pointerEvents='none';

const satelliteImagery=L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {
    maxZoom:19,
    attribution:'Tiles &copy; Esri — Sources: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
  }
);

const satelliteLabels=L.tileLayer(
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  {
    maxZoom:19,
    pane:'labelsPane',
    attribution:'Reference labels &copy; Esri'
  }
);

const satelliteBase=L.layerGroup([satelliteImagery,satelliteLabels]).addTo(map);

const osmBase=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,
  attribution:'&copy; OpenStreetMap contributors'
});

const layers={
  sites:L.featureGroup().addTo(map),
  search:null
};

const layerControl=L.control.layers(
  {
    'Satellite + labels':satelliteBase,
    'OpenStreetMap':osmBase
  },
  {
    'Known / approved sites':layers.sites
  },
  {
    collapsed:true,
    position:'topright'
  }
).addTo(map);

const layerControlContainer=layerControl.getContainer();
const layerToggle=layerControlContainer
  ? layerControlContainer.querySelector('.leaflet-control-layers-toggle')
  : null;

if(layerToggle){
  layerToggle.title='Map layers';
  layerToggle.setAttribute('aria-label','Open map layers');
}

map.on('click',()=>layerControl.collapse());

window.kogiMap=map;
window.kogiLayers=layers;
window.kogiLayerControl=layerControl;

const statusEl=document.getElementById('registryStatus');
const countEl=document.getElementById('siteCount');

document.getElementById('reportSite').href=SITE_FORM;
document.getElementById('goCoord').addEventListener('click',zoomToCoordinate);
document.getElementById('lat').addEventListener('keydown',e=>{if(e.key==='Enter')zoomToCoordinate();});
document.getElementById('lon').addEventListener('keydown',e=>{if(e.key==='Enter')zoomToCoordinate();});

function zoomToCoordinate(){
  const lat=Number(document.getElementById('lat').value);
  const lon=Number(document.getElementById('lon').value);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180){
    alert('Enter valid latitude and longitude in decimal degrees.');
    return;
  }
  if(layers.search) map.removeLayer(layers.search);
  layers.search=L.marker([lat,lon]).addTo(map).bindPopup(
    'Selected coordinate<br>'+lat.toFixed(6)+', '+lon.toFixed(6)
  ).openPopup();
  map.setView([lat,lon],14);
}

function activityStyle(activity){
  const a=String(activity||'').toLowerCase();
  if(a.includes('mining')) return {color:'#7c2d12',fillColor:'#dc2626'};
  if(a.includes('quarry')) return {color:'#713f12',fillColor:'#f59e0b'};
  if(a.includes('factory')) return {color:'#1e3a8a',fillColor:'#2563eb'};
  if(a.includes('building')) return {color:'#581c87',fillColor:'#9333ea'};
  if(a.includes('prospect')) return {color:'#14532d',fillColor:'#16a34a'};
  return {color:'#334155',fillColor:'#64748b'};
}

function esc(v){
  return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function show(v){return (v===null||v===undefined||v==='')?'—':esc(v);}

function sitePopup(s){
  const rows=[
    ['ID',s.record_id],['Type',s.activity_type],['Commodity',s.commodity],
    ['Reported operator',s.operator_name_reported],['Operator evidence',s.operator_evidence_status],
    ['LGA',s.lga_name],['Locality',s.community_locality],['Permit',s.permit_status],
    ['Validation',s.validation_status],['Remote sensing',s.remote_sensing_status],
    ['Permanent change (ha)',s.permanent_change_area_ha],['Candidate change (ha)',s.candidate_change_area_ha],
    ['First permanent year',s.first_permanent_change_year]
  ];
  let html='<div class="popup-title">'+show(s.site_name)+'</div><div class="popup-grid">';
  rows.forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')html+='<div><b>'+esc(k)+':</b> '+show(v)+'</div>';});
  if(s.source_url) html+='<div><a href="'+esc(s.source_url)+'" target="_blank" rel="noopener">Source</a></div>';
  html+='</div>';
  return html;
}

function renderSites(data){
  layers.sites.clearLayers();
  const sites=(data&&Array.isArray(data.sites))?data.sites:[];
  let plotted=0;
  sites.forEach(s=>{
    const lat=Number(s.latitude),lon=Number(s.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)) return;
    const st=activityStyle(s.activity_type);
    L.circleMarker([lat,lon],{
      radius:7,weight:2,color:st.color,fillColor:st.fillColor,fillOpacity:.9
    }).bindPopup(sitePopup(s),{maxWidth:360}).addTo(layers.sites);
    plotted++;
  });
  countEl.textContent=plotted;
  statusEl.className='status ok';
  statusEl.innerHTML='<b>Live registry connected.</b><br>'+plotted+
    ' approved public site point'+(plotted===1?'':'s')+' loaded from Google Sheets.';
}

function jsonp(url,params={},timeout=45000){
  return new Promise((resolve,reject)=>{
    const cb='kogiRegistry_'+Date.now()+'_'+Math.floor(Math.random()*100000);
    const script=document.createElement('script');
    let settled=false;
    const timer=setTimeout(()=>cleanup(new Error('Registry request timed out.')),timeout);

    function cleanup(err,data){
      if(settled) return;
      settled=true;
      clearTimeout(timer);
      if(script.parentNode) script.parentNode.removeChild(script);
      try{ delete window[cb]; }catch(e){ window[cb]=undefined; }
      err?reject(err):resolve(data);
    }

    window[cb]=data=>cleanup(null,data);
    const q=new URLSearchParams({...params,callback:cb,_:Date.now()});
    script.src=url+(url.includes('?')?'&':'?')+q.toString();
    script.async=true;
    script.onerror=()=>cleanup(new Error('Could not load registry feed.'));
    document.head.appendChild(script);
  });
}

async function fetchRegistryJson(timeout=25000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);

  try{
    const url=SITE_API+'?action=sites&_='+Date.now();
    const response=await fetch(url,{
      method:'GET',
      cache:'no-store',
      redirect:'follow',
      signal:controller.signal
    });
    if(!response.ok) throw new Error('Registry returned HTTP '+response.status+'.');
    return await response.json();
  }finally{
    clearTimeout(timer);
  }
}

async function fetchFallbackRegistry(){
  const response=await fetch('data/site_registry_fallback.json',{cache:'no-store'});
  if(!response.ok) throw new Error('Local registry fallback is unavailable.');
  return await response.json();
}

async function getLiveRegistry(){
  let firstError=null;

  try{
    const data=await fetchRegistryJson();
    if(data&&data.ok===true&&Array.isArray(data.sites)) return data;
    throw new Error((data&&data.error)||'Registry returned an invalid response.');
  }catch(err){
    firstError=err;
  }

  statusEl.textContent='Google registry is slow; retrying…';

  try{
    const data=await jsonp(SITE_API,{action:'sites'},45000);
    if(data&&data.ok===true&&Array.isArray(data.sites)) return data;
    throw new Error((data&&data.error)||'Registry returned an invalid response.');
  }catch(err){
    const combined=new Error(
      'Live registry unavailable. '+
      (firstError&&firstError.message?firstError.message+' ':'')+
      (err&&err.message?err.message:'')
    );
    combined.liveFailure=true;
    throw combined;
  }
}

async function loadRegistry(){
  statusEl.className='status';
  statusEl.textContent='Loading approved site registry…';

  try{
    const data=await getLiveRegistry();
    renderSites(data);
  }catch(liveErr){
    console.warn('Live registry unavailable; using fallback.',liveErr);

    try{
      const fallback=await fetchFallbackRegistry();
      renderSites(fallback);
      statusEl.className='status warn';
      statusEl.innerHTML=
        '<b>Showing cached public registry.</b><br>'+
        fallback.sites.length+
        ' known site point'+(fallback.sites.length===1?'':'s')+
        ' loaded locally while the Google registry is temporarily unavailable.';
    }catch(fallbackErr){
      console.error(fallbackErr);
      statusEl.className='status warn';
      statusEl.innerHTML=
        '<b>Registry feed not available.</b><br>'+
        esc(liveErr.message)+
        '<br>The map still works.';
    }
  }
}

loadRegistry();
