import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
const root=resolve('public');
const port=Number(process.env.PORT||8787);
const key=process.env.GEMINI_API_KEY||'';
const model=process.env.GEMINI_TEXT_MODEL||'gemini-2.5-flash';
const routerKey=process.env.NINEROUTER_API_KEY||'';
const routerModel=process.env.NINEROUTER_MODEL||'';
const routerBase=process.env.NINEROUTER_BASE_URL||'https://9router.com/v1';
const routerReady=!!(routerKey&&routerModel);
const netarzKey=process.env.NETARZ_API_KEY||'';
const netarzModel=process.env.NETARZ_MODEL||'gemini-3.8-flash';
const netarzBase=process.env.NETARZ_BASE_URL||'https://netarz.ir/api/ai/v1';
const netarzReady=!!netarzKey;
const groqKey=process.env.GROQ_API_KEY||'';
const groqModel=process.env.GROQ_STT_MODEL||'whisper-large-v3-turbo';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'};
const limits=new Map();
function json(res,code,value){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))}

function clockContext(zone='Asia/Tehran'){
  try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format()}catch{zone='Asia/Tehran'}
  const now=new Date();
  const opts={timeZone:zone};
  const gregorian=new Intl.DateTimeFormat('fa-IR',{...opts,calendar:'gregory',weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(now);
  const shamsi=new Intl.DateTimeFormat('fa-IR',{...opts,calendar:'persian',weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(now);
  const clock=new Intl.DateTimeFormat('fa-IR',{...opts,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  return {zone,clock,shamsi,gregorian,iso:now.toISOString()};
}
function dateTimeAnswer(message,clock){
  const q=String(message||'').replace(/[آأإا]/g,'ا').trim();
  if(/(ساعت چند|چه ساعتیه|الان ساعت|ساعت الان)/.test(q))return 'الان ساعت '+clock.clock+' به وقت '+(clock.zone==='Asia/Tehran'?'ایران':clock.zone)+' است.';
  if(/(امروز چه روز|امروز چندم|تاریخ امروز|الان چه تاریخ|امروز تاریخ)/.test(q))return 'امروز '+clock.shamsi+' است. تاریخ میلادی هم '+clock.gregorian+' است.';
  return null;
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  if(url.pathname==='/api/health')return json(res,200,{ok:true,aiConfigured:!!(key||routerReady||netarzReady),routerConfigured:routerReady||netarzReady,netarzConfigured:netarzReady,sttConfigured:!!(groqKey||netarzReady||key),sttProvider:groqKey?'groq':netarzReady?'netarz-whisper':key?'gemini':'unconfigured'});
  if(url.pathname==='/api/stt'&&req.method==='POST'&&groqKey){
    if(!groqKey&&!key)return json(res,503,{error:'برای تشخیص صدا، GEMINI_API_KEY یا GROQ_API_KEY را روی سرور تنظیم کنید.',code:'NO_STT_KEY'});
    try{const type=req.headers['content-type']||'';if(!type.toLowerCase().startsWith('audio/'))return json(res,415,{error:'فایل صوتی معتبر دریافت نشد.'});const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000000)return json(res,413,{error:'فایل صوتی بیش از حد بزرگ است.'});chunks.push(chunk)}const audio=Buffer.concat(chunks);if(!audio.length)return json(res,400,{error:'فایل صوتی خالی است.'});const form=new FormData();form.append('file',new Blob([audio],{type:type.split(';')[0]}),'ava-recording.webm');form.append('model',groqModel);form.append('language','fa');form.append('response_format','json');const upstream=await fetch('https://api.groq.com/openai/v1/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+groqKey},body:form,signal:AbortSignal.timeout(45000)});const payload=await upstream.json().catch(()=>({}));if(!upstream.ok)return json(res,502,{error:'تشخیص گفتار فارسی ناموفق بود.',code:'STT_UPSTREAM_'+upstream.status});return json(res,200,{text:typeof payload.text==='string'?payload.text.trim():'',provider:'groq',model:groqModel})}catch(error){console.error('[STT]',error?.name||'Error',String(error?.message||'').slice(0,180));return json(res,502,{error:error?.name==='TimeoutError'?'تشخیص صدا بیش از حد طول کشید.':'ارتباط با سرویس تشخیص گفتار برقرار نشد.',code:'STT_NETWORK'})}
  }

    if(url.pathname==='/api/stt'&&req.method==='POST'&&!groqKey&&!netarzKey&&key){
    try{const type=req.headers['content-type']||'';if(!type.toLowerCase().startsWith('audio/'))return json(res,415,{error:'فایل صوتی معتبر دریافت نشد.'});const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12000000)return json(res,413,{error:'فایل صوتی بیش از حد بزرگ است.'});chunks.push(chunk)}const audio=Buffer.concat(chunks);if(!audio.length)return json(res,400,{error:'فایل صوتی خالی است.'});const modelName=process.env.GEMINI_STT_MODEL||model;const upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(modelName)+':generateContent',{method:'POST',headers:{'x-goog-api-key':key,'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:'این فایل صوتی را دقیقاً به فارسی ایران پیاده‌سازی کن. فقط متن گفته‌شده را برگردان و هیچ توضیحی اضافه نکن.'},{inline_data:{mime_type:type.split(';')[0],data:audio.toString('base64')}}]}],generationConfig:{temperature:0}}),signal:AbortSignal.timeout(45000)});const payload=await upstream.json().catch(()=>({}));if(!upstream.ok)return json(res,502,{error:'تشخیص گفتار با Gemini ناموفق بود.',code:'STT_GEMINI_'+upstream.status});const text=(payload.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('').trim();return json(res,200,{text,provider:'gemini',model:modelName})}catch(error){console.error('[Gemini STT]',error?.name||'Error',String(error?.message||'').slice(0,180));return json(res,502,{error:error?.name==='TimeoutError'?'تشخیص صدا بیش از حد طول کشید.':'ارتباط با Gemini برقرار نشد.',code:'STT_GEMINI_NETWORK'})}
  }

    if(url.pathname==='/api/stt'&&req.method==='POST'&&!groqKey&&netarzKey){
    try{const type=req.headers['content-type']||'';if(!type.toLowerCase().startsWith('audio/'))return json(res,415,{error:'فایل صوتی معتبر دریافت نشد.'});const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>25000000)return json(res,413,{error:'فایل صوتی بیش از حد بزرگ است.'});chunks.push(chunk)}const audio=Buffer.concat(chunks);if(!audio.length)return json(res,400,{error:'فایل صوتی خالی است.'});const form=new FormData();form.append('file',new Blob([audio],{type:type.split(';')[0]}),'ava-recording.webm');form.append('model',process.env.NETARZ_STT_MODEL||'whisper-1');form.append('language','fa');form.append('response_format','json');const upstream=await fetch(netarzBase.replace(/\/$/,'')+'/audio/transcriptions',{method:'POST',headers:{authorization:'Bearer '+netarzKey},body:form,signal:AbortSignal.timeout(45000)});const payload=await upstream.json().catch(()=>({}));if(!upstream.ok)return json(res,502,{error:'تشخیص گفتار فارسی با NetArz ناموفق بود.',code:'STT_NETARZ_'+upstream.status});return json(res,200,{text:typeof payload.text==='string'?payload.text.trim():typeof payload==='string'?payload.trim():'',provider:'netarz-whisper',model:process.env.NETARZ_STT_MODEL||'whisper-1'})}catch(error){console.error('[NetArz STT]',error?.name||'Error',String(error?.message||'').slice(0,180));return json(res,502,{error:error?.name==='TimeoutError'?'تشخیص صدا بیش از حد طول کشید.':'ارتباط با تشخیص گفتار NetArz برقرار نشد.',code:'STT_NETARZ_NETWORK'})}
  }

  if(url.pathname==='/api/tts'&&req.method==='POST'){
    if(netarzKey){
      try{
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>14000)return json(res,413,{error:'متن بیش از حد طولانی است.'})}
        const input=JSON.parse(raw);const spokenText=String(input.text||'').replace(/[\\*#_`]/g,'').trim().slice(0,3000);
        if(!spokenText)return json(res,400,{error:'متنی برای خواندن دریافت نشد.'});
        const upstream=await fetch(netarzBase.replace(/\/$/,'')+'/audio/speech',{method:'POST',headers:{authorization:'Bearer '+netarzKey,'content-type':'application/json'},body:JSON.stringify({model:process.env.NETARZ_TTS_MODEL||'gpt-4o-mini-tts',voice:'nova',input:spokenText,response_format:'mp3',instructions:'با لهجه طبیعی فارسی ایران، گرم و واضح صحبت کن.'}),signal:AbortSignal.timeout(45000)});
        const audio=Buffer.from(await upstream.arrayBuffer());
        if(!upstream.ok)return json(res,502,{error:'تولید صدای فارسی با NetArz ناموفق بود.',code:'TTS_NETARZ_'+upstream.status});
        res.writeHead(200,{'content-type':upstream.headers.get('content-type')||'audio/mpeg','content-length':audio.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(audio);return;
      }catch(error){console.error('[NetArz TTS]',error?.name||'Error',String(error?.message||'').slice(0,180));return json(res,502,{error:error?.name==='TimeoutError'?'تولید صدا بیش از حد طول کشید.':'ارتباط با موتور صدای NetArz برقرار نشد.',code:'TTS_NETARZ_NETWORK'})}
    }
    if(!key)return json(res,503,{error:'کلید Gemini روی سرور تنظیم نشده است.',code:'NO_KEY'});
    try{
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>14000)return json(res,413,{error:'متن بیش از حد طولانی است.'})}
      const input=JSON.parse(raw);
      const spokenText=String(input.text||'').replace(/[\\*#_`]/g,'').trim().slice(0,900);
      if(!spokenText)return json(res,400,{error:'متنی برای خواندن دریافت نشد.'});
      const requestedVoice=String(input.voice||'Kore');
      const voice=['Kore','Achernar','Aoede','Sulafat','Puck'].includes(requestedVoice)?requestedVoice:'Kore';
      const ttsModel=process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-lite-tts';
      const abort=AbortSignal.timeout(40000);
      const requestBody={
        model:ttsModel,
        input:[{type:'user_input',content:[{type:'text',text:spokenText,annotations:[{type:'speech_metadata',style:'با لهجه طبیعی فارسی ایران، مؤدبانه و گرم، با تلفظ واضح بخوان.'}]}]}],
        response_format:{type:'audio',mime_type:'audio/wav'},
        generation_config:{speech_config:[{voice}]}
      };
      const response=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
        method:'POST',
        headers:{'x-goog-api-key':key,'content-type':'application/json'},
        body:JSON.stringify(requestBody),
        signal:abort
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){
        console.error('[Gemini TTS]',JSON.stringify({status:response.status,model:ttsModel,reason:String(payload.error?.message||payload.error?.status||'unknown').slice(0,280)}));
        const message=response.status===429?'سهمیه تولید صدای فارسی پر شده است.':response.status===503?'سرور تولید صدا موقتاً شلوغ است.':response.status===404?'مدل تولید صدای فارسی در دسترس نیست.':'موتور صدای فارسی پاسخ نداد.';
        return json(res,502,{error:message,code:'TTS_'+response.status});
      }
      const audioPart=payload.output_audio||
        payload.steps?.flatMap(step=>step.content||[]).filter(c=>c.type==='audio').at(-1)||
        payload.interaction?.output_audio;
      const base64=audioPart?.data;
      if(typeof base64!=='string'||!base64.length){
        console.error('[Gemini TTS missing audio]',JSON.stringify({keys:Object.keys(payload),steps:payload.steps?.length||0}));
        return json(res,502,{error:'موتور صوتی پاسخی برگرداند اما فایل صدا داخل آن نبود.',code:'TTS_EMPTY'});
      }
      const wav=Buffer.from(base64,'base64');
      if(wav.length<44||wav.toString('ascii',0,4)!=='RIFF'||wav.length>12_000_000){
        console.error('[Gemini TTS invalid audio]',JSON.stringify({bytes:wav.length,header:wav.subarray(0,4).toString('ascii')}));
        return json(res,502,{error:'فرمت صدای تولیدشده معتبر نبود.',code:'TTS_FORMAT'});
      }
      res.writeHead(200,{'content-type':'audio/wav','content-length':wav.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end(wav);
    }catch(error){
      console.error('[Gemini TTS transport]',error?.name||'Error',String(error?.message||'').slice(0,180));
      return json(res,502,{error:error?.name==='TimeoutError'?'تولید صدا بیش از حد طول کشید. لطفاً دوباره امتحان کن.':'ارتباط با موتور صدای فارسی برقرار نشد.',code:'TTS_NETWORK'});
    }
    return;
  }
  if(url.pathname==='/api/chat'&&req.method==='POST'){
    const ip=req.socket.remoteAddress||'unknown';const now=Date.now();const old=limits.get(ip)||{time:now,count:0};const bucket=now-old.time>60000?{time:now,count:0}:old;bucket.count++;limits.set(ip,bucket);
    if(bucket.count>15)return json(res,429,{error:'درخواست‌های زیادی ارسال شده است.'});
    if(!key&&!routerReady&&!netarzReady)return json(res,503,{error:'هیچ سرویس هوش مصنوعی روی Render تنظیم نشده است.'});
    try{
      let data='';for await(const part of req){data+=part;if(data.length>24000)return json(res,413,{error:'درخواست بیش از حد بزرگ است.'})}
      const body=JSON.parse(data);const message=String(body.message||'').trim().slice(0,2500);
      if(!message)return json(res,400,{error:'پیام خالی است.'});
      const clock=clockContext(typeof body.timeZone==='string'&&body.timeZone.length<=80?body.timeZone:'Asia/Tehran');
      const exact=dateTimeAnswer(message,clock);
      if(exact)return json(res,200,{reply:exact,source:'device_clock'});
      const history=Array.isArray(body.history)?body.history.slice(-10).filter(x=>x&&typeof x.text==='string'&&['user','assistant'].includes(x.role)).map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.text.slice(0,2000)}]})):[];
      if(routerReady||netarzReady){
        try{
          const useNetarz=netarzReady&&!routerReady;
          const endpoint=new URL((useNetarz?netarzBase:routerBase).replace(/\/$/,'')+'/chat/completions');
          const allowed=useNetarz?['netarz.ir']:['9router.com','api.9router.com'];
          if(endpoint.protocol!=='https:'||!allowed.includes(endpoint.hostname))throw Error('Router endpoint must be a trusted HTTPS host');
          const instruction='تو آوا، دستیار فارسی دفتر مدیرعامل هستی. محترم و کوتاه پاسخ بده. زمان فعلی: '+clock.clock+'، تاریخ شمسی: '+clock.shamsi+'، تاریخ میلادی: '+clock.gregorian+'، منطقه زمانی: '+clock.zone+'. اگر اطلاعات روز یا جست‌وجوی اینترنت لازم بود و ابزار متصل نداری، روشن بگو به اطلاعات زنده دسترسی نداری. ادعای جست‌وجوی انجام‌نشده نکن.';
          const chatMessages=[{role:'system',content:instruction},...history.map(x=>({role:x.role==='model'?'assistant':'user',content:x.parts[0].text})),{role:'user',content:message}];
          const rr=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+(useNetarz?netarzKey:routerKey)},body:JSON.stringify({model:useNetarz?netarzModel:routerModel,messages:chatMessages,max_tokens:750,temperature:0.4}),signal:AbortSignal.timeout(26000)});
          const rd=await rr.json().catch(()=>({}));
          const answer=rd.choices?.[0]?.message?.content;
          if(!rr.ok||typeof answer!=='string'||!answer.trim())throw Error('Router HTTP '+rr.status);
          return json(res,200,{reply:answer.trim(),provider:useNetarz?'netarz':'9router',searched:false,sources:[]});
        }catch(e){
          console.error('[9Router fallback]',String(e.message||'connection failed').slice(0,100));
          if(!key)return json(res,502,{error:useNetarz?'ارتباط NetArz برقرار نشد؛ مدل یا کلید را در Render بررسی کن.':'ارتباط 9Router برقرار نشد؛ مدل، کلید و آدرس اتصال را در Render بررسی کن.',code:'ROUTER_FAILED'});
        }
      }
      const requestUrl='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
      const requestOptions={method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({systemInstruction:{parts:[{text:'تو آوا هستی. دستیار فارسی محترم، کوتاه‌گو و حرفه‌ای برای دفتر مدیرعامل. بدون درخواست مستقیم کاربر هیچ‌وقت مکالمه را آغاز نکن. درباره اقدامات انجام نشده ادعایی نکن. اکنون ساعت '+clock.clock+' و تاریخ شمسی '+clock.shamsi+' و میلادی '+clock.gregorian+' است. منطقه زمانی '+clock.zone+' است. برای پرسش‌های زمان و تاریخ فقط از این اطلاعات استفاده کن و اگر زمان در آینده یا اطلاعات آنلاین لازم بود، بدون منبع حدس نزن. برای اطلاعات روز، قیمت‌ها، اخبار، اطلاعات نامطمئن و سؤال‌هایی که دانش کافی نداری از ابزار Google Search استفاده کن. اگر از سرچ استفاده کردی ابتدا در پاسخ نهایی بگو «بررسی کردم:» و سپس پاسخ مستند و کوتاه بده. اگر سرچ ناموفق بود یا شواهد کافی نبود، صادقانه بگو نتوانستم تأیید کنم. هیچ‌وقت وانمود نکن سرچ انجام شده اگر ابزار استفاده نشده. اطلاعات محرمانه دفتر یا کاربران را در جستجو فاش نکن.'}]},contents:[...history,{role:'user',parts:[{text:message}]}],generationConfig:{maxOutputTokens:800,temperature:.4},tools:[{google_search:{}}]}),signal:AbortSignal.timeout(22000)};
      let r;for(let attempt=0;attempt<3;attempt++){
        r=await fetch(requestUrl,requestOptions);
        if(![429,500,502,503,504].includes(r.status)||attempt===2)break;
        const retryHeader=Number(r.headers.get('retry-after'));
        const waitMs=Number.isFinite(retryHeader)&&retryHeader>0?Math.min(retryHeader*1000,4500):700*Math.pow(2,attempt)+Math.floor(Math.random()*350);
        console.warn('[Gemini retry]',JSON.stringify({status:r.status,attempt:attempt+1,delayMs:waitMs}));
        await r.body?.cancel().catch(()=>{});
        await new Promise(resolve=>setTimeout(resolve,waitMs));
      }
      const rawUpstream=await r.text();let payload;try{payload=JSON.parse(rawUpstream)}catch{console.error('[Gemini invalid JSON]',JSON.stringify({httpStatus:r.status,contentType:r.headers.get('content-type'),bodyPreview:rawUpstream.slice(0,130)}));return json(res,502,{error:'سرویس Gemini پاسخ غیرمنتظره برگرداند. اتصال شبکه یا دسترسی سرویس را بررسی کن.',code:'GEMINI_INVALID_RESPONSE'})}if(!r.ok){
        const code=String(payload?.error?.status||'UPSTREAM_ERROR');
        const descriptions={
          API_KEY_INVALID:'کلید Gemini نامعتبر است یا فعال نشده. در Google AI Studio وضعیت کلید را بررسی کن.',
          PERMISSION_DENIED:'دسترسی Gemini مجاز نیست. محدودیت‌های کلید، منطقه یا پروژه Google Cloud را بررسی کن.',
          RESOURCE_EXHAUSTED:'سهمیه یا اعتبار Gemini تمام شده یا محدودیت درخواست فعال شده است.',
          NOT_FOUND:'مدل Gemini انتخاب‌شده برای این کلید در دسترس نیست.',
          FAILED_PRECONDITION:'پروژه Gemini به تنظیمات بیشتر یا فعال‌سازی صورتحساب نیاز دارد.',
          UNAUTHENTICATED:'احراز هویت Gemini ناموفق بود. کلید API را بررسی کن.'
        };
        const reason= r.status===429?'محدودیت تعداد درخواست یا سهمیه Gemini فعال شده است.':
          r.status===404?descriptions.NOT_FOUND:
          r.status===401?descriptions.UNAUTHENTICATED:
          r.status===403?descriptions.PERMISSION_DENIED:
          r.status===503?'سرویس Gemini موقتاً شلوغ است. آوا چند بار تلاش کرد؛ لطفاً چند لحظه بعد دوباره امتحان کن.':
          r.status===400?descriptions.API_KEY_INVALID:
          descriptions[code]||'ارتباط Gemini ناموفق بود. وضعیت سرویس و کلید را بررسی کن.';
        console.error('[Gemini upstream]',JSON.stringify({httpStatus:r.status,code,model,reason:payload?.error?.message?.slice(0,300)}));
        return json(res,502,{error:reason,code:'GEMINI_'+r.status});
      }
      const candidate=payload.candidates?.[0]||{};
      const reply=(candidate.content?.parts||[]).map(x=>x.text||'').join('').trim();
      const metadata=candidate.groundingMetadata||{};
      const searched=!!(metadata.webSearchQueries?.length||metadata.groundingChunks?.length);
      const sources=(metadata.groundingChunks||[]).map(x=>x.web).filter(x=>x&&typeof x.uri==='string'&&/^https:\/\//.test(x.uri)).slice(0,5).map(x=>({title:String(x.title||'منبع وب').slice(0,120),url:x.uri}));
      return json(res,reply?200:502,reply?{reply,searched,sources}:{error:'پاسخ خالی دریافت شد.'});
    }catch(e){console.error('[Gemini transport]',e?.name||'Error',e?.message?.slice(0,180));return json(res,502,{error:'اتصال سرور به Gemini با خطا یا تأخیر مواجه شد.',code:'GEMINI_NETWORK'})}
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
  let path;try{path=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}catch{return json(res,400,{error:'مسیر نامعتبر'})}
  const file=resolve(root,'.'+path);if(file!==root&&!file.startsWith(root+sep))return json(res,403,{error:'Forbidden'});
  try{const data=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':path==='/sw.js'?'no-cache':'public, max-age=300'});res.end(req.method==='HEAD'?undefined:data)}catch{json(res,404,{error:'Not found'})}
});
server.listen(port,'0.0.0.0',()=>console.log('AVA listening on '+port));
