/* ============================================================
   LIVING LIGHT — motion.js (shared by all five surfaces)
   Real spring integrator (Apple params): k=(2π/T)², c=4πζ/T,
   mass 1, semi-implicit Euler, velocity handoff on retarget.
   Plus: odometer digit-roll (numericText port), FLIP hero,
   stagger, shine/ignite triggers keyed to REAL value diffs.
   Honest-motion law: helpers animate only changes the caller
   has verified against actual state. This file never invents
   a state change.
   ============================================================ */
(function(global){
"use strict";

/* ---------- springs ---------- */
function springParams(T, zeta){ return { k:(2*Math.PI/T)*(2*Math.PI/T), c:4*Math.PI*zeta/T }; }
var PRESETS = {
  track:  springParams(0.15, 0.86),  /* interactiveSpring — gesture tracking */
  settle: springParams(0.50, 0.85),  /* snappy settle */
  smooth: springParams(0.50, 1.00),  /* critically damped */
  gentle: springParams(0.65, 0.90)
};
/* Animate obj {x} toward target with a named spring; onUpdate(x, v).
   Returns handle with retarget(newTarget) — velocity carries over. */
function springTo(obj, target, preset, onUpdate, onDone){
  var p = PRESETS[preset] || PRESETS.settle;
  var x = obj.x, v = obj.v || 0, tgt = target, raf = null, last = null, dead = false;
  function frame(ts){
    if(dead) return;
    if(last == null) last = ts;
    var dt = Math.min((ts - last)/1000, 1/30); last = ts;
    var a = -p.k*(x - tgt) - p.c*v;
    v += a*dt; x += v*dt;
    obj.x = x; obj.v = v;
    onUpdate && onUpdate(x, v);
    if(Math.abs(x - tgt) < 0.05 && Math.abs(v) < 0.5){ obj.x = tgt; obj.v = 0; onUpdate && onUpdate(tgt, 0); dead = true; onDone && onDone(); return; }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return { retarget:function(t){ tgt = t; if(dead){ dead = false; last = null; raf = requestAnimationFrame(frame); } },
           cancel:function(){ dead = true; if(raf) cancelAnimationFrame(raf); },
           get value(){ return x; }, get velocity(){ return v; } };
}

/* ---------- smoothstep time remap (Core Image easing) ---------- */
function smoothstep(t){ t = Math.max(0, Math.min(1, t)); return t*t*(3 - 2*t); }

/* ---------- odometer (numericText port) ----------
   renderOdo(el, value, opts): rolls each digit column toward the
   new value. Direction follows sign of change unless opts.down.
   No-op (returns false) when the value is unchanged — the caller
   must not celebrate a non-change. */
function buildOdo(el, str){
  el.classList.add("ll-odo"); el.innerHTML = "";
  var cols = [];
  for(var i = 0; i < str.length; i++){
    var ch = str[i];
    if(/\d/.test(ch)){
      var d = document.createElement("span"); d.className = "ll-digit";
      var strip = document.createElement("span"); strip.className = "ll-strip";
      for(var n = 0; n < 10; n++){ var s = document.createElement("span"); s.textContent = n; strip.appendChild(s); }
      d.appendChild(strip); el.appendChild(d);
      cols.push({ strip: strip, digit: +ch });
      strip.style.transform = "translateY(" + (-ch) + "em)";
    } else {
      var p = document.createElement("span"); p.textContent = ch; el.appendChild(p);
      cols.push({ strip: null, digit: null });
    }
  }
  return cols;
}
function renderOdo(el, value, opts){
  opts = opts || {};
  var str = String(value);
  var prev = el.getAttribute("data-odo");
  if(prev === str) return false;               /* unchanged — no roll */
  var cols = buildOdo(el, str);
  el.setAttribute("data-odo", str);
  requestAnimationFrame(function(){
    cols.forEach(function(c){
      if(!c.strip) return;
      c.strip.style.transition = "transform 600ms cubic-bezier(.22,1,.36,1)";
      c.strip.style.transform = "translateY(" + (-c.digit) + "em)";
    });
  });
  return true;
}

/* ---------- FLIP hero (matchedGeometry port) ----------
   flipTo(el, applyChange, preset): measures el, runs applyChange
   (the DOM/layout change), inverts, springs to identity. */
function flipTo(el, applyChange, preset){
  var first = el.getBoundingClientRect();
  applyChange();
  var lastR = el.getBoundingClientRect();
  var dx = first.left - lastR.left, dy = first.top - lastR.top;
  var sx = lastR.width ? first.width/lastR.width : 1, sy = lastR.height ? first.height/lastR.height : 1;
  var state = { x: 0 };
  var from = { scale: sx, dx: dx, dy: dy };
  el.style.transformOrigin = "top left";
  return springTo(state, 1, preset || "settle", function(t){
    var s = smoothstep(t);
    var cdx = from.dx*(1-s), cdy = from.dy*(1-s);
    var csx = from.scale + (1-from.scale)*s, csy = from.scale + (1-from.scale)*s;
    el.style.transform = "translate(" + cdx + "px," + cdy + "px) scale(" + csx + "," + csy + ")";
  }, function(){ el.style.transform = ""; });
}

/* ---------- stagger (index-computed fan-out) ---------- */
function staggerIn(nodes, baseDelay){
  nodes = Array.prototype.slice.call(nodes);
  nodes.forEach(function(n, i){
    n.style.animationDelay = (i*(baseDelay || 40)) + "ms";
    n.classList.add("ll-arrive");
  });
}

/* ---------- event triggers ---------- */
function shine(el, color){ if(color) el.style.setProperty("--shine-c", color);
  el.classList.remove("go"); void el.offsetWidth; setTimeout(function(){ el.classList.add("go"); }, 500); }
function ignite(el){ el.classList.remove("ll-ignite"); void el.offsetWidth; el.classList.add("ll-ignite"); }
function shake(el){ el.classList.remove("ll-shake"); void el.offsetWidth; el.classList.add("ll-shake"); }

global.LivingLight = { springTo: springTo, springParams: springParams, PRESETS: PRESETS,
  smoothstep: smoothstep, renderOdo: renderOdo, flipTo: flipTo,
  staggerIn: staggerIn, shine: shine, ignite: ignite, shake: shake };
})(window);
