// Simulation Test Harness (ESM)
import { createSimulation } from './simulation.mjs';

function runTest(config) {
    const sim = createSimulation(config);
    const state = sim.getState();

    const maxTime = 120; // 2 minutes
    const dt = 0.016; // 60 FPS

    while (state.elapsed < maxTime && state.status === 'playing') {
        sim.step(dt);
        state.elapsed += dt;
    }

    return {
        status: state.status,
        time: state.elapsed,
    };
}

function runBatchForTuning(tuning) {
    const results = [];
    for (let i = 0; i < 10; i++) {
        const config = { seed: 20250813 + i, tuning };
        const result = runTest(config);
        results.push(result);
    }
    const avgTime = results.reduce((acc, r) => acc + r.time, 0) / results.length;
    return avgTime;
}

function sweep() {
    console.log('Running tuning sweep...');
    const candidates = [
        { eps: 0.2, minDt: 0.18, cooldown: 0.10, maxChain: 6, noCloserPx: 36 },
        { eps: 0.15, minDt: 0.15, cooldown: 0.12, maxChain: 5, noCloserPx: 30 },
        { eps: 0.1, minDt: 0.10, cooldown: 0.08, maxChain: 8, noCloserPx: 40 },
        { eps: 0.12, minDt: 0.12, cooldown: 0.05, maxChain: 10, noCloserPx: 24 },
        { eps: 0.18, minDt: 0.16, cooldown: 0.10, maxChain: 7, noCloserPx: 32 },
    ];
    let best = null;
    for (const t of candidates) {
        const avg = runBatchForTuning(t);
        console.log('tuning', t, 'avg', avg.toFixed(1));
        if (!best || avg > best.avg) best = { t, avg };
    }
    console.log('\nBest tuning:', best.t, 'avg', best.avg.toFixed(1));
}

if (process.env.SWEEP === '1') {
    sweep();
} else {
    console.log('Running batch simulation...');
    const avg = runBatchForTuning({});
    console.log('Default tuning avg', avg.toFixed(1));
}