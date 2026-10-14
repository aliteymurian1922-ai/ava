import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,resolve,sep} from 'node:path';
const root=resolve('public');
const port=Number(process.env.PORT||8787);
const key=process.env.GEMINI_API_KEY||'';
const model=process.env.GEMINI_TEXT_MODEL||'gemini-2.5-flash';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'};
const limits=new Map();
function json(res,code,value){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value))}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  if(url.pathname==='/api/health')return json(res,200,{ok:true,aiConfigured:!!key});

  if(url.pathname==='/api/tts'&&req.method==='POST'){
    if(!key)return json(res,503,{error:'کلید Gemini تنظیم نشده است.'});
    try{
      let raw='';for await(const c of req){raw+=c;if(raw.length>12000)return json(res,413,{error:'متن بیش از حد طولانی است.'})}
      const input=JSON.parse(raw);
      const text=String(input.text||'').replace(/[\\*#_`]/g,'').trim().slice(0,900);
      if(!text)return json(res,400,{error:'متن خالی است.'});
      const voice=String(input.voice||'Kore');
      const chosen=['Kore','Achernar','Aoede','Sulafat','Puck'].includes(voice)?voice:'Kore';
      const request=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
        method:'POST',
        headers:{'x-goog-api-key':key,'content-type':'application/json'},
        body:JSON.stringify({
          model:process.env.GEMINI_TTS_MODEL||'gemini-3.8-flash-tts',
          input:'این متن را به فارسی ایران، طبیعی، واضح، مؤدبانه و بدون خواندن نشانه‌های نگارشی بخوان: '+text,
          response_format:{type:'audio'},
          generation_config:{speech_config:[{voice:chosen,language:'fa-IR'}]}
        }),
        signal:AbortSignal.timeout(45000)
      });
      const data=await request.json().catch(()=>({}));
      if(!request.ok){
        console.error('[Gemini TTS]',JSON.stringify({status:request.status,reason:data?.error?.message?.slice(0,200)}));
        return json(res,502,{error:'تولید صدای فارسی فعلاً در دسترس نیست.',code:'TTS_'+request.status});
      }
      const output=data.output_audio||data.interaction?.output_audio;
      if(!output?.data)return json(res,502,{error:'خروجی صوتی از Gemini دریافت نشد.'});
      const pcm=Buffer.from(output.data,'base64');
      if(!pcm.length||pcm.length>7_000_000)return json(res,502,{error:'خروجی صدا نامعتبر است.'});
      const wav=Buffer.allocUnsafe(44+pcm.length);
      wav.write('RIFF',0);wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);
      wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
      wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);
      wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
      wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);
      res.writeHead(200,{'content-type':'audio/wav','content-length':wav.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end(wav);
    }catch(error){
      console.error('[TTS transport]',error?.name||'Error');
      json(res,502,{error:'ارتباط با موتور صدای فارسی برقرار نشد.'});
    }
    return;
  }
  if(url.pathname==='/api/chat'&&req.method==='POST'){
    const ip=req.socket.remoteAddress||'unknown';const now=Date.now();const old=limits.get(ip)||{time:now,count:0};const bucket=now-old.time>60000?{time:now,count:0}:old;bucket.count++;limits.set(ip,bucket);
    if(bucket.count>15)return json(res,429,{error:'درخواست‌های زیادی ارسال شده است.'});
    if(!key)return json(res,503,{error:'کلید Gemini هنوز روی Render ثبت نشده است.'});
    try{
      let data='';for await(const part of req){data+=part;if(data.length>24000)return json(res,413,{error:'درخواست بیش از حد بزرگ است.'})}
      const body=JSON.parse(data);const message=String(body.message||'').trim().slice(0,2500);
      if(!message)return json(res,400,{error:'پیام خالی است.'});
      const history=Array.isArray(body.history)?body.history.slice(-10).filter(x=>x&&typeof x.text==='string'&&['user','assistant'].includes(x.role)).map(x=>({role:x.role==='assistant'?'model':'user',parts:[{text:x.text.slice(0,2000)}]})):[];
      const requestUrl='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
      const requestOptions={method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({systemInstruction:{parts:[{text:'تو آوا هستی. دستیار فارسی محترم، کوتاه‌گو و حرفه‌ای برای دفتر مدیرعامل. بدون درخواست مستقیم کاربر هیچ‌وقت مکالمه را آغاز نکن. درباره اقدامات انجام نشده ادعایی نکن.'}]},contents:[...history,{role:'user',parts:[{text:message}]}],generationConfig:{maxOutputTokens:700,temperature:.5}}),signal:AbortSignal.timeout(22000)};
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
      const reply=(payload.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('').trim();
      return json(res,reply?200:502,reply?{reply}:{error:'پاسخ خالی دریافت شد.'});
    }catch(e){console.error('[Gemini transport]',e?.name||'Error',e?.message?.slice(0,180));return json(res,502,{error:'اتصال سرور به Gemini با خطا یا تأخیر مواجه شد.',code:'GEMINI_NETWORK'})}
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'Method not allowed'});
  let path;try{path=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}catch{return json(res,400,{error:'مسیر نامعتبر'})}
  const file=resolve(root,'.'+path);if(file!==root&&!file.startsWith(root+sep))return json(res,403,{error:'Forbidden'});
  try{const data=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':path==='/sw.js'?'no-cache':'public, max-age=300'});res.end(req.method==='HEAD'?undefined:data)}catch{json(res,404,{error:'Not found'})}
});
server.listen(port,'0.0.0.0',()=>console.log('AVA listening on '+port));