import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import Panel from './pages/Panel';
import Empresas from './pages/Empresas';
import Estrategias from './pages/Estrategias';
import Mercado from './pages/Mercado';
import Analisis from './pages/Analisis';
import Seleccion from './pages/Seleccion';
import Perfiles, { PerfilDetalle } from './pages/Perfiles';
import Configuraciones, { ConfiguracionDetalle } from './pages/Configuraciones';
import Broker from './pages/Broker';
import Sincronizaciones from './pages/Sincronizaciones';
import Auditoria from './pages/Auditoria';
import NotFound from './pages/NotFound';

function RequireAuth({ children }) {
  const { session } = useAuth();
  const location = useLocation();
  if (!session?.token) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Panel />} />
        <Route path="empresas" element={<Empresas />} />
        <Route path="estrategias" element={<Estrategias />} />
        <Route path="mercado" element={<Mercado />} />
        <Route path="mercado/:simbolo" element={<Mercado />} />
        <Route path="analisis" element={<Analisis />} />
        <Route path="seleccion" element={<Seleccion />} />
        <Route path="perfiles" element={<Perfiles />} />
        <Route path="perfiles/:id" element={<PerfilDetalle />} />
        <Route path="configuraciones" element={<Configuraciones />} />
        <Route path="configuraciones/:id" element={<ConfiguracionDetalle />} />
        <Route path="broker" element={<Broker />} />
        <Route path="sincronizaciones" element={<Sincronizaciones />} />
        <Route path="auditoria" element={<Auditoria />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
