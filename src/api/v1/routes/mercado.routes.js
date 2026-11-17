import { Router } from 'express';
import controller from '../controllers/mercado.controller';
import { forRepository as empresas } from '../controllers/empresas.controller';
import { forRepository as contratos } from '../controllers/contratos.controller';
import { forRepository as noticias } from '../controllers/noticias.controller';
export default ({factory}={})=>{
  const router=Router(), c=controller(factory);
  router.get('/empresas',empresas(factory).list);
  router.get('/cotizaciones/:simbolo',c.quotes);
  router.get('/historicos/:simbolo',c.history);
  router.get('/fundamentales/:simbolo',c.fundamentals);
  router.get('/institucional/:simbolo',c.institutional);
  router.get('/opciones',contratos(factory).list);
  router.get('/opciones/:contratoId/snapshot',c.snapshot);
  router.get('/opciones/:id',contratos(factory).get);
  router.get('/noticias',noticias(factory).list);
  return router;
};
