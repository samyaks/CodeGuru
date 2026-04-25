/**
 * Dot-grid hero background with radial fade — used on Landing.
 * Renders two non-interactive absolute layers behind page content.
 */
export default function DotGridBg() {
  return (
    <>
      <div className="absolute inset-0 pointer-events-none bg-dot-grid" aria-hidden />
      <div className="absolute inset-0 pointer-events-none bg-dot-grid-fade" aria-hidden />
    </>
  );
}
