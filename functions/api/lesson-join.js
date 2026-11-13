const json=(data,status=200)=>Response.json(data,{
 status,
 headers:{
  "Cache-Control":"no-store, no-cache, must-revalidate",
  "Pragma":"no-cache",
  "Referrer-Policy":"no-referrer"
 }
});
export async function onRequestGet(context){
 const code=new URL(context.request.url).searchParams.get("code")||"";
 if(!/^[a-f0-9]{64}$/.test(code))return json({success:false,message:"Ders bağlantısı geçersiz."},404);
 try{
  const row=await context.env.DB.prepare("SELECT course,title,status,room_name FROM lesson_sessions WHERE join_code=? LIMIT 1").bind(code).first();
  if(!row)return json({success:false,message:"Ders bağlantısı bulunamadı."},404);
  const status=["draft","live","finished"].includes(row.status)?row.status:"finished";
  return json({success:true,course:row.course,title:row.title,status,roomName:status==="live"?row.room_name:null});
 }catch(error){
  console.error("EDWISE public lesson lookup error",error);
  return json({success:false,message:"Ders bilgisi şu anda alınamıyor."},500);
 }
}
