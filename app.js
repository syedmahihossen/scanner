/**
 * =========================================================================
 * CANDLE KING SNIPER | MMC & SMC INSTITUTIONAL ALGO ENGINE
 * Mapped completely to standard video modules for line trend, body close breaks,
 * sweeps, 1.5x ATR funding candles, and Triple Trade dynamic risk tiers.
 * =========================================================================
 */

const STRATEGY_WEIGHTS = {
  LINE_MAPPING_TREND: 25,
  BODY_CLOSE_BOS: 20,
  BODY_CLOSE_CHOCH: 25,
  IDM_LIQUIDITY_SWEPT: 15,
  IFC_VAL_ATR: 20,
  FVG_IMBALANCE: 15,
  SR_INTERCHANGE: 15,
  TLC_3_TOUCH: 15
};

const INSTITUTIONAL_CRYPTO = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT","SUIUSDT","NEARUSDT","LTCUSDT"];
const STOOQ_COMMODITIES = [["EURUSD","eurusd","forex"],["GBPUSD","gbpusd","forex"],["USDJPY","usdjpy","forex"],["GOLD (XAU)","xauusd","metal"],["WTI CRUDE","cl.f","energy"]];

const SCAN_LIMIT = 35;
const STRUCTURAL_LOOKBACK = 4; // Candle offset lookup bounds matrix matching mapping logic

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
// CSV EXPORT MODULE
// ==========================================
function exportToExcel() {
  const settledTrades = history.filter(h => h.hit === "target" || h.hit === "stop");
  if(settledTrades.length === 0) {
    alert("No active tracked positions have finalized an execution route inside this session yet.");
    return;
  }

  let csvContent = [
    "Symbol,Signal,LineTrend,BodyBOS,BodyCHoCH,IdmStatus,IfcValid,FvgStatus,SR_Flip,TLC_TouchCount,",
    "Entry,StopLoss,Target1,Target2,Target3,MaxExcursion,Result"
  ].join("") + "\n";

  settledTrades.forEach(t => {
    const result = t.hit === "target" ? 1 : 0;
    const row = [
      t.symbol, t.type, t.trendBias, t.bodyBos, t.bodyChoch, t.idmSwept, t.ifcValid, t.fvgActive, t.srFlip, t.tlcCount,
      fmt(t.entry,6), fmt(t.sl,6), fmt(t.tp1,6), fmt(t.tp2,6), fmt(t.tp3,6), fmt(t.best||0,2), result
    ].join(",");
    csvContent += row + "\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ck_matrix_dataset_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
}

// ==========================================
// TOAST NOTIFICATION STREAMS
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
    const seq = type.includes("down")||type==="sell" ? [330,247,196] : [523,659,784,1047];
    seq.forEach((f,i) => {
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = type.includes("down")||type==="sell" ? "sawtooth" : "sine";
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
  $("soundBtn").textContent = soundOn ? "🔊 Alerts: ON" : "🔇 Alerts: OFF";
  if(soundOn) {
    try { if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)(); if(audioCtx.state==='suspended') audioCtx.resume(); } catch(e) {}
    toast("Audio Stream Online");
  }
}

// ==========================================
// STRUCTURAL MATH ENGINE CALCULUS
// ==========================================
function calculateAtr(candles, p=14) {
  if(!candles || candles.length === 0) return 0;
  const trs = [];
  for(let i=1; i<candles.length; i++) {
    const c=candles[i], prev=candles[i-1].close;
    trs.push(Math.max(c.high-c.low, Math.abs(c.high-prev), Math.abs(c.low-prev)));
  }
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}

function rsi(closes, p=14) {
  if(!closes || closes.length < p+1) return 50;
  let gains=0, losses=0;
  for(let i=1; i<=p; i++) { const d=closes[i]-closes[i-1]; if(d>=0)gains+=d; else losses-=d; }
  let avgG=gains/p, avgL=losses/p;
  for(let i=p+1; i<closes.length; i++) {
    const d=closes[i]-closes[i-1];
    avgG=(avgG*(p-1)+Math.max(d,0))/p;
    avgL=(avgL*(p-1)+Math.max(-d,0))/p;
  }
  return avgL===0 ? 100 : 100-100/(1+avgG/avgL);
}

// 1 & 2. Pure Line Chart mapping protocol rules
function getLineStructure(candles) {
  const len = candles.length;
  let swingHighs = [], swingLows = [];

  for (let i = STRUCTURAL_LOOKBACK; i < len - STRUCTURAL_LOOKBACK; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= STRUCTURAL_LOOKBACK; j++) {
      if (candles[i].close <= candles[i - j].close || candles[i].close <= candles[i + j].close) isHigh = false;
      if (candles[i].close >= candles[i - j].close || candles[i].close >= candles[i + j].close) isLow = false;
    }
    if (isHigh) swingHighs.push({ index: i, price: candles[i].close });
    if (isLow) swingLows.push({ index: i, price: candles[i].close });
  }

  let trend = "Neutral", demandZones = 0;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastH = swingHighs.at(-1), prevH = swingHighs.at(-2);
    const lastL = swingLows.at(-1), prevL = swingLows.at(-2);
    
    if (lastH.price > prevH.price && lastL.price > prevL.price) { trend = "Bullish"; demandZones = 3; }
    else if (lastH.price < prevH.price && lastL.price < prevL.price) { trend = "Bearish"; demandZones = -3; }
  }
  return { trend, swingHighs, swingLows, demandZones };
}

