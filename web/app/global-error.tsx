'use client';

/** Last resort when the root layout itself fails: plain HTML, no app styles. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1220', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px' }}>ergOS couldn’t load</p>
          <p style={{ opacity: 0.75, margin: '0 0 16px' }}>Please try again in a moment.{error.digest ? ` Reference ${error.digest}.` : ''}</p>
          <button type="button" onClick={() => reset()} style={{ padding: '10px 18px', borderRadius: 999, border: 0, background: '#3ddc84', color: '#06210f', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
