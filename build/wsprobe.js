async function main(){
const fs = await import('node:fs');
const http = await import('node:http');
const crypto = await import('node:crypto');
const token = fs.readFileSync('/tok/token_probe','utf8').trim();
const key = crypto.randomBytes(16).toString('base64');
const req = http.request({host:'hermes-next-pilot', port:9119, path:'/api/ws', headers:{
  'Connection':'Upgrade','Upgrade':'websocket','Sec-WebSocket-Key':key,'Sec-WebSocket-Version':'13',
  'Cookie':'hermes_session_at='+token
}});
req.on('upgrade', (res, socket) => {
  console.log('UPGRADED', res.statusCode);
  socket.on('data', b=>console.log('FRAME', b.slice(0,800).toString().slice(0,800)));
  const d = Buffer.from(JSON.stringify({jsonrpc:'2.0', id:1, method:'session.list', params:{}}));
  socket.write(Buffer.concat([Buffer.from([0x81,0x80|(d.length>>7),d.length&0x7f]),d]));
  setTimeout(()=>process.exit(0), 5000);
});
req.on('response', r=>console.log('RESP', r.statusCode));
req.on('error', e=>console.log('ERR', e.message));
req.end();
setTimeout(()=>{console.log('no upgrade after 20s');process.exit(1)}, 20000);
}
main();
