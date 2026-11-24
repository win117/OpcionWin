// Glosario: los mismos términos que explica el componente Termino, agrupados y con buscador.
import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Empty } from '../components/States';
import { GLOSARIO, GLOSARIO_GRUPOS } from '../utils/constants';

const plano = s => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export default function Glosario() {
  const [texto, setTexto] = useState('');
  const q = plano(texto.trim());
  const grupos = GLOSARIO_GRUPOS
    .map(nombre => ({ nombre, items: Object.entries(GLOSARIO).filter(([, t]) => t.grupo === nombre && (!q || plano(t.nombre + ' ' + t.texto).includes(q))) }))
    .filter(g => g.items.length);
  return (
    <>
      <PageHeader title="Glosario" subtitle="Los términos de opciones y del análisis, en palabras sencillas." />
      <div className="toolbar"><input type="search" className="toolbar__search" placeholder="Buscar un término" aria-label="Buscar un término" value={texto} onChange={e => setTexto(e.target.value)} /></div>
      {grupos.length === 0 && <Empty title="Ningún término coincide" accion={<button type="button" className="btn btn--sm" onClick={() => setTexto('')}>Ver todos</button>} />}
      {grupos.map(g => (
        <section key={g.nombre} className="card glosario__grupo">
          <h2>{g.nombre}</h2>
          <dl>{g.items.map(([id, t]) => <div key={id} id={id}><dt>{t.nombre}</dt><dd>{t.texto}</dd></div>)}</dl>
        </section>
      ))}
    </>
  );
}
