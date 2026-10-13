import { createClient } from 'npm:@supabase/supabase-js@2.104.1';
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false}});
Deno.serve(async (req: Request) => {
  const origin=req.headers.get('origin')||'';
  const allowed=(Deno.env.get('CLOCK_ALLOWED_ORIGINS')||'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s=>s.trim());
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':allowed.includes(origin)?origin:allowed[0],'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!allowed.includes(origin))return reply({error:'Origin not allowed'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply({error:'POST required'},405);
  try {
    const raw=await req.text();if(raw.length>4096)return reply({error:'Request too large'},413);
    const input=JSON.parse(raw);
    if(!['state','enroll','punch','forget'].includes(input.action)||!/^([a-f0-9]{48})$/.test(input.tag||''))return reply({error:'Invalid clock request'},400);
    if(input.action==='enroll'&&!/^[a-fA-F0-9]{10}$/.test(input.code||''))return reply({error:'Enter the 10-character enrollment code'},400);
    if(input.action==='punch'&&(!['clock_in','break_start','break_end','clock_out'].includes(input.event_type)||!/^[\da-f-]{36}$/i.test(input.request_id||'')))return reply({error:'Invalid clock action'},400);
    // The key is selected by the gateway, never supplied in the request body.
    const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.tag+':'+ip));
    const client_key=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
    const {data,error}=await supabase.rpc('rt_clock',{action:input.action,p:{tag:input.tag,token:input.token,code:input.code,event_type:input.event_type,request_id:input.request_id,latitude:input.latitude,longitude:input.longitude,accuracy:input.accuracy,captured_at:input.captured_at,client_key}});
    if(error){console.error('clock_rpc_failure',{code:error.code});return reply({error:'Clock request failed. Retry or contact your manager.'},400);}
    return reply(data,data?.error?400:200);
  }catch{return reply({error:'Invalid clock request'},400);}
});
