async function main(){
const fs = await import('node:fs');
const http = await import('node:http');
const crypto = await import('node:crypto');
// step 1: REST with cookie to mint WS ticket
const token = fs.readFileSync('/tok/token_probe','utf8').trim();
const r = await fetch('http://hermes-next-pilot:9119/api/auth/ws-ticket', {method:'POST', headers:{'Cookie':'hermes_session_at='+token}});
console.log('ticket post', r.status);
const body = await r.text();
console.log(body.slice(0,300));
}
main();
