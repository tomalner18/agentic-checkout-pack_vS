// A mock hotel booking site and a mock payment provider, zero dependencies.
//
//   http://localhost:4100   Casa Halcy, the hotel's own booking site
//   http://localhost:4101   MockPay, the hotel's payment provider (hosted card
//                           fields in an iframe, plus the bank's 3-D Secure step)
//
// Two origins on purpose: on a real hotel site the card fields are served by the
// payment provider, not by the hotel. Everything lives in memory and resets when
// the process restarts. Run with `npm run hotel`.

import http from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";

const HOTEL_PORT = Number(process.env.HOTEL_PORT ?? 4100);
const PAY_PORT = Number(process.env.PAY_PORT ?? 4101);
const HOTEL = `http://localhost:${HOTEL_PORT}`;
const PAY = `http://localhost:${PAY_PORT}`;
const HOLD_MINUTES = Number(process.env.HOLD_MINUTES ?? 15);
const SESSION_COOKIE = "casahalcy_session";
const HERO = readFileSync(new URL("./public/hero.webp", import.meta.url));

// ---------------------------------------------------------------------------
// Inventory and pricing
// ---------------------------------------------------------------------------

const ROOMS = {
  classic: {
    name: "Classic double",
    blurb: "18 m², courtyard side, double bed. Quiet, small, lovely.",
    base: 148,
    maxGuests: 2,
  },
  superior: {
    name: "Superior double",
    blurb: "26 m², street side with a Juliet balcony, double bed and a sofa bed.",
    base: 182,
    maxGuests: 3,
  },
  river: {
    name: "River-view double",
    blurb: "24 m², top floor, the view this house is named for.",
    base: 239,
    maxGuests: 2,
    // Sold out on any Friday or Saturday night.
    soldOut: (nights) => nights.some((d) => [5, 6].includes(d.getUTCDay())),
  },
};

const RATES = {
  flex: {
    name: "Flexible",
    terms:
      "Free cancellation until 48 hours before arrival. Nothing is charged now: your card is held as a guarantee and you pay at the hotel.",
    factor: 1,
    payNow: false,
  },
  saver: {
    name: "Saver, non-refundable",
    terms: "12% cheaper. The full amount is charged now and is not refundable if you cancel or don't show up.",
    factor: 0.88,
    payNow: true,
  },
};

const WEEKEND_SUPPLEMENT = 20; // per Friday/Saturday night
const LONG_STAY_NIGHTS = 5; // stays this long lose the searched rate at checkout...
const LONG_STAY_SURGE = 12; // ...and go up by this much per night ("last room at this rate")
const BREAKFAST = 16; // per person per night
const TOURIST_TAX = 4; // per person per night, max 7 nights, paid at the hotel
const UPGRADE_DELTA = ROOMS.superior.base - ROOMS.classic.base;

const eur = (n) => `€${n.toFixed(2)}`;
const round2 = (n) => Math.round(n * 100) / 100;

function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nightsBetween(checkin, checkout) {
  const out = [];
  for (let d = new Date(checkin); d < checkout; d = new Date(d.getTime() + 86400000)) out.push(d);
  return out;
}

function todayUTC() {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

/** Validates a stay from query/body fields. Returns { stay } or { error }. */
function readStay(q) {
  const checkin = parseDate(q.checkin);
  const checkout = parseDate(q.checkout);
  const adults = Number(q.adults);
  if (!checkin || !checkout) return { error: "Pick your dates first." };
  if (checkin < todayUTC()) return { error: "Check-in can't be in the past." };
  if (checkout <= checkin) return { error: "Check-out has to be after check-in." };
  const nights = nightsBetween(checkin, checkout);
  if (nights.length > 14) return { error: "Online bookings are up to 14 nights." };
  if (!Number.isInteger(adults) || adults < 1 || adults > 4) return { error: "Online bookings are for 1 to 4 guests." };
  return { stay: { checkin: q.checkin, checkout: q.checkout, adults, nights } };
}

function price(roomId, rateId, stay, breakfast, { surge = 0 } = {}) {
  const room = ROOMS[roomId];
  const rate = RATES[rateId];
  const nightly = stay.nights.map((d) =>
    round2((room.base + surge + ([5, 6].includes(d.getUTCDay()) ? WEEKEND_SUPPLEMENT : 0)) * rate.factor),
  );
  const roomTotal = round2(nightly.reduce((a, b) => a + b, 0));
  const breakfastTotal = breakfast ? BREAKFAST * stay.adults * stay.nights.length : 0;
  const tax = TOURIST_TAX * stay.adults * Math.min(stay.nights.length, 7);
  const total = round2(roomTotal + breakfastTotal);
  return {
    nightly,
    roomTotal,
    breakfastTotal,
    tax,
    total,
    // What leaves the guest's card at checkout vs what they settle at the desk.
    payNow: rate.payNow ? total : 0,
    payAtHotel: round2((rate.payNow ? 0 : total) + tax),
  };
}

// ---------------------------------------------------------------------------
// State (in memory)
// ---------------------------------------------------------------------------

const holds = new Map(); // holdId -> hold
const intents = new Map(); // MockPay intentId -> intent
const bookings = []; // confirmed bookings
const phone = []; // what the guest's phone has received (3-D Secure codes)

const id = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;
const expired = (h) => Date.now() - h.created > HOLD_MINUTES * 60000;

function liveHold(holdId) {
  const h = holds.get(holdId);
  if (!h) return { error: "We couldn't find that booking. Please start again." };
  if (h.booking) return { error: "This booking is already confirmed.", hold: h };
  if (expired(h))
    return { error: `We held your room for ${HOLD_MINUTES} minutes and it has now been released. Please start again.` };
  return { hold: h };
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter(([k]) => k),
  );
}

