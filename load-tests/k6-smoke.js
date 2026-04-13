import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 50 },
    { duration: "60s", target: 200 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1200"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

export default function () {
  const routes = ["/", "/cases", "/stories", "/contact", "/transparency", "/health"];
  const route = routes[Math.floor(Math.random() * routes.length)];
  const res = http.get(`${BASE_URL}${route}`);

  check(res, {
    "status is 200 or 302": (r) => r.status === 200 || r.status === 302,
  });

  sleep(1);
}

