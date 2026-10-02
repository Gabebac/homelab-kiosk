async function main(){
const fs = await import('node:fs');
const http = await import('node:http');
const crypto = await import('node:crypto');
const token = fs.readFileSync('/tok/token_probe','utf8').trim();
// 1: get WS ticket
const r = await fetch('http://hermes-next-pilot:9119/api/auth/ws-ticket', {
  method:'POST', headers:{'Authorization':'Bearer '+token, 'Origin':'http://hermes-next-pilot:9119'}});
const {ticket} = await r.json();
// 2: WS upgrade with ?ticket=
const key = crypto.randomBytes(16).toString('base64');
const req = http.request({host:'hermes-next-pilot', port:9119, path:'/api/ws?ticket='+encodeURIComponent(ticket), headers:{
  'Connection':'Upgrade','Upgrade':'websocket','Sec-WebSocket-Key':key,'Sec-WebSocket-Version':'13'}});
let buf = Buffer.alloc(0);
req.on('upgrade', (res, socket) => {
  console.log('UPGRADED');
  socket.on('data', b=>{
    buf = Buffer.concat([buf,b]);
    // naive unmask parse: server frames are unmasked
    // print raw text
    console.log('FRAME', b.toString('utf8').replace(/[^\x20-\x7e\n]/g, '.').slice(0,600));
  });
  const payload = Buffer.from(JSON.stringify({jsonrpc:'2.0', id:1, method:'session.list', params:{}}));
  // client frames MUST be masked
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(payload.map((byte,i)=>byte^mask[i%4]));
  const len = payload.length;
  let hdr;
  if (len<126) hdr = Buffer.from([0x81, 0x80|len]);
  else hdr = Buffer.from([0x81, 0x80|126, len>>8, len&0xff]);
  socket.write(Buffer.concat([hdr, mask, masked]));
  setTimeout(()=>process.exit(0), 6000);
});
req.on('response', r=>console.log('RESP', r.statusCode));
req.on('error', e=>console.log('ERR', e.message));
req.end();
setTimeout(()=>{console.log('no upgrade after 20s');process.exit(1)}, 20000);
}
main();