/** Like most real hotel sites, a booking only continues in the browser that started it. */
function sameBrowser(req, h) {
  return cookies(req)[SESSION_COOKIE] === h.session && (req.headers["user-agent"] ?? "") === h.userAgent;
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;1,300&family=Hanken+Grotesk:wght@300;400;500&display=swap" rel="stylesheet">`;

const CSS = `
:root{--white:#fff;--ground:#fafafa;--ink:#181818;--ink-soft:#5c5c5c;--grey:#999;--rule:rgba(24,24,24,.16);
--serif:"Cormorant Garamond","Iowan Old Style",Georgia,serif;--sans:"Hanken Grotesk","Helvetica Neue",Arial,system-ui,sans-serif;
--gutter:clamp(1.25rem,.8rem + 2vw,3rem)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ground);color:var(--ink);font:300 16px/1.45 var(--sans);letter-spacing:-.005em;-webkit-font-smoothing:antialiased}
a{color:inherit;text-underline-offset:.2em;text-decoration-thickness:1px}
header{display:flex;justify-content:space-between;align-items:center;padding:20px var(--gutter);border-bottom:1px solid var(--rule)}
header .brand{font:300 28px/1 var(--serif);text-decoration:none;letter-spacing:-.01em}
header nav a{margin-left:20px;font-size:14px;text-decoration:none;color:var(--ink-soft)}
main{max-width:880px;margin:0 auto;padding:36px var(--gutter) 120px}
h1,h2{font-family:var(--serif);font-weight:300;text-transform:capitalize;letter-spacing:-.01em;line-height:1.1}
h1{font-size:clamp(2.4rem,1.6rem + 3vw,3.6rem);margin:0 0 10px}h2{font-size:1.75rem;margin:32px 0 12px}
.soft{color:var(--ink-soft);font-size:14px}
.block{border-top:1px solid var(--rule);padding:22px 0;margin:0}
label{display:block;font-size:13px;color:var(--ink-soft);margin:14px 0 6px}
input,select,textarea{font:400 15px var(--sans);color:var(--ink);padding:12px;border:1px solid var(--rule);border-radius:0;width:100%;background:var(--white)}
input:focus,select:focus,textarea:focus{outline:2px solid var(--ink);outline-offset:-1px}
input[type=checkbox]{width:auto;margin-right:10px;accent-color:var(--ink)}
.check{display:flex;align-items:flex-start;color:var(--ink);font-size:15px}
button,.btn{font:400 15px var(--sans);background:var(--ink);color:var(--white);border:1px solid var(--ink);border-radius:0;min-height:48px;padding:0 22px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
button.secondary,.btn.secondary{background:transparent;color:var(--ink)}button:disabled{opacity:.45;cursor:not-allowed}
.row{display:flex;gap:16px;flex-wrap:wrap}.row>*{flex:1;min-width:170px}
.room h2{margin-top:0}
.rate{display:flex;justify-content:space-between;gap:18px;align-items:center;border-top:1px solid var(--rule);padding:16px 0}
.rate .terms{max-width:30rem}.price{font:300 26px/1 var(--serif);white-space:nowrap;margin-bottom:4px}
.sold{color:var(--ink-soft);font-style:italic}
.err{border:1px solid var(--ink);background:var(--white);padding:14px 16px;margin:16px 0;font-size:14px}
.notice{border-left:3px solid var(--ink);background:var(--white);padding:14px 16px;margin:16px 0;font-size:15px}
table.sum{width:100%;border-collapse:collapse;font-size:15px}table.sum td{padding:8px 0;border-bottom:1px solid var(--rule)}
table.sum td:last-child{text-align:right;white-space:nowrap;padding-left:16px}table.sum tr.total td{font-weight:500;border-bottom:0}
.hero{position:relative;min-height:46vh;display:flex;align-items:flex-end;color:var(--white);background:var(--ink) url(/hero.webp) center 40%/cover;isolation:isolate}
.hero::after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(to top,rgba(0,0,0,.6),rgba(0,0,0,.15))}
.hero div{padding:0 var(--gutter) 36px;max-width:880px;margin:0 auto;width:100%}.hero h1{margin:0 0 8px}.hero p{margin:0;max-width:30rem}
.cal{position:absolute;background:var(--white);border:1px solid var(--ink);padding:14px;z-index:20;width:310px}
.cal .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;text-transform:capitalize}
.cal .hd button{min-height:34px;padding:0 12px}
.cal .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:13px;text-align:center}
.cal .grid div{padding:8px 0}.cal .day{cursor:pointer}.cal .day:hover{background:var(--ground)}
.cal .off{color:var(--grey);cursor:default}.cal .sel{background:var(--ink);color:var(--white)}.cal .in{background:#ececec}
.stepper{display:flex;align-items:center;gap:12px}.stepper button{min-height:40px;padding:0 14px}
#cookies{position:fixed;inset:0;background:rgba(24,24,24,.4);display:flex;align-items:flex-end;z-index:50}
#cookies .box{background:var(--white);width:100%;padding:24px var(--gutter);font-size:14px;border-top:1px solid var(--ink)}
.modal{position:fixed;inset:0;background:rgba(24,24,24,.45);display:none;align-items:center;justify-content:center;z-index:40;padding:16px}
.modal .box{background:var(--white);max-width:440px;padding:28px;border:1px solid var(--ink)}
.modal .box a.no{font-size:13px;color:var(--ink-soft);display:block;margin-top:16px;text-align:center}
.timer{font-size:13px;border:1px solid var(--rule);background:var(--white);padding:8px 12px;display:inline-block}
iframe{width:100%;border:0;min-height:340px}
footer{font-size:12px;color:var(--ink-soft);text-align:center;padding:32px var(--gutter);border-top:1px solid var(--rule)}
`;

function page(title, body, { cookieBanner = false, hero = "" } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Casa Halcy</title>${FONTS}<style>${CSS}</style></head><body>
<header><a class="brand" href="/">Casa Halcy</a><nav><a href="/">Book</a><a href="#">Rooms</a><a href="#">The neighbourhood</a><a href="#">Contact</a></nav></header>
${hero}<main>${body}</main>
<footer>Casa Halcy is a fictional hotel. This site is a mock for an interview exercise: no real bookings, no real payments.</footer>
${cookieBanner ? COOKIE_BANNER : ""}
</body></html>`;
}

const COOKIE_BANNER = `<div id="cookies" role="dialog" aria-label="Cookie consent"><div class="box">
<strong style="font-weight:500">We value your privacy</strong><p>We and our 214 partners use cookies to personalise content, measure our ads and remember you. You can accept all, or manage your choices.</p>
<div class="row" style="max-width:440px"><button id="cookie-accept">Accept all</button><button class="secondary" id="cookie-manage">Manage choices</button></div>
<div id="cookie-prefs" style="display:none;margin-top:14px"><label class="check"><input type="checkbox" checked disabled>Strictly necessary</label><label class="check"><input type="checkbox" checked>Analytics</label><label class="check"><input type="checkbox" checked>Advertising</label><button class="secondary" id="cookie-save">Save choices</button></div>
</div></div>
<script>
(function(){
  if (document.cookie.includes("consent=")) { document.getElementById("cookies").remove(); return; }
  function done(v){ document.cookie = "consent=" + v + ";path=/"; document.getElementById("cookies").remove(); }
  document.getElementById("cookie-accept").onclick = function(){ done("all"); };
  document.getElementById("cookie-manage").onclick = function(){ document.getElementById("cookie-prefs").style.display = "block"; };
  document.getElementById("cookie-save").onclick = function(){ done("custom"); };
})();
</script>`;

function holdTimer(h) {
  const expires = h.created + HOLD_MINUTES * 60000;
  return `<p class="timer" id="timer" data-expires="${expires}">We're holding this room for you</p>
<script>(function(){var el=document.getElementById("timer");function t(){var s=Math.max(0,Math.round((+el.dataset.expires-Date.now())/1000));
el.textContent=s?"We're holding this room for you for "+Math.floor(s/60)+":"+String(s%60).padStart(2,"0"):"Your hold has expired";}t();setInterval(t,1000);})();</script>`;
}

function summaryTable(h, p, { showTax }) {
  const room = ROOMS[h.room];
  const rate = RATES[h.rate];
  return `<table class="sum">
<tr><td>${esc(room.name)}, ${esc(rate.name.toLowerCase())} rate</td><td></td></tr>
<tr><td>${esc(h.checkin)} to ${esc(h.checkout)} · ${h.nights} night${h.nights > 1 ? "s" : ""} · ${h.adults} guest${h.adults > 1 ? "s" : ""}</td><td></td></tr>
<tr><td>Room</td><td>${eur(p.roomTotal)}</td></tr>
${p.breakfastTotal ? `<tr><td>Breakfast</td><td>${eur(p.breakfastTotal)}</td></tr>` : ""}
${showTax ? `<tr><td>Tourist tax (${eur(TOURIST_TAX)} per person per night, max 7 nights), paid at the hotel</td><td>${eur(p.tax)}</td></tr>` : ""}
<tr class="total"><td>${showTax ? "Total" : "Subtotal"}</td><td>${eur(showTax ? p.total + p.tax : p.total)}</td></tr>
${showTax ? `<tr><td>Charged now</td><td>${eur(p.payNow)}</td></tr><tr><td>Paid at the hotel</td><td>${eur(p.payAtHotel)}</td></tr>` : ""}
</table>`;
}

const stayQuery = (q) => new URLSearchParams(pick(q, ["checkin", "checkout", "adults"]));

// ---------------------------------------------------------------------------
// Hotel pages
// ---------------------------------------------------------------------------

function searchPage(q, error) {
  return page(
    "Book a room",
    `${error ? `<div class="err">${esc(error)}</div>` : ""}
<form id="search" action="/rooms" method="get" autocomplete="off">
<h2 style="margin-top:0">Check availability</h2>
<div class="row" style="position:relative">
  <div><label for="checkin-display">Check-in</label><input id="checkin-display" placeholder="Add date" readonly></div>
  <div><label for="checkout-display">Check-out</label><input id="checkout-display" placeholder="Add date" readonly></div>
  <div class="cal" id="cal" style="display:none;top:82px;left:0"></div>
</div>
<input type="hidden" name="checkin" id="checkin" value="${esc(q.checkin)}"><input type="hidden" name="checkout" id="checkout" value="${esc(q.checkout)}">
<label>Guests</label>
<div class="stepper"><button type="button" class="secondary" id="minus" aria-label="Fewer guests">−</button><span id="adults-label">2 adults</span><button type="button" class="secondary" id="plus" aria-label="More guests">+</button></div>
<input type="hidden" name="adults" id="adults" value="${esc(q.adults ?? 2)}">
<p style="margin-top:24px"><button type="submit">Check availability</button></p>
</form>
<script>
(function(){
  var MONTHS=["january","february","march","april","may","june","july","august","september","october","november","december"];
  var cal=document.getElementById("cal"), ci=document.getElementById("checkin"), co=document.getElementById("checkout");
  var ciD=document.getElementById("checkin-display"), coD=document.getElementById("checkout-display");
  var today=new Date(); today=new Date(Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()));
  var view=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1));
  var picking="in";
  function iso(d){return d.toISOString().slice(0,10);}
  function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
  function pretty(s){if(!s)return"";var d=new Date(s+"T00:00:00Z");return d.getUTCDate()+" "+cap(MONTHS[d.getUTCMonth()].slice(0,3))+" "+d.getUTCFullYear();}
  function sync(){ciD.value=pretty(ci.value);coD.value=pretty(co.value);}
  function draw(){
    var h='<div class="hd"><button type="button" class="secondary" id="prev" aria-label="Previous month">‹</button><span>'+MONTHS[view.getUTCMonth()]+" "+view.getUTCFullYear()+'</span><button type="button" class="secondary" id="next" aria-label="Next month">›</button></div><div class="grid">';
    ["Mo","Tu","We","Th","Fr","Sa","Su"].forEach(function(x){h+='<div class="soft">'+x+"</div>";});
    var first=(view.getUTCDay()+6)%7; for(var i=0;i<first;i++)h+="<div></div>";
    var m=view.getUTCMonth();
    for(var d=new Date(view);d.getUTCMonth()===m;d=new Date(d.getTime()+86400000)){
      var s=iso(d), cls="day";
      if(d<today)cls="off"; else if(s===ci.value||s===co.value)cls+=" sel"; else if(ci.value&&co.value&&s>ci.value&&s<co.value)cls+=" in";
      h+='<div class="'+cls+'" data-date="'+s+'">'+d.getUTCDate()+"</div>";
    }
    cal.innerHTML=h+"</div>";
    document.getElementById("prev").onclick=function(e){e.stopPropagation();view=new Date(Date.UTC(view.getUTCFullYear(),view.getUTCMonth()-1,1));draw();};
    document.getElementById("next").onclick=function(e){e.stopPropagation();view=new Date(Date.UTC(view.getUTCFullYear(),view.getUTCMonth()+1,1));draw();};
    cal.querySelectorAll(".day").forEach(function(el){el.onclick=function(e){
      e.stopPropagation(); var s=el.dataset.date;
      if(picking==="in"||s<=ci.value){ci.value=s;co.value="";picking="out";}
      else{co.value=s;picking="in";cal.style.display="none";}
      sync();draw();
    };});
  }
  function open(which){picking=which;if(which==="out"&&!ci.value)picking="in";cal.style.display="block";draw();}
  ciD.onclick=function(e){e.stopPropagation();open("in");}; coD.onclick=function(e){e.stopPropagation();open("out");};
  document.addEventListener("click",function(e){if(!cal.contains(e.target))cal.style.display="none";});
  var a=document.getElementById("adults"), al=document.getElementById("adults-label");
  function lab(){al.textContent=a.value+(a.value==="1"?" adult":" adults");}
  document.getElementById("minus").onclick=function(){a.value=Math.max(1,+a.value-1);lab();};
  document.getElementById("plus").onclick=function(){a.value=Math.min(4,+a.value+1);lab();};
  if(ci.value){var d0=new Date(ci.value+"T00:00:00Z");view=new Date(Date.UTC(d0.getUTCFullYear(),d0.getUTCMonth(),1));}
  sync();lab();
})();
</script>`,
    {
      cookieBanner: true,
      hero: `<section class="hero"><div><h1>Stay with us in Lisbon</h1><p>A twelve-room guesthouse under the Miradouro de Santa Luzia. Best rate guaranteed when you book here.</p></div></section>`,
    },
  );
}

function roomsPage(q) {
  const { stay, error } = readStay(q);
  if (error) return searchPage(q, error);
  const rooms = Object.entries(ROOMS).map(([roomId, room]) => {
    const tooMany = stay.adults > room.maxGuests;
    const sold = room.soldOut?.(stay.nights);
    const rates = tooMany
      ? `<p class="sold">Sleeps up to ${room.maxGuests}.</p>`
      : sold
        ? `<p class="sold">Sold out for your dates.</p>`
        : Object.entries(RATES)
            .map(([rateId, rate]) => {
              const p = price(roomId, rateId, stay, false);
              const href = `/details?${new URLSearchParams({ ...pick(q, ["checkin", "checkout", "adults"]), room: roomId, rate: rateId })}`;
              return `<div class="rate"><div class="terms"><strong style="font-weight:500">${esc(rate.name)}</strong><div class="soft">${esc(rate.terms)}</div></div>