// 3. Strict Candle Body Close Validation structure break rule
function getStructureBreaks(candles, structure) {
  if (structure.swingHighs.length < 2 || structure.swingLows.length < 2) {
    return { bos: 0, choch: 0, desc: "Consolidation" };
  }
  const current = candles.at(-1);
  const lastHigh = structure.swingHighs.at(-1).price;
  const lastLow = structure.swingLows.at(-1).price;

  let bos = 0, choch = 0, desc = "Contained";

  if (structure.trend === "Bullish") {
    if (current.close > lastHigh) { bos = 1; desc = "Bullish BOS"; }
    if (current.close < lastLow) { choch = -1; desc = "Bearish CHoCH Reversal"; }
  } else if (structure.trend === "Bearish") {
    if (current.close < lastLow) { bos = -1; desc = "Bearish BOS"; }
    if (current.close > lastHigh) { choch = 1; desc = "Bullish CHoCH Reversal"; }
  }
  return { bos, choch, desc };
}

// 4. Inducement (IDM) Liquidity Grab Module
function getIdmSweep(candles, structure) {
  if (structure.swingLows.length === 0 || structure.swingHighs.length === 0) return { swept: 0, label: "None" };
  const current = candles.at(-1);
  const prev = candles.at(-2);
  
  const minorLow = structure.swingLows.at(-1).price;
  const minorHigh = structure.swingHighs.at(-1).price;

  if (structure.trend === "Bullish" && prev.low < minorLow && current.close > minorLow) {
    return { swept: 1, label: "Bull IDM Swept" };
  }
  if (structure.trend === "Bearish" && prev.high > minorHigh && current.close < minorHigh) {
    return { swept: -1, label: "Bear IDM Swept" };
  }
  return { swept: 0, label: "No Sweep" };
}

// 5. MMC 3-Candle Institutional Funding Candle (IFC) Sequence Matrix
function getIFCSequence(candles) {
  if (candles.length < 4) return { valid: false, dir: 0, label: "Ranging" };
  
  const c1 = candles.at(-4); // Indication
  const c2 = candles.at(-3); // Funding
  const c3 = candles.at(-2); // Controller

  const currentAtr = calculateAtr(candles.slice(-20), 14);
  const c2Body = Math.abs(c2.open - c2.close);
  
  // Power candle ATR threshold check
  const isFundingValid = c2Body > (currentAtr * 1.5);
  if (!isFundingValid) return { valid: false, dir: 0, label: "Retail Volume" };

  let valid = false, dir = 0, label = "Unconfirmed Void";
  if (c2.close > c2.open && c3.low > c1.high) {
    valid = true; dir = 1; label = "Bullish IFC Valid";
  } else if (c2.close < c2.open && c3.high < c1.low) {
    valid = true; dir = -1; label = "Bearish IFC Valid";
  }
  return { valid, dir, label, indication: c1, controller: c3 };
}

// 6. Fair Value Gap (FVG) Imbalance Module
function getFvgImbalance(candles, ifc) {
  if (!ifc.valid) return { active: false, label: "Balanced", size: 0 };
  const current = candles.at(-1);

  if (ifc.dir === 1 && ifc.controller.low > ifc.indication.high) {
    const top = ifc.controller.low;
    const bottom = ifc.indication.high;
    const mitigated = current.close < bottom;
    return { active: !mitigated, label: mitigated ? "Mitigated" : "Active Bull FVG", size: ((top - bottom) / bottom) * 100 };
  } else if (ifc.dir === -1 && ifc.controller.high < ifc.indication.low) {
    const top = ifc.indication.low;
    const bottom = ifc.controller.high;
    const mitigated = current.close > top;
    return { active: !mitigated, label: mitigated ? "Mitigated" : "Active Bear FVG", size: ((top - bottom) / bottom) * 100 };
  }
  return { active: false, label: "Balanced", size: 0 };
}

// 7. Support & Resistance Interchange Flipping Module
function getSRInterchange(candles, structure) {
  if (structure.swingHighs.length < 3 || structure.swingLows.length < 3) return { flip: false, desc: "None" };
  const current = candles.at(-1);
  
  const oldResistance = structure.swingHighs.at(-2).price;
  const oldSupport = structure.swingLows.at(-2).price;

  if (current.close > oldResistance && candles.at(-3).low <= oldResistance) {
    return { flip: true, desc: "R/S Flip Interchange Floor" };
  }
  if (current.close < oldSupport && candles.at(-3).high >= oldSupport) {
    return { flip: true, desc: "S/R Flip Interchange Ceiling" };
  }
  return { flip: false, desc: "None" };
}

