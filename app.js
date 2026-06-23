// ==========================================
// 🧠 AI DYNAMIC WEIGHT CONFIGURATION
// Update after running your Python Trainer
// ==========================================
const AI_WEIGHTS = {
  QFL_BASE_CRACK: 22,
  MMC_MIRROR_SYNC: 28,
  MMC_REJECTION_PIN: 16,
  SMC_FVG: 14,
  SMC_LIQUIDITY_SWEEP: 22,
  QB_DELTA_SURGE: 18,
  MOMENTUM_CONFIRMATION: 6,
  VELOCITY_SURGE: 20,         // NEW: Pre-move velocity
  ORDER_BLOCK_TOUCH: 18,      // NEW: Order block confluence
  DIVERGENCE_SIGNAL: 16,      // NEW: RSI/Price divergence
  CHASING_PENALTY: 38
};
// ==========================================

const DEFAULT_CRYPTO = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT","SUIUSDT","PEPEUSDT","WIFUSDT"];
const STOOQ = [["EURUSD","eurusd","forex"],["GBPUSD","gbpusd","forex"],["USDJPY","usdjpy","forex"],["XAUUSD","xauusd","metal"],["WTI OIL","cl.f","energy"]];

const MAX_ROWS = 35;
const MIN_ACTION_SCORE = 78;
const MIN_WATCH_SCORE = 60;
const MIN_CONFLUENCE = 2;
const MIN_SMC_SCORE = 10;

let signals=[], allScored=[], history=[], activeFilter="all", expanded=null,
    countdown=90, scanId=0, lastAlert=new Map(), soundOn=false, audioCtx=null, btc24=0;