<div style="text-align:right"><div class="price">${eur(p.roomTotal)}</div><div class="soft">${stay.nights.length} night${stay.nights.length > 1 ? "s" : ""}, room only</div>
<a class="btn select" style="margin-top:10px" data-room="${roomId}" href="${href}">Select</a></div></div>`;
            })
            .join("");
    return `<section class="block room"><h2>${esc(room.name)}</h2><p class="soft">${esc(room.blurb)}</p>${rates}</section>`;
  });
  const upgradeHref = (rate) =>
    `/details?${new URLSearchParams({ ...pick(q, ["checkin", "checkout", "adults"]), room: "superior", rate })}`;
  return page(
    "Choose a room",
    `<p><a href="/?${stayQuery(q)}" class="soft">‹ Change dates</a></p>
<h1>Choose your room</h1><p class="soft">${esc(q.checkin)} to ${esc(q.checkout)} · ${stay.adults} guest${stay.adults > 1 ? "s" : ""} · Prices include VAT</p>
${rooms.join("")}
<div class="modal" id="upsell" role="dialog" aria-label="Upgrade offer"><div class="box">
<h2 style="margin-top:0">Treat yourself?</h2><p>Upgrade to the <strong style="font-weight:500">Superior double</strong> for only <strong style="font-weight:500">${eur(UPGRADE_DELTA)} more per night</strong>. More space, a balcony, and 9 out of 10 guests say it's worth it.</p>
<a class="btn" id="upsell-yes" style="display:flex;width:100%" href="#">Yes, upgrade my stay</a>
<a class="no" id="upsell-no" href="#">No thanks, keep the Classic double</a></div></div>
<script>
(function(){
  var modal=document.getElementById("upsell"), yes=document.getElementById("upsell-yes"), no=document.getElementById("upsell-no");
  var up={flex:${JSON.stringify(upgradeHref("flex"))},saver:${JSON.stringify(upgradeHref("saver"))}};
  document.querySelectorAll("a.select").forEach(function(a){
    if(a.dataset.room!=="classic")return;
    a.addEventListener("click",function(e){
      e.preventDefault(); var rate=new URL(a.href).searchParams.get("rate");
      yes.href=up[rate]; no.href=a.href; modal.style.display="flex";
    });
  });
})();
</script>`,
  );
}

function detailsPage(q, error) {
  const { stay, error: stayError } = readStay(q);
  if (stayError) return searchPage(q, stayError);
  if (!ROOMS[q.room] || !RATES[q.rate]) return searchPage(q, "Please choose a room.");
  if (ROOMS[q.room].soldOut?.(stay.nights) || stay.adults > ROOMS[q.room].maxGuests) return roomsPage(q);
  const p = price(q.room, q.rate, stay, false);
  const h = { ...q, nights: stay.nights.length, adults: stay.adults };
  const v = (k) => esc(q[k] ?? "");
  return page(
    "Your details",
    `<p><a class="soft" href="/rooms?${stayQuery(q)}">‹ Back to rooms</a></p>
