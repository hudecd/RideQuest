const STORAGE_KEY='ridequest-data-v1';
let memoryStore={};
const storage={getItem(k){try{return localStorage.getItem(k)}catch(e){return memoryStore[k]??null}},setItem(k,v){try{localStorage.setItem(k,v)}catch(e){memoryStore[k]=String(v)}}};
const LEVELS=[
  {name:'Trail Scout',min:0,next:100},
  {name:'Vector Rider',min:100,next:250},
  {name:'Gravity Runner',min:250,next:450},
  {name:'Rift Vanguard',min:450,next:700},
  {name:'Apex Navigator',min:700,next:null}
];
const TYPE_LABEL={trail:'Trail',enduro:'Enduro',bikepark:'Bikepark',freeride:'Freeride'};
let rides=load();
let editingId=null;
let tracker={recording:false,watchId:null,startTime:0,elapsedTimer:null,distanceKm:0,lastPos:null,locationLabel:'',startCoords:null};

function load(){
  try{
    const raw=storage.getItem(STORAGE_KEY);
    if(!raw)return [];
    const parsed=JSON.parse(raw);
    return Array.isArray(parsed.rides)?parsed.rides:[];
  }catch(e){return []}
}
function persist(){storage.setItem(STORAGE_KEY,JSON.stringify({schema:2,rides}));}
function uid(){return crypto?.randomUUID?.() || String(Date.now()+Math.random())}
function xpFor(r){return 20+Math.floor(Number(r.duration||0)/15)*5}
function totals(){
  return rides.reduce((a,r)=>{a.xp+=xpFor(r);a.time+=Number(r.duration)||0;a.distance+=Number(r.distance)||0;a.drops+=Number(r.drops)||0;a.ratingSum+=Number(r.rating)||0;return a},{xp:0,time:0,distance:0,drops:0,ratingSum:0});
}
function levelFor(xp){for(let i=LEVELS.length-1;i>=0;i--)if(xp>=LEVELS[i].min)return {i,level:LEVELS[i]};return {i:0,level:LEVELS[0]}}
function fmtDate(s){if(!s)return '—';const [y,m,d]=s.split('-');return `${d}.${m}.${y}`}
function minsText(m){const n=Math.max(0,Math.floor(Number(m)||0));const h=Math.floor(n/60),mm=n%60;return h?`${h} h ${mm} min`:`${mm} min`}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showToast(t){const el=document.getElementById('toast');el.textContent=t;el.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.classList.remove('show'),1900)}
function nav(screen){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(`screen-${screen}`).classList.add('active');document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.go===screen));if(screen==='dashboard')renderDashboard();if(screen==='history')renderHistory();if(screen==='stats')renderStats();window.scrollTo({top:0,behavior:'smooth'});}
document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b){const target=b.dataset.go;if(target==='add')resetForm();nav(target)}});

function renderDashboard(){
  const t=totals(),{level}=levelFor(t.xp);
  document.getElementById('xpTotal').textContent=`${t.xp} XP`;document.getElementById('levelName').textContent=level.name;
  let pct=100,progress=`MAX LVL · ${t.xp} XP`;
  if(level.next!==null){const pctBase=level.next-level.min;pct=Math.max(0,Math.min(100,((t.xp-level.min)/pctBase)*100));progress=`${t.xp-level.min} / ${pctBase} XP do ďalšej úrovne`;}
  document.getElementById('xpBar').style.width=`${pct}%`;document.getElementById('xpProgress').textContent=progress;
  document.getElementById('dashboardStats').innerHTML=[stat(t.xp,'XP'),stat(rides.length,'jázd'),stat(minsText(t.time),'čas'),stat(`${t.distance.toFixed(1)} km`,'vzdialenosť')].join('');
  const recent=[...rides].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt).slice(0,3);
  document.getElementById('recentRides').innerHTML=recent.length?recent.map(r=>rideCompact(r)).join(''):`<div class="empty">Zatiaľ nemáš uloženú jazdu.<br>Pridaj prvú a odomkni XP.</div>`;
}
function stat(num,label){return `<div class="stat"><div class="num">${num}</div><div class="label">${label}</div></div>`}
function rideCompact(r){return `<div class="ride"><div><div class="ride-title">${esc(r.place)}</div><div class="ride-meta">${fmtDate(r.date)} · ${minsText(r.duration)}${r.distance?` · ${Number(r.distance).toFixed(1)} km`:''}</div><div class="ride-kind">${TYPE_LABEL[r.type]}</div></div><div class="ride-side"><div class="ride-xp">+${xpFor(r)} XP</div><div style="font-size:12px;color:#b8c3ca;margin-top:4px">★ ${r.rating}/5</div></div></div>`}

