/** Marca: una W cuyo último trazo sube. */
export default function Logo({ size = 28 }) {
  return (
    <span className="brand__logo" aria-hidden="true">
      <svg viewBox="0 0 32 32" width={size} height={size}><rect width="32" height="32" rx="8" fill="currentColor" /><path d="M5.5 11l4.8 12L16 13l4.6 10L26.5 7.5" stroke="var(--surface)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}