<h1>Your details</h1>
<section class="block">${summaryTable(h, p, { showTax: false })}</section>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<form class="block" method="post" action="/details">
${["checkin", "checkout", "adults", "room", "rate"].map((k) => `<input type="hidden" name="${k}" value="${v(k)}">`).join("")}
<div class="row"><div><label for="first">First name</label><input id="first" name="first" value="${v("first")}" required></div>
<div><label for="last">Last name</label><input id="last" name="last" value="${v("last")}" required></div></div>
<div class="row"><div><label for="email">Email</label><input id="email" name="email" type="email" value="${v("email")}" required></div>
<div><label for="phone">Mobile phone</label><input id="phone" name="phone" value="${v("phone")}" placeholder="+46 70 123 45 67" required></div></div>
<div class="row"><div><label for="arrival">Estimated arrival</label><select id="arrival" name="arrival">
${["I don't know yet", "Before 14:00", "14:00 to 18:00", "18:00 to 22:00", "After 22:00"].map((o) => `<option${q.arrival === o ? " selected" : ""}>${o}</option>`).join("")}
</select></div><div></div></div>
<label for="requests">Special requests (not guaranteed)</label><textarea id="requests" name="requests" rows="3">${v("requests")}</textarea>
<h2>Make it better</h2>
<label class="check"><input type="checkbox" name="breakfast" checked> Add breakfast in the courtyard, ${eur(BREAKFAST)} per person per night</label>
<label class="check"><input type="checkbox" name="marketing" checked> Send me offers and news from Casa Halcy and selected partners</label>
<p style="margin-top:24px"><button type="submit">Continue to payment</button></p>
</form>`,
  );
}

function paymentPage(req, holdId) {
  const { hold: h, error } = liveHold(holdId);
  if (error && h?.booking) return redirectHtml(`/confirmation/${h.booking}`);
  if (error) return page("Session expired", `<div class="err">${esc(error)}</div><p><a class="btn" href="/">Start again</a></p>`);
  if (!sameBrowser(req, h))
    return page(
      "Session not found",
      `<div class="err">This booking was started in another browser. For your security, it can only be completed in the browser where it started. Please start again.</div><p><a class="btn" href="/">Start again</a></p>`,
    );
  const rate = RATES[h.rate];
  const p = h.price;
  const amount = rate.payNow ? p.payNow : 0;
  // A declined or abandoned card gets a fresh payment session on reload.
  if (intents.get(h.intent)?.status === "failed") {
    const fresh = { ...intents.get(h.intent), id: id("pi"), status: "requires_card", created: Date.now() };
    delete fresh.failure;
    intents.set(fresh.id, fresh);
    h.intent = fresh.id;
  }
  const fields = `${PAY}/fields?${new URLSearchParams({ intent: h.intent, origin: HOTEL })}`;
  return page(
    "Payment",
    `<h1>${rate.payNow ? "Payment" : "Guarantee your booking"}</h1>${holdTimer(h)}
