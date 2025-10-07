import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import "./styles.css";

/* ---------- Fuzzy Matching Helpers ---------- */
function stripDiacritics(s){ return (s||"").normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function normalizeName(s){
  return stripDiacritics(String(s||"")
    .toLowerCase()
    .replace(/[\|\-–—_,.()\/]+/g,' ')
    .replace(/\s+/g,' ')
    .trim());
}
function tokensOf(s){
  return normalizeName(s).split(' ').filter(t => t.length >= 2);
}
function similarity(a,b){
  const A = new Set(tokensOf(a)), B = new Set(tokensOf(b));
  if (A.size===0 || B.size===0) return 0;
  let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
  const jaccard = inter / (A.size + B.size - inter);
  const na = normalizeName(a), nb = normalizeName(b);
  const prefixBonus = nb.startsWith(na) || na.startsWith(nb) ? 0.25 : 0;
  const subBonus   = na.includes(nb) || nb.includes(na) ? 0.15 : 0;
  return Math.min(1, jaccard + prefixBonus + subBonus);
}
/* -------------------------------------------- */

export default function App() {
  /* -------- STATE -------- */
  const [rows, setRows]       = useState([]);
  const [status, setStatus]   = useState("Φόρτωσε το Excel με τις αντιπροτάσεις.");
  const [query, setQuery]     = useState("");
  const [category, setCategory] = useState("Όλες");
  const [selected, setSelected] = useState(null);
  const [tab, setTab]         = useState("finder");

  // κάν’ το true μόνο αν θες να φαίνεται το upload στο UI
  const SHOW_UPLOAD = false;

  /* -------- HELPERS -------- */
  const norm = (s) => (s || "").toString().trim();
  const derive = (r) => ({
    name:     norm(r["Όνομα"]),
    price:    norm(r["Τιμή"]),
    variety:  norm(r["Ποικιλία"]),
    region:   norm(r["Περιοχή"]),
    abv:      norm(r["Αλκοόλ"]),
    dryness:  norm(r["Ξηρότητα"]),
    minerality:norm(r["Ορυκτότητα"]),
    acidity:  norm(r["Οξύτητα"]),
    body:     norm(r["Σώμα"]),
    notes:    norm(r["Σχόλια"]),
    alts: [
      norm(r["Αντιπρόταση 1"]),
      norm(r["Αντιπρόταση 2"]),
      norm(r["Αντιπρόταση 3"]),
    ].filter(Boolean),
  });

  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => norm(r["Κατηγορία"]) || "Άγνωστη"));
    return ["Όλες", ...Array.from(set)];
  }, [rows]);

  const names = useMemo(() => {
    const set = new Set(rows.map((r) => norm(r["Όνομα"])).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "el"));
  }, [rows]);

  /* -------- Ευρετήριο για fuzzy αναζήτηση ονομάτων -------- */
  const nameIndex = useMemo(() => {
    const idx = [];
    rows.forEach(r => {
      const name = (r["Όνομα"]||"").toString();
      if (name) idx.push({ key: normalizeName(name), raw: name, row: r });
    });
    return idx;
  }, [rows]);

  function findRowByNameLoose(name, threshold=0.45){
    const target = (name||"").toString();
    if (!target) return null;
    const nTarget = normalizeName(target);
    let best = { score: 0, hit: null };
    for (const it of nameIndex){
      if (it.key.startsWith(nTarget) || nTarget.startsWith(it.key)){
        const sc = similarity(it.key, nTarget) + 0.05;
        if (sc > best.score) best = { score: sc, hit: it.row };
        continue;
      }
      const sc = similarity(it.key, nTarget);
      if (sc > best.score) best = { score: sc, hit: it.row };
    }
    return best.score >= threshold ? best.hit : null;
  }

  /* -------- Αυτόματο φόρτωμα Excel από /public -------- */
  async function loadPreloaded() {
    try {
      const url = const url = '/Wines_2025.xlsx';

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Excel not found at " + url);

      const buf = await res.arrayBuffer();
      const wb  = XLSX.read(new Uint8Array(buf), { type: "array" });
      const sheetName = wb.SheetNames.includes("Alternatives")
        ? "Alternatives"
        : wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });

      if (json.length) {
        setRows(json);
        setStatus(`✅ Φορτώθηκαν ${json.length} κρασιά από το προεγκατεστημένο Excel.`);
      } else {
        setStatus("⚠️ Το Excel δεν έχει γραμμές.");
      }
    } catch (e) {
      console.error(e);
      setStatus("❌ Δεν βρέθηκε το προεγκατεστημένο Excel στο /public.");
    }
  }
  useEffect(() => { loadPreloaded(); }, []);

  /* -------- Manual upload (μένει για σένα, κρυφό στο UI) -------- */
  async function handleFile(file) {
    try {
      const buf = await file.arrayBuffer();
      const wb  = XLSX.read(new Uint8Array(buf), { type: "array" });
      const sheetName = wb.SheetNames.includes("Alternatives")
        ? "Alternatives"
        : wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
      setRows(json);
      setStatus(`✅ Φορτώθηκαν ${json.length} γραμμές από το ${file.name}.`);
    } catch (e) {
      console.error(e);
      setStatus("❌ Αποτυχία ανάγνωσης αρχείου.");
    }
  }

  /* -------- Search -------- */
  function onSearch() {
    const q   = norm(query).toLowerCase();
    const cat = norm(category);
    const filtered = rows.filter((r) => {
      const okCat  = cat === "Όλες" || norm(r["Κατηγορία"]) === cat;
      const okName = !q || norm(r["Όνομα"]).toLowerCase().includes(q);
      return okCat && okName;
    });
    if (filtered.length > 0) setSelected(filtered[0]);
    else setSelected(null);
  }

  /* -------- UI -------- */
  return (
    <div className="container">
      <header className="header">
        <h1 className="title">Wine Finder Pool Bar</h1>
        <p className="subtitle">Αναζήτηση κρασιών, χαρακτηριστικά & αντιπροτάσεις — wine-themed.</p>
        <div className="tabs">
          <button className={`btn ${tab === "finder" ? "primary" : ""}`} onClick={() => setTab("finder")}>Φόρμα Αναζήτησης</button>
          <button className={`btn ${tab === "about"  ? "primary" : ""}`} onClick={() => setTab("about")}>About / Οδηγίες</button>
        </div>
      </header>

      {tab === "finder" && (
        <>
          <div className="card">
            <div className="row">
              {SHOW_UPLOAD && (
                <div className="col">
                  <label>Αρχείο Excel</label>
                  <input className="input" type="file" accept=".xlsx,.xls,.csv"
                         onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}/>
                </div>
              )}

              <div className="col">
                <label>Κατηγορία</label>
                <select className="input" value={category} onChange={(e)=>setCategory(e.target.value)}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="col">
                <label>Όνομα Κρασιού</label>
                <div style={{display:'flex',gap:8}}>
                  <input className="input" list="wines" placeholder="π.χ. Vassaltis Santorini…"
                         value={query} onChange={e=>setQuery(e.target.value)} />
                  <datalist id="wines">{names.map(n => <option key={n} value={n} />)}</datalist>
                  <button className="btn primary" onClick={onSearch}>Αναζήτηση</button>
                </div>
              </div>
            </div>
            <div className="muted" style={{marginTop:8}}>{status}</div>
          </div>

          <Result rows={rows} selected={selected} derive={derive} norm={norm} findRowByNameLoose={findRowByNameLoose}/>
        </>
      )}

      {tab === "about" && (
        <div className="card">
          <h3 style={{marginTop:0}}>About / Οδηγίες</h3>
          <ul className="list">
            <li>Το Excel φορτώνεται αυτόματα από το <code>/public</code> (π.χ. <code>/Wine_List_from_PDF.xlsx</code>), sheet <b>Alternatives</b>.</li>
            <li>Στήλες: <b>Κατηγορία</b>, <b>Όνομα</b>, <b>Τιμή</b>, <b>Αντιπρόταση 1–3</b>, <b>Ποικιλία</b>, <b>Περιοχή</b>, <b>Αλκοόλ</b>, <b>Ξηρότητα</b>, <b>Ορυκτότητα</b>, <b>Οξύτητα</b>, <b>Σώμα</b>, <b>Σχόλια</b>.</li>
            <li>Για χαρακτηριστικά στις αντιπροτάσεις, πρέπει οι αντιπροτάσεις να υπάρχουν ως ξεχωριστές γραμμές με ίδιο <b>Όνομα</b>.</li>
          </ul>
        </div>
      )}

      <footer className="footer">• Wine Finder Pool Bar</footer>
    </div>
  );
}

