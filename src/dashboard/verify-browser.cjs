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
  const evaluate=async expression=>{const safe=`(async()=>{const result=await eval(${JSON.stringify(expression)});return result!==null&&typeof result==='object'?undefined:result;})()`;const r=await call('Runtime.evaluate',{expression:safe,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
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
  await evaluate("document.querySelector(`#filtered button[data-i='${data.relaciones.findIndex(r=>r.municipio_origen==='08089'&&r.municipio_destino==='08301')}']`).click()");
  assert.equal(await evaluate("document.querySelectorAll('#filtered button[aria-pressed=true]').length"),1);
  assert.ok(await evaluate("$('relation').textContent.includes('2.834')"));
  assert.ok(await evaluate("$('relation').textContent.includes('-10,37 %') && $('relation').textContent.includes('3.162')"));
  assert.equal(await evaluate("document.querySelector('#relation .statistical-detail').open"),false);
  assert.equal(await evaluate("document.querySelectorAll('#metric option').length"),1);
  for(const [metric,unit] of [['variacion_observada_pct','%']]){
   await evaluate(`$('metric').value='${metric}';$('metric').dispatchEvent(new Event('change'))`);
   assert.equal(await evaluate(`$('legend-help').textContent.includes('(${unit})')`),true);
   assert.equal(await evaluate("document.querySelectorAll('#filtered button[aria-pressed=true]').length"),1);
   const hasUnit=await evaluate(`layer.getLayers().find(x=>x instanceof L.Polyline).getTooltip().getContent().includes(' ${unit}')`);
   assert.equal(hasUnit,true);
   assert.ok(await evaluate("$('relation').textContent.includes('-10,37 %')"));
  }
  await evaluate("select(data.relaciones.findIndex(r=>r.municipio_origen==='08019'&&r.municipio_destino==='08056'))");
  assert.ok(await evaluate("$('relation').textContent.includes(signed(data.relaciones.find(r=>r.municipio_origen==='08019'&&r.municipio_destino==='08056').variacion_observada_pct)+' %')"));
  assert.equal(await evaluate("/NaN|undefined/.test(document.body.textContent)"),false);
  await evaluate("$('overview').click()");assert.equal(await lineCount(),0);
  assert.equal(await evaluate("$('selection-charts').hidden"),true);
  assert.equal(await evaluate("document.body.textContent.includes('Desviaci?n')"),false);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await evaluate("$('event').value='2025-02-07';load()");
  assert.equal(await evaluate("data.fecha_incidencia==='2025-02-07' && data.relaciones.length===18"),true);
  assert.equal(await lineCount(),0);
  assert.equal(await evaluate("$('municipality').textContent.includes('Premià de Mar') && !$('municipality').textContent.includes('Castelldefels')"),true);
  assert.equal(await evaluate("$('case-info').textContent.includes('Y25-002') && $('case-info').textContent.includes('Sants')"),true);
  assert.equal(await evaluate("$('availability-title').textContent.includes('2 excluidas')"),true);
  assert.equal(await evaluate("$('coverage-note').textContent.includes('+0,34 %')"),true);
  await evaluate("layer.getLayers().find(x=>x instanceof L.CircleMarker && x.getLatLng().lat===41.538).fire('click')");
  assert.equal(await lineCount(),8);
  await evaluate("document.querySelector(`#filtered button[data-i='${data.relaciones.findIndex(r=>r.municipio_origen==='08121'&&r.municipio_destino==='08019')}']`).click()");
  assert.equal(await evaluate("$('relation').textContent.includes('viernes comparables') && $('relation').textContent.includes('11.646') && $('relation').textContent.includes('11.224')"),true);
  assert.equal(await evaluate("$('temporal').querySelectorAll('svg').length===1 && $('sensitivity').textContent.includes('Solo anteriores')"),true);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('svg path')).every(p=>!/NaN|undefined/.test(p.getAttribute('d')))"),true);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await evaluate("$('municipality').value='08118';$('municipality').dispatchEvent(new Event('change'));document.querySelector('#filtered button').click()");
  assert.equal(await lineCount(),6);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await evaluate("$('event').value='2025-06-05';load()");
  assert.equal(await evaluate("data.relaciones.length===20 && $('municipality').textContent.includes('Castelldefels') && !$('municipality').textContent.includes('Arenys')"),true);
  await evaluate("$('municipality').value='08089';$('municipality').dispatchEvent(new Event('change'));document.querySelector('#filtered button').click()");
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  assert.deepEqual(errors,[]);
  console.log('PASS Chrome: June preserved; real February switching; municipal catalogs; map/OD selection; coverage; exclusions; temporal graphs; sensitivity; return to June; desktop/mobile width; no runtime exceptions.');
  await call('Browser.close');
 }finally{if(ws)ws.close();browser.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{clearInterval(keepAlive);clearTimeout(deadline);});
