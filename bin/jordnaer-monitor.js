#!/usr/bin/env node

import { monitor } from "../src/monitor.js";

const exitCode = await monitor(process.argv.slice(2));
process.exitCode = exitCode;
