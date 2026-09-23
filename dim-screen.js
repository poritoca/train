'use strict';
// A foreground display only: never pauses geolocation, alarms or the wake lock.
window.createDimScreen = function(api, controls={}) {
  const $=id=>document.getElementById(id), key='ekikan-dim-screen-v1', delays=[0,3,5,10,30,60];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let seconds=10,motion='auto',active=false,preview=false,lastInput=Date.now(),lastState=null,phase='',lastFocus=null,routeCenterRequested=false;
  let hiddenNodes=[],themeBefore='';
  try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(delays.includes(saved?.seconds))seconds=saved.seconds;if(['auto','static'].includes(saved?.motion))motion=saved.motion}catch{}
  const overlay=document.createElement('section');overlay.id='dimScreen';overlay.hidden=true;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','節電画面');
  overlay.innerHTML='<div class="dim-top"><span id="dimMode">節電画面</span><span id="dimWake"></span></div><div class="dim-content"><p class="dim-label">次の停車駅</p><h2 id="dimNext">確認中</h2><p id="dimEta" class="dim-eta">到着時間を計算中</p><p id="dimGpsAge" class="gps-age gps-age-unknown">GPS最終取得 未取得</p><div class="progress-view-switch dim-view-switch" role="group" aria-label="現在位置の表示方法"><button id="dimViewSegment" type="button" aria-pressed="true">現在区間</button><button id="dimViewRoute" type="button" aria-pressed="false">全区間</button></div><div id="dimSegmentView"><div class="dim-position"><div class="dim-light-clip"><div id="positionLight" class="position-light" aria-hidden="true"><i class="light-halo"></i></div></div><div id="dimTrack" class="dim-track" role="progressbar" aria-label="次の停車駅までの位置" aria-valuemin="0" aria-valuemax="100">'+Array.from({length:10},()=>'<span aria-hidden="true"></span>').join('')+'</div></div><div class="dim-endpoints"><span id="dimFrom">—</span><span id="dimPercent">位置を確認中</span></div></div><div id="dimRouteOverview" class="route-overview-view dim-route" hidden><div class="route-overview-head"><span id="dimRouteRange">経路を確認中</span><button id="dimRouteCenter" type="button" class="route-center">現在地へ</button></div><div id="dimRouteCanvas" class="route-overview-canvas" role="progressbar" aria-label="出発地から最終目的地までの現在位置" aria-valuemin="0" aria-valuemax="100"></div></div><p id="dimQuality" class="dim-quality"></p><div class="dim-goal"><span>降りる駅</span><strong id="dimGoal">—</strong><span id="dimRemaining"></span></div><p id="dimNotice" class="dim-notice" role="status"></p></div><div class="dim-bottom"><p id="dimHint">画面を開いたままご利用ください</p><button id="dimExit" type="button">通常画面に戻る</button></div>';
  document.body.append($('dimNow'),overlay);
  $('dimDelay').value=String(seconds);$('dimMotion').value=motion;overlay.classList.toggle('dim-static',motion==='static');
  function saveDimSettings(){try{localStorage.setItem(key,JSON.stringify({seconds,motion}))}catch{api.toast('節電画面の設定を保存できませんでした。')}}
  $('dimDelay').addEventListener('change',()=>{seconds=Number($('dimDelay').value);lastInput=Date.now();saveDimSettings()});
  $('dimMotion').addEventListener('change',()=>{motion=$('dimMotion').value==='static'?'static':'auto';overlay.classList.toggle('dim-static',motion==='static');lastInput=Date.now();saveDimSettings()});
  function eligible(st=lastState){return !!st?.armed&&!!st.running&&!st.alert&&!st.arrived&&phase!=='transfer'&&phase!=='arrived'&&phase!=='paused'&&!$('panelRide').hidden&&!$('journeyDialog').open&&!document.hidden}
  function formatGpsAge(age){if(!Number.isFinite(age))return'未取得';const sec=Math.max(0,Math.floor(age));if(sec<60)return sec+'秒前';const m=Math.floor(sec/60),r=sec%60;return m+'分'+String(r).padStart(2,'0')+'秒前'}
  function gpsAgeLevel(age){if(!Number.isFinite(age))return'unknown';if(age<12)return'fresh';if(age<30)return'aging';if(age<60)return'stale';if(age<180)return'warning';return'critical'}
  function liveGpsAge(st){const at=Number(st?.gpsAt);return at>0?Math.max(0,(Date.now()-at)/1000):Number.isFinite(st?.gpsAgeSec)?st.gpsAgeSec:null}
  function paintGpsAge(st){const el=$('dimGpsAge');if(preview){el.className='gps-age gps-age-fresh';el.textContent='GPS最終取得 表示例';return}const age=liveGpsAge(st),level=gpsAgeLevel(age),prefix=level==='warning'||level==='critical'?'⚠ ':'';el.className='gps-age gps-age-'+level;el.textContent=prefix+'GPS最終取得 '+formatGpsAge(age);el.setAttribute('aria-label',Number.isFinite(age)?'GPS最終取得から'+formatGpsAge(age):'GPSはまだ取得できていません')}
  function show(test=false){
    if(active)return;if(!test&&!eligible()){api.toast('見守りを開始すると節電画面を使えます。');return}
    preview=test;active=true;lastFocus=document.activeElement;routeCenterRequested=controls.getMode?.()==='route';
    // Inert prevents focus/VoiceOver from reaching covered controls. Restore original state on exit.
    hiddenNodes=[...document.body.children].filter(n=>n!==overlay&&n.id!=='transferGuideDialog'&&n.tagName!=='SCRIPT'&&n.tagName!=='STYLE').map(n=>[n,n.inert,n.getAttribute('aria-hidden')]);
    for(const [n]of hiddenNodes){n.inert=true;n.setAttribute('aria-hidden','true')}
    overlay.hidden=false;document.body.classList.add('dim-active');
    const theme=document.querySelector('meta[name="theme-color"]');themeBefore=theme?.content||'';if(theme)theme.content='#000000';
    paint();$('dimExit').focus({preventScroll:true});
  }
  function hide(){
    if(!active)return;active=false;preview=false;overlay.hidden=true;document.body.classList.remove('dim-active');
    for(const [n,inert,aria]of hiddenNodes){n.inert=inert;if(aria===null)n.removeAttribute('aria-hidden');else n.setAttribute('aria-hidden',aria)}hiddenNodes=[];
    const theme=document.querySelector('meta[name="theme-color"]');if(theme)theme.content=themeBefore;
    lastInput=Date.now();lastFocus?.focus?.({preventScroll:true});
  }
  function previewOverview(){
    const rows=[['横浜','start',0,''],['川崎','stop',0,''],['品川','transfer',1,'山手線'],['大崎','pass',1,''],['渋谷','transfer',2,'東京メトロ銀座線'],['表参道','stop',2,''],['新橋','end',2,'']],ys=[40,92,148,230,286,370,426];return{from:'横浜',to:'新橋',stations:rows.map((x,i)=>({name:x[0],kind:x[1],legIndex:x[2],transferTo:x[3],isStop:x[1]!=='pass',y:ys[i]})),ys,legBadges:[{y:4,index:0,routeName:'東海道線'},{y:165,index:1,routeName:'山手線'},{y:303,index:2,routeName:'銀座線'}],totalHeight:460,currentY:244,progressRatio:.54,estimated:false,manual:false,currentLegIndex:1,legCount:3,stationCount:7,journey:true};
  }
  function centerRoute(){const marker=$('dimRouteCanvas')?.querySelector('.route-current-marker');marker?.scrollIntoView?.({block:'center',inline:'nearest',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
  function stationTag(x){if(x.kind==='start')return'出発';if(x.kind==='end')return'最終';if(x.kind==='transfer')return x.transferTo?'乗換 → '+x.transferTo:'乗換';return x.isStop?'停車':'通過'}
  function passedStationLabel(x){if(x?.kind==='start')return'✓ 出発済み';if(x?.kind==='transfer')return'✓ 乗換済み';return'✓ 通過済み'}
  function updateRouteStationProgress(canvas,model){const current=model?.currentY,known=Number.isFinite(current),els=[...canvas.querySelectorAll('.route-station')];els.forEach((el,i)=>{const y=Number(model?.ys?.[i]),x=model?.stations?.[i],passed=known&&Number.isFinite(y)&&y<current-10,atCurrent=known&&Number.isFinite(y)&&Math.abs(y-current)<=10&&!passed,small=el.querySelector('small');el.classList.toggle('route-station-passed',passed);el.classList.toggle('route-station-current-position',atCurrent);if(small){if(!small.dataset.baseTag)small.dataset.baseTag=small.textContent||'';small.textContent=passed?passedStationLabel(x):small.dataset.baseTag}if(!el.dataset.baseAria)el.dataset.baseAria=el.getAttribute('aria-label')||'';el.setAttribute('aria-label',el.dataset.baseAria+(passed?'、通過済み':atCurrent?'、現在位置付近':''))})}
  function dimTransferMeta(name){return preview?null:controls.getTransferMeta?.(name)||null}
  function decorateDimTransfer(el,name){if(!el)return;el.classList.remove('transfer-guide-trigger','segment-transfer-trigger');el.removeAttribute('role');el.removeAttribute('tabindex');el.removeAttribute('aria-label');for(const k of ['routeId','station','dir','nextRouteId'])delete el.dataset[k];const m=dimTransferMeta(name);if(!m)return;el.classList.add('transfer-guide-trigger','segment-transfer-trigger');el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',name+'の降車位置・乗換設備を見る');el.dataset.routeId=m.routeId;el.dataset.station=m.station;el.dataset.dir=String(m.dir||1);el.dataset.nextRouteId=m.nextRouteId||''}
  function openDimTransfer(el){if(!el?.classList?.contains('transfer-guide-trigger'))return false;controls.openTransferGuide?.({routeId:el.dataset.routeId,station:el.dataset.station,dir:Number(el.dataset.dir)||1,nextRouteId:el.dataset.nextRouteId||''});return true}
  function renderRoute(st){
    const canvas=$('dimRouteCanvas'),model=preview?previewOverview():controls.getOverview?.(st);if(!model){$('dimRouteRange').textContent='全区間を確認中';canvas.className='route-overview-canvas route-overview-empty';canvas.style.height='120px';canvas.innerHTML='<p>出発地と各乗換・最終目的地を確認すると、旅程全体を表示します。</p>';canvas.removeAttribute('aria-valuenow');canvas.setAttribute('aria-valuetext','旅程全体を確認中');return}
    $('dimRouteRange').textContent=model.from+' → '+model.to+' · '+(model.legCount>1?model.legCount+'区間 · ':'')+model.stationCount+'駅';const signature=[model.from,model.to,model.currentLegIndex,model.stations.map(x=>x.name+':'+x.kind+':'+x.legIndex+':'+(x.transferTo||'')).join('|'),model.totalHeight].join('::');
    if(canvas.dataset.signature!==signature){const firstY=model.ys[0]||20,lastY=model.ys.at(-1)||firstY,lineStyle='top:'+firstY+'px;bottom:'+Math.max(0,model.totalHeight-lastY)+'px';const badges=(model.legBadges||[]).map(b=>'<span class="route-leg-badge '+(b.index<model.currentLegIndex?'completed':b.index===model.currentLegIndex?'current':'future')+'" style="top:'+b.y+'px">区間 '+(b.index+1)+' · '+esc(b.routeName)+'</span>').join('');const stations=model.stations.map((x,i)=>{const state=model.journey?(([x.legIndex,Number.isInteger(x.nextLegIndex)?x.nextLegIndex:null].filter(Number.isInteger).includes(model.currentLegIndex))?' route-station-current-leg':([x.legIndex,Number.isInteger(x.nextLegIndex)?x.nextLegIndex:null].filter(Number.isInteger).every(i=>i<model.currentLegIndex)?' route-station-completed':' route-station-future')):'',tappable=x.kind==='transfer'&&x.routeId,cls='route-station route-station-'+x.kind+state+(tappable?' transfer-guide-trigger':''),attrs=tappable?' role="button" tabindex="0" data-route-id="'+esc(x.routeId)+'" data-station="'+esc(x.name)+'" data-dir="'+esc(x.dir||1)+'" data-next-route-id="'+esc(x.nextRouteId||'')+'"':'';return '<span class="'+cls+'"'+attrs+' style="top:'+model.ys[i]+'px" aria-label="'+esc(x.name)+'、区間 '+(Number(x.legIndex??0)+1)+'、'+esc(stationTag(x))+(tappable?'、タップで降車位置を表示':'')+'"><i aria-hidden="true"></i><b>'+esc(x.name)+'</b><small>'+esc(stationTag(x))+'</small></span>'}).join('');canvas.dataset.signature=signature;canvas.className='route-overview-canvas'+(model.journey?' journey-overview':'');canvas.style.height=model.totalHeight+'px';canvas.innerHTML='<span class="route-overview-line" style="'+lineStyle+'" aria-hidden="true"><span class="route-overview-line-fill"></span></span>'+badges+stations+'<span class="route-current-marker" aria-hidden="true"><i></i><b></b></span>'}
    const marker=canvas.querySelector('.route-current-marker'),fill=canvas.querySelector('.route-overview-line-fill'),known=Number.isFinite(model.currentY),pct=Math.round(model.progressRatio*100),firstY=model.ys[0]||20;marker.hidden=!known;if(known){marker.style.top=model.currentY+'px';marker.classList.toggle('estimated',!!model.estimated);marker.classList.toggle('manual',!!model.manual);marker.querySelector('b').textContent=(model.manual?'手動位置':model.estimated?'推定現在地':'現在地')+(model.journey?' · 区間 '+(model.currentLegIndex+1):'');fill.style.height=Math.max(0,model.currentY-firstY)+'px';canvas.setAttribute('aria-valuenow',String(pct));canvas.setAttribute('aria-valuetext',model.from+'から'+model.to+'まで '+(model.estimated?'推定 ':'')+pct+'%')}else{fill.style.height='0px';canvas.removeAttribute('aria-valuenow');canvas.setAttribute('aria-valuetext','現在地を確認中')}updateRouteStationProgress(canvas,model);
    if(routeCenterRequested&&known){routeCenterRequested=false;requestAnimationFrame(centerRoute)}
  }
  function paint(){
    if(!active)return;
    const st=preview?{next:'品川',target:'新橋',fresh:true,wake:false,gpsAgeSec:4,data:{count:2,seconds:840,etaEstimated:false,etaSource:'speed-profile'},segmentProgress:{from:'川崎',to:'品川',ratio:.55}}:lastState||{};
    const mode=controls.getMode?.()||'segment',routeMode=mode==='route',seg=st.segmentProgress,known=Number.isFinite(seg?.ratio),ratio=known?Math.max(0,Math.min(1,seg.ratio)):0;
    $('dimMode').textContent=preview?'節電画面 · プレビュー':'節電画面';const dimTo=seg?.to||st.next||'確認中';$('dimNext').textContent=dimTo;decorateDimTransfer($('dimNext'),dimTo);
    $('dimEta').textContent=st.data?.seconds>0?(st.data.etaEstimated||!st.fresh?'推定 ':'')+'到着まで約'+Math.max(1,Math.ceil(st.data.seconds/60))+'分':st.running===false?'位置情報を確認して再開':'到着時間を計算中';paintGpsAge(st);
    $('dimViewSegment').setAttribute('aria-pressed',String(!routeMode));$('dimViewRoute').setAttribute('aria-pressed',String(routeMode));$('dimSegmentView').hidden=routeMode;$('dimRouteOverview').hidden=!routeMode;
    if(routeMode)renderRoute(st);else{
      const dimFrom=seg?.from||'現在地を確認中';$('dimFrom').textContent=dimFrom;decorateDimTransfer($('dimFrom'),dimFrom);$('dimPercent').textContent=known?Math.round(ratio*100)+'%':'—';
      const track=$('dimTrack');if(known)track.setAttribute('aria-valuenow',String(Math.round(ratio*100)));else track.removeAttribute('aria-valuenow');
      track.setAttribute('aria-valuetext',known?(seg.from||'前の停車駅')+'から'+(seg.to||st.next)+'まで '+Math.round(ratio*100)+'%'+(!st.fresh?'（推定）':''):'現在地を確認中');
      track.classList.toggle('uncertain',!st.fresh||!!st.manual||!!seg?.estimated);
      [...track.children].forEach((n,i)=>{n.classList.toggle('current',known&&i===Math.min(9,Math.floor(ratio*10)));n.classList.toggle('passed',known&&i<Math.floor(ratio*10))});
      const light=$('positionLight'),current=track.querySelector('.current');light.hidden=!known;light.classList.toggle('uncertain',track.classList.contains('uncertain'));if(current)light.style.left=(current.offsetLeft+current.offsetWidth/2)+'px';
    }
    $('dimGoal').textContent=st.target||'未設定';$('dimRemaining').textContent=st.data?.count!=null?(st.data.count===0?'まもなく':(st.fresh?'あと ':'推定 あと ')+st.data.count+'駅'):'';
    $('dimQuality').textContent=preview?'表示例 · GPSは使用しません':st.conflict?'路線・方向を確認してください':st.error?'位置情報を確認してください':st.manual?'手動の現在駅 · GPSで再確認':!st.fix?'GPSを確認中':!st.fresh?'推定位置 · GPS最終取得 '+formatGpsAge(st.gpsAgeSec):'GPSで確認';
    $('dimWake').textContent=preview?'':st.wake?'画面保持 ON':'画面保持 未取得';
    const old=Number.isFinite(st.gpsAgeSec)&&st.gpsAgeSec>=30;$('dimNotice').textContent=preview?'':st.conflict||st.error?'現在地が不確かです。通常画面で確認できます。':old?'GPSがしばらく更新されていません。表示位置・残り時間は推定です。':!st.wake?'自動ロックで追跡が止まることがあります。':'';
  }
  function update(st,sessionPhase=''){
    lastState=st;phase=sessionPhase;$('dimNow').disabled=!st.armed||!st.running;$('dimNow').hidden=!st.armed||$('panelRide').hidden;
    if(active&&!preview){if(!eligible()){hide();return}paint()}
    if(!eligible())lastInput=Date.now();
  }
  // Timer does only one eligibility check; progress rendering follows the existing GPS/UI cadence.
  setInterval(()=>{if(document.hidden)return;if(active){if(preview)return;if(!eligible()){hide();return}if(lastState)paintGpsAge(lastState);return}if(seconds&&eligible()&&Date.now()-lastInput>=seconds*1000)show()},1000);
  for(const event of ['pointerdown','keydown','input','scroll','touchmove'])document.addEventListener(event,()=>{if(!active)lastInput=Date.now()},{capture:true,passive:true});
  document.addEventListener('keydown',e=>{if(active&&e.key==='Escape'){e.preventDefault();hide()}});
  document.addEventListener('visibilitychange',()=>{lastInput=Date.now();if(document.hidden)hide()});
  window.addEventListener('pagehide',hide);window.addEventListener('resize',()=>{if(active)paint()});
  for(const id of ['tabRide','tabGuide','tabSettings','tabHistory'])$(id)?.addEventListener('click',()=>{lastInput=Date.now();if(lastState)update(lastState,phase)});
  $('dimNow').hidden=true;
  $('dimExit').onclick=hide;$('dimNow').onclick=()=>show();$('dimPreview').onclick=()=>show(true);
  $('dimViewSegment').onclick=()=>{controls.setMode?.('segment');paint()};$('dimViewRoute').onclick=()=>{routeCenterRequested=true;controls.setMode?.('route');paint()};$('dimRouteCenter').onclick=centerRoute;
  const transferClick=e=>{const el=e.target.closest?.('.transfer-guide-trigger');if(el)openDimTransfer(el)},transferKey=e=>{if(!['Enter',' '].includes(e.key))return;const el=e.target.closest?.('.transfer-guide-trigger');if(el){e.preventDefault();openDimTransfer(el)}};for(const el of [$('dimNext'),$('dimFrom'),$('dimRouteCanvas')]){el?.addEventListener('click',transferClick);el?.addEventListener('keydown',transferKey)}
  return {update};
};
