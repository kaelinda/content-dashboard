import { rm, mkdir } from "node:fs/promises";
export default async function setup() {
  await rm(".data-e2e", { recursive: true, force: true });
  await mkdir("test-results", { recursive: true });
}
