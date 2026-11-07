import assert from 'node:assert/strict';
import { State, Text, ScrollView, VStack, View, runApp, __testing as test } from 'jonui';
const count=State(80), key=State('one'), width=State(0);
const app=runApp({title:'Follow bottom test',width:500,height:300,content:View(()=>ScrollView(VStack(Array.from({length:count.value},(_,i)=>Text('Line '+i+' 🦊').frame({height:24}))),{followBottom:true,scrollResetKey:key.value}))});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const scroll=()=>test.request('debug.layout').scrolls.find(s=>s.document.height>500);
const bottom=()=>{const s=scroll();return s && Math.abs(s.document.height-s.viewport.height-s.viewport.y)<4;};
async function until(fn,name){for(let i=0;i<300;i++){if(fn())return;await sleep(10);}throw Error(name+': '+JSON.stringify(test.request('debug.layout')));}
await until(bottom,'initial bottom');
count.value+=5;await until(bottom,'append follows');
let s=scroll();test.request('debug.scroll',{index:s.index,x:0,y:100});await sleep(150);
assert.ok(scroll().viewport.y<150,JSON.stringify(scroll()));
count.value+=10;await sleep(200);assert.ok(scroll().viewport.y<150,'reading position retained');
s=scroll();test.request('debug.scroll',{index:s.index,x:0,y:s.document.height});await sleep(150);
count.value+=5;await until(bottom,'follow resumes at bottom');
s=scroll();test.request('debug.scroll',{index:s.index,x:0,y:0});await sleep(100);
key.value='two';await until(bottom,'conversation reset');
test.request('debug.close');await app;assert.deepEqual(test.stats(),{actions:0,cells:0,dependencies:0});
console.log('PASS scroll follow: initial bottom, content growth, reader scroll-up, resuming and conversation reset');
