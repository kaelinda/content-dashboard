import {
  assertConfig,
  configDefaults,
  printConfigError,
} from "../src/lib/config.mjs";
// Docker receives an explicit environment. Do not parse or copy .env files into the image.
try {
  Object.assign(process.env, configDefaults(process.env));
  assertConfig();
} catch (e) {
  printConfigError(e);
  process.exit(1);
}
await import("../server.js");
