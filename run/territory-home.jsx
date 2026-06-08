/* ============================================================
   Territory Run — Home : full-bleed map + draggable bottom sheet
   User = Team South (blue).
   ============================================================ */
const { useState, useMemo, useRef, useCallback, useEffect, useLayoutEffect } = React;

const TEAMS = {
  north:{ key:'north', name:'North', fill:'#e9d5ff', stroke:'#9333ea', text:'#581c87' },
  east: { key:'east',  name:'East',  fill:'#bbf7d0', stroke:'#16a34a', text:'#14532d' },
  south:{ key:'south', name:'South', fill:'#bfdbfe', stroke:'#2563eb', text:'#1e3a8a' },
  west: { key:'west',  name:'West',  fill:'#fecaca', stroke:'#dc2626', text:'#7f1d1d' },
};

/* ---------- free-form loop map ----------
   Land is claimed by running CLOSED LOOPS, so each territory is an organic
   polygon (a smoothed closed running route), painted over an abstract street
   map. Your loops get the heavier 2.5px stroke + the "you" marker.            */
function hash(a, b){ const x = Math.sin(a*12.9898 + b*78.233) * 43758.5453; return x - Math.floor(x); }

// smooth closed loop via Catmull-Rom -> cubic bezier
function loopPath(cx, cy, r, seed, irr = 0.34, n = 11){
  const pts = [];
  for (let i = 0; i < n; i++){
    const ang = (Math.PI*2*i)/n + (hash(seed+i*0.7, seed*1.3)-0.5)*0.25;
    const rad = r * (1 + (hash(seed + i*1.7, seed*2.1 + i)-0.5)*irr*2) * (i%2 ? 0.94 : 1.06);
    pts.push([cx + Math.cos(ang)*rad, cy + Math.sin(ang)*rad*0.9]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
  for (let i = 0; i < n; i++){
    const p0 = pts[(i-1+n)%n], p1 = pts[i], p2 = pts[(i+1)%n], p3 = pts[(i+2)%n];
    const c1x = p1[0] + (p2[0]-p0[0])/6, c1y = p1[1] + (p2[1]-p0[1])/6;
    const c2x = p2[0] - (p3[0]-p1[0])/6, c2y = p2[1] - (p3[1]-p1[1])/6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  return d + 'Z';
}

const VBW = 412, VBH = 760;
const LOOPS = [
  // North (purple) — top
  { t:'north', cx:118, cy:150, r:54, s:1.2 },
  { t:'north', cx:242, cy:120, r:46, s:3.7 },
  { t:'north', cx:332, cy:178, r:48, s:5.1 },
  { t:'north', cx:186, cy:232, r:40, s:7.3 },
  // West (red) — left
  { t:'west', cx:78,  cy:312, r:50, s:2.2 },
  { t:'west', cx:96,  cy:446, r:54, s:8.9 },
  { t:'west', cx:128, cy:574, r:46, s:4.4 },
  { t:'west', cx:66,  cy:672, r:40, s:6.6 },
  // East (green) — right
  { t:'east', cx:342, cy:312, r:50, s:1.9 },
  { t:'east', cx:356, cy:448, r:52, s:9.2 },
  { t:'east', cx:330, cy:580, r:46, s:3.3 },
  { t:'east', cx:300, cy:672, r:42, s:7.7 },
  // South (blue) — centre, YOURS
  { t:'south', cx:212, cy:360, r:46, s:2.5, mine:true, you:true },
  { t:'south', cx:258, cy:436, r:40, s:5.8, mine:true },
  { t:'south', cx:172, cy:462, r:38, s:8.1, mine:true },
  { t:'south', cx:236, cy:524, r:40, s:3.9, mine:true },
  { t:'south', cx:288, cy:344, r:32, s:6.2 },
  { t:'south', cx:190, cy:584, r:34, s:1.1 },
];

// abstract street network + coastline (procedural, kept pale so loops read)
const STREETS_MAJOR = [
  'M -20 250 Q 200 196 440 300',
  'M -20 480 Q 200 540 440 452',
  'M 150 -20 Q 120 320 176 790',
  'M 306 -20 Q 338 360 286 790',
];
const STREETS_MINOR = [
  'M -20 150 Q 210 120 440 170',
  'M -20 360 Q 200 330 440 372',
  'M -20 600 Q 200 636 440 596',
  'M 70 -20 Q 58 360 96 790',
  'M 232 -20 Q 250 380 220 790',
  'M 372 -20 Q 392 360 350 790',
];
const COAST = 'M -10 706 C 90 686 190 712 290 700 C 350 692 400 706 422 700 L 422 780 L -10 780 Z';

function TerritoryMap({ focus, onPick, pulse }){
  const loops = useMemo(()=>LOOPS.map((b,i)=>({ ...b, i, d:loopPath(b.cx,b.cy,b.r,b.s) })), []);
  const you = LOOPS.find(b=>b.you);
  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="xMidYMid slice"
      role="img" aria-label="Live territory map — claimed running loops">
      <rect x="0" y="0" width={VBW} height={VBH} fill="#f3f1ea"/>
      <path d={COAST} fill="#e6eaec"/>
      {/* streets */}
      <g fill="none" strokeLinecap="round">
        {STREETS_MAJOR.map((d,i)=><path key={'M'+i} d={d} stroke="#e8e3d8" strokeWidth="7"/>)}
        {STREETS_MINOR.map((d,i)=><path key={'m'+i} d={d} stroke="#ece8df" strokeWidth="3"/>)}
      </g>
      {/* claimed loops */}
      {loops.map(b=>{
        const t = TEAMS[b.t];
        const dim = focus && b.t !== focus;
        return (
          <path key={b.i}
            className={'blob'+(dim?' dim':'')+(pulse&&b.mine?' pulse':'')}
            d={b.d} fill={t.fill} fillOpacity={b.mine?0.78:0.62}
            stroke={t.stroke} strokeWidth={b.mine?2.5:1.5} strokeLinejoin="round"
            onClick={()=>onPick(b.t)} />
        );
      })}
      {/* a live, still-open run (counts as distance until it closes) */}
      <path d="M 196 360 C 150 330 150 300 200 296 C 250 292 286 318 300 352"
        fill="none" stroke={TEAMS.south.stroke} strokeWidth="2.5" strokeLinecap="round"
        strokeDasharray="6 7" opacity={focus && focus!=='south' ? 0.18 : 0.9}/>
      {/* you marker */}
      {you && (
        <g>
          <circle className="you-halo" cx={you.cx} cy={you.cy} r="10" fill="rgba(37,99,235,0.45)"/>
          <g className="you-ring">
            <circle cx={you.cx} cy={you.cy} r="8" fill={TEAMS.south.stroke} stroke="#fff" strokeWidth="2.5"/>
            <circle cx={you.cx} cy={you.cy} r="2.8" fill="#fff"/>
          </g>
        </g>
      )}
    </svg>
  );
}

/* ---------- standings ---------- */
const STAND = [
  { ...TEAMS.north, area:38.2, zones:32 },
  { ...TEAMS.east,  area:31.5, zones:27 },
  { ...TEAMS.south, area:27.8, zones:24, you:true },
  { ...TEAMS.west,  area:22.1, zones:19 },
].sort((a,b)=>b.area-a.area);
const MAXA = Math.max(...STAND.map(r=>r.area));
const YOU_RANK = STAND.findIndex(r=>r.you) + 1;
const ORD = ['', '1st','2nd','3rd','4th'];

function Standings({ focus, onFocus }){
  return (
    <div>
      <div className="sec-h"><h2>Team standings</h2><span className="sub">area held · season</span></div>
      <div className="stand">
        {STAND.map((t,i)=>(
          <div key={t.key} className={'stand-row'+(focus===t.key?' active':'')}
            onClick={()=>onFocus(focus===t.key?null:t.key)}>
            <span className="rank">{i+1}</span>
            <span className="dot" style={{background:t.stroke}}></span>
            <div className="meta">
              <div className="nm" style={{color:t.text}}>{t.name}{t.you&&<span className="you-tag">You</span>}</div>
              <div className="bar"><div className="fill" style={{width:`${(t.area/MAXA)*100}%`,background:t.stroke}}></div></div>
            </div>
            <div className="val">
              <div className="a" style={{color:t.text}}>{t.area}<span style={{fontSize:11,color:'var(--ink-60)',marginLeft:2}}> km²</span></div>
              <div className="z">{t.zones} zones</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stats(){
  const tiles=[
    {ey:'Distance',v:'18.4',u:'km'},
    {ey:'Area claimed',v:'2.3',u:'km²',you:true},
    {ey:'Zones',v:'5'},
    {ey:'Time',v:'1:42:08'},
  ];
  return (
    <div>
      <div className="sec-h" style={{marginBottom:10}}><h2>Your week</h2><span className="sub">mon — sun</span></div>
      <div className="stat-grid">
        {tiles.map(t=>(
          <div key={t.ey} className={'stat'+(t.you?' is-you':'')}>
            <div className="ey">{t.ey}</div>
            <div className="val">{t.v}{t.u&&<span className="u">{t.u}</span>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- App ---------- */
const PEEK_VIS = 176;          // px of sheet visible when collapsed
const FULL_FRAC = 0.76;        // fraction of screen the sheet covers when open

function Home(){
  const homeRef = useRef(null);
  const [dims, setDims] = useState({ H: 874 });
  const sheetH = Math.round(dims.H * FULL_FRAC);
  const peekTy = sheetH - PEEK_VIS;

  const [focus, setFocus] = useState(null);
  const [pulse, setPulse] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [ty, setTy] = useState(peekTy);
  const [dragging, setDragging] = useState(false);
  const [ripples, setRipples] = useState([]);
  const [toast, setToast] = useState(null);
  const drag = useRef(null);
  const toastT = useRef(null);
  const pulseT = useRef(null);

  useLayoutEffect(()=>{
    if (homeRef.current){
      const H = homeRef.current.clientHeight || 874;
      setDims({ H });
      setTy(Math.round(H*FULL_FRAC) - PEEK_VIS);
    }
  }, []);

  // keep ty synced to snap target when not dragging
  useEffect(()=>{ if(!dragging) setTy(expanded ? 0 : peekTy); }, [expanded, peekTy, dragging]);

  const fireToast = useCallback((msg)=>{
    setToast(msg); clearTimeout(toastT.current);
    toastT.current = setTimeout(()=>setToast(null), 2400);
  }, []);

  const focusMine = ()=>{
    setFocus('south'); setPulse(true);
    clearTimeout(pulseT.current); pulseT.current = setTimeout(()=>setPulse(false), 1400);
  };

  const startRun = (e)=>{
    const rect = e.currentTarget.getBoundingClientRect();
    const id = Date.now();
    setRipples(rs=>[...rs,{id,x:e.clientX-rect.left,y:e.clientY-rect.top}]);
    setTimeout(()=>setRipples(rs=>rs.filter(r=>r.id!==id)),600);
    fireToast('Loop starts here — run screen is next');
  };

  // sheet drag
  const onDown = (e)=>{
    drag.current = { startY:e.clientY, baseTy:ty, moved:false };
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch(_){}
  };
  const onMove = (e)=>{
    if(!drag.current) return;
    const dy = e.clientY - drag.current.startY;
    if(Math.abs(dy)>3) drag.current.moved = true;
    setTy(Math.max(0, Math.min(peekTy, drag.current.baseTy + dy)));
  };
  const onUp = ()=>{
    if(!drag.current) return;
    const moved = drag.current.moved;
    setDragging(false);
    if(!moved){ setExpanded(x=>!x); drag.current=null; return; }
    const open = ty < peekTy*0.5;
    setExpanded(open); setTy(open?0:peekTy);
    drag.current = null;
  };

  const focusName = focus ? TEAMS[focus].name : null;
  const focusTeam = focus ? TEAMS[focus] : null;

  return (
    <div className="home" ref={homeRef}>
      {/* full-bleed map */}
      <div className="map-full">
        <TerritoryMap focus={focus} onPick={setFocus} pulse={pulse} />
      </div>
      <div className="map-veil-top"></div>

      {/* floating top controls */}
      <div className="float-top">
        <div className="glass f-ava">WL</div>
        <div className="glass f-team">
          <span className="d"></span>Team South
          <span className="live"><span className="ld"></span>live</span>
        </div>
        <div className="glass f-locate" onClick={focusMine} title="Focus my zones">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="3.4" fill="currentColor"/>
            <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      {/* focus banner */}
      <div className={'focus-tag glass'+(focus?' show':'')} style={focusTeam?{color:focusTeam.text}:null}>
        {focusTeam && <span className="dot" style={{width:9,height:9,borderRadius:'50%',background:focusTeam.stroke}}></span>}
        {focusName} holds {focusTeam? STAND.find(s=>s.key===focus).zones : ''} zones
        <span className="x" onClick={(e)=>{e.stopPropagation();setFocus(null);}}>✕</span>
      </div>

      {/* legend */}
      <div className="map-legend glass" style={{ bottom: PEEK_VIS + 14 }}>
        {Object.values(TEAMS).map(t=>(
          <span className="li" key={t.key}><span className="sw" style={{background:t.fill,border:`1.5px solid ${t.stroke}`}}></span>{t.name}</span>
        ))}
      </div>

      {/* toast */}
      <div className={'toast'+(toast?' show':'')} style={{bottom: PEEK_VIS + 30}}><span className="d"></span>{toast}</div>

      {/* bottom sheet */}
      <div className={'sheet'+(dragging?'':' snap')} style={{ height:sheetH, transform:`translateY(${ty}px)` }}>
        <div className="sheet-handle" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="bar"></span>
        </div>
        <div className="sheet-fixed">
          <button className="start-btn" onClick={startRun}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M7 4l13 8-13 8V4z" fill="#fff"/></svg>
            Start run
            {ripples.map(r=><span key={r.id} className="ripple" style={{left:r.x,top:r.y,width:20,height:20}}/>)}
          </button>
          <div className={'summary'+(expanded?' open':'')}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className="rankbig">{YOU_RANK}<span className="ord">{ORD[YOU_RANK].slice(-2)}</span></div>
            <div className="smeta">
              <div className="t">You're {ORD[YOU_RANK]} · Team South</div>
              <div className="s">27.8 km² held · 6.1 behind East</div>
            </div>
            <div className="chev" onClick={()=>setExpanded(x=>!x)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        </div>
        <div className="sheet-body">
          <Standings focus={focus} onFocus={setFocus} />
          <div className="contest" onClick={()=>fireToast('Defend — zone screen is next')}>
            <div className="ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 3v18M6 4h11l-2.5 3.5L17 11H6" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <div className="tx">
              <div className="t">West is pushing into Tanjong Pagar</div>
              <div className="s">Your zone · loop expires in 2 days</div>
            </div>
            <span className="go">›</span>
          </div>
          <Stats />
        </div>
      </div>
    </div>
  );
}

window.Home = Home;
