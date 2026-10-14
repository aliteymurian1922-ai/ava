const $=id=>document.getElementById(id);
const recClass=window.SpeechRecognition||window.webkitSpeechRecognition;
const options={wake:localStorage.getItem('ava_wake')||'آوا',lang:localStorage.getItem('ava_lang')||'fa-IR',speak:localStorage.getItem('ava_speak')!=='false',chime:localStorage.getItem('ava_chime')!=='false'};
let messages=JSON.parse(localStorage.getItem('ava_messages')||'[]'),ai=false,standby=false,mode='',recognition=null,restart=null,busy=false,spoken=false,pending='',intentional=false,installPrompt=null;
const norm=s=>String(s||'').replace(/[آأإٱا]/g,'ا').replace(/[يى]/g,'ی').toLowerCase().trim();
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),3900)}
function status(title,desc,visual=''){$('voiceTitle').textContent=title;$('voiceDesc').textContent=desc;$('status').textContent=title;$('orb').className='orb '+visual;$('indicator').style.background=standby?'#7cd9fa':'#67eab5'}
function idle(){if(standby)status('آماده‌به‌کار','منتظر شنیدن «'+options.wake+'» هستم');else status('آماده','برای فعال شدن، دکمه آماده‌باش را لمس کنید.')}
function persist(){localStorage.setItem('ava_messages',JSON.stringify(messages.slice(-150)))}
function render(){const root=$('chat');root.replaceChildren();if(!messages.length){const e=document.createElement('div');e.className='empty';e.textContent='هنوز گفتگویی شروع نشده.';root.append(e)}for(const m of messages.slice(-30)){const d=document.createElement('div');d.className='bubble '+m.role;d.textContent=m.text;root.append(d)}root.scrollTop=root.scrollHeight}
function append(role,text){messages.push({role,text});persist();render()}
let activeAudio=null,activeAudioUrl=null,voiceRequest=null,voiceToken=0;
function cancelVoice(){voiceToken++;if(voiceRequest){voiceRequest.abort();voiceRequest=null}if(activeAudio){activeAudio.pause();activeAudio.src='';activeAudio=null}if(activeAudioUrl){URL.revokeObjectURL(activeAudioUrl);activeAudioUrl=null}if('speechSynthesis'in window)speechSynthesis.cancel()}
function chime(){if(!options.chime)return;const C=window.AudioContext||window.webkitAudioContext;if(!C)return;try{const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=740;g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.06,c.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.20);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.21);o.onended=()=>c.close()}catch{}}
function stopRecognition(){clearTimeout(restart);intentional=true;const r=recognition;recognition=null;mode='';if(r)try{r.abort()}catch{}}
function resume(){clearTimeout(restart);if(!standby||busy||document.visibilityState!=='visible'||recognition||spoken)return;restart=setTimeout(()=>listen('standby'),700)}
async function respond(text){if(!options.speak){idle();resume();return}const token=++voiceToken;spoken=true;status('در حال ساخت صدای فارسی','لطفاً چند لحظه صبر کنید','think');const ctrl=new AbortController();voiceRequest=ctrl;
  try{const r=await fetch('/api/tts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,voice:'Kore'}),signal:ctrl.signal});
    if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'موتور گفتار فارسی در دسترس نیست.')}
    const blob=await r.blob();if(token!==voiceToken)return;
    const url=URL.createObjectURL(blob);activeAudioUrl=url;const audio=new Audio(url);activeAudio=audio;
    audio.onplay=()=>status('در حال صحبت','آوا با صدای فارسی پاسخ می‌دهد','speak');
    const finish=()=>{if(token!==voiceToken)return;spoken=false;activeAudio=null;URL.revokeObjectURL(url);activeAudioUrl=null;idle();resume()};
    audio.onended=finish;audio.onerror=()=>{toast('پخش صدای فارسی روی این دستگاه ممکن نشد.');finish()};
    await audio.play();
  }catch(e){if(token===voiceToken&&e.name!=='AbortError'){toast(e.message);spoken=false;idle();resume()}}
  finally{if(voiceRequest===ctrl)voiceRequest=null}
}
async function send(text){text=String(text||'').trim();if(!text||busy)return;busy=true;clearTimeout(restart);cancelVoice();const history=messages.slice(-10);append('user',text);$('input').value='';status('در حال بررسی','در صورت نیاز منابع آنلاین را جست‌وجو می‌کنم','think');try{let reply;if(ai){const r=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,history,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Tehran'})});const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{throw Error('سرور پاسخ معتبر برنگرداند (HTTP '+r.status+'). وضعیت Render یا شبکه را بررسی کن.')}if(!r.ok)throw Error(data.error||'خطای سرور (HTTP '+r.status+')');if(typeof data.reply!=='string')throw Error('پاسخ هوش مصنوعی ناقص بود.');reply=data.reply;if(data.searched){status('جست‌وجو انجام شد','در حال جمع‌بندی منابع','think');if(Array.isArray(data.sources)&&data.sources.length){reply+='\n\nمنابع:\n'+data.sources.slice(0,3).map(x=>x.title+' — '+x.url).join('\n')}}}else{reply='این نسخه در حالت آزمایشی اجرا می‌شود. برای پاسخ هوشمند، کلید Gemini باید روی Render ثبت شود.'}append('assistant',reply);busy=false;respond(reply.split('\n\nمنابع:\n')[0])}catch(e){busy=false;toast(e.message);idle();resume()}}
function wakeMatch(s){const original=String(s||'').trim(),w=options.wake.trim();if(!w)return null;const index=original.lastIndexOf(w);if(index>=0)return original.slice(index+w.length).replace(/^[\s،,:.!؟?-]+/,'').trim();if(norm(original)===norm(w))return '';return null}
function listen(next){if(!recClass){toast('مرورگر شما تشخیص گفتار وب را پشتیبانی نمی‌کند.');standby=false;refresh();return}if(document.visibilityState!=='visible')return;if(recognition)return;intentional=false;mode=next;let text='',fired=false;const r=new recClass();recognition=r;r.lang=options.lang;r.interimResults=true;r.continuous=next==='standby';r.onstart=()=>{if(next==='standby')status('آماده‌به‌کار','منتظر شنیدن «'+options.wake+'» هستم');else status('دارم گوش می‌دم','دستور خود را بگویید','listen')};r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;const said=e.results[i][0].transcript.trim();if(next==='standby'){const cmd=wakeMatch(said);if(cmd!==null){fired=true;pending=cmd;chime();try{r.stop()}catch{};break}}else text+=' '+said}};r.onerror=e=>{if(!['no-speech','aborted'].includes(e.error)){toast('میکروفون: '+e.error);if(['not-allowed','service-not-allowed'].includes(e.error)){standby=false;refresh()}}};r.onend=()=>{if(recognition!==r)return;recognition=null;mode='';if(intentional)return;if(next==='standby'&&fired){const cmd=pending;pending='';if(cmd)send(cmd);else{status('بله؟','دستور خود را بگویید','listen');setTimeout(()=>listen('command'),250)}return}if(next!=='standby'&&text.trim()){send(text.trim());return}idle();resume()};try{r.start()}catch(e){recognition=null;toast('میکروفون فعال نشد. HTTPS یا مجوز دستگاه را بررسی کنید.');idle()}}
function refresh(){$('standby').textContent=standby?'توقف حالت آماده‌باش':'فعال‌کردن آماده‌باش';$('standby').classList.toggle('on',standby);idle()}
$('standby').onclick=()=>{if(standby){standby=false;stopRecognition();refresh()}else{standby=true;refresh();listen('standby')}};
$('mic').onclick=()=>{if(busy)return;if(recognition){stopRecognition();idle();resume()}else{cancelVoice();listen('command')}};
$('stop').onclick=()=>{standby=false;stopRecognition();cancelVoice();refresh()};
$('form').onsubmit=e=>{e.preventDefault();send($('input').value)};
$('clear').onclick=()=>{if(confirm('تاریخچه حذف شود؟')){messages=[];persist();render()}};
$('wake').value=options.wake;$('lang').value=options.lang;$('speak').checked=options.speak;$('chime').checked=options.chime;
$('wake').onchange=e=>{options.wake=e.target.value.trim()||'آوا';localStorage.setItem('ava_wake',options.wake);if(standby){stopRecognition();resume()}idle()};
$('lang').onchange=e=>{options.lang=e.target.value;localStorage.setItem('ava_lang',options.lang);if(standby){stopRecognition();resume()}};
$('speak').onchange=e=>{options.speak=e.target.checked;localStorage.setItem('ava_speak',String(options.speak));if(!options.speak)cancelVoice()};
$('chime').onchange=e=>{options.chime=e.target.checked;localStorage.setItem('ava_chime',String(options.chime))};
$('full').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>toast('تمام‌صفحه در دسترس نیست'));else toast('این مرورگر تمام‌صفحه را پشتیبانی نمی‌کند')};
document.addEventListener('fullscreenchange',()=>document.body.classList.toggle('full',!!document.fullscreenElement));
$('settingsToggle').onclick=()=>$('settings').scrollIntoView({behavior:'smooth'});
window.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'){stopRecognition();cancelVoice()}else resume()});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e});
$('install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null}else if(/iPhone|iPad|iPod/.test(navigator.userAgent))toast('در Safari گزینه Share سپس Add to Home Screen را بزن');else toast('از منوی مرورگر گزینه Install App را بزن')};
$('platform').textContent=/iPhone|iPad|iPod/.test(navigator.userAgent)?'دستگاه iOS شناسایی شد':/Android/.test(navigator.userAgent)?'دستگاه Android شناسایی شد':'نسخه دسکتاپ شناسایی شد';
fetch('/api/health',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('health '+r.status);return r.json()}).then(d=>{ai=!!d.aiConfigured;$('ai').textContent=ai?'Gemini آماده':'حالت آزمایشی'}).catch(()=>$('ai').textContent='سرور آفلاین');
if('serviceWorker'in navigator&&isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
render();refresh();