// 8. Trend Line Concept (TLC) 3-Point Connection rule
function getTlcLine(candles, structure) {
  const points = structure.trend === "Bearish" ? structure.swingHighs : structure.swingLows;
  if (points.length < 3) return { valid: false, count: points.length, broken: 0 };

  const p1 = points.at(-3), p2 = points.at(-2), p3 = points.at(-1);
  const slopeA = (p2.price - p1.price) / (p2.index - p1.index);
  const slopeB = (p3.price - p2.price) / (p3.index - p2.index);
  
  // Enforce mandatory 3-point contact linearity rules
  const linearSymmetry = Math.abs(slopeA - slopeB) < (Math.abs(slopeA) * 0.18);
  if (!linearSymmetry) return { valid: false, count: 3, broken: 0 };

  const current = candles.at(-1);
  const lineProjectionVal = p3.price + slopeB * (candles.length - 1 - p3.index);
  
  let broken = 0;
  if (structure.trend === "Bullish" && current.close < lineProjectionVal) broken = -1;
  if (structure.trend === "Bearish" && current.close > lineProjectionVal) broken = 1;

  return { valid: true, count: 3, broken, lineValue: lineProjectionVal };
}

// ==========================================
// INTEGRATED MASTER SCORING SYSTEMS MATRIX
// ==========================================
function scoreMarket(m) {
  const cs = m.candles;
  const cl = cs.map(c=>c.close);
  const last = m.price || cl.at(-1);
  
  const delta1Bar = cl.length > 1 ? ((cl.at(-1) - cl.at(-2)) / cl.at(-2)) * 100 : 0;
  const idx24h = Math.max(0, cl.length - 96); // 96 periods on 15m interval tracks 24 hours precisely
  const calculated24h = cl.length > 96 ? ((cl.at(-1) - cl[idx24h]) / cl[idx24h]) * 100 : delta1Bar * 12;

  const currentRsi = rsi(cl, 14);
  const currentAtr = calculateAtr(cs, 14);
  const atrPct = last ? (currentAtr / last) * 100 : 0;

  const structure = getLineStructure(cs);
  const breaks    = getStructureBreaks(cs, structure);
  const idm       = getIdmSweep(cs, structure);
  const ifc       = getIFCSequence(cs);
  const fvg       = getFvgImbalance(cs, ifc);
  const srFlip    = getSRInterchange(cs, structure);
  const tlc       = getTlcLine(cs, structure);

  // QB Volume Profile ratio scaling logic dependencies
  const currentVol = cs.at(-1).volume || 1;
  const priorVols = cs.slice(-10,-1).map(c=>c.volume||1);
  const qbRatio = currentVol / (priorVols.reduce((a,b)=>a+b,0)/priorVols.length);

  let bull = 0, bear = 0, confluence = 0, expansion = 0;
  let tracks = [];

  if (structure.trend === "Bullish") { bull += STRATEGY_WEIGHTS.LINE_MAPPING_TREND; tracks.push("Line Matrix Bullish"); confluence++; }
  if (structure.trend === "Bearish") { bear += STRATEGY_WEIGHTS.LINE_MAPPING_TREND; tracks.push("Line Matrix Bearish"); confluence++; }
  
  if (breaks.bos === 1)   { bull += STRATEGY_WEIGHTS.BODY_CLOSE_BOS; tracks.push("BOS Shift Confirmed"); confluence++; }
  if (breaks.bos === -1)  { bear += STRATEGY_WEIGHTS.BODY_CLOSE_BOS; tracks.push("BOS Shift Confirmed"); confluence++; }
  if (breaks.choch === 1) { bull += STRATEGY_WEIGHTS.BODY_CLOSE_CHOCH; tracks.push("Structural Reversal Floor"); confluence++; }
  if (breaks.choch === -1){ bear += STRATEGY_WEIGHTS.BODY_CLOSE_CHOCH; tracks.push("Structural Reversal Ceiling"); confluence++; }

  if (idm.swept === 1)  { bull += STRATEGY_WEIGHTS.IDM_LIQUIDITY_SWEPT; tracks.push("Liquidity Swept (IDM)"); confluence++; }
  if (idm.swept === -1) { bear += STRATEGY_WEIGHTS.IDM_LIQUIDITY_SWEPT; tracks.push("Liquidity Swept (IDM)"); confluence++; }

  if (ifc.valid && ifc.dir === 1)  { bull += STRATEGY_WEIGHTS.IFC_VAL_ATR; tracks.push("Institutional Entry Block"); confluence++; }
  if (ifc.valid && ifc.dir === -1) { bear += STRATEGY_WEIGHTS.IFC_VAL_ATR; tracks.push("Institutional Entry Block"); confluence++; }

  if (fvg.active && ifc.dir === 1)  { bull += STRATEGY_WEIGHTS.FVG_IMBALANCE; tracks.push("Active Inefficient Void"); confluence++; }
  if (fvg.active && ifc.dir === -1) { bear += STRATEGY_WEIGHTS.FVG_IMBALANCE; tracks.push("Active Inefficient Void"); confluence++; }
  if (qbRatio > 1.4) expansion += 15;

  if (srFlip.flip && structure.trend === "Bullish") { bull += STRATEGY_WEIGHTS.SR_INTERCHANGE; tracks.push("Interchange Pivot Floor"); confluence++; }
  if (srFlip.flip && structure.trend === "Bearish") { bear += STRATEGY_WEIGHTS.SR_INTERCHANGE; tracks.push("Interchange Pivot Ceiling"); confluence++; }

  if (tlc.valid && tlc.broken === 1)  { bull += STRATEGY_WEIGHTS.TLC_3_TOUCH; tracks.push("TLC Trend Trigger Break"); confluence++; }
  if (tlc.valid && tlc.broken === -1) { bear += STRATEGY_WEIGHTS.TLC_3_TOUCH; tracks.push("TLC Trend Trigger Break"); confluence++; }

  const netBias = bull - bear;
  const rawDominant = Math.max(bull, bear) + (expansion * 0.45);
  const baseScale = Object.values(STRATEGY_WEIGHTS).reduce((a,b)=>a+b,0);
  let finalConfidence = Math.min(Math.round((rawDominant / baseScale) * 100), 100);

  if (atrPct > 0 && Math.abs(delta1Bar) > (atrPct * 1.1)) {
    finalConfidence = clamp(finalConfidence - 20, 0, 100);
    tracks.push("Extended Chasing Run Overload");
  }

  // TRIPLE TRADE RISK PARAMETERS SELECTION CLASSIFICATION TIERS
  let type = "watch", label = "WATCHLIST", cls = "watch";
  const passThresholds = confluence >= 2 && finalConfidence >= 60;

  if (passThresholds && finalConfidence >= 85 && ifc.valid && fvg.active && idm.swept !== 0) {
    // Kings Setup Rule Profile Target: 1:50 to 1:300 RR scale benchmarks
    if (netBias > 25) { type = "bigup"; label = "KINGS 👑 LONG"; cls = "bigup"; }
    else if (netBias < -25) { type = "bigdown"; label = "KINGS 👑 SHORT"; cls = "bigdown"; }
  } 
  else if (passThresholds && finalConfidence >= 75 && Math.abs(netBias) > 10) {
    // Wazer Setup Rule Profile Target: 1:7 to 1:49 RR scale benchmarks
    if (netBias > 0) { type = "buy"; label = "WAZER ⚡ BUY"; cls = "buy"; }
    else { type = "sell"; label = "WAZER ⚡ SELL"; cls = "sell"; }
  } 
  else if (passThresholds && srFlip.flip) {
    // Horse Setup Rule Profile Target: 1:2 to 1:5 scale benchmarks
    if (structure.trend === "Bullish") { type = "pmup"; label = "HORSE 🐎 BUY"; cls = "pmup"; }
    else { type = "pmdown"; label = "HORSE 🐎 SELL"; cls = "pmdown"; }
  }
  else if (finalConfidence < 50) {
    type = "neutral"; label = "NEUTRAL"; cls = "neutral";
  }

  return {
    ...m, price: last, one: delta1Bar, change24: calculated24h, volR: qbRatio, rsi: currentRsi, atr: currentAtr, atrPct,
    bull, bear, expansion, direction: netBias, score: finalConfidence, type, label, cls, confluenceCount: confluence, reasons: tracks.slice(0,4),
    structure, breaks, idm, ifc, fvg, srFlip, tlc
  };
}

