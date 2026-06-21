module.exports = {
  apps: [
    {
      name: "subul-platform",
      script: "./server.js",
      instances: process.env.PM2_INSTANCES || "max",
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY || "600M",
      env: {
        NODE_ENV: "development",
        PORT: process.env.PORT || 3000,
        LOAD_TEST_MODE: "false",
      },
      env_production: {
        NODE_ENV: "production",
        LOAD_TEST_MODE: "false",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
