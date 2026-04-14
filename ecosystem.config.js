module.exports = {
  apps: [
    {
      name: "subul-platform",
      script: "server.js",
      exec_mode: "cluster",
      instances: process.env.PM2_INSTANCES || "max",
      watch: false,
      max_memory_restart: process.env.PM2_MAX_MEMORY || "600M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 3000,
        LOAD_TEST_MODE: process.env.LOAD_TEST_MODE || "false",
      },
    },
  ],
};

module.exports = {
  apps: [
    {
      name: "subul-platform",
      script: "./server.js",
      instances: "max", // Utilize all available CPU cores
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
