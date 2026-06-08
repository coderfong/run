/* Territory Run — design sheet builders & celebration */
(function () {
  var TEAMS = [
    { key:'North', region:'Purple · top of the island', fill:'#e9d5ff', stroke:'#9333ea', text:'#581c87', dm:'#f3e8ff' },
    { key:'East',  region:'Green · Changi to Bedok',     fill:'#bbf7d0', stroke:'#16a34a', text:'#14532d', dm:'#dcfce7' },
    { key:'South', region:'Blue · the CBD coastline',    fill:'#bfdbfe', stroke:'#2563eb', text:'#1e3a8a', dm:'#dbeafe' },
    { key:'West',  region:'Red · Jurong & Tuas',         fill:'#fecaca', stroke:'#dc2626', text:'#7f1d1d', dm:'#fee2e2' }
  ];

  /* ---- 01 · Swatches ---- */
  var sw = document.getElementById('swatches');
  if (sw) {
    TEAMS.forEach(function (t) {
      var el = document.createElement('div');
      el.className = 'swatch';
      el.innerHTML =
        '<div class="swatch-cap" style="background:' + t.fill + '">' +
          '<div class="swatch-head">' +
            '<span class="dot" style="background:' + t.stroke + '"></span>' +
            '<span class="name" style="color:' + t.text + ';margin-top:8px">' + t.key + '</span>' +
            '<span class="region" style="color:' + t.text + '">' + t.region + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="swatch-vals">' +
          row(t.fill, 'Fill', t.fill) +
          row(t.stroke, 'Stroke', t.stroke) +
          row(t.text, 'Dark text', t.text) +
          row(t.dm, 'DM fill', t.dm) +
        '</div>';
      sw.appendChild(el);
    });
  }
  function row(swatchColor, k, v) {
    return '<div class="row"><span class="chip" style="background:' + swatchColor + '"></span>' +
           '<span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

  /* ---- 04 · Spacing bars ---- */
  var sp = document.getElementById('spacing');
  if (sp) {
    [4, 8, 12, 16, 24, 32, 48].forEach(function (n) {
      var r = document.createElement('div');
      r.className = 'row';
      r.innerHTML = '<span class="bar" style="width:' + n + 'px"></span><span class="px">' + n + '</span>';
      sp.appendChild(r);
    });
  }

  /* ---- 07 · Zone tiles ---- */
  function zoneTiles(containerId, mode) {
    var c = document.getElementById(containerId);
    if (!c) return;
    TEAMS.forEach(function (t) {
      var fill = mode === 'dark' ? t.dm : t.fill;
      var bg = mode === 'dark' ? '' : '';
      var el = document.createElement('div');
      el.className = 'zone-tile ' + (mode === 'dark' ? 'ondark' : 'onlight');
      el.innerHTML =
        '<svg width="100%" height="48" viewBox="0 0 80 48" preserveAspectRatio="none">' +
          '<polygon points="40,4 74,18 62,44 18,44 6,18" fill="' + fill + '" stroke="' + t.stroke + '" stroke-width="1.5"/>' +
        '</svg>' +
        '<span class="zn" style="color:' + (mode === 'dark' ? '' : t.text) + '">' + t.key + '</span>';
      c.appendChild(el);
    });
  }
  zoneTiles('zones-light', 'light');
  zoneTiles('zones-dark', 'dark');

  /* ---- 09 · Celebration confetti ---- */
  var COLORS = ['#9333ea', '#16a34a', '#2563eb', '#dc2626', '#bfdbfe', '#bbf7d0'];
  var stage = document.getElementById('burstStage');
  var replay = document.getElementById('replayBtn');

  function spawnConfetti() {
    if (!stage) return;
    stage.querySelectorAll('.confetti').forEach(function (n) { n.remove(); });
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    for (var i = 0; i < 16; i++) {
      var c = document.createElement('span');
      c.className = 'confetti';
      var ang = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.4;
      var dist = 110 + Math.random() * 90;
      c.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      c.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
      c.style.setProperty('--rot', (Math.random() * 540 - 270) + 'deg');
      c.style.background = COLORS[i % COLORS.length];
      c.style.animationDelay = (Math.random() * 0.06) + 's';
      if (i % 3 === 0) c.style.borderRadius = '50%';
      stage.appendChild(c);
    }
  }

  function play() {
    if (!stage) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    stage.classList.remove('playing');
    void stage.offsetWidth; // reflow to restart CSS animations
    if (reduce) { return; } // already resting on the composed end-frame
    stage.classList.add('playing');
    spawnConfetti();
    // settle back to the resting end-frame after the entrance completes.
    // guarantees the badge/text never linger at their from-state (e.g. if the
    // frame is offscreen/paused mid-animation).
    clearTimeout(stage._t);
    stage._t = setTimeout(function () {
      stage.classList.remove('playing');
      stage.querySelectorAll('.confetti').forEach(function (n) { n.remove(); });
    }, 1100);
  }

  if (replay) replay.addEventListener('click', play);

  // initial play once fonts/layout settle
  window.addEventListener('load', function () { setTimeout(play, 350); });
})();
