'use strict';
/* UI and saved journeys. The existing GPS engine and boarding-position parser
   remain authoritative; this module never fabricates a position or a car. */
window.createJourneyExperience = function(api) {
  const $=id=>document.getElementById(id), KEY='ekikan-journeys-v1', SESSION='ekikan-journey-session-v1';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid=()=>globalThis.crypto?.randomUUID?.()||'j'+Date.now().toString(36)+Math.random().toString(36).slice(2);
  const routeBy=id=>api.routes.find(r=>r.id===id), short=r=>r.name.split('｜')[0];
  const bucketOf=x=>x==='return'?'return':'outbound',bucketName=x=>bucketOf(x)==='return'?'復路':'往路';
  let store={version:1,presets:[],recent:[],eco:true,activeBucket:'outbound'}, session=null, resume=null, point=null, locating=false;
  let activeBucket='outbound',editorQueries=[],draftSavedId='',searchTimer=null,vibrationTestTimer=null;
  let lastCandidates='', lastSave=0, busy=false, eco=false, ecoChanged=0, editing=null, draft=[], editorMode='save', lastFocused=null, updatePending=false, booted=false, guideContextKey='',progressViewMode='segment',routeCenterRequested=false,legacyOverviewFrom='',legacyOverviewRoute='',legDetect={candidate:-1,hits:0,lastGpsAt:0,lastSwitch:0};
  function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
  function write(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{api.toast('端末に保存できません。この画面を閉じると内容が失われます。');return false}}
  function normalLeg(x){
    if(!x||typeof x!=='object')return null;
    const r=routeBy(x.routeId);if(!r)return null;
    const from=r.stations.findIndex(s=>s[0]===x.from),to=r.stations.findIndex(s=>s[0]===x.to);
    if(from<0||to<0||from===to)return null;
    if(r.loop&&![1,-1].includes(Number(x.dir)))return null;
    const d=r.loop?(Number(x.dir)===-1?-1:1):(to>from?1:-1);
    const available=api.services(r.id),service=available.some(p=>p.id===x.service)?x.service:'all';
    let stops=Array.isArray(x.stops)?[...new Set(x.stops.filter(s=>typeof s==='string'&&r.stations.some(a=>a[0]===s)))]:null;
    if(stops&&(!stops.includes(x.from)||!stops.includes(x.to)))return null;
    if(service!=='all'&&!stops){stops=available.find(p=>p.id===service)?.stops?.split(' ')||null;if(stops&&(!stops.includes(x.from)||!stops.includes(x.to)))return null}
    return {routeId:r.id,from:r.stations[from][0],to:r.stations[to][0],dir:d,service,stops};
  }
  function normalPreset(x){
    if(!x||!Array.isArray(x.legs)||!x.legs.length||x.legs.length>8)return null;
    const legs=x.legs.map(normalLeg);if(legs.some(x=>!x))return null;
    return {id:typeof x.id==='string'?x.id.slice(0,90):uid(),name:String(x.name||'保存した経路').slice(0,30),bucket:bucketOf(x.bucket),legs,usedAt:Number(x.usedAt)||0};
  }
  const saved=read(KEY);
  if(saved?.version===1){store={...store,presets:(Array.isArray(saved.presets)?saved.presets:[]).map(normalPreset).filter(Boolean).slice(0,30),recent:(Array.isArray(saved.recent)?saved.recent:[]).filter(x=>x&&api.guideRoutes.some(r=>r.id===x.routeId)&&typeof x.station==='string'&&[1,-1].includes(x.dir)).slice(0,6),eco:saved.eco!==false}}
  const oldSession=read(SESSION);
  activeBucket=bucketOf(saved?.activeBucket);store.activeBucket=activeBucket;
  if(oldSession&&Date.now()-Number(oldSession.savedAt)<86400000&&['riding','transfer','arrived','paused'].includes(oldSession.phase)){
    const p=normalPreset(oldSession);if(p&&Number.isInteger(oldSession.index)&&oldSession.index>=0&&oldSession.index<p.legs.length)resume={...p,index:oldSession.index,phase:oldSession.phase,startedAt:oldSession.startedAt,savedAt:oldSession.savedAt};
  }
  function saveStore(){return write(KEY,store)}
  function persistPresets(presets){const next={...store,presets};if(!write(KEY,next))return false;store=next;lastCandidates='';renderHome();return true}
  function saveSession(force=false){if(!force&&Date.now()-lastSave<10000)return;lastSave=Date.now();const current=session||resume;if(current)write(SESSION,{...current,savedAt:Date.now()});else{try{localStorage.removeItem(SESSION)}catch{}}}
  function dirLabel(r,d){return api.directionLabel(r,d)}
  function pathText(p){return [p.legs[0]?.from,...p.legs.map(l=>l.to)].filter(Boolean).join(' → ')}
  function lineText(p){return [...new Set(p.legs.map(l=>short(routeBy(l.routeId))))].join(' ・ ')}
  function visibleTab(){return document.querySelector('.tabs [aria-selected="true"]')?.id||'tabRide'}
  function tab(name){api.tab(name);refreshMini();if(name==='Ride')$('panelRide').scrollTop=0}
  function closeDialog(){if($('notificationDialogControls'))window.EkikanNotifications?.cancelTest('設定画面を閉じたため、テストを中止しました。');clearTimeout(searchTimer);cancelVibrationTest();const dlg=$('journeyDialog');if(dlg.open)dlg.close();lastFocused?.focus?.()}
  function dialog(title,content){cancelVibrationTest();lastFocused=document.activeElement;$('journeyDialogTitle').textContent=title;$('journeyDialogBody').onclick=null;$('journeyDialogBody').innerHTML=content;const dlg=$('journeyDialog');if(!dlg.open)dlg.showModal();dlg.scrollTop=0}
  function option(value,label,selected){return '<option value="'+esc(value)+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>'}
  function legOptions(leg){const r=routeBy(leg.routeId)||api.routes[0];return r.stations.map(s=>s[0])}
  function bucketTabs(prefix,bucket,panel){return ['outbound','return'].map(b=>'<button type="button" id="'+prefix+b+'" data-bucket="'+b+'" role="tab" aria-selected="'+(b===bucket)+'" aria-controls="'+panel+'" tabindex="'+(b===bucket?'0':'-1')+'">'+bucketName(b)+'<small>'+store.presets.filter(p=>p.bucket===b).length+'</small></button>').join('')}
  function bindBucketTabs(holder,onSelect){
    holder.onclick=e=>{const b=e.target.closest('[data-bucket]');if(b)onSelect(b.dataset.bucket)};
    holder.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const current=e.target.closest('[data-bucket]');if(!current)return;const next=e.key==='Home'?'outbound':e.key==='End'?'return':current.dataset.bucket==='return'?'outbound':'return',id=holder.id;onSelect(next);$(id)?.querySelector('[data-bucket="'+next+'"]')?.focus()};
  }
  function setBucket(bucket){activeBucket=bucketOf(bucket);store.activeBucket=activeBucket;saveStore();lastCandidates='';renderHome()}
  function stationMatches(query,leg){
    const q=api.normalizeStation(query);if(!q)return [];
    let matches=[];
    for(const r of api.routes)for(const st of r.stations){const key=api.normalizeStation(st[0]),score=key===q?0:key.startsWith(q)?1:key.includes(q)?2:99;if(score<99)matches.push({routeId:r.id,routeName:r.name,name:st[0],score,preferred:r.id===leg.routeId?0:1})}
    if(matches.some(x=>x.score===0))matches=matches.filter(x=>x.score===0);
    matches.sort((a,b)=>a.score-b.score||a.preferred-b.preferred||a.name.length-b.name.length||a.name.localeCompare(b.name,'ja')||a.routeName.localeCompare(b.routeName,'ja'));
    const seen=new Set();return matches.filter(x=>{const key=x.routeId+'\n'+x.name;if(seen.has(key))return false;seen.add(key);return true}).slice(0,30);
  }
  function closeStationSuggestions(){clearTimeout(searchTimer);document.querySelectorAll('.editor-suggestions').forEach(x=>x.hidden=true);document.querySelectorAll('[data-station-input]').forEach(x=>x.setAttribute('aria-expanded','false'))}
  function applyStation(i,field,match){
    const leg=draft[i],r=routeBy(match.routeId),other=field==='from'?'to':'from';if(!leg||!r)return;
    if(leg.routeId!==r.id){leg.routeId=r.id;leg.service='all';leg.stops=null;if(!r.stations.some(s=>s[0]===leg[other]))leg[other]=''}
    leg[field]=match.name;if(!r.loop)leg.dir=r.stations.findIndex(s=>s[0]===leg.to)>r.stations.findIndex(s=>s[0]===leg.from)?1:-1;
    editorQueries[i]={from:leg.from,to:leg.to};renderEditor();const input=$('leg-'+i+'-'+(field==='from'&&!leg.to?'to':field));input?.focus();closeStationSuggestions();
  }
  function showStationSuggestions(input){
    if(!input.isConnected)return;closeStationSuggestions();const i=Number(input.dataset.index),field=input.dataset.field,leg=draft[i],box=$('leg-suggestions-'+i);if(!leg||!box)return;
    const matches=stationMatches(input.value,leg);box.hidden=false;input.setAttribute('aria-expanded','true');
    box.innerHTML='<p class="suggestion-count" role="status">'+(!input.value.trim()?'駅名を入力すると候補を表示します':matches.length?'駅名と路線を選択 · '+matches.length+'候補':'該当する駅がありません')+'</p><div role="listbox" aria-label="駅と路線の候補">'+matches.map((m,n)=>'<button type="button" role="option" aria-selected="false" data-editor-match="'+n+'"><strong>'+esc(m.name)+'</strong><small>'+esc(m.routeName)+(m.preferred===0?' · 選択中の路線':'')+'</small></button>').join('')+'</div><button type="button" class="suggestion-close">候補を閉じる</button>';
    box.onclick=e=>{const b=e.target.closest('[data-editor-match]');if(b){applyStation(i,field,matches[Number(b.dataset.editorMatch)]);return}if(e.target.closest('.suggestion-close')){input.focus();closeStationSuggestions()}};
    box.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();input.focus();closeStationSuggestions();return}if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();const rows=[...box.querySelectorAll('[data-editor-match]')],n=rows.indexOf(document.activeElement);rows[(n+(e.key==='ArrowDown'?1:rows.length-1))%rows.length]?.focus()}};
  }
  function bindStationInputs(){
    for(const input of document.querySelectorAll('[data-station-input]')){
      let composing=false;const changed=()=>{const i=Number(input.dataset.index),field=input.dataset.field;editorQueries[i]??={};editorQueries[i][field]=input.value;draft[i][field]=''};
      input.addEventListener('input',e=>{changed();clearTimeout(searchTimer);if(!composing&&!e.isComposing)searchTimer=setTimeout(()=>showStationSuggestions(input),120)});
      input.addEventListener('change',()=>{const leg=draft[Number(input.dataset.index)],r=routeBy(leg.routeId),name=r.stations.find(s=>s[0]===input.value)?.[0];if(name){leg[input.dataset.field]=name;if(!r.loop)leg.dir=r.stations.findIndex(s=>s[0]===leg.to)>r.stations.findIndex(s=>s[0]===leg.from)?1:-1}});
      input.addEventListener('focus',()=>showStationSuggestions(input));
      input.addEventListener('compositionstart',()=>{composing=true;clearTimeout(searchTimer)});
      input.addEventListener('compositionend',()=>{composing=false;changed();clearTimeout(searchTimer);searchTimer=setTimeout(()=>showStationSuggestions(input),120)});
      input.addEventListener('search',()=>{if(!composing)showStationSuggestions(input)});
      input.addEventListener('keydown',e=>{if(e.isComposing||composing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeStationSuggestions()}if(e.key==='Enter'||e.key==='ArrowDown'){e.preventDefault();showStationSuggestions(input);$('leg-suggestions-'+input.dataset.index).querySelector('[data-editor-match]')?.focus()}});
    }
  }
  function editorStation(leg,i,field,label){return '<label class="field" for="leg-'+i+'-'+field+'">'+label+'</label><input id="leg-'+i+'-'+field+'" data-station-input="true" data-index="'+i+'" data-field="'+field+'" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="leg-suggestions-'+i+'" placeholder="駅名で検索" value="'+esc(editorQueries[i]?.[field]??leg[field])+'">'}
  function renderEditor(){
    clearTimeout(searchTimer);const active=document.activeElement?.id||'',selection=document.activeElement?.selectionStart;
    const savedId=editorMode==='session'?(draftSavedId||editing.id):editing.id,canDelete=savedId&&store.presets.some(p=>p.id===savedId);
    $('journeyDialogBody').innerHTML='<p>駅名を入力し、候補の路線を選んで設定できます。</p><div class="editor-bucket" role="group" aria-label="プリセットの保存先">'+['outbound','return'].map(b=>'<button type="button" data-editor-bucket="'+b+'" aria-pressed="'+(editing.bucket===b)+'">'+bucketName(b)+'に保存</button>').join('')+'</div><label class="field" for="journeyName">経路の名前</label><input id="journeyName" type="text" maxlength="30" placeholder="例：通勤、帰宅" value="'+esc(editing.name)+'"><div id="journeyLegs">'+draft.map((l,i)=>{
      const r=routeBy(l.routeId)||api.routes[0],names=legOptions(l),prev=draft[i-1];
      return (prev?'<p class="leg-connection">'+esc(prev.to||'降車駅')+'で乗換'+(l.from&&prev.to!==l.from?' · '+esc(l.from)+'へ移動':'')+'</p>':'')+'<section class="leg-editor" data-leg="'+i+'"><div class="row"><span class="leg-label">区間 '+(i+1)+'</span>'+(draft.length>1?'<button type="button" data-remove="'+i+'" class="ghost">この区間を削除</button>':'')+'</div><div class="grid station-inputs"><div>'+editorStation(l,i,'from','乗る駅')+'</div><div>'+editorStation(l,i,'to','降りる駅')+'</div></div><div id="leg-suggestions-'+i+'" class="editor-suggestions" hidden></div><label class="field">路線<select data-field="routeId" data-index="'+i+'">'+api.routes.map(x=>option(x.id,x.name,x.id===r.id)).join('')+'</select></label>'+(r.loop?'<label class="field">方面<select data-field="dir" data-index="'+i+'">'+[1,-1].map(d=>option(d,dirLabel(r,d),d===l.dir)).join('')+'</select></label>':'')+'<details><summary>列車の停車駅</summary><label class="field">停車パターン<select data-field="service" data-index="'+i+'">'+api.services(r.id).map(p=>option(p.id,p.name,p.id===(l.service||'all'))).join('')+'</select></label><p class="quiet-note">快速・急行などは、車内案内と合わせてください。</p><details><summary>停車駅を個別に選ぶ</summary><div class="stoplist">'+names.map(n=>'<label><input type="checkbox" data-stop="'+esc(n)+'" data-index="'+i+'"'+(!l.stops||l.stops.includes(n)?' checked':'')+'>'+esc(n)+'</label>').join('')+'</div></details></details></section>';
    }).join('')+'</div><button id="journeyAddLeg" class="full ghost" type="button"'+(draft.length>=8?' disabled':'')+'>＋ 乗換を追加</button><button id="journeyResetDraft" class="full ghost reset-draft" type="button">'+(editorMode==='session'?'今回の設定を全解除':'入力した設定を全解除')+'</button><p id="journeyEditorError" class="editor-error" role="alert"></p><p id="journeyEditorStatus" class="quiet-note" role="status"></p><div class="dialog-actions">'+(editorMode==='session'?'<button id="journeySaveOnly" class="primary">今回の経路に適用</button>':'<button id="journeySaveOnly" class="primary">この端末に保存</button><button id="journeyStartDraft" class="ghost">'+(editing.id?'保存して開始':'今回だけ開始')+'</button>')+'</div>'+(editorMode==='session'?'<button id="journeyPresetSave" class="full ghost">'+(draftSavedId?'別に保存したプリセットを更新':'別のプリセットとして端末に保存')+'</button>':'')+(canDelete?'<button id="journeyDeletePreset" class="full danger-action">このプリセットを削除</button>':'')+'<p class="quiet-note">'+(editorMode==='session'?'今回の変更を元のプリセットへ自動で反映しません。':'乗換を含む経路全体を、この端末の同じブラウザに保存します。')+'</p>';
    $('journeyName').oninput=e=>{editing.name=e.target.value};
    document.querySelectorAll('[data-editor-bucket]').forEach(b=>b.onclick=()=>{editing.bucket=b.dataset.editorBucket;renderEditor()});
    $('journeyLegs').onchange=e=>{if(e.target.matches('[data-station-input]'))return;const i=Number(e.target.dataset.index),field=e.target.dataset.field,l=draft[i];if(!l)return;
      if(e.target.dataset.stop){const n=e.target.dataset.stop,set=new Set(l.stops||legOptions(l));e.target.checked?set.add(n):set.delete(n);l.stops=[...set];l.service='all';return}
      if(!field)return;l[field]=field==='dir'?Number(e.target.value):e.target.value;
      if(field==='routeId'){const r=routeBy(l.routeId);l.from=r.stations.some(s=>s[0]===l.from)?l.from:r.stations.some(s=>s[0]===draft[i-1]?.to)?draft[i-1].to:'';l.to=r.stations.some(s=>s[0]===l.to)?l.to:'';l.service='all';l.stops=null;editorQueries[i]={from:l.from,to:l.to};renderEditor()}
      else if(field==='service'){const p=api.services(l.routeId).find(p=>p.id===l.service);l.stops=p?.stops?p.stops.split(' '):null;renderEditor()}
    };
    $('journeyLegs').onclick=e=>{const b=e.target.closest('[data-remove]');if(b){draft.splice(Number(b.dataset.remove),1);editorQueries.splice(Number(b.dataset.remove),1);renderEditor()}};
    $('journeyAddLeg').onclick=()=>{const prev=draft.at(-1),r=api.routes.find(r=>r.id!==prev.routeId&&r.stations.some(s=>s[0]===prev.to))||api.routes[0];draft.push({routeId:r.id,from:r.stations.some(s=>s[0]===prev.to)?prev.to:'',to:'',dir:1,service:'all',stops:null});renderEditor();$('journeyAddLeg').scrollIntoView({block:'nearest'})};
    $('journeySaveOnly').onclick=()=>submitEditor(false);if($('journeyStartDraft'))$('journeyStartDraft').onclick=()=>submitEditor(true);
    if($('journeyPresetSave'))$('journeyPresetSave').onclick=()=>{const p=editorPreset();if(!p)return;p.id=draftSavedId||uid();if(!storePreset(p))return;draftSavedId=p.id;renderEditor();$('journeyEditorStatus').textContent=bucketName(p.bucket)+'に保存しました。見守り中の経路はそのままです。'};
    if($('journeyDeletePreset'))$('journeyDeletePreset').onclick=()=>{if(!deletePreset(savedId))return;if(editorMode==='session'){draftSavedId='';renderEditor();$('journeyEditorStatus').textContent='保存したプリセットを削除しました。今回の経路は残っています。'}else{activeBucket=editing.bucket;manage()}};
    $('journeyResetDraft').onclick=()=>{if(!confirm(editorMode==='session'?'今回の見守りを終了して設定を全解除しますか？保存済みプリセットは残ります。':'入力した区間をすべて解除しますか？保存済みプリセットは残ります。'))return;const bucket=editing.bucket;if(editorMode==='session')clearCurrent(false);editorMode='save';editing={id:'',name:'',bucket};draftSavedId='';editorQueries=[];draft=[{routeId:api.routes[0].id,from:'',to:'',dir:1,service:'all',stops:null}];dialog('新しい経路','');renderEditor()};
    bindStationInputs();if(active==='journeyName'){$('journeyName').focus();try{$('journeyName').setSelectionRange(selection,selection)}catch{}}
  }
  function openEditor(p=null,mode='save'){
    editorMode=mode;editing=p?{id:p.id||'',name:p.name,bucket:bucketOf(p.bucket)}:{id:'',name:'',bucket:activeBucket};editorQueries=[];draftSavedId='';
    const st=api.state(),r=routeBy(st.routeId)||api.routes[0];draft=p?JSON.parse(JSON.stringify(p.legs)):[{routeId:r.id,from:st.currentStation||'',to:st.target||'',dir:st.dir||1,service:'all',stops:null}];
    if(!routeBy(draft[0].routeId)?.stations.some(s=>s[0]===draft[0].from))draft[0].from='';
    dialog(mode==='session'?'今回の経路を変更':p?'プリセットを編集':'新しい経路','');renderEditor();
  }
  function editorPreset(){
    const legs=draft.map(normalLeg);if(legs.some(l=>!l)){$('journeyEditorError').textContent='乗る駅・降りる駅を候補から選んでください。どちらも列車が停車する駅に含めてください。';return null}
    return {id:editing.id||uid(),name:editing.name.trim()||legs[0].from+' → '+legs.at(-1).to,bucket:editing.bucket,legs,usedAt:0};
  }
  function storePreset(p){
    const old=store.presets.find(x=>x.id===p.id);if(!old&&store.presets.length>=30){$('journeyEditorError').textContent='保存できる経路は往路・復路合わせて30件までです。';return false}if(old)p.usedAt=old.usedAt;
    if(!persistPresets([p,...store.presets.filter(x=>x.id!==p.id)])){$('journeyEditorError').textContent='端末に保存できませんでした。設定は画面に残しています。';return false}return true;
  }
  function submitEditor(startNow){
    const p=editorPreset();if(!p)return;
    if(editorMode==='session'){const index=Math.min(session?.index||0,p.legs.length-1);p.id=session?.id||p.id;closeDialog();run(p,index);api.toast('今回の経路を変更しました');return}
    if((!startNow||editing.id)&&!storePreset(p))return;
    activeBucket=p.bucket;store.activeBucket=activeBucket;saveStore();closeDialog();lastCandidates='';renderHome();if(startNow)run(p,0);else api.toast(bucketName(p.bucket)+'のプリセットを端末に保存しました');
  }
  function deletePreset(id){const p=store.presets.find(x=>x.id===id);if(!p||!confirm('「'+p.name+'」の保存を削除しますか？見守り中の経路は残ります。'))return false;if(!persistPresets(store.presets.filter(x=>x.id!==id)))return false;api.toast('プリセットを削除しました');return true}
  function manage(){
    const list=store.presets.filter(p=>p.bucket===activeBucket);
    dialog('プリセットの保存・管理','<div id="manageBucketTabs" class="preset-tabs" role="tablist" aria-label="往路と復路">'+bucketTabs('manage-',activeBucket,'presetList')+'</div><div id="presetList" role="tabpanel" aria-labelledby="manage-'+activeBucket+'">'+list.map(p=>'<section class="preset-manage-row"><strong>'+esc(p.name)+'</strong><p>'+esc(pathText(p))+'</p><div class="preset-manage-actions"><button data-action="start" data-id="'+esc(p.id)+'" class="primary">開始</button><button data-action="edit" data-id="'+esc(p.id)+'">編集・保存</button><button data-action="reverse" data-id="'+esc(p.id)+'">'+(p.bucket==='return'?'往路':'復路')+'を作成</button><button data-action="notifications" data-id="'+esc(p.id)+'">通知の設定</button><button data-action="delete" data-id="'+esc(p.id)+'" class="danger-action">削除</button></div></section>').join('')+(!list.length?'<p class="quiet-note">'+bucketName(activeBucket)+'のプリセットはまだありません。</p>':'')+'</div><button id="manageAdd" class="full ghost">＋ '+bucketName(activeBucket)+'の経路を設定して保存</button><div class="journey-backup"><p class="quiet-note">プリセットはこの端末の同じブラウザに保存されます。バックアップは往路・復路をまとめて書き出せます。</p><div class="grid"><button id="journeyExport" class="small">ファイルに書き出し</button><button id="journeyImport" class="small">読み込み</button></div><input id="journeyImportFile" type="file" accept="application/json,.json" hidden><p id="journeyImportMessage" class="quiet-note" role="status"></p></div>');
    bindBucketTabs($('manageBucketTabs'),b=>{setBucket(b);manage()});$('manageAdd').onclick=()=>openEditor();
    $('journeyDialogBody').onclick=e=>{const b=e.target.closest('[data-action]');if(!b)return;const p=store.presets.find(x=>x.id===b.dataset.id);if(!p)return;
      if(b.dataset.action==='start')chooseStart(p);if(b.dataset.action==='edit')openEditor(p);if(b.dataset.action==='notifications')showNotificationHelp(p);
      if(b.dataset.action==='reverse')openEditor({name:p.name+(p.bucket==='return'?'（往路）':'（復路）'),bucket:p.bucket==='return'?'outbound':'return',legs:[...p.legs].reverse().map(l=>({...l,from:l.to,to:l.from,dir:-l.dir}))});
      if(b.dataset.action==='delete'&&deletePreset(p.id))manage();
    };
    $('journeyExport').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,presets:store.presets},null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='ekikan-presets.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000)};
    $('journeyImport').onclick=()=>$('journeyImportFile').click();
    $('journeyImportFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>1000000)throw new Error('ファイルが大きすぎます。');const data=JSON.parse(await f.text());if(data.version!==1||!Array.isArray(data.presets)||data.presets.length>30)throw new Error('対応する経路ファイルではありません。');const p=data.presets.map(normalPreset);if(p.some(x=>!x))throw new Error('未対応の路線か不正な区間が含まれています。');const merged=new Map(store.presets.map(p=>[p.id,p]));p.forEach(p=>merged.set(p.id,p));if(merged.size>30)throw new Error('保存できる経路は合計30件までです。');if(!persistPresets([...merged.values()]))throw new Error('端末に保存できませんでした。');manage();$('journeyImportMessage').textContent=p.length+'件を読み込みました。'}catch(err){$('journeyImportMessage').textContent=err.message||'読み込めませんでした。'}};
  }
  function chooseStart(p){
    if(p.legs.length===1){closeDialog();run(p,0);return}
    dialog(p.name+'を開始','<p>最初から、または途中の区間から開始できます。開始後はGPSで現在区間を継続判定し、先の区間へ移ったと十分に確認できた場合は自動で切り替えます。</p>'+p.legs.map((l,i)=>'<button class="leg-start-option" data-start-leg="'+i+'"><span class="eyebrow">区間 '+(i+1)+'</span><br>'+esc(l.from+' → '+l.to)+'<small>'+esc(short(routeBy(l.routeId))+' · '+dirLabel(routeBy(l.routeId),l.dir))+'</small></button>').join(''));
    $('journeyDialogBody').onclick=e=>{const b=e.target.closest('[data-start-leg]');if(b){closeDialog();run(p,Number(b.dataset.startLeg))}};
  }
  function activateSessionLeg(index,{auto=false,openRide=false}={}){
    if(!session||busy||!Number.isInteger(index)||index<0||index>=session.legs.length)return false;busy=true;const previous=session.index;session.index=index;session.phase='riding';session.savedAt=Date.now();eco=false;document.body.classList.remove('eco');
    let ok=false;try{ok=api.startLeg(session.legs[index]);if(!ok)session.phase='paused'}catch(e){session.phase='paused';api.toast('開始できませんでした。位置情報の設定を確認してください。')}
    busy=false;legDetect={candidate:-1,hits:0,lastGpsAt:0,lastSwitch:auto?Date.now():legDetect.lastSwitch};saveSession(true);if(openRide)tab('Ride');api.prepareArrival?.();
    if(auto&&ok&&previous!==index)api.toast('GPSから現在区間を判定：区間 '+(index+1)+' / '+session.legs.length+' · '+short(routeBy(session.legs[index].routeId)));
    return ok;
  }
  function run(p,index){
    if(busy)return;resume=null;session={...JSON.parse(JSON.stringify(p)),index,phase:'riding',startedAt:Date.now(),savedAt:Date.now()};
    const existing=store.presets.find(x=>x.id===p.id);if(existing){existing.usedAt=Date.now();saveStore()}
    activateSessionLeg(index,{openRide:true});tick();
  }
  function finish(){
    const completed=session;busy=true;api.stop();session=null;resume=null;busy=false;saveSession(true);eco=false;document.body.classList.remove('eco');lastCandidates='';tick();
    if(completed&&!store.presets.some(p=>p.id===completed.id))dialog('見守りを終了しました','<p>'+esc(pathText(completed))+'</p><p>また使う経路なら保存できます。</p><div class="dialog-actions"><button id="finishClose">閉じる</button><button id="finishSave" class="primary">経路を保存</button></div>');
    if($('finishClose')){$('finishClose').onclick=closeDialog;$('finishSave').onclick=()=>openEditor(completed)}
    if(updatePending)$('journeyUpdate').hidden=false;
  }
  function clearCurrent(ask=true){
    if(ask&&!confirm('今回の見守りを終了して、乗換設定をすべて解除しますか？保存済みプリセットは残ります。'))return false;
    busy=true;api.clearCurrent();session=null;resume=null;busy=false;saveSession(true);eco=false;document.body.classList.remove('eco');closeDialog();lastCandidates='';tick();api.toast('今回の設定を全解除しました');return true;
  }
  function nextLeg(){if(!session)return;if(session.index+1>=session.legs.length){finish();return}activateSessionLeg(session.index+1,{openRide:true});tick()}
  function editCurrentGoal(){
    if(session){openEditor(session,'session');return}
    const st=api.state();dialog('降りる駅を変更','<label class="field">今回の降車駅<select id="legacyGoalChoice">'+api.goalChoices().map(name=>option(name,name,name===st.target)).join('')+'</select></label><button id="legacyGoalApply" class="primary full">この駅に変更</button>');
    $('legacyGoalApply').onclick=()=>{api.changeGoal($('legacyGoalChoice').value);closeDialog();tick()};
  }
  function cancelVibrationTest(){
    if(vibrationTestTimer===null)return;clearTimeout(vibrationTestTimer);vibrationTestTimer=null;
    if($('notificationTestStatus'))$('notificationTestStatus').textContent='振動テストを中止しました。';
    if($('notificationVibrateLater'))$('notificationVibrateLater').textContent='10秒後に試す';
  }
  function runVibrationTest(){
    cancelVibrationTest();const requested=api.testVibration?.()===true;
    if($('notificationTestStatus'))$('notificationTestStatus').textContent=requested?'振動を要求しました。実際に振動したか確認してください。':'振動を実行できませんでした。画面を開き、デモを終了して再度お試しください。';
  }
  function showNotificationHelp(preset=null){
    const current=api.state(),source=preset||session||resume;
    const legs=source?source.legs.map((leg,index)=>({leg,index})).filter(x=>preset||x.index>=(source.index||0)):current.target?[{leg:{routeId:current.routeId,to:current.target},index:0}]:[];
    const targets=legs.filter(x=>routeBy(x.leg.routeId)?.stations.some(s=>s[0]===x.leg.to));
    const sourceLabel=preset?bucketName(preset.bucket)+' · '+preset.name:session?'今回の経路':resume?'前回の経路':'降車駅';
    const nativeVibration=typeof navigator.vibrate==='function',pageUrl=/^https?:$/.test(location.protocol)?location.origin+location.pathname:'';
    dialog('通知・振動',
      '<div id="notificationDialogControls"></div><details class="notification-alternatives"><summary>別のブラウザ・ショートカットを使う場合</summary>'+
      '<p class="notification-intro">画面を開いて使うか、閉じて使うかで方法が変わります。</p>'+
      '<p class="quiet-note">'+(nativeVibration?'このブラウザにはバイブ機能があります。実際の振動は端末で確認してください。':'このブラウザの自動バイブは非対応です。')+' 駅間ナビのGPS見守りは画面表示中に動作します。</p>'+
      '<section class="notification-browser"><h3 class="notification-method-heading">画面を開いて使う</h3><p>無料の「Brrrowser」は、HTMLからのバイブ対応を開発元が案内しているiPhone用ブラウザです。このページのURLを開いて試せます。</p><div class="notification-browser-actions"><button id="notificationCopyUrl" type="button"'+(!pageUrl?' disabled':'')+'>このページのURLをコピー</button><a class="notification-store-link" href="https://apps.apple.com/jp/app/brrrowser/id6747417026" target="_blank" rel="noopener noreferrer">Brrrowserを見る ↗</a></div>'+
      (nativeVibration?'<div class="grid notification-tests"><button id="notificationVibrateNow" type="button">バイブを試す</button><button id="notificationVibrateLater" type="button">10秒後に試す</button></div><p id="notificationTestStatus" class="quiet-note" role="status"></p>':'')+
      '<p class="quiet-note">GPSとの組み合わせは実機未確認です。振動テストと位置情報の取得を確認してください。プリセットの移行には「ファイルに書き出し／読み込み」を使います。</p></section><h3 class="notification-method-heading">画面を閉じて使う</h3><p class="quiet-note">標準の「ショートカット」に、駅の近くへ到着したときの振動・通知を設定します。</p>'+
      (targets.length?'<section class="notification-targets"><h3>'+esc(sourceLabel)+'</h3><p class="quiet-note">設定する駅名をコピーできます。</p>'+targets.map((x,i)=>'<div class="notification-target"><div><small>区間 '+(x.index+1)+' · '+esc(short(routeBy(x.leg.routeId)))+'</small><strong>'+esc(x.leg.to)+'</strong></div><button type="button" data-notification-copy="'+i+'" aria-label="'+esc(x.leg.to)+'の駅名をコピー">駅名をコピー</button></div>').join('')+'</section>':'<p class="quiet-note">経路を設定すると、ここに各区間の降車駅を表示します。保存した経路の「通知の設定」からも開けます。</p>')+
      '<p id="notificationCopyStatus" class="quiet-note" role="status"></p><div id="notificationCopyFallback" hidden><label class="field" for="notificationCopyText">長押しでコピー</label><textarea id="notificationCopyText" rows="2" readonly></textarea></div>'+
      '<ol class="notification-steps"><li>「ショートカット」を開き、<b>オートメーション → ＋ → 到着</b>を選びます。</li><li>駅を検索し、路線と場所を確認します。早めに知らせたい場合は、地図の範囲を広げるか、1つ前の停車駅を指定します。</li><li><b>「すぐに実行」</b>を選びます。OSによっては「実行の前に尋ねる」をオフにします。</li><li>「新規の空のオートメーション」などから、<b>「デバイスを振動させる」</b>を追加します。「繰り返す」で3回にすると気づきやすくなります。</li><li>必要なら「通知を表示」も追加し、文面に駅名を入れます。音を出したくない場合は、詳細の<b>「サウンドを再生」をオフ</b>にします。</li></ol>'+
      '<a class="notification-open primary" href="shortcuts://">ショートカットを開く</a><p class="quiet-note">iPhoneで開いてください。設定は手動で行います。位置情報の許可と振動を確認し、普段使う前に試してください。</p>'+
      '<details class="notification-notes"><summary>通知のタイミングと解除について</summary><p>位置に基づく通知には遅れや誤差があり、地下では作動しないことがあります。通過するだけでも作動するため、通勤時間などの時間範囲を指定すると使いやすくなります。</p><p><b>ショートカット側の設定は別管理です。</b>駅間ナビで経路を変更・全解除しても連動しません。使わない設定は「ショートカット」で無効化・削除してください。</p></details>'+
      '<a class="notification-guide-link" href="./iphone-alerts.html" target="_blank" rel="noopener noreferrer">ブラウザ別の対応・ほかの方法を読む ↗</a></details>');
    window.EkikanNotifications?.mount($('notificationDialogControls'));
    $('journeyDialogBody').onclick=async e=>{
      const b=e.target.closest('[data-notification-copy],#notificationCopyUrl');if(!b)return;
      const isUrl=b.id==='notificationCopyUrl',target=isUrl?null:targets[Number(b.dataset.notificationCopy)];if(isUrl?!pageUrl:!target)return;
      const name=target?.leg.to||'',text=isUrl?pageUrl:name.endsWith('駅')?name:name+'駅';
      const status=$('notificationCopyStatus'),fallback=$('notificationCopyFallback'),field=$('notificationCopyText');
      try{await navigator.clipboard.writeText(text);if($('journeyDialog').open&&status.isConnected){fallback.hidden=true;status.textContent=isUrl?'URLをコピーしました。Brrrowserで開いてください。':text+'をコピーしました。通知の設定はまだ完了していません。'}}
      catch{if($('journeyDialog').open&&field.isConnected){fallback.hidden=false;field.value=text;field.focus();field.select();status.textContent='自動コピーできませんでした。下の文字を長押ししてコピーしてください。'}}
    };
    if(nativeVibration){
      $('notificationVibrateNow').onclick=runVibrationTest;
      $('notificationVibrateLater').onclick=()=>{
        if(vibrationTestTimer!==null){cancelVibrationTest();return}
        $('notificationVibrateLater').textContent='テストを中止';$('notificationTestStatus').textContent='10秒後に試します。画面に触れずに待ってください。画面やこの案内を閉じると中止します。';
        vibrationTestTimer=setTimeout(()=>{vibrationTestTimer=null;if(!$('journeyDialog').open||document.visibilityState!=='visible')return;$('notificationVibrateLater').textContent='10秒後に試す';runVibrationTest()},10000);
      };
    }
  }
  function showTripMenu(){
    const st=api.state();dialog('見守りの操作','<button id="tripEdit" class="full">今回の経路を変更</button><button id="tripCorrect" class="full">現在駅を補正</button>'+(session?'<button id="tripAlighted" class="full">この区間を降りた</button>':'')+'<button id="tripNotifications" class="full">iPhoneの通知・振動</button><button id="tripEnd" class="full danger-action">見守りを終了</button>');
    $('tripEdit').onclick=editCurrentGoal;$('tripNotifications').onclick=()=>showNotificationHelp();
    $('tripCorrect').onclick=()=>{const r=routeBy(st.routeId);dialog('現在駅を補正','<p>実際にいる駅を選んでください。次のGPSで再確認します。</p><label class="field">現在いる駅<select id="correctStation">'+r.stations.map(x=>option(x[0],x[0],x[0]===st.currentStation)).join('')+'</select></label><button id="correctApply" class="primary full">この駅にいる</button>');$('correctApply').onclick=()=>{api.correct($('correctStation').value);closeDialog();tick()}};
    if($('tripAlighted'))$('tripAlighted').onclick=()=>{closeDialog();if(session.index+1>=session.legs.length){finish();return}busy=true;api.stop();session.phase='transfer';session.manualTransfer=true;busy=false;saveSession(true);tick()};
    $('tripEnd').onclick=()=>{closeDialog();finish()};
  }
  function candidates(){
    const fresh=point&&Date.now()-point.time<120000&&point.accuracy<500,now=new Date();
    const choices=store.presets.filter(p=>p.bucket===activeBucket);
    if(!store.presets.length&&activeBucket==='outbound'&&fresh&&api.savedGoals){for(const g of api.savedGoals()){
      const r=routeBy(g.routeId);if(!r)continue;const target=r.stations.findIndex(s=>s[0]===g.to);let near=null;
      r.stations.forEach((s,i)=>{const d=api.distance(point.point,s);if(d<1400&&i!==target&&(r.loop||g.dir*(target-i)>0)&&(!near||d<near.d))near={i,d}});
      if(near){const leg=normalLeg({...g,from:r.stations[near.i][0],service:'all'});if(leg)choices.push({id:'memory:'+g.routeId+':'+g.dir,name:'前回の見守り',legs:[leg],usedAt:0})}
    }}
    return choices.map(p=>{
      let best={index:0,score:0,reason:p.usedAt?'最近使った経路':'保存した経路'};
      p.legs.forEach((l,i)=>{let score=0,reason=best.reason;if(fresh){const r=routeBy(l.routeId),a=r.stations.find(s=>s[0]===l.from),d=api.distance(point.point,a);if(d<1600){score=100-d/30;reason=l.from+'付近'+(i?' · 途中から開始':'')}
        const start=r.stations.findIndex(s=>s[0]===l.from),end=r.stations.findIndex(s=>s[0]===l.to),n=r.stations.length,total=r.loop?(l.dir*(end-start)+n)%n:Math.abs(end-start);
        r.stations.forEach((s,j)=>{const along=r.loop?(l.dir*(j-start)+n)%n:l.dir*(j-start),distance=api.distance(point.point,s);if(along>=0&&along<total&&distance<800&&50-distance/30>score){score=50-distance/30;reason=s[0]+'付近 · 区間'+(i+1)+'から'}});
      }
        if(p.usedAt){const used=new Date(p.usedAt);if(Math.abs(now.getHours()-used.getHours())<=2)score+=4;score+=Math.max(0,3-(Date.now()-p.usedAt)/86400000)}
        if(score>best.score)best={index:i,score,reason};
      });return{p,...best};
    }).sort((a,b)=>b.score-a.score||b.p.usedAt-a.p.usedAt).slice(0,3);
  }
  function renderHome(){
    if(session||api.state().armed)return;
    const list=candidates(),sig=JSON.stringify([activeBucket,store.presets.map(p=>[p.id,p.bucket]),list.map(c=>[c.p.id,c.index,c.reason,c.p.name,c.p.legs]),resume?.id,resume?.index,point?.station,locating]);if(sig===lastCandidates)return;lastCandidates=sig;
    $('journeyHomeTabs').innerHTML=bucketTabs('home-',activeBucket,'journeyCandidates');bindBucketTabs($('journeyHomeTabs'),setBucket);$('journeyCandidates').setAttribute('aria-labelledby','home-'+activeBucket);
    $('homeNearby').textContent=locating?'近くの駅を確認しています':point?.station?point.station+'付近から':'保存した経路から開始できます';
    let html='';
    if(resume)html='<section class="card preset-card"><span class="preset-name">途中の見守り</span><h3>'+esc(resume.legs[resume.index].to)+'まで再開</h3><p class="preset-path">'+esc(resume.name)+' · 区間 '+(resume.index+1)+' / '+resume.legs.length+'</p><p class="quiet-note">現在地を取り直してから案内します。</p><button id="resumeJourney" class="primary">見守りを再開</button><button id="dismissResume" class="full ghost small">終了済みにする</button></section>';
    if(list.length){const c=list[0],l=c.p.legs[c.index];html+='<section class="card preset-card"><div class="row"><span class="preset-name">'+esc(c.p.name)+'</span><span class="preset-reason">'+esc(c.reason)+'</span></div><h3>'+esc(l.from)+' <span style="color:#8d8b82;font-weight:400">→</span> '+esc(c.p.legs.at(-1).to)+'</h3><p class="preset-path">'+esc(lineText(c.p))+(c.p.legs.length>1?'<br>乗換 '+(c.p.legs.length-c.index-1)+'回 · 次に降りる駅 '+esc(l.to):'')+'</p><button class="primary" data-candidate="0">'+(c.index?'ここから見守り開始':'見守り開始')+'　→</button></section>';
      html+=list.slice(1).map((c,i)=>'<button class="preset-secondary" data-candidate="'+(i+1)+'"><span><b>'+esc(c.p.name)+'</b><small>'+esc(pathText(c.p))+'</small></span><span class="arrow">›</span></button>').join('');
    }else if(!resume){html='<section class="card home-empty"><h3>経路を設定してください</h3><p>乗る駅・降りる駅・乗換を登録できます。<br>保存した経路は、次回も使えます。</p><button id="firstJourney" class="primary full">＋ 経路を設定する</button></section>'}
    $('journeyCandidates').innerHTML=html;
    $('homeNew').hidden=!!$('firstJourney');$('homeNew').parentElement.classList.toggle('single-action',!!$('firstJourney'));
    $('homeNearby').hidden=!locating&&!point?.station&&!list.length&&!resume;
    $('journeyCandidates').onclick=e=>{const b=e.target.closest('[data-candidate]');if(b){const c=list[Number(b.dataset.candidate)];run(c.p,c.index)}};
    if($('firstJourney'))$('firstJourney').onclick=()=>openEditor();
    if($('resumeJourney'))$('resumeJourney').onclick=()=>run(resume,resume.index);
    if($('dismissResume'))$('dismissResume').onclick=()=>{resume=null;saveSession(true);lastCandidates='';renderHome()};
  }
  async function locate(){
    if(locating||session||api.state().running)return;locating=true;lastCandidates='';renderHome();
    try{point=await api.locateOnce();api.toast(point.station?point.station+'付近の経路を表示します':'現在地を確認しました')}catch(e){api.toast(e.code===1?'位置情報を許可すると近くの経路を提案できます。保存した経路からも開始できます。':'現在地を取得できませんでした。経路を選んで開始できます。')}
    locating=false;lastCandidates='';renderHome();
  }
  function openArrival(){const s=api.state(),l=session?.legs[session.index];api.openGuide(l?.routeId||s.routeId,l?.to||s.target,l?.dir||s.dir);refreshMini()}
  function refreshMini(){
    const st=api.state(),shown=!!(session||st.armed)&&visibleTab()!=='tabRide';$('watchMini').hidden=!shown;
    if(shown){const l=session?.legs[session.index],to=l?.to||st.target;const count=st.data?.count;$('watchMiniText').textContent=(session?.phase==='transfer'?'乗換待ち：':!st.armed?'見守り停止：':'見守り：')+to+(session?.phase==='transfer'?'':st.conflict?' · 路線を確認':st.fresh&&count!=null?' · あと'+count+'駅':' · 位置を確認中')}
    const hint=$('guideTripContext'),selection=api.currentGuide?.(),leg=session?.legs[session.index],next=session?.legs[session.index+1];
    if(hint){const matches=leg&&next&&selection?.routeId===leg.routeId&&selection.name===leg.to&&selection.dir===leg.dir;hint.hidden=!matches;
      if(matches){hint.textContent=leg.to+'で '+short(routeBy(next.routeId))+'へ乗換';
        const key=[leg.routeId,leg.to,leg.dir,next.routeId].join(':');if(guideContextKey!==key){guideContextKey=key;
          const needle=short(routeBy(next.routeId)).replace(/^(?:JR|東京メトロ|東急|都営|京急|西武|東武|相鉄|京王|小田急)\s*/,'');
          const opts=[...$('guideExit').options].filter(o=>o.value!=='all'&&needle.length>=3&&o.textContent.includes(needle));
          if(opts.length===1&&$('guideExit').value==='all')api.selectGuideExit?.(opts[0].value);
        }
      }else guideContextKey='';
    }
  }
  function renderSegment(st,hide){
    const box=$('watchSegment'),track=$('segmentTrack'),marker=$('segmentMarker'),data=st.segmentProgress;box.hidden=hide;
    const ratio=data?.ratio,known=Number.isFinite(ratio),percent=known?Math.round(ratio*100):0;
    const segmentFromName=data?.from||'—',segmentToName=data?.to||st.next||'次の停車駅';$('segmentFrom').textContent=segmentFromName;$('segmentTo').textContent=segmentToName;decorateTransferStation($('segmentFrom'),segmentFromName);decorateTransferStation($('segmentTo'),segmentToName);
    track.classList.toggle('estimated',!!data?.estimated);track.classList.toggle('unknown',!known);
    if(known)track.setAttribute('aria-valuenow',String(percent));else track.removeAttribute('aria-valuenow');
    marker.hidden=!known;if(known)marker.style.left=(ratio*100)+'%';
    for(const [i,part] of [...track.querySelectorAll('.segment-piece')].entries())part.style.setProperty('--filled',Math.max(0,Math.min(1,(ratio||0)*10-i))*100+'%');
    const label=known?(data.manual?'手動の現在駅 · ':data.estimated?'推定位置 · ':'')+percent+'% · 10区切り'+(data.manual?'（GPSで再確認）':''):st.running?'位置を確認しています':'測位を停止しています';
    $('segmentNote').textContent=label;track.setAttribute('aria-valuetext',known?data.from+'から'+data.to+'まで '+label:label);
  }
  function formatGpsAge(age){if(!Number.isFinite(age))return'未取得';const sec=Math.max(0,Math.floor(age));if(sec<60)return sec+'秒前';const m=Math.floor(sec/60),r=sec%60;return m+'分'+String(r).padStart(2,'0')+'秒前'}
  function gpsAgeLevel(age){if(!Number.isFinite(age))return'unknown';if(age<12)return'fresh';if(age<30)return'aging';if(age<60)return'stale';if(age<180)return'warning';return'critical'}
  function liveGpsAge(st){const at=Number(st?.gpsAt);return at>0?Math.max(0,(Date.now()-at)/1000):Number.isFinite(st?.gpsAgeSec)?st.gpsAgeSec:null}
  function paintGpsAge(el,st){if(!el)return;const age=liveGpsAge(st),level=gpsAgeLevel(age),prefix=level==='warning'||level==='critical'?'⚠ ':'';el.className='gps-age gps-age-'+level;el.textContent=prefix+'GPS最終取得 '+formatGpsAge(age);el.setAttribute('aria-label',Number.isFinite(age)?'GPS最終取得から'+formatGpsAge(age):'GPSはまだ取得できていません')}
  function overviewLayout(model){
    if(!model?.stations?.length)return null;const rows=model.stations,n=rows.length,minGap=n<=16?46:n<=32?42:38,segments=[];
    for(let i=0;i<n-1;i++)segments.push(Math.max(1,rows[i+1].distanceFromStart-rows[i].distanceFromStart));
    const avg=segments.reduce((a,b)=>a+b,0)/Math.max(1,segments.length),ys=[24];
    for(const d of segments){const factor=Math.max(1,Math.min(1.75,.85+.35*Math.sqrt(d/Math.max(1,avg))));ys.push(ys.at(-1)+minGap*factor)}
    const totalHeight=Math.ceil(ys.at(-1)+28);let currentY=null;
    if(Number.isFinite(model.currentDistance)){currentY=ys[0];if(n>1){let i=0;while(i<n-2&&model.currentDistance>rows[i+1].distanceFromStart)i++;const a=rows[i].distanceFromStart,b=rows[i+1].distanceFromStart,t=Math.max(0,Math.min(1,(model.currentDistance-a)/Math.max(1,b-a)));currentY=ys[i]+t*(ys[i+1]-ys[i])}}
    return{...model,ys,totalHeight,currentY,legCount:1,stationCount:n};
  }
  function currentLeg(){return session?.legs?.[session.index]||null}
  function transferMetaForStation(name){
    if(!session?.legs?.length||!name)return null;for(let i=0;i<session.legs.length-1;i++){const a=session.legs[i],b=session.legs[i+1];if(a?.to===name&&b?.from===name)return{routeId:a.routeId,station:name,dir:Number(a.dir)||1,nextRouteId:b.routeId,legIndex:i}}return null;
  }
  function clearTransferAttrs(el){if(!el)return;el.classList.remove('transfer-guide-trigger','segment-transfer-trigger');el.removeAttribute('role');el.removeAttribute('tabindex');el.removeAttribute('aria-label');for(const k of ['routeId','station','dir','nextRouteId'])delete el.dataset[k]}
  function decorateTransferStation(el,name){if(!el)return;clearTransferAttrs(el);const meta=transferMetaForStation(name);if(!meta)return;el.classList.add('transfer-guide-trigger','segment-transfer-trigger');el.setAttribute('role','button');el.tabIndex=0;el.setAttribute('aria-label',name+'の降車位置・乗換設備を見る');el.dataset.routeId=meta.routeId;el.dataset.station=meta.station;el.dataset.dir=String(meta.dir);el.dataset.nextRouteId=meta.nextRouteId||''}
  function openTransferFromElement(el){if(!el?.classList?.contains('transfer-guide-trigger'))return false;api.openTransferGuide?.(el.dataset.routeId,el.dataset.station,Number(el.dataset.dir)||1,el.dataset.nextRouteId||'');return true}
  function journeyOverview(st){
    if(!session?.legs?.length||!api.legOverview)return null;const raw=session.legs.map((leg,index)=>({leg,index,model:api.legOverview(leg)}));if(raw.some(x=>!x.model))return null;
    const stationCount=raw.reduce((n,x)=>n+x.model.stations.length,0),minGap=stationCount<=18?48:stationCount<=36?44:40,rows=[],legBadges=[],legLayouts=[];let y=40;
    for(const item of raw){const {leg,index,model}=item,routeName=short(routeBy(leg.routeId)),local=model.stations,segments=[];for(let j=0;j<local.length-1;j++)segments.push(Math.max(1,local[j+1].distanceFromStart-local[j].distanceFromStart));const avg=segments.reduce((a,b)=>a+b,0)/Math.max(1,segments.length),ys=[];let shared=false;
      if(index===0){ys.push(y);legBadges.push({y:4,index,routeName})}
      else{const prev=rows.at(-1);shared=!!prev&&prev.name===local[0].name;if(shared){ys.push(prev.y);prev.kind='transfer';prev.transferTo=routeName;prev.nextLegIndex=index;prev.nextRouteId=leg.routeId;legBadges.push({y:prev.y+17,index,routeName})}else{y=(prev?.y??y)+42;ys.push(y);legBadges.push({y:y-28,index,routeName})}}
      if(!shared){const src=local[0],kind=index===0?'start':index===raw.length-1&&local.length===1?'end':src.kind;rows.push({...src,y:ys[0],kind,legIndex:index,routeName,routeId:leg.routeId,dir:leg.dir,legStart:true})}
      for(let j=1;j<local.length;j++){const d=segments[j-1],factor=Math.max(1,Math.min(1.7,.88+.32*Math.sqrt(d/Math.max(1,avg)))),extra=shared&&j===1?30:0;y=(ys[j-1]??y)+extra+minGap*factor;ys.push(y);const src=local[j],last=j===local.length-1,kind=index===raw.length-1&&last?'end':last?'transfer':src.kind;rows.push({...src,y,kind,legIndex:index,routeName,routeId:leg.routeId,dir:leg.dir,legStart:false,transferTo:last&&index<raw.length-1?short(routeBy(raw[index+1].leg.routeId)):'',nextRouteId:last&&index<raw.length-1?raw[index+1].leg.routeId:''})}
      legLayouts[index]={model,ys};
    }
    const active=session.index,layout=legLayouts[active],activeLeg=session.legs[active],activePosition=activeLeg&&st.routeId===activeLeg.routeId?api.routeOverview?.(activeLeg.from,activeLeg.to,activeLeg.dir):null;let currentY=null,estimated=!!st.fix&&!st.fresh,manual=!!st.manual;
    if(layout&&activePosition&&Number.isFinite(activePosition.currentDistance)){const local=layout.model.stations,ys=layout.ys;let i=0;while(i<local.length-2&&activePosition.currentDistance>local[i+1].distanceFromStart)i++;const a=local[i].distanceFromStart,b=local[i+1].distanceFromStart,t=Math.max(0,Math.min(1,(activePosition.currentDistance-a)/Math.max(1,b-a)));currentY=ys[i]+t*(ys[i+1]-ys[i]);estimated=!!activePosition.estimated;manual=!!activePosition.manual}
    const totalHeight=Math.ceil((rows.at(-1)?.y||120)+34),firstY=rows[0]?.y||20,lastY=rows.at(-1)?.y||firstY,progressRatio=Number.isFinite(currentY)?Math.max(0,Math.min(1,(currentY-firstY)/Math.max(1,lastY-firstY))):0;
    return{from:session.legs[0].from,to:session.legs.at(-1).to,stations:rows,ys:rows.map(x=>x.y),legBadges,totalHeight,currentY,progressRatio,estimated,manual,currentLegIndex:active,legCount:session.legs.length,stationCount:rows.length,journey:true};
  }
  function overviewFor(st){
    if(session?.legs?.length)return journeyOverview(st);const l=currentLeg();if(l&&l.routeId!==st.routeId)return null;const from=l?.from||legacyOverviewFrom||st.segmentProgress?.from||st.currentStation,to=l?.to||st.target,model=api.routeOverview?.(from,to,l?.dir||st.dir);return overviewLayout(model);
  }
  function stationTag(x){if(x.kind==='start')return'出発';if(x.kind==='end')return'最終';if(x.kind==='transfer')return x.transferTo?'乗換 → '+x.transferTo:'乗換';return x.isStop?'停車':'通過'}
  function stationStateClass(x,model){if(!model.journey)return'';const ids=[x.legIndex,Number.isInteger(x.nextLegIndex)?x.nextLegIndex:null].filter(Number.isInteger);if(ids.includes(model.currentLegIndex))return' route-station-current-leg';if(ids.length&&ids.every(i=>i<model.currentLegIndex))return' route-station-completed';return' route-station-future'}
  function passedStationLabel(x){if(x?.kind==='start')return'✓ 出発済み';if(x?.kind==='transfer')return'✓ 乗換済み';return'✓ 通過済み'}
  function updateRouteStationProgress(canvas,model){
    const current=model?.currentY,known=Number.isFinite(current),els=[...canvas.querySelectorAll('.route-station')];
    els.forEach((el,i)=>{const y=Number(model?.ys?.[i]),x=model?.stations?.[i],passed=known&&Number.isFinite(y)&&y<current-10,atCurrent=known&&Number.isFinite(y)&&Math.abs(y-current)<=10&&!passed,small=el.querySelector('small');el.classList.toggle('route-station-passed',passed);el.classList.toggle('route-station-current-position',atCurrent);if(small){if(!small.dataset.baseTag)small.dataset.baseTag=small.textContent||'';small.textContent=passed?passedStationLabel(x):small.dataset.baseTag}if(!el.dataset.baseAria)el.dataset.baseAria=el.getAttribute('aria-label')||'';el.setAttribute('aria-label',el.dataset.baseAria+(passed?'、通過済み':atCurrent?'、現在位置付近':''))});
  }
  function overviewMarkup(model){
    const firstY=model.ys[0]||20,lastY=model.ys.at(-1)||firstY,lineStyle='top:'+firstY+'px;bottom:'+Math.max(0,model.totalHeight-lastY)+'px';
    const badges=(model.legBadges||[]).map(b=>'<span class="route-leg-badge '+(b.index<model.currentLegIndex?'completed':b.index===model.currentLegIndex?'current':'future')+'" style="top:'+b.y+'px">区間 '+(b.index+1)+' · '+esc(b.routeName)+'</span>').join('');
    const stations=model.stations.map((x,i)=>{const tappable=x.kind==='transfer'&&x.routeId,cls='route-station route-station-'+x.kind+stationStateClass(x,model)+(tappable?' transfer-guide-trigger':''),attrs=tappable?' role="button" tabindex="0" data-route-id="'+esc(x.routeId)+'" data-station="'+esc(x.name)+'" data-dir="'+esc(x.dir||1)+'" data-next-route-id="'+esc(x.nextRouteId||'')+'"':'';return '<span class="'+cls+'"'+attrs+' style="top:'+model.ys[i]+'px" aria-label="'+esc(x.name)+'、区間 '+(Number(x.legIndex??0)+1)+'、'+esc(stationTag(x))+(tappable?'、タップで降車位置を表示':'')+'"><i aria-hidden="true"></i><b>'+esc(x.name)+'</b><small>'+esc(stationTag(x))+'</small></span>'}).join('');
    return'<span class="route-overview-line" style="'+lineStyle+'" aria-hidden="true"><span class="route-overview-line-fill"></span></span>'+badges+stations+'<span class="route-current-marker" aria-hidden="true"><i></i><b></b></span>';
  }
  function centerNormalRoute(behavior){const marker=$('watchRouteCanvas')?.querySelector('.route-current-marker:not([hidden])');marker?.scrollIntoView?.({block:'center',inline:'nearest',behavior:behavior||(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth')})}
  function renderRouteOverview(st,hide){
    const view=$('watchRouteOverview'),canvas=$('watchRouteCanvas');view.hidden=hide;if(hide)return;const model=overviewFor(st);if(!model){$('watchRouteRange').textContent='全区間を確認中';canvas.className='route-overview-canvas route-overview-empty';canvas.style.height='120px';canvas.innerHTML='<p>出発地と各乗換・最終目的地を確認すると、旅程全体を表示します。</p>';canvas.removeAttribute('aria-valuenow');canvas.setAttribute('aria-valuetext','旅程全体を確認中');return}
    $('watchRouteRange').textContent=model.from+' → '+model.to+' · '+(model.legCount>1?model.legCount+'区間 · ':'')+model.stationCount+'駅';const signature=[model.from,model.to,model.currentLegIndex,model.stations.map(x=>x.name+':'+x.kind+':'+x.legIndex+':'+(x.transferTo||'')).join('|'),model.totalHeight].join('::');
    if(canvas.dataset.signature!==signature){canvas.dataset.signature=signature;canvas.className='route-overview-canvas'+(model.journey?' journey-overview':'');canvas.style.height=model.totalHeight+'px';canvas.innerHTML=overviewMarkup(model)}
    const marker=canvas.querySelector('.route-current-marker'),fill=canvas.querySelector('.route-overview-line-fill'),known=Number.isFinite(model.currentY),pct=Math.round(model.progressRatio*100),firstY=model.ys[0]||20;marker.hidden=!known;if(known){marker.style.top=model.currentY+'px';marker.classList.toggle('estimated',!!model.estimated);marker.classList.toggle('manual',!!model.manual);marker.querySelector('b').textContent=(model.manual?'手動位置':model.estimated?'推定現在地':'現在地')+(model.journey?' · 区間 '+(model.currentLegIndex+1):'');fill.style.height=Math.max(0,model.currentY-firstY)+'px';canvas.setAttribute('aria-valuenow',String(pct));canvas.setAttribute('aria-valuetext',model.from+'から'+model.to+'まで '+(model.estimated?'推定 ':'')+pct+'%')}else{fill.style.height='0px';canvas.removeAttribute('aria-valuenow');canvas.setAttribute('aria-valuetext','現在地を確認中')}updateRouteStationProgress(canvas,model);
    if(routeCenterRequested){routeCenterRequested=false;if(known)requestAnimationFrame(()=>centerNormalRoute())}
  }
  function setProgressViewMode(mode,center=true){if(!['segment','route'].includes(mode)||progressViewMode===mode){if(mode==='route'&&center){routeCenterRequested=true;tick()}return}progressViewMode=mode;routeCenterRequested=mode==='route'&&center;tick()}
  function syncProgressView(st,segmentUnavailable){const route=progressViewMode==='route';$('watchViewSegment').setAttribute('aria-pressed',String(!route));$('watchViewRoute').setAttribute('aria-pressed',String(route));renderSegment(st,segmentUnavailable||route);renderRouteOverview(st,!route)}
  function resetLegDetect(keepGps=false){legDetect={candidate:-1,hits:0,lastGpsAt:keepGps?legDetect.lastGpsAt:0,lastSwitch:legDetect.lastSwitch}}
  function maybeAutoSwitchLeg(st){
    if(!session||busy||session.index>=session.legs.length-1||!st.running||st.manual||!api.detectJourneyLeg)return false;const d=api.detectJourneyLeg(session.legs,session.index);if(!d||!d.gpsAt||d.gpsAt===legDetect.lastGpsAt)return false;legDetect.lastGpsAt=d.gpsAt;
    if(d.index<=session.index||!d.strong||Date.now()-legDetect.lastSwitch<7000){resetLegDetect(true);return false}const currentBad=!Number.isFinite(d.currentOff)||d.currentOff>d.threshold;if(session.phase!=='transfer'&&!currentBad&&!d.veryStrong){resetLegDetect(true);return false}
    const leap=d.index-session.index;if(leap>1&&!d.veryStrong){resetLegDetect(true);return false}if(legDetect.candidate===d.index)legDetect.hits++;else{legDetect.candidate=d.index;legDetect.hits=1}const needed=session.phase==='transfer'?2:leap===1?3:5;if(legDetect.hits<needed)return false;
    return activateSessionLeg(d.index,{auto:true});
  }
  const dimScreen=window.createDimScreen?.(api,{getMode:()=>progressViewMode,setMode:m=>setProgressViewMode(m,true),getOverview:st=>overviewFor(st),getTransferMeta:name=>transferMetaForStation(name),openTransferGuide:meta=>api.openTransferGuide?.(meta.routeId,meta.station,meta.dir,meta.nextRouteId||'')});
  let latestWatchState=null;
  setInterval(()=>{if(!booted||document.hidden||!latestWatchState||$('watchHero')?.hidden)return;paintGpsAge($('watchGpsAge'),latestWatchState)},1000);
  function tick(){
    if(busy||!booted)return;const st=api.state(),active=!!session||st.armed;latestWatchState=st;$('journeyHome').hidden=active;$('watchHero').hidden=!active;
    if(updatePending){$('journeyUpdateApply').disabled=active;$('journeyUpdateText').textContent=active?'更新があります。見守り終了後に適用できます。':'新しいバージョンを利用できます。'}
    $('advancedRide').hidden=active;
    if(!active){legacyOverviewFrom='';legacyOverviewRoute='';dimScreen?.update(st,'');if(eco){eco=false;ecoChanged=0;document.body.classList.remove('eco');if(st.running)api.refreshGps()}renderHome();refreshMini();return}
    if(session&&session.phase==='riding'&&!st.armed){session.phase='paused';saveSession(true)}
    if(session&&st.arrived&&st.fresh&&st.target===session.legs[session.index].to&&session.phase==='riding'){
      session.phase=session.index+1<session.legs.length?'transfer':'arrived';saveSession(true);
    }
    if(session&&maybeAutoSwitchLeg(st))return;
    const l=session?.legs[session.index],to=l?.to||st.target||'降りる駅';if(!session){if(legacyOverviewRoute!==st.routeId){legacyOverviewRoute=st.routeId;legacyOverviewFrom=''}if(!legacyOverviewFrom&&st.currentStation)legacyOverviewFrom=st.currentStation}
    $('watchGoal').innerHTML=esc(to)+'<small>変更 ›</small>';
    $('watchHeading').textContent=session?session.name+' · 区間 '+(session.index+1)+' / '+session.legs.length+(session.legs.length>1?' · GPS自動判定':''):'降車駅の見守り';
    const mismatch=l&&(st.routeId!==l.routeId||st.dir&&st.dir!==l.dir||st.target&&st.target!==l.to);
    const problem=st.conflict||(mismatch?'路線・方向の設定が今回の経路と異なります。経路を変更するか、見守りを再開してください。':'')||(st.error==='denied'?'位置情報の許可を確認してください。':'');
    const count=st.data?.count,transfer=session?.phase==='transfer',arrived=session?.phase==='arrived';
    let text='',numeric=false;
    if(transfer)text='乗換の準備';else if(arrived)text='降りる駅に到着';else if(problem)text='位置を確認';else if(!st.running||!st.armed)text='見守り停止中';else if(st.data?.gap< -250)text='通過の可能性';else if(count===0)text=st.fresh?'まもなく到着':'到着を確認中';else if(count!=null){numeric=true;text='<small>'+(st.fresh?'あと':'推定 あと')+'</small>'+esc(count)+'<small>駅</small>'}else text='現在地を確認中';
    $('watchCount').classList.toggle('textual',!numeric);$('watchCount').innerHTML=numeric?text:esc(text);
    $('watchNext').textContent=st.next||'確認中';$('watchNextRow').hidden=transfer||arrived;syncProgressView(st,transfer||arrived);
    $('watchRoute').textContent=(l?short(routeBy(l.routeId)):st.routeName)+' · '+(l?dirLabel(routeBy(l.routeId),l.dir):st.directionLabel)+' · '+st.serviceName;
    $('watchEta').textContent=st.data?.seconds>0?(st.data.etaEstimated||!st.fresh?'推定 ':'')+'到着まで約'+Math.max(1,Math.ceil(st.data.seconds/60))+'分 · '+(st.data.etaSource==='last-valid'?'直近の移動から算出':'直近の移動速度から算出'):st.running?'到着時間を計算中 · 車内案内と合わせてご利用ください':'位置情報を確認して再開できます';paintGpsAge($('watchGpsAge'),st);
    $('watchQuality').textContent=problem?'確認が必要':st.manual?'手動の現在駅':st.fresh?'位置確認済み':st.fix?'位置を推定中':'GPSを確認中';$('watchQuality').className='chip watch-quality '+(st.fresh&&!problem?'good':'warn');
    $('watchPositionNote').hidden=st.fresh&&!problem;$('watchPositionNote').textContent=problem||(!st.running?'追跡は停止しています。再開すると現在地を確認します。':st.manual?'現在駅を手動で指定しています。GPSを取得すると補正します。':st.fix?'GPS最終取得 '+formatGpsAge(st.gpsAgeSec)+'。古い測位では推定位置を表示し、到着・通過は確定しません。':'GPSを確認しています。地下や車内では時間がかかることがあります。');
    $('watchFinal').hidden=!session||session.legs.length<2;$('watchFinal').textContent=session?'旅程全体 '+session.legs.length+'区間 · 最終目的地 '+session.legs.at(-1).to+(session.index+1<session.legs.length?' · 次は '+short(routeBy(session.legs[session.index+1].routeId)):' · 最後の区間'):'';
    $('watchProgressFill').style.width=Math.round(st.progress*100)+'%';
    $('watchWake').textContent=st.wake?'画面保持 ON':'画面保持 '+(st.running?'未取得':'OFF');$('watchPower').textContent=eco?'自動省電力':'通常の見守り';
    $('watchTransfer').hidden=!(transfer||arrived||!st.running||!st.armed);
    if(transfer){const n=session.legs[session.index+1];$('watchTransferTitle').textContent=n?short(routeBy(n.routeId))+'へ乗換':'目的地に到着';$('watchTransferDetail').textContent=n?n.from+' → '+n.to+' · '+dirLabel(routeBy(n.routeId),n.dir)+' · GPSで次区間を確認すると自動で開始します。判定しにくい時は下のボタンで進めます。':'';$('watchTransferStart').textContent='乗り換えた・次を開始';$('watchTransferStart').onclick=nextLeg}
    else if(arrived){$('watchTransferTitle').textContent='この駅で降車';$('watchTransferDetail').textContent='降りたら見守りを終了できます。';$('watchTransferStart').textContent='降車して終了';$('watchTransferStart').onclick=finish}
    else if(!st.running||!st.armed){$('watchTransferTitle').textContent='見守りを再開';$('watchTransferDetail').textContent='現在地を取り直します。';$('watchTransferStart').textContent='再開';$('watchTransferStart').onclick=()=>session?run(session,session.index):api.resumeLegacy()}
    if(session)saveSession();updatePower(st);refreshMini();dimScreen?.update(st,session?.phase||'');
  }
  function updatePower(st){
    const age=st.fix?Date.now()-st.fix.t:Infinity;
    const far=store.eco&&st.armed&&st.running&&!st.conflict&&!st.error&&!st.manual&&st.fix?.acc<=80&&age<18000&&st.data?.count>3&&st.data?.gap>10000&&st.data?.seconds>480&&st.speed>=3&&!st.alert;
    const desired=!!far;if(desired===eco)return;if(desired&&Date.now()-ecoChanged<15000)return;
    eco=desired;ecoChanged=Date.now();document.body.classList.toggle('eco',eco);api.refreshGps();
  }
  function searchRecent(match,d){store.recent=[{routeId:match.routeId,station:match.station,dir:d},...store.recent.filter(x=>x.routeId!==match.routeId||x.station!==match.station||x.dir!==d)].slice(0,6);saveStore()}
  function renderSearch(matches){
    const holder=$('stationQuickCards');if(!holder)return;const q=$('stationQuickInput').value.trim();
    if(!q){holder.innerHTML='<p class="quiet-note">駅名を入力して、路線の下の方面を選びます。</p><div class="quick-recent">'+store.recent.map((x,i)=>'<button data-recent="'+i+'">'+esc(x.station)+'<small> · '+esc(short(api.guideRoutes.find(r=>r.id===x.routeId)))+'</small></button>').join('')+'</div>';holder.onclick=e=>{const b=e.target.closest('[data-recent]');if(b){const x=store.recent[Number(b.dataset.recent)];api.quickOpen(x.routeId,x.station,x.dir)}};return}
    holder.innerHTML=matches.map((m,i)=>'<div class="quick-result"><span class="quick-station">'+esc(m.station)+'</span><span class="quick-route"><span class="route-dot" style="background:'+esc(m.routeObj.color||'#bdaf92')+'"></span>'+esc(m.routeLabel)+'</span><div class="direction-buttons">'+[1,-1].map(d=>'<button data-match="'+i+'" data-dir="'+d+'">'+esc(dirLabel(m.routeObj,d))+'</button>').join('')+'</div>').join('');
    holder.onclick=e=>{const b=e.target.closest('[data-match]');if(!b)return;const m=matches[Number(b.dataset.match)];if(m)api.quickApply(m,Number(b.dataset.dir))};
  }
  function init(){
    $('journeyDialogClose').onclick=closeDialog;$('journeyDialog').addEventListener('cancel',()=>lastFocused?.focus?.());$('journeyDialog').addEventListener('close',()=>{cancelVibrationTest();if($('notificationDialogControls'))window.EkikanNotifications?.cancelTest('設定画面を閉じたため、テストを中止しました。')});
    $('watchReset').onclick=()=>clearCurrent();
    $('homeNew').onclick=()=>openEditor();$('homeSaved').onclick=manage;$('homeLocate').onclick=locate;
    $('watchGoal').onclick=editCurrentGoal;$('watchMore').onclick=showTripMenu;$('watchGuide').onclick=openArrival;$('watchMiniBack').onclick=()=>tab('Ride');$('watchViewSegment').onclick=()=>setProgressViewMode('segment');$('watchViewRoute').onclick=()=>setProgressViewMode('route');$('watchRouteCenter').onclick=()=>centerNormalRoute();
    const transferClick=e=>{const el=e.target.closest?.('.transfer-guide-trigger');if(el)openTransferFromElement(el)},transferKey=e=>{if(!['Enter',' '].includes(e.key))return;const el=e.target.closest?.('.transfer-guide-trigger');if(el){e.preventDefault();openTransferFromElement(el)}};for(const el of [$('segmentFrom'),$('segmentTo'),$('watchRouteCanvas')]){el?.addEventListener('click',transferClick);el?.addEventListener('keydown',transferKey)}
    $('journeyEco').checked=store.eco;$('journeyEco').onchange=()=>{store.eco=$('journeyEco').checked;saveStore();tick()};
    $('journeyUpdateApply').onclick=()=>{if(session||api.state().armed){api.toast('見守り終了後に更新できます。');return}location.reload()};
    $('settingsPresets').onclick=manage;$('notificationHelp').onclick=()=>showNotificationHelp();
    for(const b of document.querySelectorAll('[data-facility]'))b.onclick=()=>{api.facility(b.dataset.facility);for(const x of document.querySelectorAll('[data-facility]'))x.setAttribute('aria-pressed',String(x===b))};
    const syncFacility=()=>{for(const b of document.querySelectorAll('[data-facility]'))b.setAttribute('aria-pressed',String(b.dataset.facility===$('facilityFilter').value))};syncFacility();$('facilityFilter').addEventListener('change',syncFacility);
    for(const name of ['Ride','Guide','Settings','History'])$('tab'+name)?.addEventListener('click',refreshMini);
    $('stationQuickClear').onclick=()=>{$('stationQuickInput').value='';$('stationQuickInput').focus();api.quickSearch(true)};
    $('stationQuickInput').addEventListener('focus',()=>{if(!$('stationQuickInput').value.trim())api.quickSearch(true)});
    $('openHistory').onclick=()=>{api.tab('History');refreshMini()};$('openSettings').onclick=()=>{api.tab('Settings');refreshMini()};
    $('copyDiagnostics').onclick=async()=>{const s=api.state(),text='駅間ナビ 54\n路線: '+s.routeName+'\n方向: '+s.directionLabel+'\n目的駅: '+(s.target||'未設定')+'\n位置状態: '+(s.fresh?'確認済み':s.manual?'手動':'未確認・推定')+'\n見守り: '+(s.armed?'開始':'停止')+'\n状態: '+(s.conflict||s.error||'通常')+'\nバイブAPI: '+(typeof navigator.vibrate==='function'?'あり（実機確認が必要）':'なし')+'\nホーム画面起動: '+(navigator.standalone||window.matchMedia?.('(display-mode: standalone)').matches?'はい':'いいえ');try{await navigator.clipboard.writeText(text);api.toast('状況をコピーしました。緯度・経度は含みません。')}catch{dialog('動作状況をコピー','<textarea readonly>'+esc(text)+'</textarea>')}};
    window.addEventListener('pagehide',()=>{cancelVibrationTest();saveSession(true)});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){cancelVibrationTest();saveSession(true)}else tick()});
    booted=true;tick();
  }
  init();
  return {tick,locate,renderSearch,searchRecent,normalPreset,
    hasSession:()=>!!session,
    relaxedGps:()=>eco,
    geoOptions:()=>({enableHighAccuracy:!eco,maximumAge:eco?5000:1500,timeout:12000}),
    beforeLongResume(){if(!session)return false;resume={...session};session=null;busy=true;api.stop();busy=false;saveSession(true);lastCandidates='';tick();return true},
    onUpdate(){updatePending=true;$('journeyUpdate').hidden=false;tick();return true},
    onLegacyStop(){if(!busy&&session&&session.phase==='riding'){session.phase='paused';saveSession(true)}},
    onGoalChange(){if(busy||!session)return;const s=api.state(),l=session.legs[session.index];if(s.routeId===l.routeId&&s.target&&s.target!==l.to){l.to=s.target;l.dir=s.dir;session.phase='riding';saveSession(true)}},
    isActive:()=>!!session||api.state().armed
  };
};
