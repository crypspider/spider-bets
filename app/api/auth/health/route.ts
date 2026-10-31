import { createClient } from '@supabase/supabase-js';
export async function GET(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.SUPABASE_ANON_KEY;
 if(!url||!key)return Response.json({configured:false},{status:503});
 try{const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await client.auth.getSession();return Response.json({configured:true,reachable:!error,session:!!data.session},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({configured:true,reachable:false},{status:502})}
}