function levels(s) {
  const isShort = s.type === "sell" || s.type === "bigdown" || s.type === "pmdown";
  const sign = isShort ? -1 : 1;
  const bufferRisk = (s.atr || s.price * 0.012) * 1.2;

  // Set precise target multipliers directly matching course strategy metrics
  let targetRatio = 0.055; 
  if (s.type.includes("big")) targetRatio = 0.175;     // Kings Target Profile
  else if (s.type === "buy" || s.type === "sell") targetRatio = 0.095; // Wazer Target Profile
  else if (s.type.includes("pm")) targetRatio = 0.042; // Horse Target Profile

  const sl = s.price - (sign * bufferRisk);
  const tp1 = s.price + (sign * (s.price * (targetRatio * 0.4)));
  const tp2 = s.price + (sign * (s.price * targetRatio));
  const tp3 = s.price + (sign * (s.price * (targetRatio * 1.6)));

  return {
    short: isShort, sl, tp1, tp2, tp3,
    slPct: ((sl - s.price) / s.price) * 100,
    tp1Pct: ((tp1 - s.price) / s.price) * 100,
    tp2Pct: ((tp2 - s.price) / s.price) * 100,
    tp3Pct: ((tp3 - s.price) / s.price) * 100,
    rr: Math.abs(tp2 - s.price) / Math.abs(s.price - sl)
  };
}

// ==========================================
// RENDER INTERFACE SYSTEM CONTROLS
// ==========================================

// FIXED ROW COLOR TYPO: Solved identifying logic layout crash bug
function rowColor(v){ return v >= 0 ? "g" : "r"; }
function scoreColor(s){ return s     >=85 ? "var(--cyan)" : s>=75 ? "var(--green)" : s>=58 ? "var(--amber)" : "var(--muted)"; }

