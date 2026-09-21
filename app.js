const $=id=>document.getElementById(id), labels={intro:'前奏',verse:'主歌',chorus:'副歌'},urls=new Map();
let songs=[],used=new Set(),current=null,round=0,editing=null,generation=0,source=null,ctx=null,ticker=null,quizQueue=[],quizFinished=false;
try{songs=JSON.parse(localStorage.getItem('guessSongs')||'[]')}catch{}
let playedHistory=new Set();
try{playedHistory=new Set(JSON.parse(localStorage.getItem('guessPlayedHistory')||'[]'))}catch{}
function persist(){try{localStorage.setItem('guessSongs',JSON.stringify(songs))}catch{alert('瀏覽器無法保存設定，請匯出題庫備份。')}}
function persistPlayed(){try{localStorage.setItem('guessPlayedHistory',JSON.stringify([...playedHistory]))}catch{}}
const audioDb=()=>new Promise((resolve,reject)=>{const request=indexedDB.open('guessSongAudio',1);request.onupgradeneeded=()=>request.result.createObjectStore('files',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
async function saveAudio(id,file){const db=await audioDb();return new Promise((resolve,reject)=>{const tx=db.transaction('files','readwrite');tx.objectStore('files').put({id,file,name:file.name,type:file.type,lastModified:file.lastModified});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};tx.onabort=()=>{db.close();reject(tx.error)}})}
async function removeAudio(id){try{const db=await audioDb();const tx=db.transaction('files','readwrite');tx.objectStore('files').delete(id);tx.oncomplete=()=>db.close()}catch{}}
async function restoreAudio(){if(!('indexedDB'in window))return;try{const db=await audioDb();const records=await new Promise((resolve,reject)=>{const request=db.transaction('files').objectStore('files').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});db.close();for(const record of records){if(record.file&&songs.some(song=>song.id===record.id)){if(urls.has(record.id))URL.revokeObjectURL(urls.get(record.id));urls.set(record.id,URL.createObjectURL(record.file))}}if(records.length){render();$('importStatus').textContent='已自動還原 '+urls.size+' 首儲存在此裝置的歌曲。'}}catch{}}
async function requestDurableStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch{}}
function tab(lib){stop();$('game').hidden=lib;$('library').hidden=!lib;$('playTab').classList.toggle('active',!lib);$('libTab').classList.toggle('active',lib)}
$('playTab').onclick=()=>tab(false);$('libTab').onclick=()=>tab(true);
for(const id of ['importTop','importLib','importEmpty'])$(id).onclick=()=>$('files').click();
function selectedSegment(){return $('segment')?.value||'random'}
function segmentAllowed(key,picked){
 if(picked==='random')return true;
 if(picked==='introVerse')return key==='intro'||key==='verse';
 return picked===key;
}
function validMarks(s){
 const picked=selectedSegment();
 let keys=Object.keys(labels).filter(k=>Number.isFinite(s.marks[k])&&s.marks[k]>=0&&segmentAllowed(k,picked));
 if(s.chorusSpoiler){
  const safe=Object.keys(labels).filter(k=>k!=='chorus'&&Number.isFinite(s.marks[k])&&s.marks[k]>=0);
  if(safe.length&&(picked==='random'||picked==='chorus'))keys=safe;
 }
 return keys;
}
function packName(){return $('pack')?.value||'random'}
function songPackMatch(s,pack=packName()){
 if(pack==='random')return true;
 if(pack==='gold')return s.era==='華語經典';
 if(pack==='new')return s.era==='華語新歌';
 if(pack==='pop')return s.era==='華語流行';
 if(pack==='taiwanese')return s.era==='台語歌';
 if(pack==='male')return s.kind==='男歌手';
 if(pack==='female')return s.kind==='女歌手';
 if(pack==='group')return s.kind==='團體';
 if(pack==='douyin')return s.kind==='抖音神曲';
 if(pack==='hiphop')return s.kind==='嘻哈金曲'||/(頑童|玖壹壹)/.test([s.sourceGroup,s.artist].filter(Boolean).join(' '));
 if(pack==='duet')return s.kind==='對唱組合';
 return true;
}
function groupKey(s,pack=packName()){
 if(pack==='random')return s.kind||s.era||s.artist||'未分類';
 if(pack==='gold'||pack==='pop'||pack==='new')return s.kind||s.artist||'未分類';
 return s.artist||s.era||'未分類';
}
function availableSongs(pack=packName()){return songs.filter(s=>!playedHistory.has(s.id)&&urls.has(s.id)&&songPackMatch(s,pack)&&validMarks(s).length)}
function shuffle(list){const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function cappedWeightedPick(list,total){
 const buckets=new Map();
 for(const song of list){const key=song.sourceGroup||song.artist||'其他';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(song)}
 const size=list.length,targets=new Map(),other=[...buckets.keys()].find(k=>/^(其他|其它)$/i.test(k));let excess=0;
 for(const [key,items] of buckets){const raw=items.length/size;if(key===other)targets.set(key,raw);else{targets.set(key,Math.min(.08,raw));excess+=Math.max(0,raw-.08)}}
 if(other)targets.set(other,targets.get(other)+excess);
 else while(excess>1e-9){const open=[...targets.keys()].filter(k=>targets.get(k)<.08-1e-9);if(!open.length)break;const share=excess/open.length;let used=0;for(const key of open){const add=Math.min(share,.08-targets.get(key));targets.set(key,targets.get(key)+add);used+=add}if(!used)break;excess-=used}
 const pool=[];for(const [key,items] of buckets){const each=(targets.get(key)||0)/items.length;for(const song of items)pool.push({song,weight:each})}
 const picked=[];
 while(picked.length<total&&pool.length){let sum=pool.reduce((n,x)=>n+x.weight,0),r=Math.random()*sum,index=pool.length-1;for(let i=0;i<pool.length;i++){r-=pool[i].weight;if(r<=0){index=i;break}}picked.push(pool.splice(index,1)[0].song)}
 return picked;
}
function balancedPick(list,total,pack=packName()){
 if(['male','female','group'].includes(pack))return cappedWeightedPick(list,total);
 if(pack==='hiphop')return shuffle(list).slice(0,total);
 const buckets=new Map();
 for(const song of shuffle(list)){const key=groupKey(song,pack);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(song)}
 const groups=shuffle([...buckets.entries()].map(([key,items])=>({key,items})));
 const picked=[];
 while(picked.length<total&&groups.some(g=>g.items.length)){
  for(const group of groups){
   if(picked.length>=total)break;
   const song=group.items.shift();
   if(song)picked.push(song);
  }
 }
 return picked;
}
function buildQuiz(){
 stop();round=0;current=null;quizFinished=false;
 const allReady=songs.filter(s=>urls.has(s.id)&&validMarks(s).length);
 const cycleRestarted=allReady.length&&allReady.every(s=>playedHistory.has(s.id));
 if(cycleRestarted){playedHistory.clear();persistPlayed()}
 const target=Number($('questionCount').value||10), pack=packName(), pool=availableSongs(pack);
 quizQueue=balancedPick(pool,Math.min(target,pool.length),pack);
 $('round').textContent='第 0 / '+quizQueue.length+' 題';
 $('answer').textContent='比賽題庫已準備';
 $('segmentLabel').textContent=quizQueue.length?('已選 '+quizQueue.length+' 題'):'沒有可用題目';
 $('replay').disabled=$('reveal').disabled=true;
 $('draw').disabled=!quizQueue.length;
 if(!pool.length){$('status').textContent=playedHistory.size?'這個題庫包目前沒有未播放歌曲。可改選其他題庫，或按「重置全部播放紀錄」。':'這個題庫包沒有可播放歌曲，請先匯入音樂或載入設定。'}
 else if(pool.length<target){$('status').textContent='可用歌曲只有 '+pool.length+' 首，已全部排入且不重複。'}
 else if(cycleRestarted){$('status').textContent='所有可播放歌曲已完成一輪，播放紀錄已自動重置；按「下一題並播放」開始新一輪。'}
 else {$('status').textContent=['male','female','group'].includes(pack)?'單一歌手／團體機率最高 8%，超出比例已加到「其他」；按「下一題並播放」開始。':pack==='hiphop'?'已從完整嘻哈歌曲池隨機選題；按「下一題並播放」開始。':'已平均分配題目；按「下一題並播放」開始。'}
 counts();
}
function counts(){
 $('count').textContent=songs.length;
 const pool=availableSongs();
 const left=quizFinished?0:(quizQueue.length?quizQueue.length:pool.length);
 $('remaining').textContent=left+' 首可抽';
}
function render(){counts();$('songList').replaceChildren();$('empty').hidden=!!songs.length;for(const s of songs){const row=document.createElement('div');row.className='song';const info=document.createElement('div');info.className='info';const b=document.createElement('b');b.textContent=s.title;const p=document.createElement('p');p.textContent=(s.artist||'未填歌手')+' · '+(s.era||'未分類')+' · '+(s.kind||'未分類');const badge=document.createElement('span');badge.className='badge';badge.textContent=urls.has(s.id)?'● 已就緒':'○ 尚未儲存音樂';info.append(b,p,badge);if(s.analysis_status==='unverified_candidates'){const note=document.createElement('p');note.textContent='自動分析候選 · 待試聽確認';info.append(note)}const edit=document.createElement('button');edit.textContent='編輯';edit.onclick=()=>openEdit(s);const del=document.createElement('button');del.textContent='移除';del.className='danger';del.onclick=()=>{if(confirm('移除「'+s.title+'」的題庫與此瀏覽器內保存的音樂？')){stop();if(urls.has(s.id))URL.revokeObjectURL(urls.get(s.id));urls.delete(s.id);removeAudio(s.id);songs=songs.filter(x=>x.id!==s.id);quizQueue=quizQueue.filter(x=>x.id!==s.id);persist();render()}};const auto=document.createElement('button');auto.textContent='分析';auto.disabled=!urls.has(s.id);auto.onclick=()=>runAnalysis([s]);row.append(info,auto,edit,del);$('songList').append(row)}}
function folderCategories(path){
 const result={era:'',kind:'',sourceGroup:''};
 const eras={'華語經典':'華語經典','華語金曲':'華語經典','华语经典':'華語經典','華語新歌':'華語新歌','华语新歌':'華語新歌','華語流行':'華語流行','华语流行':'華語流行','台語':'台語歌','臺語':'台語歌','台语':'台語歌'};
 const kinds={'男歌手':'男歌手','女歌手':'女歌手','團體':'團體','团体':'團體','抖音神曲':'抖音神曲','嘻哈金曲':'嘻哈金曲','嘻哈':'嘻哈金曲','對唱組合':'對唱組合','对唱组合':'對唱組合','對唱':'對唱組合','对唱':'對唱組合'};
 const folders=path.split('/').slice(0,-1);
 for(const folder of folders){const compact=folder.replace(/\s/g,'');for(const [field,map] of [['era',eras],['kind',kinds]]){const matches=[...new Set(Object.entries(map).filter(([name])=>compact.includes(name)).map(([,value])=>value))];if(matches.length===1)result[field]=matches[0]}}
 if(['男歌手','女歌手','團體'].includes(result.kind)){const last=folders.at(-1)||'',compact=last.replace(/\s/g,'');const recognized=[...Object.keys(eras),...Object.keys(kinds)].some(name=>compact.includes(name));if(last&&!recognized)result.sourceGroup=last.trim()}
 return result;
}
async function importSongs(e){
 stop();quizQueue=[];let added=0,classified=0,unmatched=0;
 await requestDurableStorage();let saved=0,saveFailed=0;
 for(const f of e.target.files){
  if(!/\.(mp3|m4a|wav|ogg)$/i.test(f.name))continue;
  const id=f.name+'::'+f.size;
  if(urls.has(id))URL.revokeObjectURL(urls.get(id));
  urls.set(id,URL.createObjectURL(f));
  let song=songs.find(s=>s.id===id);
  if(!song){const raw=f.name.replace(/\.[^.]+$/,'');const parts=raw.split(/\s+-\s+/);song={id,file:f.name,title:parts.length>1?parts.slice(1).join(' - '):raw,artist:parts.length>1?parts[0]:'',era:'',kind:'',marks:{intro:0,verse:null,chorus:null},chorusSpoiler:false};songs.push(song)}
  const cats=folderCategories(f.webkitRelativePath||'');
  if(cats.era)song.era=cats.era;
  if(cats.kind)song.kind=cats.kind;
  if(cats.sourceGroup)song.sourceGroup=cats.sourceGroup;
  if(cats.era||cats.kind)classified++;else unmatched++;
  try{await saveAudio(id,f);saved++}catch{saveFailed++}
  added++;
 }
 persist();render();tab(true);e.target.value='';
 $('importStatus').textContent=added?'已匯入 '+added+' 首，其中 '+saved+' 首已儲存在此裝置，重開網頁會自動還原。'+(saveFailed?' 有 '+saveFailed+' 首因儲存空間不足未能保存。':'')+' '+classified+' 首已依資料夾分類。'+(unmatched?'另有 '+unmatched+' 首未辨識資料夾分類，已保留原設定（新歌為未分類）。':''): '資料夾內沒有支援的音樂檔，請選取 MP3／M4A／WAV／OGG。';
}
$('files').onchange=importSongs;$('folderFiles').onchange=importSongs;
$('importFolder').onclick=()=>{if(!('webkitdirectory' in $('folderFiles'))){$('importStatus').textContent='此瀏覽器不支援資料夾匯入，請使用電腦版 Chrome 或 Edge，或使用「匯入 MP3」。';return}$('folderFiles').click()};
function openEdit(s){stop();editing=s;$('title').value=s.title;$('artist').value=s.artist;$('editEra').value=s.era;$('editKind').value=s.kind;$('chorusSpoiler').checked=!!s.chorusSpoiler;$('editError').textContent='';$('preview').removeAttribute('src');if(urls.has(s.id))$('preview').src=urls.get(s.id);$('preview').load();$('marks').replaceChildren();for(const [k,v]of Object.entries(labels)){const row=document.createElement('div');row.className='mark';const lab=document.createElement('label');lab.textContent=v+'起點（秒）';const input=document.createElement('input');input.type='number';input.min='0';input.step='.1';input.id='mark-'+k;input.value=s.marks[k]??'';lab.append(input);const btn=document.createElement('button');btn.textContent='取目前時間';btn.disabled=!urls.has(s.id);btn.onclick=()=>input.value=$('preview').currentTime.toFixed(1);row.append(lab,btn);$('marks').append(row)}$('editor').showModal()}
$('editor').addEventListener('close',()=>$('preview').pause());
$('saveEdit').onclick=()=>{const marks={};for(const k of Object.keys(labels)){const v=$('mark-'+k).value;marks[k]=v===''?null:Number(v);if(v!==''&&(!Number.isFinite(marks[k])||marks[k]<0||(Number.isFinite($('preview').duration)&&marks[k]>=$('preview').duration))){$('editError').textContent='起點必須在歌曲長度內。';return}}if(!$('title').value.trim()){$('editError').textContent='請填寫歌名。';return}Object.assign(editing,{title:$('title').value.trim(),artist:$('artist').value.trim(),era:$('editEra').value,kind:$('editKind').value,marks,chorusSpoiler:$('chorusSpoiler').checked});persist();render();$('editor').close()};
function stop(){generation++;if(source){try{source.stop()}catch{}source=null}clearInterval(ticker);ticker=null}
async function play(){stop();const run=generation;if(!current)return;try{ctx??=new(window.AudioContext||window.webkitAudioContext)();await ctx.resume();$('status').textContent=(current.song.artist||'未填歌手')+' · 播放中';const data=await(await fetch(urls.get(current.song.id))).arrayBuffer();const buffer=await ctx.decodeAudioData(data);if(run!==generation)return;const start=current.song.marks[current.key];if(start>=buffer.duration)throw Error('這個段落起點超過歌曲長度，請到題庫修改。');const duration=Math.min(current.seconds,buffer.duration-start);source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);const begin=ctx.currentTime;source.start(0,start,duration);$('progress').style.width='0%';ticker=setInterval(()=>{$('progress').style.width=Math.min(100,(ctx.currentTime-begin)/duration*100)+'%'},40);source.onended=()=>{if(run===generation){clearInterval(ticker);$('progress').style.width='100%';$('status').textContent=quizFinished?'題庫已播放完畢，請另建題庫或按「重新組題」。':(current.song.artist||'未填歌手')+' · 片段播放完畢';if(quizFinished){$('segmentLabel').textContent='本題庫已播完';$('replay').disabled=true;$('draw').disabled=true}source=null}}}catch(e){if(run===generation)$('status').textContent=e.message.includes('起點')?e.message:'無法播放這個檔案，請確認格式，或重新匯入後再試。'}}
function buildQuizAndShowPlayer(){buildQuiz();if(quizQueue.length)$('playerStage').scrollIntoView({behavior:'smooth',block:'start'})}
$('prepareQuiz').onclick=buildQuizAndShowPlayer;
$('draw').onclick=()=>{if(quizFinished){$('status').textContent='題庫已播放完畢，請另建題庫或按「重新組題」。';return}if(!quizQueue.length)buildQuiz();if(!quizQueue.length)return;const song=quizQueue.shift(),ks=validMarks(song);current={song,key:ks[Math.floor(Math.random()*ks.length)],seconds:Number($('seconds').value)};used.add(song.id);playedHistory.add(song.id);persistPlayed();round++;quizFinished=!quizQueue.length;$('round').textContent='第 '+round+' / '+(round+quizQueue.length)+' 題';$('answer').textContent=song.title+' — '+(song.artist||'尚未填寫歌手');$('segmentLabel').textContent=labels[current.key]+' · '+current.seconds+' 秒'+(song.chorusSpoiler&&current.key!=='chorus'?' · 已避開副歌':'');$('replay').disabled=$('reveal').disabled=false;$('draw').disabled=quizFinished;counts();play()};
$('replay').onclick=play;$('stop').onclick=()=>{stop();$('status').textContent='已暫停，按「再聽一次」重播片段。'};$('reveal').onclick=()=>{if(current){$('answer').textContent=current.song.title+' — '+(current.song.artist||'尚未填寫歌手');$('status').textContent=current.song.artist||'尚未填寫歌手'}};
$('reset').onclick=buildQuizAndShowPlayer;for(const id of ['pack','questionCount','segment'])$(id).onchange=()=>{quizQueue=[];quizFinished=false;current=null;round=0;$('draw').disabled=false;$('round').textContent='第 0 回合';$('answer').textContent='選好題庫後開始比賽';$('status').textContent='按「建立比賽題庫」先排題，再開始播放。';$('replay').disabled=$('reveal').disabled=true;counts()};
$('resetHistory').onclick=()=>{if(!confirm('確定清除所有歌曲的播放紀錄？清除後，之前播過的歌曲會再次出現。'))return;stop();playedHistory.clear();persistPlayed();quizQueue=[];quizFinished=false;current=null;round=0;buildQuiz();$('status').textContent='全部播放紀錄已重置，所有歌曲都可以再次出題。'};
let teams=[{name:'第 1 隊',score:0},{name:'第 2 隊',score:0}];function renderTeams(){$('teams').replaceChildren();teams.forEach(t=>{const el=document.createElement('div');el.className='team';const n=document.createElement('input');n.value=t.name;n.setAttribute('aria-label','隊伍名稱');n.onchange=()=>t.name=n.value;const score=document.createElement('strong');score.textContent=t.score;for(const d of [-1,1]){const b=document.createElement('button');b.textContent=d===1?'＋':'−';b.setAttribute('aria-label',d===1?'加一分':'減一分');b.onclick=()=>{t.score+=d;score.textContent=t.score};if(d===-1)el.append(n,b,score);else el.append(b)}$('teams').append(el)})}$('addTeam').onclick=()=>{teams.push({name:'第 '+(teams.length+1)+' 隊',score:0});renderTeams()};
let exportUrl=null;
$('export').onclick=()=>{try{$('exportText').value=JSON.stringify({version:1,songs},null,2);$('exportCount').textContent='共 '+songs.length+' 首，包含歌名、分類、歌手與段落設定，不包含音樂檔。';$('exportMessage').textContent='按「下載 JSON 檔」儲存；若未出現下載，可改用「複製完整設定」。';$('exportDialog').showModal()}catch(err){alert('無法開啟匯出視窗：'+err.message)}};
$('downloadSettings').onclick=()=>{try{if(exportUrl)URL.revokeObjectURL(exportUrl);exportUrl=URL.createObjectURL(new Blob([$('exportText').value],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=exportUrl;a.download='song-settings.json';document.body.append(a);a.click();a.remove();$('exportMessage').textContent='已送出下載請求，請查看瀏覽器下載清單。若沒有檔案，請按「複製完整設定」。'}catch(err){$('exportMessage').textContent='下載無法啟動，請複製下方完整設定。'}};
$('copySettings').onclick=async()=>{try{await navigator.clipboard.writeText($('exportText').value);$('exportMessage').textContent='已複製完整設定，可貼到記事本並另存為 song-settings.json。'}catch{const box=$('exportText');box.focus();box.select();$('exportMessage').textContent='請按 Ctrl+C（手機請長按並複製），文字已全選。'}};
$('load').onclick=()=>$('settingsFile').click();
$('settingsFile').onchange=async e=>{
 try{
  const data=JSON.parse(await e.target.files[0].text());
  if(data.version!==1||!Array.isArray(data.songs))throw Error();
  const clean=data.songs.map(s=>{
   if(typeof s.id!=='string'||typeof s.title!=='string'||typeof s.file!=='string'||!s.marks)throw Error();
   const marks={};
   for(const k of Object.keys(labels)){const v=s.marks[k];if(v!==null&&(!Number.isFinite(v)||v<0))throw Error();marks[k]=v}
   return{id:s.id,file:s.file,title:s.title,artist:typeof s.artist==='string'?s.artist:'',era:['華語經典','華語流行','華語新歌','台語歌'].includes(s.era)?s.era:'',kind:['男歌手','女歌手','團體','抖音神曲','嘻哈金曲','對唱組合'].includes(s.kind)?s.kind:'',sourceGroup:typeof s.sourceGroup==='string'?s.sourceGroup:'',marks,chorusSpoiler:s.chorusSpoiler===true,analysis_status:s.analysis_status==='unverified_candidates'?'unverified_candidates':undefined}
  });
  stop();quizQueue=[];quizFinished=false;current=null;round=0;
  const nextIds=new Set(clean.map(s=>s.id));
  for(const [id,url] of urls){if(!nextIds.has(id)){URL.revokeObjectURL(url);urls.delete(id)}}
  songs=clean;
  playedHistory=new Set([...playedHistory].filter(id=>nextIds.has(id)));
  persist();persistPlayed();
  await restoreAudio();render();
  alert('題庫設定已完整更新，共載入 '+songs.length+' 首。手機內已保存的音樂會自動配對。');
 }catch{alert('設定檔格式不正確，請選取從本 App 匯出的 JSON。')}
 e.target.value='';
};
render();renderTeams();restoreAudio();
