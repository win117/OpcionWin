import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <section className="card">
      <h1>Página no encontrada</h1>
      <p className="muted">La ruta solicitada no existe en esta aplicación.</p>
      <Link className="btn btn--primary" to="/">Ir al inicio</Link>
    </section>
  );
}