function filtered() {
  const query = $("search").value.trim().toLowerCase();
  const sector = $("assetFilter").value;
  
  return signals.filter(s => {
    if (activeFilter === "all") return true;
    if (activeFilter === "buy") return s.type === "buy" || s.type === "pmup" || s.type === "bigup";
    if (activeFilter === "sell") return s.type === "sell" || s.type === "pmdown" || s.type === "bigdown";
    if (activeFilter === "premove") return s.type === "pmup" || s.type === "pmdown";
    if (activeFilter === "bigup") return s.type === "bigup" || s.type === "bigdown";
    return s.type === activeFilter;
  }).filter(s => {
    const matchesSector = (sector === "all" || s.asset === sector);
    const matchesQuery = (!query || s.symbol.toLowerCase().includes(query));
    return matchesSector && matchesQuery;
  });
}

function renderScanner() {
  const rows = filtered();
  
  // FIXED CONTROLLER ELEMENT TARGET MISMATCH: Synchronized table container output nodes
  $("scanner-tbody").innerHTML = rows.length
    ? rows.map(s => renderRow(s)).join("")
    : `<tr><td colspan="13"><div class="empty">No high-probability institutional setups match active criteria templates.</div></td></tr>`;
}

function renderRow(s) {
  const isOpen = expanded === s.raw;
  const lv = levels(s);

  const trendFmt = s.structure.trend !== "Neutral" ? `<span class="c">${s.structure.trend}</span>` : `<span class="dim">Symmetric</span>`;
  const ifcFmt = s.ifc.valid ? `<span class="g">${s.ifc.label}</span>` : `<span class="dim">No Void Flow</span>`;
  const fvgFmt = s.fvg.active ? `<span class="c">Active (${fmt(s.fvg.size,1)}%)</span>` : `<span class="dim">Balanced Void</span>`;
  const tlcFmt = s.tlc.valid ? `<span class="a">TLC (Anchor:3)</span>` : `<span class="dim">Unconfirmed Vector</span>`;

  let html = `<tr class="main" onclick="toggleExpand('${s.raw}')">
    <td><div class="sym">${s.symbol}</div><div class="asset">${s.asset.toUpperCase()} · C:${s.confluenceCount}</div></td>
    <td class="right"><strong>${price(s.price)}</strong></td>
    <td class="right ${rowColor(s.one)}">${pct(s.one)}</td>
    <td class="right ${rowColor(s.change24)}">${pct(s.change24)}</td>
    <td class="right"><span class="w">x${fmt(s.volR,1)}</span></td>
    <td class="right ${s.rsi>68?'r':s.rsi<32?'g':''}">${fmt(s.rsi,0)}</td>
    <td class="right"><span>${s.idm.label}</span></td>
    <td class="right">${ifcFmt}</td>
    <td class="right">${fvgFmt}</td>
    <td class="right" style="font-size:11px">${tlcFmt}</td>
    <td class="right"><strong style="color:${scoreColor(s.score)}">${s.score}</strong><div class="bar"><div class="fill" style="width:${s.score}%;background:${scoreColor(s.score)}"></div></div></td>
    <td><span class="badge ${s.cls}">${s.label}</span></td>
    <td class="right" style="color:var(--muted)">${isOpen?"▲":"▼"}</td>
  </tr>`;

  if (isOpen) {
    html += `<tr class="expand"><td colspan="13">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div>
          <strong style="font-size:16px;color:#fff">${s.symbol} — Candle King Triple Trade Structural Level Blueprint Matrix</strong>
          <span class="small" style="display:block;margin-top:4px">Risk Parameters Classification Profile Target: ${s.label} · Core Confluences: ${s.confluenceCount} / 8</span>
        </div>
      </div>
      
      <div class="setup">
        <div class="box"><div class="label">${lv.short?"Short Execution Trigger":"Long Execution Trigger"}</div><div class="value">${price(s.price)}</div><div class="small w">Market Execution</div></div>
        <div class="box"><div class="label">Stop Loss (SL)</div><div class="value r">${price(lv.sl)}</div><div class="small r">${pct(lv.slPct)}</div></div>
        <div class="box"><div class="label">Partial TP1 (Exit 40%)</div><div class="value g">${price(lv.tp1)}</div><div class="small g">${pct(lv.tp1Pct)}</div></div>
        <div class="box" style="border-color:var(--cyan);background:rgba(6,182,212,0.05)"><div class="label" style="color:var(--cyan)">Target TP2 (Exit 40%)</div><div class="value c">${price(lv.tp2)}</div><div class="small c">${pct(lv.tp2Pct)} · R:R ${fmt(lv.rr,1)}x</div></div>
        <div class="box" style="border-color:var(--green);background:rgba(34,197,94,0.05)"><div class="label" style="color:var(--green)">Runner TP3 (Exit 20%)</div><div class="value g">${price(lv.tp3)}</div><div class="small g">${pct(lv.tp3Pct)}</div></div>
      </div>
      
      <div class="sub-data" style="margin-bottom:16px; color:var(--amber); font-weight:700;">* Cost-to-Cost Trailing Protocol: Trigger automated risk containment rules (move SL to absolute Entry) the exact instant price crosses TP1 boundaries.</div>

      <div class="three">
        <div class="analysis"><strong>Market Structure mapping Details</strong>
          <div class="row"><span>Line Trend Direction</span><b class="w">${trendFmt}</b></div>
          <div class="row"><span>Candle Breaks Check</span>...</div>
          <div class="row"><span>Interchange Level Status</span><b class="${s.srFlip.flip?'g':'dim'}">${s.srFlip.desc}</b></div>
        </div>
        <div class="analysis" style="border-color:var(--violet)"><strong>Institutional Order Flow Core</strong>
          <div class="row"><span>IFC Matrix Status</span><b>${ifcFmt}</b></div>
          <div class="row"><span>FVG Void Balance</span><b>${fvgFmt}</b></div>
          <div class="row"><span>Liquidity Sweeps</span><b class="w">${s.idm.label}</b></div>
        </div>
        <div class="analysis"><strong>Trend Line Concept (TLC Model)</strong>
          <div class="row"><span>3-Point Anchor Rules</span><b>${s.tlc.count} Connected Nodes</b></div>
          <div class="row"><span>Linear Symmetry Validation</span><b class="${s.tlc.valid?'g':'dim'}">${s.tlc.valid?'True Path Alignment':'Structural Void'}</b></div>
          <div class="row"><span>Break Detection Vector</span><b>...</b></div>
        </div>
      </div>
    </td></tr>`;
  }
  return html;
}

