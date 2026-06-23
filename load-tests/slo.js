/** Shared SLO targets for public launch load gate */
module.exports = {
  P95_MS_MAX: Number(process.env.LOAD_GATE_P95_MS || 1200),
  ERROR_RATE_MAX: Number(process.env.LOAD_GATE_ERROR_RATE || 0.01),
  WARMUP_PATHS: ['/', '/cases', '/contact', '/transparency', '/stories'],
  PROFILES: {
    baseline: {
      name: 'baseline',
      path: '/health',
      connections: Number(process.env.LOAD_GATE_BASELINE_CONNECTIONS || 10),
      durationSec: Number(process.env.LOAD_GATE_BASELINE_DURATION || 20),
      publicPage: false,
    },
    stress: [
      {
        name: 'stress-homepage',
        path: '/',
        connections: Number(process.env.LOAD_GATE_STRESS_CONNECTIONS || 15),
        durationSec: Number(process.env.LOAD_GATE_STRESS_DURATION || 30),
        publicPage: true,
      },
      {
        name: 'stress-cases',
        path: '/cases',
        connections: Number(process.env.LOAD_GATE_STRESS_CONNECTIONS || 15),
        durationSec: Number(process.env.LOAD_GATE_STRESS_DURATION || 30),
        publicPage: true,
      },
    ],
    soak: {
      name: 'soak-cases',
      path: '/cases',
      connections: Number(process.env.LOAD_GATE_SOAK_CONNECTIONS || 8),
      durationSec: Number(process.env.LOAD_GATE_SOAK_DURATION || 90),
      publicPage: true,
    },
  },
};
