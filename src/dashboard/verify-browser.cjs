// Optional real-browser smoke test. Start the repository HTTP server first.
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const keepAlive=setInterval(()=>{},1000);
const deadline=setTimeout(()=>{console.error('Browser verification timed out');process.exit(1);},60000);
(async()=>{
 const executable=process.env.RMOVE_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'rmove-browser-'));
 const browser=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));let ws;
 try{
  let port;for(let n=0;n<80;n++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{}await pause(250);}
  if(!port)throw Error('Chrome did not expose its debugging port');
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let next=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const safe=`(()=>{const result=eval(${JSON.stringify(expression)});return result!==null&&typeof result==='object'?undefined:result;})()`;const r=await call('Runtime.evaluate',{expression:safe,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  await call('Runtime.enable');await call('Page.navigate',{url:'http://127.0.0.1:8000/src/dashboard/'});
  for(let i=0;i<100;i++){if(await evaluate("typeof data!=='undefined' && !!data"))break;await pause(300);}
  assert.equal(await evaluate('!!data'),true);
  const lineCount=()=>evaluate('layer.getLayers().filter(x=>x instanceof L.Polyline).length');
  assert.equal(await lineCount(),0);
  assert.equal(await evaluate('layer.getLayers().filter(x=>x instanceof L.CircleMarker).length'),5);
  await evaluate("layer.getLayers().find(x=>x instanceof L.CircleMarker && x.getLatLng().lat===41.306).fire('click')");
  assert.equal(await lineCount(),8);
  for(const direction of ['out','in','both']){
   await evaluate(`$('direction').value='${direction}';$('direction').dispatchEvent(new Event('change'))`);
   assert.equal(await lineCount(),direction==='both'?8:4);
  }
  await evaluate("document.querySelector('#filtered button').click()");
  assert.equal(await evaluate("document.querySelectorAll('#filtered button[aria-pressed=true]').length"),1);
  assert.ok(await evaluate("$('relation').textContent.includes('2.834')"));
  await evaluate("$('overview').click()");assert.equal(await lineCount(),0);
  assert.equal(await evaluate("$('selection-charts').hidden"),true);
  assert.equal(await evaluate("document.body.textContent.includes('Desviaci?n')"),false);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("$('municipality').value='08089';$('municipality').dispatchEvent(new Event('change'));document.querySelector('#filtered button').click()");
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  assert.deepEqual(errors,[]);
  console.log('PASS Chrome: map nodes, municipality click, direction filters, coordinated selection, detail values, reset, desktop/mobile overflow, no runtime exceptions.');
  await call('Browser.close');
 }finally{if(ws)ws.close();browser.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{clearInterval(keepAlive);clearTimeout(deadline);});