/* ---------- Components ---------- */
function Result({ rows, selected, derive, norm, findRowByNameLoose }) {
  if (!selected) return null;

  const ch = derive(selected);
  const altNames = ch.alts;
  // Fuzzy αντιστοίχιση για κάθε αντιπρόταση
  const altRows = altNames.map((name) => findRowByNameLoose(name));

  return (
    <div className="card" style={{marginTop:16}}>
      <div className="title-line">
        <h3 style={{margin:'8px 0 0 0'}}>{ch.name}</h3>
        <div className="muted">{ch.price}</div>
      </div>

      <div className="row" style={{marginTop:12}}>
        {/* Βασικό κρασί */}
        <div className="card">
          <div className="muted" style={{fontWeight:600,color:'#9f1239'}}>Χαρακτηριστικά</div>
          <KV k="Ποικιλία" v={ch.variety} />
          <KV k="Περιοχή"  v={ch.region} />
          <KV k="Αλκοόλ"   v={ch.abv} />
          <KV k="Ξηρότητα" v={ch.dryness} />
          <KV k="Ορυκτότητα" v={ch.minerality} />
          <KV k="Οξύτητα"  v={ch.acidity} />
          <KV k="Σώμα"     v={ch.body} />
          {ch.notes && <div className="muted" style={{marginTop:8}}><b>Σχόλια:</b> {ch.notes}</div>}
        </div>

        {/* Κύρια αντιπρόταση (1η) */}
        <div className="card" style={{background:'#fff7f8'}}>
          <div className="muted" style={{fontWeight:600,color:'#9f1239'}}>Κύρια Αντιπρόταση</div>
          {altNames[0] ? (
            <>
              <div style={{fontWeight:600}}>{altNames[0]}</div>
              {altRows[0] && <div className="muted" style={{marginTop:4}}>{norm(altRows[0]["Τιμή"])}</div>}
            </>
          ) : (<div className="muted">—</div>)}
          {altNames.slice(1).length>0 && (
            <div style={{marginTop:8}}>
              {altNames.slice(1).map((a,i)=>(<span key={i} className="badge">{a}</span>))}
            </div>
          )}
        </div>
      </div>

      {/* Αναλυτικά οι αντιπροτάσεις */}
      {altNames.length>0 && (
        <>
          <div className="hr"></div>
          <div className="muted" style={{fontWeight:600,marginBottom:8}}>Αναλυτικά Αντιπροτάσεις</div>
          <div className="row">
            {altNames.map((name, idx) => {
              const r = altRows[idx];
              if (!r) {
                return (
                  <div key={idx} className="card">
                    <div style={{fontWeight:600}}>{name}</div>
                    <div className="muted" style={{marginTop:6}}>Δεν βρέθηκαν λεπτομέρειες στο Excel.</div>
                  </div>
                );
              }
              const d = derive(r);
              return (
                <div key={idx} className="card">
                  <div className="title-line">
                    <div style={{fontWeight:600}}>{name}</div>
                    <div className="muted">{d.price}</div>
                  </div>
                  <KV k="Ποικιλία"    v={d.variety} />
                  <KV k="Περιοχή"     v={d.region} />
                  <KV k="Ξηρότητα"    v={d.dryness} />
                  <KV k="Ορυκτότητα"  v={d.minerality} />
                  <KV k="Οξύτητα"     v={d.acidity} />
                  <KV k="Σώμα"        v={d.body} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function KV({ k, v }) {
  if (!v) return null;
  return (
    <div className="kv">
      <span className="muted">{k}</span>
      <b>{v}</b>
    </div>
  );
}
