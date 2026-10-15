#!/usr/bin/env node
import { readVersion } from '../version.js';

console.log(`ci-explain ${readVersion()}`);
