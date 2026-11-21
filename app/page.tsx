"use client";

import { useState } from "react";

function parse(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function Home() {
  const [a, setA] = useState("2");
  const [b, setB] = useState("2");

  const x = parse(a);
  const y = parse(b);
  const valid = x !== null && y !== null;

  return (
    <main>
      <h1>Add two numbers</h1>
      <div className="row">
        <input aria-label="First number" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} />
        <span>+</span>
        <input aria-label="Second number" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} />
      </div>
      {valid ? (
        <p className="result" aria-live="polite">= {x + y}</p>
      ) : (
        <p className="error">Enter two valid numbers.</p>
      )}
    </main>
  );
}