function $(id){ return document.getElementById(id); }
function fmt(n,d=2){ return Number.isFinite(+n) ? Number(n).toFixed(d) : "-"; }
function pct(n){ return (n>=0?"+":"")+fmt(n,2)+"%"; }
function price(v){ v=+v; if(!Number.isFinite(v))return"-"; if(v>=1000)return v.toLocaleString("en",{maximumFractionDigits:2}); if(v>=1)return fmt(v,4); return fmt(v,6); }
function now(){ return new Date().toLocaleTimeString(); }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
function avg(arr){ return arr&&arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

// ==========================================
// AI EXPORT MODULE (Enhanced for Local Training)
// ==========================================
function exportToExcel() {
  const settledTrades = history.filter(h => h.hit === "target" || h.hit === "stop");
  if(settledTrades.length === 0) {
    alert("No settled trades yet. Run scanner and wait for TP or SL to hit first.");
    return;
  }

  let csvContent = [
    "Symbol,Signal,RSI,VolumeRatio,ATR_Pct,QFL_Trigger,QFL_Depth,",
    "MMC_Signal,MMC_Factor,MMC_CurveAligned,SMC_Score,SMC_FVG,SMC_Sweep,",
    "QB_Ratio,Velocity_Score,OB_Touch,Divergence,MTF_Align,",
    "PreMove_Score,Entry_Price,SL_Pct,TP_Pct,Hold_Minutes,Best_Excursion,Result"
  ].join("").replace(/\n/g,"") + "\n";

  settledTrades.forEach(t => {
    const result = t.hit === "target" ? 1 : 0;
    const holdMins = t.closeTs ? Math.round((t.closeTs - t.ts)/60000) : 0;
    const row = [
      t.symbol, t.type,
      fmt(t.rsi||50,1), fmt(t.volR||1,2), fmt(t.atrPct||1,2),
      t.qflTrigger||0, fmt(t.qflDepth||0,2),
      t.mmcSignal||0, fmt(t.mmcFactor||0,2), t.mmcCurveAligned||0,
      t.smcScore||0, t.smcFVG||0, t.smcSweep||0,
      fmt(t.qbRatio||1,2),
      fmt(t.velocityScore||0,1), t.obTouch||0, t.divergence||0, t.mtfAlign||0,
      fmt(t.preMoveScore||0,1),
      fmt(t.entry,6), fmt(t.slPct||0,2), fmt(t.tp2Pct||0,2),
      holdMins, fmt(t.best||0,2),
      result
    ].join(",");
    csvContent += row + "\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ck_training_data_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
}

// ==========================================
// AUDIO & TOAST
// ==========================================
function toast(msg, type="info") {
  const t = $("toast");
  $("toastMsg").textContent = msg;
  $("toastIcon").textContent = type==="sell"?"SELL":type==="buy"?"BUY":"ALERT";
  t.style.borderLeftColor = type==="sell"?"var(--brand-red)":type==="buy"?"var(--green)":"#fff";
  t.classList.add("show");
  clearTimeout(t._x);
  t._x = setTimeout(()=>t.classList.remove("show"), 4500);
}

function beep(type) {
  if(!soundOn) return;
  try {
    if(!audioCtx) audioCtx = new(window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume();
    const seq = type==="sell"?[330,247,196]:type==="bigdown"?[523,392,294,220]:[523,659,784,1047];
    seq.forEach((f,i) => {
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = type.includes("down")||type==="sell"?"sawtooth":"sine";
      o.frequency.value = f;
      const at = audioCtx.currentTime + i*.13;
      g.gain.setValueAtTime(0,at);
      g.gain.linearRampToValueAtTime(.11,at+.03);
      g.gain.linearRampToValueAtTime(0,at+.12);
      o.start(at); o.stop(at+.13);
    });
  } catch(e) {}
}

function toggleSound() {
  soundOn = !soundOn;
  $("soundBtn").textContent = soundOn ? "Alerts: ON" : "Alerts: OFF";
  $("soundBtn").classList.toggle("on", soundOn);
  if(soundOn) {
    try { if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); } catch(e) {}
    toast("Audio Alerts Enabled");
  }
}

// ==========================================
// CORE MATH ENGINES
// ==========================================
function emaSeries(values, p) {
  if(!values || values.length < p) return [];
  const k = 2/(p+1);
  const out = new Array(values.length).fill(0);
  let sum = 0;
  for(let i=0;i<p;i++) sum += (values[i]||0);
  let ema = sum/p;
  for(let i=0;i<p;i++) out[i]=ema;
  for(let i=p;i<values.length;i++) { ema = (values[i]-ema)*k+ema; out[i]=ema; }
  return out;
}

function macd(closes) {
  if(!closes||closes.length<35) return {macd:0,signal:0,hist:0,prevHist:0};
  const e12=emaSeries(closes,12), e26=emaSeries(closes,26);
  const line = new Array(closes.length).fill(0);
  for(let i=0;i<closes.length;i++) line[i]=e12[i]-e26[i];
  const sig = emaSeries(line,9);
  const m=line.at(-1)||0, s=sig.at(-1)||0, pm=line.at(-2)||0, ps=sig.at(-2)||0;
  return {macd:m,signal:s,hist:m-s,prevHist:pm-ps};
}

function rsi(closes, p=14) {
  if(!closes||closes.length<p+1) return 50;
  let gains=0, losses=0;
  for(let i=1;i<=p;i++) { const d=closes[i]-closes[i-1]; if(d>=0)gains+=d; else losses-=d; }
  let avgG=gains/p, avgL=losses/p;
  for(let i=p+1;i<closes.length;i++) {
    const d=closes[i]-closes[i-1];
    avgG=(avgG*(p-1)+Math.max(d,0))/p;
    avgL=(avgL*(p-1)+Math.max(-d,0))/p;
  }
  if(avgL===0) return 100;
  return 100-100/(1+avgG/avgL);
}

function atr(candles, p=14) {
  if(!candles||candles.length===0) return 0;
  if(candles.length<p+1) return (candles.at(-1)?.close||0)*.012;
  const trs=[];
  for(let i=1;i<candles.length;i++) {
    const c=candles[i], prev=candles[i-1].close;
    trs.push(Math.max(c.high-c.low, Math.abs(c.high-prev), Math.abs(c.low-prev)));
  }
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}

// ==========================================
// ENGINE 1: QFL BASE CRACK (Enhanced)
// ==========================================
function getQFL(candles) {
  if(!candles||candles.length<50) return {status:"Searching",cracked:0,depth:0,basePrice:0,strength:0};
  const len = candles.length;

  // Find the true base (cluster of lows in the accumulation zone)
  let basePrice = Infinity, baseCount = 0;
  for(let i=len-45;i<len-5;i++) {
    if(candles[i].low < basePrice) { basePrice = candles[i].low; baseCount = 0; }
    if(Math.abs(candles[i].low - basePrice) / basePrice < 0.005) baseCount++;
  }

  const currentPrice = candles[len-1].close;
  let status="Above Base", cracked=0, depth=0, strength=0;

  if(currentPrice < basePrice) {
    cracked = 1;
    depth = ((basePrice - currentPrice) / basePrice) * 100;
    strength = Math.min(baseCount * 10, 50); // stronger base = higher strength
    status = `Base Cracked (-${fmt(depth,1)}%)`;
  } else {
    let ceilingPrice = 0, ceilCount = 0;
    for(let i=len-45;i<len-5;i++) {
      if(candles[i].high > ceilingPrice) { ceilingPrice = candles[i].high; ceilCount = 0; }
      if(Math.abs(candles[i].high - ceilingPrice) / ceilingPrice < 0.005) ceilCount++;
    }
    if(currentPrice > ceilingPrice) {
      cracked = -1;
      depth = ((currentPrice - ceilingPrice) / ceilingPrice) * 100;
      strength = Math.min(ceilCount * 10, 50);
      status = `Ceil Cracked (+${fmt(depth,1)}%)`;
      basePrice = ceilingPrice;
    }
  }
  return {status, cracked, depth, basePrice, strength};
}

// ==========================================
// ENGINE 2: MMC PARABOLIC MIRROR + CHARACTERS
// ==========================================
function getMMC(candles) {
  if(!candles||candles.length<30) return {curveAligned:false,curveType:"Linear",char:"Normal",factor:0,coordinate:0,mmcSignal:0};
  const len = candles.length;
  const current = candles[len-1];
  const prev = candles[len-2];

  let prices = candles.slice(-25).map(c=>c.close);
  let median = prices.reduce((a,b)=>a+b,0)/prices.length;
  const displacement = current.close - median;
  const velocity = Math.abs(current.close - current.open);
  const reflectionFactor = velocity > 0 ? Math.abs(displacement/velocity) : 0;

  let curveAligned = false, curveType = "Flat";
  if(displacement < 0 && reflectionFactor > 2.0) { curveAligned=true; curveType="Arc Floor (Bull)"; }
  else if(displacement > 0 && reflectionFactor > 2.0) { curveAligned=true; curveType="Arc Roof (Bear)"; }

  let char="Standard", mmcSignal=0;
  const range = current.high - current.low;
  const body = Math.abs(current.open - current.close);

  if(range > 0) {
    const lowerWick = Math.min(current.open,current.close) - current.low;
    const upperWick = current.high - Math.max(current.open,current.close);
    if(body/range < 0.15 && lowerWick > upperWick*2) { char="Bullish Pin Trap"; mmcSignal=1; }
    else if(body/range < 0.15 && upperWick > lowerWick*2) { char="Bearish Pin Trap"; mmcSignal=-1; }
    else if(body/range < 0.1) { char="Doji Indecision"; }
  }
  const pRange = prev.high - prev.low;
  if(current.close > prev.high && body > pRange*1.1) { char="Bullish Engulf Displace"; mmcSignal=1; }
  if(current.close < prev.low && body > pRange*1.1) { char="Bearish Engulf Displace"; mmcSignal=-1; }

  return {curveAligned, coordinate:median-displacement, factor:reflectionFactor, curveType, char, mmcSignal};
}

// ==========================================
// ENGINE 3: CK UPGRADED SMC (CHOCH/BOS/FVG/LIQ)
// ==========================================
function getCK_SMC(candles) {
  if(!candles||candles.length<25) return {fvg:0,sweep:0,structure:"Consolidation",smcScore:0};
  let fvg=0, sweep=0, structure="Ranging", smcScore=0;
  const len = candles.length;

  for(let i=len-5;i<len-2;i++) {
    if(candles[i]&&candles[i+2]) {
      if(candles[i].high < candles[i+2].low*0.9995) { fvg=1; smcScore+=12; }
      if(candles[i].low > candles[i+2].high*1.0005) { fvg=-1; smcScore-=12; }
    }
  }

  let maxH=0, minL=Infinity;
  for(let i=len-25;i<len-3;i++) {
    if(candles[i]&&candles[i].high>maxH) maxH=candles[i].high;
    if(candles[i]&&candles[i].low<minL) minL=candles[i].low;
  }
  const current=candles[len-1], prev=candles[len-2];
  if(prev&&current) {
    if(prev.low<minL && current.close>minL) { sweep=1; smcScore+=18; }
    if(prev.high>maxH && current.close<maxH) { sweep=-1; smcScore-=18; }
  }

  let recentHigh=0, recentLow=Infinity;
  for(let i=len-10;i<len-2;i++) {
    if(candles[i]&&candles[i].high>recentHigh) recentHigh=candles[i].high;
    if(candles[i]&&candles[i].low<recentLow) recentLow=candles[i].low;
  }
  if(current.close>maxH) { structure="BOS Uptrend"; smcScore+=10; }
  else if(current.close<minL) { structure="BOS Downtrend"; smcScore-=10; }
  else if(current.close>recentHigh && prev.close<recentHigh) { structure="Bullish CHOCH"; smcScore+=22; }
  else if(current.close<recentLow && prev.close>recentLow) { structure="Bearish CHOCH"; smcScore-=22; }

  return {fvg, sweep, structure, smcScore};
}

// ==========================================
// ENGINE 4: QB DELTA VOLUME ENGINE
// ==========================================
function getQBDelta(candles) {
  if(!candles||candles.length<10) return {profile:"Neutral Delta",deltaSurge:false,ratio:1.0};
  const len = candles.length;
  const currentVol = candles[len-1].volume||1;
  const recentVols = candles.slice(-10,-1).map(c=>c.volume||1);
  const avgVol = recentVols.reduce((a,b)=>a+b,0)/recentVols.length;
  const ratio = currentVol/avgVol;
  let deltaSurge = ratio > 1.35;
  let profile = ratio>2.0 ? "QB Volatility Spike" : ratio>1.35 ? "QB Institutional Accum" : "Low Beta Rotation";
  return {profile, deltaSurge, ratio};
}

// ==========================================
// ENGINE 5: PRE-MOVE VELOCITY DETECTOR (NEW)
// Detects BEFORE the move — coiling, compression, breakout setup
// ==========================================
function getVelocityEngine(candles) {
  if(!candles||candles.length<20) return {score:0,phase:"Unknown",coiling:false,breakoutDir:0,compressionPct:0};
  const len = candles.length;

  // Measure price range compression over last 5 candles vs prior 15
  const recent = candles.slice(-5);
  const prior = candles.slice(-20,-5);

  const recentRange = Math.max(...recent.map(c=>c.high)) - Math.min(...recent.map(c=>c.low));
  const priorRange = Math.max(...prior.map(c=>c.high)) - Math.min(...prior.map(c=>c.low));
  const midPrice = candles[len-1].close;

  const compressionPct = priorRange > 0 ? (recentRange / priorRange) * 100 : 100;
  const coiling = compressionPct < 35; // Recent range < 35% of prior = coil forming

  // Velocity: rate of close change over last 3 candles
  const closes3 = candles.slice(-4).map(c=>c.close);
  const vel1 = closes3[3]-closes3[2], vel2 = closes3[2]-closes3[1], vel3 = closes3[1]-closes3[0];

  // Accelerating in one direction = pre-move
  const acceleratingUp = vel1>0 && vel2>0 && vel3>0 && vel1>vel2;
  const acceleratingDown = vel1<0 && vel2<0 && vel3<0 && Math.abs(vel1)>Math.abs(vel2);

  // Volume building during compression = smart money accumulating
  const recentVols = recent.map(c=>c.volume||1);
  const priorVols = prior.map(c=>c.volume||1);
  const volBuilding = avg(recentVols) > avg(priorVols) * 1.2;

  // Momentum slope: are we curling up or down at the coil boundary?
  const recentHigh = Math.max(...recent.map(c=>c.high));
  const recentLow = Math.min(...recent.map(c=>c.low));
  const curPrice = candles[len-1].close;
  const posInRange = recentRange>0 ? (curPrice-recentLow)/recentRange : 0.5;

  let breakoutDir = 0;
  if(coiling && acceleratingUp) breakoutDir = 1;
  if(coiling && acceleratingDown) breakoutDir = -1;
  if(!coiling && posInRange > 0.8 && vel1>0) breakoutDir = 1;  // Breaking upper
  if(!coiling && posInRange < 0.2 && vel1<0) breakoutDir = -1; // Breaking lower

  let score = 0;
  if(coiling) score += 30;
  if(acceleratingUp || acceleratingDown) score += 25;
  if(volBuilding) score += 25;
  if(Math.abs(breakoutDir) > 0) score += 20;

  let phase = "Drifting";
  if(coiling && !acceleratingUp && !acceleratingDown) phase = "Coiling (Pre-Move)";
  else if(coiling && breakoutDir !== 0) phase = breakoutDir>0 ? "Bull Coil Expanding" : "Bear Coil Expanding";
  else if(acceleratingUp) phase = "Upward Acceleration";
  else if(acceleratingDown) phase = "Downward Acceleration";
  else if(compressionPct > 150) phase = "Expansion Active";

  return {score, phase, coiling, breakoutDir, compressionPct: Math.round(compressionPct), volBuilding};
}

// ==========================================
// ENGINE 6: ORDER BLOCK DETECTOR (NEW)
// Finds institutional buy/sell zones before price arrives
// ==========================================
function getOrderBlocks(candles) {
  if(!candles||candles.length<30) return {bullOB:null,bearOB:null,touch:0,obLabel:"None",distPct:0};
  const len = candles.length;
  const current = candles[len-1].close;

  let bullOB = null, bearOB = null;

  // Bullish OB: Last big bearish candle before a strong up move
  for(let i=len-25;i<len-5;i++) {
    const c = candles[i];
    if(!c) continue;
    const body = Math.abs(c.open-c.close);
    const range = c.high-c.low;
    const isBearCandle = c.close < c.open;
    // Check if followed by strong up move (displacement)
    const followUp = candles.slice(i+1,i+4);
    const followedByUp = followUp.some(fc=>fc && fc.close > c.high);
    if(isBearCandle && body/range>0.65 && followedByUp) {
      bullOB = {top:c.open, bottom:c.close, mid:(c.open+c.close)/2, index:i};
    }
  }

  // Bearish OB: Last big bullish candle before a strong down move
  for(let i=len-25;i<len-5;i++) {
    const c = candles[i];
    if(!c) continue;
    const body = Math.abs(c.open-c.close);
    const range = c.high-c.low;
    const isBullCandle = c.close > c.open;
    const followDown = candles.slice(i+1,i+4);
    const followedByDown = followDown.some(fc=>fc && fc.close < c.low);
    if(isBullCandle && body/range>0.65 && followedByDown) {
      bearOB = {top:c.close, bottom:c.open, mid:(c.open+c.close)/2, index:i};
    }
  }

  // Is current price touching/testing an OB? (within 0.5%)
  let touch = 0, obLabel = "None", distPct = 0;
  if(bullOB && Math.abs(current-bullOB.mid)/bullOB.mid < 0.005) {
    touch = 1; obLabel = `Bull OB @ ${price(bullOB.mid)}`; distPct = (current-bullOB.bottom)/bullOB.bottom*100;
  }
  if(bearOB && Math.abs(current-bearOB.mid)/bearOB.mid < 0.005) {
    touch = -1; obLabel = `Bear OB @ ${price(bearOB.mid)}`; distPct = (bearOB.top-current)/bearOB.top*100;
  }

  return {bullOB, bearOB, touch, obLabel, distPct};
}

// ==========================================
// ENGINE 7: RSI + PRICE DIVERGENCE (NEW)
// Hidden divergence = strongest pre-move signal
// ==========================================
function getDivergence(candles) {
  if(!candles||candles.length<30) return {type:"None",signal:0,strength:0};
  const len = candles.length;
  const closes = candles.map(c=>c.close);

  // Get RSI values for lookback
  function rsiAt(endIdx, period=14) {
    const sub = closes.slice(Math.max(0,endIdx-period-5), endIdx+1);
    return rsi(sub);
  }

  // Compare pivot: current vs 10 candles ago
  const lookback = 15;
  const prevPivotIdx = len - lookback;
  const curIdx = len - 1;

  const pricePrev = closes[prevPivotIdx] || closes[0];
  const priceCur = closes[curIdx];
  const rsiPrev = rsiAt(prevPivotIdx);
  const rsiCur = rsiAt(curIdx);

  const priceUp = priceCur > pricePrev;
  const priceDown = priceCur < pricePrev;
  const rsiUp = rsiCur > rsiPrev;
  const rsiDown = rsiCur < rsiPrev;

  let type = "None", signal = 0, strength = 0;
  const priceDiff = Math.abs(priceCur-pricePrev)/pricePrev*100;
  const rsiDiff = Math.abs(rsiCur-rsiPrev);

  // Regular Divergence (reversal signal)
  if(priceUp && rsiDown && rsiDiff > 5) { type="Regular Bearish Div"; signal=-1; strength=Math.min(rsiDiff*2, 50); }
  if(priceDown && rsiUp && rsiDiff > 5) { type="Regular Bullish Div"; signal=1; strength=Math.min(rsiDiff*2, 50); }
  // Hidden Divergence (continuation signal — strongest pre-move)
  if(priceUp && rsiUp && rsiCur < 55 && rsiDiff > 3) { type="Hidden Bull Div"; signal=1; strength=Math.min(rsiDiff*3, 60); }
  if(priceDown && rsiDown && rsiCur > 45 && rsiDiff > 3) { type="Hidden Bear Div"; signal=-1; strength=Math.min(rsiDiff*3, 60); }

  return {type, signal, strength, rsiCur: Math.round(rsiCur), rsiPrev: Math.round(rsiPrev)};
}

// ==========================================
// ENGINE 8: MULTI-TIMEFRAME ALIGNMENT (Simulated via candle grouping)
// ==========================================
function getMTFAlign(candles) {
  if(!candles||candles.length<60) return {align:0,h4Bias:0,h1Bias:0,label:"Insufficient Data"};

  // H4 simulated: group last 60 1H candles into 15 x 4H candles
  const h4Candles = [];
  for(let i=0;i<candles.length-3;i+=4) {
    const group = candles.slice(i,i+4);
    if(group.length<4) continue;
    h4Candles.push({
      open:group[0].open, high:Math.max(...group.map(c=>c.high)),
      low:Math.min(...group.map(c=>c.low)), close:group[3].close,
      volume:group.reduce((a,c)=>a+(c.volume||0),0)
    });
  }

  const h1Closes = candles.slice(-20).map(c=>c.close);
  const h4Closes = h4Candles.slice(-10).map(c=>c.close);

  const h1Trend = h1Closes.at(-1) > h1Closes[0] ? 1 : -1;
  const h4Trend = h4Closes.length>1 ? (h4Closes.at(-1) > h4Closes[0] ? 1 : -1) : 0;

  // EMA alignment
  const h1EMA = emaSeries(h1Closes,9);
  const h1AboveEMA = h1Closes.at(-1) > (h1EMA.at(-1)||h1Closes.at(-1));

  let align = 0;
  if(h1Trend===1 && h4Trend===1) align=1;
  else if(h1Trend===-1 && h4Trend===-1) align=-1;

  const label = align===1 ? "All TF Bullish" : align===-1 ? "All TF Bearish" : "TF Conflict";
  return {align, h4Bias:h4Trend, h1Bias:h1Trend, label};
}

// ==========================================
// DATA PIPELINE
// ==========================================
const BINANCE_HOSTS = ["https://api.binance.com","https://api1.binance.com","https://api2.binance.com"];

async function fetchBinance(path) {
  let lastErr;
  for(const host of BINANCE_HOSTS) {
    try {
      const r = await fetch(host+path, {cache:"no-store"});
      if(r.ok) return r.json();
      if(r.status===429) { await new Promise(res=>setTimeout(res,1000)); continue; }
      lastErr = new Error(host+" "+r.status);
    } catch(e) { lastErr=e; }
  }
  throw lastErr||new Error("Binance API Blocked");
}

async function fetchTextFallback(url) {
  const urls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`
  ];
  let lastErr;
  for(const u of urls) {
    try {
      const r = await fetch(u, {cache:"no-store"});
      if(r.ok) {
        const txt = await r.text();
        if(txt.toLowerCase().includes("date,open,high,low,close")) return txt;
      }
      lastErr = new Error("Invalid proxy response");
    } catch(e) { lastErr=e; }
  }
  throw lastErr||new Error("Proxies blocked");
}

function candlesFromBinance(rows) {
  if(!Array.isArray(rows)) return [];
  return rows.map(r=>({time:r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]})).filter(c=>Number.isFinite(c.close));
}

function parseCsv(txt) {
  if(typeof txt!=='string') return [];
  return txt.trim().split(/\n/).slice(1).map(l=>{
    const p=l.split(",");
    if(p.length<5||isNaN(p[1])||isNaN(p[4])) return null;
    return {time:p[0],open:+p[1],high:+p[2],low:+p[3],close:+p[4],volume:+p[5]||1};
  }).filter(c=>c!==null&&Number.isFinite(c.close)&&c.close>0);
}

async function fetchCrypto(sym) {
  const [tk,h1] = await Promise.all([
    fetchBinance(`/api/v3/ticker/24hr?symbol=${sym}`),
    fetchBinance(`/api/v3/klines?symbol=${sym}&interval=1h&limit=80`)
  ]);
  return {
    symbol:sym.replace("USDT",""), raw:sym, asset:"crypto", source:"Binance",
    price:+tk.lastPrice, change24:+tk.priceChangePercent, candles:candlesFromBinance(h1)
  };
}

async function fetchStooq(item) {
  const [label,code,asset] = item;
  const url = `https://stooq.com/q/d/l/?s=${code}&i=d`;
  const txt = await fetchTextFallback(url);
  const c = parseCsv(txt).slice(-120);
  if(c.length>30) {
    return {symbol:label, raw:code, asset, source:"Stooq", price:c.at(-1)?.close,
            change24:(c.at(-1).close-c.at(-2).close)/c.at(-2).close*100, candles:c};
  }
  throw new Error("Insufficient data");
}

async function getDynamicCryptoList() {
  try {
    const tickers = await fetchBinance("/api/v3/ticker/24hr");
    const top = tickers
      .filter(t=>t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume)>8000000)
      .sort((a,b)=>parseFloat(b.quoteVolume)-parseFloat(a.quoteVolume))
      .slice(0,60)
      .sort((a,b)=>Math.abs(parseFloat(b.priceChangePercent))-Math.abs(parseFloat(a.priceChangePercent)))
      .slice(0,45)
      .map(t=>t.symbol);
    const activeHistory = history.filter(h=>!h.hit&&h.asset==='crypto').map(h=>h.raw);
    return [...new Set([...top, ...activeHistory])];
  } catch(e) { return DEFAULT_CRYPTO; }
}

// ==========================================
// MASTER SCORING ENGINE (All 8 engines merged)
// ==========================================
function scoreMarket(m) {
  const cs = m.candles;
  const cl = cs.map(c=>c.close);
  const last = m.price||(cl.length?cl.at(-1):0);
  const one = cl.length>1 ? (cl.at(-1)-cl.at(-2))/cl.at(-2)*100 : 0;
  const r = rsi(cl), mc = macd(cl), at = atr(cs), atrPct = last?at/last*100:0;

  // Run all engines
  const qfl  = getQFL(cs);
  const mmc  = getMMC(cs);
  const smc  = getCK_SMC(cs);
  const qb   = getQBDelta(cs);
  const vel  = getVelocityEngine(cs);
  const ob   = getOrderBlocks(cs);
  const div  = getDivergence(cs);
  const mtf  = getMTFAlign(cs);

  let bull=0, bear=0, exp=0, reasons=[];

  // 1. QFL
  if(qfl.cracked===1)  { bull+=AI_WEIGHTS.QFL_BASE_CRACK; reasons.push("QFL Base Crack"); }
  if(qfl.cracked===-1) { bear+=AI_WEIGHTS.QFL_BASE_CRACK; reasons.push("QFL Ceil Crack"); }

  // 2. MMC
  if(mmc.curveAligned&&mmc.curveType.includes("Floor")) { bull+=(AI_WEIGHTS.MMC_MIRROR_SYNC/2); reasons.push("MMC Arc Support"); exp+=10; }
  if(mmc.curveAligned&&mmc.curveType.includes("Roof"))  { bear+=(AI_WEIGHTS.MMC_MIRROR_SYNC/2); reasons.push("MMC Arc Resist"); exp+=10; }
  if(mmc.mmcSignal===1)  { bull+=AI_WEIGHTS.MMC_REJECTION_PIN; reasons.push(mmc.char); }
  if(mmc.mmcSignal===-1) { bear+=AI_WEIGHTS.MMC_REJECTION_PIN; reasons.push(mmc.char); }

  // 3. SMC
  if(smc.fvg===1)    { bull+=AI_WEIGHTS.SMC_FVG; reasons.push("FVG Imbalance Up"); }
  if(smc.fvg===-1)   { bear+=AI_WEIGHTS.SMC_FVG; reasons.push("FVG Imbalance Dn"); }
  if(smc.sweep===1)  { bull+=AI_WEIGHTS.SMC_LIQUIDITY_SWEEP; exp+=10; reasons.push("SSL Swept"); }
  if(smc.sweep===-1) { bear+=AI_WEIGHTS.SMC_LIQUIDITY_SWEEP; exp+=10; reasons.push("BSL Swept"); }

  // 4. QB Volume
  if(qb.deltaSurge) { exp+=AI_WEIGHTS.QB_DELTA_SURGE; reasons.push("QB Surge"); }

  // 5. Velocity Pre-Move (NEW)
  if(vel.breakoutDir===1)  { bull+=AI_WEIGHTS.VELOCITY_SURGE; exp+=12; reasons.push(vel.phase); }
  if(vel.breakoutDir===-1) { bear+=AI_WEIGHTS.VELOCITY_SURGE; exp+=12; reasons.push(vel.phase); }
  if(vel.coiling) { exp+=8; } // Coiling adds expansion potential regardless of direction

  // 6. Order Block (NEW)
  if(ob.touch===1)  { bull+=AI_WEIGHTS.ORDER_BLOCK_TOUCH; reasons.push(ob.obLabel); }
  if(ob.touch===-1) { bear+=AI_WEIGHTS.ORDER_BLOCK_TOUCH; reasons.push(ob.obLabel); }

  // 7. Divergence (NEW)
  if(div.signal===1)  { bull+=AI_WEIGHTS.DIVERGENCE_SIGNAL*(div.strength/60); reasons.push(div.type); }
  if(div.signal===-1) { bear+=AI_WEIGHTS.DIVERGENCE_SIGNAL*(div.strength/60); reasons.push(div.type); }

  // 8. MTF Alignment (NEW)
  if(mtf.align===1)  { bull+=8; }
  if(mtf.align===-1) { bear+=8; }

  // Momentum
  if(mc.hist>0) bull+=AI_WEIGHTS.MOMENTUM_CONFIRMATION; else if(mc.hist<0) bear+=AI_WEIGHTS.MOMENTUM_CONFIRMATION;
  if(r<40) bull+=AI_WEIGHTS.MOMENTUM_CONFIRMATION; else if(r>60) bear+=AI_WEIGHTS.MOMENTUM_CONFIRMATION;

  // Confluence count
  let confluenceCount=0;
  if(qfl.cracked!==0) confluenceCount++;
  if(mmc.mmcSignal!==0||mmc.curveAligned) confluenceCount++;
  if(Math.abs(smc.smcScore)>=MIN_SMC_SCORE) confluenceCount++;
  if(qb.deltaSurge) confluenceCount++;
  if(vel.breakoutDir!==0) confluenceCount++;
  if(ob.touch!==0) confluenceCount++;
  if(div.signal!==0) confluenceCount++;
  if(mtf.align!==0) confluenceCount++;

  const direction = bull - bear;

  const denom = Object.values(AI_WEIGHTS).reduce((a,b)=>a+b,0) - AI_WEIGHTS.CHASING_PENALTY;
  const rawScore = Math.max(bull,bear) + (exp*0.45);
  let confidence = denom>0 ? clamp(Math.round((rawScore/denom)*100),0,100) : clamp(Math.round(rawScore),0,100);

  // Chasing penalty
  if(atrPct>0 && Math.abs(one)>atrPct*0.9) {
    const penalty = Math.round(AI_WEIGHTS.CHASING_PENALTY*0.6);
    confidence = clamp(confidence-penalty,0,100);
    reasons.push("Over-extended");
  }

  const preMoveScore = (vel.score*0.4 + (ob.touch!==0?40:0) + (div.strength||0)*0.3 + (vel.coiling?20:0));
  const hasConfluence = confluenceCount >= MIN_CONFLUENCE;

  // Signal classification — directional clarity matters here
  const impendingUp   = confidence>=84 && direction>35 && hasConfluence && qb.deltaSurge && confluenceCount>=3;
  const impendingDown = confidence>=84 && direction<-35 && hasConfluence && qb.deltaSurge && confluenceCount>=3;
  const buy  = !impendingUp   && confidence>=MIN_ACTION_SCORE && direction>20 && hasConfluence;
  const sell = !impendingDown && confidence>=MIN_ACTION_SCORE && direction<-20 && hasConfluence;

  // Pre-move watch: coiling with directional lean — ENTER BEFORE the move
  const preMoveUp   = !buy&&!impendingUp   && vel.coiling && vel.breakoutDir===1 && preMoveScore>45;
  const preMoveDown = !sell&&!impendingDown && vel.coiling && vel.breakoutDir===-1 && preMoveScore>45;

  let type="watch",label="WATCH",cls="watch";
  if(impendingUp)   { type="bigup";label="BIG UP (>15%)";cls="bigup"; }
  else if(impendingDown) { type="bigdown";label="BIG DOWN (>15%)";cls="bigdown"; }
  else if(buy)       { type="buy";label="MMC BUY";cls="buy"; }
  else if(sell)      { type="sell";label="MMC SELL";cls="sell"; }
  else if(preMoveUp) { type="pmup";label="PRE-MOVE BUY ↑";cls="pmup"; }
  else if(preMoveDown){ type="pmdown";label="PRE-MOVE SELL ↓";cls="pmdown"; }
  else if(confidence<50) { type="neutral";label="NEUTRAL";cls="neutral"; }

  return {
    ...m, price:last, one, volR:qb.ratio, rsi:r, macd:mc, atr:at, atrPct,
    bull, bear, expansion:exp, direction, quality:confidence, score:confidence,
    type, label, cls, confluenceCount,
    reasons:reasons.slice(0,4),
    qfl, mmc, smc, qb, vel, ob, div, mtf,
    preMoveScore:Math.round(preMoveScore)
  };
}

// ==========================================
// TRADE LEVELS (TP1/TP2/TP3/SL)
// ==========================================
function levels(s) {
  const short = s.type==="sell"||s.type==="bigdown"||s.type==="pmdown";
  const big = s.type.includes("big");
  const preMov = s.type.includes("pm");
  const isCrypto = s.asset==="crypto";

  const at = s.atr||s.price*.012;
  const risk = 1.0*at;

  const baseTarget  = isCrypto?0.055:0.006;
  const bigTarget   = isCrypto?0.160:0.016;
  const preTarget   = isCrypto?0.080:0.009;
  const targetPct   = big?bigTarget:preMov?preTarget:baseTarget;

  const sign = short?-1:1;
  const sl   = s.price - sign*risk;
  const tp1  = s.price + sign*(s.price*(targetPct*0.5));
  const tp2  = s.price + sign*(s.price*targetPct);
  const tp3  = s.price + sign*(s.price*(targetPct*1.6));

  return {
    short, sl, tp1, tp2, tp3,
    slPct:(sl-s.price)/s.price*100,
    tp1Pct:(tp1-s.price)/s.price*100,
    tp2Pct:(tp2-s.price)/s.price*100,
    tp3Pct:(tp3-s.price)/s.price*100,
    rr:Math.abs(tp2-s.price)/Math.abs(s.price-sl)
  };
}

// ==========================================
// RENDERING
// ==========================================
function rowColor(v){ return v>=0?"g":"r"; }
function scoreColor(s){ return s>=82?"var(--cyan)":s>=72?"var(--green)":s>=55?"var(--amber)":"var(--muted)"; }

function filtered() {
  const q=$("search").value.trim().toLowerCase(), asset=$("assetFilter").value;
  return signals.filter(s=>{
    if(activeFilter==="all") return true;
    if(activeFilter==="buy")    return s.type==="buy"||s.type==="pmup";
    if(activeFilter==="sell")   return s.type==="sell"||s.type==="pmdown";
    if(activeFilter==="bigup")  return s.type==="bigup";
    if(activeFilter==="bigdown") return s.type==="bigdown";
    if(activeFilter==="premove") return s.type==="pmup"||s.type==="pmdown";
    if(activeFilter==="watch")   return s.type==="watch"||s.type==="neutral";
    return s.type===activeFilter;
  }).filter(s=>(asset==="all"||s.asset===asset)&&(!q||s.symbol.toLowerCase().includes(q)||s.raw.toLowerCase().includes(q)));
}

function renderScanner() {
  const rows = filtered();
  $("body").innerHTML = rows.length
    ? rows.map(s=>renderRow(s)).join("")
    : `<tr><td colspan="13"><div class="empty">No signals match current filters. Run a scan or adjust filters.</div></td></tr>`;
}

function renderRow(s) {
  const open = expanded===s.raw, lv=levels(s);
  const qbFmt = s.qb.deltaSurge ? `<span class="g">x${fmt(s.volR,1)} ⚡</span>` : `<span class="dim">x${fmt(s.volR,1)}</span>`;
  const baseFmt = s.qfl.cracked!==0 ? `<span class="${s.qfl.cracked===1?'g':'r'}">${s.qfl.status}</span>` : `<span class="dim">Intact</span>`;
  const smcFmt = Math.abs(s.smc.smcScore)>0 ? `<span class="c">${s.smc.structure}</span>` : `<span class="dim">Ranging</span>`;
  const mmcFmt = s.mmc.mmcSignal!==0 ? `<span class="${s.mmc.mmcSignal===1?'g':'r'}">${s.mmc.char}</span>` : `<span class="dim">${s.mmc.curveType}</span>`;
  const velFmt = s.vel.coiling ? `<span class="a">🔄 ${s.vel.phase}</span>` : `<span class="${s.vel.breakoutDir===1?'g':s.vel.breakoutDir===-1?'r':'dim'}">${s.vel.phase}</span>`;
  const pmBadge = s.preMoveScore>50 ? `<span style="color:var(--amber);font-size:10px;font-weight:800">PM:${s.preMoveScore}</span>` : '';

  let html = `<tr class="main" onclick="toggleExpand('${s.raw}')">
    <td>
      <div class="sym">${s.symbol}</div>
      <div class="asset">${s.asset.toUpperCase()} · C:${s.confluenceCount}</div>
      <div class="reasons">${(s.reasons&&s.reasons.join(" · "))||"Scanning"}</div>
    </td>
    <td class="right"><strong>${price(s.price)}</strong></td>
    <td class="right ${rowColor(s.one)}">${pct(s.one)}</td>
    <td class="right ${rowColor(s.change24)}">${pct(s.change24)}</td>
    <td class="right">${qbFmt}</td>
    <td class="right ${+fmt(s.rsi,0)>65?'r':+fmt(s.rsi,0)<35?'g':''}">${fmt(s.rsi,0)}</td>
    <td class="right" style="font-weight:600">${baseFmt}</td>
    <td class="right" style="font-weight:600">${mmcFmt}</td>
    <td class="right" style="font-weight:600">${smcFmt}</td>
    <td class="right" style="font-weight:600;font-size:11px">${velFmt}</td>
    <td class="right"><strong style="color:${scoreColor(s.score)}">${s.score}</strong>${pmBadge}<div class="bar"><div class="fill" style="width:${s.score}%;background:${scoreColor(s.score)}"></div></div></td>
    <td><span class="badge ${s.cls}">${s.label}</span></td>
    <td class="right" style="color:var(--muted)">${open?"▲":"▼"}</td>
  </tr>`;

  if(open) {
    const divColor = s.div.signal===1?"g":s.div.signal===-1?"r":"dim";
    html += `<tr class="expand"><td colspan="13">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div>
          <strong style="font-size:16px;color:#fff">${s.symbol} — Structural Execution Plan</strong>
          <span class="small" style="display:block;margin-top:4px">
            ${s.type.includes("big")?"MAJOR MOVE EXPECTED (>15%)":s.type.includes("pm")?"PRE-MOVE SETUP — Enter BEFORE the breakout":"DIRECTIONAL TRADE (>5%)"}
            · MTF: ${s.mtf.label} · Pre-Move Score: <b style="color:var(--amber)">${s.preMoveScore}</b>
          </span>
        </div>
        <div style="text-align:right">
          <span class="small">Direction Bias</span>
          <br><b class="${s.direction>=0?'g':'r'}" style="font-size:20px">${s.direction>0?'LONG':'SHORT'} ${Math.abs(s.direction)}</b>
        </div>
      </div>

      <div class="setup">
        <div class="box"><div class="label">${lv.short?"Short Entry":"Long Entry"}</div><div class="value">${price(s.price)}</div><div class="small w">Market Now</div></div>
        <div class="box"><div class="label">Stop Loss (SL)</div><div class="value r">${price(lv.sl)}</div><div class="small r">${pct(lv.slPct)}</div></div>
        <div class="box"><div class="label">TP1 · Exit 40%</div><div class="value g">${price(lv.tp1)}</div><div class="small g">${pct(lv.tp1Pct)}</div></div>
        <div class="box" style="border-color:var(--cyan);background:rgba(6,182,212,0.05)"><div class="label" style="color:var(--cyan)">TP2 · Exit 40%</div><div class="value c">${price(lv.tp2)}</div><div class="small c">${pct(lv.tp2Pct)} · R:R ${fmt(lv.rr,1)}x</div></div>
        <div class="box" style="border-color:var(--green);background:rgba(34,197,94,0.05)"><div class="label" style="color:var(--green)">TP3 · Runner 20%</div><div class="value g">${price(lv.tp3)}</div><div class="small g">${pct(lv.tp3Pct)}</div></div>
      </div>

      <div class="three">
        <div class="analysis"><strong>Pre-Move Velocity Engine</strong>
          <div class="row"><span>Market Phase</span><b class="${s.vel.coiling?'a':s.vel.breakoutDir===1?'g':s.vel.breakoutDir===-1?'r':'dim'}">${s.vel.phase}</b></div>
          <div class="row"><span>Compression %</span><b>${s.vel.compressionPct}% of prior range</b></div>
          <div class="row"><span>Volume Building</span><b class="${s.vel.volBuilding?'g':'dim'}">${s.vel.volBuilding?"Yes — Accumulating":"Standard Flow"}</b></div>
          <div class="row"><span>Breakout Direction</span><b class="${s.vel.breakoutDir===1?'g':s.vel.breakoutDir===-1?'r':'dim'}">${s.vel.breakoutDir===1?"UPWARD":"s.vel.breakoutDir===-1?DOWNWARD:Undecided"}</b></div>
          <div class="row"><span>Velocity Score</span><b style="color:var(--amber)">${s.vel.score}/100</b></div>
        </div>

        <div class="analysis" style="border-color:var(--violet)"><strong>Order Blocks + Divergence</strong>
          <div class="row"><span>OB Status</span><b class="${s.ob.touch===1?'g':s.ob.touch===-1?'r':'dim'}">${s.ob.obLabel}</b></div>
          <div class="row"><span>OB Distance</span><b>${s.ob.distPct!==0?fmt(s.ob.distPct,2)+"%":"No Active OB"}</b></div>
          <div class="row"><span>Divergence Type</span><b class="${divColor}">${s.div.type}</b></div>
          <div class="row"><span>RSI Now vs Prior</span><b>${s.div.rsiCur} vs ${s.div.rsiPrev} (${s.div.strength>0?"+"+s.div.strength:"0"} strength)</b></div>
          <div class="row"><span>Confluence Count</span><b style="color:var(--cyan)">${s.confluenceCount} / 8 signals active</b></div>
        </div>

        <div class="analysis"><strong>QFL + SMC + MMC + MTF</strong>
          <div class="row"><span>QFL Base</span><b>${s.qfl.status}</b></div>
          <div class="row"><span>SMC Structure</span><b class="w">${s.smc.structure}</b></div>
          <div class="row"><span>FVG</span><b>${s.smc.fvg===1?"Bullish Imbalance":s.smc.fvg===-1?"Bearish Imbalance":"Closed"}</b></div>
          <div class="row"><span>MMC Character</span><b class="${s.mmc.mmcSignal===1?'g':s.mmc.mmcSignal===-1?'r':'dim'}">${s.mmc.char}</b></div>
          <div class="row"><span>H4 / H1 Bias</span><b class="${s.mtf.align===1?'g':s.mtf.align===-1?'r':'a'}">${s.mtf.label}</b></div>
        </div>
      </div>
    </td></tr>`;
  }
  return html;
}

function toggleExpand(raw){ expanded=expanded===raw?null:raw; renderScanner(); }

// ==========================================
// HISTORY + PERFORMANCE
// ==========================================
function trackNew(list) {
  const actionable = list.filter(s=>["buy","sell","bigup","bigdown","pmup","pmdown"].includes(s.type));
  const fresh=[];
  for(const s of actionable) {
    const key=s.raw+":"+s.type;
    if(history.some(h=>h.key===key&&Date.now()-h.ts<60*60*1000)) continue;
    const lv=levels(s);
    history.push({
      key, symbol:s.symbol, raw:s.raw, asset:s.asset,
      label:s.label, type:s.type, cls:s.cls,
      entry:s.price, current:s.price, best:0,
      ts:Date.now(), closeTs:null,
      reasons:s.reasons, tp2:lv.tp2, sl:lv.sl, short:lv.short,
      tp2Pct:lv.tp2Pct, slPct:lv.slPct, hit:false,
      // AI training features
      rsi:s.rsi, volR:s.volR, atrPct:s.atrPct,
      qflTrigger:s.qfl.cracked, qflDepth:s.qfl.depth||0,
      mmcSignal:s.mmc.mmcSignal, mmcFactor:s.mmc.factor||0,
      mmcCurveAligned:s.mmc.curveAligned?1:0,
      smcScore:s.smc.smcScore, smcFVG:s.smc.fvg||0, smcSweep:s.smc.sweep||0,
      qbRatio:s.qb.ratio,
      velocityScore:s.vel.score, obTouch:s.ob.touch,
      divergence:s.div.signal, mtfAlign:s.mtf.align,
      preMoveScore:s.preMoveScore, confluenceCount:s.confluenceCount
    });
    fresh.push(s);
  }
  if(history.length>250) history=history.slice(-250);
  return fresh;
}

function updateTracked() {
  let dirty=false;
  for(const h of history) {
    if(!h.hit) {
      const s=allScored.find(x=>x.raw===h.raw);
      if(!s) continue;
      h.current=s.price;
      const move=(h.current-h.entry)/h.entry*100*(h.short?-1:1);
      if(h.best===undefined) h.best=0;
      if(move>h.best) h.best=move;
      const hitTarget=h.short?h.current<=h.tp2:h.current>=h.tp2;
      const hitStop=h.short?h.current>=h.sl:h.current<=h.sl;
      if(hitTarget){h.hit="target";h.closeTs=Date.now();}
      else if(hitStop){h.hit="stop";h.closeTs=Date.now();}
      dirty=true;
    }
  }
  if(dirty||history.length>0){ renderHistory(); renderPerformance(); }
}

function selectBestSignals(list) {
  // Sort by: pre-move setups first, then by score
  return list.sort((a,b)=>{
    const aIsPM = a.type==="pmup"||a.type==="pmdown" ? 1 : 0;
    const bIsPM = b.type==="pmup"||b.type==="pmdown" ? 1 : 0;
    if(aIsPM!==bIsPM) return bIsPM-aIsPM;
    return b.score-a.score;
  }).slice(0,MAX_ROWS);
}

function renderHistory() {
  if(!history.length){ $("histBody").innerHTML=`<tr><td colspan="6"><div class="empty">History logs once signals execute.</div></td></tr>`; return; }
  $("histBody").innerHTML = history.slice().reverse().map(h=>`
    <tr>
      <td>${new Date(h.ts).toLocaleTimeString()}</td>
      <td><strong>${h.symbol}</strong><div class="asset">${h.asset}</div></td>
      <td><span class="badge ${h.cls}">${h.label}</span></td>
      <td class="right">${price(h.entry)}</td>
      <td class="right ${h.best>=0?'g':'r'}">${pct(h.best||0)}</td>
      <td>${h.reasons.join(" · ")}</td>
    </tr>`).join("");
}

function renderPerformance() {
  const settled=history.filter(h=>h.hit);
  const wins=settled.filter(h=>h.hit==="target"), loss=settled.filter(h=>h.hit==="stop");
  $("mTracked").textContent=history.length;
  $("pSettled").textContent=settled.length;
  $("pWins").textContent=wins.length;
  $("pLosses").textContent=loss.length;
  $("mWin").textContent=settled.length?Math.round(wins.length/settled.length*100)+"%":"-";
  $("pBest").textContent=history.length?pct(Math.max(...history.map(h=>h.best||0))):"-";
  $("perfBody").innerHTML=history.length?history.slice().reverse().map(h=>{
    const statHtml=h.hit==="target"?"<span style='color:var(--green)'>TP Hit ✓</span>":h.hit==="stop"?"<span style='color:var(--brand-red)'>SL Hit ✗</span>":"<span style='color:var(--amber)'>Active</span>";
    return `<tr>
      <td><strong>${h.symbol}</strong></td>
      <td><span class="badge ${h.cls}">${h.label}</span></td>
      <td class="right">${price(h.entry)}</td>
      <td class="right g">${price(h.tp2)}</td>
      <td class="right r">${price(h.sl)}</td>
      <td class="right">${price(h.current||h.entry)}</td>
      <td class="right ${(h.best||0)>=0?'g':'r'}">${pct(h.best||0)}</td>
      <td class="right">${statHtml}</td>
    </tr>`;
  }).join(""):`<tr><td colspan="8"><div class="empty">No active positions.</div></td></tr>`;
}

// ==========================================
// ALERT PANEL
// ==========================================
function alertPanel(fresh) {
  const bigs=signals.filter(s=>s.type==="bigup"||s.type==="bigdown").slice(0,8);
  const preMoves=signals.filter(s=>s.type==="pmup"||s.type==="pmdown").slice(0,5);
  const panel=$("moveAlert");

  if(bigs.length || preMoves.length) {
    const hasDown=(bigs.filter(s=>s.type==="bigdown").length>bigs.length/2)||(preMoves.filter(s=>s.type==="pmdown").length>preMoves.length/2);
    panel.className="alert show "+(hasDown?"down":"up");
    $("alertIco").textContent=hasDown?"▼":"▲";

    if(preMoves.length) {
      $("alertTitle").textContent="PRE-MOVE SETUP DETECTED — Enter Before the Breakout";
      $("alertText").textContent=`${preMoves.length} asset(s) coiling with volume accumulation. Breakout imminent.`;
    } else {
      $("alertTitle").textContent="Major Structure Break Confirmed";
      $("alertText").textContent="SMC structure (CHOCH/BOS) breached with QFL + MMC confirmation.";
    }
    $("alertCount").textContent=bigs.length+preMoves.length;
    const allAlerts=[...preMoves,...bigs];
    $("alertChips").innerHTML=allAlerts.map(s=>`<span class="chip ${s.cls}">${s.symbol} ${s.score}</span>`).join("");
  } else { panel.className="alert"; }

  const noisy=fresh.filter(s=>Date.now()-(lastAlert.get(s.raw+s.type)||0)>45*60*1000);
  if(noisy.length) {
    const first=noisy[0];
    noisy.forEach(s=>lastAlert.set(s.raw+s.type,Date.now()));
    beep(first.type);
    toast(`${first.label}: ${noisy.slice(0,4).map(s=>s.symbol).join(", ")}`, first.type==="sell"||first.type==="bigdown"||first.type==="pmdown"?"sell":"buy");
  }
}

// ==========================================
// METRICS PANEL
// ==========================================
function renderMetrics(t0, totalCount) {
  const c=t=>signals.filter(s=>s.type===t).length;
  $("mBuy").textContent   = c("buy")+c("pmup");
  $("mSell").textContent  = c("sell")+c("pmdown");
  $("mBigUp").textContent = c("bigup");
  $("mBigDown").textContent=c("bigdown");
  $("mWatch").textContent = c("watch")+c("neutral");
  $("mAvg").textContent   = signals.length?Math.round(avg(signals.map(s=>s.score))):"-";
  $("universe").textContent=`${totalCount} markets`;
  $("lastScan").textContent=now();
  $("latency").textContent=fmt((performance.now()-t0)/1000,1)+"s";

  const breadth = c("buy")+c("bigup")+c("pmup")-(c("sell")+c("bigdown")+c("pmdown"));
  $("marketBias").textContent=breadth>3?"Bullish Matrix":breadth<-3?"Bearish Matrix":"Neutral Matrix";
  $("marketBias").className="value "+(breadth>3?"g":breadth<-3?"r":"w");
  $("biasText").textContent=`Breadth ${breadth} · BTC ${pct(btc24)}`;

  const exp=Math.round(avg(signals.map(s=>s.expansion||0)));
  $("expansionRisk").textContent=exp>38?"High Expansion":exp>24?"Medium Expansion":"Low Expansion";
  $("expansionRisk").className="value "+(exp>38?"r":exp>24?"a":"w");
  $("mBigDown") && ($("mBigDown").parentElement.querySelector(".label").textContent="Big Down");
}

// ==========================================
// MAIN SCAN LOOP
// ==========================================
async function runScan() {
  if($("scanBtn").disabled) return;
  const id=++scanId, t0=performance.now();
  countdown=90;

  $("scanBtn").disabled=true;
  $("scanBtn").innerHTML=`<span class="spinner"></span> Scanning`;
  $("status").textContent="Scanning all engines...";
  $("dot").className="dot scan";

  try {
    const btc=await fetchCrypto("BTCUSDT").catch(()=>null);
    btc24=btc?+btc.change24:0;
    $("btcPrice").textContent=btc?price(btc.price):"-";
    $("btcChange").textContent=btc?pct(btc.change24):"unavailable";
    $("btcChange").className="small "+(btc&&btc.change24>=0?"g":btc?"r":"a");

    const targetList=await getDynamicCryptoList();
    const all=[];
    for(let i=0;i<targetList.length;i+=8) {
      const chunk=await Promise.allSettled(targetList.slice(i,i+8).map(fetchCrypto));
      chunk.forEach(x=>{ if(x.status==="fulfilled"&&x.value.candles&&x.value.candles.length>45) all.push(x.value); });
    }
    const other=await Promise.allSettled(STOOQ.map(fetchStooq));
    other.forEach(x=>{ if(x.status==="fulfilled"&&x.value.candles&&x.value.candles.length>30) all.push(x.value); });

    if(id!==scanId) return;
    if(all.length===0) throw new Error("No market data");

    allScored=all.map(scoreMarket);
    signals=selectBestSignals(allScored);

    const fresh=trackNew(signals);
    updateTracked();
    renderScanner();
    renderMetrics(t0,all.length);
    alertPanel(fresh);

    $("status").textContent=`${all.length} assets scanned`;
    $("dot").className="dot";
  } catch(e) {
    console.error("Scan error:",e);
    $("status").textContent="API Error · Retrying...";
    $("dot").className="dot err";
    toast("Connection error. Retrying...","sell");
  } finally {
    $("scanBtn").disabled=false;
    $("scanBtn").textContent="Execute Scan";
    countdown=90;
  }
}

// ==========================================
// UI CONTROLS
// ==========================================
function setFilter(btn) {
  document.querySelectorAll(".pill").forEach(b=>b.classList.remove("on"));
  btn.classList.add("on");
  activeFilter=btn.dataset.filter;
  renderScanner();
}

function switchTab(btn) {
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
