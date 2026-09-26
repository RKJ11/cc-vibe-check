// Remove secrets and personal identifiers before a view is written to disk
// (and therefore before it can be sent to the model provider).
const RULES = [
  // private keys
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[private-key]'],
  // provider API keys and tokens with well-known prefixes
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '[api-key]'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '[api-key]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, '[token]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[aws-key]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[api-key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]'],
  // key=value / "key": "value" secrets
  [/\b((?:api[_-]?key|secret|token|password|passwd|pwd|auth|bearer)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, '$1[redacted]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/g, '$1[redacted]'],
  // credentials inside URLs
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[credentials]@'],
  // email addresses
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  // private and internal URLs: IPs in private ranges, localhost, internal TLDs
  [/\bhttps?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?[^\s)"'>]*/gi, '[private-url]'],
  [/\bhttps?:\/\/[A-Za-z0-9.-]+\.(?:internal|local|corp|lan|intranet)(?::\d+)?[^\s)"'>]*/gi, '[private-url]'],
  // long hex / base64 blobs that look like secrets
  [/\b[A-Fa-f0-9]{40,}\b/g, '[hex]'],
];

export function redact(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
