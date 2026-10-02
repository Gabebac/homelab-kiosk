async function main(){
const fs = await import('node:fs');
const token = fs.readFileSync('/tok/token_probe','utf8').trim();
const r = await fetch('http://hermes-next-pilot:9119/api/auth/ws-ticket', {
  method:'POST',
  headers:{'Cookie':'hermes_session_at='+token, 'Authorization':'Bearer '+token, 'Origin':'http://hermes-next-pilot:9119'}
});
console.log('ticket post', r.status, (await r.text()).slice(0,200));
}
main();
