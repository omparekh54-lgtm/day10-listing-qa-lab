'use client';

import { useMemo, useRef, useState } from 'react';
import { evaluateMetrics, hammingDistance, missingViews, parseSkuView, profiles, scoreIssues, type Issue, type Metrics, type Profile } from '@/lib/qa';

type Analyzed = {
  id: string; name: string; url: string; sku: string; view: string; metrics: Metrics; issues: Issue[]; score: number; hash: string;
};

type Pixel = { r:number; g:number; b:number; l:number };

function mean(v:number[]) { return v.reduce((a,b)=>a+b,0) / Math.max(1,v.length); }
function std(v:number[]) { const m=mean(v); return Math.sqrt(mean(v.map(x=>(x-m)**2))); }

function imageDataFromFile(file: File): Promise<{url:string; canvas:HTMLCanvasElement; width:number; height:number}> {
  return new Promise((resolve,reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 720; const scale = Math.min(1, max/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true}); if(!ctx) return reject(new Error('Canvas unavailable'));
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      resolve({url,canvas,width:img.naturalWidth,height:img.naturalHeight});
    };
    img.onerror=()=>reject(new Error(`Could not decode ${file.name}`)); img.src=url;
  });
}

function analyseCanvas(canvas: HTMLCanvasElement, width:number, height:number) {
  const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);
  const pixels:Pixel[]=[];
  for(let i=0;i<data.length;i+=4){ const r=data[i],g=data[i+1],b=data[i+2]; pixels.push({r,g,b,l:0.2126*r+0.7152*g+0.0722*b}); }
  const lum=pixels.map(p=>p.l); const meanLuma=mean(lum); const darkClipPct=100*lum.filter(x=>x<18).length/lum.length; const brightClipPct=100*lum.filter(x=>x>247).length/lum.length;
  const border:Pixel[]=[]; const w=canvas.width,h=canvas.height, band=Math.max(2,Math.round(Math.min(w,h)*0.04));
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(x<band||y<band||x>=w-band||y>=h-band) border.push(pixels[y*w+x]);
  const bg={r:mean(border.map(p=>p.r)),g:mean(border.map(p=>p.g)),b:mean(border.map(p=>p.b))};
  const borderD=border.map(p=>Math.sqrt((p.r-bg.r)**2+(p.g-bg.g)**2+(p.b-bg.b)**2)); const backgroundStd=std(borderD);
  let minX=w,minY=h,maxX=-1,maxY=-1, fg=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) { const p=pixels[y*w+x]; const d=Math.sqrt((p.r-bg.r)**2+(p.g-bg.g)**2+(p.b-bg.b)**2); if(d>42){fg++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);} }
  const bboxArea=maxX>=0 ? (maxX-minX+1)*(maxY-minY+1) : 0; const occupancyPct=100*bboxArea/(w*h); const clipped=maxX>=0&&(minX<=1||minY<=1||maxX>=w-2||maxY>=h-2);
  const rs=mean(pixels.map(p=>p.r)),gs=mean(pixels.map(p=>p.g)),bs=mean(pixels.map(p=>p.b)); const colorCast=Math.max(rs,gs,bs)-Math.min(rs,gs,bs);
  let lap:number[]=[]; const gray=lum; for(let y=1;y<h-1;y+=2) for(let x=1;x<w-1;x+=2){const i=y*w+x; lap.push(4*gray[i]-gray[i-1]-gray[i+1]-gray[i-w]-gray[i+w]);} const blurVariance=std(lap)**2/100;
  const subjectL:number[]=[]; for(let y=Math.max(0,minY);y<=Math.min(h-1,maxY);y+=3) for(let x=Math.max(0,minX);x<=Math.min(w-1,maxX);x+=3) subjectL.push(gray[y*w+x]);
  const thumbnailContrast=Math.abs(mean(subjectL)-mean(border.map(p=>p.l)));
  const hashCanvas=document.createElement('canvas'); hashCanvas.width=9;hashCanvas.height=8; const hc=hashCanvas.getContext('2d')!;hc.drawImage(canvas,0,0,9,8);const hd=hc.getImageData(0,0,9,8).data;let hash='';
  for(let y=0;y<8;y++) for(let x=0;x<8;x++){const i=(y*9+x)*4,j=(y*9+x+1)*4;const a=hd[i]+hd[i+1]+hd[i+2],b=hd[j]+hd[j+1]+hd[j+2];hash+=a>b?'1':'0';}
  return { metrics:{width,height,meanLuma,darkClipPct,brightClipPct,blurVariance,backgroundStd,occupancyPct,clipped,colorCast,thumbnailContrast} satisfies Metrics, hash };
}

