import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import crypto from 'node:crypto';

const require=createRequire(path.resolve('.runtime-driver/package.json'));
const {chromium,expect}=require('@playwright/test');
const output=path.resolve('runtime-evidence');fs.mkdirSync(output,{recursive:true});
const artifact=path.resolve('runtime-bin');
const exe=path.join(artifact,'Tari Universe (Alpha).exe');
const expected='afaa0e3534316b888bfb8a5e601ac8d5f234bf67aa9fdfb966f79ac3d9adb2c5';
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),expected);
const profile=path.join(process.env.APPDATA,'com.tari.universe.alpha');
assert(!fs.existsSync(profile),'A fresh, ephemeral runner profile is required');
const config=path.join(profile,'app_configs','esmeralda');fs.mkdirSync(config,{recursive:true});
fs.writeFileSync(path.join(config,'config_mining.json'),JSON.stringify({mine_on_app_start:false,cpu_mining_enabled:false,gpu_mining_enabled:false,has_user_chosen_gpu_mining:true}));
fs.writeFileSync(path.join(config,'config_core.json'),JSON.stringify({allow_telemetry:false,should_auto_launch:false,auto_update:false,show_window_on_startup:true}));
const report={startedAt:new Date().toISOString(),platform:process.platform,buildRun:42782291324,sha256:expected,testMode:false,miningEnabled:false,checks:[],outcome:'running'};
const save=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));save();
const record=(name,details={})=>{report.checks.push({name,at:new Date().toISOString(),...details});save();console.log(name);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const held=net.createServer(socket=>socket.end('held by regression test'));
let app,browser,page;
const notes=[];
const startup=[];
const capture=chunk=>{for(const line of chunk.toString().split(/\r?\n/)){const clean=line.replace(/tu_[A-Za-z0-9_-]+/g,'[redacted]').slice(0,1200);if(/MCP.*(bind|already in use|configured port|stopped|starting|started)|WARN.*mcp/i.test(line))notes.push(clean);if(/Tokio console|Initializing logging|Starting Tari|panicked at|WebView|OpenCL|error while running tauri/i.test(line)&&startup.length<30)startup.push(clean);}};
async function snapshot(name){await page.screenshot({path:path.join(output,name+'.png'),fullPage:false,mask:[page.locator('[data-testid="mcp-token-value"]')]});}
async function setEnabled(desired){
 const toggle=page.getByTestId('mcp-server-toggle');
 if(await toggle.isChecked()!==desired){await toggle.locator('..').click();}
 await expect(toggle).toBeChecked({checked:desired,timeout:15000});
}
async function listenerStatus(port){
 try{return (await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}}),signal:AbortSignal.timeout(1000)})).status;}catch{return 0;}
}
try{
 await new Promise((resolve,reject)=>{held.once('error',reject);held.listen(4444,'127.0.0.1',resolve);});
 record('Real loopback listener holds port4444');
 const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9452 --remote-debugging-address=127.0.0.1',WEBVIEW2_USER_DATA_FOLDER:path.resolve('runtime-webview')};
 delete env.GH_TOKEN;delete env.GITHUB_TOKEN;
 app=spawn(exe,[],{cwd:artifact,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let launchError;app.once('error',e=>{launchError=e;});
 app.stdout.on('data',capture);app.stderr.on('data',capture);
 const connectDeadline=Date.now()+90000;
 while(Date.now()<connectDeadline){
  if(launchError)throw launchError;
  if(app.exitCode!==null)throw Error('Native process exited '+app.exitCode);
  try{browser=await chromium.connectOverCDP('http://127.0.0.1:9452',{timeout:1500});break;}catch{await wait(1000);}
 }
 assert(browser,'Native WebView2 endpoint did not become available');
 const uiDeadline=Date.now()+150000;
 while(Date.now()<uiDeadline){
  const pages=browser.contexts().flatMap(c=>c.pages());
  page=pages.find(p=>/tauri\.localhost/.test(p.url()))??pages[0];
  if(page&&await page.getByTestId('settings-open').isVisible().catch(()=>false))break;
  await wait(1000);
 }
 assert(page,'No native page found');
 report.nativeUrl=page.url();
 await expect(page.getByTestId('settings-open')).toBeVisible({timeout:5000});
 record('Real packaged native frontend is ready',{url:page.url()});
 if(await page.getByTestId('release-notes-dismiss').isVisible())await page.getByTestId('release-notes-dismiss').click();
 await page.getByTestId('settings-open').click();
 await page.getByTestId('settings-tab-mcp').click();
 await setEnabled(true);
 const status=page.getByTestId('mcp-server-status');
 const port=page.getByTestId('mcp-port-input');
 await port.evaluate(input=>{
  window.__portUiEvents=[];
  for(const type of ['input','change','keydown','blur'])input.addEventListener(type,event=>{
   window.__portUiEvents.push({type,value:input.value,key:event.key??null,trusted:event.isTrusted,invalid:input.getAttribute('aria-invalid')});
   window.__portUiEvents=window.__portUiEvents.slice(-30);
  });
 });
 await expect(status).toHaveText(/running.*19222/i,{timeout:20000});
 await expect.poll(()=>listenerStatus(19222),{timeout:10000}).toBe(401);
 record('MCP starts on19222; unauthenticated HTTP receives401');
 for(const value of ['abc','1023','65536','193334444']){
  report.checkingInvalidValue=value;save();
  await port.fill(value);await port.press('Enter');
  await expect(page.getByRole('alert').filter({hasText:/1024.*65535/})).toBeVisible();
  await expect(port).toHaveValue(value);
  await expect(status).toHaveText(/running.*19222/i);
  record('Inline invalid-port feedback',{value});
 }
 await port.fill('4444');await port.press('Enter');
 const conflict=page.getByRole('alert').filter({hasText:/Port 4444 is already in use\. Choose another port\./i});
 await expect(conflict).toBeVisible({timeout:20000});
 await expect(status).toHaveText(/stopped.*4444/i);
 await expect(port).toHaveValue('4444');
 await expect.poll(()=>listenerStatus(19222),{timeout:10000}).toBe(0);
 record('Occupied port: inline error, stopped state, saved4444, old listener closed');
 await snapshot('01-occupied-port');
 await setEnabled(false);await setEnabled(true);
 await expect(conflict).toBeVisible({timeout:20000});
 await expect(status).toHaveText(/stopped.*4444/i);
 await expect(port).toHaveValue('4444');
 record('Enable path reports same saved-port conflict');
 await snapshot('02-enable-conflict');
 await port.fill('4445');await port.press('Enter');
 await expect(status).toHaveText(/running.*4445/i,{timeout:20000});
 await expect(conflict).toHaveCount(0);
 await expect.poll(()=>listenerStatus(4445),{timeout:10000}).toBe(401);
 record('Changing to free4445 recovers without toggling or fallback');
 await snapshot('03-recovered');
 await setEnabled(false);
 const stored=JSON.parse(fs.readFileSync(path.join(config,'config_mcp.json')));
 assert.equal(stored.port,4445);assert.equal(stored.enabled,false);
 const mining=JSON.parse(fs.readFileSync(path.join(config,'config_mining.json')));
 assert.equal(mining.mine_on_app_start,false);assert.equal(mining.cpu_mining_enabled,false);assert.equal(mining.gpu_mining_enabled,false);
 record('Persisted chosen port and mining-off config verified');
 // Retain only relevant warning lines. Never upload generated credentials/configs.
 const logRoots=[path.join(process.env.LOCALAPPDATA,'com.tari.universe.alpha','logs'),path.join(profile,'logs')];
 function inspect(dir){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,item.name);if(item.isDirectory())inspect(p);else if(/\.log(?:\.\d+)?$/.test(item.name)&&fs.statSync(p).size<10_000_000)capture(fs.readFileSync(p));}}
 logRoots.forEach(inspect);
 const warn=notes.filter(x=>/WARN|ERROR/i.test(x)&&/4444/.test(x)&&/bind|already in use/i.test(x));
 assert(warn.length>0,'No warning-level4444 bind line found');
 record('Warning-level bind failure includes4444 and OS detail',{warnings:[...new Set(warn)]});
 report.outcome='passed';
}catch(e){report.outcome='failed';report.error=String(e.message).replace(/tu_[A-Za-z0-9_-]+/g,'[redacted]').slice(0,2200);process.exitCode=1;
 if(page){
  try{report.portUi=await page.evaluate(()=>{
   const input=document.querySelector('[data-testid="mcp-port-input"]');
   const described=input?.getAttribute('aria-describedby');
   return {port:input?{value:input.value,type:input.type,disabled:input.disabled,invalid:input.getAttribute('aria-invalid'),describedBy:described,description:described?document.getElementById(described)?.textContent:null}:null,
    status:document.querySelector('[data-testid="mcp-server-status"]')?.textContent,
    alerts:[...document.querySelectorAll('[role="alert"]')].map(n=>({text:n.textContent,html:n.outerHTML.slice(0,1500)})),events:window.__portUiEvents??[]};
  });}catch{}
  try{report.packagedLocale=await page.evaluate(async()=>{const r=await fetch('/locales/en/settings.json');const j=await r.json();return {status:r.status,advanced:j.mcp?.advanced,serverToggle:j.mcp?.['server-toggle']};});}catch{}
  try{await snapshot('failure-ui');}catch{}
 }
 try{report.processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-Process | Where-Object { $_.ProcessName -match 'Tari Universe|msedgewebview2|WerFault' } | Select-Object ProcessName,Id,MainWindowTitle,Responding) | ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true}));}catch{}
 report.pageUrls=browser?.contexts().flatMap(c=>c.pages().map(p=>p.url()))??[];
}
finally{
 if(browser)await browser.close().catch(()=>{});
 if(app?.pid){try{execFileSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
 if(held.listening)await new Promise(r=>held.close(r));
 report.finishedAt=new Date().toISOString();report.startupDiagnostics=startup;report.mcpLogLines=[...new Set(notes)].slice(-30);save();
 console.log(JSON.stringify(report));
}
