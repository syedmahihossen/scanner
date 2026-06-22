// ==========================================
// 🧠 AI DYNAMIC WEIGHT CONFIGURATION
// (Update this block after running your Python Trainer)
// ==========================================
const AI_WEIGHTS = {
    QFL_BASE_CRACK: 20,
    MMC_MIRROR_SYNC: 30,
    MMC_REJECTION_PIN: 15,
    SMC_FVG: 15,
    SMC_LIQUIDITY_SWEEP: 20,
    QB_DELTA_SURGE: 15,
    MOMENTUM_CONFIRMATION: 5,
    CHASING_PENALTY: 40
};
// ==========================================

const DEFAULT_CRYPTO=["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT"];
const STOOQ=[["EURUSD","eurusd","forex"],["GBPUSD","gbpusd","forex"],["USDJPY","usdjpy","forex"],["XAUUSD","xauusd","metal"],["WTI OIL","cl.f","energy"]];

const MAX_ROWS=30, MIN_ACTION_SCORE=82, MIN_WATCH_SCORE=65;

let signals=[],allScored=[],history=[],activeFilter="all",expanded=null,countdown=90,scanId=0,lastAlert=new Map(),soundOn=false,audioCtx=null,btc24=0;

function $(id){return document.getElementById(id)}
function fmt(n,d=2){return Number.isFinite(+n)?Number(n).toFixed(d):"-"}
function pct(n){return (n>=0?"+":"")+fmt(n,2)+"%"}
function price(v){v=+v;if(!Number.isFinite(v))return"-";if(v>=1000)return v.toLocaleString("en",{maximumFractionDigits:2});if(v>=1)return fmt(v,4);return fmt(v,6)}
function now(){return new Date().toLocaleTimeString()}
function clamp(n,a,b){return Math.max(a,Math.min(b,n))}