function escapeCsv(value:unknown){ const s=String(value??''); return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
function download(name:string,text:string,type='text/csv'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}

export default function Page(){
  const [profile,setProfile]=useState<Profile>('amazon'); const [items,setItems]=useState<Analyzed[]>([]); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [selected,setSelected]=useState<string|null>(null); const [required,setRequired]=useState(['front','back','detail']); const input=useRef<HTMLInputElement>(null);
  const duplicates=useMemo(()=>{ const out:{a:string;b:string;distance:number}[]=[]; for(let i=0;i<items.length;i++) for(let j=i+1;j<items.length;j++){const d=hammingDistance(items[i].hash,items[j].hash);if(d<=8)out.push({a:items[i].name,b:items[j].name,distance:d});} return out;},[items]);
  const completeness=useMemo(()=>missingViews(items.map(i=>i.name),required),[items,required]);
  const selectedItem=items.find(i=>i.id===selected)??items[0]; const high=items.filter(i=>i.issues.some(x=>x.severity==='high')).length; const pass=items.filter(i=>i.score>=80&&!i.issues.some(x=>x.severity==='high')).length;
  async function ingest(files:FileList|File[]){setError('');setBusy(true);try{const next:Analyzed[]=[];for(const file of Array.from(files)){if(!file.type.startsWith('image/'))continue;const loaded=await imageDataFromFile(file);const {metrics,hash}=analyseCanvas(loaded.canvas,loaded.width,loaded.height);const parsed=parseSkuView(file.name);const issues=evaluateMetrics(metrics,profile);next.push({id:crypto.randomUUID(),name:file.name,url:loaded.url,sku:parsed.sku,view:parsed.view,metrics,issues,score:scoreIssues(issues),hash});}if(!next.length)throw new Error('Choose PNG, JPG, WEBP or another browser-readable image format.');setItems(old=>[...old,...next]);setSelected(s=>s??next[0].id);}catch(e){setError(e instanceof Error?e.message:'Image analysis failed.');}finally{setBusy(false);}}
  function reevaluate(p:Profile){setProfile(p);setItems(xs=>xs.map(x=>{const issues=evaluateMetrics(x.metrics,p);return{...x,issues,score:scoreIssues(issues)}}));}
  function exportReport(){const rows=[['image','sku','view','score','status','width','height','occupancy_pct','blur_score','background_variation','issues'],...items.map(i=>[i.name,i.sku,i.view,i.score,i.score>=80&&!i.issues.some(x=>x.severity==='high')?'PASS':'REVIEW',i.metrics.width,i.metrics.height,i.metrics.occupancyPct.toFixed(1),i.metrics.blurVariance.toFixed(0),i.metrics.backgroundStd.toFixed(1),i.issues.map(x=>`${x.severity}:${x.code}`).join('|')])];download('listing-qa-report.csv',rows.map(r=>r.map(escapeCsv).join(',')).join('\n'));}
  function demo(){setError(''); const mock=(name:string,metrics:Metrics,hash:string):Analyzed=>{const parsed=parseSkuView(name),issues=evaluateMetrics(metrics,profile);return{id:crypto.randomUUID(),name,url:'',sku:parsed.sku,view:parsed.view,metrics,issues,score:scoreIssues(issues),hash}}; const base={width:1600,height:1600,meanLuma:184,darkClipPct:1,brightClipPct:8,blurVariance:175,backgroundStd:7,occupancyPct:74,clipped:false,colorCast:8,thumbnailContrast:58};const d=[mock('CANDLE-01_front.jpg',base,'1010101010101010101010101010101010101010101010101010101010101010'),mock('CANDLE-01_back.jpg',{...base,width:820,height:820,blurVariance:44,occupancyPct:48},'1110101010101010101010101010101010101010101010101010101010101010'),mock('PERFUME-07_front.jpg',{...base,clipped:true,occupancyPct:97,backgroundStd:39},'0000111100001111000011110000111100001111000011110000111100001111'),mock('PERFUME-07_detail.jpg',{...base,meanLuma:58,darkClipPct:15,colorCast:34},'0011001100110011001100110011001100110011001100110011001100110011')];setItems(d);setSelected(d[0].id);}
  const toggleReq=(v:string)=>setRequired(x=>x.includes(v)?x.filter(a=>a!==v):[...x,v]);
  return <main>
    <header className="topbar"><div className="brand"><span className="logo">LQ</span><div><b>Listing QA Lab</b><small>Image readiness before production</small></div></div><div className="privacy">● Browser-local analysis</div></header>
    <section className="hero"><div><span className="eyebrow">DAY 10 · COMPUTER VISION QA</span><h1>Stop weak product images<br/>before customers see them.</h1><p>Batch-check ecommerce imagery for sharpness, exposure, framing, background consistency, duplicate risk and listing completeness. Your images stay in this browser.</p><div className="heroActions"><button className="primary" onClick={()=>input.current?.click()}>{busy?'Analysing…':'Add product images'}</button><button className="ghost" onClick={demo}>Try interactive demo</button></div><input ref={input} hidden multiple type="file" accept="image/*" onChange={e=>e.target.files&&ingest(e.target.files)}/>{error&&<div className="error">{error}</div>}</div><div className="trust"><b>Confidence & honesty layer</b><p><span>Known</span> dimensions and filename structure</p><p><span>Estimate</span> blur, exposure and background statistics</p><p><span>Heuristic</span> subject occupancy, clipping and thumbnail survival</p><small>No claim that these checks replicate a marketplace moderation system.</small></div></section>
    {items.length===0?<section className="empty"><div className="drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();ingest(e.dataTransfer.files)}}><b>Drop a product image batch here</b><span>PNG · JPG · WEBP · processed locally</span></div><div className="features"><article><b>Per-image QA</b><span>Find resolution, blur, crop, exposure and background problems.</span></article><article><b>Listing completeness</b><span>Name files like SKU_front.jpg and catch missing back/detail views.</span></article><article><b>Duplicate screening</b><span>Perceptual hashes surface exact and near-duplicate imagery.</span></article></div></section>:
    <section className="workspace">
      <aside className="sidebar"><label>QA profile</label><select value={profile} onChange={e=>reevaluate(e.target.value as Profile)}>{Object.entries(profiles).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select><div className="statGrid"><div><strong>{items.length}</strong><span>images</span></div><div><strong>{pass}</strong><span>ready</span></div><div><strong>{high}</strong><span>high risk</span></div><div><strong>{duplicates.length}</strong><span>near-dupes</span></div></div><button className="primary full" onClick={exportReport}>Export QA report</button><button className="ghost full" onClick={()=>input.current?.click()}>Add more images</button><button className="textBtn" onClick={()=>{items.forEach(i=>i.url&&URL.revokeObjectURL(i.url));setItems([]);setSelected(null)}}>Reset workspace</button><hr/><label>Required listing views</label>{['front','back','side','detail','packaging'].map(v=><label className="check" key={v}><input type="checkbox" checked={required.includes(v)} onChange={()=>toggleReq(v)}/><span>{v}</span></label>)}</aside>
      <div className="content"><div className="sectionHead"><div><span className="eyebrow">BATCH TRIAGE</span><h2>Publication queue</h2></div><p>{profile==='amazon'?'Marketplace Main profile emphasizes square, high-resolution, isolated-product imagery.':'Profile thresholds change the QA recommendation—not the underlying pixel measurements.'}</p></div>
        <div className="cards">{items.map(i=><button className={`imageCard ${selected===i.id?'active':''}`} key={i.id} onClick={()=>setSelected(i.id)}><div className="thumb">{i.url?<img src={i.url} alt=""/>:<div className="demoThumb">DEMO</div>}<span className={`score ${i.score>=80?'good':i.score>=60?'warn':'bad'}`}>{i.score}</span></div><div className="cardCopy"><b>{i.name}</b><span>{i.sku} · {i.view}</span><small>{i.issues.length?`${i.issues.length} checks need review`:'Ready under current profile'}</small></div></button>)}</div>
        {selectedItem&&<div className="inspector"><div className="preview">{selectedItem.url?<img src={selectedItem.url} alt={selectedItem.name}/>:<div className="demoLarge">Sample image metrics</div>}<div className="safeCrop"><span>safe crop</span></div></div><div className="findings"><div className="findingHead"><div><span className="eyebrow">IMAGE INSPECTOR</span><h3>{selectedItem.name}</h3></div><strong>{selectedItem.score}/100</strong></div><div className="metrics"><span>{selectedItem.metrics.width}×{selectedItem.metrics.height}<small>resolution</small></span><span>{selectedItem.metrics.occupancyPct.toFixed(0)}%<small>occupancy</small></span><span>{selectedItem.metrics.blurVariance.toFixed(0)}<small>sharpness</small></span><span>{selectedItem.metrics.backgroundStd.toFixed(0)}<small>bg variation</small></span></div>{selectedItem.issues.length===0?<div className="success">No current profile blockers detected. Human visual review is still recommended before publishing.</div>:<div className="issueList">{selectedItem.issues.map(issue=><article key={issue.code} className={issue.severity}><div><b>{issue.title}</b><p>{issue.detail}</p></div><span>{issue.confidence}</span></article>)}</div>}</div></div>}
        <div className="lowerGrid"><section><div className="miniHead"><h3>Listing completeness</h3><span>Known from filenames</span></div>{completeness.map(g=><div className="skuRow" key={g.sku}><b>{g.sku}</b><span className={g.missing.length?'missing':'complete'}>{g.missing.length?`Missing: ${g.missing.join(', ')}`:'Required views present'}</span></div>)}</section><section><div className="miniHead"><h3>Near-duplicate screen</h3><span>Perceptual hash heuristic</span></div>{duplicates.length?duplicates.map((d,i)=><div className="skuRow" key={i}><b>{d.a}</b><span className="missing">↔ {d.b} · distance {d.distance}</span></div>):<p className="muted">No near-duplicate pairs found at the current threshold.</p>}</section></div>
      </div>
    </section>}
    <section className="method"><span className="eyebrow">WHY THIS IS NOT JUST ANOTHER IMAGE EDITOR</span><h2>It is a quality gate, not a beautification tool.</h2><p>Listing QA Lab measures whether a batch is ready to publish, explains the reason for every flag, checks SKU-level coverage, and creates an operational QA file. It does not generate, retouch or silently alter product imagery.</p></section>
    <footer>Listing QA Lab · Privacy-first browser analytics · Human review remains the final publishing decision.</footer>
  </main>
}
