export function createSimulation(config) {
    const state = {
        width: 920,
        height: 560,
        nChairs: (config && config.nChairs) || 12,
        chairRadius: (config && config.chairRadius) || 16,
        mouseSpeed: (config && config.mouseSpeed) || 190,
        teamSpeed: (config && config.teamSpeed) || 220,
        seed: (config && config.seed) || 20250813,
        running: true,

        chairs: [],
        players: [],
        status: 'playing',
        elapsed: 0,
        lastTs: null,
        dispatchCd: 0,
        cordonActive: false,
        cordonTargets: [],
    };

    const tuning = (config && config.tuning) || {}
    // Planning parameters (configurable)
    const EPS = tuning.eps ?? 0.12;            // relative margin per step
    const MIN_DT = tuning.minDt ?? 0.12;       // absolute time margin per step (s)
    const COOLDOWN = tuning.cooldown ?? 0.15;  // global cooldown
    const PLAN_DEPTH = tuning.planDepth ?? 6;  // steps to simulate ahead
    const NO_CLOSER_PX = tuning.noCloserPx ?? 24; // forbid creating new vacancy closer to mouse by more than this
    const DEBUG = !!tuning.debug;
    const MAX_CHAIN = tuning.maxChain ?? 3;    // how many defenders to chain per frame
    const CORDON_R = tuning.cordonR ?? 120;    // distance to trigger cordon mode
    const CORDON_K = tuning.cordonK ?? 3;      // chain length in cordon mode
    const CORDON_HOLD = tuning.cordonHold ?? 1.2; // seconds to keep reservations after trigger

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
    const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
    const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
    const mul = (v, k) => ({ x: v.x * k, y: v.y * k })
    const norm = (v) => { const d = Math.hypot(v.x, v.y) || 1; return { x: v.x / d, y: v.y / d } }
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296}}

    function makeChairsDense(n,w,h,seed,chairRadius){
        const rng=mulberry32(seed)
        const safety = 12
        const margin=chairRadius + safety
        let minD=chairRadius*2.35
        const chairs=[]
        for(let i=0;i<n;i++){
            let placed=false,attempts=0
            while(!placed&&attempts<5000){
                attempts++
                const x = clamp(margin + rng()*(w-2*margin), margin, w-margin)
                const y = clamp(margin + rng()*(h-2*margin), margin, h-margin)
                const p = {x,y}
                if(chairs.every(c=>dist(c.pos,p)>=minD)){
                    chairs.push({id:i,pos:p}); placed=true
                }
                if(!placed && attempts%1000===0) minD*=0.96
            }
            if(!placed){
                // ring fallback strictly inside margins
                const r = Math.max(10, Math.min(w,h)/2 - margin)
                const cx=w/2, cy=h/2
                const ang=(i/Math.max(1,n))*Math.PI*2 + rng()*0.2
                const px = clamp(cx + r*Math.cos(ang), margin, w-margin)
                const py = clamp(cy + r*Math.sin(ang), margin, h-margin)
                chairs.push({id:i,pos:{x:px,y:py}})
            }
        }
        // final clamp (safety)
        for(const c of chairs){
            c.pos.x = clamp(c.pos.x, margin, w-margin)
            c.pos.y = clamp(c.pos.y, margin, h-margin)
        }
        return chairs
    }

    function reset(){
        state.chairs=makeChairsDense(state.nChairs,state.width,state.height,state.seed,state.chairRadius)
        const rng=mulberry32(state.seed+42)
        const emptyChairId=Math.floor(rng()*state.nChairs)
        state.elapsed=0;state.status='playing';state.lastTs=null;state.dispatchCd=0
        state.cordonActive = false
        state.cordonTargets = []
        state.cordonUntil = null // Clear hold
        const team=[];let tIdx=0
        for(let i=0;i<state.nChairs;i++){if(i===emptyChairId)continue;team.push({id:`p-${tIdx++}`,pos:{...state.chairs[i].pos},targetChairId:null,sittingOn:i})}
        const emptyPos=state.chairs[emptyChairId].pos
        const ang=rng()*Math.PI*2
        const far=Math.max(state.width,state.height)*0.9+260
        const safety = state.chairRadius + 12
        const startInside = {
            x: clamp(rng()*state.width, safety, state.width - safety),
            y: clamp(rng()*state.height, safety, state.height - safety)
        }
        const mouse={id:'mouse',pos:startInside,targetChairId:null,sittingOn:null}
        state.players=[mouse,...team]
    }

    function step(dt){
        if(state.status!=='playing')return
        if(state.dispatchCd>0)state.dispatchCd=Math.max(0,state.dispatchCd-dt)

        const occupied=new Set(state.players.filter(p=>p.sittingOn!=null).map(p=>p.sittingOn))
        const vacancies=state.chairs.filter(c=>!occupied.has(c.id))
        if(vacancies.length===0){state.status='team_won';return}

        const mouse=state.players.find(p=>p.id==='mouse')
        if(mouse.sittingOn!=null)return

        // choose vacancy with minimal mouse time now
        let target=null;let tM=Infinity
        for(const c of vacancies){const t=dist(mouse.pos,c.pos)/state.mouseSpeed; if(t<tM){tM=t; target=c}}
        mouse.targetChairId = target.id

        const team=state.players.filter(p=>p.id!=='mouse')
        const movers=team.filter(p=>p.targetChairId!=null)

        // Always-on chain dispatch to prevent idle periods
        if(movers.length===0){
            let nextTarget = target.id
            const chosenIds = new Set()
            const near = dist(mouse.pos, state.chairs[nextTarget].pos) <= CORDON_R
            const chainLen = near ? CORDON_K : MAX_CHAIN
            const noCloserFactor = near ? 2 : 1

            // reserved-seat cordon activation or hold
            const holdActive = state.cordonUntil && state.elapsed < state.cordonUntil
            const cordonActiveNow = near || holdActive
            if (cordonActiveNow){
                // helper to compute angularly distributed reserved seats around target
                const computeReserved = (vacId)=>{
                    const vacPos = state.chairs[vacId].pos
                    const entries = state.chairs
                        .filter(c=>c.id!==vacId)
                        .map(c=>({id:c.id, d: dist(c.pos,vacPos), a: Math.atan2(c.pos.y-vacPos.y, c.pos.x-vacPos.x)}))
                    entries.sort((a,b)=>a.d-b.d)
                    const m = Math.min(entries.length, 12)
                    const nearBy = entries.slice(0,m).sort((a,b)=>a.a-b.a)
                    const guards = Math.max(0, CORDON_K-1)
                    const picks = []
                    if (guards>0){
                        const stride = Math.max(1, Math.floor(nearBy.length/guards))
                        for(let i=0;i<guards;i++){
                            const idx = Math.min(i*stride, nearBy.length-1)
                            picks.push(nearBy[idx].id)
                        }
                    }
                    const unique = Array.from(new Set([vacId, ...picks]))
                    return unique.slice(0, CORDON_K)
                }

                // refresh reservations if new target or not yet active
                if (!state.cordonActive || !state.cordonTargets || !state.cordonTargets.includes(nextTarget)){
                    state.cordonTargets = computeReserved(nextTarget)
                    state.cordonActive = true
                }
                // extend hold while Mouse is near
                if (near){
                    state.cordonUntil = state.elapsed + CORDON_HOLD
                }
                // set reserved set for this frame
                const reservedSet = new Set(state.cordonTargets)

                // assign seated defenders to each reserved seat (including vacancy) if not already headed there
                for (const tgtId of state.cordonTargets){
                    const alreadyCovered = team.some(p=>p.sittingOn===tgtId || p.targetChairId===tgtId)
                    if (alreadyCovered) continue
                    let best=null,bestT=Infinity
                    for(const p of team){
                        if(p.sittingOn==null) continue
                        if(chosenIds.has(p.id)) continue
                        if(reservedSet.has(p.sittingOn)) continue // don't break reserved seats
                        const t = dist(p.pos, state.chairs[tgtId].pos)/state.teamSpeed
                        if(t<bestT){bestT=t; best=p}
                    }
                    if(!best) continue
                    const tMcur = dist(mouse.pos, state.chairs[tgtId].pos)/state.mouseSpeed
                    if(!(bestT < tMcur*(1-EPS) && (tMcur-bestT)>=MIN_DT)) continue
                    if (tgtId===nextTarget){
                        const prevSeat = best.sittingOn
                        const dCur = dist(mouse.pos, state.chairs[nextTarget].pos)
                        const dNew = dist(mouse.pos, state.chairs[prevSeat].pos)
                        if (dNew + NO_CLOSER_PX*noCloserFactor < dCur) continue
                    }
                    best.targetChairId = tgtId
                    best.sittingOn = null
                    chosenIds.add(best.id)
                }

                // if mouse moved far and hold expired, clear cordon
                if (!near && !(state.elapsed < state.cordonUntil)){
                    state.cordonActive = false
                    state.cordonTargets = []
                }
            }
            // normal guarded chain when not covering via cordon this frame
            if (chosenIds.size===0){
                const reservedSet = new Set(state.cordonTargets||[])
                for(let k=0;k<chainLen;k++){
                    // pick fastest seated to nextTarget
                    let best=null, bestT=Infinity
                    for(const p of team){
                        if(p.sittingOn==null) continue
                        if(chosenIds.has(p.id)) continue
                        if(reservedSet.has(p.sittingOn)) continue // do not break reserved seats
                        const t = dist(p.pos, state.chairs[nextTarget].pos) / state.teamSpeed
                        if(t<bestT){bestT=t; best=p}
                    }
                    if(!best) break
                    // Constraints per hop
                    const tMcur = dist(mouse.pos, state.chairs[nextTarget].pos)/state.mouseSpeed
                    if(k===0 || k===1 || near){
                        // require margin for first two hops
                        if(!(bestT < tMcur*(1-EPS) && (tMcur-bestT)>=MIN_DT)){
                            if(DEBUG)console.debug('skip hop',k,'insufficient margin')
                            break
                        }
                    }
                    const prevSeat = best.sittingOn
                    // no-closer guard: new vacancy should not be much closer to mouse than current target
                    const dCur = dist(mouse.pos, state.chairs[nextTarget].pos)
                    const dNew = dist(mouse.pos, state.chairs[prevSeat].pos)
                    if((k<=1 || near) && dNew + NO_CLOSER_PX*noCloserFactor < dCur){
                        if(DEBUG)console.debug('skip hop',k,'new vacancy closer')
                        break
                    }
                    best.targetChairId = nextTarget
                    best.sittingOn = null
                    chosenIds.add(best.id)
                    nextTarget = prevSeat // chain to previous seat
                }
            }
        }

        // move
        const lookup=new Map(state.chairs.map(c=>[c.id,c]))
        for(const p of state.players){
            if(p.targetChairId==null)continue
            const pos=lookup.get(p.targetChairId).pos
            const speed=p.id==='mouse'?state.mouseSpeed:state.teamSpeed
            const stepLen=Math.min(speed*dt,dist(p.pos,pos))
            p.pos=add(p.pos,mul(norm(sub(pos,p.pos)),stepLen))
        }

        // arrivals single-occupancy
        const reach=state.chairRadius*0.5
        const arrivals=[]
        for(const p of state.players){if(p.targetChairId==null)continue;const pos=lookup.get(p.targetChairId).pos;const d=dist(p.pos,pos);if(d<=reach)arrivals.push({p,d,isMouse:p.id==='mouse'})}
        arrivals.sort((a,b)=>a.d-b.d||(a.isMouse===b.isMouse?0:(a.isMouse?1:-1)))
        const dyn=new Set(state.players.filter(p=>p.sittingOn!=null).map(p=>p.sittingOn))
        for(const a of arrivals){const p=a.p;const cid=p.targetChairId;if(cid==null)continue;if(dyn.has(cid)){p.targetChairId=null;continue}if(p.id==='mouse'){p.sittingOn=cid;state.status='mouse_won';dyn.add(cid);break}else{p.sittingOn=cid;p.targetChairId=null;dyn.add(cid)}}
    }

    reset()
    return { step, getState:()=>state }
} 