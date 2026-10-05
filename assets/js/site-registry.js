const SITE_API='https://script.google.com/macros/s/AKfycbxQwLQvjV591q8JUCUsgi8_lkJL2rfeWvZCqReJ8zeU5YTufUASp-m9QFNT5TFsrk8/exec';
const SITE_FORM='https://docs.google.com/forms/d/e/1FAIpQLSc5u0zf5JcXUL-hwrUIPJuPV2g7TZSbsUqZA0p_Ja_3NL7yMg/viewform';

const map=L.map('map',{zoomControl:true}).setView([7.8,6.7],8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,
  attribution:'&copy; OpenStreetMap contributors'
}).addTo(map);

const layers={state:null,lgas:null,sites:L.layerGroup().addTo(map),search:null};
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
  layers.search=L.marker([lat,lon]).addTo(map).bindPopup('Selected coordinate<br>'+lat.toFixed(6)+', '+lon.toFixed(6)).openPopup();
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
    L.circleMarker([lat,lon],{radius:7,weight:2,color:st.color,fillColor:st.fillColor,fillOpacity:.9})
      .bindPopup(sitePopup(s),{maxWidth:360})
      .addTo(layers.sites);
    plotted++;
  });
  countEl.textContent=plotted;
  statusEl.className='status ok';
  statusEl.innerHTML='<b>Live registry connected.</b><br>'+plotted+' approved public site point'+(plotted===1?'':'s')+' loaded from Google Sheets.';
}

function jsonp(url,params={},timeout=15000){
  return new Promise((resolve,reject)=>{
    const cb='kogiRegistry_'+Date.now()+'_'+Math.floor(Math.random()*100000);
    const script=document.createElement('script');
    const timer=setTimeout(()=>cleanup(new Error('Registry request timed out.')),timeout);
    function cleanup(err,data){
      clearTimeout(timer); if(script.parentNode) script.parentNode.removeChild(script); delete window[cb];
      err?reject(err):resolve(data);
    }
    window[cb]=data=>cleanup(null,data);
    const q=new URLSearchParams({...params,callback:cb});
    script.src=url+(url.includes('?')?'&':'?')+q.toString();
    script.onerror=()=>cleanup(new Error('Could not load registry feed.'));
    document.head.appendChild(script);
  });
}

async function loadBoundaries(){
  try{
    const [stateResp,lgaResp]=await Promise.all([
      fetch('data/admin/kogi_state.geojson'),
      fetch('data/admin/kogi_lgas.geojson')
    ]);
    const state=await stateResp.json(),lgas=await lgaResp.json();
    layers.state=L.geoJSON(state,{style:{color:'#0f172a',weight:2,fillOpacity:0}}).addTo(map);
    layers.lgas=L.geoJSON(lgas,{
      style:{color:'#64748b',weight:1,fillOpacity:0},
      onEachFeature:(f,l)=>{
        const p=f.properties||{};
        const name=p.lga_name||p.name||p.ADM2_EN||'LGA';
        l.bindTooltip(name,{sticky:true});
      }
    }).addTo(map);
    if(layers.state.getBounds().isValid()) map.fitBounds(layers.state.getBounds(),{padding:[15,15]});
  }catch(err){console.warn('Boundary load failed',err);}
}

async function loadRegistry(){
  statusEl.className='status';
  statusEl.textContent='Loading approved site registry…';
  try{
    const data=await jsonp(SITE_API,{action:'sites'});
    if(!data||data.ok!==true) throw new Error((data&&data.error)||'Registry returned an error.');
    renderSites(data);
  }catch(err){
    statusEl.className='status warn';
    statusEl.innerHTML='<b>Registry feed not available.</b><br>'+esc(err.message)+'<br>The map boundaries still work.';
  }
}

loadBoundaries();
loadRegistry();
