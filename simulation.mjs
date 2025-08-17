export function createSimulation(config) {
  const state = {
    width: 920,
    height: 560,
    nChairs: (config && config.nChairs) || 30,
    chairRadius: (config && config.chairRadius) || 16,
    mouseSpeed: (config && config.mouseSpeed) || 150,
    teamSpeed: (config && config.teamSpeed) || 220,
    seed: (config && config.seed) || 20250813,
    running: true,

    chairs: [],
    players: [],
    status: 'playing',
    elapsed: 0,
    lastTs: null,
    dispatchCd: 0,
    reservedChairs: new Map(), // chairId -> release timestamp
  }

  const tuning = (config && config.tuning) || {}
  // Planning parameters (configurable)
  const EPS = tuning.eps ?? 0.12 // relative margin per step
  const MIN_DT = tuning.minDt ?? 0.12 // absolute time margin per step (s)
  const COOLDOWN = tuning.cooldown ?? 0.15 // global cooldown
  const PLAN_DEPTH = tuning.planDepth ?? 6 // steps to simulate ahead
  const NO_CLOSER_PX = tuning.noCloserPx ?? 24 // forbid creating new vacancy closer to mouse by more than this
  const DEBUG = !!tuning.debug
  const MAX_CHAIN = tuning.maxChain ?? 3 // how many defenders to chain per frame
  const RESERVED_RADIUS = tuning.reservedRadius ?? 120 // distance to trigger reservation
  const CORDON_K = tuning.cordonK ?? 3 // number of chairs to reserve (including vacancy)
  const CORDON_HOLD = tuning.cordonHold ?? 1.2 // seconds to keep reservations after trigger

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y })
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y })
  const mul = (v, k) => ({ x: v.x * k, y: v.y * k })
  const norm = (v) => {
    const d = Math.hypot(v.x, v.y) || 1
    return { x: v.x / d, y: v.y / d }
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5)
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function makeChairsDense(n, w, h, seed, chairRadius) {
    const rng = mulberry32(seed)
    const safety = 12
    const margin = chairRadius + safety
    let minD = chairRadius * 2.35
    const chairs = []
    for (let i = 0; i < n; i++) {
      let placed = false,
        attempts = 0
      while (!placed && attempts < 5000) {
        attempts++
        const x = clamp(margin + rng() * (w - 2 * margin), margin, w - margin)
        const y = clamp(margin + rng() * (h - 2 * margin), margin, h - margin)
        const p = { x, y }
        if (chairs.every((c) => dist(c.pos, p) >= minD)) {
          chairs.push({ id: i, pos: p })
          placed = true
        }
        if (!placed && attempts % 1000 === 0) minD *= 0.96
      }
      if (!placed) {
        // ring fallback strictly inside margins
        const r = Math.max(10, Math.min(w, h) / 2 - margin)
        const cx = w / 2,
          cy = h / 2
        const ang = (i / Math.max(1, n)) * Math.PI * 2 + rng() * 0.2
        const px = clamp(cx + r * Math.cos(ang), margin, w - margin)
        const py = clamp(cy + r * Math.sin(ang), margin, h - margin)
        chairs.push({ id: i, pos: { x: px, y: py } })
      }
    }
    // final clamp (safety)
    for (const c of chairs) {
      c.pos.x = clamp(c.pos.x, margin, w - margin)
      c.pos.y = clamp(c.pos.y, margin, h - margin)
    }
    return chairs
  }

  function reset() {
    state.chairs = makeChairsDense(
      state.nChairs,
      state.width,
      state.height,
      state.seed,
      state.chairRadius,
    )
    const rng = mulberry32(state.seed + 42)
    const emptyChairId = Math.floor(rng() * state.nChairs)
    state.elapsed = 0
    state.status = 'playing'
    state.lastTs = null
    state.dispatchCd = 0
    state.reservedChairs.clear()
    const team = []
    let tIdx = 0
    for (let i = 0; i < state.nChairs; i++) {
      if (i === emptyChairId) continue
      team.push({
        id: `p-${tIdx++}`,
        pos: { ...state.chairs[i].pos },
        targetChairId: null,
        sittingOn: i,
      })
    }
    const emptyPos = state.chairs[emptyChairId].pos
    const ang = rng() * Math.PI * 2
    const far = Math.max(state.width, state.height) * 0.9 + 260
    const safety = state.chairRadius + 12
    const startInside = {
      x: clamp(rng() * state.width, safety, state.width - safety),
      y: clamp(rng() * state.height, safety, state.height - safety),
    }
    const mouse = {
      id: 'mouse',
      pos: startInside,
      targetChairId: null,
      sittingOn: null,
    }
    state.players = [mouse, ...team]
  }

  function step(dt) {
    if (state.status !== 'playing') return
    if (state.dispatchCd > 0)
      state.dispatchCd = Math.max(0, state.dispatchCd - dt)

    // clear expired reservations
    for (const [cid, until] of state.reservedChairs.entries()) {
      if (state.elapsed >= until) state.reservedChairs.delete(cid)
    }

    const occupied = new Set(
      state.players.filter((p) => p.sittingOn != null).map((p) => p.sittingOn),
    )
    const vacancies = state.chairs.filter((c) => !occupied.has(c.id))
    if (vacancies.length === 0) {
      state.status = 'team_won'
      return
    }

    const mouse = state.players.find((p) => p.id === 'mouse')
    if (mouse.sittingOn != null) return

    // choose vacancy with minimal mouse time now
    let target = null
    let tM = Infinity
    for (const c of vacancies) {
      const t = dist(mouse.pos, c.pos) / state.mouseSpeed
      if (t < tM) {
        tM = t
        target = c
      }
    }
    mouse.targetChairId = target.id

    const team = state.players.filter((p) => p.id !== 'mouse')
    const lookup = new Map(state.chairs.map((c) => [c.id, c]))

    const near = dist(mouse.pos, lookup.get(target.id).pos) <= RESERVED_RADIUS
    if (near) {
      const tPos = lookup.get(target.id).pos
      const entries = state.chairs.map((c) => ({
        id: c.id,
        d: dist(c.pos, tPos),
      }))
      entries.sort((a, b) => a.d - b.d)
      const reserveIds = entries.slice(0, CORDON_K + 1).map((e) => e.id)
      for (const cid of reserveIds) {
        state.reservedChairs.set(cid, state.elapsed + CORDON_HOLD)
      }
    }

    const reservedSet = new Set(state.reservedChairs.keys())

    if (state.dispatchCd === 0) {
      function plan(tgtId, depth, usedPlayers, usedSeats) {
        if (usedSeats.has(tgtId)) return { margin: -Infinity, chain: [] }
        const seatsNext = new Set(usedSeats)
        seatsNext.add(tgtId)
        const tMcur = dist(mouse.pos, lookup.get(tgtId).pos) / state.mouseSpeed
        let best = { margin: -Infinity, chain: [] }
        for (const p of team) {
          if (p.sittingOn == null) continue
          if (usedPlayers.has(p.id)) continue
          if (reservedSet.has(p.sittingOn) && p.sittingOn !== tgtId) continue
          const t = dist(p.pos, lookup.get(tgtId).pos) / state.teamSpeed
          const margin = tMcur - t
          if (!(margin >= MIN_DT && t <= tMcur * (1 - EPS))) continue
          const prevSeat = p.sittingOn
          const dCur = dist(mouse.pos, lookup.get(tgtId).pos)
          const dNew = dist(mouse.pos, lookup.get(prevSeat).pos)
          if (dNew + NO_CLOSER_PX < dCur) continue
          let sub = { margin: Infinity, chain: [] }
          if (depth > 1) {
            const usedNext = new Set(usedPlayers)
            usedNext.add(p.id)
            sub = plan(prevSeat, depth - 1, usedNext, seatsNext)
          }
          const score = Math.min(margin, sub.margin)
          if (score > best.margin) {
            best = {
              margin: score,
              chain: [{ player: p, to: tgtId }, ...sub.chain],
            }
          }
        }
        return best
      }

      const seatsToCover =
        reservedSet.size > 0 ? Array.from(reservedSet) : [target.id]
      const used = new Set()
      let dispatched = false
      for (const cid of seatsToCover) {
        const covered = team.some(
          (p) => p.sittingOn === cid || p.targetChairId === cid,
        )
        if (covered) continue
        const planRes = plan(cid, PLAN_DEPTH, used, new Set())
        if (planRes.chain.length === 0) continue
        for (const mv of planRes.chain.slice(0, MAX_CHAIN)) {
          if (used.has(mv.player.id)) continue
          mv.player.targetChairId = mv.to
          mv.player.sittingOn = null
          used.add(mv.player.id)
          dispatched = true
        }
      }
      if (dispatched) state.dispatchCd = COOLDOWN
    }

    // move
    for (const p of state.players) {
      if (p.targetChairId == null) continue
      const pos = lookup.get(p.targetChairId).pos
      const speed = p.id === 'mouse' ? state.mouseSpeed : state.teamSpeed
      const stepLen = Math.min(speed * dt, dist(p.pos, pos))
      p.pos = add(p.pos, mul(norm(sub(pos, p.pos)), stepLen))
    }

    // arrivals single-occupancy
    const reach = state.chairRadius * 0.5
    const arrivals = []
    for (const p of state.players) {
      if (p.targetChairId == null) continue
      const pos = lookup.get(p.targetChairId).pos
      const d = dist(p.pos, pos)
      if (d <= reach) arrivals.push({ p, d, isMouse: p.id === 'mouse' })
    }
    arrivals.sort(
      (a, b) => a.d - b.d || (a.isMouse === b.isMouse ? 0 : a.isMouse ? 1 : -1),
    )
    const dyn = new Set(
      state.players.filter((p) => p.sittingOn != null).map((p) => p.sittingOn),
    )
    for (const a of arrivals) {
      const p = a.p
      const cid = p.targetChairId
      if (cid == null) continue
      if (dyn.has(cid)) {
        p.targetChairId = null
        continue
      }
      if (p.id === 'mouse') {
        p.sittingOn = cid
        state.status = 'mouse_won'
        dyn.add(cid)
        break
      } else {
        p.sittingOn = cid
        p.targetChairId = null
        dyn.add(cid)
      }
    }
  }

  reset()
  return { step, getState: () => state }
}
