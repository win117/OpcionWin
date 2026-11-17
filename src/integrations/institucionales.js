// Lista por defecto de grandes filers 13F (CIK verificados en EDGAR submissions, 2026-11-16).
// Notas:
// - BlackRock presenta 13F-HR como "BlackRock, Inc." (CIK 2012383) desde 2024; el CIK
//   histórico 1364742 ahora es "BlackRock Finance, Inc." y no tiene 13F-HR recientes.
// - Vanguard Group (CIK 102909) presenta 13F-NT desde 2026; las tenencias se reportan en
//   Vanguard Capital Management LLC y Vanguard Portfolio Management LLC.
export const FILERS_13F = Object.freeze([
  { cik: '0002100119', nombre: 'Vanguard Capital Management LLC' },
  { cik: '0002100121', nombre: 'Vanguard Portfolio Management LLC' },
  { cik: '0002012383', nombre: 'BlackRock, Inc.' },
  { cik: '0000093751', nombre: 'State Street Corp' },
  { cik: '0000315066', nombre: 'FMR LLC' },
  { cik: '0001067983', nombre: 'Berkshire Hathaway Inc' },
  { cik: '0001214717', nombre: 'Geode Capital Management, LLC' },
  { cik: '0000895421', nombre: 'Morgan Stanley' },
  { cik: '0000019617', nombre: 'JPMorgan Chase & Co' },
].map(Object.freeze));