${
  h.priceChange
    ? `<div class="notice">The price for your stay has gone up since you searched: the last room at that rate has just been taken. Room only, it was ${eur(h.priceChange.was)} and is now ${eur(h.priceChange.now)}.</div>`
    : ""
}
<section class="block">${summaryTable(h, p, { showTax: true })}</section>
<section class="block"><p class="soft">${
      rate.payNow
        ? `Your card will be charged ${eur(amount)} now. This rate is non-refundable.`
        : "Nothing is charged now. We hold your card as a guarantee. If you cancel later than 48 hours before arrival, or don't arrive, the first night is charged."
    }</p>
<iframe id="mockpay" title="Secure card payment" src="${fields}"></iframe>
<label class="check"><input type="checkbox" id="terms"> I have read and accept the&nbsp;<a href="/conditions" target="_blank">booking conditions</a>&nbsp;and the cancellation policy</label>
<div class="err" id="pay-error" style="display:none"></div>
</section>
<script>
(function(){
  var frame=document.getElementById("mockpay"), terms=document.getElementById("terms"), err=document.getElementById("pay-error");
  window.addEventListener("message",function(e){
    if(e.origin!==${JSON.stringify(PAY)})return;
    var m=e.data||{};
    if(m.type==="mockpay:can-submit"){
      frame.contentWindow.postMessage({type:"mockpay:can-submit-reply",ok:terms.checked},${JSON.stringify(PAY)});
      if(!terms.checked){err.textContent="Please accept the booking conditions first.";err.style.display="block";}
      else err.style.display="none";
    }
    if(m.type==="mockpay:succeeded"){
      fetch("/api/book",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({hold:${JSON.stringify(h.id)},token:m.token,terms:terms.checked})})
        .then(function(r){return r.json();}).then(function(r){
          if(r.ok)location.href="/confirmation/"+r.reference; else{err.textContent=r.error;err.style.display="block";}
        });
    }
    if(m.type==="mockpay:failed"){
      err.innerHTML="";err.appendChild(document.createTextNode(m.reason+" "));
      var again=document.createElement("a");again.href=location.href;again.textContent="Try another card";err.appendChild(again);
      err.style.display="block";
    }
  });
})();
</script>`,
  );
}

function confirmationPage(ref) {
  const b = bookings.find((x) => x.reference === ref);
  if (!b) return page("Not found", `<div class="err">We couldn't find that booking.</div>`);
  return page(
    "Booking confirmed",
    `<h1>You're booked, ${esc(b.guest.first)}</h1><p class="soft">Booking reference</p><p style="font:300 34px/1 var(--serif);letter-spacing:2px;margin:0 0 20px">${esc(b.reference)}</p>
<section class="block">${summaryTable(b, b.price, { showTax: true })}<p class="soft">${
      b.card.mode === "charge"
        ? `${eur(b.card.amount)} was charged to the card ending ${esc(b.card.last4)}.`
        : `The card ending ${esc(b.card.last4)} is held as a guarantee. Nothing has been charged.`
    }</p></section>
<p class="soft">A confirmation has been sent to ${esc(b.guest.email)}. See you in Lisbon.</p>`,
  );
}

