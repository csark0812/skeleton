#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { runCustomizeHook } from "./run.ts";

process.stdout.write(runCustomizeHook(readFileSync(0, "utf8")));
