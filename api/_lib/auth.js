// api/_lib/auth.js
const EXPECTED = process.env.BEARER_KEY || "gpt-stopover-secure-3z8hf92nsm39";

export function checkAuth(req, res) {
  const auth = req.headers.authorization || "";
  if (!auth.includes(EXPECTED)) {
    res.status(403).json({ error: "Forbidden: invalid or missing bearer" });
    return false; // important: stop execution
  }
  return true;
}
