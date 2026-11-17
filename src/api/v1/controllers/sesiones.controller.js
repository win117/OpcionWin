import { handle, respond } from './crud.controller';
export default service => ({
  login: handle(async(req,res) => { res.set('Cache-Control','no-store'); respond(res,await service.login(req.body)); }),
  current: handle(async(req,res) => respond(res,await service.current(req.context))),
  logout: handle(async(req,res) => { await service.logout(req.context); res.status(204).end(); }),
});
