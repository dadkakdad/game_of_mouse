import { createSimulation } from './simulation.mjs'

function runOnce(tuning, seed){
  const sim = createSimulation({ seed, tuning })
  const s = sim.getState()
  const maxTime = 120
  const dt = 0.016
  while (s.elapsed < maxTime && s.status === 'playing'){
    sim.step(dt)
    s.elapsed += dt
  }
  return s.elapsed
}

function evaluate(tuning, seeds){
  let sum = 0
  const times = []
  for (const seed of seeds){
    const t = runOnce(tuning, seed)
    sum += t
    times.push(t)
  }
  const avg = sum / seeds.length
  times.sort((a,b)=>a-b)
  const p90 = times[Math.floor(0.9*(times.length-1))]
  const min = times[0]
  const max = times[times.length-1]
  return { avg, p90, min, max }
}

function rnd(arr){ return arr[Math.floor(Math.random()*arr.length)] }

async function main(){
  const epsList = [0.06, 0.08, 0.10, 0.12, 0.15, 0.18, 0.22]
  const minDtList = [0.08, 0.10, 0.12, 0.15, 0.18, 0.22]
  const cdList = [0.05, 0.08, 0.10, 0.12, 0.15, 0.20]
  const chainList = [2,3,4,5,6]
  const noCloserList = [16, 24, 30, 36, 48, 60]
  const depthList = [4,6,8]
  const cordonRList = [80, 100, 120, 140, 160]
  const cordonKList = [2,3,4,5]

  const numTrials = parseInt(process.env.TRIALS||'400',10)
  const seeds = Array.from({length: parseInt(process.env.SEEDS||'10',10)}, (_,i)=>20250813+i)

  const tested = new Set()
  let top = [] // keep top 3 by avg

  for (let i=0;i<numTrials;i++){
    const tuning = {
      eps: rnd(epsList),
      minDt: rnd(minDtList),
      cooldown: rnd(cdList),
      maxChain: rnd(chainList),
      noCloserPx: rnd(noCloserList),
      planDepth: rnd(depthList),
      cordonR: rnd(cordonRList),
      cordonK: rnd(cordonKList),
    }
    const key = JSON.stringify(tuning)
    if (tested.has(key)){ i--; continue }
    tested.add(key)

    const res = evaluate(tuning, seeds)
    const entry = { tuning, ...res }
    top.push(entry)
    top.sort((a,b)=>b.avg - a.avg)
    if (top.length>3) top.length=3

    const status = `${(i+1)}/${numTrials} avg=${res.avg.toFixed(2)} p90=${res.p90.toFixed(2)} min=${res.min.toFixed(2)} max=${res.max.toFixed(2)} tun=${key}`
    console.log(status)
  }

  console.log('\nTop 3 configs by avg:')
  top.forEach((e,idx)=>{
    console.log(`#${idx+1}`, e.tuning, `avg=${e.avg.toFixed(2)} p90=${e.p90.toFixed(2)} [${e.min.toFixed(2)}, ${e.max.toFixed(2)}]`)
  })
}

main().catch(err=>{console.error(err); process.exit(1)}) 