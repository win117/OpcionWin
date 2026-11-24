import { Navigate, Route, Routes, generatePath, useLocation, useParams } from 'react-router-dom';
import './utils/tema';
import { useAuth } from './context/AuthContext';
import { BrokerProvider } from './context/BrokerContext';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Inicio from './pages/Inicio';
import Analisis from './pages/Analisis';
import Posiciones from './pages/Posiciones';
import Ordenes from './pages/Ordenes';
import Configuracion from './pages/Configuracion';
import Empresas from './pages/Empresas';
import Estrategias from './pages/Estrategias';
import Mercado from './pages/Mercado';
import EvaluarCores from './pages/EvaluarCores';
import Seleccion from './pages/Seleccion';
import Perfiles, { PerfilDetalle } from './pages/Perfiles';
import Configuraciones, { ConfiguracionDetalle } from './pages/Configuraciones';
import Conexiones from './pages/broker/Conexiones';
import Sincronizaciones from './pages/Sincronizaciones';
import Auditoria from './pages/Auditoria';
import NotFound from './pages/NotFound';

function RequireAuth({ children }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session?.token) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

/** Redirección que conserva parámetros de ruta (:simbolo, :id) y la query string; sirve para enlaces antiguos. */
function Redirigir({ to }) {
  const params = useParams();
  const { search } = useLocation();
  return <Navigate to={generatePath(to, params) + search} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><BrokerProvider><Layout /></BrokerProvider></RequireAuth>}>
        <Route index element={<Inicio />} />
        <Route path="analisis" element={<Analisis />} />
        <Route path="analisis/:simbolo" element={<Analisis />} />
        <Route path="posiciones" element={<Posiciones />} />
        <Route path="ordenes" element={<Ordenes />} />
        <Route path="configuracion" element={<Configuracion />}>
          <Route index element={<Navigate to="perfiles" replace />} />
          <Route path="perfiles" element={<Perfiles />} />
          <Route path="perfiles/:id" element={<PerfilDetalle />} />
          <Route path="estrategias" element={<Estrategias />} />
          <Route path="configuraciones" element={<Configuraciones />} />
          <Route path="configuraciones/:id" element={<ConfiguracionDetalle />} />
          <Route path="empresas" element={<Empresas />} />
          <Route path="conexiones" element={<Conexiones />} />
          <Route path="sincronizaciones" element={<Sincronizaciones />} />
          <Route path="auditoria" element={<Auditoria />} />
          <Route path="cores" element={<EvaluarCores />} />
          <Route path="seleccion" element={<Seleccion />} />
          <Route path="mercado" element={<Mercado />} />
          <Route path="mercado/:simbolo" element={<Mercado />} />
        </Route>

        {/* Rutas antiguas: redirigen para no romper enlaces */}
        <Route path="panel" element={<Navigate to="/" replace />} />
        <Route path="analizar" element={<Redirigir to="/analisis" />} />
        <Route path="analizar/:simbolo" element={<Redirigir to="/analisis/:simbolo" />} />
        <Route path="mercado" element={<Navigate to="/analisis" replace />} />
        <Route path="mercado/:simbolo" element={<Redirigir to="/analisis/:simbolo" />} />
        <Route path="broker" element={<Navigate to="/posiciones" replace />} />
        <Route path="empresas" element={<Navigate to="/configuracion/empresas" replace />} />
        <Route path="estrategias" element={<Navigate to="/configuracion/estrategias" replace />} />
        <Route path="seleccion" element={<Navigate to="/configuracion/seleccion" replace />} />
        <Route path="perfiles" element={<Navigate to="/configuracion/perfiles" replace />} />
        <Route path="perfiles/:id" element={<Redirigir to="/configuracion/perfiles/:id" />} />
        <Route path="configuraciones" element={<Navigate to="/configuracion/configuraciones" replace />} />
        <Route path="configuraciones/:id" element={<Redirigir to="/configuracion/configuraciones/:id" />} />
        <Route path="sincronizaciones" element={<Navigate to="/configuracion/sincronizaciones" replace />} />
        <Route path="auditoria" element={<Navigate to="/configuracion/auditoria" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