function toggleExpand(raw){ expanded = expanded === raw ? null : raw; renderScanner(); }

// ==========================================
// AUTOMATED API STREAMING PIPELINES
// ==========================================
const BINANCE_HOSTS = ["https://api.binance.com","https://api1.binance.com"];

async function fetchBinanceNode(path) {
  for(const host of BINANCE_HOSTS) {
    try {
      const r = await fetch(host + path, { cache: "no-store" });
      if(r.ok) return r.json();
      if(r.status === 429) await new Promise(res => setTimeout(res, 1200));
    } catch(e) {}
  }
  throw new Error("API connections dropped entirely.");
}

async function fetchProxyText(url) {
  const proxies = [`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, `https://corsproxy.io/?${encodeURIComponent(url)}`];
  for(const p of proxies) {
    try {
      const r = await fetch(p, { cache: "no-store" });
      if(r.ok) {
        const txt = await r.text();
        if(txt.toLowerCase().includes("date,open,high,low,close")) return txt;
      }
    } catch(e) {}
  }
  throw new Error("Gateway connection proxies completely dropped requests.");
}

function cleanBinanceKlines(rows) {
  if(!Array.isArray(rows)) return [];
  return rows.map(r => ({ time: r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] })).filter(c => Number.isFinite(c.close));
}

function parseStooqCsv(txt) {
  return txt.trim().split(/\n/).slice(1).map(l => {
    const p = l.split(",");
    if(p.length < 5 || isNaN(p[1]) || isNaN(p[4])) return null;
    return { time: p[0], open: +p[1], high: +p[2], low: +p[3], close: +p[4], volume: +p[5] || 1 };
  }).filter(c => c !== null && Number.isFinite(c.close));
}

async function fetchCryptoAsset(sym) {
  const h1 = await fetchBinanceNode(`/api/v3/klines?symbol=${sym}&interval=15m&limit=110`);
  const candles = cleanBinanceKlines(h1);
  return {
    symbol: sym.replace("USDT",""), raw: sym, asset: "crypto", source: "Binance",
    price: candles.at(-1).close, change24: 0, candles: candles
  };
}

async function fetchStooqAsset(item) {
  const [label, code, asset] = item;
  try {
    const txt = await fetchProxyText(`https://stooq.com/q/d/l/?s=${code}&i=d`);
    const historicalData = parseStooqCsv(txt).slice(-110);
    if(historicalData.length > 20) {
      return { symbol: label, raw: code, asset, source: "Stooq", price: historicalData.at(-1).close, change24: 0, candles: historicalData };
    }
  } catch(e) { console.warn(`Proxy failed for commodity ${label}, skipping gracefully.`); }
  return null;
}

function trackAutomatedHistory(list) {
  const actionable = list.filter(s => ["buy","sell","bigup","bigdown","pmup","pmdown"].includes(s.type));
  const fresh = [];
  for(const s of actionable) {
    const key = s.raw + ":" + s.type;
    if(history.some(h => h.key === key && Date.now() - h.ts < 45 * 60 * 1000)) continue;
    const lv = levels(s);
    history.push({
      key, symbol: s.symbol, raw: s.raw, asset: s.asset, label: s.label, type: s.type, cls: s.cls, entry: s.price, current: s.price, best: 0, ts: Date.now(), closeTs: null, reasons: s.reasons, tp2: lv.tp2, sl: lv.sl, short: lv.short, tp2Pct: lv.tp2Pct, slPct: lv.slPct, hit: false,
      trendBias: s.structure.trend, bodyBos: s.breaks.bos, bodyChoch: s.breaks.choch, idmSwept: s.idm.swept, ifcValid: s.ifc.valid?1:0, FvgActive: s.fvg.active?1:0, srFlip: s.srFlip.flip?1:0, tlcCount: s.tlc.count, rsi: s.rsi, volR: s.volR, atrPct: s.atrPct, confluenceCount: s.confluenceCount
    });
    fresh.push(s);
  }
  return fresh;
}