function trackerElements(){return {panel:document.querySelector('.tracker-panel'),status:document.getElementById('trackerStatus'),meta:document.getElementById('trackerMeta'),location:document.getElementById('trackerLocation'),error:document.getElementById('trackerError'),btn:document.getElementById('gpsToggle'),icon:document.getElementById('gpsIcon'),label:document.getElementById('gpsLabel')}}
function clearTrackerTimer(){if(tracker.elapsedTimer){clearInterval(tracker.elapsedTimer);tracker.elapsedTimer=null}}
function resetTrackerUI(){const e=trackerElements();e.panel?.classList.remove('recording');e.btn?.classList.remove('recording');if(e.icon)e.icon.textContent='▶';if(e.label)e.label.textContent='START';if(e.status)e.status.textContent='Pripravené na jazdu';if(e.meta)e.meta.textContent='Čas 00:00 · 0.00 km · GPS čaká';if(e.location)e.location.textContent='Lokalita sa určí automaticky po štarte.';if(e.error){e.error.textContent='';e.error.classList.remove('show')}}
function formatClock(sec){sec=Math.max(0,Math.floor(sec));return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`}
function haversineKm(a,b){const R=6371;const toRad=x=>x*Math.PI/180;const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);const q=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;return R*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));}
function updateTrackerMeta(){const e=trackerElements();if(!e.meta)return;const sec=(Date.now()-tracker.startTime)/1000;e.meta.textContent=`Čas ${formatClock(sec)} · ${tracker.distanceKm.toFixed(2)} km · ${tracker.lastPos?'GPS aktívne':'GPS čaká'}`}
async function reverseGeocode(lat,lon){
  try{
    const u=`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res=await fetch(u,{headers:{Accept:'application/json'}});if(!res.ok)throw new Error('reverse geocode failed');
    const data=await res.json();const a=data.address||{};return a.city||a.town||a.village||a.municipality||a.county||data.name||`${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }catch(e){return `${lat.toFixed(4)}, ${lon.toFixed(4)}`}
}
function onPosition(pos){if(!tracker.recording)return;const cur={lat:pos.coords.latitude,lon:pos.coords.longitude};if(tracker.lastPos){const delta=haversineKm(tracker.lastPos,cur);if(delta>=0&&delta<1)tracker.distanceKm+=delta}else{tracker.startCoords=cur;setLocationFromCoords(cur)}tracker.lastPos=cur;updateTrackerMeta();}
async function setLocationFromCoords(coords){const e=trackerElements();if(e.location)e.location.textContent='Lokalita: zisťujem…';const label=await reverseGeocode(coords.lat,coords.lon);if(!tracker.recording&&tracker.locationLabel!==label)return;tracker.locationLabel=label;if(e.location)e.location.textContent=`Lokalita: ${label}`;const place=document.getElementById('place');if(place&&!editingId&&!place.value.trim())place.value=label;}
function onGeoError(err){const e=trackerElements();const message=err?.code===1?'GPS povolenie bolo zamietnuté. Čas sa stále nahráva, vzdialenosť zostane bez GPS.':'GPS nie je momentálne dostupné. Čas sa stále nahráva.';if(e.error){e.error.textContent=message;e.error.classList.add('show')}updateTrackerMeta()}
function startTracker(){
  if(!navigator.geolocation){const e=trackerElements();e.error.textContent='Toto zariadenie nepodporuje GPS v prehliadači.';e.error.classList.add('show');return;}
  tracker={recording:true,watchId:null,startTime:Date.now(),elapsedTimer:null,distanceKm:0,lastPos:null,locationLabel:'',startCoords:null};
  const e=trackerElements();e.panel.classList.add('recording');e.btn.classList.add('recording');e.icon.textContent='■';e.label.textContent='STOP';e.status.textContent='Jazda sa nahráva';e.error.classList.remove('show');
  tracker.elapsedTimer=setInterval(updateTrackerMeta,1000);updateTrackerMeta();
  navigator.geolocation.getCurrentPosition(onPosition,onGeoError,{enableHighAccuracy:true,timeout:10000,maximumAge:0});
  tracker.watchId=navigator.geolocation.watchPosition(onPosition,onGeoError,{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
}
function stopTracker(){
  tracker.recording=false;clearTrackerTimer();if(tracker.watchId!==null){navigator.geolocation.clearWatch(tracker.watchId);tracker.watchId=null;}
  const elapsedMin=Math.max(1,Math.round((Date.now()-tracker.startTime)/60000));
  document.getElementById('duration').value=Math.min(1440,elapsedMin);document.getElementById('distance').value=tracker.distanceKm>0?tracker.distanceKm.toFixed(1):'';
  const e=trackerElements();e.panel.classList.remove('recording');e.btn.classList.remove('recording');e.icon.textContent='▶';e.label.textContent='START';e.status.textContent='Jazda ukončená';e.meta.textContent=`Čas ${formatClock((Date.now()-tracker.startTime)/1000)} · ${tracker.distanceKm.toFixed(2)} km · GPS uložené`;if(e.location)e.location.textContent=tracker.locationLabel?`Lokalita: ${tracker.locationLabel}`:'Lokalita sa nepodarila určiť.';showToast('GPS jazda zastavená');
}
function toggleTracker(){if(tracker.recording)stopTracker();else startTracker()}
function resetForm(){
  if(tracker.recording)stopTracker();editingId=null;document.getElementById('rideForm').reset();document.getElementById('rideId').value='';document.getElementById('date').value=new Date().toISOString().slice(0,10);document.getElementById('drops').value='0';document.getElementById('formTitle').textContent='Nová jazda';document.getElementById('saveRide').textContent='ULOŽIŤ JAZDU';document.getElementById('formError').classList.remove('show');resetTrackerUI();
}
function openEdit(id){const r=rides.find(x=>x.id===id);if(!r)return;if(tracker.recording)stopTracker();editingId=id;nav('add');document.getElementById('formTitle').textContent='Upraviť jazdu';document.getElementById('saveRide').textContent='ULOŽIŤ ZMENY';document.getElementById('rideId').value=r.id;for(const id2 of ['date','place','type','duration','distance','drops','rating','best','notes'])document.getElementById(id2).value=r[id2]??'';document.getElementById('trackerLocation').textContent=r.place?`Lokalita: ${r.place}`:'Lokalita sa určí automaticky po štarte.';document.getElementById('trackerStatus').textContent='Úprava uloženej jazdy';}

document.getElementById('gpsToggle').addEventListener('click',toggleTracker);
document.getElementById('rideForm').addEventListener('submit',e=>{
  e.preventDefault();
  if(tracker.recording){stopTracker();showToast('Najprv zastav GPS jazdu');return;}
  const err=document.getElementById('formError');
  const data={date:document.getElementById('date').value,place:document.getElementById('place').value.trim(),type:document.getElementById('type').value,duration:Number(document.getElementById('duration').value),distance:document.getElementById('distance').value===''?null:Number(document.getElementById('distance').value),drops:Number(document.getElementById('drops').value||0),rating:Number(document.getElementById('rating').value),best:document.getElementById('best').value.trim(),notes:document.getElementById('notes').value.trim()};
  const invalid=!data.date||!data.place||!['trail','enduro','bikepark','freeride'].includes(data.type)||!Number.isInteger(data.duration)||data.duration<1||data.duration>1440||data.distance!==null&&(data.distance<0||data.distance>1000)||!Number.isInteger(data.drops)||data.drops<0||data.drops>1000||![1,2,3,4,5].includes(data.rating);
  if(invalid){err.textContent='Skontroluj povinné údaje a hodnoty. Čísla nemôžu byť záporné.';err.classList.add('show');return}err.classList.remove('show');
  if(editingId){const old=rides.find(r=>r.id===editingId);Object.assign(old,data,{updatedAt:Date.now()});showToast('Jazda upravená');}else{rides.push({id:uid(),...data,createdAt:Date.now()});showToast(`Jazda uložená · +${xpFor(data)} XP`)}
  persist();nav('dashboard');
});

function renderHistory(){
 const type=document.getElementById('filterType').value,sort=document.getElementById('sortOrder').value;let list=rides.filter(r=>type==='all'||r.type===type).sort((a,b)=>{const d=a.date.localeCompare(b.date);return sort==='newest'?-d:d});const el=document.getElementById('historyList');
 el.innerHTML=list.length?list.map(r=>`<article class="list-card"><div class="list-top"><div><div class="list-title">${esc(r.place)}</div><div class="ride-meta">${fmtDate(r.date)} · ${minsText(r.duration)}${r.distance!==null&&r.distance!==undefined?` · ${Number(r.distance).toFixed(1)} km`:''}</div></div><div class="tag">${TYPE_LABEL[r.type]}</div></div><div class="detail-grid"><div class="detail-stat"><b>${r.drops}</b><span>dropy</span></div><div class="detail-stat"><b>${r.rating}/5</b><span>hodnotenie</span></div><div class="detail-stat"><b>${Number(r.distance||0).toFixed(1)}</b><span>km</span></div><div class="detail-stat"><b>${minsText(r.duration)}</b><span>čas</span></div></div>${r.best?`<div style="margin-top:10px;color:#d7e0e6;font-size:13px"><b>Moment:</b> ${esc(r.best)}</div>`:''}${r.notes?`<div style="margin-top:7px;color:#929fab;font-size:12px">${esc(r.notes)}</div>`:''}<div class="list-actions"><button data-edit="${r.id}">Upraviť</button><button data-delete="${r.id}">Vymazať</button></div></article>`).join(''):`<div class="empty">Žiadne jazdy pre zvolený filter.</div>`;
}
document.getElementById('filterType').addEventListener('change',renderHistory);document.getElementById('sortOrder').addEventListener('change',renderHistory);document.getElementById('historyList').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)openEdit(edit.dataset.edit);if(del){const r=rides.find(x=>x.id===del.dataset.delete);if(r&&confirm(`Vymazať jazdu „${r.place}“?`)){rides=rides.filter(x=>x.id!==r.id);persist();renderHistory();renderDashboard();showToast('Jazda vymazaná')}}});

function renderStats(){
 const t=totals(),avg=rides.length?(t.ratingSum/rides.length).toFixed(1):'0.0',counts={trail:0,enduro:0,bikepark:0,freeride:0};rides.forEach(r=>counts[r.type]++);const most=rides.length?TYPE_LABEL[Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0]]:'—';
 document.getElementById('statsGrid').innerHTML=[['POČET JÁZD',rides.length],['CELKOVÝ ČAS',minsText(t.time)],['CELKOVÁ VZDIALENOSŤ',`${t.distance.toFixed(1)} km`],['PRIEMERNÉ HODNOTENIE',`${avg}/5`],['NAJČASTEJŠÍ TYP',most],['POČET DROPOV',t.drops]].map(x=>`<div class="big-stat"><div class="v">${x[1]}</div><div class="k">${x[0]}</div></div>`).join('');
 const now=new Date(),arr=[];for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;arr.push({label:d.toLocaleString('sk-SK',{month:'short'}),count:rides.filter(r=>r.date.startsWith(key)).length})}const max=Math.max(1,...arr.map(x=>x.count));document.getElementById('monthChart').innerHTML=arr.map(x=>`<div class="bar-col"><b>${x.count}</b><i style="height:${Math.max(4,(x.count/max)*105)}px"></i><span>${x.label}</span></div>`).join('');
}

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}
resetForm();renderDashboard();
window.addEventListener('beforeunload',()=>{if(tracker.recording)navigator.geolocation?.clearWatch(tracker.watchId)});
