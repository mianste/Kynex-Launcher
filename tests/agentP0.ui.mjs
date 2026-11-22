import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const output='ui-report/agent-p0';mkdirSync(output,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1461'],{stdio:'ignore',windowsHide:true});let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:1461')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:process.env.KXL_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage({viewport:{width:1080,height:720}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const old=readFileSync('scripts/assistant-ui-check.mjs','utf8');let fixture=old.slice(old.indexOf('await page.addInitScript(() => {'),old.indexOf('  await page.goto('));
 fixture=fixture.replace('let id = 0;',`let id=0;const callbacks={},listeners={};window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:(_,id)=>delete listeners[id]};window.agentEvents=p=>{for(const [id,item]of Object.entries(listeners))if(item.event==='kynex-agent')callbacks[item.handler]?.({event:item.event,id:Number(id),payload:p});};`);
 fixture=fixture.replace('transformCallback: () => ++id,','transformCallback: callback=>{callbacks[++id]=callback;return id;},');
 fixture=fixture.replace('if (cmd !== "dispatch") return 1;',`if(cmd==='plugin:event|listen'){const key=++id;listeners[key]=args;return key;}if(cmd==='plugin:event|unlisten'){delete listeners[args.eventId];return null;}if(cmd!=='dispatch')return 1;`);
 fixture=fixture.replace('window.calls.push({ action, payload: p });',`window.calls.push({action,payload:p});
 if(action==='check_update')return {status:'current'};
 if(action==='agent_list')return [];
 if(action==='agent_start'){
 if(p.request.includes('作业'))return {rejected:true,reason:'工坊只处理 Minecraft 和启动器相关需求。'};
 const plan={version:1,name:'Fabric 轻量冒险',minecraft:'1.20.1',loader:{type:'fabric',version:'0.16.9'},memoryMb:4096,java:'auto',mods:[{source:'modrinth',projectId:'real-project',versionId:'real-version',name:'冒险模组',side:'both',reason:'轻量探索',required:true}],resourcePacks:[],shaders:[],localization:{mode:'cfpa',note:''},options:{language:'zh_cn'},configPatches:[],notes:['先确认版本'],warnings:['下载前重新校验'],estimatedDownloadBytes:1024};
 window.agentTask={id:'task',mode:'confirm',status:'awaiting_approval',request:p.request,plan,planHash:'approved-hash',steps:[{name:'安装游戏',status:'pending',detail:'',elapsedMs:0,snapshotId:''}],currentStep:0,budget:{downloadedBytes:0},audit:[],createdAt:'1',updatedAt:'1',error:'',directoryId:'qa',instanceId:'new-instance',snapshots:[],confirmedHash:'',rollbackSnapshot:''};return {taskId:'task',plan,task:window.agentTask};}
 if(action==='agent_get')return window.agentTask;
 if(action==='agent_delete'){window.agentTask=null;return {deleted:true};}
 if(action==='agent_confirm'){if(p.planHash!=='approved-hash')throw Error('计划哈希不符');window.agentTask={...window.agentTask,status:'executing',confirmedHash:p.planHash,rollbackSnapshot:'snapshot',snapshots:['snapshot'],steps:[{name:'安装游戏',status:'running',elapsedMs:0,detail:'',snapshotId:'snapshot'}]};return {task:window.agentTask};}
 if(action==='agent_cancel'){window.agentTask={...window.agentTask,status:'cancelled',error:'已停止任务'};window.agentEvents({taskId:'task',type:'state',task:window.agentTask});return {cancelled:true};}
 if(action==='agent_tool'&&p.tool==='restore_snapshot'){if(p.confirmed!==true)throw Error('需要确认');window.agentTask={...window.agentTask,status:'cancelled',error:'已回滚'};return {restored:true};}
 if(action==='agent_resume'){window.agentTask={...window.agentTask,status:'executing',error:''};return {task:window.agentTask};}`);
 await new Function('page',`return (async()=>{${fixture}})()`)(page);const build=JSON.parse(readFileSync('config/build-channel.json','utf8'));await page.addInitScript(({channel,version})=>{localStorage.setItem('kynex-onboarding-all-pages-v3','done');localStorage.setItem('kynex-release-seen-'+channel,version);},build);
 await page.goto('http://127.0.0.1:1461/?nosplash=1');await page.getByRole('button',{name:'打开 AI 助手',exact:true}).click();await page.getByRole('button',{name:'整合包工坊',exact:true}).click();
 const panel=page.getByRole('region',{name:'AI 整合包工坊'});await panel.getByLabel('想制作什么整合包？').fill('写作业');await panel.getByRole('button',{name:'生成计划',exact:true}).click();await panel.getByRole('alert').filter({hasText:'只处理 Minecraft'}).waitFor();assert.equal(await panel.locator('.agent-plan').count(),0);
 await panel.getByLabel('想制作什么整合包？').fill('做一个1.20.1 Fabric轻量冒险包');await panel.getByRole('button',{name:'生成计划',exact:true}).click();await panel.getByRole('heading',{name:'Fabric 轻量冒险'}).waitFor();await panel.getByRole('button',{name:'查看模组清单（1）',exact:true}).click();const mods=page.getByRole('dialog',{name:'模组清单'});await mods.getByText('real-project / real-version',{exact:true}).waitFor();await mods.getByRole('button',{name:'关闭弹窗'}).click();assert.equal(await panel.locator('summary').count(),0);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.action==='agent_confirm').length),0);
 await panel.getByRole('button',{name:'开始搭建',exact:true}).click();await page.getByRole('button',{name:'确认并开始',exact:true}).click();await panel.getByRole('button',{name:'停止任务',exact:true}).waitFor();await panel.getByRole('button',{name:'停止任务',exact:true}).click();await panel.getByRole('button',{name:'从已完成步骤继续',exact:true}).waitFor();
 await panel.getByRole('button',{name:'回滚到执行前',exact:true}).click();await page.getByRole('button',{name:'确认回滚',exact:true}).click();await panel.getByRole('button',{name:'进度与备份',exact:true}).click();await panel.getByText('已回滚',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).hash,'#workshop');await page.locator('.assistant-panel').waitFor({state:'hidden'});
 await panel.getByRole('button',{name:'删除任务记录：Fabric 轻量冒险',exact:true}).click();await page.getByRole('dialog',{name:'删除任务记录'}).getByRole('button',{name:'删除记录',exact:true}).click();await panel.getByRole('heading',{name:'任务记录（0）',exact:true}).waitFor();
 await page.getByRole('button',{name:'启动',exact:true}).click();await page.getByRole('button',{name:'AI 整合包工坊',exact:true}).click();await panel.getByRole('heading',{name:'任务记录（0）',exact:true}).waitFor();
 for(const theme of ['light','dark'])for(const opacity of [0,50,100]){await page.evaluate(async({theme,opacity})=>{const {useStore}=await import('/src/store/index.js');useStore.getState().updateSettings({theme,uiOpacity:opacity});},{theme,opacity});await page.waitForTimeout(80);await page.screenshot({path:output+'/'+theme+'-'+opacity+'.png'});assert.ok(await panel.isVisible());}
 assert.deepEqual(errors,[]);console.log('PASS: 范围拒绝无计划、真实ID卡片、执行前确认、哈希绑定、停止/恢复入口、回滚二次确认、深浅主题与透明度。');
}finally{await browser?.close();server.kill();}