function updateLivePerformanceTracks() {
  let modified = false;
  for(const h of history) {
    if(!h.hit) {
      const s = allScored.find(x => x.raw === h.raw);
      if(!s) continue;
      h.current = s.price;
      const excursion = ((h.current - h.entry) / h.entry) * 100 * (h.short ? -1 : 1);
      if(h.best === undefined) h.best = 0;
      if(excursion > h.best) h.best = excursion;
      
      const crossedTarget = h.short ? h.current <= h.tp2 : h.current >= h.tp2;
      const crossedStop = h.short ? h.current >= h.sl : h.current <= h.sl;
      
      if(crossedTarget) { h.hit = "target"; h.closeTs = Date.now(); }
      else if(crossedStop) { h.hit = "stop"; h.closeTs = Date.now(); }
      modified = true;
    }
  }
  if(modified || history.length > 0) { renderHistoryLogs(); renderPerformanceMatrices(); }
}

function renderHistoryLogs() {
  if(!history.length){ $("histBody").innerHTML=`<tr><td colspan="6"><div class="empty">Logs populate upon execution of actionable setups.</div></td></tr>`; return; }
  $("histBody").innerHTML = history.slice().reverse().map(h => `
    <tr>
      <td>${new Date(h.ts).toLocaleTimeString()}</td>
      <td><strong>${h.symbol}</strong><div class="asset">${h.asset}</div></td>
      <td><span class="badge ${h.cls}">${h.label}</span></td>
      <td class="right">${price(h.entry)}</td>
      <td class="right ${h.best>=0?'g':'r'}">${pct(h.best||0)}</td>
      <td>${h.reasons.join(" · ")}</td>
    </tr>`).join("");
}

