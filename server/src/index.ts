import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { config } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({ staticDir: path.resolve(here, "../../client/dist") });
app.listen(config.port, () => console.log(`FUELTRACK API listening on http://localhost:${config.port} (${config.nodeEnv})`));