// --- AI EXPORT MODULE ---
function exportToExcel() {
  const settledTrades = history.filter(h => h.hit === "target" || h.hit === "stop");
  if(settledTrades.length === 0) { 
      alert("No settled trades to export yet. Let the scanner run and hit TP or SL first!"); 
      return; 
  }
  
  let csvContent = "Symbol,Signal,RSI,VolumeRatio,ATR_Pct,QFL_Trigger,MMC_Signal,SMC_Score,Result\n";
  settledTrades.forEach(t => {
      const result = t.hit === "target" ? 1 : 0; 
      // Extract the saved snapshot features
      const row = `${t.symbol},${t.type},${t.rsi||50},${t.volR||1},${t.atrPct||1},${t.qflTrigger||0},${t.mmcSignal||0},${t.smcScore||0},${result}`;
      csvContent += row + "\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "growingbulls_ai_training_data.csv";
  link.click();
}

function toast(msg,type="info"){
  const t=$("toast");
  $("toastMsg").textContent=msg;
  $("toastIcon").textContent=type==="sell"?"SELL":type==="buy"?"BUY":"ALERT";
  t.style.borderLeftColor=type==="sell"?"var(--brand-red)":type==="buy"?"var(--green)":"#fff";
  t.classList.add("show");
  clearTimeout(t._x);
  t._x=setTimeout(()=>t.classList.remove("show"),4300);
}

function beep(type){
  if(!soundOn)return;
  try{
    if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume();
    const seq=type==="sell"?[330,247,196]:type==="bigdown"?[523,392,294,220]:[523,659,784,1047];
    seq.forEach((f,i)=>{
      const o=audioCtx.createOscillator(),g=audioCtx.createGain();
      o.connect(g);g.connect(audioCtx.destination);
      o.type=type.includes("down")||type==="sell"?"sawtooth":"sine";
      o.frequency.value=f;
      const at=audioCtx.currentTime+i*.13;
      g.gain.setValueAtTime(0,at);
      g.gain.linearRampToValueAtTime(.11,at+.03);
      g.gain.linearRampToValueAtTime(0,at+.12);
      o.start(at);o.stop(at+.13);
    });
  }catch(e){}
}

function toggleSound(){
  soundOn=!soundOn;
  $("soundBtn").textContent=soundOn?"Alerts: ON":"Alerts: OFF";
  $("soundBtn").classList.toggle("on",soundOn);
  if(soundOn){
    try{
      if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
      if(audioCtx.state==='suspended') audioCtx.resume();
    }catch(e){}
    toast("Audio Alerts Enabled");
  }
}

// -- CORE MATH FUNCTIONS --
function emaSeries(values, p) {
  if (!values || values.length < p) return [];
  const k = 2 / (p + 1);
  const out = new Array(values.length).fill(0);
  let sum = 0;
  for (let i = 0; i < p; i++) sum += (values[i] || 0);
  let ema = sum / p;
  for (let i = 0; i < p; i++) out[i] = ema;
  for (let i = p; i < values.length; i++) { ema = (values[i] - ema) * k + ema; out[i] = ema; }
  return out;
}

function macd(closes) {
  if (!closes || closes.length < 35) return {macd: 0, signal: 0, hist: 0, prevHist: 0};
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const line = new Array(closes.length).fill(0);
  for (let i = 0; i < closes.length; i++) line[i] = e12[i] - e26[i];
  const sig = emaSeries(line, 9);
  const m = line.at(-1) || 0, s = sig.at(-1) || 0, pm = line.at(-2) || 0, ps = sig.at(-2) || 0;
  return { macd: m, signal: s, hist: m - s, prevHist: pm - ps };
}

function rsi(closes,p=14){
  if(!closes || closes.length<p+1)return 50;
  let gains=0,losses=0;
  for(let i=1;i<=p;i++){
    const d=closes[i]-closes[i-1];
    if(d>=0)gains+=d;else losses-=d;
  }
  let avgG=gains/p,avgL=losses/p;
  for(let i=p+1;i<closes.length;i++){
    const d=closes[i]-closes[i-1];
    avgG=(avgG*(p-1)+Math.max(d,0))/p;
    avgL=(avgL*(p-1)+Math.max(-d,0))/p;
  }
  if(avgL===0)return 100;
  return 100-100/(1+avgG/avgL);
}

function atr(candles,p=14){
  if(!candles || candles.length===0) return 0;
  if(candles.length<p+1) return (candles.at(-1)?.close||0)*.012;
  const trs=[];
  for(let i=1;i<candles.length;i++){
    const c=candles[i],prev=candles[i-1].close;
    trs.push(Math.max(c.high-c.low,Math.abs(c.high-prev),Math.abs(c.low-prev)));
  }
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}

function avg(arr){ return arr && arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

// --- UPGRADED QUANT MATRIX ENGINES ---

// 1. QUICKFINGER LUC (QFL) BASE CRACK ENGINE
function getQFL(candles) {
  if(!candles || candles.length < 50) return { status: "Searching", cracked: 0, depth: 0, basePrice: 0 };
  const len = candles.length;
  
  let basePrice = Infinity;
  for(let i = len - 45; i < len - 5; i++) {
    if(candles[i].low < basePrice) basePrice = candles[i].low;
  }
  
  const currentPrice = candles[len - 1].close;
  let status = "Above Base", cracked = 0, depth = 0;
  
  if(currentPrice < basePrice) {
    cracked = 1;
    depth = ((basePrice - currentPrice) / basePrice) * 100;
    status = `Base Cracked (-${fmt(depth,1)}%)`;
  } else {
    let ceilingPrice = 0;
    for(let i = len - 45; i < len - 5; i++) {
      if(candles[i].high > ceilingPrice) ceilingPrice = candles[i].high;
    }
    if(currentPrice > ceilingPrice) {
      cracked = -1;
      depth = ((currentPrice - ceilingPrice) / ceilingPrice) * 100;
      status = `Ceil Cracked (+${fmt(depth,1)}%)`;
      basePrice = ceilingPrice;
    }
  }
  return { status, cracked, depth, basePrice };
}

// 2. EXCLUSIVE MODEL BY MMC: PARABOLIC MIRROR CURVE + CHARACTERS
function getMMC(candles) {
  if(!candles || candles.length < 30) return { curveAligned: false, curveType: "Linear", char: "Normal", factor: 0, coordinate: 0, mmcSignal: 0 };
  const len = candles.length;
  const current = candles[len - 1];
  const prev = candles[len - 2];
  
  // Curve Math
  let prices = candles.slice(-25).map(c => c.close);
  let median = prices.reduce((a, b) => a + b, 0) / prices.length;
  const displacement = current.close - median;
  const velocity = Math.abs(current.close - current.open);
  const reflectionFactor = velocity > 0 ? Math.abs(displacement / velocity) : 0;
  
  let curveAligned = false;
  let curveType = "Flat";
  
  if(displacement < 0 && reflectionFactor > 2.0) { curveAligned = true; curveType = "Arc Floor (Bull)"; } 
  else if (displacement > 0 && reflectionFactor > 2.0) { curveAligned = true; curveType = "Arc Roof (Bear)"; }

  // Character Math (Candle King)
  let char = "Standard", mmcSignal = 0;
  const range = current.high - current.low;
  const body = Math.abs(current.open - current.close);
  
  if (range > 0) {
    const lowerWick = Math.min(current.open, current.close) - current.low;
    const upperWick = current.high - Math.max(current.open, current.close);
    
    // Doji Traps & Rejection Pins
    if (body / range < 0.15 && lowerWick > upperWick * 2) { char = "Bullish Pin Trap"; mmcSignal = 1; }
    else if (body / range < 0.15 && upperWick > lowerWick * 2) { char = "Bearish Pin Trap"; mmcSignal = -1; }
    else if (body / range < 0.1) { char = "Doji Indecision"; }
  }
  
  // Engulfing Displacement
  const pRange = prev.high - prev.low;
  if (current.close > prev.high && body > pRange * 1.1) { char = "Bullish Engulf Displacement"; mmcSignal = 1; }
  if (current.close < prev.low && body > pRange * 1.1) { char = "Bearish Engulf Displacement"; mmcSignal = -1; }
  
  return { curveAligned, coordinate: median - displacement, factor: reflectionFactor, curveType, char, mmcSignal };
}

// 3. CANDLE KING UPGRADED SMC (CHOCH, BOS, FVG, LIQ)
function getCK_SMC(candles) {
  if(!candles || candles.length < 25) return { fvg: 0, sweep: 0, structure: "Consolidation", smcScore: 0 };
  let fvg = 0, sweep = 0, structure = "Ranging", smcScore = 0;
  const len = candles.length;
  
  for(let i = len - 5; i < len - 2; i++){
    if(candles[i] && candles[i+2]) {
      if(candles[i].high < candles[i+2].low * 0.9995) { fvg = 1; smcScore += 10; }
      if(candles[i].low > candles[i+2].high * 1.0005) { fvg = -1; smcScore -= 10; }
    }
  }
  
  let maxH = 0, minL = Infinity;
  for(let i = len - 25; i < len - 3; i++){
    if(candles[i] && candles[i].high > maxH) maxH = candles[i].high;
    if(candles[i] && candles[i].low < minL) minL = candles[i].low;
  }
  const current = candles[len-1], prev = candles[len-2];
  
  if(prev && current) {
    if(prev.low < minL && current.close > minL) { sweep = 1; smcScore += 15; } 
    if(prev.high > maxH && current.close < maxH) { sweep = -1; smcScore -= 15; } 
  }

  let recentHigh = 0, recentLow = Infinity;
  for(let i = len - 10; i < len - 2; i++){
    if(candles[i] && candles[i].high > recentHigh) recentHigh = candles[i].high;
    if(candles[i] && candles[i].low < recentLow) recentLow = candles[i].low;
  }
  if (current.close > maxH) { structure = "BOS Uptrend"; smcScore += 10; }
  else if (current.close < minL) { structure = "BOS Downtrend"; smcScore -= 10; }
  else if (current.close > recentHigh && prev.close < recentHigh) { structure = "Bullish CHOCH"; smcScore += 20; }
  else if (current.close < recentLow && prev.close > recentLow) { structure = "Bearish CHOCH"; smcScore -= 20; }

  return { fvg, sweep, structure, smcScore };
}

// 4. GROWINGBULLS (QB) DELTA VOLUME ENGINE
function getQBDelta(candles) {
  if(!candles || candles.length < 10) return { profile: "Neutral Delta", deltaSurge: false, ratio: 1.0 };
  const len = candles.length;
  
  const currentVol = candles[len - 1].volume || 1;
  const recentVols = candles.slice(-10, -1).map(c => c.volume || 1);
  const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
  
  const ratio = currentVol / avgVol;
  let deltaSurge = ratio > 1.35;
  let profile = ratio > 1.35 ? "QB Institutional Accum" : "Low Beta Rotation";
  
  if(ratio > 2.0) profile = "QB Volatility Spike";
  
  return { profile, deltaSurge, ratio };
}

// -- DATA PIPELINE --
const BINANCE_HOSTS=["https://api.binance.com","https://api1.binance.com","https://api2.binance.com"];

async function fetchBinance(path){
  let lastErr;
  for(const host of BINANCE_HOSTS){
    try{
      const r=await fetch(host+path,{cache:"no-store"});
      if(r.ok) return r.json();
      if(r.status===429) { await new Promise(res=>setTimeout(res, 1000)); continue; }
      lastErr=new Error(host+" "+r.status);
    }catch(e){ lastErr=e; }
  }
  throw lastErr||new Error("Binance API Blocked");
}

async function fetchTextFallback(url){
  const urls=[
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`
  ];
  let lastErr;
  for(const u of urls){
    try{
      const r=await fetch(u,{cache:"no-store"});
      if(r.ok){
        const txt=await r.text();
        if(txt.toLowerCase().includes("date,open,high,low,close")) return txt;
      }
      lastErr=new Error("Invalid proxy response");
    }catch(e){lastErr=e}
  }
  throw lastErr||new Error("Proxies blocked");
}

function candlesFromBinance(rows){
  if(!Array.isArray(rows)) return [];
  return rows.map(r=>({time:r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]})).filter(c=>Number.isFinite(c.close));
}

function parseCsv(txt){
  if(typeof txt !== 'string') return [];
  return txt.trim().split(/\n/).slice(1).map(l=>{
    const p=l.split(",");
    if (p.length < 5 || isNaN(p[1]) || isNaN(p[4])) return null;
    return {time:p[0],open:+p[1],high:+p[2],low:+p[3],close:+p[4],volume:+p[5]||1};
  }).filter(c=> c !== null && Number.isFinite(c.close) && c.close>0);
}

async function fetchCrypto(sym){
  const [tk,h1]=await Promise.all([
    fetchBinance(`/api/v3/ticker/24hr?symbol=${sym}`),
    fetchBinance(`/api/v3/klines?symbol=${sym}&interval=1h&limit=70`)
  ]);
  return {
    symbol:sym.replace("USDT",""), raw:sym, asset:"crypto", source:"Binance Dynamic", price:+tk.lastPrice,
    change24:+tk.priceChangePercent, candles:candlesFromBinance(h1)
  };
}

async function fetchStooq(item){
  const [label,code,asset]=item;
  const url=`https://stooq.com/q/d/l/?s=${code}&i=d`;
  const txt=await fetchTextFallback(url);
  const c=parseCsv(txt).slice(-120);
  if(c.length > 30) {
    return { symbol:label, raw:code, asset, source:"Stooq Matrix", price:c.at(-1)?.close, change24:(c.at(-1).close-c.at(-2).close)/c.at(-2).close*100, candles:c };
  }
  throw new Error("Insufficient data points");
}

async function getDynamicCryptoList() {
    try {
        const tickers = await fetchBinance("/api/v3/ticker/24hr");
        const top = tickers
            .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 8000000) 
            .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume)) 
            .slice(0, 60)
            .sort((a, b) => Math.abs(parseFloat(b.priceChangePercent)) - Math.abs(parseFloat(a.priceChangePercent))) 
            .slice(0, 45) 
            .map(t => t.symbol);
        
        const activeHistory = history.filter(h => !h.hit && h.asset === 'crypto').map(h => h.raw);
        return [...new Set([...top, ...activeHistory])];
    } catch(e) {
        return DEFAULT_CRYPTO;
    }
}

// ===================================================
// DYNAMIC PIPELINE MATRIX (With AI Weights)
// ===================================================
function scoreMarket(m){
  const cs=m.candles;
  const cl=cs.map(c=>c.close);
  const last=m.price||(cl.length?cl.at(-1):0);
  const one=cl.length>1?(cl.at(-1)-cl.at(-2))/cl.at(-2)*100:0;
  const r=rsi(cl),mc=macd(cl),at=atr(cs),atrPct=last?at/last*100:0;
  
  const qfl = getQFL(cs);
  const mmc = getMMC(cs);
  const smc = getCK_SMC(cs);
  const qb = getQBDelta(cs);

  let bull=0, bear=0, exp=0, reasons=[];

  // 1. QFL Base Crack
  if(qfl.cracked === 1) { bull += AI_WEIGHTS.QFL_BASE_CRACK; reasons.push("QFL Base Crack"); }
  if(qfl.cracked === -1) { bear += AI_WEIGHTS.QFL_BASE_CRACK; reasons.push("QFL Ceiling Crack"); }

  // 2. MMC Integration
  if(mmc.curveAligned && mmc.curveType.includes("Floor")) { bull += (AI_WEIGHTS.MMC_MIRROR_SYNC/2); reasons.push("MMC Arc Support"); exp += 10; }
  if(mmc.curveAligned && mmc.curveType.includes("Roof")) { bear += (AI_WEIGHTS.MMC_MIRROR_SYNC/2); reasons.push("MMC Arc Resist"); exp += 10; }
  if(mmc.mmcSignal === 1) { bull += AI_WEIGHTS.MMC_REJECTION_PIN; reasons.push(mmc.char); }
  if(mmc.mmcSignal === -1) { bear += AI_WEIGHTS.MMC_REJECTION_PIN; reasons.push(mmc.char); }

  // 3. SMC Logic
  if(smc.fvg === 1) { bull += AI_WEIGHTS.SMC_FVG; reasons.push("FVG Unmitigated"); }
  if(smc.fvg === -1) { bear += AI_WEIGHTS.SMC_FVG; reasons.push("FVG Unmitigated"); }
  if(smc.sweep === 1) { bull += AI_WEIGHTS.SMC_LIQUIDITY_SWEEP; exp += 10; }
  if(smc.sweep === -1) { bear += AI_WEIGHTS.SMC_LIQUIDITY_SWEEP; exp += 10; }

  // 4. QB Volume
  if(qb.deltaSurge) { exp += AI_WEIGHTS.QB_DELTA_SURGE; reasons.push("QB Liquidity Surge"); }
  
  if(mc.hist > 0) bull += AI_WEIGHTS.MOMENTUM_CONFIRMATION; else if(mc.hist < 0) bear += AI_WEIGHTS.MOMENTUM_CONFIRMATION;
  if(r < 40) bull += AI_WEIGHTS.MOMENTUM_CONFIRMATION; else if(r > 60) bear += AI_WEIGHTS.MOMENTUM_CONFIRMATION;

  const direction = bull - bear;
  let confidence = clamp(Math.round(Math.max(bull,bear) + (exp * 0.45)), 0, 100);
  
  if (Math.abs(one) > atrPct * 0.9) { confidence -= AI_WEIGHTS.CHASING_PENALTY; reasons.push("Over-extended (Skipped)"); }

  const targetConfluence = (qfl.cracked !== 0 || mmc.mmcSignal !== 0 || smc.smcScore >= 15 || smc.smcScore <= -15);
  
  const impendingUp = confidence >= 86 && direction > 35 && targetConfluence && qb.deltaSurge;
  const impendingDown = confidence >= 86 && direction < -35 && targetConfluence && qb.deltaSurge;
  
  const buy = !impendingUp && confidence >= MIN_ACTION_SCORE && direction > 25 && targetConfluence;
  const sell = !impendingDown && confidence >= MIN_ACTION_SCORE && direction < -25 && targetConfluence;

  let type="watch",label="WATCH",cls="watch";
  if(impendingUp){type="bigup";label="BIG UP (>15%)";cls="bigup"}
  else if(impendingDown){type="bigdown";label="BIG DOWN (>15%)";cls="bigdown"}
  else if(buy){type="buy";label="MMC BUY (>5%)";cls="buy"}
  else if(sell){type="sell";label="MMC SELL (>5%)";cls="sell"}
  else if(confidence<50){type="neutral";label="NEUTRAL";cls="neutral"}

  return {...m,price:last,one,volR:qb.ratio,rsi:r,macd:mc,atr:at,atrPct,bull,bear,expansion:exp,direction,quality:confidence,score:confidence,type,label,cls,reasons:reasons.slice(0,3),qfl,mmc,smc,qb};
}

function levels(s){
  const short=s.type==="sell"||s.type==="bigdown";
  const big=s.type.includes("big");
  const isCrypto = s.asset === "crypto";
  
  const at=s.atr||s.price*.012;
  const risk = 1.0 * at; 
  
  const baseTarget = isCrypto ? 0.052 : 0.005; 
  const bigTarget = isCrypto ? 0.155 : 0.015; 
  const targetPct = big ? bigTarget : baseTarget;
  
  const sign=short?-1:1;
  const sl=s.price-sign*risk;
  
  const tp1 = s.price + sign * (s.price * (targetPct * 0.5));
  const tp2 = s.price + sign * (s.price * targetPct);
  const tp3 = s.price + sign * (s.price * (targetPct * 1.5));
  
  return{short,sl,tp1,tp2,tp3,slPct:(sl-s.price)/s.price*100,tp1Pct:(tp1-s.price)/s.price*100,tp2Pct:(tp2-s.price)/s.price*100,tp3Pct:(tp3-s.price)/s.price*100,rr:Math.abs(tp2-s.price)/Math.abs(s.price-sl)};
}

function rowColor(v){return v>=0?"g":"r"}
function scoreColor(s){return s>=82?"var(--cyan)":s>=72?"var(--green)":s>=55?"var(--amber)":"var(--muted)"}

function filtered(){
  const q=$("search").value.trim().toLowerCase(),asset=$("assetFilter").value;
  return signals.filter(s=>(activeFilter==="all"||s.type===activeFilter)&&(asset==="all"||s.asset===asset)&&(!q||s.symbol.toLowerCase().includes(q)||s.raw.toLowerCase().includes(q)));
}

function renderScanner(){
  const rows=filtered();
  $("body").innerHTML=rows.length?rows.map(s=>renderRow(s)).join(""):`<tr><td colspan="12"><div class="empty">Matrix filtering active assets. No exact confluences this frame.</div></td></tr>`;
}

function renderRow(s){
  const open=expanded===s.raw,lv=levels(s);
  const qbVolFormat = s.qb.deltaSurge ? `<span class="g">x${fmt(s.volR,1)}</span>` : `<span class="muted">x${fmt(s.volR,1)}</span>`;
  const baseFormat = s.qfl.cracked !== 0 ? `<span class="${s.qfl.cracked===1?'g':'r'}">${s.qfl.status}</span>` : `<span class="dim">Intact</span>`;
  const smcFormat = Math.abs(s.smc.smcScore) > 0 ? `<span class="c">${s.smc.structure}</span>` : `<span class="dim">Ranging</span>`;
  const mmcCharFormat = s.mmc.mmcSignal !== 0 ? `<span class="${s.mmc.mmcSignal===1?'g':'r'}">${s.mmc.char}</span>` : `<span class="dim">${s.mmc.curveType}</span>`;

  let html=`<tr class="main" onclick="toggleExpand('${s.raw}')">
    <td><div class="sym">${s.symbol}</div><div class="asset">${s.asset.toUpperCase()}</div><div class="reasons">${(s.reasons&&s.reasons.join(" · "))||"Symmetric Drift"}</div></td>
    <td class="right"><strong>${price(s.price)}</strong></td>
    <td class="right ${rowColor(s.one)}">${pct(s.one)}</td>
    <td class="right ${rowColor(s.change24)}">${pct(s.change24)}</td>
    <td class="right">${qbVolFormat}</td>
    <td class="right ${fmt(s.rsi,0)>65?'r':fmt(s.rsi,0)<35?'g':''}">${fmt(s.rsi,0)}</td>
    <td class="right" style="font-weight:600">${baseFormat}</td>
    <td class="right" style="font-weight:600">${mmcCharFormat}</td>
    <td class="right" style="font-weight:600">${smcFormat}</td>
    <td class="right"><strong style="color:${scoreColor(s.score)}">${s.score}</strong><div class="bar"><div class="fill" style="width:${s.score}%;background:${scoreColor(s.score)}"></div></div></td>
    <td><span class="badge ${s.cls}">${s.label}</span></td>
    <td class="right" style="color:var(--muted)">${open?"▲":"▼"}</td>
  </tr>`;
  
  if(open){
    html+=`<tr class="expand"><td colspan="12">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div><strong style="font-size:16px; color:#fff">${s.symbol} Structural Plan</strong><span class="small" style="display:block; margin-top:4px">Target Profile: ${s.type.includes("big")?"> 15% Move Delivery":"> 5% Base Crack Delivery"}</span></div>
        <div style="text-align:right"><span class="small">Confluence Bias</span><br><b class="${s.direction>=0?"g":"r"}" style="font-size:18px">${s.direction}</b></div>
      </div>
      
      <div class="setup">
        <div class="box"><div class="label">${lv.short?"Short Entry Vector":"Long Entry Vector"}</div><div class="value">${price(s.price)}</div><div class="small w">Market execution</div></div>
        <div class="box"><div class="label">Structural Invalidation (SL)</div><div class="value r">${price(lv.sl)}</div><div class="small r">${pct(lv.slPct)}</div></div>
        <div class="box"><div class="label">TP1 · Liquidate 50%</div><div class="value g">${price(lv.tp1)}</div><div class="small g">${pct(lv.tp1Pct)}</div></div>
        <div class="box" style="border-color:var(--cyan); background:rgba(6, 182, 212, 0.05)"><div class="label" style="color:var(--cyan)">TP2 · Algorithmic Terminal</div><div class="value c">${price(lv.tp2)}</div><div class="small c">${pct(lv.tp2Pct)} · R:R ${fmt(lv.rr,1)}</div></div>
        <div class="box"><div class="label">TP3 · Momentum Runner</div><div class="value g">${price(lv.tp3)}</div><div class="small g">${pct(lv.tp3Pct)}</div></div>
      </div>
      
      <div class="three">
        <div class="analysis"><strong>CK Upgraded SMC + QFL</strong>
          <div class="row"><span>QFL Base Status</span><b>${s.qfl.status}</b></div>
          <div class="row"><span>SMC Market Structure</span><b class="w">${s.smc.structure}</b></div>
          <div class="row"><span>Liq. Sweep State</span><b class="${s.smc.sweep===1?'g':s.smc.sweep===-1?'r':''}">${s.smc.sweep===1?"SSL Swept":s.smc.sweep===-1?"BSL Swept":"Intact"}</b></div>
          <div class="row"><span>Fair Value Gap (FVG)</span><b>${s.smc.fvg===1?"Bullish Imbalance":s.smc.fvg===-1?"Bearish Imbalance":"Closed"}</b></div>
        </div>
        
        <div class="analysis" style="border-color:var(--cyan)"><strong>MMC Engine (Character & Curve)</strong>
          <div class="row"><span>Candle King Character</span><b class="w">${s.mmc.char}</b></div>
          <div class="row"><span>Curve Geometry</span><b>${s.mmc.curveType}</b></div>
          <div class="row"><span>Reflection Coordinate</span><b>${price(s.mmc.coordinate)}</b></div>
          <div class="row"><span>Deflection Force</span><b>${fmt(s.mmc.factor,2)}</b></div>
        </div>
        
        <div class="analysis" style="border-color:var(--violet)"><strong>GrowingBulls Volume Delta</strong>
          <div class="row"><span>Delta Profile</span><b>${s.qb.profile}</b></div>
          <div class="row"><span>Volume Multiplier</span><b>x${fmt(s.volR,2)}</b></div>
          <div class="row"><span>Delta Surge Signature</span><b class="p">${s.qb.deltaSurge?"Detected":"Standard"}</b></div>
          <div class="row"><span>Active Targets</span><b>${s.reasons.join(", ") || "Scanning Vector"}</b></div>
        </div>
      </div>
    </td></tr>`;
  }
  return html;
}

function toggleExpand(raw){ expanded=expanded===raw?null:raw; renderScanner(); }

function renderHistory(){
  if(!history.length){$("histBody").innerHTML=`<tr><td colspan="6"><div class="empty">History prints once a valid configuration executes.</div></td></tr>`;return}
  $("histBody").innerHTML=history.slice().reverse().map(h=>`<tr><td>${new Date(h.ts).toLocaleTimeString()}</td><td><strong>${h.symbol}</strong><div class="asset">${h.asset}</div></td><td><span class="badge ${h.cls}">${h.label}</span></td><td class="right">${price(h.entry)}</td><td class="right ${h.best>=0?"g":"r"}">${pct(h.best||0)}</td><td>${h.reasons.join(" · ")}</td></tr>`).join("");
}

function renderPerformance(){
  const settled=history.filter(h=>h.hit);
  const wins=settled.filter(h=>h.hit==="target"),loss=settled.filter(h=>h.hit==="stop");
  $("mTracked").textContent=history.length;
  $("pSettled").textContent=settled.length;
  $("pWins").textContent=wins.length;
  $("pLosses").textContent=loss.length;
  $("mWin").textContent=settled.length?Math.round(wins.length/settled.length*100)+"%":"-";
  $("pBest").textContent=history.length?pct(Math.max(...history.map(h=>h.best||0))):"-";
  
  $("perfBody").innerHTML=history.length?history.slice().reverse().map(h=>{
    const statHtml = h.hit==="target"?"<span style='color:var(--green)'>Target Hit</span>":h.hit==="stop"?"<span style='color:var(--brand-red)'>Stop Hit</span>":"<span style='color:var(--amber)'>Active</span>";
    return `<tr>
      <td><strong>${h.symbol}</strong></td>
      <td><span class="badge ${h.cls}">${h.label}</span></td>
      <td class="right">${price(h.entry)}</td>
      <td class="right g">${price(h.tp2)}</td>
      <td class="right r">${price(h.sl)}</td>
      <td class="right">${price(h.current||h.entry)}</td>
      <td class="right ${h.best>=0?"g":"r"}">${pct(h.best||0)}</td>
      <td class="right">${statHtml}</td>
    </tr>`;
  }).join(""):`<tr><td colspan="8"><div class="empty">No active structural positions.</div></td></tr>`;
}

// AI Feature Saving injected into history
function trackNew(list){
  const actionable=list.filter(s=>["buy","sell","bigup","bigdown"].includes(s.type));
  const fresh=[];
  for(const s of actionable){
    const key=s.raw+":"+s.type;
    if(history.some(h=>h.key===key&&Date.now()-h.ts<60*60*1000)) continue;
    const lv=levels(s);
    history.push({
      key,symbol:s.symbol,raw:s.raw,asset:s.asset,label:s.label,type:s.type,cls:s.cls,entry:s.price,current:s.price,best:0,ts:Date.now(),reasons:s.reasons,tp2:lv.tp2,sl:lv.sl,short:lv.short,hit:false,
      // Store AI Features at time of execution
      rsi: s.rsi, volR: s.volR, atrPct: s.atrPct, qflTrigger: s.qfl.cracked, mmcSignal: s.mmc.mmcSignal, smcScore: s.smc.smcScore
    });
    fresh.push(s);
  }
  if(history.length>200) history=history.slice(-200); 
  return fresh;
}

function updateTracked(){
  let uiNeedsUpdate = false;
  for(const h of history){
    if(!h.hit){
      const s=allScored.find(x=>x.raw===h.raw); 
      if(!s) continue; 
      
      h.current=s.price;
      const move=(h.current-h.entry)/h.entry*100*(h.short?-1:1);
      
      if(h.best === undefined) h.best = 0;
      if(move > h.best) h.best = move;
      
      const hitTarget=h.short?h.current<=h.tp2:h.current>=h.tp2;
      const hitStop=h.short?h.current>=h.sl:h.current<=h.sl;
      
      if(hitTarget) h.hit="target";
      else if(hitStop) h.hit="stop";
      
      uiNeedsUpdate = true;
    }
  }
  if(uiNeedsUpdate || history.length > 0){
    renderHistory();
    renderPerformance();
  }
}

function selectBestSignals(list){
  const sorted = list.sort((a,b) => b.score - a.score);
  return sorted.slice(0, MAX_ROWS);
}

async function runScan(){
  if($("scanBtn").disabled) return; 
  const id=++scanId, t0=performance.now();
  countdown=90; 
  
  $("scanBtn").disabled=true;
  $("scanBtn").innerHTML=`<span class="spinner"></span> Scanning`;
  $("status").textContent="Scanning Matrix Pipeline...";
  $("dot").className="dot scan";
  
  try{
    const btc=await fetchCrypto("BTCUSDT").catch(()=>null);
    btc24=btc?+btc.change24:0;
    $("btcPrice").textContent=btc?price(btc.price):"-";
    $("btcChange").textContent=btc?pct(btc.change24):"live unavailable";
    $("btcChange").className="small "+(btc&&btc.change24>=0?"g":btc?"r":"a");
    
    const targetCryptoList = await getDynamicCryptoList();
    
    const all=[];
    for(let i=0; i<targetCryptoList.length; i+=8){
      const chunk=await Promise.allSettled(targetCryptoList.slice(i,i+8).map(fetchCrypto));
      chunk.forEach(x=>{
        if(x.status==="fulfilled" && x.value.candles && x.value.candles.length>45) all.push(x.value);
      });
    }
    
    const other=await Promise.allSettled(STOOQ.map(fetchStooq));
    other.forEach(x=>{
      if(x.status==="fulfilled" && x.value.candles && x.value.candles.length>30) all.push(x.value);
    });
    
    if(id!==scanId) return;
    if(all.length === 0) throw new Error("No market data fetched");

    allScored = all.map(scoreMarket); 
    signals = selectBestSignals(allScored);
    
    const fresh = trackNew(signals);
    updateTracked();
    renderScanner();
    renderMetrics(t0, all.length);
    alertPanel(fresh);
    
    $("status").textContent=`${all.length} assets mapped`;
    $("dot").className="dot";
  }catch(e){
    console.error("Scanner Error:", e);
    $("status").textContent=`API Error · Retrying...`;
    $("dot").className="dot err";
    toast("Connection error. Retrying in background...", "sell");
  }finally{
    $("scanBtn").disabled=false;
    $("scanBtn").textContent="Execute Scan";
    countdown=90;
  }
}

function renderMetrics(t0, totalCount){
  const c=t=>signals.filter(s=>s.type===t).length;
  $("mBuy").textContent=c("buy");
  $("mSell").textContent=c("sell");
  $("mBigUp").textContent=c("bigup");
  $("mBigDown").textContent=c("bigdown");
  $("mWatch").textContent=c("watch") + c("neutral");
  $("mAvg").textContent=signals.length?Math.round(avg(signals.map(s=>s.score))):"-";
  $("universe").textContent=`${totalCount} markets monitored`;
  $("lastScan").textContent=now();
  $("latency").textContent=fmt((performance.now()-t0)/1000,1)+"s";
  
  const breadth=c("buy")+c("bigup")-(c("sell")+c("bigdown"));
  $("marketBias").textContent=breadth>3?"Bullish Matrix":breadth<-3?"Bearish Matrix":"Symmetric Matrix";
  $("marketBias").className="value "+(breadth>3?"g":breadth<-3?"r":"w");
  $("biasText").textContent=`breadth ${breadth}, BTC ${pct(btc24)}`;
  
  const exp=Math.round(avg(signals.map(s=>s.expansion||0)));
  $("expansionRisk").textContent=exp>38?"High Variance":exp>24?"Medium Variance":"Low Variance";
  $("expansionRisk").className="value "+(exp>38?"r":exp>24?"a":"w");
}

function alertPanel(fresh){
  const bigs=signals.filter(s=>s.type==="bigup"||s.type==="bigdown").slice(0,8),panel=$("moveAlert");
  if(bigs.length){
    const down=bigs.filter(s=>s.type==="bigdown").length>bigs.length/2;
    panel.className="alert show "+(down?"down":"up");
    $("alertIco").textContent=down?"DOWN":"UP";
    $("alertTitle").textContent="SMC Structure Execution Alert";
    $("alertText").textContent="Asset has successfully breached SMC Structure (CHOCH/BOS) with QFL confirmation."; 
    $("alertCount").textContent=bigs.length;
    $("alertChips").innerHTML=bigs.map(s=>`<span class="chip ${s.type==="bigdown"?"down":"up"}">${s.symbol} ${s.score}</span>`).join("");
  } else { panel.className="alert"; }
  
  const noisy=fresh.filter(s=>Date.now()-(lastAlert.get(s.raw+s.type)||0)>45*60*1000);
  if(noisy.length){
    const first=noisy[0];
    noisy.forEach(s=>lastAlert.set(s.raw+s.type,Date.now()));
    beep(first.type);
    toast(`${first.label}: ${noisy.slice(0,4).map(s=>s.symbol).join(", ")}`,first.type==="sell"||first.type==="bigdown"?"sell":"buy");
  }
}

function setFilter(btn){
  document.querySelectorAll(".pill").forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
  activeFilter=btn.dataset.filter;
  renderScanner();
}

function switchTab(btn){
  document.querySelectorAll(".tab").forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
  ["scanner","history","performance"].forEach(t=>$("tab-"+t).classList.toggle("hide",btn.dataset.tab!==t));
  renderHistory();
  renderPerformance();
}

setInterval(()=>{
  if($("scanBtn").disabled) return; 
  countdown--;
  if(countdown<=0) runScan();
  else { $("timer").textContent=countdown+"s"; $("nextScan").textContent=countdown+"s"; }
},1000);

runScan();