const CONDITIONS = page(
  "Booking conditions",
  `<h1>Booking conditions</h1><section class="block">
<p>Your contract is with Casa Halcy, Lda. (fictional). Prices are per room and include VAT. Tourist tax is collected at the hotel.</p>
<p><strong style="font-weight:500">Flexible rate:</strong> free cancellation until 48 hours before arrival. Later cancellations and no-shows are charged the first night to the guarantee card.</p>
<p><strong style="font-weight:500">Saver rate:</strong> charged in full at booking. No refunds, no changes.</p>
<p>Check-in from 15:00, check-out by 11:00. The name on the booking must match the guest's ID at check-in.</p></section>`,
);

function redirectHtml(to) {
  return `<!doctype html><meta http-equiv="refresh" content="0;url=${esc(to)}">`;
}

// ---------------------------------------------------------------------------
// MockPay pages (the second origin)
// ---------------------------------------------------------------------------

const PAY_CSS = `body{margin:0;font:14px system-ui,sans-serif;color:#1d2433;background:#fff}
.wrap{padding:14px;border:1px solid #d7dce6;border-radius:8px}.brand{font-size:11px;color:#6b7385;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
label{display:block;font-size:12px;color:#4b5366;margin:10px 0 4px}input{font:15px system-ui,sans-serif;padding:10px;border:1px solid #c5ccd9;border-radius:6px;width:100%;box-sizing:border-box}
.row{display:flex;gap:10px}.row>*{flex:1}button{margin-top:14px;width:100%;font:15px system-ui,sans-serif;background:#3a4cd8;color:#fff;border:0;border-radius:6px;padding:12px;cursor:pointer}
.err{color:#b4232a;margin-top:10px}.bank{background:#f4f6fb;padding:14px;border-radius:8px}`;

function payPage(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>MockPay</title><style>${PAY_CSS}</style></head><body>${body}</body></html>`;
}

function fieldsPage(q) {
  const intent = intents.get(q.intent);
  if (!intent) return payPage(`<div class="wrap"><p class="err">This payment session is not valid.</p></div>`);
  const label = intent.mode === "charge" ? `Pay ${eur(intent.amount)} and book` : "Confirm booking";
  return payPage(`<div class="wrap"><div class="brand">🔒 Secured by MockPay</div>
<form id="card" autocomplete="off">
<label for="cardholder">Name on card</label><input id="cardholder" name="cardholder" autocomplete="cc-name">
<label for="number">Card number</label><input id="number" name="number" inputmode="numeric" autocomplete="cc-number" placeholder="1234 1234 1234 1234">
<div class="row"><div><label for="exp">Expiry (MM/YY)</label><input id="exp" name="exp" placeholder="MM/YY" autocomplete="cc-exp"></div>
<div><label for="cvc">CVC</label><input id="cvc" name="cvc" inputmode="numeric" autocomplete="cc-csc"></div></div>
<button type="submit" id="submit">${esc(label)}</button><p class="err" id="err"></p></form></div>
<script>
(function(){
  var parentOrigin=${JSON.stringify(q.origin ?? HOTEL)}, form=document.getElementById("card"), err=document.getElementById("err");
  var pending=false;
  form.addEventListener("submit",function(e){
    e.preventDefault(); err.textContent=""; pending=true;
    parent.postMessage({type:"mockpay:can-submit"},parentOrigin);
  });
  window.addEventListener("message",function(e){
    if(e.origin!==parentOrigin||!pending)return;
    if(e.data&&e.data.type==="mockpay:can-submit-reply"){
      pending=false; if(!e.data.ok)return;
      fetch("/api/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        intent:${JSON.stringify(intent.id)},cardholder:form.cardholder.value,number:form.number.value,exp:form.exp.value,cvc:form.cvc.value
      })}).then(function(r){return r.json();}).then(function(r){
        if(r.error){err.textContent=r.error;return;}
        location.href="/challenge?"+new URLSearchParams({intent:${JSON.stringify(intent.id)},origin:parentOrigin});
      });
    }
  });
})();
</script>`);
}

function challengePage(q, error) {
  const intent = intents.get(q.intent);
  if (!intent) return payPage(`<p class="err">This payment session is not valid.</p>`);
  const what =
    intent.mode === "charge"
      ? `approve a payment of <strong>${eur(intent.amount)}</strong> to Casa Halcy`
      : `approve saving your card with Casa Halcy as a guarantee (<strong>${eur(0)}</strong> now)`;
  return payPage(`<div class="bank"><div class="brand">Your bank · 3-D Secure</div>
