import {Router,Request,Response,NextFunction} from 'express';
import {createHash,timingSafeEqual} from 'node:crypto';
import {IsLoopbackAddress,IsProxiedRequest} from '../middleware/RequestOrigin';
import {BeginKeyRecovery,CompleteKeyRecovery,ProveRecoveryLink} from '../controllers/keyrotation';
import {AdminMutationRateLimit} from '../middleware/RateLimits';
export const keyRotationRouter=Router();
export function KeyRecoveryAuth(req:Request,res:Response,next:NextFunction){
 res.setHeader('Cache-Control','no-store');
 const expected=process.env.KEY_RECOVERY_SERVICE_SECRET;
 const presented=req.headers['x-key-recovery-service'];
 const digest=(s:string)=>createHash('sha256').update(s).digest();
 if(!expected || expected.length<32 || !IsLoopbackAddress(req.socket.remoteAddress) || IsProxiedRequest(req) || typeof presented!=='string' || !timingSafeEqual(digest(expected),digest(presented))){
  res.status(403).json({error:'recovery_unavailable'});return;
 }
 next();
}
keyRotationRouter.post('/internal/key-recovery/:action',AdminMutationRateLimit,KeyRecoveryAuth,(req,res)=>{
 try{
  const id=req.body?.discordId;
  switch(req.params.action){
   case 'link': res.json({verified:ProveRecoveryLink(id,req.body?.key)});return;
   case 'begin': res.json({challenge:BeginKeyRecovery(id)});return;
   case 'confirm': res.json({key:CompleteKeyRecovery(id,req.body?.challenge)});return;
   default: res.status(404).json({error:'recovery_unavailable'});
  }
 }catch{res.status(503).json({error:'recovery_unavailable'});}
});
