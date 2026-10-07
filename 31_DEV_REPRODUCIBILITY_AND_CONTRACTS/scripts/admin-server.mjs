import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const html=fs.readFileSync(path.join(here,'../ui/index.html'));
const server=http.createServer((req,res)=>{
  if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({status:'ok',mode:'synthetic-local'}));}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html);
});
const port=Number(process.env.PORT||4173);
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic admin surface: http://127.0.0.1:${port}`));