<p>Please ${what}.</p><p>We sent a 6-digit code to the phone number registered with your card. Enter it to continue.</p>
<form method="post" action="/challenge"><input type="hidden" name="intent" value="${esc(intent.id)}"><input type="hidden" name="origin" value="${esc(q.origin)}">
<label for="otp">Code</label><input id="otp" name="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
<button type="submit">Approve</button>${error ? `<p class="err">${esc(error)}</p>` : ""}</form></div>`);
}

function challengeDone(intent, origin) {
  const msg =
    intent.status === "succeeded"
      ? `{type:"mockpay:succeeded",token:${JSON.stringify(intent.id)}}`
      : `{type:"mockpay:failed",reason:${JSON.stringify(intent.failure)}}`;
  return payPage(`<div class="bank"><p>${intent.status === "succeeded" ? "Approved. Finishing your booking…" : esc(intent.failure)}</p></div>
<script>parent.postMessage(${msg},${JSON.stringify(origin)});</script>`);
}

function phonePage() {
  const rows = phone
    .slice()
    .reverse()
    .map(
      (m) =>
        `<li><strong>${esc(m.code)}</strong> · ${esc(m.text)} <span style="color:#6b7385">${new Date(m.at).toLocaleTimeString()}</span></li>`,
    )
    .join("");
  return payPage(`<div style="max-width:360px;margin:30px auto"><div class="brand">📱 The guest's phone</div>
<p>This page stands in for the traveller's own phone. A real agent never sees it. Use it to play the traveller when you test the hand-off.</p>
<ul>${rows || "<li>No messages yet</li>"}</ul><p><a href="/__phone">Refresh</a></p></div>`);
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] != null).map((k) => [k, String(obj[k])]));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("body too large");
  }
  if ((req.headers["content-type"] ?? "").includes("application/json")) return raw ? JSON.parse(raw) : {};
  return Object.fromEntries(new URLSearchParams(raw));
}

function send(res, status, body, type = "text/html; charset=utf-8", headers = {}) {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj, null, 2), "application/json");
const redirect = (res, to, headers = {}) => send(res, 303, "", "text/plain", { location: to, ...headers });

function luhn(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}

/** Cards that went through at the bank while the room was no longer held. */
function chargedWithoutBooking() {
  return [...intents.values()]
    .filter((i) => i.status === "succeeded")
    .map((i) => ({ intent: i, hold: holds.get(i.hold) }))
    .filter(({ hold }) => hold && !hold.booking && expired(hold))
    .map(({ intent, hold }) => ({
      intent: intent.id,
      mode: intent.mode,
      amount: intent.amount,
      last4: intent.last4,
      approvedAt: new Date(intent.approvedAt).toISOString(),
      holdExpiredAt: new Date(hold.created + HOLD_MINUTES * 60000).toISOString(),
      guest: hold.guest,
    }));
}

const hotel = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, HOTEL);
    const q = Object.fromEntries(url.searchParams);
    const path = url.pathname;

    if (req.method === "GET" && path === "/") return send(res, 200, searchPage(q));
    if (req.method === "GET" && path === "/hero.webp")
      return send(res, 200, HERO, "image/webp", { "cache-control": "max-age=3600" });
    if (req.method === "GET" && path === "/rooms") return send(res, 200, roomsPage(q));
    if (req.method === "GET" && path === "/details") return send(res, 200, detailsPage(q));
    if (req.method === "GET" && path === "/conditions") return send(res, 200, CONDITIONS);

    if (req.method === "POST" && path === "/details") {
      const b = await readBody(req);
      const { stay, error } = readStay(b);
      if (error) return send(res, 200, searchPage(b, error));
      if (!ROOMS[b.room] || !RATES[b.rate]) return send(res, 200, searchPage(b, "Please choose a room."));
      if (ROOMS[b.room].soldOut?.(stay.nights) || stay.adults > ROOMS[b.room].maxGuests)
        return send(res, 200, roomsPage(b));
      const missing = ["first", "last", "email", "phone"].filter((k) => !String(b[k] ?? "").trim());
      if (missing.length) return send(res, 200, detailsPage(b, `Please fill in: ${missing.join(", ")}.`));
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email))
        return send(res, 200, detailsPage(b, "That email doesn't look right."));
      const breakfast = b.breakfast === "on";
      const longStay = stay.nights.length >= LONG_STAY_NIGHTS;
      const p = price(b.room, b.rate, stay, breakfast, { surge: longStay ? LONG_STAY_SURGE : 0 });
      const session = cookies(req)[SESSION_COOKIE] ?? randomBytes(12).toString("hex");
      const hold = {
        id: id("hold"),
        created: Date.now(),
        session,
        userAgent: req.headers["user-agent"] ?? "",
        room: b.room,
        rate: b.rate,
        checkin: b.checkin,
        checkout: b.checkout,
        nights: stay.nights.length,
        adults: stay.adults,
        breakfast,
        marketing: b.marketing === "on",
        guest: pick(b, ["first", "last", "email", "phone", "arrival", "requests"]),
        price: p,
        priceChange: longStay ? { was: price(b.room, b.rate, stay, false).roomTotal, now: p.roomTotal } : null,
      };
      const intent = {
        id: id("pi"),
        hold: hold.id,
        mode: RATES[b.rate].payNow ? "charge" : "guarantee",
        amount: RATES[b.rate].payNow ? p.payNow : 0,
        status: "requires_card",
        created: Date.now(),
      };
      hold.intent = intent.id;
      holds.set(hold.id, hold);
      intents.set(intent.id, intent);
      return redirect(res, `/payment?hold=${hold.id}`, {
        "set-cookie": `${SESSION_COOKIE}=${session}; Path=/; HttpOnly; SameSite=Lax`,
      });
    }

    if (req.method === "GET" && path === "/payment") return send(res, 200, paymentPage(req, q.hold));

    if (req.method === "POST" && path === "/api/book") {
      const b = await readBody(req);
      const { hold: h, error } = liveHold(b.hold);
      if (error) return json(res, 200, { ok: false, error });
      if (!sameBrowser(req, h))
        return json(res, 200, { ok: false, error: "This booking can only be completed in the browser where it started." });
      if (b.terms !== true) return json(res, 200, { ok: false, error: "Please accept the booking conditions first." });
      const intent = intents.get(b.token);
      if (!intent || intent.hold !== h.id || intent.status !== "succeeded")
        return json(res, 200, { ok: false, error: "The payment wasn't completed. Please try again." });
      const booking = {
        reference: `CH-${randomInt(100000, 999999)}`,
        createdAt: new Date().toISOString(),
        room: h.room,
        rate: h.rate,
        checkin: h.checkin,
        checkout: h.checkout,
        nights: h.nights,
        adults: h.adults,
        breakfast: h.breakfast,
        marketing: h.marketing,
        guest: h.guest,
        price: h.price,
        priceChange: h.priceChange,
        card: { mode: intent.mode, amount: intent.amount, last4: intent.last4, cardholder: intent.cardholder },
        termsAccepted: true,
      };
      bookings.push(booking);
      h.booking = booking.reference;
      return json(res, 200, { ok: true, reference: booking.reference });
    }

    const conf = path.match(/^\/confirmation\/([A-Z0-9-]+)$/);
    if (req.method === "GET" && conf) return send(res, 200, confirmationPage(conf[1]));

    // Test-only endpoints. Not part of the hotel's site; for checking your runs.
    if (req.method === "GET" && path === "/__admin/bookings")
      return json(res, 200, { bookings, chargedWithoutBooking: chargedWithoutBooking() });
    if (req.method === "POST" && path === "/__admin/reset") {
      holds.clear();
      intents.clear();
      bookings.length = 0;
      phone.length = 0;
      return json(res, 200, { ok: true });
    }

    send(res, 404, page("Not found", `<div class="err">That page doesn't exist.</div>`));
  } catch (e) {
    console.error(e);
    send(res, 500, "Something went wrong", "text/plain");
  }
});

