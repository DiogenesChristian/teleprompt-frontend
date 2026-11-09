const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('frontend/js/teleprompter.js', 'utf8');
function harness() {
  let now = 0, power = 0, tick, resolve, reject, stopped = 0, closed = 0;
  const events = {}, messages = [];
  const track = { muted: false, readyState: 'live', addEventListener: (n,f) => events[n]=f, stop: () => stopped++ };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const context = {
    auto: {on:true}, st:{running:true}, prefs:{micId:'external'},
    Date:{now:()=>now}, Float32Array,
    setInterval:f=>(tick=f,1), clearInterval:()=>{tick=null;},
    ui:{toast:m=>messages.push(m)}, renderSpeed(){}, resetHeard(){}, live:null,
    navigator:{mediaDevices:{getUserMedia:options=>{ context.constraints=options; return new Promise((a,b)=>{resolve=a;reject=b;}); }}},
    window:{AudioContext:class { constructor(){this.state='running';} createAnalyser(){return {fftSize:4,getFloatTimeDomainData:a=>a.fill(power)};} createMediaStreamSource(){return {connect(){}};} close(){closed++;return Promise.resolve();} }},
    SR:class {start(){} stop(){} abort(){}}, feedWords(){},
    voiceUnavailable:m=>{messages.push(m);context.stopVoice();}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function micConstraints('),source.indexOf('  /* Texto reconhecido')),context);
  vm.runInContext(source.slice(source.indexOf('  function startBrowserVoice('),source.indexOf('  function voiceUnavailable(')),context);
  return {c:context,events,messages,stream, track, get stopped(){return stopped;},get closed(){return closed;},
    async open(){context.startBrowserVoice();resolve(stream);await Promise.resolve();},
    async deny(name){context.startBrowserVoice();reject({name});await Promise.resolve();},
    sample(t,p=0){now=t;power=p;tick?.();},get tick(){return tick;},resolve:()=>resolve(stream)};
}
test('native default input: warns after eight seconds, clears on signal, releases resources',async()=>{
  const h=harness();await h.open();
  assert.equal(h.c.constraints.audio.deviceId,undefined);
  h.sample(7999);assert.equal(h.messages.length,0);
  h.sample(8000);assert.match(h.messages[0],/Sem sinal de áudio/);
  h.sample(9000);assert.equal(h.messages.length,1);
  h.sample(9250,.01);assert.equal(h.c.auto.mic.micWarning,false);
  h.sample(17250);assert.equal(h.messages.length,2);
  h.c.stopVoice();assert.equal(h.stopped,1);assert.equal(h.closed,1);assert.equal(h.tick,null);
  h.events.ended();assert.equal(h.messages.length,2);
});
test('native distinguishes permission denial and missing microphone',async()=>{
  for (const [name,expected] of [['NotAllowedError',/Permissão/],['NotFoundError',/desconectado/]]) {
    const h=harness();await h.deny(name);assert.match(h.messages[0],expected);assert.equal(h.c.auto.rec,null);
  }
});
test('disconnect stops native recognition; mute and unmute update warning',async()=>{
 const h=harness();await h.open();h.events.mute();assert.equal(h.c.auto.mic.micWarning,true);
 h.events.unmute();assert.equal(h.c.auto.mic.micWarning,false);
 h.events.ended();assert.match(h.messages.at(-1),/desconectado/);assert.equal(h.c.auto.rec,null);
});
test('late permission result is stopped after cancellation',async()=>{
 const h=harness();h.c.startBrowserVoice();h.c.stopVoice();h.resolve();await Promise.resolve();
 assert.equal(h.stopped,1);assert.equal(h.tick,null);
});
test('native errors distinguish capture and permissions; stale errors are ignored',async()=>{
 for(const [error,expected] of [['not-allowed',/Permissão/],['audio-capture',/desconectado/],['network',/conexão/]]) {
 const h=harness();await h.open();const r=h.c.auto.rec;r.onerror({error});assert.match(h.messages[0],expected);
 r.onerror({error});assert.equal(h.messages.length,1);
 }
});
test('no-speech is not proof of missing input signal',async()=>{
 const h=harness();await h.open();h.c.auto.rec.onerror({error:'no-speech'});assert.equal(h.messages.length,0);
});
test('Deepgram retains signal monitoring and suspended analyser does not count as silence',()=>{
 const h=harness();const c={stream:h.stream};h.c.auto.cloud=c;h.c.monitorMic(c);
 c.audio.state='suspended';h.sample(20000);assert.equal(h.messages.length,0);
 c.audio.state='running';h.sample(20250,.01);h.sample(28250);assert.equal(c.micWarning,true);
 h.c.stopCloud();assert.equal(h.stopped,1);assert.equal(h.closed,1);
});
