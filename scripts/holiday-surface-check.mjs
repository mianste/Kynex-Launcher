import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {HOLIDAYS,getHolidayDate} from '../src/lib/holidays.js';
const out='ui-report/startup-surface/holidays';mkdirSync(out,{recursive:true});
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','1459'],{stdio:'ignore'});let browser;
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:1459')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1080,height:720},timezoneId:'Asia/Shanghai'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('kynex-onboarding-all-pages-v3','done');localStorage.setItem('kynex-release-seen-stable','2.2.1');localStorage.setItem('kynex-v092',JSON.stringify({version:8,state:{settings:{theme:'dark',uiOpacity:60,liquidOpacity:58,wallpaper:'island',holidayThemeEnabled:true,holidayWindowDays:0,holidayEffects:true,holidayWallpaper:true}}}));});
 await page.goto('http://127.0.0.1:1459/?nosplash=1');await page.locator('.home-launch-button').waitFor();
 const results=[];
 for(const holiday of HOLIDAYS){
  const {year,month,day}=getHolidayDate(holiday.id,2026);
  await page.clock.setFixedTime(new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T12:00:00+08:00`));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(id=>document.documentElement.dataset.holiday===id,holiday.id);
  await page.waitForFunction(id=>document.querySelector('.wallpaper-frame[data-active="true"] .holiday-wallpaper')?.style.backgroundImage.includes(id),holiday.id);
  await page.waitForTimeout(560);
  for(const theme of ['light','dark','liquid']){
   await page.evaluate(async theme=>{const {useStore}=await import('/src/store/index.js');const {transitionAppearance}=await import('/src/lib/appearanceTransition.js');await transitionAppearance(useStore.getState().settings,{theme},patch=>useStore.getState().updateSettings(patch));},theme);
   await page.waitForTimeout(450);
   await page.evaluate(()=>window.dispatchEvent(new Event('kynex-open-changelog')));await page.locator('.changelog-modal').waitFor();await page.waitForTimeout(350);
   const surface=await page.evaluate(()=>({holiday:document.documentElement.dataset.holiday,bg:getComputedStyle(document.querySelector('.app')).backgroundColor,wallpaper:getComputedStyle(document.querySelector('.wallpaper-frame')).visibility}));
   assert.equal(surface.holiday,holiday.id);assert.equal(surface.wallpaper,'visible');assert.ok(surface.bg.startsWith('rgb('));
   await page.screenshot({path:`${out}/${holiday.id}-${theme}.png`,omitBackground:true});
   await page.getByRole('button',{name:'开始使用',exact:true}).click();await page.locator('.overlay').waitFor({state:'detached'});
   results.push({holiday:holiday.id,theme,...surface});
  }
  console.log(`Checked ${holiday.name}: light, dark, glass`);
 }
 // Returning to the everyday theme must retain a solid background as well.
 await page.evaluate(async()=>{const {useStore}=await import('/src/store/index.js');useStore.getState().updateSettings({holidayThemeEnabled:false,holidayWallpaper:false});});
 await page.waitForFunction(()=>!document.documentElement.dataset.holiday);await page.waitForTimeout(600);
 await page.screenshot({path:out+'/everyday-return.png',omitBackground:true});assert.deepEqual(errors,[]);
 writeFileSync(out+'/result.json',JSON.stringify({cases:results,returnToEveryday:true,pageErrors:errors},null,2));console.log(JSON.stringify({holidayThemes:HOLIDAYS.length,appearanceCases:results.length,returnToEveryday:true,pageErrors:errors}));
}finally{await browser?.close();server.kill();}