const pay = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, PAY);
    const q = Object.fromEntries(url.searchParams);
    const path = url.pathname;

    if (req.method === "GET" && path === "/fields") return send(res, 200, fieldsPage(q));

    if (req.method === "POST" && path === "/api/confirm") {
      const b = await readBody(req);
      const intent = intents.get(b.intent);
      if (!intent || intent.status === "succeeded") return json(res, 200, { error: "This payment session is not valid." });
      const number = String(b.number ?? "").replace(/\s+/g, "");
      if (!String(b.cardholder ?? "").trim()) return json(res, 200, { error: "Enter the name on the card." });
      if (!/^\d{16}$/.test(number) || !luhn(number)) return json(res, 200, { error: "Your card number is invalid." });
      const exp = String(b.exp ?? "").match(/^(\d{2})\s*\/\s*(\d{2})$/);
      if (!exp || +exp[1] < 1 || +exp[1] > 12) return json(res, 200, { error: "Enter the expiry as MM/YY." });
      const expEnd = new Date(Date.UTC(2000 + +exp[2], +exp[1], 1));
      if (expEnd <= new Date()) return json(res, 200, { error: "Your card has expired." });
      if (!/^\d{3}$/.test(String(b.cvc ?? ""))) return json(res, 200, { error: "Enter the 3-digit CVC." });
      intent.status = "requires_action";
      intent.last4 = number.slice(-4);
      intent.cardholder = String(b.cardholder).trim();
      intent.declines = number === "4000000000000002";
      intent.code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      intent.attempts = 0;
      phone.push({
        at: Date.now(),
        code: intent.code,
        text: `Your bank: code for ${intent.mode === "charge" ? eur(intent.amount) : "saving your card"} at Casa Halcy`,
      });
      console.log(`[guest's phone] 3-D Secure code ${intent.code} for ${intent.id}`);
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && path === "/challenge") return send(res, 200, challengePage(q));

    if (req.method === "POST" && path === "/challenge") {
      const b = await readBody(req);
      const intent = intents.get(b.intent);
      if (!intent || intent.status !== "requires_action")
        return send(res, 200, payPage(`<p class="err">This payment session is not valid.</p>`));
      intent.attempts += 1;
      if (b.otp !== intent.code) {
        if (intent.attempts >= 3) {
          intent.status = "failed";
          intent.failure = "Too many wrong codes. The payment was cancelled.";
          return send(res, 200, challengeDone(intent, b.origin));
        }
        return send(res, 200, challengePage(b, "That code is wrong. Try again."));
      }
      if (intent.declines) {
        intent.status = "failed";
        intent.failure = "Your card was declined by your bank.";
      } else {
        // The bank approves regardless of whether the hotel still holds the room.
        intent.status = "succeeded";
        intent.approvedAt = Date.now();
      }
      return send(res, 200, challengeDone(intent, b.origin));
    }

    if (req.method === "GET" && path === "/__phone") return send(res, 200, phonePage());

    send(res, 404, "Not found", "text/plain");
  } catch (e) {
    console.error(e);
    send(res, 500, "Something went wrong", "text/plain");
  }
});

hotel.listen(HOTEL_PORT, "127.0.0.1", () => console.log(`Casa Halcy   ${HOTEL}`));
pay.listen(PAY_PORT, "127.0.0.1", () => {
  console.log(`MockPay      ${PAY}`);
  console.log(`The guest's phone (bank codes)   ${PAY}/__phone`);
  console.log(`Bookings made so far             ${HOTEL}/__admin/bookings`);
  console.log(`Bank codes are also printed below. They are the traveller's; your agent must not read them.`);
});
