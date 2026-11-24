// Cabeceras de seguridad. style-src 'unsafe-inline': estilos en línea de React, lightweight-charts y swagger-ui.
// img/font data: icono de index.html y recursos de swagger-ui.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self' data:",
  "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');
export function cabecerasSeguridad(req, res, next) {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000'); // detrás de un proxy, req.secure depende de TRUST_PROXY
  next();
}
