import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./flows",
  use: {
    baseURL: "http://localhost:3000",
  },
});
