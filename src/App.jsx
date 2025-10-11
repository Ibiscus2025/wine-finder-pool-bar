import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import "./styles.css";

/* ----------------- helpers (Greek-friendly) ----------------- */
function stripDiacritics(s = "") {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'’]/g, "'")
    .trim();
}
function norm(s = "") {
  return stripDiacritics(String(s)).toLowerCase();
}
function tokensOf(s = "") {
  return norm(s)
    .split(/[\s,;./()\-]+/g)
    .filter(Boolean);
}
function similarity(a = "", b = "") {
  const A = new Set(tokensOf(a));
  const B = new Set(tokensOf(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const jac = inter / (A.size + B.size - inter);
  const pref =
    a.toLowerCase().startsWith(b.toLowerCase()) ||
    b.toLowerCase().startsWith(a.toLowerCase())
      ? 0.25
      : 0;
  return jac + pref;
}

/* ----------------- κύριο component ----------------- */
export default function App() {
  /* STATE */
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Φόρτωσε το Excel με τις αντιπροτάσεις.");
  const [category, setCategory] = useState("Όλες");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);

  /* ------------- εμφανίζουμε φόρμα upload ------------- */
  const SHOW_UPLOAD = true;

  /* ------------------- columns mapping ------------------- */
  // Προσπαθούμε να “βρούμε” σωστές στήλες ακόμα κι αν γραφτούν λίγο διαφορετικά.
  const col = (name) =>
    [
      ["Όνομα", "name", "wine", "κρασί"],
      ["Κατηγορία", "category", "τύπος", "type"],
      ["Τιμή", "price", "τιμη", "€"],
      ["Ποικιλία", "variety"],
      ["Περιοχή", "region", "appellation"],
      ["Αλκοόλ", "abv", "alcohol"],
      ["Ξηρότητα", "dryness", "ξηροτητα"],
      ["Ορυκτότητα", "minerality", "ορυκτοτητα"],
      ["Οξύτητα", "acidity", "οξυτητα"],
      ["Σώμα", "body", "σωμα"],
      ["Σχόλια", "notes", "comments", "σημειώσεις", "notes/comments"],
      ["Αντιπρόταση 1", "alt1", "alternative 1"],
      ["Αντιπρόταση 2", "alt2", "alternative 2"],
      ["Αντιπρόταση 3", "alt3", "alternative 3"],
    ].find((arr) => norm(arr[0]) === norm(name)) || [name];

  // Γενική συνάρτηση για ασφαλή ανάγνωση τιμών με διάφορα ονόματα κελιών
  const get = (r, want) => {
    const wanted = norm(want);
    // 1) άμεση αντιστοίχιση
    for (const k of Object.keys(r)) {
      if (norm(k) === wanted) return r[k];
    }
    // 2) “παρατσούκλια”
    const map = {
      [norm("Όνομα")]: ["name", "κρασί", "wine"],
      [norm("Κατηγορία")]: ["category", "τύπος", "type"],
      [norm("Τιμή")]: ["price", "τιμη", "€"],
      [norm("Ποικιλία")]: ["variety"],
      [norm("Περιοχή")]: ["region", "appellation"],
      [norm("Αλκοόλ")]: ["abv", "alcohol"],
      [norm("Ξηρότητα")]: ["dryness", "ξηροτητα"],
      [norm("Ορυκτότητα")]: ["minerality", "ορυκτοτητα"],
      [norm("Οξύτητα")]: ["acidity", "οξυτητα"],
      [norm("Σώμα")]: ["body", "σωμα"],
      [norm("Σχόλια")]: ["notes", "comments", "σημειωσεις", "σημειώσεις"],
      [norm("Αντιπρόταση 1")]: ["alt1", "alternative 1", "αντιπροταση 1"],
      [norm("Αντιπρόταση 2")]: ["alt2", "alternative 2", "αντιπροταση 2"],
      [norm("Αντιπρόταση 3")]: ["alt3", "alternative 3", "αντιπροταση 3"],
    }[wanted];
    if (map) {
      for (const alias of map) {
        const hit = Object.keys(r).find((k) => norm(k) === norm(alias));
        if (hit) return r[hit];
      }
    }
    return r[want] ?? "";
  };

  /* ------------------- categories & index ------------------- */
  const categories = useMemo(() => {
    const set = new Set(rows.map((r) => get(r, "Κατηγορία")).filter(Boolean));
    return ["Όλες", ...Array.from(set)];
  }, [rows]);

  const nameIndex = useMemo(() => {
    const idx = [];
    rows.forEach((r, i) => {
      const name = get(r, "Όνομα");
      if (name) idx.push({ key: norm(name), raw: name, row: r, i });
    });
    return idx;
  }, [rows]);

  /* --------------------- file handling --------------------- */
  async function handleFile(file) {
    try {
      if (!file) {
        setStatus("⚠️ Δεν επιλέχθηκε αρχείο.");
        return;
      }

      let wb;
      if (file.name.toLowerCase().endsWith(".csv")) {
        // CSV
        const csvText = await file.text();
        wb = XLSX.read(csvText, { type: "string" });
      } else {
        // XLSX / XLS
        const buf = await file.arrayBuffer();
        wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      }

      const sheetName = wb.SheetNames.includes("Alternatives")
        ? "Alternatives"
        : wb.SheetNames[0];

      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        defval: "",
      });

      if (json.length) {
        setRows(json);
        setStatus(`✅ Φορτώθηκαν ${json.length} γραμμές από «${file.name}».`);
      } else {
        setRows([]);
        setStatus("⚠️ Το αρχείο δεν είχε γραμμές.");
      }
    } catch (e) {
      console.error(e);
      setStatus("❌ Αποτυχία ανάγνωσης αρχείου.");
    }
  }

  /* ------------------------- search ------------------------- */
  function findBestByName(name, threshold = 0.45) {
    const target = norm(name);
    let best = { score: 0, hit: null };
    for (const it of nameIndex) {
      const sc = similarity(it.key, target) + (it.key.startsWith(target) ? 0.05 : 0);
      if (sc > best.score) best = { score: sc, hit: it.row };
    }
    return best.score >= threshold ? best.hit : null;
  }

  function onSearch() {
    // Φιλτράρισμα κατηγορίας
    const base = rows.filter((r) =>
      category === "Όλες" ? true : norm(get(r, "Κατηγορία")) === norm(category)
    );

    // Αναζήτηση ονόματος
    let hit = null;
    if (query && query.trim().length > 0) {
      hit = findBestByName(query);
      if (!hit) {
        // δοκίμασε μέσα στο subset της κατηγορίας
        const idx = base.map((r) => ({
          key: norm(get(r, "Όνομα")),
          row: r,
        }));
        const t = norm(query);
        let best = { score: 0, row: null };
        for (const it of idx) {
          const sc = similarity(it.key, t) + (it.key.startsWith(t) ? 0.05 : 0);
          if (sc > best.score) best = { score: sc, row: it.row };
        }
        if (best.score >= 0.45) hit = best.row;
      }
    } else {
      // χωρίς όνομα → πάρε το πρώτο της κατηγορίας (αν υπάρχει)
      hit = base[0] || null;
    }

    setSelected(hit || null);
    if (!hit) setStatus("⚠️ Δεν βρέθηκε αποτέλεσμα. Δοκίμασε άλλο όνομα.");
  }

  /* ------------------------- UI ------------------------- */
  const ResultCard = () => {
    if (!selected) return null;

    const name = get(selected, "Όνομα");
    const cat = get(selected, "Κατηγορία");
    const price = get(selected, "Τιμή");

    const characteristics = [
      ["Ποικιλία", get(selected, "Ποικιλία")],
      ["Περιοχή", get(selected, "Περιοχή")],
      ["Αλκοόλ", get(selected, "Αλκοόλ")],
      ["Ξηρότητα", get(selected, "Ξηρότητα")],
      ["Οξύτητα", get(selected, "Οξύτητα")],
      ["Ορυκτότητα", get(selected, "Ορυκτότητα")],
      ["Σώμα", get(selected, "Σώμα")],
      ["Σχόλια", get(selected, "Σχόλια")],
    ].filter(([, v]) => String(v || "").trim().length > 0);

    const alts = [get(selected, "Αντιπρόταση 1"), get(selected, "Αντιπρόταση 2"), get(selected, "Αντιπρόταση 3")]
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    return (
      <div className="card">
        <div className="card-header">
          <div>
            <b>{name || "—"}</b>
            {" | "}
            <span>{cat || "—"}</span>
          </div>
          <div className="price">{price ? `€${price}` : ""}</div>
        </div>

        <div className="grid">
          <div className="panel">
            <div className="panel-title">Χαρακτηριστικά</div>
            {characteristics.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              <ul className="details">
                {characteristics.map(([k, v]) => (
                  <li key={k}>
                    <span className="key">{k}:</span> <span className="val">{String(v)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel alt">
            <div className="panel-title">Κύρια Αντιπρόταση</div>
            {alts.length === 0 ? (
              <div className="muted">—</div>
            ) : (
              <div className="alts">
                {alts.map((a, i) => (
                  <div key={i} className="alt-chip">
                    {a}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="container">
      <header className="header">
        <h1 className="title">Wine Finder Pool Bar</h1>
        <p className="subtitle">Αναζήτηση κρασιών, χαρακτηριστικά & αντιπροτάσεις — wine-themed.</p>
      </header>

      <div className="card">
        {SHOW_UPLOAD && (
          <div className="field">
            <label>Αρχείο Excel/CSV</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <div className="hint">Φόρτωσε το Excel με τις αντιπροτάσεις.</div>
          </div>
        )}

        <div className="form-grid">
          <div className="field">
            <label>Κατηγορία</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Όνομα Κρασιού</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="π.χ. Vassaltis Santorini…"
            />
          </div>

          <div className="field actions">
            <button className="btn primary" onClick={onSearch}>
              Αναζήτηση
            </button>
          </div>
        </div>

        <div className="status">{status}</div>
      </div>

      <ResultCard />

      <footer className="footer">• Wine Finder Pool Bar</footer>
    </div>
  );
}
