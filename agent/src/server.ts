import { getAIConfig } from "./ai-config.js";
import { createApp } from "./app.js";
import { assertNoOwnerKey, config } from "./config.js";

assertNoOwnerKey();
getAIConfig(); // Validate the default provider before accepting requests.
createApp().listen(config.port, config.host, () => {
  console.log(`Agent Allowance running at http://${config.host}:${config.port}`);
});