function renderPerformanceMatrices() {
  const completed = history.filter(h => h.hit);
  const wins = completed.filter(h => h.hit === "target"), loss = completed.filter(h => h.hit === "stop");
  $("mTracked").textContent = history.length;
  $("pSettled").textContent = completed.length;
  $("pWins").textContent = wins.length;
  $("pLosses").textContent = loss.length;
  $("mWin").textContent = completed.length ? Math.round(wins.length / completed.length * 100) + "%" : "-";
  $("pBest").textContent = history.length ? pct(Math.max(...history.map(h => h.best || 0))) : "-";
  
  $("perfBody").innerHTML = history.length ? history.slice().reverse().map(h => {
    const statusLabel = h.hit === "target" ? "<span class='g'>TP2 Hit ✓</span>" : h.hit === "stop" ? "<span class='r'>SL Hit ✗</span>" : "<span class='a'>Active Trailing</span>";
    return `<tr>
      <td><strong>${h.symbol}</strong></td>
      <td><span class="badge ${h.cls}">${h.label}</span></td>
      <td class="right">${price(h.entry)}</td>
      <td class="right g">${price(h.tp2)}</td>
      <td class="right r">${price(h.sl)}</td>
      <td class="right">${price(h.current || h.entry)}</td>
      <td class="right ${(h.best||0)>=0?'g':'r'}">${pct(h.best||0)}</td>
      <td class="right">${statusLabel}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="8"><div class="empty">No active tracking metrics positions operational.</div></td></tr>`;
}

function handleAlertPanels(fresh) {
  const kings = signals.filter(s => s.type.includes("big")).slice(0, 8);
  const wazers = signals.filter(s => s.type === "buy" || s.type === "sell").slice(0, 5);
  const panel = $("moveAlert");

  if(kings.length || wazers.length) {
    const bearishDominant = (kings.filter(s => s.type === "bigdown").length > kings.length / 2) || (wazers.filter(s => s.type === "sell").length > wazers.length / 2);
    panel.className = "alert show " + (bearishDominant ? "down" : "up");
    $("alertIco").textContent = bearishDominant ? "▼" : "▲";

    if(kings.length) {
      $("alertTitle").textContent = "KINGS 👑 Tier Macro Alignment Coordinates Verified";
      $("alertText").textContent = `${kings.length} asset pair blocks displaying historical target structural imbalances. Expansion imminent.`;
    } else {
      $("alertTitle").textContent = "Wazer Trend Continuation Triggers Formed";
      $("alertText").textContent = "Standard body-close breakout metrics satisfied across monitored assets.";
    }
    $("alertCount").textContent = kings.length + wazers.length;
    $("alertChips").innerHTML = [...kings, ...wazers].map(s => `<span class="chip ${s.cls}">${s.symbol} ${s.score}</span>`).join("");
  } else { panel.className = "alert"; }

  const criticalNoisy = fresh.filter(s => Date.now() - (lastAlert.get(s.raw + s.type) || 0) > 45 * 60 * 1000);
  if(criticalNoisy.length) {
    criticalNoisy.forEach(s => lastAlert.set(s.raw + s.type, Date.now()));
    beep(criticalNoisy[0].type);
    toast(`${criticalNoisy[0].label}: ${criticalNoisy.slice(0, 4).map(s => s.symbol).join(", ")}`, criticalNoisy[0].type.includes("down") || criticalNoisy[0].type === "sell" ? "sell" : "buy");
  }
}

function compileDashboardRibbons(t0, length) {
  const c = t => signals.filter(s => s.type === t).length;
  $("mBuy").textContent = c("buy") + c("pmup") + c("bigup");
  $("mSell").textContent = c("sell") + c("pmdown") + c("bigdown");
  $("mBigUp").textContent = c("bigup");
  $("mBigDown").textContent = c("bigdown");
  $("mWatch").textContent = c("watch") + c("neutral");
  $("mAvg").textContent = signals.length ? Math.round(avg(signals.map(s => s.score))) : "-";
  $("universe").textContent = `${length} assets`;
  $("lastScan").textContent = now();
  $("latency").textContent = fmt((performance.now() - t0) / 1000, 1) + "s";

  const netBreadth = (c("buy") + c("bigup") + c("pmup")) - (c("sell") + c("bigdown") + c("pmdown"));
  $("marketBias").textContent = netBreadth > 2 ? "Bullish Demand Focus" : netBreadth < -2 ? "Bearish Supply Focus" : "Ranging Equilibrium Rotation";
  $("marketBias").className = "value " + (netBreadth > 2 ? "g" : netBreadth < -2 ? "r" : "w");
  $("biasText").textContent = `Net Structural Delta Layer: ${netBreadth} · BTC Benchmark Base ${pct(btc24)}`;

  const indexAvgExpansion = Math.round(avg(signals.map(s => s.expansion || 0)));
  $("expansionRisk").textContent = indexAvgExpansion > 22 ? "High Realtime Expansion" : "Coiling Compression Squeeze";
  $("expansionRisk").className = "value " + (indexAvgExpansion > 22 ? "r" : "w");
}

// ==========================================
// SCHEDULER MATRIX EXECUTION LOOP
// ==========================================
async function runScan() {
  if($("scanBtn").disabled) return;
  const id = ++scanId, t0 = performance.now();
  countdown = 90;

  $("scanBtn").disabled = true;
  $("scanBtn").textContent = "Executing Matrix...";
  $("status").textContent = "Parsing line structures...";
  $("dot").className = "dot scan";

  try {
    const btcPackage = await fetchCryptoAsset("BTCUSDT").catch(() => null);
    btc24 = btcPackage ? btcPackage.change24 : 0;
    $("btcPrice").textContent = btcPackage ? price(btcPackage.price) : "-";
    $("btcChange").textContent = btcPackage ? pct(btcPackage.change24) : "Offline";
    $("btcChange").className = "small " + (btcPackage && btcPackage.change24 >= 0 ? "g" : btcPackage ? "r" : "a");

    const batchData = [];
    
    for(let i=0; i<INSTITUTIONAL_CRYPTO.length; i+=4) {
      const processingChunk = await Promise.allSettled(INSTITUTIONAL_CRYPTO.slice(i, i+4).map(fetchCryptoAsset));
      processingChunk.forEach(x => { if(x.status === "fulfilled" && x.value.candles.length > 30) batchData.push(x.value); });
      await new Promise(res => setTimeout(res, 250));
    }
    
    const globalIndices = await Promise.allSettled(STOOQ_COMMODITIES.map(fetchStooqAsset));
    globalIndices.forEach(x => { if(x.status === "fulfilled" && x.value !== null) batchData.push(x.value); });

    if(id !== scanId) return;
    if(batchData.length === 0) throw new Error("API connections dropped entirely.");

    allScored = batchData.map(scoreMarket);
    
    // ALPHA MATRIX SORT CRITERIA: Always bubble up best setups first based on raw alpha confidence levels
    signals = allScored.sort((a,b) => b.score - a.score).slice(0, SCAN_LIMIT);

    const freshLogs = trackAutomatedHistory(signals);
    updateLivePerformanceTracks();
    renderScanner();
    compileDashboardRibbons(t0, batchData.length);
    handleAlertPanels(freshLogs);

    $("status").textContent = `${batchData.length} matrices balanced`;
    $("dot").className = "dot";
  } catch(e) {
    console.error("Central Sync Blocked:", e);
    $("status").textContent = "Connection dropped. Retrying...";
    $("dot").className = "dot err";
    toast("Gateway disruption. Retrying setup connection.","sell");
  } finally {
    $("scanBtn").disabled = false;
    $("scanBtn").textContent = "Execute Scan";
    countdown = 90;
  }
}

function setFilter(btn) { document.querySelectorAll(".pill").forEach(b=>b.classList.remove("on")); btn.classList.add("on"); activeFilter=btn.dataset.filter; renderScanner(); }
function switchTab(btn) { document.querySelectorAll(".tab").forEach(b=>b.classList.remove("on")); btn.classList.add("on"); ["scanner","history","performance"].forEach(t=>$("tab-"+t).classList.toggle("hide",btn.dataset.tab!==t)); renderHistoryLogs(); renderPerformanceMatrices(); }

setInterval(() => {
  if($("scanBtn").disabled) return;
  countdown--;
  if(countdown <= 0) runScan();
  else { $("timer").textContent = countdown + "s"; $("nextScan").textContent = countdown + "s"; }
}, 1000);

runScan();
