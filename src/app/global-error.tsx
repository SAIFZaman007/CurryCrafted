"use client";

/** Last-resort boundary: renders its own <html> because the root layout itself failed. Styles are inline on purpose. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0f2418", color: "#f7f3e9", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "2rem" }}>
        <div>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500, fontSize: "2.2rem", margin: 0 }}>Something went wrong.</h1>
          <p style={{ opacity: 0.8, maxWidth: "26rem", margin: "1rem auto 2rem", lineHeight: 1.6 }}>We hit an unexpected problem. Your basket is saved in this browser, so nothing has been lost.</p>
          <button type="button" onClick={reset} style={{ background: "#e8c46a", color: "#0f2418", border: 0, borderRadius: 999, padding: "0.9rem 1.8rem", fontWeight: 700, fontSize: "1rem", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
